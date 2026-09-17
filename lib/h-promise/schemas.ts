/**
 * What each H Promise form may send. Client-safe: the forms validate with the same schemas the routes enforce,
 * so a message the person sees in the browser is the message the server would have given.
 *
 * Rules that need "today" or the database (future dates, the name lists, duplicates) are checked on the server
 * in lib/h-promise/server.ts; the forms mirror them with `max` dates and live checks.
 */

import { z } from 'zod'
import { FILE_KINDS, PAPERWORK_STATUS_VALUES, SOLD_TO_VALUES, type FileKind } from './constants'
import { MIN_REASON_LENGTH } from './status'
import { MIN_REG_KEY_LENGTH, isValidPhone, normalizePhone, normalizeRegNo } from './registration'

const YMD = /^\d{4}-\d{2}-\d{2}$/
const MAX_RUPEES = 100_000_000 // ₹10 crore: a typo guard, not a business rule

function isRealDate(value: string): boolean {
  if (!YMD.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100
}

const emptyToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value)

export const ymdSchema = (label: string) =>
  z.string({ message: `Enter the ${label}.` }).trim().refine(isRealDate, `Enter a valid ${label}.`)

const optionalYmd = (label: string) =>
  z.preprocess(emptyToUndefined, ymdSchema(label).optional()).transform((value) => value ?? null)

function rupees(label: string, { min = 0, allowZero = false }: { min?: number; allowZero?: boolean } = {}) {
  return z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) return undefined
      if (typeof value === 'string') return Number(value.replace(/[₹,\s]/g, ''))
      return value
    },
    z
      .number({ message: `Enter the ${label}.` })
      .refine((n) => Number.isFinite(n), `Enter the ${label} as a number.`)
      .refine((n) => (allowZero ? n >= min : n > min), allowZero ? `The ${label} cannot be negative.` : `The ${label} must be more than zero.`)
      .refine((n) => n <= MAX_RUPEES, `The ${label} looks too large — check the zeros.`)
      .refine((n) => Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-6, `The ${label} can have at most two decimals.`),
  )
}

const optionalRupees = (label: string) =>
  z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : value),
    z.union([z.null(), rupees(label, { allowZero: true })]),
  )

const optionalInt = (label: string, min: number, max: number) =>
  z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) return null
      if (typeof value === 'string') return Number(value.replace(/[,\s]/g, ''))
      return value
    },
    z.union([
      z.null(),
      z
        .number({ message: `Enter the ${label} as a number.` })
        .int(`The ${label} must be a whole number.`)
        .min(min, `The ${label} must be at least ${min}.`)
        .max(max, `The ${label} must be at most ${max}.`),
    ]),
  )

const text = (label: string, max: number) =>
  z.string({ message: `Enter the ${label}.` }).trim().min(1, `Enter the ${label}.`).max(max, `The ${label} is too long (${max} characters at most).`)

/** A value picked from a list (names, locations): the message asks for a choice, not typing. */
const choice = (label: string, max: number) =>
  z.string({ message: `Choose the ${label}.` }).trim().min(1, `Choose the ${label}.`).max(max, `The ${label} is too long (${max} characters at most).`)

const optionalText = (label: string, max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value ?? null),
    z.union([z.null(), z.string().trim().max(max, `The ${label} is too long (${max} characters at most).`)]),
  )

export const regNoSchema = z
  .string({ message: 'Enter the registration number.' })
  .trim()
  .max(20, 'That registration number is too long.')
  .refine((value) => normalizeRegNo(value).length >= MIN_REG_KEY_LENGTH, 'Enter the registration number.')

export const phoneSchema = (label: string) =>
  z
    .string({ message: `Enter the ${label}.` })
    .trim()
    .refine((value) => isValidPhone(value), `The ${label} must be 10 digits.`)
    .transform((value) => normalizePhone(value))

const optionalPhone = (label: string) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value ?? null),
    z.union([z.null(), phoneSchema(label)]),
  )

const uuid = z.string().uuid('That upload is not valid. Upload the file again.')

/** `{kind: stagedFileId}` limited to the listed kinds. */
function filesFor<K extends FileKind>(kinds: readonly K[]) {
  const shape = Object.fromEntries(kinds.map((kind) => [kind, uuid.optional()])) as Record<K, z.ZodOptional<typeof uuid>>
  return z.object(shape).strict().default({} as never)
}

export const PURCHASE_FILE_KINDS = ['purchase_approval_screenshot'] as const
export const SALE_FILE_KINDS = ['buyer_pan', 'buyer_aadhaar', 'form_c', 'sale_approval_screenshot', 'gate_pass_photo'] as const
export const DOCUMENT_FILE_KINDS = ['rc', 'seller_aadhaar', 'seller_pan', 'credit_note', 'insurance_copy', 'form_35', 'rto_mail'] as const
export const BROKER_RC_FILE_KINDS = ['rc_transfer'] as const
export const LEDGER_FILE_KINDS = ['payment_ledger'] as const

const purchaseFields = {
  regNo: regNoSchema,
  model: text('model', 80),
  colour: optionalText('colour', 40),
  manufacturingYear: optionalInt('manufacturing year', 1980, 2100),
  odometerKm: optionalInt('odometer reading', 0, 2_000_000),
  engineNo: optionalText('engine number', 40),
  chassisNo: optionalText('chassis number', 40),
  location: choice('location', 80),
  purchaseDate: ymdSchema('purchase date'),
  purchasePrice: rupees('purchase price'),
  purchaseGstPct: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? 0 : Number(value)),
    z.number({ message: 'Choose the GST rate.' }).min(0, 'GST cannot be negative.').max(28, 'GST above 28 % is not a valid rate.'),
  ),
  expectedProfit: optionalRupees('expected profit'),
  expectedSaleDate: ymdSchema('expected sale date'),
  purchaseRemarks: optionalText('remarks', 1000),
  purchaseFinanced: z.boolean({ message: 'Say whether the purchase was financed.' }),
  purchasedBy: choice('person who bought it', 80),
  salesConsultant: optionalText('sales consultant', 80),
  sellerPhone: phoneSchema("seller's phone number"),
  purchaseWhatsappApprover: choice('WhatsApp approver', 80),
}

export const createPurchaseSchema = z.object({
  ...purchaseFields,
  files: filesFor(PURCHASE_FILE_KINDS),
})
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>

export const updatePurchaseSchema = z.object({
  ...Object.fromEntries(Object.entries(purchaseFields).map(([key, schema]) => [key, schema.optional()])) as {
    [K in keyof typeof purchaseFields]: z.ZodOptional<(typeof purchaseFields)[K]>
  },
  files: filesFor(PURCHASE_FILE_KINDS),
  remarks: optionalText('reason for the change', 500),
  /** Only for a rejected purchase: save the corrections and send it back to the approvers. */
  resubmit: z.boolean().optional(),
  expectedUpdatedAt: z.string().min(1),
})
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>

export const saleSchema = z.object({
  saleDate: ymdSchema('sale date'),
  sellingPrice: rupees('selling price'),
  otherCost: rupees('refurbishment / other cost', { allowZero: true }).default(0),
  isDemo: z.boolean({ message: 'Say whether it was a demo vehicle.' }),
  soldTo: z.enum(SOLD_TO_VALUES, { message: 'Choose who it was sold to.' }),
  saleFinanced: z.boolean({ message: 'Say whether the sale was financed.' }),
  soldBy: choice('person who sold it', 80),
  buyerName: text("buyer's name", 120),
  buyerPhone: phoneSchema("buyer's phone number"),
  buyerAddress: optionalText("buyer's address", 500),
  saleWhatsappApprover: choice('WhatsApp approver', 80),
  files: filesFor(SALE_FILE_KINDS),
  remarks: optionalText('reason for the change', 500),
  /** Required when a sale already exists (an edit). */
  expectedUpdatedAt: z.string().min(1).optional(),
})
export type SaleInput = z.infer<typeof saleSchema>

export const bookingSchema = z.object({
  bookingDate: ymdSchema('booking date'),
  amount: rupees('booking amount'),
  remarks: optionalText('remarks', 500),
  files: filesFor(['booking_receipt'] as const),
})
export type BookingInput = z.infer<typeof bookingSchema>

export const bookingUpdateSchema = z.object({
  bookingDate: ymdSchema('booking date').optional(),
  amount: rupees('booking amount').optional(),
  remarks: optionalText('remarks', 500).optional(),
  files: filesFor(['booking_receipt'] as const),
  reason: optionalText('reason for the change', 500),
})
export type BookingUpdateInput = z.infer<typeof bookingUpdateSchema>

export const refundSchema = z.object({
  refundDate: ymdSchema('refund date'),
  refundRemarks: text('refund remarks', 500),
  files: filesFor(['refund_cheque'] as const),
})
export type RefundInput = z.infer<typeof refundSchema>

export const documentsSchema = z.object({
  insuranceEndDate: optionalYmd('insurance end date'),
  hypothecation: z.preprocess(emptyToUndefined, z.enum(PAPERWORK_STATUS_VALUES).optional()).transform((v) => v ?? null),
  rtoStatus: z.preprocess(emptyToUndefined, z.enum(PAPERWORK_STATUS_VALUES).optional()).transform((v) => v ?? null),
  documentsRemarks: optionalText('remarks', 1000),
  files: filesFor(DOCUMENT_FILE_KINDS),
  expectedUpdatedAt: z.string().min(1),
})
export type DocumentsInput = z.infer<typeof documentsSchema>

export const brokerRcSchema = z.object({
  brokerRcRemarks: optionalText('remarks', 1000),
  files: filesFor(BROKER_RC_FILE_KINDS),
  expectedUpdatedAt: z.string().min(1),
})
export type BrokerRcInput = z.infer<typeof brokerRcSchema>

export const ledgerSchema = z.object({
  files: filesFor(LEDGER_FILE_KINDS),
  remarks: optionalText('remarks', 500),
})
export type LedgerInput = z.infer<typeof ledgerSchema>

const reason = (what: string) =>
  z
    .string({ message: `Say why you are ${what}.` })
    .trim()
    .min(MIN_REASON_LENGTH, `Say why you are ${what} (at least ${MIN_REASON_LENGTH} characters).`)
    .max(500, 'Keep the reason under 500 characters.')

export const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: optionalText('reason', 500),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'reject' && (value.reason ?? '').length < MIN_REASON_LENGTH) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: `Say why you are rejecting it (at least ${MIN_REASON_LENGTH} characters).` })
    }
  })
export type DecisionInput = z.infer<typeof decisionSchema>

export const reopenSchema = z.object({ reason: reason('reopening it') })
export const withdrawSchema = z.object({ reason: reason('withdrawing the sale') })
export const deleteSchema = z.object({ reason: reason('deleting it') })
export const resubmitSchema = z.object({ remarks: optionalText('remarks', 500) })

export const optionCreateSchema = z.object({
  kind: z.enum(['staff', 'approver', 'location']),
  label: text('name', 80),
})
export const optionUpdateSchema = z.object({
  label: text('name', 80).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
})

export const rateCreateSchema = z.object({
  effectiveFrom: ymdSchema('date the rate starts'),
  ratePct: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : Number(value)),
    z.number({ message: 'Enter the yearly interest rate.' }).min(0, 'The rate cannot be negative.').max(60, 'A yearly rate above 60 % is not plausible.'),
  ),
  note: optionalText('note', 300),
})

export const exchangeBonusSchema = z.object({
  entryDate: optionalYmd('date'),
  vehicleNo: regNoSchema,
  vehicleName: optionalText('vehicle name', 80),
  salesConsultant: optionalText('sales consultant', 80),
  newCarModel: text('new car model', 80),
  bonusAmount: rupees('exchange bonus', { allowZero: true }),
  customerPhone: optionalPhone("customer's phone number"),
  remarks: optionalText('remarks', 500),
})
export type ExchangeBonusInput = z.infer<typeof exchangeBonusSchema>

export const uploadKindSchema = z.enum(FILE_KINDS, { message: 'That document type is not recognised.' })
