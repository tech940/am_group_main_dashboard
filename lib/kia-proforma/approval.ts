// Two-stage sequential KIA proforma approval (client + server safe — no server-only).
//
// A generated proforma is approved in order:
//   1. Sales Manager OR General Manager  (the "approval" stage)
//   2. Finance Head OR Finance Team       (the "finance" stage) — finalises it
//
//   PENDING / '' / (legacy)      -> stage 1: Sales Manager / General Manager
//   MANAGER_APPROVED             -> stage 2: Finance Head / Finance Team
//   APPROVED                     -> fully approved (booking advances to allocation)
//   NOT APPROVED | …             -> declined (restarts from stage 1)

export type KiaApprovalStage =
  | 'approval'   // Sales Manager / General Manager
  | 'finance'    // Finance Head / Finance Team
  | 'approved'
  | 'declined'

/** Interim status written once the Sales Manager / GM approves — awaits Finance. */
export const KIA_MANAGER_APPROVED_STATUS = 'MANAGER_APPROVED'

/** Derive the current stage from the stored approvalStatus text. */
export function kiaApprovalStage(approvalStatus?: string | null): KiaApprovalStage {
  const s = String(approvalStatus || '').trim().toUpperCase()
  if (s === 'APPROVED') return 'approved'
  if (s.startsWith('NOT APPROVED') || s === 'DECLINED') return 'declined'
  if (s === KIA_MANAGER_APPROVED_STATUS) return 'finance'
  // Everything else — PENDING, '', and legacy FINANCE_APPROVED — is stage 1 (Sales Manager / GM).
  return 'approval'
}

/** The stage currently awaiting action (a declined proforma restarts from stage 1). */
export function pendingStageOf(approvalStatus?: string | null): KiaApprovalStage {
  const stage = kiaApprovalStage(approvalStatus)
  return stage === 'declined' ? 'approval' : stage
}

/**
 * Whether the given role may act on the given pending stage. Stage 1 is the Sales Manager /
 * General Manager; stage 2 is the Finance Head / Finance Team. MD / admins override any stage.
 */
export function roleActsOnKiaStage(role: string | null | undefined, stage: KiaApprovalStage): boolean {
  const r = String(role || '').trim().toLowerCase()
  if (r === 'admin' || r === 'developer' || r === 'md') return true
  if (stage === 'approval') return r === 'sales_manager' || r === 'general_manager'
  if (stage === 'finance') return r === 'finance_head' || r === 'finance_team'
  return false
}

/**
 * The approvalStatus to write after an approve at the given stage. Stage 1 (Sales Manager / GM)
 * hands off to Finance; stage 2 (Finance) finalises.
 */
export function nextApprovalStatusAfterApprove(stage: KiaApprovalStage): { status: string; finalized: boolean } {
  if (stage === 'approval') return { status: KIA_MANAGER_APPROVED_STATUS, finalized: false }
  return { status: 'APPROVED', finalized: true }
}

export const KIA_APPROVAL_STAGE_LABELS: Record<KiaApprovalStage, string> = {
  approval: 'Sales Manager / GM',
  finance: 'Finance',
  approved: 'Approved',
  declined: 'Not Approved',
}

/** Short label naming who acts at a pending stage. */
export function kiaStageActorLabel(stage: KiaApprovalStage): string {
  if (stage === 'approval') return 'Sales Manager / General Manager'
  if (stage === 'finance') return 'Finance Head / Finance Team'
  return ''
}
