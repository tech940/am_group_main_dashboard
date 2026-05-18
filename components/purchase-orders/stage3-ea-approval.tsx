'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface Stage3EAFormData {
  action: 'approve' | 'deny'
  remarks: string
}

interface Stage3EAProps {
  orderId: string
  orderDetails: {
    itemName: string
    department: string
    subDepartment: string
    quantity: number
    estimatedCost: number
    vendorName: string
  }
  onSubmit: (data: Stage3EAFormData) => Promise<void>
  isLoading?: boolean
}

export function Stage3EAApproval({ orderId, orderDetails, onSubmit, isLoading }: Stage3EAProps) {
  const [formData, setFormData] = useState<Stage3EAFormData>({
    action: 'approve',
    remarks: ''
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (formData.action === 'deny' && !formData.remarks.trim()) {
      newErrors.remarks = 'Remarks are mandatory when denying a request'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (action: 'approve' | 'deny') => {
    const data = {
      action,
      remarks: action === 'approve' ? '' : formData.remarks
    }
    setFormData(prev => ({ ...prev, action }))
    
    if (action === 'deny' && !validate()) {
      return
    }
    
    await onSubmit(data)
  }

  return (
    <Card className="border-none shadow-xl">
      <CardHeader className="bg-gradient-to-r from-purple-500 to-purple-600 text-white">
        <CardTitle className="text-2xl font-black">
          EA Approval Required
        </CardTitle>
        <p className="text-sm text-purple-50 mt-1">
          Review and approve/deny this purchase request
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
              <p className="font-medium">₹{orderDetails.estimatedCost.toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Vendor Name</p>
              <p className="font-medium">{orderDetails.vendorName}</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 pt-4">
          <Button
            type="button"
            onClick={() => {
              setFormData(prev => ({ ...prev, action: 'approve', remarks: '' }))
              handleSubmit('approve')
            }}
            disabled={isLoading}
            className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white py-6 text-lg font-semibold"
          >
            {isLoading && formData.action === 'approve' ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Approving...
              </>
            ) : (
              <>
                <CheckCircle className="h-5 w-5 mr-2" />
                Approve
              </>
            )}
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

        {/* Remarks - Only shown when Deny is clicked */}
        {formData.action === 'deny' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
            <Label htmlFor="remarks" className="mb-2 block font-semibold text-red-900">
              Reason for Denial <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="remarks"
              value={formData.remarks}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, remarks: e.target.value }))
                if (errors.remarks) {
                  setErrors(prev => {
                    const newErrors = { ...prev }
                    delete newErrors.remarks
                    return newErrors
                  })
                }
              }}
              placeholder="Please provide a detailed reason for denying this request..."
              rows={4}
              className={errors.remarks ? 'border-red-500' : ''}
            />
            {errors.remarks && (
              <p className="text-xs text-red-500 mt-1">{errors.remarks}</p>
            )}
            <Button
              type="button"
              onClick={() => handleSubmit('deny')}
              disabled={isLoading}
              variant="destructive"
              className="w-full py-3 text-base font-semibold"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Submitting Denial...
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 mr-2" />
                  Confirm Denial
                </>
              )}
            </Button>
          </div>
        )}

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <p className="text-sm text-purple-800">
            <strong>Note:</strong> After EA approval, this request will be sent to MD for final approval. If denied, it will be sent back to the requester.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// Made with Bob
