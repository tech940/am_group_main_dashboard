'use client'

import React, { useState, useEffect } from 'react'
import {
  Camera,
  CheckCircle2,
  FileText,
  Fuel,
  Gauge,
  IndianRupee,
  Loader2,
  Upload,
  X,
  AlertCircle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { VehicleTrackerCamera } from '@/features/kia/vehicle-tracker-camera'

type FuelProofDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pass: {
    id: string
    passNo: string
    driverName: string
    registrationNumber: string | null
    model: string | null
    fuelSlipPath?: string | null
    pumpStartPath?: string | null
    pumpStopPath?: string | null
    fuelAmount?: string | number | null
    fuelLitres?: string | number | null
  } | null
  onSuccess: () => void
}

export function FuelProofDialog({ open, onOpenChange, pass, onSuccess }: FuelProofDialogProps) {
  const [fuelSlip, setFuelSlip] = useState<File | null>(null)
  const [pumpStart, setPumpStart] = useState<File | null>(null)
  const [pumpStop, setPumpStop] = useState<File | null>(null)
  const [cameraKey, setCameraKey] = useState<number>(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setFuelSlip(null)
    setPumpStart(null)
    setPumpStop(null)
    setCameraKey((k) => k + 1)
    setError('')
  }

  const hasExistingSlip = Boolean(pass?.fuelSlipPath)
  const hasExistingStart = Boolean(pass?.pumpStartPath)
  const hasExistingStop = Boolean(pass?.pumpStopPath)

  const isSlipProvided = Boolean(fuelSlip || hasExistingSlip)
  const isStartProvided = Boolean(pumpStart || hasExistingStart)
  const isStopProvided = Boolean(pumpStop || hasExistingStop)

  const allThreeReady = isSlipProvided && isStartProvided && isStopProvided

  const handleSubmit = async () => {
    if (!pass) return
    setError('')

    if (!isSlipProvided) {
      setError('1. Physical Fuel Slip image is required.')
      return
    }
    if (!isStartProvided) {
      setError('2. Pump Start (0.00) image is required.')
      return
    }
    if (!isStopProvided) {
      setError('3. Pump Stop (Amount) image is required.')
      return
    }

    setSaving(true)
    try {
      const formData = new FormData()
      if (fuelSlip) formData.append('fuelSlip', fuelSlip)
      if (pumpStart) formData.append('pumpStart', pumpStart)
      if (pumpStop) formData.append('pumpStop', pumpStop)

      const res = await fetch(`/api/gate-pass/${pass.id}/fuel-proofs`, {
        method: 'POST',
        body: formData,
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed to save fuel documents.')

      toast({
        title: 'Fuel Proofs Uploaded',
        description: `Fuel filling documents for ${pass.passNo} have been successfully verified and saved.`,
        variant: 'success',
      })

      reset()
      onOpenChange(false)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload fuel proofs.')
    } finally {
      setSaving(false)
    }
  }

  if (!pass) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Fuel className="h-5 w-5 text-amber-600 dark:text-amber-500" />
            Fuel Filling Proofs — {pass.passNo}
          </DialogTitle>
          <DialogDescription className="text-slate-500 dark:text-slate-400">
            Upload the 3 mandatory fuel documents captured at the petrol pump before this pass can be marked complete.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Vehicle info strip */}
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{pass.model}</span>
              <span className="rounded bg-white/80 dark:bg-slate-800 px-2 py-0.5 font-mono font-bold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                {pass.registrationNumber || 'No Plate'}
              </span>
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              Driver: <span className="font-semibold">{pass.driverName}</span>
            </div>
          </div>

          {/* 3 Proof Cards */}
          <div className="grid grid-cols-1 gap-4">
            {/* 1. Physical Fuel Slip */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-amber-600" />
                  1. Physical Fuel Slip *
                </Label>
                {isSlipProvided ? (
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    {fuelSlip ? 'Ready to upload' : 'Already on file'}
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                    Required
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">Photo of the physical printed receipt/slip from the petrol station.</p>
              <VehicleTrackerCamera
                key={`slip-${pass.id}-${cameraKey}`}
                label="Fuel Slip photo"
                onCapture={(file) => setFuelSlip(file)}
                allowUpload={true}
              />
            </div>

            {/* 2. Pump Start 0.00 */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Gauge className="h-4 w-4 text-blue-600" />
                  2. Pump Start (0.00) *
                </Label>
                {isStartProvided ? (
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    {pumpStart ? 'Ready to upload' : 'Already on file'}
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                    Required
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">Photo of the dispenser screen showing 0.00 before fueling begins.</p>
              <VehicleTrackerCamera
                key={`start-${pass.id}-${cameraKey}`}
                label="Pump Start 0.00 photo"
                onCapture={(file) => setPumpStart(file)}
                allowUpload={true}
              />
            </div>

            {/* 3. Pump Stop (Amount) */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <IndianRupee className="h-4 w-4 text-emerald-600" />
                  3. Pump Stop (Amount) *
                </Label>
                {isStopProvided ? (
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    {pumpStop ? 'Ready to upload' : 'Already on file'}
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                    Required
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">Photo of the dispenser screen after fueling showing total ₹ amount and litres.</p>
              <VehicleTrackerCamera
                key={`stop-${pass.id}-${cameraKey}`}
                label="Pump Stop Amount photo"
                onCapture={(file) => setPumpStop(file)}
                allowUpload={true}
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-md bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 p-3 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !allThreeReady}
            className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Fuel Documents
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
