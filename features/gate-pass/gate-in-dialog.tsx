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
  const [fuelAmount, setFuelAmount] = useState<string>('')
  const [fuelLitres, setFuelLitres] = useState<string>('')
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
    setFuelAmount('')
    setFuelLitres('')
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
      if (fuelAmount.trim()) formData.append('fuelAmount', fuelAmount.trim())
      if (fuelLitres.trim()) formData.append('fuelLitres', fuelLitres.trim())

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
        className="max-h-[90dvh] overflow-y-auto w-[96vw] sm:w-full sm:max-w-2xl p-4 sm:p-6 gap-4 border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-teal-700" />
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
              <Gauge className="h-4 w-4 text-teal-700" />
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
                  <Camera className="h-4 w-4 text-teal-700" />
                  Odometer IN Picture *
                </span>
                {photoOdometerIn ? (
                  <span className="text-[11px] text-teal-800 font-semibold flex items-center gap-1 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-teal-700" /> Photo Ready
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

          {/* Vehicle Return Custody & Parking Bay */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-indigo-600" />
              Parking Bay & Key Custody *
            </Label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="parkedLocation" className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-slate-500" />
                  Parked Location / Bay *
                </Label>
                <Input
                  id="parkedLocation"
                  placeholder="e.g. Front Bay 3, Showroom Yard, Basement"
                  value={parkedLocation}
                  onChange={(e) => setParkedLocation(e.target.value)}
                  className="mt-1 bg-white"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {['Showroom Front', 'Bay 1', 'Bay 2', 'Bay 3', 'Basement', 'Service Yard'].map((bay) => (
                    <button
                      key={bay}
                      type="button"
                      onClick={() => setParkedLocation(bay)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                        parkedLocation === bay
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-semibold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {bay}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="keyHandoverTo" className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5 text-amber-600" />
                  Key Handed Over To *
                </Label>
                <Input
                  id="keyHandoverTo"
                  placeholder="e.g. Guard Desk, Reception, Key Locker"
                  value={keyHandoverTo}
                  onChange={(e) => setKeyHandoverTo(e.target.value)}
                  className="mt-1 bg-white"
                />
              </div>
            </div>

            <div className="pt-2">
              <Label htmlFor="remarks" className="text-xs text-slate-600 block mb-1">
                Return Remarks & Vehicle Condition (Optional)
              </Label>
              <Textarea
                id="remarks"
                placeholder="Note vehicle condition upon return (e.g. Clean return, no new scratches, fuel level at 50%)"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="bg-white resize-none text-xs min-h-[60px]"
                rows={2}
              />
            </div>
          </div>

          {/* Fuel Filling Proofs (When purpose == Fuel filling) */}
          {isFuelFillingPurpose(pass.purpose) ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                  <Fuel className="h-4 w-4 text-amber-600" />
                  Mandatory Fuel Filling Proofs *
                </Label>
                {Boolean(pass.fuelSlipPath && pass.pumpStartPath && pass.pumpStopPath) ? (
                  <span className="text-[11px] text-teal-800 font-semibold flex items-center gap-1 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-teal-700" /> All 3 Proofs on File
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-800 font-semibold bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                    Required for Completion
                  </span>
                )}
              </div>
              <p className="text-[11px] text-amber-800/90">
                This pass was issued for Fuel Filling. All 3 documents below must be attached before Gate In can be completed.
              </p>

              {/* Fuel Price & Litres Input */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/80 p-3 rounded-lg border border-slate-200">
                <div className="space-y-1">
                  <Label htmlFor="gatein-fuel-amount" className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <IndianRupee className="h-3.5 w-3.5 text-teal-700" /> Fuel Price (₹)
                  </Label>
                  <Input
                    id="gatein-fuel-amount"
                    type="number"
                    step="any"
                    min="1"
                    placeholder="e.g. 3500"
                    value={fuelAmount}
                    onChange={(e) => setFuelAmount(e.target.value)}
                    className="h-8 font-mono text-xs bg-slate-50"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gatein-fuel-litres" className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Fuel className="h-3.5 w-3.5 text-blue-600" /> Fuel Litres
                  </Label>
                  <Input
                    id="gatein-fuel-litres"
                    type="number"
                    step="any"
                    min="0.1"
                    placeholder="e.g. 35.5"
                    value={fuelLitres}
                    onChange={(e) => setFuelLitres(e.target.value)}
                    className="h-8 font-mono text-xs bg-slate-50"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-1">
                {/* 1. Slip */}
                <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-amber-600" /> 1. Physical Fuel Slip *
                    </span>
                    {fuelSlip || pass.fuelSlipPath ? (
                      <span className="text-[11px] text-teal-800 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-teal-700" /> Attached
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
                <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <Gauge className="h-3.5 w-3.5 text-blue-600" /> 2. Pump Start (0.00) *
                    </span>
                    {pumpStart || pass.pumpStartPath ? (
                      <span className="text-[11px] text-teal-800 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-teal-700" /> Attached
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
                <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <IndianRupee className="h-3.5 w-3.5 text-teal-700" /> 3. Pump Stop (Amount) *
                    </span>
                    {pumpStop || pass.pumpStopPath ? (
                      <span className="text-[11px] text-teal-800 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-teal-700" /> Attached
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
            className="bg-teal-700 hover:bg-teal-800 text-white font-semibold shadow-2xs"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save & Complete Gate In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
