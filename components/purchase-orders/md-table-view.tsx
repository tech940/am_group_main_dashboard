'use client'

import { useCallback, useMemo, useState } from 'react'
import { Check, X, Pause, Trash2, RotateCcw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { RemarksDialog } from './remarks-dialog'
import { usePurchaseOrdersViewPreference } from '@/lib/hooks/use-user-preferences'
import { formatIndiaDateTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'

interface PurchaseOrder {
  id: string
  orderNumber?: string
  order_number?: string
  department?: string
  subDepartment?: string
  sub_department?: string
  requestedBy?: string
  requested_by?: string
  quantityRequired?: string
  quantity_required?: string
  estimateIfAny?: string
  estimate_if_any?: string
  vendorName?: string
  vendor_name?: string
  status: string
  createdAt?: string
  created_at?: string
  eaApprovalRemarks?: string
  ea_approval_remarks?: string
  mdApprovalRemarks?: string
  md_approval_remarks?: string
  specialInstructions?: string
  special_instructions?: string
  amount?: string
}

interface MDTableViewProps {
  orders: PurchaseOrder[]
  onApprove: (orderId: string, remarks?: string) => Promise<void>
  onDeny: (orderId: string, remarks?: string) => Promise<void>
  onHold: (orderId: string, remarks?: string) => Promise<void>
  onBulkAction: (action: 'approve' | 'deny' | 'hold', orderIds: string[], remarks?: string) => Promise<void>
  onOrderClick: (order: PurchaseOrder) => void
  canActOnOrder?: (order: PurchaseOrder) => boolean
  loading?: boolean
}

const ALL_COLUMNS = [
  { key: 'orderNumber', label: 'Order #', width: 'w-32' },
  { key: 'department', label: 'Department', width: 'w-40' },
  { key: 'subDepartment', label: 'Sub-Department', width: 'w-40' },
  { key: 'requestedBy', label: 'Requested By', width: 'w-48' },
  { key: 'specialInstructions', label: 'Instructions', width: 'w-64' },
  { key: 'quantityRequired', label: 'Quantity', width: 'w-24' },
  { key: 'estimateIfAny', label: 'Estimate', width: 'w-32' },
  { key: 'vendorName', label: 'Vendor', width: 'w-48' },
  { key: 'eaApprovalRemarks', label: 'EA Remarks', width: 'w-48' },
  { key: 'mdApprovalRemarks', label: 'MD Remarks', width: 'w-48' },
  { key: 'amount', label: 'Amount', width: 'w-32' },
  { key: 'createdAt', label: 'Created', width: 'w-40' },
  { key: 'status', label: 'Status', width: 'w-40' },
]

function getColumnValue(order: PurchaseOrder, key: string) {
  switch (key) {
    case 'orderNumber':
      return order.orderNumber || order.order_number
    case 'subDepartment':
      return order.subDepartment || order.sub_department
    case 'requestedBy':
      return order.requestedBy || order.requested_by
    case 'quantityRequired':
      return order.quantityRequired || order.quantity_required
    case 'estimateIfAny':
      return order.estimateIfAny || order.estimate_if_any
    case 'vendorName':
      return order.vendorName || order.vendor_name
    case 'specialInstructions':
      return order.specialInstructions || order.special_instructions
    case 'eaApprovalRemarks':
      return order.eaApprovalRemarks || order.ea_approval_remarks
    case 'mdApprovalRemarks':
      return order.mdApprovalRemarks || order.md_approval_remarks
    case 'createdAt':
      return order.createdAt || order.created_at
    default:
      return order[key as keyof PurchaseOrder]
  }
}

function hasRenderableValue(value: unknown) {
  return value !== null
    && value !== undefined
    && !(typeof value === 'string' && value.trim() === '')
    && !(Array.isArray(value) && value.length === 0)
}

function formatDate(dateString: string) {
  // Use the timezone-aware formatter from lib/date-time.ts
  const formatted = formatIndiaDateTime(dateString, {
    year: 'numeric',
    day: '2-digit',
    month: 'short',
  })
  return formatted || dateString
}

function formatCurrency(value: unknown) {
  if (!hasRenderableValue(value)) {
    return '-'
  }

  return `Rs. ${String(value)}`
}

function getStatusColor(status: string) {
  const colors: Record<string, string> = {
    awaiting_ea_approval: 'bg-violet-500',
    awaiting_md_approval: 'bg-indigo-500',
    ea_denied: 'bg-red-500',
    md_denied: 'bg-red-500',
    ea_on_hold: 'bg-amber-500',
    md_on_hold: 'bg-amber-500',
    awaiting_grn: 'bg-teal-500',
    awaiting_accounts: 'bg-emerald-500',
    completed: 'bg-green-600',
  }

  return colors[status] || 'bg-slate-500'
}

export function MDTableView({
  orders,
  onApprove,
  onDeny,
  onHold,
  onBulkAction,
  onOrderClick,
  canActOnOrder = () => true,
  loading = false,
}: MDTableViewProps) {
  const { value: preferences, savePreference } = usePurchaseOrdersViewPreference()
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [bulkActionLoading, setBulkActionLoading] = useState<'approve' | 'deny' | 'hold' | null>(null)
  const [remarksDialog, setRemarksDialog] = useState<{
    open: boolean
    type: 'approve' | 'deny' | 'hold'
    orderId: string | null
    bulkOrderIds: string[]
  }>({
    open: false,
    type: 'approve',
    orderId: null,
    bulkOrderIds: [],
  })

  const hiddenColumns = useMemo(() => preferences.hiddenColumns || [], [preferences.hiddenColumns])

  const visibleColumns = useMemo(() => (
    ALL_COLUMNS.filter((col) => {
      if (hiddenColumns.includes(col.key)) {
        return false
      }

      return orders.some((order) => hasRenderableValue(getColumnValue(order, col.key)))
    })
  ), [hiddenColumns, orders])

  const selectableOrders = useMemo(
    () => orders.filter((order) => canActOnOrder(order)),
    [canActOnOrder, orders]
  )

  const allSelected = selectableOrders.length > 0 && selectableOrders.every((order) => selectedOrders.has(order.id))
  const someSelected = selectableOrders.some((order) => selectedOrders.has(order.id)) && !allSelected

  const toggleColumnVisibility = useCallback(async (columnKey: string) => {
    const nextHiddenColumns = hiddenColumns.includes(columnKey)
      ? hiddenColumns.filter((key) => key !== columnKey)
      : [...hiddenColumns, columnKey]

    await savePreference({
      ...preferences,
      hiddenColumns: nextHiddenColumns,
    })
  }, [hiddenColumns, preferences, savePreference])

  const restoreAllColumns = useCallback(async () => {
    await savePreference({
      ...preferences,
      hiddenColumns: [],
    })
  }, [preferences, savePreference])

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedOrders(new Set())
      return
    }

    setSelectedOrders(new Set(selectableOrders.map((order) => order.id)))
  }, [allSelected, selectableOrders])

  const toggleSelection = useCallback((orderId: string) => {
    const order = orders.find((item) => item.id === orderId)
    if (!order || !canActOnOrder(order)) {
      return
    }

    setSelectedOrders((currentSelection) => {
      const nextSelection = new Set(currentSelection)
      if (nextSelection.has(orderId)) {
        nextSelection.delete(orderId)
      } else {
        nextSelection.add(orderId)
      }

      return nextSelection
    })
  }, [canActOnOrder, orders])

  const handleAction = useCallback(async (
    action: 'approve' | 'deny' | 'hold',
    orderId: string,
    remarks?: string
  ) => {
    setActionLoading(orderId)
    try {
      if (action === 'approve') {
        await onApprove(orderId, remarks)
      } else if (action === 'deny') {
        await onDeny(orderId, remarks)
      } else {
        await onHold(orderId, remarks)
      }

      setRemarksDialog({ open: false, type: 'approve', orderId: null, bulkOrderIds: [] })
      setSelectedOrders((currentSelection) => {
        const nextSelection = new Set(currentSelection)
        nextSelection.delete(orderId)
        return nextSelection
      })
    } catch (error) {
      console.error(`Error ${action}ing order:`, error)
    } finally {
      setActionLoading(null)
    }
  }, [onApprove, onDeny, onHold])

  const handleBulkAction = useCallback(async (action: 'approve' | 'deny' | 'hold') => {
    const selectedActionableOrderIds = Array.from(selectedOrders).filter((orderId) =>
      selectableOrders.some((order) => order.id === orderId)
    )

    if (selectedActionableOrderIds.length === 0) {
      return
    }

    if (action === 'deny' || action === 'hold') {
      setRemarksDialog({ open: true, type: action, orderId: null, bulkOrderIds: selectedActionableOrderIds })
      return
    }

    setBulkActionLoading(action)
    try {
      await onBulkAction(action, selectedActionableOrderIds, '')
      setSelectedOrders(new Set())
    } catch (error) {
      console.error(`Error bulk ${action}ing orders:`, error)
    } finally {
      setBulkActionLoading(null)
    }
  }, [onBulkAction, selectableOrders, selectedOrders])

  const openRemarksDialog = useCallback((type: 'approve' | 'deny' | 'hold', orderId: string) => {
    setRemarksDialog({ open: true, type, orderId, bulkOrderIds: [] })
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={restoreAllColumns}
            className="gap-2"
            disabled={hiddenColumns.length === 0}
          >
            <RotateCcw className="h-4 w-4" />
            Restore Columns
          </Button>
        </div>

        {selectedOrders.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">
              {selectedOrders.size} selected
            </span>
            <Button
              onClick={() => void handleBulkAction('approve')}
              disabled={bulkActionLoading !== null || loading}
              className="gap-2 bg-gradient-to-r from-green-500 to-green-600 text-white"
            >
              {bulkActionLoading === 'approve' || loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Approving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Approve Selected ({selectedOrders.size})
                </>
              )}
            </Button>
            <Button
              onClick={() => void handleBulkAction('hold')}
              disabled={bulkActionLoading !== null || loading}
              className="gap-2 bg-amber-500 text-white hover:bg-amber-600"
            >
              {bulkActionLoading === 'hold' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Holding...
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4" />
                  Hold Selected ({selectedOrders.size})
                </>
              )}
            </Button>
            <Button
              onClick={() => void handleBulkAction('deny')}
              disabled={bulkActionLoading !== null || loading}
              variant="destructive"
              className="gap-2"
            >
              {bulkActionLoading === 'deny' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Denying...
                </>
              ) : (
                <>
                  <X className="h-4 w-4" />
                  Deny Selected ({selectedOrders.size})
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      <div className="relative overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-teal-800 bg-teal-700">
            <tr>
              <th className="sticky left-0 z-20 bg-teal-800 px-4 py-3 text-left">
                <Checkbox
                  checked={allSelected || (someSelected ? 'indeterminate' : false)}
                  disabled={selectableOrders.length === 0}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                  className="border-white/60 bg-teal-900 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-teal-700"
                />
              </th>

              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className={cn('px-4 py-3 text-left text-[12px] font-semibold text-white', col.width)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{col.label}</span>
                    <button
                      type="button"
                      onClick={() => toggleColumnVisibility(col.key)}
                      className="rounded-md bg-slate-200 p-1 text-slate-600 shadow-sm transition-colors hover:bg-slate-300 hover:text-slate-900"
                      title="Hide column"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </th>
              ))}

              <th className="sticky right-0 z-20 w-48 border-l border-teal-500 bg-teal-800 px-4 py-3 text-center text-[12px] font-semibold text-white">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 2}
                  className="px-4 py-12 text-center text-slate-500"
                >
                  No orders found
                </td>
              </tr>
            ) : (
              orders.map((order) => {
                const isSelected = selectedOrders.has(order.id)
                const isActionable = canActOnOrder(order)
                const isLoading = actionLoading === order.id

                return (
                  <tr
                    key={order.id}
                    className={cn(
                      'group border-b border-slate-100 transition-colors hover:bg-slate-50',
                      isSelected && 'bg-indigo-50'
                    )}
                  >
                    <td className="sticky left-0 z-10 bg-teal-50 px-4 py-3 group-hover:bg-teal-100">
                      <Checkbox
                        checked={isSelected}
                        disabled={!isActionable}
                        onCheckedChange={() => toggleSelection(order.id)}
                        aria-label={`Select order ${getColumnValue(order, 'orderNumber') || order.id}`}
                      />
                    </td>

                    {visibleColumns.map((col) => {
                      const value = getColumnValue(order, col.key)

                      return (
                        <td
                          key={col.key}
                          className="px-4 py-3 text-slate-700"
                          onClick={() => onOrderClick(order)}
                        >
                          {col.key === 'status' ? (
                            <div className="flex justify-center">
                              <Badge className={cn('min-w-36 justify-center text-center text-white', getStatusColor(String(value || '')))}>
                                {String(value || '').replace(/_/g, ' ').toUpperCase()}
                              </Badge>
                            </div>
                          ) : col.key === 'createdAt' ? (
                            value ? formatDate(String(value)) : '-'
                          ) : col.key === 'estimateIfAny' || col.key === 'amount' ? (
                            formatCurrency(value)
                          ) : (
                            <span className="line-clamp-2">{hasRenderableValue(value) ? String(value) : '-'}</span>
                          )}
                        </td>
                      )
                    })}

                    <td className="sticky right-0 z-10 border-l border-teal-100 bg-teal-50 px-4 py-3 group-hover:bg-teal-100">
                      {isActionable ? (
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => void handleAction('approve', order.id)}
                            disabled={isLoading || bulkActionLoading !== null || loading}
                            className="bg-gradient-to-r from-green-500 to-green-600 text-white hover:from-green-600 hover:to-green-700"
                            title="Approve"
                          >
                            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => openRemarksDialog('deny', order.id)}
                            disabled={isLoading || bulkActionLoading !== null || loading}
                            title="Deny"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openRemarksDialog('hold', order.id)}
                            disabled={isLoading || bulkActionLoading !== null || loading}
                            className="border-amber-500 text-amber-600 hover:bg-amber-50"
                            title="Hold"
                          >
                            <Pause className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <span className="block text-center text-xs font-medium text-slate-400">No actions</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <RemarksDialog
        open={remarksDialog.open}
        onOpenChange={(open) => setRemarksDialog((current) => ({ ...current, open }))}
        title={
          remarksDialog.type === 'approve'
            ? 'Approve Order'
            : remarksDialog.type === 'deny'
              ? 'Deny Order'
              : 'Hold Order'
        }
        description={
          remarksDialog.type === 'approve'
            ? 'Add optional remarks for approval'
            : remarksDialog.type === 'deny'
              ? 'Add optional remarks for denial'
              : 'Add optional remarks for holding this order'
        }
        actionLabel={
          remarksDialog.type === 'approve'
            ? 'Approve'
            : remarksDialog.type === 'deny'
              ? 'Deny'
              : 'Hold'
        }
        actionVariant={remarksDialog.type === 'deny' ? 'destructive' : 'default'}
        onConfirm={(remarks) =>
          remarksDialog.bulkOrderIds.length > 0
            ? (async () => {
                setBulkActionLoading(remarksDialog.type)
                try {
                  await onBulkAction(remarksDialog.type, remarksDialog.bulkOrderIds, remarks)
                  setSelectedOrders(new Set())
                  setRemarksDialog({ open: false, type: 'approve', orderId: null, bulkOrderIds: [] })
                } finally {
                  setBulkActionLoading(null)
                }
              })()
            : remarksDialog.orderId
              ? handleAction(remarksDialog.type, remarksDialog.orderId, remarks)
              : Promise.resolve()
        }
        loading={actionLoading !== null || bulkActionLoading !== null}
        remarksRequired={false}
      />
    </div>
  )
}
