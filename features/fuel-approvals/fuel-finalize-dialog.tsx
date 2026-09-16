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
  ExternalLink,
  Eye,
  Trash2,
  Receipt,
  Fuel,
  MapPin,
  Calendar,
  PencilLine,
} from 'lucide-react'
import { parseFuelSlipUrls, getFuelFinalization, getFuelQuantities, isNonVehiclePurpose } from '@/lib/fuel-approvals/constants'
import type { FuelApprovalRecord } from '@/lib/fuel-approvals/types'

interface SlipItem {
  url: string
  name: string
}

interface FuelFinalizeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: FuelApprovalRecord | null
  onSuccess?: () => void
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

export function FuelFinalizeDialog({
  open,
  onOpenChange,
  record,
  onSuccess,
}: FuelFinalizeDialogProps) {
  const [totalCost, setTotalCost] = useState<string>('')
  const [slips, setSlips] = useState<SlipItem[]>([])
  const [remarks, setRemarks] = useState<string>('')
  // Migration 0071: what actually went in, where, and whether the tank was filled.
  const [actualLitres, setActualLitres] = useState<string>('')
  const [odometer, setOdometer] = useState<string>('')
  const [fullTank, setFullTank] = useState<boolean | null>(null)
  const [station, setStation] = useState<string>('')
  const [pumpLitres, setPumpLitres] = useState<{ passNo: string; litres: number } | null>(null)
  // The gate pass this order is (or will be) tied to. Older requests had no way to pick one when raised.
  const [passId, setPassId] = useState<string>('')
  const [passOptions, setPassOptions] = useState<{ id: string; passNo: string; registrationNumber: string | null; model: string | null; vin: string; fuelLitres: number | null; fuelAmount: number | null }[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (record && open) {
      setTotalCost(
        record.totalCost !== undefined && record.totalCost !== null ? String(record.totalCost) : ''
      )
      const parsedUrls = parseFuelSlipUrls(record.fuelSlipUrl)
      setSlips(
        parsedUrls.map((url, i) => ({
          url,
          name: parsedUrls.length > 1 ? `Slip ${i + 1}` : 'Attached Fuel Slip',
        }))
      )
      setRemarks('')
      const quantities = getFuelQuantities(record)
      setActualLitres(quantities.actual !== null ? String(quantities.actual) : '')
      const odo = record.odometerKm ?? null
      setOdometer(odo !== null && odo !== undefined && String(odo) !== '' ? String(Number(odo)) : (record.currentKmReading || '').replace(/[^0-9.]/g, ''))
      setFullTank(typeof record.isFullTank === 'boolean' ? record.isFullTank : null)
      setStation(record.stationName || '')
    } else if (!open) {
      setTotalCost('')
      setSlips([])
      setRemarks('')
      setActualLitres('')
      setOdometer('')
      setFullTank(null)
      setStation('')
      setPumpLitres(null)
    }
  }, [record, open])

  /*
   * The linked "Fuel filling" gate pass carries a pump-meter reading. When the order has no actual yet, that
   * reading is the best evidence there is, so it is offered — never silently saved.
   */
  const linkedPassId = record?.gatePassId ?? null
  const recordId = record?.id ?? null
  useEffect(() => {
    setPassId(linkedPassId ?? '')
    if (!open || !recordId) {
      setPassOptions([])
      return
    }
    let cancelled = false
    fetch(`/api/fuel-approvals/gate-passes?forRequest=${encodeURIComponent(recordId)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { passes: [] }))
      .then((data: { passes?: typeof passOptions }) => {
        if (!cancelled) setPassOptions(Array.isArray(data.passes) ? data.passes : [])
      })
      .catch(() => {
        if (!cancelled) setPassOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [open, linkedPassId, recordId])

  useEffect(() => {
    const pass = passOptions.find((p) => p.id === passId)
    setPumpLitres(pass && pass.fuelLitres !== null ? { passNo: pass.passNo, litres: pass.fuelLitres } : null)
  }, [passId, passOptions])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    const filesToUpload = Array.from(fileList)

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
        title: newSlips.length > 1 ? 'Attachments uploaded' : 'Attachment uploaded',
        description: `${newSlips.length} file${newSlips.length > 1 ? 's' : ''} added successfully.`,
        variant: 'success',
      })
    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err.message || 'Could not upload attachment',
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

  const handleFinalizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!record) return

    const costNum = totalCost.trim() ? parseFloat(totalCost) : null
    if (costNum !== null && (isNaN(costNum) || costNum <= 0)) {
      toast({
        title: 'Invalid fuel cost',
        description: 'Please enter a valid positive number for fuel cost',
        variant: 'error',
      })
      return
    }

    const actualNum = actualLitres.trim() ? Number(actualLitres) : null
    const alreadyClosed = getFuelFinalization(record).finalized
    if (actualNum === null && !alreadyClosed) {
      toast({ title: 'Actual litres required', description: 'Enter the litres on the bill or the pump meter.', variant: 'error' })
      return
    }
    if (actualNum !== null && (!Number.isFinite(actualNum) || actualNum <= 0)) {
      toast({ title: 'Invalid actual litres', description: 'Enter a number above zero.', variant: 'error' })
      return
    }
    const vehicleFill = !isNonVehiclePurpose(record.fuelRequiredFor)
    const odoNum = odometer.trim() ? Number(odometer.replace(/[,\s]/g, '')) : null
    if (odoNum !== null && (!Number.isFinite(odoNum) || odoNum < 0)) {
      toast({ title: 'Invalid odometer', description: 'Enter the reading in kilometres.', variant: 'error' })
      return
    }
    if (vehicleFill && !alreadyClosed && (odoNum === null || fullTank === null)) {
      toast({
        title: odoNum === null ? 'Odometer required' : 'Full tank?',
        description: odoNum === null ? 'Enter the odometer reading at the fill.' : 'Say whether the tank was filled full.',
        variant: 'error',
      })
      return
    }

    setSubmitting(true)
    try {
      const fuelSlipUrl =
        slips.length > 1
          ? JSON.stringify(slips.map((s) => s.url))
          : slips.length === 1
          ? slips[0].url
          : record.fuelSlipUrl

      const payload = {
        totalCost: costNum,
        fuelSlipUrl,
        remarks: remarks.trim() || undefined,
        actualQuantity: actualNum ?? undefined,
        odometerKm: odoNum ?? undefined,
        isFullTank: fullTank ?? undefined,
        stationName: station.trim(),
        ...(passId !== (record.gatePassId ?? '') ? { gatePassId: passId || null } : {}),
      }

      const res = await fetch(`/api/fuel-approvals/${record.id}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to finalize fuel approval')
      }

      /*
       * ⚠️ SAY WHERE IT WENT. Finalising removes the order from the To Finalise queue, so without this
       * the row simply vanishes from the list the person is working through and nothing explains it.
       */
      const wasFinalized = getFuelFinalization(record).finalized
      toast({
        title: wasFinalized ? 'Finalised order updated' : 'Fuel order finalised',
        description: wasFinalized
          ? `${record.requestNumber} updated. It stays in Completed.`
          : `${record.requestNumber} is complete and has moved to the Completed section.`,
        variant: 'success',
      })

      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      toast({
        title: 'Finalize failed',
        description: err.message || 'Could not finalize fuel order',
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (!record) return null

  /*
   * ⚠️ Reached by two different intents — finalising for the first time, and correcting an order that
   * is already closed. The form is identical; the words must not be, or an edit reads as though it is
   * about to do something that already happened.
   */
  const isEdit = getFuelFinalization(record).finalized
  const quantities = getFuelQuantities(record)
  const isVehicleFill = !isNonVehiclePurpose(record.fuelRequiredFor)
  const actualPreview = actualLitres.trim() && Number(actualLitres) > 0 ? Number(actualLitres) : null
  const approvedBase = quantities.approved ?? quantities.requested
  const variance = actualPreview !== null && approvedBase !== null ? actualPreview - approvedBase : null
  const trio: { label: string; value: number | null; note?: string }[] = [
    { label: 'Requested', value: quantities.requested },
    { label: 'Approved', value: quantities.approved, note: quantities.approved === null ? 'not recorded' : undefined },
    { label: 'Actual', value: actualPreview, note: actualPreview === null ? 'enter below' : undefined },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto p-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-md">
                {record.requestNumber}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                CEO Approved
              </span>
            </div>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100 mt-1">
              {isEdit ? 'Edit Finalised Fuel Order' : 'Finalise Fuel Order'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isEdit
                ? 'Correct the recorded amount, add or remove slips. The change is written to the order history.'
                : 'Record final fuel amount, verify pump bill totals, and attach multiple invoices or slips'}
            </DialogDescription>
          </div>
        </div>

        {/* Order Context Card */}
        <div className="mx-6 mt-5 p-4 rounded-xl border border-slate-200/90 bg-slate-50/70 dark:bg-slate-800/60 dark:border-slate-700 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
              {record.vehRegNo}
            </span>
            <span className="font-bold text-teal-700 dark:text-teal-400 flex items-center gap-1">
              <Fuel className="w-3.5 h-3.5" />
              {record.fuelFilledLtrs} L {record.fuelType}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-slate-400 text-[11px] pt-1 border-t border-slate-200/60 dark:border-slate-700">
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3 text-slate-400" />
              <span>{record.location}</span>
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3 text-slate-400" />
              <span>{record.fuelFilledDate} · {record.fuelRequiredFor}</span>
            </div>
          </div>
        </div>

        {/* Requested → Approved → Actual (migration 0071) */}
        <div className="mx-6 mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          {trio.map((item, index) => (
            <div key={item.label} className={`px-3 py-2.5 ${index > 0 ? 'border-l border-slate-200 dark:border-slate-700' : ''}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{item.label}</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {item.value !== null ? `${item.value} L` : <span className="font-medium text-slate-400">{item.note}</span>}
              </p>
            </div>
          ))}
        </div>
        {variance !== null && Math.abs(variance) >= 0.01 && (
          <p className="mx-6 mt-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
            Actual is {Math.abs(variance).toFixed(2)} L {variance > 0 ? 'more' : 'less'} than approved.
          </p>
        )}

        {/* Form Body */}
        <form onSubmit={handleFinalizeSubmit} className="p-6 pt-4 space-y-4.5">
          {/* Actual litres, odometer, full tank, station */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="finalize-actual" className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Actual litres filled {!isEdit && <span className="text-rose-500">*</span>}
              </label>
              <Input
                id="finalize-actual"
                type="number"
                step="0.01"
                min="0"
                placeholder="From the bill or pump meter"
                value={actualLitres}
                onChange={(e) => setActualLitres(e.target.value)}
                className="h-10 text-xs rounded-xl font-bold text-slate-900"
                autoFocus
              />
              {pumpLitres && String(pumpLitres.litres) !== actualLitres.trim() && (
                <button
                  type="button"
                  onClick={() => setActualLitres(String(pumpLitres.litres))}
                  className="mt-1 text-[11px] font-semibold text-teal-700 hover:underline cursor-pointer"
                >
                  Use pump meter on {pumpLitres.passNo}: {pumpLitres.litres} L
                </button>
              )}
            </div>
            <div>
              <label htmlFor="finalize-odometer" className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Odometer at fill (km) {isVehicleFill && !isEdit && <span className="text-rose-500">*</span>}
                {!isVehicleFill && <span className="font-normal text-slate-400"> not needed</span>}
              </label>
              <Input
                id="finalize-odometer"
                type="number"
                step="1"
                min="0"
                placeholder="e.g. 12450"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                disabled={!isVehicleFill}
                className="h-10 text-xs rounded-xl font-medium"
              />
            </div>
            {isVehicleFill && (
              <fieldset>
                <legend className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Tank filled full? {!isEdit && <span className="text-rose-500">*</span>}
                </legend>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tank filled full">
                  {([['Yes, full tank', true], ['No, partial', false]] as const).map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={fullTank === value}
                      onClick={() => setFullTank(value)}
                      className={`h-10 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                        fullTank === value
                          ? 'border-teal-700 bg-teal-700 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Mileage is only measured between full tanks.</p>
              </fieldset>
            )}
            <div className="sm:col-span-2">
              <label htmlFor="finalize-pass" className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Fuel-filling gate pass <span className="font-normal text-slate-400">links the pump-meter reading</span>
              </label>
              <select
                id="finalize-pass"
                value={passId}
                onChange={(e) => setPassId(e.target.value)}
                className="w-full h-10 px-3 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="">No gate pass</option>
                {passOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.passNo} — ${p.registrationNumber || `VIN …${p.vin.slice(-6)}`}${p.model ? ` · ${p.model}` : ''}${p.fuelLitres !== null ? ` · pump ${p.fuelLitres} L` : ''}${p.fuelAmount !== null ? ` · ₹${p.fuelAmount}` : ''}`}
                  </option>
                ))}
                {passId && !passOptions.some((p) => p.id === passId) && <option value={passId}>Linked pass</option>}
              </select>
            </div>
            <div>
              <label htmlFor="finalize-station" className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Fuel station <span className="font-normal text-slate-400">optional</span>
              </label>
              <Input
                id="finalize-station"
                type="text"
                maxLength={120}
                placeholder="e.g. IOCL Gangyal"
                value={station}
                onChange={(e) => setStation(e.target.value)}
                className="h-10 text-xs rounded-xl"
              />
            </div>
          </div>

          {/* Fuel Cost Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-slate-500" />
                <span>Actual Fuel Cost / Amount Paid (₹)</span>
              </label>
              <span className="text-[11px] text-slate-400 font-normal">optional</span>
            </div>
            <div className="relative">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 1850.00"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                className="h-10 text-xs rounded-xl pr-8 font-bold text-slate-900"
              />
              <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-bold">₹</span>
            </div>
            {totalCost && !isNaN(parseFloat(totalCost)) && parseFloat(totalCost) > 0 && (actualPreview ?? 0) > 0 && (
              <p className="mt-1 text-[11px] text-teal-700 dark:text-teal-400 font-medium">
                Effective rate: ₹{(parseFloat(totalCost) / (actualPreview as number)).toFixed(2)} per litre actually filled
              </p>
            )}
          </div>

          {/* Attachments Section (Multiple Slips Allowed) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                <span>Fuel Slips &amp; Invoices</span>
              </label>
              <span className="text-[11px] text-slate-400 font-normal">
                {slips.length > 0 ? `${slips.length} attached (multiple allowed)` : 'Attach receipts or bills'}
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
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-800 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-2 py-0.5 rounded border border-teal-200/80 dark:border-teal-800 hover:bg-teal-100 transition-colors cursor-pointer mt-0.5"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Preview</span>
                          </a>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeSlip(idx)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded-md transition-colors cursor-pointer"
                        title="Remove attachment"
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
              className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-teal-600 dark:hover:border-teal-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-teal-50/30 transition-all text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                  <span>Uploading attachments...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  <span>+ Attach More Slips / Bill Receipts (Multiple allowed)</span>
                </>
              )}
            </button>
          </div>

          {/* Finalization Remarks */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Final Notes / Payment Reference <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <Textarea
              rows={2}
              placeholder="e.g. Paid via Petty Cash / Dispenser invoice #10293..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="text-xs rounded-xl"
            />
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || uploading}
              className="rounded-xl text-xs font-bold bg-teal-700 hover:bg-teal-800 text-white min-w-[130px] shadow-xs cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Saving...
                </>
              ) : (
                <>
                  {isEdit ? <PencilLine className="w-3.5 h-3.5 mr-1.5" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                  {isEdit ? 'Save Changes' : 'Finalise Order'}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
