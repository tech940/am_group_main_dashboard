// Pure, isomorphic helpers for the Petty Cash status-tracking dashboard.
// No `server-only` import here so both the server query and the client board
// can share the exact same status -> stage/approver mapping.

export type PettyCashApprover = 'EA' | 'MD' | 'Accounts'

// 'pending'  = actively waiting on an approver (counts towards "time waiting")
// 'draft'    = created but not yet submitted into the approval chain
// 'terminal' = closed (approved / rejected / cancelled), nothing is waiting
export type PettyCashStageState = 'pending' | 'draft' | 'terminal'

export type PettyCashStageInfo = {
  stageLabel: string
  approver: PettyCashApprover | null
  state: PettyCashStageState
}

// Maps every value of `pettyCashRequestStatusEnum` to a human-readable stage
// label and the role that currently owns the request. Terminal / draft states
// have no pending approver.
const STAGE_INFO: Record<string, PettyCashStageInfo> = {
  draft: { stageLabel: 'Draft', approver: null, state: 'draft' },
  submitted: { stageLabel: 'EA Approval', approver: 'EA', state: 'pending' },
  ea_pending: { stageLabel: 'EA Approval', approver: 'EA', state: 'pending' },
  ea_on_hold: { stageLabel: 'EA Approval · On Hold', approver: 'EA', state: 'pending' },
  ea_approved: { stageLabel: 'MD Approval', approver: 'MD', state: 'pending' },
  ea_rejected: { stageLabel: 'Rejected by EA', approver: null, state: 'terminal' },
  md_pending: { stageLabel: 'MD Approval', approver: 'MD', state: 'pending' },
  md_on_hold: { stageLabel: 'MD Approval · On Hold', approver: 'MD', state: 'pending' },
  md_approved: { stageLabel: 'Accounts', approver: 'Accounts', state: 'pending' },
  md_rejected: { stageLabel: 'Rejected by MD', approver: null, state: 'terminal' },
  accounts_pending: { stageLabel: 'Accounts', approver: 'Accounts', state: 'pending' },
  accounts_on_hold: { stageLabel: 'Accounts · On Hold', approver: 'Accounts', state: 'pending' },
  approved: { stageLabel: 'Approved & Allocated', approver: null, state: 'terminal' },
  rejected: { stageLabel: 'Rejected', approver: null, state: 'terminal' },
  cancelled: { stageLabel: 'Cancelled', approver: null, state: 'terminal' },
}

const FALLBACK_STAGE_INFO: PettyCashStageInfo = { stageLabel: 'Unknown', approver: null, state: 'terminal' }

export function getPettyCashStageInfo(status: string | null | undefined): PettyCashStageInfo {
  if (!status) return FALLBACK_STAGE_INFO
  return STAGE_INFO[status] ?? FALLBACK_STAGE_INFO
}

// Summary buckets shown as the counts row at the top of the board.
export const PETTY_CASH_STAGE_BUCKETS = ['EA Approval', 'MD Approval', 'Accounts', 'Completed', 'Rejected'] as const
export type PettyCashStageBucket = typeof PETTY_CASH_STAGE_BUCKETS[number]

export function getPettyCashStageBucket(status: string | null | undefined): PettyCashStageBucket | null {
  const info = getPettyCashStageInfo(status)
  if (info.state === 'pending') {
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
