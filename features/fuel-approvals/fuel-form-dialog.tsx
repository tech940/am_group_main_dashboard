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
  Plus,
  Sparkles,
  ExternalLink,
  Trash2,
} from 'lucide-react'
import {
  FUEL_LOCATIONS,
  FUEL_REQUIRED_FOR_OPTIONS,
  PRECONFIGURED_VEHICLES,
  FUEL_TYPES,
  detectFuelType,
  parseFuelSlipUrls,
} from '@/lib/fuel-approvals/constants'
import type { FuelApprovalRecord, FuelLocation, FuelRequiredFor, FuelType } from '@/lib/fuel-approvals/types'

interface SlipItem {
  url: string
  name: string
}

interface FuelFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  initialData?: FuelApprovalRecord | null
}

async function compressImageFile(file: File, maxDim = 1600, quality = 0.8): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file)
            return
          }
          const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          })
          resolve(compressedFile)
        },
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}

function formatDateForInput(val?: string | null): string {
  if (!val) return ''
  const str = String(val).trim()
  if (str.includes('T')) return str.split('T')[0]
  if (str.length >= 10) return str.slice(0, 10)
  return str
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
  const [slips, setSlips] = useState<SlipItem[]>([])
  const [remarks, setRemarks] = useState<string>('')

  // State for auto-detecting last fuel date
  const [checkingLastFuel, setCheckingLastFuel] = useState(false)
  const [lastFuelAutoDetected, setLastFuelAutoDetected] = useState<{
    date: string
    ltrs?: string | null
    requestNumber?: string
  } | null>(null)
  const [userManuallyEditedLastFuel, setUserManuallyEditedLastFuel] = useState(false)
  const userManuallyEditedRef = useRef(false)
  const [userManuallyEditedVin, setUserManuallyEditedVin] = useState(false)
  const userManuallyEditedVinRef = useRef(false)
  const [autoDetectedVin, setAutoDetectedVin] = useState<string | null>(null)
  const lastFetchedQueryRef = useRef<string>('')

  const [uploading, setUploading] = useState(false)
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
      setUserManuallyEditedVin(Boolean(initialData.vinNo))
      userManuallyEditedVinRef.current = Boolean(initialData.vinNo)
      setAutoDetectedVin(null)
      setLastFuelFilledDate(formatDateForInput(initialData.lastFuelFilledDate))
      setUserManuallyEditedLastFuel(Boolean(initialData.lastFuelFilledDate))
      userManuallyEditedRef.current = Boolean(initialData.lastFuelFilledDate)
      setFuelType((initialData.fuelType as FuelType) || 'PETROL')
      setCurrentKmReading(initialData.currentKmReading || '')
      setFuelFilledDate(formatDateForInput(initialData.fuelFilledDate) || new Date().toISOString().slice(0, 10))
      setFuelFilledLtrs(String(initialData.fuelFilledLtrs || ''))
      setRemarks(initialData.remarks || '')

      const parsedUrls = parseFuelSlipUrls(initialData.fuelSlipUrl)
      setSlips(
        parsedUrls.map((url, i) => ({
          url,
          name: parsedUrls.length > 1 ? `Slip ${i + 1}` : 'Attached Fuel Slip',
        }))
      )
      setLastFuelAutoDetected(null)
      lastFetchedQueryRef.current = ''
    } else if (open) {
      resetForm()
    }
  }, [initialData, open])

  const resetForm = () => {
    setLocation('KIA JAMMU')
    setFuelRequiredFor('DEMO')
    setVehRegNo('')
    setIsCustomVehicle(false)
    setVinNo('')
    setUserManuallyEditedVin(false)
    userManuallyEditedVinRef.current = false
    setAutoDetectedVin(null)
    setLastFuelFilledDate('')
    setUserManuallyEditedLastFuel(false)
    userManuallyEditedRef.current = false
    setFuelType('PETROL')
    setCurrentKmReading('')
    setFuelFilledDate(new Date().toISOString().slice(0, 10))
    setFuelFilledLtrs('')
    setSlips([])
    setRemarks('')
    setLastFuelAutoDetected(null)
    lastFetchedQueryRef.current = ''
  }

  // Auto-check last fuel date and VIN when vehicle changes (or VIN changes when no vehicle set)
  useEffect(() => {
    if (!open || isEditing) return
    const vehicleQuery = vehRegNo.trim()
    const vinQuery = vinNo.trim()

    if (!vehicleQuery && !vinQuery) {
      setLastFuelAutoDetected(null)
      setAutoDetectedVin(null)
      lastFetchedQueryRef.current = ''
      return
    }

    // Lookup is keyed primarily on vehicleQuery if available, else vinQuery
    const queryKey = vehicleQuery
      ? `veh:${vehicleQuery.toLowerCase()}`
      : `vin:${vinQuery.toLowerCase()}`

    if (queryKey === lastFetchedQueryRef.current) {
      return
    }

    let isMounted = true
    const timer = setTimeout(async () => {
      try {
        setCheckingLastFuel(true)
        const params = new URLSearchParams()
        if (vehicleQuery) {
          params.set('vehicle', vehicleQuery)
        } else if (vinQuery) {
          params.set('vin', vinQuery)
        }

        const res = await fetch(`/api/fuel-approvals/last-fuel?${params.toString()}`)
        if (!res.ok) return
        const data = await res.json()

        if (isMounted) {
          lastFetchedQueryRef.current = queryKey
          if (data?.lastFuel) {
            const lf = data.lastFuel
            const detectedDate = formatDateForInput(lf.fuelFilledDate)
            if (detectedDate) {
              setLastFuelAutoDetected({
                date: detectedDate,
                ltrs: lf.fuelFilledLtrs,
                requestNumber: lf.requestNumber,
              })
              // Only auto-populate date if user has not manually edited/customized it
              if (!userManuallyEditedRef.current) {
                setLastFuelFilledDate(detectedDate)
              }
            }
            // If VIN is detected from historical record
            if (lf.vinNo) {
              setAutoDetectedVin(lf.vinNo)
              // Only auto-populate VIN if user has NOT manually edited it
              if (!userManuallyEditedVinRef.current) {
                setVinNo(lf.vinNo)
              }
            }
          }
        }
      } catch (err) {
        console.warn('Could not auto-fetch last fuel info:', err)
      } finally {
        if (isMounted) setCheckingLastFuel(false)
      }
    }, 400)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [vehRegNo, !vehRegNo ? vinNo : '', open, isEditing])

  const handleVehicleSelect = (value: string) => {
    if (value === '__custom__') {
      setIsCustomVehicle(true)
      setVehRegNo('')
      userManuallyEditedRef.current = false
      setUserManuallyEditedLastFuel(false)
      userManuallyEditedVinRef.current = false
      setUserManuallyEditedVin(false)
      setAutoDetectedVin(null)
      setLastFuelAutoDetected(null)
      lastFetchedQueryRef.current = ''
      return
    }
    setIsCustomVehicle(false)
    setVehRegNo(value)
    userManuallyEditedRef.current = false
    setUserManuallyEditedLastFuel(false)
    userManuallyEditedVinRef.current = false
    setUserManuallyEditedVin(false)
    setAutoDetectedVin(null)
    setLastFuelAutoDetected(null)
    lastFetchedQueryRef.current = ''

    const detected = detectFuelType(value)
    if (detected) {
      setFuelType(detected)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    const filesToUpload = Array.from(fileList)

    // Validate size
    for (const f of filesToUpload) {
      if (f.size > 25 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: `"${f.name}" is over 25MB. Please choose smaller files.`,
          variant: 'error',
        })
        return
      }
    }

    try {
      setUploading(true)
      const newSlips: SlipItem[] = []

      for (const rawFile of filesToUpload) {
        // Compress if image
        const uploadFile = await compressImageFile(rawFile, 1600, 0.8)
        const formData = new FormData()
        formData.append('file', uploadFile)

        const res = await fetch('/api/fuel-approvals/upload', {
          method: 'POST',
          body: formData,
        })

        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || `Failed to upload ${rawFile.name}`)
        }

        newSlips.push({
          url: data.url,
          name: rawFile.name,
        })
      }

      setSlips((prev) => [...prev, ...newSlips])
      toast({
        title: newSlips.length > 1 ? 'Slips uploaded' : 'Slip uploaded',
        description: `${newSlips.length} receipt${newSlips.length > 1 ? 's' : ''} attached successfully.`,
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
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeSlip = (index: number) => {
    setSlips((prev) => prev.filter((_, i) => i !== index))
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
    if (slips.length === 0) {
      toast({ title: 'Fuel slip required', description: 'Please upload at least one fuel slip or pump receipt', variant: 'error' })
      return
    }

    setSubmitting(true)
    try {
      const fuelSlipUrl =
        slips.length > 1
          ? JSON.stringify(slips.map((s) => s.url))
          : slips[0].url

      const payload = {
        location,
        fuelRequiredFor,
        vehRegNo: vehRegNo.trim(),
        vinNo: vinNo.trim(),
        lastFuelFilledDate: lastFuelFilledDate ? formatDateForInput(lastFuelFilledDate) : null,
        fuelType,
        currentKmReading: currentKmReading.trim() || null,
        fuelFilledDate: formatDateForInput(fuelFilledDate),
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
        description: data.message || 'Fuel approval request submitted for review.',
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
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between">
          <div>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              {isEditing ? 'Re-Submit Fuel Record' : 'Fuel Requisition Form'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isEditing
                ? 'Update fuel dispensing details and re-submit for review'
                : 'Record vehicle, genset or stockyard fuel dispensing for approval'}
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
                  setLastFuelAutoDetected(null)
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  VIN / Serial No. <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  {vinNo && (
                    <button
                      type="button"
                      onClick={() => {
                        userManuallyEditedVinRef.current = true
                        setUserManuallyEditedVin(true)
                        setVinNo('')
                      }}
                      className="text-[11px] text-slate-400 hover:text-rose-600 font-medium cursor-pointer"
                      title="Clear VIN"
                    >
                      Clear
                    </button>
                  )}
                  <span className="text-[11px] text-slate-400 font-normal">chassis / serial</span>
                </div>
              </div>
              <Input
                type="text"
                placeholder="e.g. 672868"
                value={vinNo}
                onChange={(e) => {
                  userManuallyEditedVinRef.current = true
                  setUserManuallyEditedVin(true)
                  setVinNo(e.target.value)
                }}
                className="h-10 text-xs font-mono rounded-xl uppercase"
                required
              />
              {autoDetectedVin && (
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-teal-700 dark:text-teal-400 font-medium">
                  <span className="truncate">
                    Auto-detected VIN: <span className="font-mono">{autoDetectedVin}</span>
                  </span>
                  {vinNo !== autoDetectedVin && (
                    <button
                      type="button"
                      onClick={() => {
                        userManuallyEditedVinRef.current = false
                        setUserManuallyEditedVin(false)
                        setVinNo(autoDetectedVin)
                      }}
                      className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline font-semibold shrink-0 cursor-pointer"
                    >
                      Reset to detected
                    </button>
                  )}
                </div>
              )}
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
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span>Last Fuel Filled Date</span>
                  {checkingLastFuel && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-teal-600 font-normal">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      checking...
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  {lastFuelFilledDate && (
                    <button
                      type="button"
                      onClick={() => {
                        userManuallyEditedRef.current = true
                        setUserManuallyEditedLastFuel(true)
                        setLastFuelFilledDate('')
                      }}
                      className="text-[11px] text-slate-400 hover:text-rose-600 font-medium cursor-pointer"
                      title="Clear last fuel filled date"
                    >
                      Clear
                    </button>
                  )}
                  <span className="text-[11px] text-slate-400 font-normal">optional</span>
                </div>
              </div>
              <Input
                type="date"
                value={formatDateForInput(lastFuelFilledDate)}
                onChange={(e) => {
                  userManuallyEditedRef.current = true
                  setUserManuallyEditedLastFuel(true)
                  setLastFuelFilledDate(e.target.value)
                }}
                className="h-10 text-xs rounded-xl"
              />
              {lastFuelAutoDetected && (
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-teal-700 dark:text-teal-400 font-medium">
                  <div className="flex items-center gap-1 min-w-0 truncate">
                    <Sparkles className="w-3 h-3 shrink-0" />
                    <span className="truncate">
                      Auto-detected: {lastFuelAutoDetected.date}
                      {lastFuelAutoDetected.ltrs ? ` (${lastFuelAutoDetected.ltrs} Ltrs)` : ''}
                    </span>
                  </div>
                  {lastFuelFilledDate !== lastFuelAutoDetected.date && (
                    <button
                      type="button"
                      onClick={() => {
                        userManuallyEditedRef.current = false
                        setUserManuallyEditedLastFuel(false)
                        setLastFuelFilledDate(lastFuelAutoDetected.date)
                      }}
                      className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline font-semibold shrink-0 cursor-pointer"
                    >
                      Reset to detected
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Row 5: Fuel Filled Date & Liters Filled */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Fuel Filled Date <span className="text-rose-500">*</span>
                </label>
                {fuelFilledDate !== new Date().toISOString().slice(0, 10) && (
                  <button
                    type="button"
                    onClick={() => setFuelFilledDate(new Date().toISOString().slice(0, 10))}
                    className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline font-medium cursor-pointer"
                  >
                    Today
                  </button>
                )}
              </div>
              <Input
                type="date"
                value={formatDateForInput(fuelFilledDate)}
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

          {/* Row 6: Fuel Slips / Receipts (Multi-slip upload) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Fuel Slip(s) / Pump Receipts <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] text-slate-400 font-normal">
                {slips.length > 0 ? `${slips.length} slip${slips.length > 1 ? 's' : ''} attached` : 'Multiple slips allowed'}
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />

            {slips.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {slips.map((slip, idx) => {
                  const isPdf = slip.url.toLowerCase().includes('.pdf')
                  return (
                    <div
                      key={`${slip.url}-${idx}`}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 gap-2 overflow-hidden"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {isPdf ? (
                          <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                        ) : (
                          <img
                            src={slip.url}
                            alt={`Slip ${idx + 1}`}
                            className="w-8 h-8 object-cover rounded-lg border border-slate-200 dark:border-slate-700 shrink-0 bg-white"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {slip.name || `Slip #${idx + 1}`}
                          </p>
                          <a
                            href={slip.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 dark:text-teal-400 hover:underline"
                          >
                            <span>View</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeSlip(idx)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded-md transition-colors"
                        title="Remove slip"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer ${
                slips.length > 0 ? 'h-10' : 'h-14'
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
                  <span>Compressing & uploading slip(s)...</span>
                </>
              ) : (
                <>
                  {slips.length > 0 ? (
                    <>
                      <Plus className="w-4 h-4 text-teal-700" />
                      <span>+ Attach Another Slip (Image or PDF)</span>
                    </>
                  ) : (
                    <>
                      <Paperclip className="w-4 h-4 text-slate-400" />
                      <span>Attach Fuel Slip(s) (Images or PDF — select one or more)</span>
                    </>
                  )}
                </>
              )}
            </button>
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
              Approval track: Submit → Review → Approval
            </span>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="rounded-xl text-xs font-semibold h-9 px-4 cursor-pointer"
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
                  'Re-Submit for Approval'
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
