/**
 * Validation for the Walk-in form and the section's follow-up edits. Client-safe: the form runs the same
 * schema before it sends, and the server runs it again.
 */
import { z } from 'zod'
import { getIndiaYmd } from '@/lib/date-time'
import {
  WALK_IN_BOOKING_TIMELINES,
  WALK_IN_CUSTOMER_TYPES,
  WALK_IN_HOLDING_REASONS,
  WALK_IN_LIMITS,
  WALK_IN_MODELS,
  WALK_IN_SOURCES,
  isValidIndianMobile,
  normalizeMobile,
  tidyText,
  titleCaseName,
} from './constants'

/** How far back a walk-in may be dated: staff sometimes enter the week's visitors late. */
export const WALK_IN_BACKDATE_DAYS = 60

const YMD = /^\d{4}-\d{2}-\d{2}$/

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

const requiredText = (label: string, max: number) =>
  z.preprocess((value) => tidyText(value), z.string().min(1, `Enter the ${label}.`).max(max, `The ${label} is too long (${max} characters at most).`))

const optionalText = (label: string, max: number) =>
  z.preprocess(
    (value) => (tidyText(value) === '' ? null : tidyText(value)),
    z.string().max(max, `The ${label} is too long (${max} characters at most).`).nullable(),
  )

const optionalDate = (label: string) =>
  z.preprocess(
    (value) => (tidyText(value) === '' ? null : tidyText(value)),
    z.string().regex(YMD, `Enter a valid ${label}.`).nullable(),
  )

const yesNo = (label: string) =>
  z.preprocess(
    (value) => (value === 'yes' || value === 'true' ? true : value === 'no' || value === 'false' ? false : value),
    z.boolean({ message: `Choose Yes or No for ${label}.` }),
  )

export const walkInSubmitSchema = z
  .object({
    enquiryDate: z.string({ message: 'Enter the date of the visit.' }).regex(YMD, 'Enter the date of the visit.'),
    customerName: z.preprocess((value) => titleCaseName(value), z.string().min(2, "Enter the customer's name.").max(WALK_IN_LIMITS.name, 'The name is too long.')),
    mobile: z.preprocess(
      (value) => normalizeMobile(value),
      z.string().refine(isValidIndianMobile, 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.'),
    ),
    email: z.preprocess(
      (value) => (tidyText(value) === '' ? null : tidyText(value).toLowerCase()),
      z.string().max(WALK_IN_LIMITS.email).email('Enter a valid e-mail address, or leave it empty.').nullable(),
    ),
    address: requiredText('area / locality address (e.g. Talab Tillo, Gandhi Nagar)', WALK_IN_LIMITS.address),
    model: z.enum(WALK_IN_MODELS, { message: 'Choose the model the customer asked about.' }),
    consultantName: z.preprocess((value) => titleCaseName(value), z.string().min(2, 'Choose or type the sales consultant.').max(WALK_IN_LIMITS.consultant)),
    testDrive: yesNo('test drive'),
    enquirySource: z.enum(WALK_IN_SOURCES, { message: 'Choose the enquiry source.' }),
    customerType: z.enum(WALK_IN_CUSTOMER_TYPES, { message: 'Choose New or Existing customer.' }),
    exchange: yesNo('exchange'),
    exchangeDetails: optionalText('exchange vehicle', WALK_IN_LIMITS.exchangeDetails),
    expectedBookingTimeline: z.enum(WALK_IN_BOOKING_TIMELINES, { message: 'Select the expected booking timeline.' }),
    expectedBookingDate: z.string({ message: 'Select the expected booking date.' }).regex(YMD, 'Enter a valid expected booking date.'),
    holdingReason: optionalText('reason holding back', 200),
    followUpDate: z.string({ message: 'Select the next follow-up date.' }).regex(YMD, 'Enter a valid next follow-up date.'),
    remarks: optionalText('remarks', WALK_IN_LIMITS.remarks),
    additionalInfo: optionalText('additional information', WALK_IN_LIMITS.additionalInfo),
    /** Honeypot: a real person never sees or fills this field. */
    website: z.string().max(0).optional(),
  })
  .superRefine((value, ctx) => {
    const today = getIndiaYmd()
    if (value.enquiryDate > today) ctx.addIssue({ code: 'custom', path: ['enquiryDate'], message: 'The visit date cannot be in the future.' })
    else if (daysBetween(value.enquiryDate, today) > WALK_IN_BACKDATE_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['enquiryDate'], message: `The visit date cannot be more than ${WALK_IN_BACKDATE_DAYS} days ago.` })
    }
    if (value.expectedBookingDate && value.expectedBookingDate < value.enquiryDate) {
      ctx.addIssue({ code: 'custom', path: ['expectedBookingDate'], message: 'The expected booking date cannot be before the visit.' })
    }
    if (value.followUpDate && value.followUpDate < value.enquiryDate) {
      ctx.addIssue({ code: 'custom', path: ['followUpDate'], message: 'The next follow-up date cannot be before the visit.' })
    }
    if (value.expectedBookingTimeline !== 'Booked today' && !value.holdingReason) {
      ctx.addIssue({ code: 'custom', path: ['holdingReason'], message: 'Select what is holding the customer back.' })
    }
    if (value.exchange && !value.exchangeDetails) {
      ctx.addIssue({ code: 'custom', path: ['exchangeDetails'], message: 'Enter the exchange vehicle, e.g. "Swift 2018".' })
    }
  })

export type WalkInSubmitInput = z.infer<typeof walkInSubmitSchema>

/** The follow-up fields the sales team keeps up to date in the section. */
export const walkInUpdateSchema = z.object({
  remarks: optionalText('remarks', WALK_IN_LIMITS.remarks).optional(),
  expectedBookingDate: optionalDate('expected booking date').optional(),
  expectedBookingTimeline: optionalText('booking timeline', 50).optional(),
  holdingReason: optionalText('holding reason', 200).optional(),
  followUpDate: optionalDate('follow-up date').optional(),
  booked: z.boolean().optional(),
  consultantName: z.preprocess((value) => titleCaseName(value), z.string().min(2).max(WALK_IN_LIMITS.consultant)).optional(),
  expectedUpdatedAt: z.string().min(1),
})

export type WalkInUpdateInput = z.infer<typeof walkInUpdateSchema>

export const walkInDeleteSchema = z.object({
  reason: requiredText('reason', 300).refine((value) => value.length >= 5, 'Say why it is being removed (at least 5 characters).'),
})

export type FieldErrors = Record<string, string>

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    if (!out[key]) out[key] = issue.message
  }
  return out
}
