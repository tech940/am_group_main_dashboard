/**
 * Which stage a vendor-payment request is actually sitting at.
 *
 * ⚠️ THIS IS THE ONE DEFINITION. It is lifted verbatim from the server's own inference in
 * `app/api/brands/kia/approvals/bulk-action/route.ts:62-70` — the logic bulk-approve really acts on
 * — because that logic is currently duplicated in three files and they do not agree with each other.
 * Anything new must import from here rather than add a fourth copy.
 *
 * ⚠️ DO NOT use the UI's `getPendingStageLabel` (`features/kia/kia-approvals-page.tsx:1034`) to
 * decide what is waiting on the MD. It returns 'Pending EA' whenever `eaApproval` is `''` — which it
 * always is at creation, since nothing ever auto-fills it — so requests that have genuinely cleared
 * ED and HR never reach the 'Pending MD' label. Filtering an MD queue on that label yields a queue
 * that is almost always empty while real work piles up behind it.
 *
 * ⚠️ Every stage column is FREE TEXT and can be `''` (set at creation), `null` (after a send-back),
 * or one of the four values below. `''` and `null` both mean "nobody has acted", so every check here
 * goes through `hasActed()` rather than a truthiness test.
 */

import { isHrApprovalRequired } from '@/lib/kia/approval-hr-routing'

/**
 * Does this payment type route through HR? Aliased from the ONE shared definition in
 * `lib/kia/approval-hr-routing.ts`, which both approval endpoints and the vendor-payments page also
 * import. It must never diverge from what the server enforces, or the MD queue and the endpoint
 * disagree about whether HR sits in the chain.
 */
export const vendorPaymentRequiresHr = isHrApprovalRequired

/** The only values the stage columns ever hold, besides '' and null. */
export const VP_STAGE_VALUES = ['APPROVED', 'NOT APPROVED', 'HELD', 'SENT BACK'] as const
export type VpStageValue = (typeof VP_STAGE_VALUES)[number]

export type VendorPaymentStageKey = 'sales_manager' | 'hr' | 'md' | 'accounts' | 'done'

/** The subset of columns the stage inference needs. Kept minimal so any row shape can satisfy it. */
export type VendorPaymentStageInput = {
  vpApproval?: string | null
  hrApproval?: string | null
  managementApproval?: string | null
  accountApproval?: string | null
  approvalType?: string | null
}

/** '' and null are indistinguishable in meaning here: nobody has acted on this stage yet. */
function hasActed(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function isApproved(value: string | null | undefined): boolean {
  return value === 'APPROVED'
}

/**
 * A stage still needs action when it is untouched, HELD, or explicitly NOT APPROVED. Matching
 * bulk-action/route.ts, a rejected or held row returns to its owner's queue rather than dropping out.
 */
function needsAction(value: string | null | undefined): boolean {
  return !hasActed(value) || value === 'HELD' || value === 'NOT APPROVED'
}

/**
 * The stage this request is currently waiting on — the server's own ordering:
 * ED → HR (conditional) → MD → Accounts.
 *
 * EA is deliberately absent: the server's inference skips it entirely, and the chain guard at
 * `action/route.ts:150` never requires EA before MD either. EA is an optional side review, not a
 * gate, whatever the UI label implies.
 */
export function vendorPaymentActiveStage(row: VendorPaymentStageInput): VendorPaymentStageKey {
  const requiresHr = vendorPaymentRequiresHr(row.approvalType)

  if (needsAction(row.vpApproval)) return 'sales_manager'

  // ⚠️ HR only gates a request that has NOT yet cleared the MD.
  //
  // When the HR routing rule was corrected (lib/kia/approval-hr-routing.ts), payroll-type requests
  // that had already been approved by the MD — and in some cases paid — would have been dragged back
  // into HR's queue for a review that is now moot. Owner decision: what is completed stays
  // completed. Only the requests still in flight pick up the HR step.
  //
  // Measured at the time of the fix: this keeps 2 already-approved requests at 'done' while the 5
  // still awaiting the MD correctly move to 'hr'.
  if (requiresHr && needsAction(row.hrApproval) && !isApproved(row.managementApproval)) return 'hr'

  if (needsAction(row.managementApproval)) return 'md'
  if (isApproved(row.managementApproval) && needsAction(row.accountApproval)) return 'accounts'
  return 'done'
}

/** True when the MD is the next person who must act on this request. */
export function isAwaitingVendorPaymentMd(row: VendorPaymentStageInput): boolean {
  return vendorPaymentActiveStage(row) === 'md'
}

/** Human label for whose desk a request is on — used when browsing in "All" scope. */
export const VENDOR_PAYMENT_STAGE_LABEL: Record<VendorPaymentStageKey, string> = {
  sales_manager: 'With ED',
  hr: 'With HR',
  md: 'Awaiting MD',
  accounts: 'With Accounts',
  done: 'Completed',
}
