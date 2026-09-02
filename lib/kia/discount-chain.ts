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

export type DiscountStage = 'sales_manager' | 'md' | 'accounts' | 'done' | 'rejected'

export type DiscountChainRow = {
  smStatus?: string | null
  mdStatus?: string | null
  payoutStatus?: string | null
}

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()

/**
 * The stage a request is waiting on.
 *
 * ⚠️ Order matters and rejection short-circuits: a request the Sales Manager refused must never
 * appear in the MD's queue. Reading the stages in sequence is what guarantees that.
 */
export function discountStage(row: DiscountChainRow): DiscountStage {
  if (norm(row.smStatus) === 'REJECTED' || norm(row.mdStatus) === 'REJECTED') return 'rejected'
  if (norm(row.smStatus) !== 'APPROVED') return 'sales_manager'
  if (norm(row.mdStatus) !== 'APPROVED') return 'md'
  // Accounts have acted either way — PAID or NOT_PAID — so the chain is finished.
  if (!norm(row.payoutStatus)) return 'accounts'
  return 'done'
}

/**
 * Roles that fill each stage.
 *
 * ⚠️ `sales_manager` AND `general_manager` both fill the first desk. The role enum carries both and
 * branches staff them inconsistently — gating on `sales_manager` alone would leave a branch whose
 * sales head holds `general_manager` with a queue nobody can clear. `sales_head` is included for the
 * same reason.
 *
 * ⚠️ developer/admin are support access, NOT business authority. They are listed so a stuck request
 * can be unblocked, and deliberately kept out of MD_ROLES so nobody mistakes the escape hatch for
 * the MD's decision.
 */
export const DISCOUNT_SUPPORT_ROLES = ['developer', 'admin'] as const
export const SALES_MANAGER_ROLES = ['sales_manager', 'general_manager', 'sales_head'] as const
export const MD_ROLES = ['md', 'ceo'] as const
export const ACCOUNTS_ROLES = ['accounts', 'finance_head', 'finance_team'] as const

export function canActOnDiscountStage(role: unknown, stage: DiscountStage): boolean {
  const r = String(role ?? '').trim().toLowerCase()
  if (stage === 'done' || stage === 'rejected') return false
  if ((DISCOUNT_SUPPORT_ROLES as readonly string[]).includes(r)) return true
  if (stage === 'sales_manager') return (SALES_MANAGER_ROLES as readonly string[]).includes(r)
  if (stage === 'md') return (MD_ROLES as readonly string[]).includes(r)
  return (ACCOUNTS_ROLES as readonly string[]).includes(r)
}

/** What to call the stage on screen and in a queue heading. */
export const DISCOUNT_STAGE_LABEL: Record<DiscountStage, string> = {
  sales_manager: 'With Sales Manager',
  md: 'With MD',
  accounts: 'With Accounts',
  done: 'Completed',
  rejected: 'Rejected',
}

/**
 * The overall outcome, for the `status` column the pre-existing rows already use.
 *
 * ⚠️ 'APPROVED' means the MD approved it — NOT that the customer has the money. The payout is
 * reported separately, because "approved but unpaid" is the state most worth being able to see.
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
