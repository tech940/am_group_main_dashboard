'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MultipleImageUpload } from './multiple-image-upload'
import { Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Stage1FormData {
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

export function Stage1InitialSubmission({ onSubmit, isLoading }: Stage1Props) {
  const [formData, setFormData] = useState<Stage1FormData>({
    department: '',
    subDepartment: '',
    specifyOther: '',
    requestedBy: '',
    specialInstructions: '',
    quantityRequired: '',
    estimateIfAny: ''
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateField = (field: keyof Stage1FormData, value: any) => {
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
          <CardTitle className="text-2xl font-black">
            Initial Purchase Request
          </CardTitle>
          <p className="text-sm text-teal-50 mt-1">
            Fill in the details below to submit your purchase request
          </p>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Department Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          <div className="flex justify-end pt-4">
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white px-8 py-6 text-lg font-semibold"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="h-5 w-5 mr-2" />
                  Submit Request
                </>
              )}
            </Button>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> After submission, your request will be sent to the Purchase Manager for vendor information and further processing. You will not be able to edit this request once submitted.
            </p>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}

// Made with Bob