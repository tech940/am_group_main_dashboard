type CardTone = 'sky' | 'amber' | 'violet' | 'indigo' | 'teal' | 'emerald' | 'rose' | 'slate'

interface WorkflowStatusPresentation {
  label: string
  tone: CardTone
}

const statusPresentation: Record<string, WorkflowStatusPresentation> = {
  submitted: { label: 'Order Submitted', tone: 'sky' },
  vendor_info_pending: { label: 'Vendor Info Pending', tone: 'amber' },
  awaiting_ea_approval: { label: 'EA Approval Pending', tone: 'violet' },
  awaiting_md_approval: { label: 'MD Approval Pending', tone: 'indigo' },
  ea_denied: { label: 'Denied by EA', tone: 'rose' },
  md_denied: { label: 'Denied by MD', tone: 'rose' },
  ea_on_hold: { label: 'On Hold by EA', tone: 'amber' },
  md_on_hold: { label: 'On Hold by MD', tone: 'amber' },
  awaiting_grn: { label: 'GRN Pending', tone: 'teal' },
  awaiting_accounts: { label: 'GRN Completed', tone: 'amber' },
  completed: { label: 'Fully Completed', tone: 'emerald' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}

export function getWorkflowStatusPresentation(status: string) {
  return statusPresentation[status] || {
    label: status.replace(/_/g, ' '),
    tone: 'slate' as const,
  }
}

export function formatWorkflowStageLabel(stage: string | null | undefined) {
  if (!stage) {
    return 'Workflow Update'
  }

  return stage.replace(/_/g, ' ')
}
