'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Save, Loader2 } from 'lucide-react'

interface Stage5FormData {
  invoiceNumber: string
  invoiceDate: string
  amount: string
  paymentStatus: string
  paymentMode: string
  paymentDate: string
  accountsRemarks: string
  accountsImages: File[]
}

interface Stage5Props {
  orderId: string
  orderDetails: {
    itemName: string
    quantity: number
    estimatedCost: number
    vendorName: string
    grnNumber: string
    receivedQuantity: number
  }
  initialData?: Partial<Stage5FormData>
  onSubmit: (data: Stage5FormData) => Promise<void>
  isLoading?: boolean
}

export function Stage5Accounts({ orderId, orderDetails, initialData, onSubmit, isLoading }: Stage5Props) {
  const [formData, setFormData] = useState<Stage5FormData>({
    invoiceNumber: initialData?.invoiceNumber || '',
    invoiceDate: initialData?.invoiceDate || new Date().toISOString().split('T')[0],
    amount: initialData?.amount || orderDetails.estimatedCost.toString(),
    paymentStatus: initialData?.paymentStatus || '',
    paymentMode: initialData?.paymentMode || '',
    paymentDate: initialData?.paymentDate || new Date().toISOString().split('T')[0],
    accountsRemarks: initialData?.accountsRemarks || '',
    accountsImages: []
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateField = (field: keyof Stage5FormData, value: any) => {
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
    if (!formData.invoiceNumber) newErrors.invoiceNumber = 'Invoice number is required'
    if (!formData.amount) newErrors.amount = 'Amount is required'
    if (!formData.paymentStatus) newErrors.paymentStatus = 'Payment status is required'
    if (!formData.paymentMode) newErrors.paymentMode = 'Payment mode is required'
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
        <CardHeader className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white">
          <CardTitle className="text-2xl font-black">
            Accounts Processing
          </CardTitle>
          <p className="text-sm text-emerald-50 mt-1">
            Accounts Department: Process payment and complete the order
          </p>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Order Summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-lg mb-3 text-emerald-800">Order Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Item Name</p>
                <p className="font-medium text-gray-800">{orderDetails.itemName}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Vendor</p>
                <p className="font-medium text-gray-800">{orderDetails.vendorName}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">GRN Number</p>
                <p className="font-medium text-gray-800">{orderDetails.grnNumber}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Ordered Qty</p>
                <p className="font-medium text-gray-800">{orderDetails.quantity}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Received Qty</p>
                <p className="font-medium text-gray-800">{orderDetails.receivedQuantity}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Est. Cost</p>
                <p className="font-medium text-gray-800">₹{orderDetails.estimatedCost.toLocaleString('en-IN')}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Invoice Details Section */}
            <div className="space-y-4 p-4 border border-gray-100 rounded-xl bg-white shadow-sm">
              <h3 className="font-bold text-gray-700 flex items-center gap-2">
                <span className="w-2 h-6 bg-emerald-500 rounded-full"></span>
                Invoice Details
              </h3>

              <div>
                <Label htmlFor="invoiceNumber">Invoice Number <span className="text-red-500">*</span></Label>
                <Input
                  id="invoiceNumber"
                  value={formData.invoiceNumber}
                  onChange={(e) => updateField('invoiceNumber', e.target.value)}
                  placeholder="Enter invoice number"
                  className={errors.invoiceNumber ? 'border-red-500' : ''}
                />
              </div>

              <div>
                <Label htmlFor="invoiceDate">Invoice Date</Label>
                <Input
                  id="invoiceDate"
                  type="date"
                  value={formData.invoiceDate}
                  onChange={(e) => updateField('invoiceDate', e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="amount">Final Amount (₹) <span className="text-red-500">*</span></Label>
                <Input
                  id="amount"
                  type="number"
                  value={formData.amount}
                  onChange={(e) => updateField('amount', e.target.value)}
                  placeholder="Enter final billed amount"
                  className={errors.amount ? 'border-red-500' : ''}
                />
                {parseFloat(formData.amount) !== orderDetails.estimatedCost && formData.amount && (
                  <p className="text-[10px] text-amber-600 font-bold mt-1 uppercase">
                    ⚠️ Note: Differs from estimate (₹{orderDetails.estimatedCost.toLocaleString('en-IN')})
                  </p>
                )}
              </div>
            </div>

            {/* Payment Details Section */}
            <div className="space-y-4 p-4 border border-gray-100 rounded-xl bg-white shadow-sm">
              <h3 className="font-bold text-gray-700 flex items-center gap-2">
                <span className="w-2 h-6 bg-blue-500 rounded-full"></span>
                Payment Details
              </h3>

              <div>
                <Label htmlFor="paymentStatus">Status <span className="text-red-500">*</span></Label>
                <Select
                  value={formData.paymentStatus}
                  onValueChange={(value) => updateField('paymentStatus', value)}
                >
                  <SelectTrigger className={errors.paymentStatus ? 'border-red-500' : 'bg-white'}>
                    <SelectValue placeholder="Select payment status" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="no_gap_payment_released">No gap payment released</SelectItem>
                    <SelectItem value="gap_observed_need_clarification">Gap observed need clarification</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="paymentMode">Payment Mode <span className="text-red-500">*</span></Label>
                <Select
                  value={formData.paymentMode}
                  onValueChange={(value) => updateField('paymentMode', value)}
                >
                  <SelectTrigger className={errors.paymentMode ? 'border-red-500' : 'bg-white'}>
                    <SelectValue placeholder="Select payment mode" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="bank_transfer">Online transfer</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="credit_card">Credit card</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="paymentDate">Payment Date</Label>
                <Input
                  id="paymentDate"
                  type="date"
                  value={formData.paymentDate}
                  onChange={(e) => updateField('paymentDate', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Remarks */}
            <div>
              <Label htmlFor="accountsRemarks">Accounts Remarks</Label>
              <Textarea
                id="accountsRemarks"
                value={formData.accountsRemarks}
                onChange={(e) => updateField('accountsRemarks', e.target.value)}
                placeholder="Add any additional notes or comments..."
                rows={4}
              />
            </div>

            {/* Accounts Images */}
            <div className="space-y-4">
              <Label htmlFor="accountsImages">Payment Screenshot / Invoice Copy</Label>
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 bg-gray-50 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-gray-100 transition-colors">
                <Input
                  id="accountsImages"
                  type="file"
                  multiple
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || [])
                    updateField('accountsImages', files)
                  }}
                  className="hidden"
                />
                <Label htmlFor="accountsImages" className="cursor-pointer">
                  <div className="flex flex-col items-center">
                    <Save className="h-8 w-8 text-gray-400 mb-2" />
                    <p className="text-sm font-medium text-gray-700">
                      {formData.accountsImages.length > 0
                        ? `${formData.accountsImages.length} file(s) selected`
                        : 'Click to upload payment documents'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">PDF or Images (Multiple supported)</p>
                  </div>
                </Label>
              </div>
              {formData.accountsImages.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.accountsImages.map((file, idx) => (
                    <div key={idx} className="text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded">
                      {file.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white px-10 py-6 text-lg font-bold shadow-lg shadow-emerald-200"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-6 w-6 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Save className="h-6 w-6 mr-2" />
                  Complete & Close Order
                </>
              )}
            </Button>
          </div>
        </form>
        )
}


// Made with Bob
