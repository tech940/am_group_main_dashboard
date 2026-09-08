'use client'

import React, { useState, useRef } from 'react'
import {
  Camera,
  Car,
  CheckCircle2,
  Gauge,
  Loader2,
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
import { toast } from '@/hooks/use-toast'
import { VehicleTrackerCamera } from '@/features/kia/vehicle-tracker-camera'

type GateOutDialogProps = {
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
  } | null
  onGateOutSuccess: () => void
}

type PhotoKey = 'front' | 'back' | 'right' | 'left' | 'odometer'

const PHOTO_CONFIG: Array<{ key: PhotoKey; label: string; fieldName: string }> = [
  { key: 'front', label: 'Front View *', fieldName: 'photoFront' },
  { key: 'back', label: 'Back View *', fieldName: 'photoBack' },
  { key: 'right', label: 'Right Side *', fieldName: 'photoRight' },
  { key: 'left', label: 'Left Side *', fieldName: 'photoLeft' },
  { key: 'odometer', label: 'Odometer Pic *', fieldName: 'photoOdometer' },
]

export function GateOutDialog({ open, onOpenChange, pass, onGateOutSuccess }: GateOutDialogProps) {
  const [odometer, setOdometer] = useState<string>('')
  const [guardName, setGuardName] = useState<string>('')
  const [activePhotoKey, setActivePhotoKey] = useState<PhotoKey>('front')
  const [cameraKey, setCameraKey] = useState<number>(0)
  const [photos, setPhotos] = useState<Record<PhotoKey, File | null>>({
    front: null,
    back: null,
    right: null,
    left: null,
    odometer: null,
  })
  const [previews, setPreviews] = useState<Record<PhotoKey, string | null>>({
    front: null,
    back: null,
    right: null,
    left: null,
    odometer: null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handlePhotoCapture = (key: PhotoKey, file: File | null) => {
    setPhotos((prev) => ({ ...prev, [key]: file }))
    if (!file) {
      setPreviews((prev) => ({ ...prev, [key]: null }))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPreviews((prev) => ({ ...prev, [key]: reader.result as string }))
    }
    reader.readAsDataURL(file)

    // Automatically suggest next uncaptured photo slot
    const keys: PhotoKey[] = ['front', 'back', 'right', 'left', 'odometer']
    const nextUnset = keys.find((k) => k !== key && !photos[k])
    if (nextUnset) {
      setTimeout(() => setActivePhotoKey(nextUnset), 400)
    }
  }

  const removePhoto = (key: PhotoKey) => {
    setPhotos((prev) => ({ ...prev, [key]: null }))
    setPreviews((prev) => ({ ...prev, [key]: null }))
    setActivePhotoKey(key)
    setCameraKey((k) => k + 1)
  }

  const reset = () => {
    setOdometer('')
    setGuardName('')
    setActivePhotoKey('front')
    setPhotos({ front: null, back: null, right: null, left: null, odometer: null })
    setPreviews({ front: null, back: null, right: null, left: null, odometer: null })
    setCameraKey((k) => k + 1)
    setError('')
  }

  const handleSubmit = async () => {
    if (!pass) return
    setError('')

    const odoNum = Number(odometer)
    if (!odometer.trim() || Number.isNaN(odoNum) || odoNum < 0) {
      setError('Please enter a valid manual Odometer OUT reading.')
      return
    }

    if (!photos.odometer) {
      setError('Odometer picture is required.')
      return
    }

    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('odometer', String(odoNum))
      if (guardName.trim()) formData.append('guardName', guardName.trim())

      if (photos.front) formData.append('photoFront', photos.front)
      if (photos.back) formData.append('photoBack', photos.back)
      if (photos.right) formData.append('photoRight', photos.right)
      if (photos.left) formData.append('photoLeft', photos.left)
      if (photos.odometer) formData.append('photoOdometer', photos.odometer)

      const res = await fetch(`/api/gate-pass/${pass.id}/gate-out`, {
        method: 'POST',
        body: formData,
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not complete Gate Out.')

      toast({
        title: 'Vehicle Gate Out Recorded',
        description: `Pass ${pass.passNo} is now OUT of premises.`,
        variant: 'success',
      })

      reset()
      onOpenChange(false)
      onGateOutSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record Gate Out.')
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Car className="h-5 w-5 text-indigo-600" />
            Gate Out Verification — {pass.passNo}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Record odometer reading and 4-angle vehicle condition photos before opening the gate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Summary Banner */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-indigo-600" />
              <span>
                Driver: <strong>{pass.driverName}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-indigo-600" />
              <span>
                Vehicle:{' '}
                <strong>
                  {pass.model} ({pass.registrationNumber || 'N/A'})
                </strong>{' '}
                {pass.color ? `· ${pass.color}` : ''}
              </span>
            </div>
          </div>

          {/* Odometer Section */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Gauge className="h-4 w-4 text-indigo-600" />
              Odometer OUT Reading *
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="odometer" className="text-xs text-slate-600">
                  Manual Reading (km) *
                </Label>
                <Input
                  id="odometer"
                  type="number"
                  placeholder="e.g. 12450"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  className="mt-1 bg-white font-mono text-base"
                />
              </div>
              <div>
                <Label htmlFor="guardName" className="text-xs text-slate-600">
                  Person Responsible for Gate Out
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
          </div>

          {/* 5 Vehicle Condition Photos */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Camera className="h-4 w-4 text-indigo-600" />
                Vehicle Condition Photos & Odometer Pic
              </Label>
              <span className="text-[11px] font-medium text-slate-500">
                {Object.values(photos).filter(Boolean).length} of {PHOTO_CONFIG.length} captured
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Select a slot below to capture with camera or upload. All 4 exterior angles + Odometer are required.
            </p>

            {/* 5 Slot Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
              {PHOTO_CONFIG.map(({ key, label }) => {
                const preview = previews[key]
                const isActive = activePhotoKey === key
                const isCaptured = Boolean(photos[key])

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActivePhotoKey(key)}
                    className={`relative flex flex-col items-center justify-center p-2 rounded-xl border text-left transition-all ${
                      isActive
                        ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20 shadow-sm'
                        : isCaptured
                        ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {preview ? (
                      <div className="relative w-full h-12 rounded-lg overflow-hidden mb-1.5 border border-slate-200">
                        <img src={preview} alt={label} className="w-full h-full object-cover" />
                        <span className="absolute top-1 right-1 bg-emerald-600 text-white rounded-full p-0.5 shadow">
                          <CheckCircle2 className="h-3 w-3" />
                        </span>
                      </div>
                    ) : (
                      <div className={`w-full h-12 rounded-lg flex items-center justify-center mb-1.5 ${
                        isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'
                      }`}>
                        <Camera className="h-5 w-5" />
                      </div>
                    )}
                    <span className="text-[11px] font-bold text-slate-700 truncate w-full text-center">
                      {label.replace(' *', '')}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {isCaptured ? '✓ Ready' : isActive ? '● Active' : 'Required'}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Active Slot Camera Viewfinder */}
            <div className="pt-2 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Camera className="h-3.5 w-3.5 text-indigo-600" />
                  Capturing: {PHOTO_CONFIG.find((c) => c.key === activePhotoKey)?.label}
                </span>
                {photos[activePhotoKey] ? (
                  <button
                    type="button"
                    onClick={() => removePhoto(activePhotoKey)}
                    className="text-[11px] text-rose-600 hover:text-rose-700 font-medium flex items-center gap-1"
                  >
                    <X className="h-3 w-3" /> Clear this photo
                  </button>
                ) : null}
              </div>

              <VehicleTrackerCamera
                key={`${pass.id}-${activePhotoKey}-${cameraKey}`}
                label={PHOTO_CONFIG.find((c) => c.key === activePhotoKey)?.label || 'photo'}
                onCapture={(file) => handlePhotoCapture(activePhotoKey, file)}
                allowUpload={true}
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
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save & Gate Out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
