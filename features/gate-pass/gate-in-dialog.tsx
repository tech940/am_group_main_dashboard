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
import { VehicleTrackerCamera } from '@/features/kia/vehicle-tracker-camera'

type GateInDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pass: {
    id: string
    passNo: string
    driverName: string
    registrationNumber: string | null
    model: string | null
    variant: string | null
    color: string | null
    gateOutAt: string | null
    gateOutOdo: string | null
    gateOutGuardName: string | null
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
    setCameraKey((k) => k + 1)
    setError('')
  }

  const handleSubmit = async () => {
    if (!pass) return
    setError('')

    const odoNum = Number(odometer)
    if (!odometer.trim() || Number.isNaN(odoNum) || odoNum < 0) {
      setError('Please enter a valid manual Odometer IN reading.')
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

    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('odometer', String(odoNum))
      formData.append('parkedLocation', parkedLocation.trim())
      formData.append('keyHandoverTo', keyHandoverTo.trim())
      if (remarks.trim()) formData.append('remarks', remarks.trim())
      if (guardName.trim()) formData.append('guardName', guardName.trim())
      if (photoOdometerIn) formData.append('photoOdometerIn', photoOdometerIn)

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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
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
                label="odometer reading"
                onCapture={(file) => setPhotoOdometerIn(file)}
                allowUpload={true}
              />
            </div>
          </div>

          {/* Parked Location & Key Handover */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="parkedLocation" className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-slate-500" />
                  Parked Location *
                </Label>
                <Input
                  id="parkedLocation"
                  placeholder="e.g. Bay 3 / Showroom Front"
                  value={parkedLocation}
                  onChange={(e) => setParkedLocation(e.target.value)}
                  className="mt-1 bg-white"
                />
              </div>

              <div>
                <Label htmlFor="keyHandover" className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                  <Key className="h-3.5 w-3.5 text-slate-500" />
                  Key Handover To *
                </Label>
                <Input
                  id="keyHandover"
                  placeholder="e.g. Security Desk / Sales Manager"
                  value={keyHandoverTo}
                  onChange={(e) => setKeyHandoverTo(e.target.value)}
                  className="mt-1 bg-white"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="gateInRemarks" className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5 text-slate-500" />
                Remarks
              </Label>
              <Textarea
                id="gateInRemarks"
                rows={2}
                placeholder="Vehicle condition on return, clean/fuel status, etc."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="mt-1 bg-white"
              />
            </div>
          </div>

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
