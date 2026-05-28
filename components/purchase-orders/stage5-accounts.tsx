'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { MultipleImageUpload } from './multiple-image-upload'
import { Loader2, CreditCard, Receipt, CheckCircle2, TrendingUp, AlertTriangle, UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Stage5FormData {
  invoiceNumber: string
  invoiceDate: string
  actualAmount: string
  paymentStatus: string
  paymentMode: string
  paymentDate: string
  transactionReference: string
  accountsRemarks: string
  accountsImages: Array<File | string>
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

type Stage5Field = keyof Stage5FormData

export function Stage5Accounts({ orderId, orderDetails, initialData, onSubmit, isLoading }: Stage5Props) {
  const [formData, setFormData] = useState<Stage5FormData>({
    invoiceNumber: initialData?.invoiceNumber || '',
    invoiceDate: initialData?.invoiceDate || new Date().toISOString().split('T')[0],
    actualAmount: initialData?.actualAmount || orderDetails.estimatedCost.toString(),
    paymentStatus: initialData?.paymentStatus || '',
    paymentMode: initialData?.paymentMode || '',
    paymentDate: initialData?.paymentDate || new Date().toISOString().split('T')[0],
    transactionReference: initialData?.transactionReference || '',
    accountsRemarks: initialData?.accountsRemarks || '',
    accountsImages: initialData?.accountsImages || []
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showAccountsUploads, setShowAccountsUploads] = useState((initialData?.accountsImages?.length || 0) > 0)

  const updateField = (field: Stage5Field, value: Stage5FormData[Stage5Field]) => {
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
    if (!formData.actualAmount) newErrors.actualAmount = 'Actual amount is required'
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

  const costDifference = parseFloat(formData.actualAmount || '0') - orderDetails.estimatedCost

  return (
    <form onSubmit={handleSubmit} autoComplete="off" className="relative">
      <Card className="border-none shadow-[0_20px_50px_rgba(8,_112,_184,_0.07)] overflow-hidden rounded-[2.5rem] bg-white">
        <CardHeader className="bg-slate-900 p-8 text-white relative">
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-[#023468] rounded-xl">
                <Receipt className="h-6 w-6 text-white" />
              </div>
              <h2 className="text-3xl font-black tracking-tight">Accounts Processing</h2>
            </div>
            <p className="text-slate-400 font-medium max-w-2xl">
              Finalize procurement lifecycle: verify invoice details, confirm payment status, and archive the transaction records.
            </p>
          </div>
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#023468]/10 rounded-full blur-3xl -mr-20 -mt-20" />
        </CardHeader>

        <CardContent className="p-8 lg:p-12 space-y-12">
          {/* Executive Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-50 rounded-[2rem] p-6 border border-slate-100 transition-all hover:shadow-lg">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Estimated Cost</span>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-xl shadow-sm">
                  <TrendingUp className="h-5 w-5 text-indigo-500" />
                </div>
                <span className="text-2xl font-black text-slate-900">₹{orderDetails.estimatedCost.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <div className="bg-[#edf4fb] rounded-[2rem] p-6 border border-[#d7e4ef] transition-all hover:shadow-lg">
              <span className="text-[10px] font-black text-[#023468] uppercase tracking-widest block mb-2">Actual Billed</span>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-xl shadow-sm">
                  <CreditCard className="h-5 w-5 text-[#023468]" />
                </div>
                <span className="text-2xl font-black text-[#012348]">₹{parseFloat(formData.actualAmount || '0').toLocaleString('en-IN')}</span>
              </div>
            </div>
            <div className={cn(
              "rounded-[2rem] p-6 border transition-all hover:shadow-lg",
              costDifference > 0 ? "bg-rose-50 border-rose-100" : "bg-blue-50 border-blue-100"
            )}>
              <span className={cn("text-[10px] font-black uppercase tracking-widest block mb-2", costDifference > 0 ? "text-rose-600" : "text-blue-600")}>Variance</span>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-xl shadow-sm">
                  {costDifference > 0 ? <AlertTriangle className="h-5 w-5 text-rose-500" /> : <CheckCircle2 className="h-5 w-5 text-blue-500" />}
                </div>
                <span className={cn("text-2xl font-black", costDifference > 0 ? "text-rose-900" : "text-blue-900")}>
                  {costDifference > 0 ? '+' : ''}₹{Math.abs(costDifference).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Left Column: Documentation */}
            <div className="space-y-8">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-6 bg-indigo-500 rounded-full" />
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Invoice Documentation</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="invoiceNumber" className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Invoice Number</Label>
                  <Input
                    id="invoiceNumber"
                    value={formData.invoiceNumber}
                    onChange={(e) => updateField('invoiceNumber', e.target.value)}
                    placeholder="INV-2024-XXXX"
                    className={cn("rounded-2xl border-slate-200 h-14 px-5 focus:ring-[#023468] focus:border-[#023468]", errors.invoiceNumber && "border-rose-500 bg-rose-50")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoiceDate" className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Invoice Date</Label>
                  <Input
                    id="invoiceDate"
                    type="date"
                    value={formData.invoiceDate}
                    onChange={(e) => updateField('invoiceDate', e.target.value)}
                    className="rounded-2xl border-slate-200 h-14 px-5 focus:ring-[#023468] focus:border-[#023468]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="actualAmount" className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Final Amount (INR)</Label>
                <div className="relative">
                  <Input
                    id="actualAmount"
                    type="number"
                    value={formData.actualAmount}
                    onChange={(e) => updateField('actualAmount', e.target.value)}
                    className={cn("rounded-2xl border-slate-200 h-14 px-5 pl-12 font-bold text-lg", errors.actualAmount && "border-rose-500 bg-rose-50")}
                  />
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Attachments</Label>
                <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-700">Upload Payment Proof or Invoice</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Supports PDF, JPG, PNG (Max 10MB)
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant={showAccountsUploads ? 'secondary' : 'outline'}
                      onClick={() => setShowAccountsUploads((value) => !value)}
                      className="rounded-2xl"
                    >
                      <UploadCloud className="mr-2 h-4 w-4" />
                      {showAccountsUploads ? 'Hide Uploads' : 'Enable Uploads'}
                    </Button>
                  </div>

                  {showAccountsUploads && (
                    <div className="mt-4">
                      <MultipleImageUpload
                        label="Accounts Documents"
                        images={formData.accountsImages}
                        onImagesChange={(images) => updateField('accountsImages', images)}
                        maxImages={10}
                        orderId={orderId}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Payment Details */}
            <div className="space-y-8">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-6 bg-[#023468] rounded-full" />
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Payment Confirmation</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Status</Label>
                  <Select
                    value={formData.paymentStatus}
                    onValueChange={(value) => updateField('paymentStatus', value)}
                  >
                    <SelectTrigger className={cn("rounded-2xl border-slate-200 h-14 px-5 bg-white shadow-none", errors.paymentStatus && "border-rose-500 bg-rose-50")}>
                      <SelectValue placeholder="Select Status" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 shadow-2xl p-2 bg-white">
                      <SelectItem value="no_gap_payment_released" className="rounded-xl py-3 focus:bg-[#edf4fb]">Payment Released</SelectItem>
                      <SelectItem value="gap_observed_need_clarification" className="rounded-xl py-3 focus:bg-amber-50">Needs Clarification</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Method</Label>
                  <Select
                    value={formData.paymentMode}
                    onValueChange={(value) => updateField('paymentMode', value)}
                  >
                    <SelectTrigger className={cn("rounded-2xl border-slate-200 h-14 px-5 bg-white shadow-none", errors.paymentMode && "border-rose-500 bg-rose-50")}>
                      <SelectValue placeholder="Select Mode" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100 shadow-2xl p-2 bg-white">
                      <SelectItem value="bank_transfer" className="rounded-xl py-3">Bank Transfer</SelectItem>
                      <SelectItem value="cash" className="rounded-xl py-3">Cash</SelectItem>
                      <SelectItem value="credit_card" className="rounded-xl py-3">Credit Card</SelectItem>
                      <SelectItem value="cheque" className="rounded-xl py-3">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="paymentDate" className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Execution Date</Label>
                <Input
                  id="paymentDate"
                  type="date"
                  value={formData.paymentDate}
                  onChange={(e) => updateField('paymentDate', e.target.value)}
                  className="rounded-2xl border-slate-200 h-14 px-5 focus:ring-[#023468] focus:border-[#023468]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="transactionReference" className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Reference (UTR / Check No.)</Label>
                <Input
                  id="transactionReference"
                  value={formData.transactionReference}
                  onChange={(e) => updateField('transactionReference', e.target.value)}
                  placeholder="Enter reference number"
                  className="rounded-2xl border-slate-200 h-14 px-5 focus:ring-[#023468] focus:border-[#023468]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="accountsRemarks" className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Internal Remarks</Label>
                <Textarea
                  id="accountsRemarks"
                  value={formData.accountsRemarks}
                  onChange={(e) => updateField('accountsRemarks', e.target.value)}
                  placeholder="Additional processing notes for executive review..."
                  className="rounded-[2rem] border-slate-200 p-6 min-h-[140px] focus:ring-[#023468] focus:border-[#023468]"
                />
              </div>
            </div>
          </div>

          <div className="pt-10 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-4 p-4 bg-amber-50 rounded-2xl border border-amber-100 max-w-md">
              <AlertTriangle className="h-6 w-6 text-amber-500 flex-shrink-0" />
              <p className="text-xs text-amber-800 font-medium">
                Ensure all documents are verified before final submission. This action will permanently close the purchase order workflow.
              </p>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="bg-[#023468] hover:bg-[#012348] text-white rounded-[2rem] px-12 h-20 text-xl font-black shadow-2xl shadow-[#023468]/15 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 min-w-[320px]"
            >
              {isLoading ? (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span>Processing...</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-7 w-7" />
                  <span>COMPLETE ORDER</span>
                </div>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}

