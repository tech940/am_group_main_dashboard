'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  User,
  Calendar,
  Package,
  Building2,
  FileText,
  DollarSign,
  MessageSquare
} from 'lucide-react'

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

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { color: string; label: string }> = {
      draft: { color: 'bg-slate-100 text-slate-700', label: 'Draft' },
      pending_ea_approval: { color: 'bg-yellow-100 text-yellow-700', label: 'Pending EA Approval' },
      pending_management_approval: { color: 'bg-orange-100 text-orange-700', label: 'Pending Management Approval' },
      approved: { color: 'bg-green-100 text-green-700', label: 'Approved' },
      rejected: { color: 'bg-red-100 text-red-700', label: 'Rejected' },
      completed: { color: 'bg-blue-100 text-blue-700', label: 'Completed' }
    }
    const config = statusConfig[status] || statusConfig.draft
    return <Badge className={cn('font-semibold', config.color)}>{config.label}</Badge>
  }

  const getApprovalIcon = (approval?: string) => {
    if (approval === 'approved') return <CheckCircle className="h-5 w-5 text-green-500" />
    if (approval === 'rejected') return <XCircle className="h-5 w-5 text-red-500" />
    return <Clock className="h-5 w-5 text-yellow-500" />
  }

  return (
    <Card className="border-none shadow-xl hover:shadow-2xl transition-shadow">
      <CardHeader className="bg-gradient-to-r from-slate-700 to-slate-800 text-white">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-black">{order.order_number}</CardTitle>
            <p className="text-xs text-slate-300 mt-1">
              Created: {new Date(order.created_at).toLocaleDateString('en-IN')}
            </p>
          </div>
          {getStatusBadge(order.status)}
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {/* Order Details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 text-slate-500 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase">Department</p>
              <p className="text-sm font-medium text-slate-700">{order.department || 'N/A'}</p>
              {order.sub_department && (
                <p className="text-xs text-slate-500">{order.sub_department}</p>
              )}
            </div>
          </div>
          
          <div className="flex items-start gap-2">
            <User className="h-4 w-4 text-slate-500 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase">Requested By</p>
              <p className="text-sm font-medium text-slate-700">{order.requested_by || 'N/A'}</p>
            </div>
          </div>
          
          <div className="flex items-start gap-2">
            <Package className="h-4 w-4 text-slate-500 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase">Quantity</p>
              <p className="text-sm font-medium text-slate-700">{order.quantity_required || 'N/A'}</p>
            </div>
          </div>
          
          {order.amount && (
            <div className="flex items-start gap-2">
              <DollarSign className="h-4 w-4 text-slate-500 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase">Amount</p>
                <p className="text-sm font-medium text-slate-700">₹{parseFloat(order.amount).toLocaleString('en-IN')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Special Instructions */}
        {order.special_instructions && (
          <div className="bg-slate-50 p-3 rounded-lg">
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 text-slate-500 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Special Instructions</p>
                <p className="text-sm text-slate-700">{order.special_instructions}</p>
              </div>
            </div>
          </div>
        )}

        {/* Vendor Information */}
        {order.vendor_name && (
          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="flex items-start gap-2">
              <Building2 className="h-4 w-4 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-blue-600 uppercase mb-1">Vendor</p>
                <p className="text-sm text-slate-700">{order.vendor_name}</p>
              </div>
            </div>
          </div>
        )}

        {/* Approval Status */}
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getApprovalIcon(order.ea_approval)}
              <span className="text-sm font-semibold text-slate-700">EA Approval</span>
            </div>
            <span className="text-xs font-medium text-slate-500">
              {order.ea_approval === 'approved' ? 'Approved' : order.ea_approval === 'rejected' ? 'Rejected' : 'Pending'}
            </span>
          </div>
          {order.ea_remarks && (
            <div className="ml-7 bg-slate-50 p-2 rounded text-xs text-slate-600">
              <MessageSquare className="h-3 w-3 inline mr-1" />
              {order.ea_remarks}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getApprovalIcon(order.management_approval)}
              <span className="text-sm font-semibold text-slate-700">Management Approval</span>
            </div>
            <span className="text-xs font-medium text-slate-500">
              {order.management_approval === 'approved' ? 'Approved' : order.management_approval === 'rejected' ? 'Rejected' : 'Pending'}
            </span>
          </div>
          {order.management_remarks && (
            <div className="ml-7 bg-slate-50 p-2 rounded text-xs text-slate-600">
              <MessageSquare className="h-3 w-3 inline mr-1" />
              {order.management_remarks}
            </div>
          )}
        </div>

        {/* Approval Actions */}
        {canApprove() && (
          <div className="border-t pt-4 space-y-3">
            <div>
              <Label htmlFor={`remarks-${order.id}`}>Remarks</Label>
              <textarea
                id={`remarks-${order.id}`}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Enter your remarks (optional for approval, required for rejection)"
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleApprove}
                disabled={isLoading}
                className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Approve
              </Button>
              <Button
                onClick={handleReject}
                disabled={isLoading}
                variant="destructive"
                className="flex-1"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Reject
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Made with Bob
