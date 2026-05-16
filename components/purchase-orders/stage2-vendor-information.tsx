'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MultipleImageUpload } from './multiple-image-upload'
import { Save, Loader2 } from 'lucide-react'

interface Stage2FormData {
  vendorName: string
  vendorImages: File[]
}

interface Stage2Props {
  orderId: string
  initialData?: Partial<Stage2FormData>
  onSubmit: (data: Stage2FormData) => Promise<void>
  isLoading?: boolean
}

export function Stage2VendorInformation({ orderId, initialData, onSubmit, isLoading }: Stage2Props) {
  const [formData, setFormData] = useState<Stage2FormData>({
    vendorName: initialData?.vendorName || '',
    vendorImages: initialData?.vendorImages || []
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateField = (field: keyof Stage2FormData, value: any) => {
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
    if (!formData.vendorName) newErrors.vendorName = 'Vendor name is required'
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
        <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
          <CardTitle className="text-2xl font-black">
            Vendor Information
          </CardTitle>
          <p className="text-sm text-blue-50 mt-1">
            Purchase Manager: Fill in vendor details and quotations
          </p>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div>
            <Label htmlFor="vendorName" className="mb-2 block">
              Vendor Name (Multiple vendors: include all names) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="vendorName"
              value={formData.vendorName}
              onChange={(e) => updateField('vendorName', e.target.value)}
              placeholder="Enter vendor name(s)"
              className={errors.vendorName ? 'border-red-500' : ''}
            />
            {errors.vendorName && (
              <p className="text-xs text-red-500 mt-1">{errors.vendorName}</p>
            )}
          </div>

          <MultipleImageUpload
            label="Vendor Quotations"
            images={formData.vendorImages}
            onImagesChange={(images) => updateField('vendorImages', images)}
            maxImages={10}
          />

          <div className="flex justify-end pt-4">
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-8 py-6 text-lg font-semibold"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-5 w-5 mr-2" />
                  Save & Submit for Approval
                </>
              )}
            </Button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> After submission, this request will be sent to EA and MD for approval.
            </p>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}

// Made with Bob
