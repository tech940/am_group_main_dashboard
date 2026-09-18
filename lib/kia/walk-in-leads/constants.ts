/**
 * AM Kia · Walk-in Leads — the vocabulary shared by the no-login form, the dashboard section and the one-time
 * import of the "AM Kia Walk In Register" Google Form. Client-safe.
 */
import { APPROVAL_ONLY_BRANCHES } from '@/lib/kia/approval-branches'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'

/** The line-up a walk-in can ask about. The sheet used the first seven; the rest are current models. */
export const WALK_IN_MODELS = [
  'SONET',
  'SELTOS',
  'SYROS',
  'SYROS EV',
  'CARENS',
  'CARENS CLAVIS',
  'CARENS CLAVIS EV',
  'CARNIVAL',
  'SORENTO',
  'EV6',
  'EV9',
] as const

/** The sheet's enquiry sources, in the order they are used. */
export const WALK_IN_SOURCES = [
  'WALK IN',
  'REFERENCE',
  'HYPERLOCAL',
  'SALES CONSULTANT OWN SOURCE',
  'SOCIAL MEDIA',
  'OTHERS',
] as const

/** The buying intent / forecasting timeline chips. */
export const WALK_IN_BOOKING_TIMELINES = [
  'Booked today',
  'Within 7 days',
  '8 to 30 days',
  'Next month',
  '2 to 3 months',
  'No timeline given',
] as const
export type WalkInBookingTimeline = (typeof WALK_IN_BOOKING_TIMELINES)[number]

/**
 * What is holding the buyer back (mandatory unless booked).
 */
export const WALK_IN_HOLDING_REASONS = [
  'Discussing with family',
  'Waiting for price or offer',
  'Exchange evaluation pending',
  'Test drive pending',
  'Finance approval',
  'Just looking',
] as const
export type WalkInHoldingReason = (typeof WALK_IN_HOLDING_REASONS)[number]

/**
 * The buying intent staff wrote in REMARKS most often (1,713 sheet rows). Offered as quick picks; free text is
 * still accepted. "BOOKED" is what the sheet's Booked column keyed on.
 */
export const WALK_IN_INTENTS = [
  'BOOKED',
  'WILL PLAN',
  'WILL DECIDE',
  'WITHIN DAYS',
  'WITHIN 1 WEEK',
  'WITHIN 1 MONTH',
  'NEXT MONTH',
  'WILL DISCUSS WITH FAMILY',
  'WILL TAKE TEST DRIVE FIRST',
  'WILL PLAN AFTER EVALUATION',
  'WAITING FOR PRICE LIST',
  'NO PLAN YET',
] as const

export const WALK_IN_CUSTOMER_TYPES = ['NEW', 'EXISTING'] as const
export type WalkInCustomerType = (typeof WALK_IN_CUSTOMER_TYPES)[number]

/**
 * The KIA showrooms that take walk-ins: the two DMS dealers (Jammu JK402, Udhampur JK501) PLUS Banihal (JK502).
 *
 * ⚠️ Banihal has no DMS dealer code, so it is not in KIA_BRANCH_DEALERS (that registry drives the sales, stock
 * and Business Excellence pickers, where it would be a permanently empty branch). It lives in
 * APPROVAL_ONLY_BRANCHES, which is where Admin's "Branch scope" offers it — so a Banihal pin already exists.
 */
export type WalkInBranch = { code: string; label: string; aliases: readonly string[] }

export const WALK_IN_BRANCHES: readonly WalkInBranch[] = [
  ...KIA_BRANCH_DEALERS.map((dealer) => ({ code: dealer.dealerCode as string, label: dealer.label as string, aliases: [] as readonly string[] })),
  ...(APPROVAL_ONLY_BRANCHES.kia ?? []).map((branch) => ({ code: branch.code, label: branch.label, aliases: branch.aliases })),
]

export function isWalkInBranchCode(value: unknown): value is string {
  return typeof value === 'string' && WALK_IN_BRANCHES.some((branch) => branch.code === value)
}

export function walkInBranchLabel(code: string | null | undefined): string {
  return WALK_IN_BRANCHES.find((branch) => branch.code === code)?.label ?? code ?? '—'
}

export const WALK_IN_LIMITS = {
  name: 120,
  email: 160,
  address: 500,
  additionalInfo: 1000,
  remarks: 500,
  exchangeDetails: 200,
  consultant: 80,
} as const

/** Collapses spacing; used for every free-text field before it is stored. */
export function tidyText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** "shiv dev  SINGH" → "Shiv Dev Singh" — the sheet had one consultant spelt three ways. */
export function titleCaseName(value: unknown): string {
  return tidyText(value)
    .toLowerCase()
    .replace(/(^|[\s.'-])([a-z])/g, (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`)
}

/** Digits only. A leading 91 on a 12-digit number and a leading 0 on an 11-digit number are dropped. */
export function normalizeMobile(value: unknown): string {
  let digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

export function isValidIndianMobile(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits)
}

/** Whether a remark means the customer booked. */
export function remarksMeanBooked(remarks: string | null | undefined): boolean {
  return /^booked\b/i.test(tidyText(remarks))
}
