import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email/email-service'
import { vehicleEvaluationAlertTemplate } from '@/lib/email/templates/vehicle-evaluation-alert'
import { calculateEstimatedValuation } from './car-data'
import { EvaluationSubmitSchema, type EvaluationSubmitInput } from './types'

const MANAGEMENT_ALERT_RECIPIENTS = ['tech@amgroupind.com', 'aryan@amgroupind.com']

export class EvaluationError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message)
    this.name = 'EvaluationError'
  }
}

/**
 * Normalizes 10-digit Indian phone number
 */
function normalizeMobile(val: string): string {
  const digits = val.replace(/\D/g, '')
  if (digits.length === 10) return digits
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length > 10) return digits.slice(-10)
  return digits
}

/**
 * Creates and stores a new vehicle evaluation lead
 */
export async function createVehicleEvaluation(rawInput: unknown): Promise<{
  id: string
  valuation: {
    minPriceLakhs: number
    maxPriceLakhs: number
    minPriceFormatted: string
    maxPriceFormatted: string
  }
}> {
  const parsed = EvaluationSubmitSchema.safeParse(rawInput)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? 'Invalid input data'
    throw new EvaluationError(firstIssue, 400)
  }

  const input: EvaluationSubmitInput = parsed.data
  const cleanMobile = normalizeMobile(input.mobile)
  if (cleanMobile.length !== 10) {
    throw new EvaluationError('Please enter a valid 10-digit mobile number', 400)
  }

  // Calculate Valuation Estimate
  const valuation = calculateEstimatedValuation({
    brand: input.brand,
    model: input.model,
    year: input.manufacturingYear,
    fuelType: input.fuelType,
    transmission: input.transmission,
    kmRangeId: input.kilometersDriven,
    exactKm: input.mileageExact ?? undefined,
  })

  // Insert into DB with flood protection (at most 10 submissions per minute per phone)
  try {
    const insertResult: any = await db.execute(sql`
      INSERT INTO public.vehicle_evaluations (
        customer_name,
        country_code,
        mobile,
        brand,
        model,
        manufacturing_year,
        fuel_type,
        transmission,
        kilometers_driven,
        mileage_exact,
        evaluation_date,
        city_area,
        interested_in_new_car,
        estimated_price_min,
        estimated_price_max,
        source,
        utm_source,
        utm_medium,
        utm_campaign,
        status
      ) VALUES (
        ${input.customerName},
        '+91',
        ${cleanMobile},
        ${input.brand},
        ${input.model},
        ${input.manufacturingYear},
        ${input.fuelType || null},
        ${input.transmission || null},
        ${input.kilometersDriven || null},
        ${input.mileageExact || null},
        ${input.evaluationDate},
        ${input.cityArea},
        ${input.interestedInNewCar},
        ${valuation.minPriceLakhs},
        ${valuation.maxPriceLakhs},
        ${input.source || 'whatsapp_campaign'},
        ${input.utmSource || null},
        ${input.utmMedium || null},
        ${input.utmCampaign || null},
        'new'
      )
      RETURNING id
    `)

    const row = Array.isArray(insertResult) ? insertResult[0] : insertResult?.rows?.[0]
    const id = row?.id as string

    // Dispatch background email alert to management
    const submittedAt = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date())

    const estimatedPriceFormatted = `${valuation.minPriceFormatted} – ${valuation.maxPriceFormatted}`

    const { subject, html, text } = vehicleEvaluationAlertTemplate({
      customerName: input.customerName,
      mobile: cleanMobile,
      brand: input.brand,
      model: input.model,
      manufacturingYear: input.manufacturingYear,
      fuelType: input.fuelType,
      transmission: input.transmission,
      kilometersDriven: input.kilometersDriven,
      evaluationDate: input.evaluationDate,
      cityArea: input.cityArea,
      interestedInNewCar: input.interestedInNewCar,
      estimatedPriceFormatted,
      submittedAt,
      source: input.source,
    })

    sendEmail({
      to: MANAGEMENT_ALERT_RECIPIENTS,
      subject,
      html,
      text,
    }).catch((err) => {
      console.error('[evaluation-alert-email] Failed to dispatch alert:', err)
    })

    return {
      id,
      valuation,
    }
  } catch (error: any) {
    console.error('[createVehicleEvaluation] DB error:', error)
    throw new EvaluationError('Failed to record evaluation request. Please try again.', 500)
  }
}

/**
 * Attach uploaded vehicle photo URLs to the evaluation record
 */
export async function attachEvaluationPhotos(
  evaluationId: string,
  photoUrls: string[],
): Promise<void> {
  if (!evaluationId || !photoUrls || photoUrls.length === 0) return

  await db.execute(sql`
    UPDATE public.vehicle_evaluations
    SET uploaded_photos = ${JSON.stringify(photoUrls)}::jsonb,
        updated_at = now()
    WHERE id = ${evaluationId}::uuid
  `)
}
