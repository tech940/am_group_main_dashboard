/**
 * H Promise approval states and the moves between them. Client-safe and pure.
 *
 * ⚠️ ONE state machine, imported by the server (which enforces it) and the UI (which only offers what it
 * allows). The database stores these as free text (see migration 0050's note on why not an enum), so this
 * file is the only list of legal values.
 *
 * Both flows share one decision vocabulary:
 *   pending  — entered, waiting for an approver
 *   approved — an approver agreed; the price is now locked (database trigger, SQLSTATE HP001)
 *   rejected — an approver refused, with a reason; the desk can correct and resubmit
 *
 * A sale also has "no sale" (NULL in the database, `null` here): the vehicle has not been sold.
 */

export const DECISION_STATUSES = ['pending', 'approved', 'rejected'] as const
export type DecisionStatus = (typeof DECISION_STATUSES)[number]

export function isDecisionStatus(value: unknown): value is DecisionStatus {
  return typeof value === 'string' && (DECISION_STATUSES as readonly string[]).includes(value)
}

export type Flow = 'purchase' | 'sale'

export type PurchaseAction = 'approve' | 'reject' | 'resubmit' | 'reopen'
export type SaleAction = 'record' | 'approve' | 'reject' | 'resubmit' | 'reopen' | 'withdraw'
export type DecisionAction = 'approve' | 'reject' | 'reopen'

type Transition = { from: ReadonlyArray<DecisionStatus | null>; to: DecisionStatus | null }

export const PURCHASE_TRANSITIONS: Record<PurchaseAction, Transition> = {
  approve: { from: ['pending'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  resubmit: { from: ['rejected'], to: 'pending' },
  // Reopening is how an approved price becomes editable again: approved → pending, then edit, then decide.
  reopen: { from: ['approved'], to: 'pending' },
}

export const SALE_TRANSITIONS: Record<SaleAction, Transition> = {
  record: { from: [null], to: 'pending' },
  approve: { from: ['pending'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  resubmit: { from: ['rejected'], to: 'pending' },
  reopen: { from: ['approved'], to: 'pending' },
  // A sale that fell through before approval: the vehicle goes back to stock. An approved sale must be
  // reopened first, so an approver sees it happen.
  withdraw: { from: ['pending', 'rejected'], to: null },
}

export function canPurchaseTransition(action: PurchaseAction, from: string | null | undefined): boolean {
  const current = isDecisionStatus(from) ? from : null
  return PURCHASE_TRANSITIONS[action].from.includes(current)
}

export function canSaleTransition(action: SaleAction, from: string | null | undefined): boolean {
  const current = isDecisionStatus(from) ? from : null
  return SALE_TRANSITIONS[action].from.includes(current)
}

/** Refusing or reopening always needs a written reason; it is shown to the person who entered the record. */
export function reasonRequired(action: string): boolean {
  return action === 'reject' || action === 'reopen'
}

export const MIN_REASON_LENGTH = 5

/**
 * Nobody decides an entry they made (owner decision). The database enforces the same rule with CHECK
 * constraints; this is the check the server runs first, so the person gets a sentence instead of a 500.
 *
 * `people` is everyone who entered or resubmitted the record. A null never matches: imported rows have no
 * recorded people, and that absence must not block (or wrongly permit) anyone.
 */
export function isSelfDecision(actorId: string | null | undefined, people: ReadonlyArray<string | null | undefined>): boolean {
  if (!actorId) return false
  return people.some((person) => Boolean(person) && person === actorId)
}

/** Prices lock once approved. Everything else stays editable, and every edit is logged. */
export function isPurchasePriceEditable(purchaseStatus: string | null | undefined): boolean {
  return purchaseStatus !== 'approved'
}

export function isSalePriceEditable(saleStatus: string | null | undefined): boolean {
  return saleStatus !== 'approved'
}

// ── Labels ───────────────────────────────────────────────────────────────────────────────────────

export type StatusTone = 'pending' | 'approved' | 'rejected' | 'none'

export type StatusInfo = { label: string; tone: StatusTone; waitingOn: string | null }

const PURCHASE_INFO: Record<DecisionStatus, StatusInfo> = {
  pending: { label: 'Awaiting approval', tone: 'pending', waitingOn: 'An approver' },
  approved: { label: 'Approved', tone: 'approved', waitingOn: null },
  rejected: { label: 'Rejected', tone: 'rejected', waitingOn: 'The purchase desk' },
}

const SALE_INFO: Record<DecisionStatus, StatusInfo> = {
  pending: { label: 'Awaiting approval', tone: 'pending', waitingOn: 'An approver' },
  approved: { label: 'Approved', tone: 'approved', waitingOn: null },
  rejected: { label: 'Rejected', tone: 'rejected', waitingOn: 'The sales desk' },
}

const NO_SALE: StatusInfo = { label: 'Not sold', tone: 'none', waitingOn: null }

/** Never throws: an unrecognised value (e.g. from a bad import) reads as itself rather than crashing a page. */
export function getStatusInfo(flow: Flow, status: string | null | undefined): StatusInfo {
  if (flow === 'sale' && !status) return NO_SALE
  if (isDecisionStatus(status)) return flow === 'purchase' ? PURCHASE_INFO[status] : SALE_INFO[status]
  return { label: String(status ?? 'Unknown'), tone: 'none', waitingOn: null }
}

// ── Two-stage approval (owner decision, 2026-09-17) ─────────────────────────────────────────────────
//
//   1. the General Sales Manager or a Sales Manager approves — the MANAGER stage (the Approve tick);
//   2. the MD gives the FINAL approval — and may give it while the manager stage is still waiting.
//
// The overall status above keeps its meaning (`approved` = finally approved, prices locked). The manager
// stage is recorded beside it (migration 0073).

export const MANAGER_STATUSES = ['pending', 'approved', 'rejected', 'skipped'] as const
/** `skipped`: the MD decided before any manager did. */
export type ManagerStatus = (typeof MANAGER_STATUSES)[number]

/** The four queues of the Approvals tab, in the order work moves through them. */
export type ApprovalQueue = 'manager' | 'md' | 'approved' | 'rejected'

export const APPROVAL_QUEUES: readonly ApprovalQueue[] = ['manager', 'md', 'approved', 'rejected']

export const APPROVAL_QUEUE_LABELS: Record<ApprovalQueue, string> = {
  manager: 'Waiting for GSM / SM',
  md: 'Waiting for MD',
  approved: 'Approved by MD',
  rejected: 'Rejected',
}

/** Who decides at a stage. The MD's decision is always final; a manager only ever decides the first stage. */
export type ApprovalLevel = 'manager' | 'md'

export const APPROVAL_LEVEL_LABELS: Record<ApprovalLevel, string> = { manager: 'GSM / SM', md: 'MD' }

/**
 * The manager stage as the app reads it.
 *
 * ⚠️ NULL is normal: every row written before 0073 (including the sheet import) has none. While the record is
 * undecided that means "waiting for a manager"; once it was decided it means nobody took the manager stage.
 */
export function managerStageOf(status: string | null | undefined, managerStatus: string | null | undefined): ManagerStatus | null {
  if (!isDecisionStatus(status)) return null
  if (managerStatus === 'approved' || managerStatus === 'rejected' || managerStatus === 'skipped') return managerStatus
  return status === 'pending' ? 'pending' : 'skipped'
}

export function approvalQueueOf(status: string | null | undefined, managerStatus: string | null | undefined): ApprovalQueue | null {
  if (status === 'approved') return 'approved'
  if (status === 'rejected') return 'rejected'
  if (status === 'pending') return managerStageOf(status, managerStatus) === 'approved' ? 'md' : 'manager'
  return null
}

/** The stage this person decides at, or null if they cannot decide at all. */
export function approvalLevelOf(approvals: { approve: boolean; final: boolean }): ApprovalLevel | null {
  if (approvals.final) return 'md'
  if (approvals.approve) return 'manager'
  return null
}

/** May a decision at `level` be taken on a record in this state? The MD may act at any point before the end. */
export function canDecideAt(level: ApprovalLevel | null, status: string | null | undefined, managerStatus: string | null | undefined): boolean {
  if (!level || status !== 'pending') return false
  if (level === 'md') return true
  return managerStageOf(status, managerStatus) === 'pending'
}

/** How the final decider reads: the MD, a Developer acting for the MD, or the Google Sheet (imported rows). */
export function finalDeciderLabel(decidedRole: string | null | undefined, decidedByName: string | null | undefined): string {
  // No role: decided before 0073 — in practice the sheet import, whose decider is already named after the sheet.
  if (!decidedRole) return decidedByName ?? 'Google Sheet'
  const who = decidedByName ?? '—'
  return decidedRole === 'md' ? `${who} (MD)` : decidedRole === 'developer' ? `${who} (Developer, for the MD)` : `${who} (${decidedRole})`
}

/** One status line for a purchase or sale, aware of both stages. */
export function getApprovalInfo(flow: Flow, status: string | null | undefined, managerStatus: string | null | undefined): StatusInfo {
  const queue = approvalQueueOf(status, managerStatus)
  if (queue === 'manager') return { label: APPROVAL_QUEUE_LABELS.manager, tone: 'pending', waitingOn: 'The GSM or a Sales Manager' }
  if (queue === 'md') return { label: APPROVAL_QUEUE_LABELS.md, tone: 'pending', waitingOn: 'The MD' }
  return getStatusInfo(flow, status)
}
