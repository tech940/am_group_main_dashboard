/**
 * Validation for the /sell-used-car lead form. Client-safe: the form runs the same schema before it sends,
 * and the public submit route runs it again — the route is unauthenticated, so this is the whole contract.
 */
import { z } from 'zod'
import {
  EVALUATION_WINDOW_DAYS,
  MAX_KILOMETRES,
  OLDEST_YEAR,
  addDays,
  currentIndiaYear,
  indiaToday,
  normaliseMobile,
} from './catalog'

/** Collapses whitespace and drops control characters, so a name can't carry line breaks into an email. */
export function tidy(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const text = (message: string, max: number) =>
  z.preprocess(tidy, z.string().min(1, message).max(max, `Keep this under ${max} characters.`))

const optionalTag = z.preprocess((value) => (tidy(value) === '' ? null : tidy(value).slice(0, 100)), z.string().nullable())

export const EvaluationSubmitSchema = z.object({
  customerName: z.preprocess(
    tidy,
    z
      .string()
      .min(2, 'Enter your name.')
      .max(80, 'Keep your name under 80 characters.')
      .refine((v) => /\p{L}/u.test(v), 'Use letters for your name.'),
  ),
  mobile: z.preprocess(
    (value) => normaliseMobile(String(value ?? '')) ?? '',
    z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number.'),
  ),
  brand: text('Choose your car’s brand.', 40),
  model: text('Choose your car’s model.', 60),
  manufacturingYear: z.coerce
    .number({ message: 'Choose the year.' })
    .int('Choose the year.')
    .min(OLDEST_YEAR, 'Choose the year.')
    .refine((year) => year <= currentIndiaYear(), 'That year hasn’t happened yet.'),
  kilometres: z.coerce
    .number({ message: 'Enter the kilometres driven.' })
    .int('Enter whole kilometres.')
    .min(0, 'Enter the kilometres driven.')
    .max(MAX_KILOMETRES, 'Check the kilometres — that’s over 9,99,999.'),
  evaluationDate: z.preprocess(
    tidy,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day for the evaluation.')
      .refine((ymd) => {
        const today = indiaToday()
        return ymd >= today && ymd <= addDays(today, EVALUATION_WINDOW_DAYS)
      }, `Choose a day between today and ${EVALUATION_WINDOW_DAYS} days from now.`),
  ),
  interestedInNewCar: z.boolean({ message: 'Tell us if you’re also looking at a new car.' }),
  /** The lead this one corrects ("Wrong number? Change it"). Recorded as a note on the NEW lead only. */
  correctionOf: z.preprocess((value) => (value ? value : null), z.uuid().nullable()).optional().default(null),
  utmSource: optionalTag.optional().default(null),
  utmMedium: optionalTag.optional().default(null),
  utmCampaign: optionalTag.optional().default(null),
})

export type EvaluationSubmitInput = z.infer<typeof EvaluationSubmitSchema>

/** First message per field, for showing next to the input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    if (!out[key]) out[key] = issue.message
  }
  return out
}
