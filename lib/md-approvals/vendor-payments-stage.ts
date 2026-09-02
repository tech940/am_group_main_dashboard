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
import { firstStageShortLabel } from '@/lib/approvals/first-stage-approver'

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

export type VendorPaymentStageKey = 'sales_manager' | 'hr' | 'ea' | 'md' | 'accounts' | 'done'

/** The subset of columns the stage inference needs. Kept minimal so any row shape can satisfy it. */
export type VendorPaymentStageInput = {
  vpApproval?: string | null
  hrApproval?: string | null
  eaApproval?: string | null
  managementApproval?: string | null
  accountApproval?: string | null
  approvalType?: string | null
  /*
   * Needed by the LABEL, not the stage inference. The first stage is a different person per brand
   * and per department — ED at KIA, the sales GSM elsewhere, and the Group Service Manager on
   * Hyundai/Platinum service — so a label that does not read these cannot name the right desk.
   */
  department?: string | null
  /*
   * Needed in practice even though it is optional in the type: HR is a KIA-only stage, so without
   * the brand this resolver parks a Hyundai or Platinum payroll request on an HR desk that brand
   * does not have. Optional only because a blank brand already means KIA everywhere else against
   * this table — see brandHasHrStage.
   */
  brand?: string | null
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
 * The stage this request is currently waiting on — strict ordering:
 * first stage → HR (KIA only, and only for payroll types) → EA → MD → Accounts.
 *
 * EA approval is strictly required before a request reaches the MD stage.
 */
export function vendorPaymentActiveStage(row: VendorPaymentStageInput): VendorPaymentStageKey {
  const requiresHr = vendorPaymentRequiresHr(row.approvalType, row.brand)

  if (needsAction(row.vpApproval)) return 'sales_manager'

  if (requiresHr && needsAction(row.hrApproval) && !isApproved(row.managementApproval)) return 'hr'

  // EA approval is required before MD can act
  if (needsAction(row.eaApproval) && !isApproved(row.managementApproval)) return 'ea'

  if (needsAction(row.managementApproval)) return 'md'
  if (isApproved(row.managementApproval) && needsAction(row.accountApproval)) return 'accounts'
  return 'done'
}

/** True when the MD is the next person who must act on this request. */
export function isAwaitingVendorPaymentMd(row: VendorPaymentStageInput): boolean {
  return vendorPaymentActiveStage(row) === 'md'
}

/**
 * Human label for whose desk a request is on — used when browsing in "All" scope.
 *
 * ⚠️ KEPT ONLY FOR THE STAGES WHOSE OWNER IS THE SAME EVERYWHERE. `sales_manager` is deliberately
 * absent: that desk is a different person per brand and per department, so a constant cannot name
 * it. Use `vendorPaymentStageLabel(row)` instead, which reads the brand and the department.
 */
const FIXED_STAGE_LABEL: Record<Exclude<VendorPaymentStageKey, 'sales_manager'>, string> = {
  hr: 'HR',
  ea: 'EA',
  md: 'MD',
  accounts: 'Accounts',
  done: 'Completed',
}

/** The column whose value put the request at this stage — what the desk actually did, or nothing. */
function valueAtStage(stage: VendorPaymentStageKey, row: VendorPaymentStageInput): string | null | undefined {
  switch (stage) {
    case 'sales_manager': return row.vpApproval
    case 'hr': return row.hrApproval
    case 'ea': return row.eaApproval
    case 'md': return row.managementApproval
    case 'accounts': return row.accountApproval
    default: return undefined
  }
}

/** Who owns the desk this request is sitting on. */
export function vendorPaymentStageDesk(row: VendorPaymentStageInput): string {
  const stage = vendorPaymentActiveStage(row)
  if (stage === 'sales_manager') {
    /*
     * ⚠️ This used to be the literal 'ED'. Only KIA has an Executive Director, so every Hyundai and
     * Platinum request at stage one was reported to the MD as "With ED" — naming a desk that brand
     * does not have, and hiding that Hyundai/Platinum SERVICE requests belong to the Group Service
     * Manager. The Approvals screen already renders these rows correctly; only this aggregate lied.
     */
    return firstStageShortLabel(row.brand, row.department, row.approvalType)
  }
  return FIXED_STAGE_LABEL[stage]
}

/**
 * The label the MD sees, naming the right desk AND what that desk did.
 *
 * ⚠️ HELD and REJECTED must survive into the label. `needsAction` deliberately returns a held or
 * rejected request to its owner's stage, so without this a request the approver REFUSED reads
 * identically to one nobody has touched — and the MD Approvals client's only held-state affordance
 * is `stageLabel.startsWith('Held')`, which a bare "With ..." can never satisfy. The other two
 * sources already produce 'Held by MD', so vendor payments were the only place the distinction was
 * being lost.
 */
export function vendorPaymentStageLabel(row: VendorPaymentStageInput): string {
  const stage = vendorPaymentActiveStage(row)
  if (stage === 'done') return 'Completed'

  const desk = vendorPaymentStageDesk(row)
  const value = valueAtStage(stage, row)
  if (value === 'HELD') return `Held by ${desk}`
  if (value === 'NOT APPROVED') return `Rejected by ${desk}`
  return stage === 'md' ? 'Awaiting MD' : `With ${desk}`
}
