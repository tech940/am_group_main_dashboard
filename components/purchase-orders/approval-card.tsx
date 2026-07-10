'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { CheckCircle, Loader2, MessageSquare, XCircle } from 'lucide-react'
import { WorkflowStatusCard } from '@/components/purchase-orders/workflow-status-card'
import { formatWorkflowStageLabel, getWorkflowStatusPresentation } from '@/components/purchase-orders/workflow-card-theme'
import { formatIndiaDateTime } from '@/lib/date-time'

interface PurchaseOrder {
  id: string
  order_number: string
  status: string
  current_stage: string
  department?: string
  sub_department?: string
  requested_by?: string
  special_instructions?: string
  quantity_required?: string
  vendor_name?: string
  amount?: string
  ea_approval?: string
  ea_remarks?: string
  management_approval?: string
  management_remarks?: string
  created_at: string
}

interface ApprovalCardProps {
  order: PurchaseOrder
  userRole: 'ea' | 'management' | 'viewer'
  onApprove: (orderId: string, remarks: string) => Promise<void>
  onReject: (orderId: string, remarks: string) => Promise<void>
}

export function ApprovalCard({ order, userRole, onApprove, onReject }: ApprovalCardProps) {
  const [remarks, setRemarks] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const canApprove = () => {
    if (userRole === 'ea' && (!order.ea_approval || order.ea_approval === 'pending')) {
      return true
    }

    if (userRole === 'management' && order.ea_approval === 'approved' && (!order.management_approval || order.management_approval === 'pending')) {
      return true
    }

    return false
  }

  const handleApprove = async () => {
    setIsLoading(true)
    try {
      await onApprove(order.id, remarks)
      setRemarks('')
    } finally {
      setIsLoading(false)
    }
  }

  const handleReject = async () => {
    if (!remarks.trim()) {
      alert('Please provide remarks for rejection')
      return
    }

    setIsLoading(true)
    try {
      await onReject(order.id, remarks)
      setRemarks('')
    } finally {
      setIsLoading(false)
    }
  }

  const status = getWorkflowStatusPresentation(order.status)
  const timestampLabel = formatIndiaDateTime(order.created_at, {
    year: 'numeric',
  })

  return (
    <WorkflowStatusCard
      orderNumber={order.order_number}
      statusLabel={status.label}
      stageLabel={formatWorkflowStageLabel(order.current_stage)}
      description={order.special_instructions || order.vendor_name || 'Approval review pending'}
      departmentLine={`${order.department || 'Department'}${order.sub_department ? ` - ${order.sub_department}` : ''}`}
      timestampLabel={timestampLabel}
      tone={status.tone}
      metrics={[
        {
          label: 'Requested By',
          value: order.requested_by || 'Not specified',
          icon: 'requester',
        },
        {
          label: 'Vendor',
          value: order.vendor_name || 'Awaiting vendor details',
          icon: 'assignee',
        },
        {
          label: 'Quantity',
          value: order.quantity_required || 'N/A',
          icon: 'quantity',
        },
        {
          label: 'Estimate',
          value: order.amount ? `Rs ${parseFloat(order.amount).toLocaleString('en-IN')}` : 'Not shared',
          icon: 'time',
        },
      ]}
      actions={(
        <div className="space-y-3">
          {(order.ea_remarks || order.management_remarks) && (
            <div className="rounded-2xl border border-slate-200 bg-white/75 p-3 text-sm text-slate-700 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                <MessageSquare className="h-3.5 w-3.5" />
                Latest remarks
              </div>
              {order.management_remarks || order.ea_remarks}
            </div>
          )}

          {canApprove() && (
            <>
              <Textarea
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Enter remarks. Optional for approval, required for rejection."
                className="min-h-24 rounded-2xl border-slate-200 bg-white/80 text-slate-900 placeholder:text-slate-400 focus-visible:ring-[#023468]/30"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="ghost"
                  onClick={() => void handleApprove()}
                  disabled={isLoading}
                  className="rounded-2xl bg-white border border-slate-200 text-[#012348] hover:bg-[#edf4fb] shadow-sm"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Approve
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleReject()}
                  disabled={isLoading}
                  className="rounded-2xl shadow-sm"
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    />
  )
}

// Made with Bob
