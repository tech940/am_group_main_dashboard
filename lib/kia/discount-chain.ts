/**
 * Post-delivery discount requests: who acts next, and who may act.
 *
 *     requested → Sales Manager → MD → Accounts confirm the money reached the customer
 *
 * ── Why Accounts is not a third approval ──────────────────────────────────────────────────────
 * The last stage records a FACT — did the discount actually reach the customer — rather than
 * granting permission. Modelling it as an approval would give Accounts a veto over a decision the
 * MD has already made, and would leave "approved but never paid" indistinguishable from "refused".
 * They are different states and the business cares about the difference.
 *
 * Client-safe: no server-only imports, so the buttons on the screen and the guard in the API are
 * decided by the same function. Every approval chain in this codebase that had two copies of its
 * rule has drifted — the vendor-payment screen once offered a VP buttons the server rejected.
 */

export const DISCOUNT_MD_THRESHOLD = 5000

export type DiscountStage = 'sales_manager' | 'ceo' | 'md' | 'accounts' | 'done' | 'rejected'

export type DiscountChainRow = {
  requestedAmount?: string | number | null
  approvedAmount?: string | number | null
  smStatus?: string | null
  ceoStatus?: string | null
  ceoApprovedAmount?: string | number | null
  mdStatus?: string | null
  mdApprovedAmount?: string | number | null
  payoutStatus?: string | null
}

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()

/**
 * Does this discount amount require MD approval?
 * Disounts > ₹5,000 must pass through MD after CEO before reaching Accounts.
 */
export function requiresMdApproval(row: DiscountChainRow): boolean {
  const amount = Number(row.ceoApprovedAmount || row.approvedAmount || row.requestedAmount || 0)
  return amount > DISCOUNT_MD_THRESHOLD
}

/**
 * The stage a request is waiting on.
 *
 * Flow:
 *   Amount <= 5k:  GSM/SM -> CEO -> Accounts -> Done
 *   Amount > 5k:   GSM/SM -> CEO -> MD -> Accounts -> Done
 */
export function discountStage(row: DiscountChainRow): DiscountStage {
  if (norm(row.smStatus) === 'REJECTED' || norm(row.ceoStatus) === 'REJECTED' || norm(row.mdStatus) === 'REJECTED') {
    return 'rejected'
  }
  if (norm(row.smStatus) !== 'APPROVED') return 'sales_manager'
  if (norm(row.ceoStatus) !== 'APPROVED') return 'ceo'
  if (requiresMdApproval(row) && norm(row.mdStatus) !== 'APPROVED') return 'md'
  if (!norm(row.payoutStatus)) return 'accounts'
  return 'done'
}

/**
 * Roles that fill each stage.
 */
export const DISCOUNT_SUPPORT_ROLES = ['developer', 'admin'] as const
export const SALES_MANAGER_ROLES = ['sales_manager', 'general_manager', 'sales_head'] as const
export const CEO_ROLES = ['ceo', 'ed'] as const
export const MD_ROLES = ['md'] as const
export const ACCOUNTS_ROLES = ['accounts', 'accounts_head', 'accounts_team', 'finance_head', 'finance_team'] as const

export function canActOnDiscountStage(role: unknown, stage: DiscountStage): boolean {
  const r = String(role ?? '').trim().toLowerCase()
  if (stage === 'done' || stage === 'rejected') return false
  if ((DISCOUNT_SUPPORT_ROLES as readonly string[]).includes(r)) return true
  if (stage === 'sales_manager') return (SALES_MANAGER_ROLES as readonly string[]).includes(r)
  if (stage === 'ceo') return (CEO_ROLES as readonly string[]).includes(r)
  if (stage === 'md') return (MD_ROLES as readonly string[]).includes(r)
  if (stage === 'accounts') return (ACCOUNTS_ROLES as readonly string[]).includes(r)
  return false
}

/** What to call the stage on screen and in a queue heading. */
export const DISCOUNT_STAGE_LABEL: Record<DiscountStage, string> = {
  sales_manager: 'With GSM / SM',
  ceo: 'With CEO',
  md: 'With MD',
  accounts: 'With Accounts',
  done: 'Completed',
  rejected: 'Rejected',
}

/**
 * The overall outcome, for the `status` column the pre-existing rows already use.
 */
export function discountOverallStatus(row: DiscountChainRow): 'PENDING' | 'APPROVED' | 'REJECTED' {
  const stage = discountStage(row)
  if (stage === 'rejected') return 'REJECTED'
  if (stage === 'accounts' || stage === 'done') return 'APPROVED'
  return 'PENDING'
}

/**
 * The discount types offered in the form.
 *
 * A plain list, not a database enum: adding one must not need a migration, and a missing ALTER TYPE
 * on a Postgres enum has taken this app down once already.
 */
export const DISCOUNT_TYPES = [
  'Cash discount',
  'Accessories',
  'Insurance',
  'Extended warranty',
  'Exchange bonus',
  'Corporate / institutional',
  'Loyalty',
  'Scheme shortfall',
  'Goodwill / retention',
  'Other',
] as const
export type DiscountType = (typeof DISCOUNT_TYPES)[number]

export function isValidDiscountType(value: unknown): boolean {
  return (DISCOUNT_TYPES as readonly string[]).includes(String(value ?? '').trim())
}

/**
 * Can a discount be requested against this booking at all?
 *
 * ⚠️ DELIVERED ONLY, by the brief. A discount before handover belongs in the price on the proforma,
 * where it is part of the deal the customer signs; this flow is for money returned AFTER the sale,
 * which is why it needs the MD and then a payment.
 */
export function canRequestDiscount(booking: { status?: string | null; deletedAt?: unknown }): boolean {
  if (booking.deletedAt) return false
  return String(booking.status ?? '').trim().toLowerCase() === 'delivered'
}
