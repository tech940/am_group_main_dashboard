'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { 
  ClipboardList, 
  Building2, 
  Package, 
  CreditCard,
  ChevronRight,
  ChevronLeft,
  Check,
  Upload,
  X
} from 'lucide-react'

interface FormData {
  // Stage 1: Order Request
  reqType?: string
  department?: string
  subDepartment?: string
  specifyOther?: string
  requestedBy?: string
  specialInstructions?: string
  quantityRequired?: string
  estimateIfAny?: string
  
  // Stage 2: Vendor Information
  vendorName?: string
  quotation1?: File | null
  quotation2?: File | null
  quotation3?: File | null
  
  // Stage 3: GRN
  receivedDate?: string
  receivedTime?: string
  handoverTo?: string
  remarksIfAny?: string
  amount?: string
  invoice1?: File | null
  invoice2?: File | null
  invoice3?: File | null
  invoice4?: File | null
  
  // Stage 4: Account Details
  paymentStatus?: string
  paymentMode?: string
  accountRemarks?: string
  paymentScreenshot?: File | null
}

const stages = [
  { id: 1, name: 'Order Request', icon: ClipboardList, key: 'order_request' },
  { id: 2, name: 'Vendor Information', icon: Building2, key: 'vendor_information' },
  { id: 3, name: 'GRN', icon: Package, key: 'grn' },
  { id: 4, name: 'Account Details', icon: CreditCard, key: 'account_details' }
]

const departments = [
  'AM HYUNDAI SALES',
  'AM HYUNDAI SERVICE',
  'AM HYUNDIA PLATINUM SALES',
  'AM HYUNDIA PLATINUM SERVICE',
  'SMAM TATA SALES',
  'SMAM TATA SERVICE',
  'MG SALES',
  'MG SERVICE',
  'AM GLOBAL',
  'DIAMOND HONDA SERVICE',
  'DIAMOND HONDA SALES',
  'BAJAJ SALES',
  'BAJAJ SERVICE',
  'KIA SALES',
  'KIA SERVICE',
  'KTM SALES',
  'KTM SERVICE',
  'TRIUMP SERVICE',
  'TRIUMP SALES'
]

const subDepartments = [
  'ACCOUNTS',
  'HR',
  'ADMIN',
  'HP ROMISE',
  'SERVICE',
  'SALES',
  'BODYSHOP',
  'CRM',
  'EDP / IT',
  'SPARE PARTS',
  'SALES & SERVICE',
  'Accessories',
  'INSURANCE',
  'STOCK YARD',
  'PANTRY',
  'HOUSEKEEPING',
  'Electrical',
  'FUEL DEMO',
  'FUEL GENSET',
  'FUEL NEW CAR DELIVERY',
  'FUEL STOCK TRANSFER'
]

interface MultiStageFormProps {
  onSubmit: (data: FormData) => Promise<void>
  initialData?: Partial<FormData>
  isLoading?: boolean
}

export function MultiStageForm({ onSubmit, initialData, isLoading }: MultiStageFormProps) {
  const [currentStage, setCurrentStage] = useState(1)
  const [formData, setFormData] = useState<FormData>(initialData || {})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateFormData = (field: keyof FormData, value: FormData[keyof FormData]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }
  }

  const validateStage = (stage: number): boolean => {
    const newErrors: Record<string, string> = {}

    if (stage === 1) {
      if (!formData.department) newErrors.department = 'Department is required'
      if (!formData.subDepartment) newErrors.subDepartment = 'Sub Department is required'
      if (!formData.specialInstructions) newErrors.specialInstructions = 'Special instructions are required'
      if (!formData.quantityRequired) newErrors.quantityRequired = 'Quantity is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (validateStage(currentStage)) {
      setCurrentStage(prev => Math.min(prev + 1, 4))
    }
  }

  const handlePrevious = () => {
    setCurrentStage(prev => Math.max(prev - 1, 1))
  }

  const handleSubmit = async () => {
    if (validateStage(currentStage)) {
      await onSubmit(formData)
    }
  }

  const handleFileChange = (field: keyof FormData, file: File | null) => {
    updateFormData(field, file)
  }

  const removeFile = (field: keyof FormData) => {
    updateFormData(field, null)
  }

  return (
    <div className="space-y-6">
      {/* Stage Progress */}
      <div className="flex items-center justify-between">
        {stages.map((stage, index) => (
          <div key={stage.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={cn(
                  'h-12 w-12 rounded-full flex items-center justify-center border-2 transition-all',
                  currentStage > stage.id
                    ? 'bg-[#023468] border-[#023468] text-white'
                    : currentStage === stage.id
                    ? 'bg-white border-[#023468] text-[#023468]'
                    : 'bg-white border-slate-300 text-slate-400'
                )}
              >
                {currentStage > stage.id ? (
                  <Check className="h-6 w-6" />
                ) : (
                  <stage.icon className="h-6 w-6" />
                )}
              </div>
              <span
                className={cn(
                  'text-xs font-semibold mt-2 text-center',
                  currentStage >= stage.id ? 'text-slate-700' : 'text-slate-400'
                )}
              >
                {stage.name}
              </span>
            </div>
            {index < stages.length - 1 && (
              <div
                className={cn(
                  'h-0.5 flex-1 mx-2 transition-all',
                  currentStage > stage.id ? 'bg-[#023468]' : 'bg-slate-300'
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Form Content */}
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-gradient-to-r from-slate-700 to-slate-800 text-white">
          <CardTitle className="text-xl font-black">
            {stages[currentStage - 1].name}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {/* Stage 1: Order Request */}
          {currentStage === 1 && (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <Label htmlFor="department" className="mb-2 block">
                    Department <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.department}
                    onValueChange={(value) => updateFormData('department', value)}
                  >
                    <SelectTrigger className={cn('bg-white', errors.department ? 'border-red-500' : '')}>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {departments.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.department && (
                    <p className="text-xs text-red-500 mt-1">{errors.department}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="subDepartment" className="mb-2 block">
                    Sub Department <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.subDepartment}
                    onValueChange={(value) => updateFormData('subDepartment', value)}
                  >
                    <SelectTrigger className={cn('bg-white', errors.subDepartment ? 'border-red-500' : '')}>
                      <SelectValue placeholder="Select sub department" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {subDepartments.map((subDept) => (
                        <SelectItem key={subDept} value={subDept}>
                          {subDept}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.subDepartment && (
                    <p className="text-xs text-red-500 mt-1">{errors.subDepartment}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="specifyOther" className="mb-2 block">Specify Other</Label>
                  <Input
                    id="specifyOther"
                    value={formData.specifyOther || ''}
                    onChange={(e) => updateFormData('specifyOther', e.target.value)}
                    placeholder="If other, please specify"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div>
                  <Label htmlFor="requestedBy" className="mb-2 block">Requested By</Label>
                  <Input
                    id="requestedBy"
                    value={formData.requestedBy || ''}
                    onChange={(e) => updateFormData('requestedBy', e.target.value)}
                    placeholder="Enter name"
                  />
                </div>
                <div>
                  <Label htmlFor="quantityRequired" className="mb-2 block">
                    Quantity Required <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="quantityRequired"
                    value={formData.quantityRequired || ''}
                    onChange={(e) => updateFormData('quantityRequired', e.target.value)}
                    placeholder="Enter quantity"
                    className={errors.quantityRequired ? 'border-red-500' : ''}
                  />
                  {errors.quantityRequired && (
                    <p className="text-xs text-red-500 mt-1">{errors.quantityRequired}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="estimateIfAny" className="mb-2 block">Estimate If Any</Label>
                  <Input
                    id="estimateIfAny"
                    value={formData.estimateIfAny || ''}
                    onChange={(e) => updateFormData('estimateIfAny', e.target.value)}
                    placeholder="Enter estimate amount"
                    type="number"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="specialInstructions" className="mb-2 block">
                  Special Instructions or Remarks (Detailed) <span className="text-red-500">*</span>
                </Label>
                <textarea
                  id="specialInstructions"
                  autoComplete="off"
                  value={formData.specialInstructions || ''}
                  onChange={(e) => updateFormData('specialInstructions', e.target.value)}
                  placeholder="Enter detailed instructions"
                  rows={4}
                  className={cn(
                    'w-full px-3 py-2 border rounded-md',
                    errors.specialInstructions ? 'border-red-500' : 'border-slate-300'
                  )}
                />
                {errors.specialInstructions && (
                  <p className="text-xs text-red-500 mt-1">{errors.specialInstructions}</p>
                )}
              </div>
            </div>
          )}

          {/* Stage 2: Vendor Information */}
          {currentStage === 2 && (
            <div className="space-y-6">
              <div>
                <Label htmlFor="vendorName" className="mb-2 block">
                  Vendor Name (In case of multiple vendors, include their names)
                </Label>
                <Input
                  id="vendorName"
                  value={formData.vendorName || ''}
                  onChange={(e) => updateFormData('vendorName', e.target.value)}
                  placeholder="Enter vendor name(s)"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                {[1, 2, 3].map((num) => {
                  const field = `quotation${num}` as keyof FormData
                  const file = formData[field] as File | null
                  
                  return (
                    <div key={num}>
                      <Label htmlFor={field} className="mb-2 block">
                        Upload Quotation {num} (Include vendor name when saving)
                      </Label>
                      <div className="mt-2">
                        {!file ? (
                          <label
                            htmlFor={field}
                            className="flex items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-[#023468] transition-colors"
                          >
                            <div className="text-center">
                              <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                              <p className="text-sm text-slate-600">Click to upload</p>
                              <p className="text-xs text-slate-400 mt-1">Max 100 MB</p>
                            </div>
                            <input
                              id={field}
                              type="file"
                              className="hidden"
                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                              onChange={(e) => handleFileChange(field, e.target.files?.[0] || null)}
                            />
                          </label>
                        ) : (
                          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <div className="flex items-center gap-2">
                              <Upload className="h-5 w-5 text-[#023468]" />
                              <span className="text-sm text-slate-700">{file.name}</span>
                            </div>
                            <button
                              onClick={() => removeFile(field)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <X className="h-5 w-5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Stage 3: GRN */}
          {currentStage === 3 && (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <Label htmlFor="receivedDate" className="mb-2 block">Received Date</Label>
                  <Input
                    id="receivedDate"
                    type="date"
                    value={formData.receivedDate || ''}
                    onChange={(e) => updateFormData('receivedDate', e.target.value)}
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    className="cursor-pointer"
                  />
                </div>
                <div>
                  <Label htmlFor="receivedTime" className="mb-2 block">Received Time</Label>
                  <Input
                    id="receivedTime"
                    type="time"
                    value={formData.receivedTime || ''}
                    onChange={(e) => updateFormData('receivedTime', e.target.value)}
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    className="cursor-pointer"
                  />
                </div>
                <div>
                  <Label htmlFor="amount" className="mb-2 block">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    value={formData.amount || ''}
                    onChange={(e) => updateFormData('amount', e.target.value)}
                    placeholder="Enter amount"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="handoverTo" className="mb-2 block">Handover To</Label>
                  <Input
                    id="handoverTo"
                    value={formData.handoverTo || ''}
                    onChange={(e) => updateFormData('handoverTo', e.target.value)}
                    placeholder="Enter name"
                  />
                </div>
                <div>
                  <Label htmlFor="remarksIfAny" className="mb-2 block">Remarks If Any</Label>
                  <Input
                    id="remarksIfAny"
                    value={formData.remarksIfAny || ''}
                    onChange={(e) => updateFormData('remarksIfAny', e.target.value)}
                    placeholder="Enter remarks"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6">
                {[1, 2, 3, 4].map((num) => {
                  const field = `invoice${num}` as keyof FormData
                  const file = formData[field] as File | null
                  
                  return (
                    <div key={num}>
                      <Label htmlFor={field} className="mb-2 block">Upload Invoice {num}</Label>
                      <div className="mt-2">
                        {!file ? (
                          <label
                            htmlFor={field}
                            className="flex items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-[#023468] transition-colors"
                          >
                            <div className="text-center">
                              <Upload className="h-6 w-6 mx-auto text-slate-400 mb-1" />
                              <p className="text-xs text-slate-600">Click to upload (Max 100 MB)</p>
                            </div>
                            <input
                              id={field}
                              type="file"
                              className="hidden"
                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                              onChange={(e) => handleFileChange(field, e.target.files?.[0] || null)}
                            />
                          </label>
                        ) : (
                          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <div className="flex items-center gap-2">
                              <Upload className="h-5 w-5 text-[#023468]" />
                              <span className="text-sm text-slate-700">{file.name}</span>
                            </div>
                            <button
                              onClick={() => removeFile(field)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <X className="h-5 w-5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Stage 4: Account Details */}
          {currentStage === 4 && (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <Label htmlFor="paymentStatus" className="mb-2 block">Status</Label>
                  <Select
                    value={formData.paymentStatus}
                    onValueChange={(value) => updateFormData('paymentStatus', value)}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value="NO GAP -PAYMENT RELEASED">NO GAP -PAYMENT RELEASED</SelectItem>
                      <SelectItem value="GAP OBSERVED NEED CLEARIFICATION">GAP OBSERVED NEED CLEARIFICATION</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-2">
                  <Label htmlFor="paymentMode" className="mb-2 block">Payment Mode</Label>
                  <Select
                    value={formData.paymentMode}
                    onValueChange={(value) => updateFormData('paymentMode', value)}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="Select payment mode" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value="bank_transfer">Online Transfer</SelectItem>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="accountRemarks" className="mb-2 block">Remarks</Label>
                <textarea
                  id="accountRemarks"
                  autoComplete="off"
                  value={formData.accountRemarks || ''}
                  onChange={(e) => updateFormData('accountRemarks', e.target.value)}
                  placeholder="Enter remarks"
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <Label htmlFor="paymentScreenshot" className="mb-2 block">Payment Screenshot</Label>
                <div className="mt-2">
                  {!formData.paymentScreenshot ? (
                    <label
                      htmlFor="paymentScreenshot"
                      className="flex items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-[#023468] transition-colors"
                    >
                      <div className="text-center">
                        <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                        <p className="text-sm text-slate-600">Click to upload</p>
                        <p className="text-xs text-slate-400 mt-1">Max 10 MB</p>
                      </div>
                      <input
                        id="paymentScreenshot"
                        type="file"
                        className="hidden"
                        accept=".jpg,.jpeg,.png,.pdf"
                        onChange={(e) => handleFileChange('paymentScreenshot', e.target.files?.[0] || null)}
                      />
                    </label>
                  ) : (
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex items-center gap-2">
                        <Upload className="h-5 w-5 text-[#023468]" />
                        <span className="text-sm text-slate-700">{formData.paymentScreenshot.name}</span>
                      </div>
                      <button
                        onClick={() => removeFile('paymentScreenshot')}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <Button
          onClick={handlePrevious}
          disabled={currentStage === 1 || isLoading}
          variant="outline"
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        
        {currentStage < 4 ? (
          <Button
            onClick={handleNext}
            disabled={isLoading}
            className="gap-2 bg-gradient-to-r from-[#023468] to-[#034b82]"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            className="gap-2 bg-gradient-to-r from-[#023468] to-[#034b82]"
          >
            {isLoading ? 'Submitting...' : 'Submit for Approval'}
            <Check className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

// Made with Bob
