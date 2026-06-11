'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle, XCircle, PauseCircle, Loader2 } from 'lucide-react'

interface Stage3MDFormData {
  action: 'approve' | 'deny' | 'hold'
  remarks: string
}

interface Stage3MDProps {
  orderId: string
  orderDetails: {
    itemName: string
    department: string
    subDepartment: string
    quantity: number
    estimatedCost: number
    vendorName: string
    eaRemarks?: string
  }
  onSubmit: (data: Stage3MDFormData) => Promise<void>
  isLoading?: boolean
}

export function Stage3MDApproval({ orderDetails, onSubmit, isLoading }: Stage3MDProps) {
  const [formData, setFormData] = useState<Stage3MDFormData>({
    action: 'approve',
    remarks: ''
  })

  const handleSubmit = async (action: 'approve' | 'deny' | 'hold') => {
    const data = {
      action,
      remarks: action === 'approve' ? '' : formData.remarks
    }
    setFormData(prev => ({ ...prev, action }))

    await onSubmit(data)
  }

  return (
    <Card className="border border-[var(--dashboard-primary-border)] shadow-xl">
      <CardHeader className="bg-[linear-gradient(135deg,color-mix(in_srgb,var(--dashboard-primary)_10%,white),color-mix(in_srgb,var(--dashboard-primary-light)_18%,white))]">
        <CardTitle className="text-2xl font-black text-[var(--dashboard-action-bg)]">
          MD Final Approval Required
        </CardTitle>
        <p className="mt-1 text-sm font-semibold text-slate-600">
          Review and provide final approval/denial for this purchase request
        </p>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Order Details - Read Only */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-lg mb-3">Request Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Item Name</p>
              <p className="font-medium">{orderDetails.itemName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Department</p>
              <p className="font-medium">{orderDetails.department}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Sub-Department</p>
              <p className="font-medium">{orderDetails.subDepartment}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Quantity</p>
              <p className="font-medium">{orderDetails.quantity}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Estimated Cost</p>
              <p className="font-medium">Rs. {orderDetails.estimatedCost.toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Vendor Name</p>
              <p className="font-medium">{orderDetails.vendorName}</p>
            </div>
          </div>
          
          {/* EA Remarks */}
          {orderDetails.eaRemarks && (
            <div className="mt-4 pt-4 border-t border-gray-300">
              <p className="text-sm text-gray-600 mb-1">EA Remarks</p>
              <p className="font-medium text-purple-700">{orderDetails.eaRemarks}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid gap-4 pt-4 md:grid-cols-3">
          <Button
            type="button"
            onClick={() => {
              setFormData(prev => ({ ...prev, action: 'approve', remarks: '' }))
              handleSubmit('approve')
            }}
            disabled={isLoading}
            className="app-primary-action flex-1 py-6 text-lg font-semibold"
          >
            {isLoading && formData.action === 'approve' ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Approving...
              </>
            ) : (
              <>
                <CheckCircle className="h-5 w-5 mr-2" />
                Final Approve
              </>
            )}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setFormData(prev => ({ ...prev, action: 'hold' }))
            }}
            disabled={isLoading}
            className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white py-6 text-lg font-semibold"
          >
            <PauseCircle className="h-5 w-5 mr-2" />
            Hold
          </Button>
          <Button
            type="button"
            onClick={() => {
              setFormData(prev => ({ ...prev, action: 'deny' }))
            }}
            disabled={isLoading}
            className="flex-1 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white py-6 text-lg font-semibold"
          >
            <XCircle className="h-5 w-5 mr-2" />
            Deny
          </Button>
        </div>

        {/* Remarks - Optional for Deny/Hold */}
        {(formData.action === 'deny' || formData.action === 'hold') && (
          <div className={`${formData.action === 'deny' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'} border rounded-lg p-4 space-y-3`}>
            <Label htmlFor="remarks" className={`mb-2 block font-semibold ${formData.action === 'deny' ? 'text-red-900' : 'text-amber-900'}`}>
              Optional Remarks
            </Label>
            <Textarea
              id="remarks"
              value={formData.remarks}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData(prev => ({ ...prev, remarks: e.target.value }))}
              placeholder={formData.action === 'deny' ? 'Add denial remarks if needed...' : 'Add hold remarks if needed...'}
              rows={4}
            />
            <Button
              type="button"
              onClick={() => handleSubmit(formData.action)}
              disabled={isLoading}
              variant={formData.action === 'deny' ? 'destructive' : 'default'}
              className="w-full py-3 text-base font-semibold"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : formData.action === 'deny' ? (
                <>
                  <XCircle className="h-5 w-5 mr-2" />
                  Confirm Denial
                </>
              ) : (
                <>
                  <PauseCircle className="h-5 w-5 mr-2" />
                  Confirm Hold
                </>
              )}
            </Button>
          </div>
        )}

        <div className="rounded-lg border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--dashboard-action-bg)]">
            <strong>Note:</strong> After MD approval, this request will proceed to GRN stage with Purchase Manager. If denied, it will be sent back to the requester.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// Made with Bob
