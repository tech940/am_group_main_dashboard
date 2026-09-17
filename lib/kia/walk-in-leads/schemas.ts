/**
 * Validation for the Walk-in form and the section's follow-up edits. Client-safe: the form runs the same
 * schema before it sends, and the server runs it again.
 */
import { z } from 'zod'
import { getIndiaYmd } from '@/lib/date-time'
import {
  WALK_IN_CUSTOMER_TYPES,
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
    address: optionalText('address', WALK_IN_LIMITS.address),
    model: z.enum(WALK_IN_MODELS, { message: 'Choose the model the customer asked about.' }),
    consultantName: z.preprocess((value) => titleCaseName(value), z.string().min(2, 'Choose or type the sales consultant.').max(WALK_IN_LIMITS.consultant)),
    testDrive: yesNo('test drive'),
    enquirySource: z.enum(WALK_IN_SOURCES, { message: 'Choose where the customer came from.' }),
    customerType: z.enum(WALK_IN_CUSTOMER_TYPES, { message: 'Choose New or Existing customer.' }),
    exchange: yesNo('exchange'),
    exchangeDetails: optionalText('exchange vehicle', WALK_IN_LIMITS.exchangeDetails),
    additionalInfo: optionalText('additional information', WALK_IN_LIMITS.additionalInfo),
    expectedBookingDate: optionalDate('expected booking date'),
    remarks: optionalText('remarks', WALK_IN_LIMITS.remarks),
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
    if (value.exchange && !value.exchangeDetails) {
      ctx.addIssue({ code: 'custom', path: ['exchangeDetails'], message: 'Enter the exchange vehicle, e.g. "Swift 2018".' })
    }
  })

export type WalkInSubmitInput = z.infer<typeof walkInSubmitSchema>

/** The follow-up fields the sales team keeps up to date in the section. */
export const walkInUpdateSchema = z.object({
  remarks: optionalText('remarks', WALK_IN_LIMITS.remarks).optional(),
  expectedBookingDate: optionalDate('expected booking date').optional(),
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
