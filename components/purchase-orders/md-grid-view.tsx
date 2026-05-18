'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, XCircle, Loader2, Eye, CheckCheck, XOctagon, User, Calendar } from 'lucide-react'
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
  status?: string
  created_at?: string
  createdAt?: string
  ea_approval_remarks?: string
  eaApprovalRemarks?: string
  md_approval_remarks?: string
  mdApprovalRemarks?: string
  amount?: string
  actual_amount?: string
  actualAmount?: string
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
  onDeny: (orderId: string, remarks: string) => Promise<void>
  onApproveAll: () => Promise<void>
  onDenyAll: () => Promise<void>
  onViewDetails: (order: PurchaseOrder) => Promise<void>
  isLoading?: boolean
}

export function MDGridView({
  orders,
  personnel,
  onApprove,
  onDeny,
  onApproveAll,
  onDenyAll,
  onViewDetails,
  isLoading
}: MDGridViewProps) {
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [processingOrders, setProcessingOrders] = useState<Set<string>>(new Set())
  const [loadingDetails, setLoadingDetails] = useState(false)

  const pendingOrders = orders.filter(order => order.status === 'awaiting_md_approval')

  const handleApprove = async (orderId: string) => {
    setProcessingOrders(prev => new Set(prev).add(orderId))
    try {
      await onApprove(orderId)
    } finally {
      setProcessingOrders(prev => {
        const newSet = new Set(prev)
        newSet.delete(orderId)
        return newSet
      })
    }
  }

  const handleDeny = async (orderId: string) => {
    const remarks = prompt('Please provide a reason for denial:')
    if (!remarks) {
      alert('Remarks are required for denial')
      return
    }
    setProcessingOrders(prev => new Set(prev).add(orderId))
    try {
      await onDeny(orderId, remarks)
    } finally {
      setProcessingOrders(prev => {
        const newSet = new Set(prev)
        newSet.delete(orderId)
        return newSet
      })
    }
  }

  const handleViewDetails = async (order: PurchaseOrder) => {
    setLoadingDetails(true)
    try {
      await onViewDetails(order)
    } finally {
      setLoadingDetails(false)
    }
  }

  const formatDateTime = (dateString: string) => {
    try {
      const date = new Date(dateString)
      if (isNaN(date.getTime())) {
        return dateString // Return original if invalid
      }
      return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(date)
    } catch (error) {
      return dateString
    }
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      awaiting_md_approval: 'bg-teal-600',
      md_approved: 'bg-green-500',
      md_denied: 'bg-red-500',
    }
    return colors[status] || 'bg-gray-500'
  }

  const getPersonnelForOrder = (orderId: string): Personnel | null => {
    return personnel.get(orderId) || null
  }

  return (
    <div className="space-y-6">
      {/* Header with Bulk Actions */}
      <div className="flex items-center justify-between bg-gradient-to-r from-teal-600 to-teal-700 text-white p-6 rounded-lg shadow-xl">
        <div>
          <h2 className="text-3xl font-black">MD Approval Dashboard</h2>
          <p className="text-teal-100 mt-1">
            {pendingOrders.length} purchase order{pendingOrders.length !== 1 ? 's' : ''} awaiting your approval
          </p>
        </div>
        {pendingOrders.length > 0 && (
          <div className="flex gap-3">
            <Button
              onClick={onApproveAll}
              disabled={isLoading}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 text-base font-semibold"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCheck className="h-5 w-5 mr-2" />
                  Approve All
                </>
              )}
            </Button>
            <Button
              onClick={onDenyAll}
              disabled={isLoading}
              className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 text-base font-semibold"
            >
              <XOctagon className="h-5 w-5 mr-2" />
              Deny All
            </Button>
          </div>
        )}
      </div>

      {/* Grid View */}
      {pendingOrders.length === 0 ? (
        <Card className="p-12 text-center">
          <CheckCircle className="h-16 w-16 mx-auto text-green-500 mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 mb-2">All Caught Up!</h3>
          <p className="text-gray-500">No purchase orders pending your approval</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pendingOrders.map((order) => {
            const orderPersonnel = getPersonnelForOrder(order.id)
            return (
            <Card
              key={order.id}
              className="border-2 border-teal-200 hover:border-teal-400 transition-all hover:shadow-xl"
            >
              <CardContent className="p-4 space-y-2">
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-bold text-base text-gray-800">
                      {order.order_number || order.orderNumber || 'N/A'}
                    </h3>
                    <Badge className={cn('mt-1 text-xs', getStatusColor(order.status || ''))}>
                      {(order.status || 'UNKNOWN').replace(/_/g, ' ').toUpperCase()}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewDetails(order)}
                    disabled={loadingDetails}
                    className="text-teal-600 hover:text-teal-700 h-8 w-8 p-0"
                  >
                    {loadingDetails ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {/* Department Info */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-gray-500">Department</p>
                    <p className="font-semibold text-gray-800 truncate">
                      {order.department || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Sub-Dept</p>
                    <p className="font-semibold text-gray-800 truncate">
                      {order.sub_department || order.subDepartment || 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Requested By */}
                <div className="bg-teal-50 p-2 rounded border border-teal-200">
                  <p className="text-gray-500 text-xs flex items-center gap-1">
                    <User className="h-3 w-3 text-teal-600" />
                    Requested By
                  </p>
                  <p className="font-semibold text-gray-800 text-sm">
                    {order.requested_by || order.requestedBy || 'Not specified'}
                  </p>
                </div>

                {/* Item Description */}
                <div>
                  <p className="text-gray-500 text-xs">Item Description</p>
                  <p className="font-medium text-gray-700 line-clamp-2 text-xs leading-snug">
                    {order.special_instructions || order.specialInstructions || 'No description'}
                  </p>
                </div>

                {/* Quantity & Estimate */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-50 p-2 rounded">
                    <p className="text-gray-500 text-xs">Quantity</p>
                    <p className="font-bold text-gray-800">
                      {order.quantity_required || order.quantityRequired || 'N/A'}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-2 rounded">
                    <p className="text-gray-500 text-xs">Estimate</p>
                    <p className="font-bold text-gray-800">
                      ₹{order.estimate_if_any || order.estimateIfAny || 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Vendor */}
                {(order.vendor_name || order.vendorName) && (
                  <div className="text-xs">
                    <p className="text-gray-500">Vendor</p>
                    <p className="font-semibold text-gray-800">
                      {order.vendor_name || order.vendorName}
                    </p>
                  </div>
                )}

                {/* EA Approver */}
                {orderPersonnel?.eaApprover && (
                  <div className="bg-green-50 p-2 rounded border border-green-200">
                    <p className="text-gray-500 text-xs">EA Approved By</p>
                    <p className="font-semibold text-green-800 text-sm">{orderPersonnel.eaApprover}</p>
                  </div>
                )}

                {/* Submitted */}
                <div className="bg-gray-50 p-2 rounded border border-gray-200">
                  <p className="text-gray-500 text-xs flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Submitted
                  </p>
                  <p className="font-medium text-gray-700 text-xs">
                    {formatDateTime(order.created_at || order.createdAt || '')}
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => handleApprove(order.id)}
                    disabled={processingOrders.has(order.id)}
                    className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold"
                  >
                    {processingOrders.has(order.id) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => handleDeny(order.id)}
                    disabled={processingOrders.has(order.id)}
                    className="flex-1 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold"
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Deny
                  </Button>
                </div>
              </CardContent>
            </Card>
          )})}
        </div>
      )}
    </div>
  )
}

// Made with Bob