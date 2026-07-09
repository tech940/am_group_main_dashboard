// Single-stage KIA proforma approval (client + server safe — no server-only).
//
// The Finance Head → Sales Manager → General Manager chain was collapsed into ONE shared
// approval stage. A generated proforma waits at that single stage; EITHER the Sales Manager
// OR the General Manager may approve it, and whoever acts first finalizes it.
//
//   PENDING / '' / (legacy FINANCE_APPROVED, MANAGER_APPROVED) -> the single approval stage
//   APPROVED                                                   -> fully approved (advances)
//   NOT APPROVED | …                                          -> declined (restarts the stage)

export type KiaApprovalStage =
  | 'approval'
  | 'approved'
  | 'declined'

/** Derive the current stage from the stored approvalStatus text. */
export function kiaApprovalStage(approvalStatus?: string | null): KiaApprovalStage {
  const s = String(approvalStatus || '').trim().toUpperCase()
  if (s === 'APPROVED') return 'approved'
  if (s.startsWith('NOT APPROVED') || s === 'DECLINED') return 'declined'
  // Everything else — PENDING, '', and legacy FINANCE_APPROVED / MANAGER_APPROVED from before
  // the chain was collapsed — is the single shared approval stage.
  return 'approval'
}

/** The pending stage a declined proforma restarts from. */
export function pendingStageOf(approvalStatus?: string | null): KiaApprovalStage {
  const stage = kiaApprovalStage(approvalStatus)
  return stage === 'declined' ? 'approval' : stage
}

/**
 * Whether the given role may act on the given pending stage. The single approval stage is
 * shared by the Sales Manager and the General Manager (MD / admins always override).
 */
export function roleActsOnKiaStage(role: string | null | undefined, stage: KiaApprovalStage): boolean {
  const r = String(role || '').trim().toLowerCase()
  if (r === 'admin' || r === 'developer' || r === 'md') return true
  if (stage === 'approval') return r === 'sales_manager' || r === 'general_manager'
  return false
}

/** The approvalStatus to write when the single approval stage is approved — always final. */
export function nextApprovalStatusAfterApprove(_stage: KiaApprovalStage): { status: string; finalized: boolean } {
  return { status: 'APPROVED', finalized: true }
}

export const KIA_APPROVAL_STAGE_LABELS: Record<KiaApprovalStage, string> = {
  approval: 'Approval',
  approved: 'Approved',
  declined: 'Not Approved',
}

/** Short label naming who acts at a pending stage. */
export function kiaStageActorLabel(stage: KiaApprovalStage): string {
  if (stage === 'approval') return 'Sales Manager / General Manager'
  return ''
}
