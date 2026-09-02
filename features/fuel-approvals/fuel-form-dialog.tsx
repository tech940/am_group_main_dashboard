'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  X,
  Paperclip,
  ArrowRight,
} from 'lucide-react'
import {
  FUEL_LOCATIONS,
  FUEL_REQUIRED_FOR_OPTIONS,
  PRECONFIGURED_VEHICLES,
  FUEL_TYPES,
  detectFuelType,
} from '@/lib/fuel-approvals/constants'
import type { FuelApprovalRecord, FuelLocation, FuelRequiredFor, FuelType } from '@/lib/fuel-approvals/types'

interface FuelFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  initialData?: FuelApprovalRecord | null
}

export function FuelFormDialog({
  open,
  onOpenChange,
  onSuccess,
  initialData,
}: FuelFormDialogProps) {
  const isEditing = Boolean(initialData)

  const [location, setLocation] = useState<FuelLocation>('KIA JAMMU')
  const [fuelRequiredFor, setFuelRequiredFor] = useState<FuelRequiredFor>('DEMO')
  const [vehRegNo, setVehRegNo] = useState<string>('')
  const [isCustomVehicle, setIsCustomVehicle] = useState(false)
  const [vinNo, setVinNo] = useState<string>('')
  const [lastFuelFilledDate, setLastFuelFilledDate] = useState<string>('')
  const [fuelType, setFuelType] = useState<FuelType>('PETROL')
  const [currentKmReading, setCurrentKmReading] = useState<string>('')
  const [fuelFilledDate, setFuelFilledDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  )
  const [fuelFilledLtrs, setFuelFilledLtrs] = useState<string>('')
  const [fuelSlipUrl, setFuelSlipUrl] = useState<string>('')
  const [remarks, setRemarks] = useState<string>('')

  const [uploading, setUploading] = useState(false)
  const [uploadFileName, setUploadFileName] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Hydrate form if editing / re-submitting
  useEffect(() => {
    if (initialData) {
      setLocation((initialData.location as FuelLocation) || 'KIA JAMMU')
      setFuelRequiredFor((initialData.fuelRequiredFor as FuelRequiredFor) || 'DEMO')
      setVehRegNo(initialData.vehRegNo || '')
      setIsCustomVehicle(!PRECONFIGURED_VEHICLES.includes(initialData.vehRegNo as any))
      setVinNo(initialData.vinNo || '')
      setLastFuelFilledDate(initialData.lastFuelFilledDate || '')
      setFuelType((initialData.fuelType as FuelType) || 'PETROL')
      setCurrentKmReading(initialData.currentKmReading || '')
      setFuelFilledDate(initialData.fuelFilledDate || new Date().toISOString().slice(0, 10))
      setFuelFilledLtrs(String(initialData.fuelFilledLtrs || ''))
      setFuelSlipUrl(initialData.fuelSlipUrl || '')
      setRemarks(initialData.remarks || '')
      setUploadFileName(initialData.fuelSlipUrl ? 'Attached Fuel Slip' : '')
    } else {
      resetForm()
    }
  }, [initialData, open])

  const resetForm = () => {
    setLocation('KIA JAMMU')
    setFuelRequiredFor('DEMO')
    setVehRegNo('')
    setIsCustomVehicle(false)
    setVinNo('')
    setLastFuelFilledDate('')
    setFuelType('PETROL')
    setCurrentKmReading('')
    setFuelFilledDate(new Date().toISOString().slice(0, 10))
    setFuelFilledLtrs('')
    setFuelSlipUrl('')
    setRemarks('')
    setUploadFileName('')
  }

  const handleVehicleSelect = (value: string) => {
    if (value === '__custom__') {
      setIsCustomVehicle(true)
      setVehRegNo('')
      return
    }
    setIsCustomVehicle(false)
    setVehRegNo(value)

    const detected = detectFuelType(value)
    if (detected) {
      setFuelType(detected)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 25 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Fuel slip file must be under 25MB.',
        variant: 'error',
      })
      return
    }

    try {
      setUploading(true)
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/fuel-approvals/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload file')
      }

      setFuelSlipUrl(data.url)
      setUploadFileName(file.name)
      toast({
        title: 'File uploaded',
        description: `${file.name} attached successfully.`,
        variant: 'success',
      })
    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err.message || 'Could not upload fuel slip',
        variant: 'error',
      })
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!location) {
      toast({ title: 'Location required', description: 'Please select a dealership location', variant: 'error' })
      return
    }
    if (!fuelRequiredFor) {
      toast({ title: 'Purpose required', description: 'Please select what fuel is required for', variant: 'error' })
      return
    }
    if (!vehRegNo.trim()) {
      toast({ title: 'Vehicle details required', description: 'Please select or enter vehicle registration details', variant: 'error' })
      return
    }
    if (!vinNo.trim()) {
      toast({ title: 'VIN required', description: 'Please provide vehicle VIN or chassis identifier', variant: 'error' })
      return
    }
    if (!fuelType) {
      toast({ title: 'Fuel type required', description: 'Please select Petrol or Diesel', variant: 'error' })
      return
    }
    if (!fuelFilledDate) {
      toast({ title: 'Date required', description: 'Please select the fuel filled date', variant: 'error' })
      return
    }
    const ltrsNum = parseFloat(fuelFilledLtrs)
    if (isNaN(ltrsNum) || ltrsNum <= 0) {
      toast({ title: 'Invalid quantity', description: 'Please enter valid liters filled (> 0)', variant: 'error' })
      return
    }
    if (!fuelSlipUrl) {
      toast({ title: 'Fuel slip required', description: 'Please upload the fuel slip or pump receipt', variant: 'error' })
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        location,
        fuelRequiredFor,
        vehRegNo: vehRegNo.trim(),
        vinNo: vinNo.trim(),
        lastFuelFilledDate: lastFuelFilledDate || null,
        fuelType,
        currentKmReading: currentKmReading.trim() || null,
        fuelFilledDate,
        fuelFilledLtrs: ltrsNum,
        fuelSlipUrl,
        remarks: remarks.trim() || null,
      }

      const url = isEditing
        ? `/api/fuel-approvals/${initialData!.id}/resubmit`
        : '/api/fuel-approvals'

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit fuel approval request')
      }

      toast({
        title: isEditing ? 'Request re-submitted' : 'Request submitted',
        description: data.message || 'Fuel approval request submitted to ED for review.',
        variant: 'success',
      })

      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      toast({
        title: 'Submission failed',
        description: err.message || 'Could not save fuel approval request',
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        {/* Clean, Tasteful Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between">
          <div>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              {isEditing ? 'Re-Submit Fuel Record' : 'Fuel Requisition Form'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isEditing
                ? 'Update fuel dispensing details and re-submit for ED review'
                : 'Record vehicle, genset or stockyard fuel dispensing for ED → HR → MD approval'}
            </DialogDescription>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Row 1: Location & Purpose */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Location <span className="text-rose-500">*</span>
              </label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value as FuelLocation)}
                className="w-full h-10 px-3 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {FUEL_LOCATIONS.map((loc) => (
                  <option key={loc.value} value={loc.value}>
                    {loc.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Fuel Required For <span className="text-rose-500">*</span>
              </label>
              <select
                value={fuelRequiredFor}
                onChange={(e) => setFuelRequiredFor(e.target.value as FuelRequiredFor)}
                className="w-full h-10 px-3 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {FUEL_REQUIRED_FOR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Vehicle Selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Vehicle / Item Identifier <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setIsCustomVehicle(!isCustomVehicle)
                  setVehRegNo('')
                }}
                className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
              >
                {isCustomVehicle ? 'Choose from list' : '+ Enter custom name'}
              </button>
            </div>

            {isCustomVehicle ? (
              <Input
                type="text"
                placeholder="e.g. Seltos HTX - JK02AB1234 or Genset Yard"
                value={vehRegNo}
                onChange={(e) => {
                  setVehRegNo(e.target.value)
                  const detected = detectFuelType(e.target.value)
                  if (detected) setFuelType(detected)
                }}
                className="h-10 text-xs rounded-xl"
                required
              />
            ) : (
              <select
                value={vehRegNo}
                onChange={(e) => handleVehicleSelect(e.target.value)}
                className="w-full h-10 px-3 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600 truncate cursor-pointer"
                required
              >
                <option value="">Select vehicle from dealership inventory...</option>
                {PRECONFIGURED_VEHICLES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
                <option value="__custom__">+ Custom entry...</option>
              </select>
            )}
          </div>

          {/* Row 3: VIN & Fuel Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                VIN / Serial No. <span className="text-rose-500">*</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. 672868"
                value={vinNo}
                onChange={(e) => setVinNo(e.target.value)}
                className="h-10 text-xs font-mono rounded-xl"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Fuel Type <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2 h-10">
                {FUEL_TYPES.map((ft) => (
                  <button
                    type="button"
                    key={ft.value}
                    onClick={() => setFuelType(ft.value)}
                    className={`h-full rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                      fuelType === ft.value
                        ? 'bg-teal-700 text-white border-teal-700 shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {ft.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 4: KM Reading & Last Filled Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Current KM Reading
                </label>
                <span className="text-[11px] text-slate-400 font-normal">optional</span>
              </div>
              <div className="relative">
                <Input
                  type="text"
                  placeholder="e.g. 212"
                  value={currentKmReading}
                  onChange={(e) => setCurrentKmReading(e.target.value)}
                  className="h-10 text-xs rounded-xl pr-10"
                />
                <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-medium">km</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Last Fuel Filled Date
                </label>
                <span className="text-[11px] text-slate-400 font-normal">optional</span>
              </div>
              <Input
                type="date"
                value={lastFuelFilledDate}
                onChange={(e) => setLastFuelFilledDate(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />
            </div>
          </div>

          {/* Row 5: Fuel Filled Date & Liters Filled */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Fuel Filled Date <span className="text-rose-500">*</span>
              </label>
              <Input
                type="date"
                value={fuelFilledDate}
                onChange={(e) => setFuelFilledDate(e.target.value)}
                className="h-10 text-xs rounded-xl"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Fuel Filled Quantity (Liters) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  min="0.1"
                  placeholder="e.g. 7.00"
                  value={fuelFilledLtrs}
                  onChange={(e) => setFuelFilledLtrs(e.target.value)}
                  className="h-10 text-xs rounded-xl pr-12 font-medium"
                  required
                />
                <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-bold">Ltrs</span>
              </div>
            </div>
          </div>

          {/* Row 6: Fuel Slip / Receipt Upload */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Fuel Slip / Pump Receipt <span className="text-rose-500">*</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleFileUpload}
            />

            {fuelSlipUrl ? (
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {uploadFileName || 'Fuel Slip Attached'}
                  </span>
                  <a
                    href={fuelSlipUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline shrink-0"
                  >
                    View ↗
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFuelSlipUrl('')
                    setUploadFileName('')
                  }}
                  className="text-slate-400 hover:text-rose-600 p-1 rounded-md"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
                    <span>Uploading receipt...</span>
                  </>
                ) : (
                  <>
                    <Paperclip className="w-4 h-4 text-slate-400" />
                    <span>Attach Fuel Slip (Image or PDF)</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Row 7: Remarks */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Notes / Remarks
              </label>
              <span className="text-[11px] text-slate-400 font-normal">optional</span>
            </div>
            <Textarea
              placeholder="Any dispenser meter notes or context..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="text-xs rounded-xl min-h-[64px]"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] text-slate-400">
              Approval track: ED → HR → MD
            </span>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="rounded-xl text-xs font-semibold h-9 px-4"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || uploading}
                className="rounded-xl text-xs font-semibold h-9 px-5 bg-teal-700 hover:bg-teal-800 text-white shadow-xs cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Submitting...
                  </>
                ) : isEditing ? (
                  'Re-Submit to ED'
                ) : (
                  'Submit Fuel Order'
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
