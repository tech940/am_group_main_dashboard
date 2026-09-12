'use client'

import React, { useState, useRef } from 'react'
import {
  Camera,
  Car,
  CheckCircle2,
  Clock,
  Gauge,
  Key,
  Loader2,
  MapPin,
  MessageSquare,
  Upload,
  User,
  X,
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { formatIndiaDateTime } from '@/lib/date-time'
import { isFuelFillingPurpose } from '@/lib/gate-pass/status'
import { VehicleTrackerCamera } from '@/features/kia/vehicle-tracker-camera'
import { FileText, Fuel, IndianRupee, AlertCircle } from 'lucide-react'

type GateInDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pass: {
    id: string
    passNo: string
    purpose?: string | null
    driverName: string
    registrationNumber: string | null
    model: string | null
    variant: string | null
    color: string | null
    gateOutAt: string | null
    gateOutOdo: string | null
    gateOutGuardName: string | null
    fuelSlipPath?: string | null
    pumpStartPath?: string | null
    pumpStopPath?: string | null
    fuelAmount?: string | number | null
    fuelLitres?: string | number | null
  } | null
  onGateInSuccess: () => void
}

export function GateInDialog({ open, onOpenChange, pass, onGateInSuccess }: GateInDialogProps) {
  const [odometer, setOdometer] = useState<string>('')
  const [parkedLocation, setParkedLocation] = useState<string>('')
  const [keyHandoverTo, setKeyHandoverTo] = useState<string>('')
  const [remarks, setRemarks] = useState<string>('')
  const [guardName, setGuardName] = useState<string>('')
  const [photoOdometerIn, setPhotoOdometerIn] = useState<File | null>(null)
  const [fuelSlip, setFuelSlip] = useState<File | null>(null)
  const [pumpStart, setPumpStart] = useState<File | null>(null)
  const [pumpStop, setPumpStop] = useState<File | null>(null)
  const [cameraKey, setCameraKey] = useState<number>(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setOdometer('')
    setParkedLocation('')
    setKeyHandoverTo('')
    setRemarks('')
    setGuardName('')
    setPhotoOdometerIn(null)
    setFuelSlip(null)
    setPumpStart(null)
    setPumpStop(null)
    setCameraKey((k) => k + 1)
    setError('')
  }

  const handleSubmit = async () => {
    if (!pass) return
    setError('')

    const odoNum = Number(odometer)
    if (!odometer.trim() || Number.isNaN(odoNum) || odoNum < 0) {
      setError('Please enter a valid closing odometer reading.')
      return
    }

    const outOdoNum = pass.gateOutOdo ? Number(pass.gateOutOdo) : null
    if (outOdoNum !== null && Number.isFinite(outOdoNum) && odoNum <= outOdoNum) {
      setError(`Odometer IN (${odoNum} km) must be greater than Gate Out reading (${outOdoNum} km).`)
      return
    }

    if (!photoOdometerIn) {
      setError('Odometer IN picture is required.')
      return
    }

    if (!parkedLocation.trim()) {
      setError('Please specify the Parked Location.')
      return
    }

    if (!keyHandoverTo.trim()) {
      setError('Please specify who the key was handed over to.')
      return
    }

    const isFuel = isFuelFillingPurpose(pass.purpose)
    const hasSlip = Boolean(fuelSlip || pass.fuelSlipPath)
    const hasStart = Boolean(pumpStart || pass.pumpStartPath)
    const hasStop = Boolean(pumpStop || pass.pumpStopPath)

    if (isFuel && (!hasSlip || !hasStart || !hasStop)) {
      setError('This trip was for Fuel Filling. Physical Fuel Slip, Pump Start (0.00), and Pump Stop (Amount) are all required before completing Gate In.')
      return
    }

    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('odometer', String(odoNum))
      formData.append('parkedLocation', parkedLocation.trim())
      formData.append('keyHandoverTo', keyHandoverTo.trim())
      if (remarks.trim()) formData.append('remarks', remarks.trim())
      if (guardName.trim()) formData.append('guardName', guardName.trim())
      if (photoOdometerIn) formData.append('photoOdometerIn', photoOdometerIn)

      if (fuelSlip) formData.append('fuelSlip', fuelSlip)
      if (pumpStart) formData.append('pumpStart', pumpStart)
      if (pumpStop) formData.append('pumpStop', pumpStop)

      const res = await fetch(`/api/gate-pass/${pass.id}/gate-in`, {
        method: 'POST',
        body: formData,
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not complete Gate In.')

      if (json.odoWentBackwards) {
        toast({
          title: 'Gate In Recorded with Odometer Warning',
          description: 'Closing odometer is lower than Gate Out reading. Flagged for review.',
          variant: 'warning',
        })
      } else {
        toast({
          title: 'Vehicle Returned & Gate In Completed',
          description: `Pass ${pass.passNo} has been successfully closed.`,
          variant: 'success',
        })
      }

      reset()
      onOpenChange(false)
      onGateInSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record Gate In.')
    } finally {
      setSaving(false)
    }
  }

  if (!pass) return null

  const outOdo = pass.gateOutOdo ? Number(pass.gateOutOdo) : null

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
          <DialogTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Gate In Verification — {pass.passNo}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Verify vehicle return, record closing odometer reading, parking bay, and key handover.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Gate Out Snapshot Banner */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
            <span className="font-bold uppercase tracking-wider text-slate-500 block">Gate Out Details</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <span className="text-slate-500 block">Driver</span>
                <span className="font-semibold text-slate-800">{pass.driverName}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Vehicle</span>
                <span className="font-semibold text-slate-800">
                  {pass.model} ({pass.registrationNumber || 'N/A'})
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Odo OUT Reading</span>
                <span className="font-semibold font-mono text-indigo-700">
                  {pass.gateOutOdo ? `${pass.gateOutOdo} km` : 'Not recorded'}
                </span>
              </div>
              {pass.gateOutAt ? (
                <div>
                  <span className="text-slate-500 block">Left At</span>
                  <span className="font-semibold text-slate-800">
                    {formatIndiaDateTime(pass.gateOutAt) || pass.gateOutAt}
                  </span>
                </div>
              ) : null}
              {pass.gateOutGuardName ? (
                <div>
                  <span className="text-slate-500 block">Gate Out Inspector</span>
                  <span className="font-semibold text-slate-800">{pass.gateOutGuardName}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Odometer IN Section */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Gauge className="h-4 w-4 text-emerald-600" />
              Odometer IN Reading *
            </Label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <div>
                <Label htmlFor="odometerIn" className="text-xs text-slate-600">
                  Manual Reading (km) *
                </Label>
                <Input
                  id="odometerIn"
                  type="number"
                  placeholder="e.g. 12485"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  className="mt-1 bg-white font-mono text-base"
                />
                {outOdo && odometer && Number(odometer) < outOdo ? (
                  <p className="text-[11px] text-rose-600 mt-1">
                    Warning: Reading is lower than Gate Out ({outOdo} km).
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="guardName" className="text-xs text-slate-600">
                  Person Responsible for Gate In
                </Label>
                <Input
                  id="guardName"
                  placeholder="Name of person responsible (Defaults to your user)"
                  value={guardName}
                  onChange={(e) => setGuardName(e.target.value)}
                  className="mt-1 bg-white"
                />
              </div>
            </div>

            <div className="pt-2">
              <Label className="text-xs font-semibold text-slate-700 flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5">
                  <Camera className="h-4 w-4 text-emerald-600" />
                  Odometer IN Picture *
                </span>
                {photoOdometerIn ? (
                  <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Photo Ready
                  </span>
                ) : null}
              </Label>
              <VehicleTrackerCamera
                key={`${pass.id}-${cameraKey}`}
                label="Odometer IN photo"
                onCapture={(file) => setPhotoOdometerIn(file)}
                allowUpload={true}
              />
            </div>
          </div>

          {/* Fuel Filling Proofs (When purpose == Fuel filling) */}
          {isFuelFillingPurpose(pass.purpose) ? (
            <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <Fuel className="h-4 w-4 text-amber-600" />
                  Mandatory Fuel Filling Proofs *
                </Label>
                {Boolean(pass.fuelSlipPath && pass.pumpStartPath && pass.pumpStopPath) ? (
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1 bg-emerald-100/70 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> All 3 Proofs on File
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-800 dark:text-amber-300 font-semibold bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 rounded border border-amber-300">
                    Required for Completion
                  </span>
                )}
              </div>
              <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90">
                This pass was issued for Fuel Filling. All 3 documents below must be attached before Gate In can be completed.
              </p>

              <div className="space-y-3 pt-1">
                {/* 1. Slip */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-amber-600" /> 1. Physical Fuel Slip *
                    </span>
                    {fuelSlip || pass.fuelSlipPath ? (
                      <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Attached
                      </span>
                    ) : null}
                  </div>
                  <VehicleTrackerCamera
                    key={`fuel-slip-${pass.id}-${cameraKey}`}
                    label="Fuel Slip photo"
                    onCapture={(file) => setFuelSlip(file)}
                    allowUpload={true}
                  />
                </div>

                {/* 2. Pump Start 0.00 */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Gauge className="h-3.5 w-3.5 text-blue-600" /> 2. Pump Start (0.00) *
                    </span>
                    {pumpStart || pass.pumpStartPath ? (
                      <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Attached
                      </span>
                    ) : null}
                  </div>
                  <VehicleTrackerCamera
                    key={`pump-start-${pass.id}-${cameraKey}`}
                    label="Pump Start 0.00 photo"
                    onCapture={(file) => setPumpStart(file)}
                    allowUpload={true}
                  />
                </div>

                {/* 3. Pump Stop Amount */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <IndianRupee className="h-3.5 w-3.5 text-emerald-600" /> 3. Pump Stop (Amount) *
                    </span>
                    {pumpStop || pass.pumpStopPath ? (
                      <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Attached
                      </span>
                    ) : null}
                  </div>
                  <VehicleTrackerCamera
                    key={`pump-stop-${pass.id}-${cameraKey}`}
                    label="Pump Stop Amount photo"
                    onCapture={(file) => setPumpStop(file)}
                    allowUpload={true}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save & Complete Gate In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
