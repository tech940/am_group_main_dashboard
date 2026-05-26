'use client'

import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { CheckCircle, XCircle, PauseCircle, Loader2, Eye, CheckCheck, XOctagon } from 'lucide-react'
import { WorkflowStatusCard } from '@/components/purchase-orders/workflow-status-card'
import { RemarksDialog } from '@/components/purchase-orders/remarks-dialog'
import { formatWorkflowStageLabel, getWorkflowStatusPresentation } from '@/components/purchase-orders/workflow-card-theme'
import { formatIndiaDateTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'

interface PurchaseOrder {
  id: string
  order_number?: string
  orderNumber?: string
  department?: string
  sub_department?: string
  subDepartment?: string
  requested_by?: string
  requestedBy?: string
  special_instructions?: string
  specialInstructions?: string
  quantity_required?: string
  quantityRequired?: string
  estimate_if_any?: string
  estimateIfAny?: string
  vendor_name?: string
  vendorName?: string
  current_stage?: string
  currentStage?: string
  status: string
  created_at?: string
  createdAt?: string
}

interface Personnel {
  createdBy: string
  createdByEmail: string | null
  purchaseManager: string | null
  purchaseManagerEmail: string | null
  eaApprover: string | null
  eaApproverEmail: string | null
  mdApprover: string | null
  mdApproverEmail: string | null
}

interface MDGridViewProps {
  orders: PurchaseOrder[]
  personnel: Map<string, Personnel>
  onApprove: (orderId: string, remarks?: string) => Promise<void>
  onDeny: (orderId: string, remarks?: string) => Promise<void>
  onHold?: (orderId: string, remarks?: string) => Promise<void>
  onBulkAction?: (action: 'approve' | 'deny' | 'hold', orderIds: string[], remarks?: string) => Promise<void>
  onViewDetails: (order: PurchaseOrder) => Promise<void>
  canActOnOrder?: (order: PurchaseOrder) => boolean
  dashboardTitle?: string
  dashboardSubtitle?: string
  pendingStatus?: string
  approveAllLabel?: string
  denyAllLabel?: string
  showHeader?: boolean
  reviewerLabel?: string
  emptyMessage?: string
  rejectedStatus?: string
  holdStatus?: string
  isLoading?: boolean
}

export function MDGridView({
  orders,
  personnel,
  onApprove,
  onDeny,
  onHold,
  onBulkAction,
  onViewDetails,
  canActOnOrder,
  dashboardTitle = 'Approval Dashboard',
  dashboardSubtitle,
  pendingStatus = 'awaiting_md_approval',
  approveAllLabel = 'Approve All',
  showHeader = true,
  reviewerLabel = 'Previous Review',
  emptyMessage = 'No purchase orders pending your approval',
  rejectedStatus = 'md_denied',
  holdStatus = 'md_on_hold',
  isLoading
}: MDGridViewProps) {
  const [processingOrders, setProcessingOrders] = useState<Set<string>>(new Set())
  const [loadingDetailsId, setLoadingDetailsId] = useState<string | null>(null)
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [bulkActionLoading, setBulkActionLoading] = useState<'approve' | 'deny' | 'hold' | null>(null)
  const [remarksDialog, setRemarksDialog] = useState<{
    open: boolean
    type: 'deny' | 'hold'
    orderId: string | null
    bulkOrderIds: string[]
  }>({
    open: false,
    type: 'deny',
    orderId: null,
    bulkOrderIds: [],
  })

  const pendingOrders = orders.filter(order => order.status === pendingStatus)
  const isOrderActionable = useCallback((order: PurchaseOrder) => (
    canActOnOrder ? canActOnOrder(order) : [pendingStatus, rejectedStatus, holdStatus].includes(order.status || '')
  ), [canActOnOrder, pendingStatus, rejectedStatus, holdStatus])
  const actionableOrders = useMemo(
    () => orders.filter((order) => isOrderActionable(order)),
    [orders, isOrderActionable]
  )
  const selectedActionableOrderIds = useMemo(
    () => Array.from(selectedOrders).filter((orderId) => actionableOrders.some((order) => order.id === orderId)),
    [actionableOrders, selectedOrders]
  )
  const allSelected = actionableOrders.length > 0 && actionableOrders.every((order) => selectedOrders.has(order.id))

  const handleApprove = async (orderId: string) => {
    setProcessingOrders(prev => new Set(prev).add(orderId))
    try {
      await onApprove(orderId)
    } finally {
      setProcessingOrders(prev => {
        const next = new Set(prev)
        next.delete(orderId)
        return next
      })
    }
  }

  const handleDeny = async (orderId: string) => {
    setRemarksDialog({ open: true, type: 'deny', orderId, bulkOrderIds: [] })
  }

  const handleHold = async (orderId: string) => {
    if (!onHold) {
      return
    }

    setRemarksDialog({ open: true, type: 'hold', orderId, bulkOrderIds: [] })
  }

  const handleRemarksConfirm = async (remarks: string) => {
    if (remarksDialog.bulkOrderIds.length > 0 && onBulkAction) {
      setBulkActionLoading(remarksDialog.type)
      try {
        await onBulkAction(remarksDialog.type, remarksDialog.bulkOrderIds, remarks.trim())
        setSelectedOrders(new Set())
        setRemarksDialog({ open: false, type: 'deny', orderId: null, bulkOrderIds: [] })
      } finally {
        setBulkActionLoading(null)
      }
      return
    }

    if (!remarksDialog.orderId) {
      return
    }

    setProcessingOrders(prev => new Set(prev).add(remarksDialog.orderId as string))
    try {
      if (remarksDialog.type === 'deny') {
        await onDeny(remarksDialog.orderId, remarks.trim())
      } else if (onHold) {
        await onHold(remarksDialog.orderId, remarks.trim())
      }
      setSelectedOrders((currentSelection) => {
        const next = new Set(currentSelection)
        if (remarksDialog.orderId) {
          next.delete(remarksDialog.orderId)
        }
        return next
      })
      setRemarksDialog({ open: false, type: 'deny', orderId: null, bulkOrderIds: [] })
    } finally {
      setProcessingOrders(prev => {
        const next = new Set(prev)
        if (remarksDialog.orderId) {
          next.delete(remarksDialog.orderId)
        }
        return next
      })
    }
  }

  const toggleSelection = (orderId: string) => {
    setSelectedOrders((currentSelection) => {
      const next = new Set(currentSelection)
      if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedOrders(new Set())
      return
    }

    setSelectedOrders(new Set(actionableOrders.map((order) => order.id)))
  }

  const handleBulkAction = async (action: 'approve' | 'deny' | 'hold') => {
    if (!onBulkAction || selectedActionableOrderIds.length === 0) {
      return
    }

    if (action === 'deny' || action === 'hold') {
      setRemarksDialog({
        open: true,
        type: action,
        orderId: null,
        bulkOrderIds: selectedActionableOrderIds,
      })
      return
    }

    setBulkActionLoading(action)
    try {
      await onBulkAction(action, selectedActionableOrderIds, '')
      setSelectedOrders(new Set())
    } finally {
      setBulkActionLoading(null)
    }
  }

  const handleViewDetails = async (order: PurchaseOrder) => {
    setLoadingDetailsId(order.id)
    try {
      await onViewDetails(order)
    } finally {
      setLoadingDetailsId(null)
    }
  }

  const formatDateTime = (dateString: string) => {
    return formatIndiaDateTime(dateString, {
      year: 'numeric',
    }) || 'Just now'
  }

  const bulkControls = selectedActionableOrderIds.length > 0 ? (
    <div className="flex flex-wrap justify-end gap-3">
      <Button
        onClick={() => void handleBulkAction('approve')}
        disabled={isLoading || bulkActionLoading !== null}
        className="rounded-2xl bg-white text-emerald-800 hover:bg-emerald-50"
      >
        {bulkActionLoading === 'approve' ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <CheckCheck className="mr-2 h-5 w-5" />
            {approveAllLabel}
          </>
        )}
      </Button>
      <Button
        onClick={() => void handleBulkAction('hold')}
        disabled={isLoading || bulkActionLoading !== null || !onHold}
        className="rounded-2xl bg-amber-500 text-white hover:bg-amber-600"
      >
        {bulkActionLoading === 'hold' ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <PauseCircle className="mr-2 h-5 w-5" />}
        Hold Selected
      </Button>
      <Button
        onClick={() => void handleBulkAction('deny')}
        disabled={isLoading || bulkActionLoading !== null}
        className="rounded-2xl bg-rose-500 text-white hover:bg-rose-600"
      >
        {bulkActionLoading === 'deny' ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <XOctagon className="mr-2 h-5 w-5" />}
        Deny Selected
      </Button>
    </div>
  ) : pendingOrders.length > 0 ? (
    <div className="flex flex-wrap justify-end gap-3">
      <Button
        type="button"
        onClick={toggleSelectAll}
        disabled={isLoading || actionableOrders.length === 0}
        className="rounded-2xl bg-white text-emerald-800 hover:bg-emerald-50"
      >
        <CheckCheck className="mr-2 h-5 w-5" />
        Select All
      </Button>
    </div>
  ) : null

  return (
    <div className="space-y-6">
      {showHeader ? (
        <div className="flex items-center justify-between rounded-[28px] bg-gradient-to-r from-teal-700 to-emerald-700 p-6 text-white shadow-xl">
          <div>
            <h2 className="text-3xl font-black">{dashboardTitle}</h2>
            <p className="mt-1 text-teal-100">
              {dashboardSubtitle || `${pendingOrders.length} purchase order${pendingOrders.length !== 1 ? 's' : ''} awaiting your approval`}
            </p>
          </div>
          {bulkControls}
        </div>
      ) : bulkControls ? (
        <div className="flex justify-end rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="[&_.bg-white]:border [&_.bg-white]:border-emerald-200 [&_.bg-white]:bg-emerald-50 [&_.bg-white]:text-emerald-800">
            {bulkControls}
          </div>
        </div>
      ) : null}

      {orders.length === 0 ? (
        <Card className="rounded-[28px] border-none shadow-xl">
          <CardContent className="p-12 text-center">
            <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-500" />
            <h3 className="mb-2 text-xl font-semibold text-gray-700">All Caught Up!</h3>
            <p className="text-gray-500">{emptyMessage}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {orders.map((order) => {
            const orderPersonnel = personnel.get(order.id)
            const requestedBy = order.requested_by || order.requestedBy || 'Not specified'
            const vendorName = order.vendor_name || order.vendorName || 'Awaiting vendor details'
            const status = getWorkflowStatusPresentation(order.status || '')
            const isProcessing = processingOrders.has(order.id)
            const isLoadingDetails = loadingDetailsId === order.id
            const isActionable = isOrderActionable(order)
            const isSelected = selectedOrders.has(order.id)

            return (
              <WorkflowStatusCard
                key={order.id}
                orderNumber={order.order_number || order.orderNumber || 'N/A'}
                statusLabel={status.label}
                stageLabel={formatWorkflowStageLabel(order.current_stage || order.currentStage)}
                description={order.special_instructions || order.specialInstructions || vendorName}
                departmentLine={`${order.department || 'Department'}${(order.sub_department || order.subDepartment) ? ` - ${order.sub_department || order.subDepartment}` : ''}`}
                timestampLabel={formatDateTime(order.created_at || order.createdAt || '')}
                headerAction={(
                  <div className="flex items-center gap-2">
                    {isActionable && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelection(order.id)}
                        aria-label={`Select order ${order.order_number || order.orderNumber || order.id}`}
                        className="border-slate-300 bg-white text-white shadow-sm data-[state=checked]:border-teal-700 data-[state=checked]:bg-teal-700 data-[state=checked]:text-white"
                      />
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={() => void handleViewDetails(order)}
                      disabled={isLoadingDetails}
                      className="h-9 w-9 rounded-2xl border border-slate-200 bg-white/80 text-slate-700 shadow-sm hover:bg-white hover:text-teal-700"
                      title="View details"
                    >
                      {isLoadingDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
                tone={status.tone}
                onClick={() => void handleViewDetails(order)}
                metrics={[
                  {
                    label: 'Quantity',
                    value: order.quantity_required || order.quantityRequired || 'N/A',
                    icon: 'quantity',
                  },
                  {
                    label: 'Requested By',
                    value: requestedBy,
                    icon: 'requester',
                  },
                  {
                    label: 'Vendor',
                    value: vendorName,
                    icon: 'assignee',
                  },
                  {
                    label: reviewerLabel,
                    value: pendingStatus === 'awaiting_ea_approval'
                      ? orderPersonnel?.purchaseManager || 'Purchase Manager'
                      : orderPersonnel?.eaApprover || 'Awaiting EA action',
                    icon: 'time',
                  },
                ]}
                actions={(
                  <div className={cn('grid gap-2', isActionable ? 'grid-cols-3' : 'grid-cols-1')}>
                    {isActionable && (
                      <>
                        <Button
                          onClick={() => void handleApprove(order.id)}
                          disabled={isProcessing}
                          className="rounded-2xl bg-white text-emerald-800 hover:bg-emerald-50"
                        >
                          {isProcessing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle className="mr-1 h-4 w-4" />
                              Approve
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={() => void handleHold(order.id)}
                          disabled={isProcessing || !onHold}
                          className="rounded-2xl bg-amber-500 text-white hover:bg-amber-600"
                        >
                          <PauseCircle className="mr-1 h-4 w-4" />
                          Hold
                        </Button>
                        <Button
                          onClick={() => void handleDeny(order.id)}
                          disabled={isProcessing}
                          className="rounded-2xl bg-rose-500 text-white hover:bg-rose-600"
                        >
                          <XCircle className="mr-1 h-4 w-4" />
                          Deny
                        </Button>
                      </>
                    )}
                  </div>
                )}
              />
            )
          })}
        </div>
      )}
      <RemarksDialog
        open={remarksDialog.open}
        onOpenChange={(open) => setRemarksDialog((current) => ({ ...current, open }))}
        title={remarksDialog.type === 'deny' ? 'Deny Order' : 'Hold Order'}
        description={
          remarksDialog.type === 'deny'
            ? 'Add optional remarks for denial'
            : 'Add optional remarks for holding this order'
        }
        actionLabel={remarksDialog.type === 'deny' ? 'Deny' : 'Hold'}
        actionVariant={remarksDialog.type === 'deny' ? 'destructive' : 'default'}
        onConfirm={handleRemarksConfirm}
        loading={bulkActionLoading !== null || processingOrders.size > 0}
        remarksRequired={false}
      />
    </div>
  )
}

// Made with Bob
