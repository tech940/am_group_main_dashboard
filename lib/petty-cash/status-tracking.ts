// Pure, isomorphic helpers for the Petty Cash status-tracking dashboard.
// No `server-only` import here so both the server query and the client board
// can share the exact same status -> stage/approver mapping.

export type PettyCashApprover = 'ED' | 'EA' | 'MD' | 'Accounts'

// 'pending'  = actively waiting on an approver (counts towards "time waiting")
// 'draft'    = created but not yet submitted into the approval chain
// 'terminal' = closed (approved / rejected / cancelled), nothing is waiting
export type PettyCashStageState = 'pending' | 'draft' | 'terminal'

/**
 * Colour encodes the STATE — what, if anything, someone must do. The words carry WHO.
 *
 * The old scheme coloured by stage, which meant four different colours all saying "pending" while
 * `statusTone` substring-matched 'approved' first and painted still-waiting rows emerald. Green on a
 * queue reads as finished, so the rows that owed an action were the ones the eye skipped.
 *   amber  = waiting on someone
 *   sky    = deliberately paused (on hold)
 *   emerald= done and funded
 *   rose   = rejected
 *   slate  = draft / cancelled — nothing in flight
 */
export type PettyCashTone = 'emerald' | 'amber' | 'blue' | 'violet' | 'rose' | 'sky' | 'slate'

export type PettyCashStageInfo = {
  /** Long form for the Status board's "Current Stage" column. */
  stageLabel: string
  /**
   * The single user-facing sentence for a pill or a row. Authored, never derived — this replaces
   * `getPettyCashStatusLabel`, which was `split('_')` + capitalise and rendered "Md Pending".
   */
  pillLabel: string
  approver: PettyCashApprover | null
  state: PettyCashStageState
  tone: PettyCashTone
}

// Maps every value of `pettyCashRequestStatusEnum` to a human-readable stage
// label and the role that currently owns the request. Terminal / draft states
// have no pending approver.
const STAGE_INFO: Record<string, PettyCashStageInfo> = {
  draft: { stageLabel: 'Draft', pillLabel: 'Draft', approver: null, state: 'draft', tone: 'slate' },
  submitted: { stageLabel: 'ED Approval', pillLabel: 'Waiting on ED', approver: 'ED', state: 'pending', tone: 'amber' },
  ed_pending: { stageLabel: 'ED Approval', pillLabel: 'Waiting on ED', approver: 'ED', state: 'pending', tone: 'amber' },
  ed_on_hold: { stageLabel: 'ED Approval · On Hold', pillLabel: 'On hold — ED', approver: 'ED', state: 'pending', tone: 'sky' },
  ed_approved: { stageLabel: 'EA Approval', pillLabel: 'Waiting on EA', approver: 'EA', state: 'pending', tone: 'amber' },
  ed_rejected: { stageLabel: 'Rejected by ED', pillLabel: 'Rejected by ED', approver: null, state: 'terminal', tone: 'rose' },
  ea_pending: { stageLabel: 'EA Approval', pillLabel: 'Waiting on EA', approver: 'EA', state: 'pending', tone: 'amber' },
  ea_on_hold: { stageLabel: 'EA Approval · On Hold', pillLabel: 'On hold — EA', approver: 'EA', state: 'pending', tone: 'sky' },
  ea_approved: { stageLabel: 'MD Approval', pillLabel: 'Waiting on MD', approver: 'MD', state: 'pending', tone: 'amber' },
  ea_rejected: { stageLabel: 'Rejected by EA', pillLabel: 'Rejected by EA', approver: null, state: 'terminal', tone: 'rose' },
  md_pending: { stageLabel: 'MD Approval', pillLabel: 'Waiting on MD', approver: 'MD', state: 'pending', tone: 'amber' },
  md_on_hold: { stageLabel: 'MD Approval · On Hold', pillLabel: 'On hold — MD', approver: 'MD', state: 'pending', tone: 'sky' },
  md_approved: { stageLabel: 'Accounts', pillLabel: 'Waiting on Accounts', approver: 'Accounts', state: 'pending', tone: 'amber' },
  md_rejected: { stageLabel: 'Rejected by MD', pillLabel: 'Rejected by MD', approver: null, state: 'terminal', tone: 'rose' },
  accounts_pending: { stageLabel: 'Accounts', pillLabel: 'Waiting on Accounts', approver: 'Accounts', state: 'pending', tone: 'amber' },
  accounts_on_hold: { stageLabel: 'Accounts · On Hold', pillLabel: 'On hold — Accounts', approver: 'Accounts', state: 'pending', tone: 'sky' },
  approved: { stageLabel: 'Approved & Allocated', pillLabel: 'Approved & funded', approver: null, state: 'terminal', tone: 'emerald' },
  rejected: { stageLabel: 'Rejected', pillLabel: 'Rejected', approver: null, state: 'terminal', tone: 'rose' },
  cancelled: { stageLabel: 'Cancelled', pillLabel: 'Cancelled', approver: null, state: 'terminal', tone: 'slate' },
  pending: { stageLabel: 'ED Approval', pillLabel: 'Waiting on ED', approver: 'ED', state: 'pending', tone: 'amber' },
}

const FALLBACK_STAGE_INFO: PettyCashStageInfo = { stageLabel: 'Unknown', pillLabel: 'Unknown', approver: null, state: 'terminal', tone: 'slate' }

export function getPettyCashStageInfo(status: string | null | undefined): PettyCashStageInfo {
  if (!status) return FALLBACK_STAGE_INFO
  return STAGE_INFO[status] ?? FALLBACK_STAGE_INFO
}

// Summary buckets shown as the counts row at the top of the board.
export const PETTY_CASH_STAGE_BUCKETS = ['ED Approval', 'EA Approval', 'MD Approval', 'Accounts', 'Completed', 'Rejected'] as const
export type PettyCashStageBucket = typeof PETTY_CASH_STAGE_BUCKETS[number]

export function getPettyCashStageBucket(status: string | null | undefined): PettyCashStageBucket | null {
  const info = getPettyCashStageInfo(status)
  if (info.state === 'pending') {
    if (info.approver === 'ED') return 'ED Approval'
    if (info.approver === 'EA') return 'EA Approval'
    if (info.approver === 'MD') return 'MD Approval'
    if (info.approver === 'Accounts') return 'Accounts'
    return null
  }
  if (status === 'approved') return 'Completed'
  if (info.state === 'terminal') return 'Rejected'
  return null
}

// Formats how long a request has waited at its current stage, e.g. "just now",
// "12 mins", "3h 20m", "5d 2h". `fromIso` is the "waiting since" timestamp.
export function formatWaitingDuration(fromIso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!fromIso) return '—'
  const from = new Date(fromIso).getTime()
  if (!Number.isFinite(from)) return '—'

  const diffMs = Math.max(0, nowMs - from)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'}`

  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  if (hours < 24) return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  const remainderHours = hours % 24
  return remainderHours > 0 ? `${days}d ${remainderHours}h` : `${days}d`
}
