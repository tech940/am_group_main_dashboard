'use client'

import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatIndiaDateTime } from '@/lib/date-time'

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
  specialInstructions?: string
  special_instructions?: string
  brand?: string
  status: string
  createdAt?: string
  created_at?: string
  specifyOther?: string
  specify_other?: string
}

interface POTableViewProps {
  orders: PurchaseOrder[]
  totalOrders?: number
  listMode?: 'today' | 'all'
  isLoading?: boolean
  onOrderClick: (order: PurchaseOrder) => void
}

const PO_COLUMNS = [
  { key: 'orderNumber', label: 'PO Number', width: 'w-28' },
  { key: 'requestedBy', label: 'Requested By', width: 'w-32' },
  { key: 'department', label: 'Department', width: 'w-32' },
  { key: 'subDepartment', label: 'Sub Department', width: 'w-28' },
  { key: 'specifyOther', label: 'Requirement Type', width: 'w-36' },
  { key: 'quantityRequired', label: 'Quantity', width: 'w-20' },
  { key: 'estimateIfAny', label: 'Estimate Amount', width: 'w-28' },
  { key: 'specialInstructions', label: 'Special Instructions', width: 'w-48' },
  { key: 'brand', label: 'Branch', width: 'w-24' },
  { key: 'createdAt', label: 'Created Date', width: 'w-32' },
  { key: 'status', label: 'Current Status', width: 'w-36' },
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
    case 'specialInstructions':
      return order.specialInstructions || order.special_instructions
    case 'specifyOther':
      return order.specifyOther || order.specify_other
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
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
  return formatted || dateString
}

function formatCurrency(value: unknown) {
  if (!hasRenderableValue(value)) {
    return '-'
  }

  const numValue = typeof value === 'string' ? parseFloat(value) : Number(value)
  if (isNaN(numValue)) {
    return `₹${String(value)}`
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(numValue)
}

function getBranchLabel(brand: string) {
  const labels: Record<string, string> = {
    kia: 'KIA',
    hyundai: 'Hyundai',
    all: 'All Branches',
  }
  return labels[brand?.toLowerCase()] || brand || '-'
}

function getStatusColor(status: string) {
  const colors: Record<string, string> = {
    submitted: 'bg-blue-500',
    vendor_info_pending: 'bg-yellow-500',
    awaiting_ea_approval: 'bg-violet-500',
    awaiting_md_approval: 'bg-indigo-500',
    ea_denied: 'bg-red-500',
    md_denied: 'bg-red-500',
    ea_on_hold: 'bg-amber-500',
    md_on_hold: 'bg-amber-500',
    awaiting_grn: 'bg-teal-500',
    awaiting_accounts: 'bg-emerald-500',
    completed: 'bg-green-600',
    cancelled: 'bg-slate-500',
  }

  return colors[status] || 'bg-slate-500'
}

function formatStatusLabel(status: string) {
  return status.replace(/_/g, ' ').toUpperCase()
}

export function POTableView({ orders, totalOrders = orders.length, listMode = 'today', isLoading = false, onOrderClick }: POTableViewProps) {
  const visibleColumns = useMemo(() => (
    isLoading && orders.length === 0
      ? PO_COLUMNS
      :
    PO_COLUMNS.filter((col) => {
      // Always show these essential columns
      if (['orderNumber', 'requestedBy', 'department', 'status', 'createdAt'].includes(col.key)) {
        return true
      }

      // Show other columns only if they have data
      return orders.some((order) => hasRenderableValue(getColumnValue(order, col.key)))
    })
  ), [isLoading, orders])

  const skeletonRows = Array.from({ length: 9 })

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-gradient-to-r from-teal-50 to-emerald-50 p-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">Purchase Order Overview</h3>
            <p className="text-xs text-slate-600">
              {listMode === 'today' ? 'Current-day' : 'All-order'} table view showing {orders.length} of {totalOrders} purchase order{totalOrders !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="rounded-lg bg-white px-3 py-1.5 shadow-sm">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total Orders</p>
            <p className="text-xl font-black text-teal-600">{totalOrders}</p>
          </div>
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm" aria-busy={isLoading}>
        <table className="w-full text-xs">
          <thead className="border-b-2 border-teal-600 bg-gradient-to-r from-teal-600 to-teal-700">
            <tr>
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-3 py-2 text-left text-[11px] font-bold text-white',
                    col.width
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              skeletonRows.map((_, rowIndex) => (
                <tr
                  key={`po-table-skeleton-${rowIndex}`}
                  className={cn('border-b border-slate-100', rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/70')}
                >
                  {visibleColumns.map((col, colIndex) => (
                    <td key={`${col.key}-${rowIndex}`} className="px-3 py-3">
                      <div
                        className={cn(
                          'h-4 animate-pulse rounded-full bg-slate-200',
                          colIndex === 0 ? 'w-24' : col.key === 'specialInstructions' ? 'w-40' : col.key === 'status' ? 'w-28' : 'w-20'
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : orders.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="px-4 py-12 text-center text-slate-500"
                >
                  No purchase orders found
                </td>
              </tr>
            ) : (
              orders.map((order, index) => {
                const isEven = index % 2 === 0

                return (
                  <tr
                    key={order.id}
                    className={cn(
                      'border-b border-slate-100 transition-colors hover:bg-teal-50 cursor-pointer',
                      isEven ? 'bg-white' : 'bg-slate-50/50'
                    )}
                    onClick={() => onOrderClick(order)}
                  >
                    {visibleColumns.map((col) => {
                      const value = getColumnValue(order, col.key)

                      return (
                        <td
                          key={col.key}
                          className="px-3 py-2 text-slate-700"
                        >
                          {col.key === 'status' ? (
                            <Badge
                              className={cn(
                                'min-w-28 justify-center text-center text-[10px] text-white font-semibold px-2 py-0.5',
                                getStatusColor(String(value || ''))
                              )}
                            >
                              {formatStatusLabel(String(value || ''))}
                            </Badge>
                          ) : col.key === 'createdAt' ? (
                            <span className="text-[10px] font-medium">
                              {value ? formatDate(String(value)) : '-'}
                            </span>
                          ) : col.key === 'estimateIfAny' ? (
                            <span className="text-[11px] font-semibold text-teal-700">
                              {formatCurrency(value)}
                            </span>
                          ) : col.key === 'brand' ? (
                            <span className="text-[11px] font-medium">
                              {getBranchLabel(String(value || ''))}
                            </span>
                          ) : col.key === 'orderNumber' ? (
                            <span className="text-[11px] font-bold text-slate-900">
                              {hasRenderableValue(value) ? String(value) : '-'}
                            </span>
                          ) : col.key === 'specialInstructions' ? (
                            <span className="line-clamp-2 text-[10px]">
                              {hasRenderableValue(value) ? String(value) : '-'}
                            </span>
                          ) : (
                            <span className={cn(
                              'text-[11px]',
                              col.key === 'requestedBy' && 'font-medium text-slate-800'
                            )}>
                              {hasRenderableValue(value) ? String(value) : '-'}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
        <p className="text-[10px] text-slate-600 text-center">
          💡 <span className="font-semibold">Tip:</span> This table view is optimized for screenshots and sharing.
          Click on any row to view full order details.
        </p>
      </div>
    </div>
  )
}

// Made with Bob
