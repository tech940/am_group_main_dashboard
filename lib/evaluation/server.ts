import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email/email-service'
import { vehicleEvaluationAlertTemplate } from '@/lib/email/templates/vehicle-evaluation-alert'
import { formatDay, formatKm } from './catalog'
import type { EvaluationSubmitInput } from './types'

/** What `vehicle_evaluations.source` records for leads from /sell-used-car. The campaign is in utm_*. */
export const EVALUATION_SOURCE = 'sell-used-car'

/** The same person re-sending the same car inside this window gets their first lead back, not a second one. */
const REPEAT_WINDOW_MINUTES = 10
/**
 * A ceiling on the whole public form, per 10 minutes. A WhatsApp blast brings bursts, but not hundreds of real
 * people finishing the form inside ten minutes — this only stops a script filling the table and the inbox.
 */
const FLOOD_LIMIT = 300

const DEFAULT_ALERT_RECIPIENTS = ['tech@amgroupind.com', 'aryan@amgroupind.com']

export class EvaluationError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message)
    this.name = 'EvaluationError'
  }
}

type Row = { inserted: string | null; existing: string | null; recent: number }

/** The six characters the customer sees on the confirmation and can quote on the call. */
export function evaluationReference(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase()
}

/**
 * "Wrong number? Change it" sends a fresh lead that names the one it corrects. The note goes on the NEW row only:
 * this route is public, so it never writes to a row it didn't just create.
 */
function correctionNote(input: EvaluationSubmitInput): string | null {
  return input.correctionOf
    ? `Corrects request ${evaluationReference(input.correctionOf)}: the mobile number on that one was wrong.`
    : null
}

/**
 * Stores a lead. The double-submit and flood checks live in the insert statement itself, so two taps racing
 * each other can't both pass a check made in an earlier round trip.
 */
export async function createVehicleEvaluation(input: EvaluationSubmitInput): Promise<{ id: string; duplicate: boolean }> {
  const result = (await db.execute(sql`
    WITH repeat_submit AS (
      SELECT id FROM public.vehicle_evaluations
      WHERE source = ${EVALUATION_SOURCE} AND mobile = ${input.mobile}
        AND lower(brand) = lower(${input.brand}) AND lower(model) = lower(${input.model})
        AND created_at > now() - make_interval(mins => ${REPEAT_WINDOW_MINUTES}::int)
      ORDER BY created_at DESC
      LIMIT 1
    ),
    flood AS (
      SELECT count(*)::int AS n FROM public.vehicle_evaluations
      WHERE source = ${EVALUATION_SOURCE}
        AND created_at > now() - make_interval(mins => ${REPEAT_WINDOW_MINUTES}::int)
    ),
    inserted AS (
      INSERT INTO public.vehicle_evaluations (
        customer_name, country_code, mobile, brand, model, manufacturing_year, mileage_exact,
        evaluation_date, interested_in_new_car, source, utm_source, utm_medium, utm_campaign, status, notes
      )
      SELECT
        ${input.customerName}::text, '+91', ${input.mobile}::text, ${input.brand}::text, ${input.model}::text,
        ${input.manufacturingYear}::int, ${input.kilometres}::int, ${input.evaluationDate}::text,
        ${input.interestedInNewCar}::boolean, ${EVALUATION_SOURCE}::text,
        ${input.utmSource}::text, ${input.utmMedium}::text, ${input.utmCampaign}::text, 'new', ${correctionNote(input)}::text
      WHERE NOT EXISTS (SELECT 1 FROM repeat_submit) AND (SELECT n FROM flood) < ${FLOOD_LIMIT}::int
      RETURNING id
    )
    SELECT (SELECT id FROM inserted) AS inserted,
           (SELECT id FROM repeat_submit) AS existing,
           (SELECT n FROM flood) AS recent
  `)) as unknown as Row[]
  const row = result[0]
  if (row?.inserted) return { id: row.inserted, duplicate: false }
  if (row?.existing) return { id: row.existing, duplicate: true }
  throw new EvaluationError('We’re getting a lot of requests right now. Please try again in a few minutes.', 429)
}

/** `EVALUATION_ALERT_RECIPIENTS` (comma-separated) when set; otherwise the desk that has always received these. */
export function evaluationAlertRecipients(): string[] {
  const configured = (process.env.EVALUATION_ALERT_RECIPIENTS || '')
    .split(',')
    .map((address) => address.trim())
    .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
  return configured.length ? configured : DEFAULT_ALERT_RECIPIENTS
}

/**
 * Emails the desk about one new lead. `send` is injectable so checks never reach real SMTP.
 * Called from `after()` in the route: the customer's confirmation never waits on the mail server.
 */
export async function sendEvaluationAlert(
  input: EvaluationSubmitInput,
  id: string,
  send: (options: Parameters<typeof sendEmail>[0]) => Promise<unknown> = sendEmail,
  now: Date = new Date(),
): Promise<void> {
  const submittedAt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now)
  const { subject, html, text } = vehicleEvaluationAlertTemplate({
    customerName: input.customerName,
    mobile: input.mobile,
    brand: input.brand,
    model: input.model,
    manufacturingYear: input.manufacturingYear,
    kilometres: formatKm(input.kilometres),
    evaluationDate: formatDay(input.evaluationDate, 'long'),
    interestedInNewCar: input.interestedInNewCar,
    submittedAt,
    reference: evaluationReference(id),
    correctsReference: input.correctionOf ? evaluationReference(input.correctionOf) : null,
    campaign: [input.utmSource, input.utmCampaign].filter(Boolean).join(' / ') || null,
  })
  await send({ to: evaluationAlertRecipients(), subject, html, text })
}
