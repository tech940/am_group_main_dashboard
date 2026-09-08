'use client'

import { useEffect, useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Camera,
  Car,
  CheckCircle2,
  FileText,
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { GATE_PASS_PURPOSES } from '@/lib/gate-pass/status'
import type { GatePassCurrentUser } from './gate-pass-client'

type Vehicle = {
  vin: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  branchLabel: string
  lastKnownKms: number | null
  sharedPlate: boolean
}

type Driver = {
  userId: string
  fullName: string
  role: string
  phone: string | null
  licenceMasked: string | null
  hasLicence: boolean
  hasLicencePhoto: boolean
  licenceName: string | null
  licenceExpiry: string | null
  expired: boolean | null
}

export function GatePassFormDialog({
  open,
  onOpenChange,
  currentUser,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUser?: GatePassCurrentUser
  onCreated: () => void
}) {
  const [vin, setVin] = useState('')
  const [driverUserId, setDriverUserId] = useState(currentUser?.id ?? '')
  const [driverName, setDriverName] = useState(currentUser?.fullName ?? '')
  const [driverPhone, setDriverPhone] = useState('')
  const [purpose, setPurpose] = useState<string>(GATE_PASS_PURPOSES[0])
  const [expectedReturnAt, setExpectedReturnAt] = useState('')
  const [remarks, setRemarks] = useState('')
  const [licenceNo, setLicenceNo] = useState('')
  const [licenceExpiry, setLicenceExpiry] = useState('')
  const [licencePhoto, setLicencePhoto] = useState<File | null>(null)
  const [licencePreview, setLicencePreview] = useState<string | null>(null)
  const [editingLicence, setEditingLicence] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: vehicleData, isLoading: loadingVehicles } = useQuery({
    queryKey: ['gate-pass-vehicles'],
    queryFn: async () => {
      const res = await fetch('/api/gate-pass/vehicles', { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load the demo fleet.')
      return res.json() as Promise<{ vehicles: Vehicle[] }>
    },
    enabled: open,
  })

  const { data: driverData, refetch: refetchDrivers } = useQuery({
    queryKey: ['gate-pass-drivers'],
    queryFn: async () => {
      const res = await fetch('/api/gate-pass/drivers', { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load drivers.')
      return res.json() as Promise<{ drivers: Driver[] }>
    },
    enabled: open,
  })

  const vehicles = vehicleData?.vehicles ?? []
  const drivers = driverData?.drivers ?? []
  const chosenVehicle = vehicles.find((v) => v.vin === vin) ?? null
  const chosenDriver = drivers.find((d) =>
    (driverUserId && d.userId === driverUserId) ||
    (driverName.trim() && d.fullName.toLowerCase() === driverName.trim().toLowerCase())
  ) ?? null

  const hasValidLicenceOnFile = Boolean(
    chosenDriver && (chosenDriver.hasLicencePhoto || chosenDriver.hasLicence) && !chosenDriver.expired
  )

  const isExpired = Boolean(
    chosenDriver?.expired && !licenceExpiry
  ) || (licenceExpiry ? new Date(licenceExpiry).getTime() < new Date().setHours(0, 0, 0, 0) : false)

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLicencePhoto(file)
    const reader = new FileReader()
    reader.onload = () => setLicencePreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const reset = () => {
    setVin('')
    setDriverUserId('')
    setDriverName('')
    setDriverPhone('')
    setPurpose(GATE_PASS_PURPOSES[0])
    setExpectedReturnAt('')
    setRemarks('')
    setLicenceNo('')
    setLicenceExpiry('')
    setLicencePhoto(null)
    setLicencePreview(null)
    setEditingLicence(false)
    setError('')
  }

  const submit = async () => {
    setError('')
    if (!driverName.trim() && !driverUserId) return setError('Please enter the name of the person taking the car.')
    if (!vin) return setError('Please select a vehicle.')
    if (!purpose) return setError('Please select a purpose for travel.')
    if (!expectedReturnAt) return setError('Please specify when the vehicle is due back.')

    // License validation & expiry check
    const todayMidnight = new Date().setHours(0, 0, 0, 0)

    if (chosenDriver?.expired && !editingLicence && !licenceExpiry) {
      return setError(
        `Cannot submit request: ${chosenDriver.fullName}'s driving license has expired (${chosenDriver.licenceExpiry || 'Expired'}). Please provide valid renewed license details.`
      )
    }

    if (licenceExpiry) {
      const expDate = new Date(licenceExpiry).getTime()
      if (expDate < todayMidnight) {
        return setError(`Cannot submit request: The driving license expiry date (${licenceExpiry}) is in the past.`)
      }
    }

    const needsLicenceInput = !hasValidLicenceOnFile || editingLicence
    if (needsLicenceInput && driverUserId) {
      if (!licenceNo.trim() && !chosenDriver?.hasLicence) {
        return setError('Please enter the Driver License Number.')
      }
      if (!licenceExpiry && !chosenDriver?.licenceExpiry) {
        return setError('Please enter the Driver License Expiry Date.')
      }
      if (!licencePhoto && !chosenDriver?.hasLicencePhoto) {
        return setError('Please capture or upload the Driver License Image.')
      }
    }

    setSaving(true)
    try {
      // If user entered or updated license details, persist it to driver profile
      if (driverUserId && (licenceNo.trim() || licenceExpiry || licencePhoto)) {
        const formData = new FormData()
        formData.append('userId', driverUserId)
        formData.append('licenceNo', licenceNo.trim() || chosenDriver?.licenceMasked?.replace(/•/g, 'X') || 'VERIFIED')
        if (licenceExpiry) formData.append('licenceExpiry', licenceExpiry)
        if (licencePhoto) formData.append('licencePhoto', licencePhoto)
        if (driverPhone.trim()) formData.append('phone', driverPhone.trim())

        const uploadRes = await fetch('/api/gate-pass/drivers', {
          method: 'POST',
          body: formData,
        })
        if (!uploadRes.ok) {
          const uErr = await uploadRes.json().catch(() => ({}))
          throw new Error(uErr.error || 'Failed to save driver license.')
        }
        await refetchDrivers()
      }

      const res = await fetch('/api/gate-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vin,
          driverKind: 'staff',
          driverUserId: driverUserId || null,
          driverName: driverName.trim() || chosenDriver?.fullName || 'Staff Driver',
          driverPhone: driverPhone.trim() || null,
          driverLicenceNo: licenceNo.trim() || (chosenDriver?.hasLicence ? undefined : null),
          driverLicenceExpiry: licenceExpiry || chosenDriver?.licenceExpiry || null,
          purpose,
          expectedReturnAt: new Date(expectedReturnAt).toISOString(),
          remarks: remarks.trim() || null,
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not raise the pass.')

      toast({
        title: `Gate pass ${json.pass?.passNo ?? ''} raised`,
        description: 'Sent for approval (CEO / GSM / SM).',
        variant: 'success',
      })
      reset()
      onOpenChange(false)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not raise the pass.')
    } finally {
      setSaving(false)
    }
  }

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
          <DialogTitle className="text-xl font-bold text-slate-900">
            Raise Demo Car Gate Pass
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Fill in the trip details. Once submitted, it will be sent for Manager approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Section 1: Employee & Driver Details */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
              <User className="h-4 w-4 text-indigo-600" />
              Employee &amp; Driver Details
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              {/* Left: Requester (Session Data) */}
              <div>
                <Label className="text-xs font-semibold text-slate-700">
                  Employee / Requester (Session)
                </Label>
                <div className="mt-1 flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 font-bold text-xs uppercase border border-indigo-100">
                    {currentUser?.fullName ? currentUser.fullName.slice(0, 2).toUpperCase() : 'EM'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {currentUser?.fullName || 'Current User'}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {currentUser?.email || '—'}
                      {currentUser?.role ? ` · ${currentUser.role.replace(/_/g, ' ')}` : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Right: Person Taking Car Name & Phone */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs font-semibold text-slate-700">
                      Person Taking Car (Name) <span className="text-rose-500">*</span>
                    </Label>
                    {currentUser?.fullName && driverName !== currentUser.fullName && (
                      <button
                        type="button"
                        onClick={() => {
                          setDriverName(currentUser.fullName || '')
                          if (currentUser.id) {
                            setDriverUserId(currentUser.id)
                            const selfDriver = drivers.find((d) => d.userId === currentUser.id)
                            if (selfDriver?.phone) setDriverPhone(selfDriver.phone)
                          }
                        }}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium hover:underline"
                      >
                        Self (Use my name)
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                    <Input
                      value={driverName}
                      onChange={(e) => {
                        setDriverName(e.target.value)
                        setDriverUserId('')
                      }}
                      placeholder="Name of person taking car…"
                      className="bg-white pl-9"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-semibold text-slate-700">
                    Driver Phone <span className="text-slate-400 font-normal">(Optional)</span>
                  </Label>
                  <Input
                    value={driverPhone}
                    onChange={(e) => setDriverPhone(e.target.value)}
                    placeholder="e.g. +91 9876543210"
                    className="mt-1 bg-white text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Vehicle Details */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
              <Car className="h-4 w-4 text-indigo-600" />
              Vehicle Details
            </h3>
            <div>
              <Label className="text-xs font-semibold text-slate-700">Vehicle Reg No</Label>
              <Select value={vin} onValueChange={setVin}>
                <SelectTrigger className="mt-1 bg-white">
                  <SelectValue placeholder={loadingVehicles ? 'Loading fleet…' : '-- Select Vehicle --'} />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {vehicles.map((v) => {
                    const label = `${(v.model || 'DEMO').toUpperCase()} (${v.registrationNumber || v.vin.slice(-6)})`
                    return (
                      <SelectItem key={v.vin} value={v.vin}>
                        {label} {v.color ? `· ${v.color}` : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              {chosenVehicle?.sharedPlate ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Trade plate shared across vehicles. Check VIN tail: <strong>{chosenVehicle.vin.slice(-6)}</strong>.
                </p>
              ) : null}
              {chosenVehicle ? (
                <p className="mt-1 text-xs text-slate-500">
                  Branch: {chosenVehicle.branchLabel}
                  {chosenVehicle.lastKnownKms ? ` · Last known: ${chosenVehicle.lastKnownKms} km` : ''}
                </p>
              ) : null}
            </div>
          </div>

          {/* Section 3: Trip Details */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
              <FileText className="h-4 w-4 text-indigo-600" />
              Trip Details
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold text-slate-700">Purpose for Travel</Label>
                <Select value={purpose} onValueChange={setPurpose}>
                  <SelectTrigger className="mt-1 bg-white">
                    <SelectValue placeholder="-- Select Purpose --" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {GATE_PASS_PURPOSES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-700">Due Back (Return Date & Time)</Label>
                <Input
                  type="datetime-local"
                  value={expectedReturnAt}
                  onChange={(e) => setExpectedReturnAt(e.target.value)}
                  className="mt-1 bg-white"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="remarks" className="text-xs font-semibold text-slate-700">
                Remarks
              </Label>
              <Textarea
                id="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                className="mt-1 bg-white"
                placeholder="Any additional details..."
              />
            </div>

            {/* License Details & Verification Card */}
            <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Camera className="h-3.5 w-3.5 text-indigo-600" />
                  Driver License Verification
                </Label>
                {chosenDriver?.expired ? (
                  <span className="text-[10px] font-bold uppercase text-red-700 bg-red-100 border border-red-200 px-2 py-0.5 rounded">
                    License Expired
                  </span>
                ) : hasValidLicenceOnFile && !editingLicence ? (
                  <span className="text-[10px] font-semibold uppercase text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                    Verified On File
                  </span>
                ) : null}
              </div>

              {chosenDriver?.expired && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800 space-y-1">
                  <div className="flex items-center gap-2 font-bold text-red-900">
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                    <span>Driver's License Expired on {chosenDriver.licenceExpiry || 'record'}</span>
                  </div>
                  <p className="text-red-700 text-[11px]">
                    The driving license for {chosenDriver.fullName} has expired. Please enter the renewed license details and photo below to proceed with the request.
                  </p>
                </div>
              )}

              {hasValidLicenceOnFile && !editingLicence ? (
                <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-semibold text-emerald-950">License Verified & On File</p>
                      <p className="text-[11px] text-emerald-700">
                        DL No: <span className="font-mono font-medium">{chosenDriver?.licenceMasked || 'Active'}</span>
                        {chosenDriver?.licenceExpiry ? ` · Expiry: ${chosenDriver.licenceExpiry}` : ''}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingLicence(true)}
                    className="text-xs h-7 border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-100"
                  >
                    Update / Renew
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  {editingLicence && hasValidLicenceOnFile && (
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-xs text-slate-500">Updating license for {chosenDriver?.fullName}:</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingLicence(false)}
                        className="text-xs h-6 text-slate-500 hover:text-slate-700"
                      >
                        Cancel Update
                      </Button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="licenceNo" className="text-xs font-semibold text-slate-700">
                        License Number <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        id="licenceNo"
                        placeholder="e.g. JK02 20200001234"
                        value={licenceNo}
                        onChange={(e) => setLicenceNo(e.target.value.toUpperCase())}
                        className="mt-1 bg-white font-mono uppercase"
                      />
                    </div>

                    <div>
                      <Label htmlFor="licenceExpiry" className="text-xs font-semibold text-slate-700">
                        License Expiry Date <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        id="licenceExpiry"
                        type="date"
                        min={new Date().toISOString().split('T')[0]}
                        value={licenceExpiry}
                        onChange={(e) => setLicenceExpiry(e.target.value)}
                        className="mt-1 bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-700">
                      License Photo / Image {!chosenDriver?.hasLicencePhoto && <span className="text-rose-500">*</span>}
                    </Label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handlePhotoSelect}
                    />

                    {licencePreview ? (
                      <div className="relative inline-block mt-2">
                        <img
                          src={licencePreview}
                          alt="License preview"
                          className="h-28 w-auto rounded-lg border object-cover shadow-sm"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setLicencePhoto(null)
                            setLicencePreview(null)
                          }}
                          className="absolute -top-2 -right-2 rounded-full bg-rose-600 p-1 text-white shadow hover:bg-rose-700"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-1.5 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg p-3 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/20 transition-all text-center"
                      >
                        <Upload className="h-5 w-5 text-indigo-600 mb-1" />
                        <p className="text-xs font-semibold text-slate-700">Click to capture / upload License Photo</p>
                        <p className="text-[11px] text-slate-400">
                          Saved to employee profile automatically for all future gate passes
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit Gate Pass
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
