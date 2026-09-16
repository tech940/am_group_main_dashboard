/**
 * Booking discount requests: who may raise one, who acts next, and who may act.
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

import { canCreateKiaBooking } from '@/lib/kia/workflow-access'

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

/**
 * Who may RAISE a discount request.
 *
 * ⚠️ THIS IS A NEW CONTROL, and it closes a hole rather than adding friction. Until 2026-09-16 the
 * POST route checked only that somebody was logged in, so any authenticated employee — service
 * advisor, HR, anyone — could raise a discount against any booking in the company. The button being
 * hidden from them was the only thing standing in the way, and a hidden button is not a control.
 *
 * The set is the same one that may create a booking (consultant, SM/GSM/Sales Head, MD, support) —
 * deliberately REUSED from lib/kia/workflow-access.ts rather than restated here. Every approval
 * chain in this codebase that kept two copies of its role list has drifted.
 */
export function canRequestDiscountRole(role: unknown): boolean {
  return canCreateKiaBooking(String(role ?? ''))
}

/**
 * Did this person raise the request they are now trying to act on?
 *
 * ⚠️ THE REASON THIS EXISTS. GSM/SM are the FIRST APPROVAL STAGE, and from 2026-09-16 they may also
 * raise a request — so without this check a Sales Manager could raise a discount and immediately
 * approve it themselves, clearing stage one of a chain that exists to have someone else look at it.
 * Nobody approves their own request at any stage, support roles included; the request simply waits
 * for a different pair of eyes.
 */
export function isOwnDiscountRequest(
  row: { requestedBy?: string | null },
  actorUserId: string | null | undefined,
): boolean {
  const requester = String(row.requestedBy ?? '').trim()
  const actor = String(actorUserId ?? '').trim()
  return requester !== '' && actor !== '' && requester === actor
}

/**
 * The whole answer for one person, one request: may they act on it right now?
 *
 * Prefer this over calling canActOnDiscountStage directly — it is the only form that knows about
 * self-approval, and the screen and the API must reach the same verdict from the same function.
 */
export function canActOnDiscountRequest(params: {
  role: unknown
  actorUserId?: string | null
  row: DiscountChainRow & { requestedBy?: string | null }
}): { allowed: boolean; reason: string | null } {
  const stage = discountStage(params.row)
  if (stage === 'done' || stage === 'rejected') {
    return { allowed: false, reason: `This request is already ${stage === 'done' ? 'completed' : 'rejected'}.` }
  }
  if (isOwnDiscountRequest(params.row, params.actorUserId)) {
    return { allowed: false, reason: 'You raised this request, so somebody else has to approve it.' }
  }
  if (!canActOnDiscountStage(params.role, stage)) {
    return { allowed: false, reason: `This request is waiting on ${DISCOUNT_STAGE_LABEL[stage]}.` }
  }
  return { allowed: true, reason: null }
}

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
 * Statuses a discount can NOT be raised against. Everything else can.
 *
 * Stated as a deny-list on purpose: the booking pipeline gains stages over time, and an allow-list
 * would silently lock the button out of every new one until somebody noticed.
 */
const DISCOUNT_BLOCKED_STATUSES = new Set(['cancelled'])

/**
 * Can a discount be requested against this booking at all?
 *
 * ⚠️ ANY LIVE BOOKING, from 2026-09-16 (owner decision). This used to be DELIVERED ONLY — the
 * original brief treated the flow as money returned AFTER a sale, so a discount before handover was
 * supposed to live in the proforma price instead. In practice the negotiation that needs approval
 * happens while the customer is still deciding, and consultants were being told "a discount can only
 * be requested once the vehicle has been delivered" at exactly the moment they needed one. Measured
 * when the rule changed: 69 of 223 bookings were delivered, so five bookings in six could not ask.
 *
 * ⚠️ CANCELLED IS STILL REFUSED, and so is a deleted booking. There is no money to return on a sale
 * that is not happening, and an approval chain running against a dead booking wastes the CEO's time
 * and leaves an approved discount attached to nothing.
 */
export function canRequestDiscount(booking: { status?: string | null; deletedAt?: unknown }): boolean {
  if (booking.deletedAt) return false
  const status = String(booking.status ?? '').trim().toLowerCase()
  if (!status) return false
  return !DISCOUNT_BLOCKED_STATUSES.has(status)
}
