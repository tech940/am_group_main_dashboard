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
import { firstStageShortLabel, brandHasFirstStage } from '@/lib/approvals/first-stage-approver'

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

export type VendorPaymentStageKey = 'sales_manager' | 'ceo' | 'hr' | 'ea' | 'md' | 'accounts' | 'done'

/**
 * The stages a caller may POST an action against.
 *
 * ⚠️ EXPORTED SO THE ACTION ROUTE STOPS KEEPING ITS OWN COPY. It hardcoded
 * `['sales_manager', 'hr', 'accounts', 'ea', 'md', 'payment_done']` — with 'ceo' MISSING — while
 * the very same file carried a full authorisation branch, prerequisite check and write branch for
 * the CEO stage. The client computes 'ceo', posts it, and the whitelist rejected it with
 * "Invalid stage." before any of that code ran. So the KIA CEO stage could not be actioned at all
 * from a row button or the detail dialog, on a request the route was otherwise fully equipped to
 * handle.
 *
 * 'done' is terminal and is deliberately absent. 'payment_done' is the Accounts settlement action
 * and is not a stage the inference ever returns, which is why it is listed separately here rather
 * than folded into VendorPaymentStageKey.
 */
export const VENDOR_PAYMENT_ACTIONABLE_STAGES = [
  'sales_manager',
  'ceo',
  'hr',
  'ea',
  'md',
  'accounts',
  'payment_done',
] as const

/** The subset of columns the stage inference needs. Kept minimal so any row shape can satisfy it. */
export type VendorPaymentStageInput = {
  vpApproval?: string | null
  ceoApproval?: string | null
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
 * - Platinum: Submit → EA → MD → Accounts (First stage GSM/VP is bypassed).
 * - Other Non-KIA: first stage (GSM/VP) → EA → MD → Accounts.
 * - KIA: first stage (GSM/VP) → CEO (Sales & Service) → HR (if required) → EA → MD → Accounts.
 *
 * EA approval is strictly required before a request reaches the MD stage.
 */
export function vendorPaymentActiveStage(row: VendorPaymentStageInput): VendorPaymentStageKey {
  const brand = String(row.brand || 'kia').trim().toLowerCase()
  const isKia = brand === 'kia' || brand.startsWith('kia')
  const hasFirstStage = brandHasFirstStage(row.brand, row.department, row.approvalType)
  const requiresHr = vendorPaymentRequiresHr(row.approvalType, row.brand)

  // Stage 1: Department head (GSM for Sales, VP for Service) - Skipped for Platinum
  if (hasFirstStage && needsAction(row.vpApproval)) return 'sales_manager'

  // Stage 2: CEO (KIA ONLY - for both Sales and Service)
  if (isKia && needsAction(row.ceoApproval) && !isApproved(row.managementApproval)) return 'ceo'

  // Stage 3: HR (KIA only, payroll types)
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
 */
const FIXED_STAGE_LABEL: Record<Exclude<VendorPaymentStageKey, 'sales_manager'>, string> = {
  ceo: 'CEO',
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
    case 'ceo': return row.ceoApproval
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
    return firstStageShortLabel(row.brand, row.department, row.approvalType)
  }
  return FIXED_STAGE_LABEL[stage]
}

/**
 * The label the MD sees, naming the right desk AND what that desk did.
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

/**
 * The label written into a history entry's `role`, for the stage that was acted on.
 *
 * ⚠️ THIS IS THE ONE DEFINITION, and it exists because the copies drifted with money on the line.
 * The same map was written out by hand in FOUR places — `[id]/action/route.ts` (history),
 * `[id]/action/route.ts` (SEND_BACK_STAGE_LABELS), `bulk-action/route.ts` and `remark/route.ts` —
 * and exactly one of them, the single-row action route's history label, was missing its `'ceo'`
 * branch. A CEO approval therefore fell through the chain of ternaries to the trailing `: 'MD'` and
 * was recorded as `{ role: 'MD', roleKey: 'ceo' }`.
 *
 * That mislabel was then read back by the workflow strip, which matched history to a stage with
 * `h.role.toLowerCase().includes(key)`. For the MD step that substring test hit the CEO's entry —
 * earlier in the array, so `.find()` returned it — and the MD column rendered the CEO's name and
 * the CEO's timestamp. On KIA_0203 the MD step displayed 06:04 pm, which is BEFORE the 06:06 pm EA
 * step preceding it: a chain that had visibly gone backwards in time.
 *
 * The reader is fixed to key off `roleKey`, but the label still has to be right, because it is what
 * a human reads in the activity log and in every approval email.
 *
 * `row` is only consulted for the first stage, whose name is brand- and department-dependent
 * (ED / GSM / VP / DGM). Every other stage has a fixed name.
 */
export function approvalStageHistoryLabel(
  stage: string,
  row: Pick<VendorPaymentStageInput, 'brand' | 'department' | 'approvalType'>,
): string {
  switch (stage) {
    case 'sales_manager':
      return firstStageShortLabel(row.brand, row.department, row.approvalType)
    case 'ceo':
      return 'CEO'
    case 'hr':
      return 'HR'
    case 'ea':
      return 'EA'
    case 'md':
      return 'MD'
    // The two Accounts actions are distinguished on purpose: one records the invoice, the other
    // records that the money actually moved. Collapsing them to 'Accounts' loses that.
    case 'accounts':
      return 'Accounts (Invoice)'
    case 'payment_done':
      return 'Accounts (Payment)'
    default:
      return stage.toUpperCase()
  }
}
