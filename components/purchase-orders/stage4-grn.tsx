'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MultipleImageUpload } from './multiple-image-upload'
import { Save, Loader2, ImagePlus } from 'lucide-react'

interface Stage4FormData {
  receivedDateTime: string
  receivedTime: string
  handoverTo: string
  remarksIfAny: string
  amount: string
  grnImages: Array<File | string>
}

interface Stage4Props {
  orderId: string
  orderDetails: {
    itemName: string
    quantity: number
    vendorName: string
  }
  initialData?: Partial<Stage4FormData>
  onSubmit: (data: Stage4FormData) => Promise<void>
  isLoading?: boolean
}

type Stage4Field = keyof Stage4FormData

export function Stage4GRN({ orderId, orderDetails, initialData, onSubmit, isLoading }: Stage4Props) {
  const [formData, setFormData] = useState<Stage4FormData>({
    receivedDateTime: initialData?.receivedDateTime || '',
    receivedTime: initialData?.receivedTime || '',
    handoverTo: initialData?.handoverTo || '',
    remarksIfAny: initialData?.remarksIfAny || '',
    amount: initialData?.amount || '',
    grnImages: initialData?.grnImages || []
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showGrnUploads, setShowGrnUploads] = useState((initialData?.grnImages?.length || 0) > 0)

  const updateField = (field: Stage4Field, value: Stage4FormData[Stage4Field]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!formData.receivedDateTime) newErrors.receivedDateTime = 'Received date is required'
    if (!formData.receivedTime) newErrors.receivedTime = 'Received time is required'
    if (!formData.handoverTo) newErrors.handoverTo = 'Handover to is required'
    if (!formData.amount) newErrors.amount = 'Amount is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (validate()) {
      await onSubmit(formData)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-gradient-to-r from-teal-500 to-teal-600 text-white">
          <CardTitle className="text-2xl font-black">
            Goods Receipt Note (GRN)
          </CardTitle>
          <p className="text-sm text-teal-50 mt-1">
            Purchase Manager: Record goods receipt details
          </p>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Order Summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-lg mb-3">Order Summary</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">Item Name</p>
                <p className="font-medium">{orderDetails.itemName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Ordered Quantity</p>
                <p className="font-medium">{orderDetails.quantity}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Vendor</p>
                <p className="font-medium">{orderDetails.vendorName}</p>
              </div>
            </div>
          </div>

          {/* Received Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="receivedDateTime" className="mb-2 block">
                Received Date <span className="text-red-500">*</span>
              </Label>
              <Input
                id="receivedDateTime"
                type="date"
                value={formData.receivedDateTime}
                onChange={(e) => updateField('receivedDateTime', e.target.value)}
                className={errors.receivedDateTime ? 'border-red-500' : ''}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              />
              {errors.receivedDateTime && (
                <p className="text-xs text-red-500 mt-1">{errors.receivedDateTime}</p>
              )}
            </div>

            <div>
              <Label htmlFor="receivedTime" className="mb-2 block">
                Time <span className="text-red-500">*</span>
              </Label>
              <Input
                id="receivedTime"
                type="time"
                value={formData.receivedTime}
                onChange={(e) => updateField('receivedTime', e.target.value)}
                className={errors.receivedTime ? 'border-red-500' : ''}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              />
              {errors.receivedTime && (
                <p className="text-xs text-red-500 mt-1">{errors.receivedTime}</p>
              )}
            </div>
          </div>

          {/* Handover To */}
          <div>
            <Label htmlFor="handoverTo" className="mb-2 block">
              Handover To <span className="text-red-500">*</span>
            </Label>
            <Input
              id="handoverTo"
              value={formData.handoverTo}
              onChange={(e) => updateField('handoverTo', e.target.value)}
              placeholder="Enter name of person receiving the goods"
              className={errors.handoverTo ? 'border-red-500' : ''}
            />
            {errors.handoverTo && (
              <p className="text-xs text-red-500 mt-1">{errors.handoverTo}</p>
            )}
          </div>

          {/* Remarks If Any */}
          <div>
            <Label htmlFor="remarksIfAny" className="mb-2 block">
              Remarks If Any
            </Label>
            <textarea
              id="remarksIfAny"
              value={formData.remarksIfAny}
              onChange={(e) => updateField('remarksIfAny', e.target.value)}
              placeholder="Add any additional notes or comments..."
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-md resize-none"
            />
          </div>

          {/* Amount */}
          <div>
            <Label htmlFor="amount" className="mb-2 block">
              Amount <span className="text-red-500">*</span>
            </Label>
            <Input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              value={formData.amount}
              onChange={(e) => updateField('amount', e.target.value)}
              placeholder="Enter amount"
              className={errors.amount ? 'border-red-500' : ''}
            />
            {errors.amount && (
              <p className="text-xs text-red-500 mt-1">{errors.amount}</p>
            )}
          </div>

          {/* GRN Images */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Upload GRN Documents</p>
                <p className="text-xs text-slate-500">
                  Keep this hidden unless you want to attach GRN photos or receiving documents.
                </p>
              </div>
              <Button
                type="button"
                variant={showGrnUploads ? 'secondary' : 'outline'}
                onClick={() => setShowGrnUploads((value) => !value)}
                className="rounded-2xl"
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                {showGrnUploads ? 'Hide Uploads' : 'Enable Uploads'}
              </Button>
            </div>

            {showGrnUploads && (
              <div className="mt-4">
                <MultipleImageUpload
                  label="GRN Documents & Photos"
                  images={formData.grnImages}
                  onImagesChange={(images) => updateField('grnImages', images)}
                  maxImages={10}
                  orderId={orderId}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4">
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white px-8 py-6 text-lg font-semibold"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-5 w-5 mr-2" />
                  Save & Send to Accounts
                </>
              )}
            </Button>
          </div>

          <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
            <p className="text-sm text-teal-800">
              <strong>Note:</strong> After submission, this request will be sent to Accounts Department for final processing and payment.
            </p>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}

// Made with Bob
