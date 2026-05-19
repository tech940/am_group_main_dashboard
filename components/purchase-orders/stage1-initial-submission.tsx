'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Send, Loader2, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BRANCH_OPTIONS } from '@/lib/branches'

interface Stage1FormData {
  branch: string
  department: string
  subDepartment: string
  specifyOther?: string
  requestedBy: string
  specialInstructions: string
  quantityRequired: string
  estimateIfAny?: string
}

interface Stage1Props {
  onSubmit: (data: Stage1FormData) => Promise<void>
  isLoading?: boolean
  onCancel?: () => void
  onDirtyChange?: (isDirty: boolean) => void
  initialData?: Partial<Stage1FormData>
  mode?: 'create' | 'edit'
}

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

type Stage1Field = keyof Stage1FormData

export function Stage1InitialSubmission({
  onSubmit,
  isLoading,
  onCancel,
  onDirtyChange,
  initialData,
  mode = 'create',
}: Stage1Props) {
  const [formData, setFormData] = useState<Stage1FormData>({
    branch: initialData?.branch || '',
    department: initialData?.department || '',
    subDepartment: initialData?.subDepartment || '',
    specifyOther: initialData?.specifyOther || '',
    requestedBy: initialData?.requestedBy || '',
    specialInstructions: initialData?.specialInstructions || '',
    quantityRequired: initialData?.quantityRequired || '',
    estimateIfAny: initialData?.estimateIfAny || '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const isDirty = Boolean(
    formData.department
    || formData.branch
    || formData.subDepartment
    || formData.specifyOther
    || formData.requestedBy
    || formData.specialInstructions
    || formData.quantityRequired
    || formData.estimateIfAny
  )

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const updateField = (field: Stage1Field, value: Stage1FormData[Stage1Field]) => {
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

    if (!formData.branch) newErrors.branch = 'Branch is required'
    if (!formData.department) newErrors.department = 'Department is required'
    if (!formData.subDepartment) newErrors.subDepartment = 'Sub Department is required'
    if (!formData.requestedBy) newErrors.requestedBy = 'Requested By is required'
    if (!formData.specialInstructions) newErrors.specialInstructions = 'Special instructions are required'
    if (!formData.quantityRequired) newErrors.quantityRequired = 'Quantity is required'

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
          <div className="flex items-center justify-between gap-4">
            <div>
          <CardTitle className="text-2xl font-black">
            {mode === 'edit' ? 'Edit Purchase Request' : 'Initial Purchase Request'}
          </CardTitle>
          <p className="text-sm text-teal-50 mt-1">
                {mode === 'edit'
                  ? 'Update the purchase request details and save the correction'
                  : 'Fill in the details below to submit your purchase request for EA approval'}
          </p>
            </div>
            {onCancel && (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                className="rounded-2xl border border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Branch and Department Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <Label htmlFor="branch" className="mb-2 block">
                Branch <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.branch}
                onValueChange={(value) => updateField('branch', value)}
              >
                <SelectTrigger className={cn('bg-white', errors.branch ? 'border-red-500' : '')}>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent className="bg-white max-h-60">
                  {BRANCH_OPTIONS.map((branch) => (
                    <SelectItem key={branch.value} value={branch.value}>
                      {branch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.branch && (
                <p className="text-xs text-red-500 mt-1">{errors.branch}</p>
              )}
            </div>

            <div>
              <Label htmlFor="department" className="mb-2 block">
                Department <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.department}
                onValueChange={(value) => updateField('department', value)}
              >
                <SelectTrigger className={cn('bg-white', errors.department ? 'border-red-500' : '')}>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent className="bg-white max-h-60">
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
                onValueChange={(value) => updateField('subDepartment', value)}
              >
                <SelectTrigger className={cn('bg-white', errors.subDepartment ? 'border-red-500' : '')}>
                  <SelectValue placeholder="Select sub department" />
                </SelectTrigger>
                <SelectContent className="bg-white max-h-60">
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
              <Label htmlFor="specifyOther" className="mb-2 block">
                Specify Other
              </Label>
              <Input
                id="specifyOther"
                value={formData.specifyOther}
                onChange={(e) => updateField('specifyOther', e.target.value)}
                placeholder="If other, please specify"
              />
            </div>
          </div>

          {/* Request Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <Label htmlFor="requestedBy" className="mb-2 block">
                Requested By <span className="text-red-500">*</span>
              </Label>
              <Input
                id="requestedBy"
                value={formData.requestedBy}
                onChange={(e) => updateField('requestedBy', e.target.value)}
                placeholder="Enter your name"
                className={errors.requestedBy ? 'border-red-500' : ''}
              />
              {errors.requestedBy && (
                <p className="text-xs text-red-500 mt-1">{errors.requestedBy}</p>
              )}
            </div>

            <div>
              <Label htmlFor="quantityRequired" className="mb-2 block">
                Quantity Required <span className="text-red-500">*</span>
              </Label>
              <Input
                id="quantityRequired"
                value={formData.quantityRequired}
                onChange={(e) => updateField('quantityRequired', e.target.value)}
                placeholder="Enter quantity"
                className={errors.quantityRequired ? 'border-red-500' : ''}
              />
              {errors.quantityRequired && (
                <p className="text-xs text-red-500 mt-1">{errors.quantityRequired}</p>
              )}
            </div>

            <div>
              <Label htmlFor="estimateIfAny" className="mb-2 block">
                Estimate If Any
              </Label>
              <Input
                id="estimateIfAny"
                type="number"
                value={formData.estimateIfAny}
                onChange={(e) => updateField('estimateIfAny', e.target.value)}
                placeholder="Enter estimate amount"
              />
            </div>
          </div>

          {/* Special Instructions */}
          <div>
            <Label htmlFor="specialInstructions" className="mb-2 block">
              Special Instructions or Remarks (Detailed) <span className="text-red-500">*</span>
            </Label>
            <textarea
              id="specialInstructions"
              value={formData.specialInstructions}
              onChange={(e) => updateField('specialInstructions', e.target.value)}
              placeholder="Enter detailed instructions about what you need"
              rows={4}
              className={cn(
                'w-full px-3 py-2 border rounded-md resize-none',
                errors.specialInstructions ? 'border-red-500' : 'border-slate-300'
              )}
            />
            {errors.specialInstructions && (
              <p className="text-xs text-red-500 mt-1">{errors.specialInstructions}</p>
            )}
          </div>

          {/* Submit Button */}
          <div className="flex flex-col gap-3 pt-4 md:flex-row md:justify-end">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                className="rounded-2xl border-slate-300 px-6 py-6"
              >
                Close
              </Button>
            )}
            <Button
              type="submit"
              disabled={isLoading}
              className="rounded-2xl bg-gradient-to-r from-teal-500 to-teal-600 px-8 py-6 text-lg font-semibold text-white hover:from-teal-600 hover:to-teal-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  {mode === 'edit' ? 'Saving...' : 'Submitting...'}
                </>
              ) : (
                <>
                  <Send className="h-5 w-5 mr-2" />
                  {mode === 'edit' ? 'Save Changes' : 'Submit Request'}
                </>
              )}
            </Button>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> {mode === 'edit'
                ? 'Saving changes updates this purchase order without changing its current workflow stage.'
                : 'After submission, this purchase order moves directly into the EA approval queue. Vendor information can be added later by the Purchase Manager without blocking approvals.'}
            </p>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}

// Made with Bob
