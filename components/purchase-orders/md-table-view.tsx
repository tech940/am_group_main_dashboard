'use client'

import { useCallback, useMemo, useState } from 'react'
import { Check, X, Pause, Trash2, RotateCcw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { RemarksDialog } from './remarks-dialog'
import {
  PurchaseOrderImagePreviewButton,
  getPurchaseOrderTransactionLabel,
  type PurchaseOrderDocumentSource,
} from './order-image-preview-button'
import { usePurchaseOrdersViewPreference } from '@/lib/hooks/use-user-preferences'
import { formatIndiaDateTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'

interface PurchaseOrder extends PurchaseOrderDocumentSource {
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

const APPROVAL_TABLE_HIDDEN_COLUMNS = new Set(['orderNumber', 'subDepartment', 'createdAt', 'status'])

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

function getNumericAmount(value: unknown) {
  if (!hasRenderableValue(value)) return 0
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function getAmountTone(value: unknown) {
  const amount = getNumericAmount(value)
  if (amount >= 50000) return 'border-rose-200 bg-rose-50 text-rose-700'
  if (amount >= 10000) return 'border-amber-200 bg-amber-50 text-amber-700'
  if (amount > 0) return 'border-[#b9ccde] bg-[#edf4fb] text-[#023468]'
  return 'border-slate-200 bg-slate-50 text-slate-500'
}

function getStatusColor(status: string) {
  const colors: Record<string, string> = {
    awaiting_ea_approval: 'bg-violet-500',
    awaiting_md_approval: 'bg-indigo-500',
    ea_denied: 'bg-red-500',
    md_denied: 'bg-red-500',
    ea_on_hold: 'bg-amber-500',
    md_on_hold: 'bg-amber-500',
    awaiting_grn: 'bg-[#023468]',
    awaiting_accounts: 'bg-amber-500',
    completed: 'bg-[#023468]',
  }

  return colors[status] || 'bg-slate-500'
}

function formatStatusLabel(status: string) {
  if (status === 'awaiting_accounts') return 'GRN COMPLETED'
  if (status === 'completed') return 'FULLY COMPLETED'
  return status.replace(/_/g, ' ').toUpperCase()
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
      if (APPROVAL_TABLE_HIDDEN_COLUMNS.has(col.key)) {
        return false
      }

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
      <div className="flex flex-col gap-4 rounded-2xl border border-[var(--dashboard-primary-border)] bg-white/75 p-4 shadow-xl shadow-[color-mix(in_srgb,var(--dashboard-primary)_10%,transparent)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={restoreAllColumns}
            className="app-outline-action gap-2 rounded-xl text-xs font-black shadow-sm"
            disabled={hiddenColumns.length === 0}
          >
            <RotateCcw className="h-4 w-4" />
            Restore Columns
          </Button>
        </div>

        {selectedOrders.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] px-3 py-1 text-xs font-black text-[var(--dashboard-action-bg)]">
              {selectedOrders.size} selected
            </span>
            <Button
              onClick={() => void handleBulkAction('approve')}
              disabled={bulkActionLoading !== null || loading}
              className="app-primary-action gap-2 rounded-xl text-xs font-black shadow-lg"
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
              variant="ghost"
              className="gap-2 rounded-xl bg-amber-500 text-xs font-black text-white shadow-lg shadow-amber-100 hover:bg-amber-600"
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
              className="gap-2 rounded-xl text-xs font-black shadow-lg shadow-rose-100"
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

      <div className="relative overflow-x-auto rounded-[1.5rem] border border-white/70 bg-white/80 shadow-2xl shadow-[#023468]/10 backdrop-blur-xl">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20">
            <tr>
              {visibleColumns.map((col, columnIndex) => (
                <th
                  key={col.key}
                  className={cn(
                    'border-b border-white/10 bg-[var(--dashboard-action-bg)] px-3 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em] text-[var(--dashboard-action-fg)]',
                    columnIndex === 0 && 'rounded-tl-[1.35rem]',
                    col.width
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{col.label}</span>
                    <button
                      type="button"
                      onClick={() => toggleColumnVisibility(col.key)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-white/40 bg-white/85 text-slate-500 shadow-sm transition-colors hover:bg-white hover:text-rose-600"
                      title="Hide column"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </th>
              ))}

              <th className="sticky right-0 z-30 w-56 rounded-tr-[1.35rem] border-b border-l border-white/20 bg-[var(--dashboard-action-bg)] px-3 py-3 text-center text-[10px] font-black uppercase tracking-[0.14em] text-[var(--dashboard-action-fg)] shadow-[-12px_0_24px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-center gap-2">
                  <span>Actions</span>
                  <Checkbox
                    checked={allSelected || (someSelected ? 'indeterminate' : false)}
                    disabled={selectableOrders.length === 0}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                    className="approval-table-checkbox h-5 w-5 rounded-md border-2 border-white bg-white/20 shadow-sm data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-[var(--dashboard-action-bg)]"
                  />
                </div>
              </th>
            </tr>
          </thead>

          <tbody className="[&_tr:last-child_td:first-child]:rounded-bl-[1.35rem] [&_tr:last-child_td:last-child]:rounded-br-[1.35rem]">
            {orders.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="bg-white/80 px-4 py-12 text-center text-sm font-bold text-slate-500"
                >
                  No orders found
                </td>
              </tr>
            ) : (
              orders.map((order) => {
                const isSelected = selectedOrders.has(order.id)
                const isActionable = canActOnOrder(order)
                const isLoading = actionLoading === order.id
                const transactionLabel = getPurchaseOrderTransactionLabel(order)

                return (
                  <tr
                    key={order.id}
                    title={transactionLabel}
                    className={cn(
                      'group transition-colors',
                      isSelected ? 'bg-[var(--dashboard-primary-soft)]' : 'odd:bg-white/92 even:bg-slate-50/72 hover:bg-[var(--dashboard-primary-soft)]'
                    )}
                  >
                    {visibleColumns.map((col) => {
                      const value = getColumnValue(order, col.key)

                      return (
                        <td
                          key={col.key}
                          className="border-b border-slate-100 px-3 py-3 align-middle text-[12px] font-semibold leading-5 text-slate-700"
                          onClick={() => onOrderClick(order)}
                        >
                          {col.key === 'status' ? (
                            <div className="flex justify-center">
                              <Badge className={cn('min-w-36 justify-center rounded-full px-3 py-1.5 text-center text-[10px] font-black text-white shadow-sm', getStatusColor(String(value || '')))}>
                                {formatStatusLabel(String(value || ''))}
                              </Badge>
                            </div>
                          ) : col.key === 'createdAt' ? (
                            <span className="text-slate-600">{value ? formatDate(String(value)) : '-'}</span>
                          ) : col.key === 'estimateIfAny' || col.key === 'amount' ? (
                            <span className={cn('inline-flex rounded-xl border px-2.5 py-1 text-[11px] font-black', getAmountTone(value))}>
                              {formatCurrency(value)}
                            </span>
                          ) : (
                            <span className="line-clamp-2">{hasRenderableValue(value) ? String(value) : '-'}</span>
                          )}
                        </td>
                      )
                    })}

                    <td className={cn(
                      "sticky right-0 z-10 border-b border-l border-[var(--dashboard-primary-border)] px-3 py-2.5 shadow-[-10px_0_24px_rgba(15,23,42,0.04)] transition-colors",
                      isSelected ? "bg-[var(--dashboard-primary-soft)]" : "bg-white group-hover:bg-[var(--dashboard-primary-soft)]"
                    )}>
                      <div className="flex items-center justify-center gap-1.5">
                        <PurchaseOrderImagePreviewButton order={order} />
                        {isActionable ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => void handleAction('approve', order.id)}
                              disabled={isLoading || bulkActionLoading !== null || loading}
                              className="app-primary-action h-8 w-8 rounded-xl p-0 shadow-lg"
                              title={`Approve ${transactionLabel}`}
                            >
                              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => openRemarksDialog('deny', order.id)}
                              disabled={isLoading || bulkActionLoading !== null || loading}
                              className="h-8 w-8 rounded-xl p-0 shadow-lg shadow-rose-100"
                              title={`Deny ${transactionLabel}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openRemarksDialog('hold', order.id)}
                              disabled={isLoading || bulkActionLoading !== null || loading}
                              className="h-8 w-8 rounded-xl border border-amber-400 bg-amber-50 p-0 text-amber-600 shadow-lg shadow-amber-100 hover:bg-amber-100"
                              title={`Hold ${transactionLabel}`}
                            >
                              <Pause className="h-3 w-3" />
                            </Button>
                            <Checkbox
                              checked={isSelected}
                              disabled={!isActionable}
                              onCheckedChange={() => toggleSelection(order.id)}
                              aria-label={`Select ${transactionLabel}`}
                              title={`Select ${transactionLabel}`}
                              className="approval-table-checkbox h-6 w-6 rounded-lg border-2 border-[var(--dashboard-action-bg)] bg-white shadow-sm ring-2 ring-white/80 data-[state=checked]:border-[var(--dashboard-action-hover)] data-[state=checked]:bg-[var(--dashboard-action-bg)] data-[state=checked]:text-[var(--dashboard-action-fg)] data-[state=checked]:[&_svg]:stroke-[var(--dashboard-action-fg)] [&_svg]:stroke-[3.5]"
                            />
                          </>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-center text-[11px] font-black text-slate-400">No actions</span>
                        )}
                      </div>
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
