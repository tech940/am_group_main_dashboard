'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MultipleImageUpload } from './multiple-image-upload'
import { ImageGallery } from './image-gallery'
import { Save, Loader2 } from 'lucide-react'

export type VendorSectionKey = 'vendorA' | 'vendorB' | 'vendorC'

export interface VendorSectionData {
  key: VendorSectionKey
  label: string
  name: string
  images: Array<File | string>
}

export interface Stage2FormData {
  vendorOptions: VendorSectionData[]
  vendorName: string
  vendorImages: Array<File | string>
}

interface Stage2Props {
  orderId: string
  initialData?: {
    vendorName?: string
    vendorImages?: string[]
    vendorOptions?: VendorSectionData[]
  }
  onSubmit: (data: Stage2FormData) => Promise<void>
  isLoading?: boolean
}

interface VendorInformationSummaryProps {
  vendorName?: string | null
  vendorImages?: string[] | null
  vendorOptions?: VendorSectionData[] | null
}

const VENDOR_SECTIONS: Array<{ key: VendorSectionKey; label: string }> = [
  { key: 'vendorA', label: 'Vendor A' },
  { key: 'vendorB', label: 'Vendor B' },
  { key: 'vendorC', label: 'Vendor C' },
]

function normalizeVendorOptions(initialData?: Stage2Props['initialData']) {
  const sourceOptions = Array.isArray(initialData?.vendorOptions) ? initialData.vendorOptions : []

  return VENDOR_SECTIONS.map((section, index) => {
    const existing = sourceOptions.find((item) => item.key === section.key)
    const legacyName = index === 0 ? initialData?.vendorName || '' : ''
    const legacyImages = index === 0 ? initialData?.vendorImages || [] : []

    return {
      key: section.key,
      label: section.label,
      name: existing?.name || legacyName,
      images: existing?.images || legacyImages,
    }
  })
}

function getCompletedVendorOptions(options: VendorSectionData[]) {
  return options
    .map((option) => ({
      ...option,
      name: option.name.trim(),
      images: option.images.filter((image): image is File | string => Boolean(image)),
    }))
    .filter((option) => option.name || option.images.length > 0)
}

export function VendorInformationSummary({
  vendorName,
  vendorImages,
  vendorOptions,
}: VendorInformationSummaryProps) {
  const options = useMemo(() => {
    const normalized = normalizeVendorOptions({
      vendorName: vendorName || '',
      vendorImages: vendorImages || [],
      vendorOptions: vendorOptions || [],
    })

    return getCompletedVendorOptions(normalized)
  }, [vendorImages, vendorName, vendorOptions])

  if (options.length === 0) {
    return null
  }

  return (
    <Card className="border-none shadow-xl">
      <CardHeader className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white">
        <CardTitle className="text-2xl font-black">Vendor Information</CardTitle>
        <p className="mt-1 text-sm text-blue-50">Submitted vendor details for approval review</p>
      </CardHeader>
      <CardContent className="space-y-5 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          {options.map((option) => (
            <div key={option.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{option.label}</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{option.name || 'Not provided'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {option.images.length} uploaded document{option.images.length === 1 ? '' : 's'}
              </p>
            </div>
          ))}
        </div>

        {options.map((option) => {
          const imageUrls = option.images.filter((image): image is string => typeof image === 'string' && image.length > 0)

          return imageUrls.length > 0 ? (
            <ImageGallery key={`${option.key}-images`} images={imageUrls} title={`${option.label} Documents`} />
          ) : null
        })}
      </CardContent>
    </Card>
  )
}

export function Stage2VendorInformation({ initialData, onSubmit, isLoading }: Stage2Props) {
  const [vendorOptions, setVendorOptions] = useState<VendorSectionData[]>(() => normalizeVendorOptions(initialData))
  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateVendor = (
    key: VendorSectionKey,
    field: 'name' | 'images',
    value: string | Array<File | string>
  ) => {
    setVendorOptions((current) => current.map((vendor) => (
      vendor.key === key ? { ...vendor, [field]: value } : vendor
    )))
    setErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const validate = () => {
    const completedOptions = getCompletedVendorOptions(vendorOptions)

    if (completedOptions.length === 0) {
      setErrors({ vendorA: 'Enter at least one vendor name' })
      return false
    }

    setErrors({})
    return true
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!validate()) {
      return
    }

    const completedOptions = getCompletedVendorOptions(vendorOptions)

    await onSubmit({
      vendorOptions,
      vendorName: completedOptions.map((vendor) => vendor.name).filter(Boolean).join(', '),
      vendorImages: completedOptions.flatMap((vendor) => vendor.images),
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
          <CardTitle className="text-2xl font-black">Vendor Information</CardTitle>
          <p className="mt-1 text-sm text-blue-50">Add vendor details and quotation documents separately.</p>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="grid gap-5 xl:grid-cols-3">
            {vendorOptions.map((vendor) => (
              <div key={vendor.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <Label htmlFor={`${vendor.key}-name`} className="mb-2 block text-base font-black text-slate-900">
                  {vendor.label}
                </Label>
                <Input
                  id={`${vendor.key}-name`}
                  value={vendor.name}
                  onChange={(event) => updateVendor(vendor.key, 'name', event.target.value)}
                  placeholder={`Enter ${vendor.label} name`}
                  className={errors[vendor.key] ? 'border-red-500' : ''}
                />
                {errors[vendor.key] && (
                  <p className="mt-1 text-xs text-red-500">{errors[vendor.key]}</p>
                )}

                <div className="mt-4">
                  <MultipleImageUpload
                    label={`${vendor.label} Images`}
                    images={vendor.images}
                    onImagesChange={(images) => updateVendor(vendor.key, 'images', images)}
                    maxImages={10}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={isLoading}
              className="rounded-2xl bg-gradient-to-r from-blue-500 to-blue-600 px-8 py-6 text-lg font-semibold text-white hover:from-blue-600 hover:to-blue-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-5 w-5" />
                  Save Vendor Information
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
