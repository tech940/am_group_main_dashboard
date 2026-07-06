// Sequential KIA proforma approval chain (client + server safe — no server-only).
//
//   PENDING / ''      -> Finance Head reviews (verifies discount fields)
//   FINANCE_APPROVED  -> Sales Manager approves / declines
//   MANAGER_APPROVED  -> General Manager approves / declines
//   APPROVED          -> fully approved (PDF generated, booking advances)
//   NOT APPROVED | …  -> declined at some stage (re-enters Finance Head queue)

export type KiaApprovalStage =
  | 'finance_head'
  | 'sales_manager'
  | 'general_manager'
  | 'approved'
  | 'declined'

/** Derive the current stage from the stored approvalStatus text. */
export function kiaApprovalStage(approvalStatus?: string | null): KiaApprovalStage {
  const s = String(approvalStatus || '').trim().toUpperCase()
  if (s === 'APPROVED') return 'approved'
  if (s.startsWith('NOT APPROVED') || s === 'DECLINED') return 'declined'
  if (s === 'MANAGER_APPROVED') return 'general_manager'
  if (s === 'FINANCE_APPROVED') return 'sales_manager'
  return 'finance_head' // PENDING, '', or any legacy value
}

/** The pending stage a declined proforma restarts from. */
export function pendingStageOf(approvalStatus?: string | null): KiaApprovalStage {
  const stage = kiaApprovalStage(approvalStatus)
  return stage === 'declined' ? 'finance_head' : stage
}

/** Whether the given role may act on the given pending stage. MD/admins override. */
export function roleActsOnKiaStage(role: string | null | undefined, stage: KiaApprovalStage): boolean {
  const r = String(role || '').trim().toLowerCase()
  if (r === 'admin' || r === 'super_admin' || r === 'md') return true
  if (stage === 'finance_head') return r === 'finance_head'
  if (stage === 'sales_manager') return r === 'sales_manager'
  if (stage === 'general_manager') return r === 'general_manager'
  return false
}

/** The approvalStatus to write when the current stage is approved. */
export function nextApprovalStatusAfterApprove(stage: KiaApprovalStage): { status: string; finalized: boolean } {
  if (stage === 'finance_head') return { status: 'FINANCE_APPROVED', finalized: false }
  if (stage === 'sales_manager') return { status: 'MANAGER_APPROVED', finalized: false }
  return { status: 'APPROVED', finalized: true } // general_manager (or override at final)
}

export const KIA_APPROVAL_STAGE_LABELS: Record<KiaApprovalStage, string> = {
  finance_head: 'Finance Head Review',
  sales_manager: 'Sales Manager Review',
  general_manager: 'General Manager Review',
  approved: 'Approved',
  declined: 'Not Approved',
}

/** Short label naming who acts next at a pending stage. */
export function kiaStageActorLabel(stage: KiaApprovalStage): string {
  if (stage === 'finance_head') return 'Finance Head'
  if (stage === 'sales_manager') return 'Sales Manager'
  if (stage === 'general_manager') return 'General Manager'
  return ''
}
