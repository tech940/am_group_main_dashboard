'use client'

import { useEffect, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  User,
  UserCheck,
  UserPlus,
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
import { VehicleTrackerCamera } from '@/features/kia/vehicle-tracker-camera'
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
  email?: string
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
  const [isManualDriver, setIsManualDriver] = useState(false)
  const [driverUserId, setDriverUserId] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverSearch, setDriverSearch] = useState('')
  const [purpose, setPurpose] = useState<string>(GATE_PASS_PURPOSES[0])
  const [remarks, setRemarks] = useState('')
  const [licencePhoto, setLicencePhoto] = useState<File | null>(null)
  const [editingLicence, setEditingLicence] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [vehicleSearch, setVehicleSearch] = useState('')

  const {
    data: vehicleData,
    isLoading: loadingVehicles,
    refetch: refetchVehicles,
    isRefetching: refetchingVehicles,
    isError: isVehicleError,
    error: vehicleQueryError,
  } = useQuery({
    queryKey: ['gate-pass-vehicles'],
    queryFn: async () => {
      const res = await fetch('/api/gate-pass/vehicles', { cache: 'no-store' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `Failed to fetch fleet (HTTP ${res.status}).`)
      }
      return res.json() as Promise<{ vehicles: Vehicle[] }>
    },
    enabled: open,
    staleTime: 60000,
    retry: 2,
  })

  const { data: driverData, refetch: refetchDrivers, isLoading: loadingDrivers } = useQuery({
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

  const filteredVehicles = useMemo<Vehicle[]>(() => {
    if (!vehicleSearch.trim()) return vehicles
    const q = vehicleSearch.trim().toLowerCase().replace(/[\s\-_]/g, '')
    return vehicles.filter((v: Vehicle) => {
      const reg = (v.registrationNumber || '').toLowerCase().replace(/[\s\-_]/g, '')
      const model = (v.model || '').toLowerCase().replace(/[\s\-_]/g, '')
      const variant = (v.variant || '').toLowerCase().replace(/[\s\-_]/g, '')
      const color = (v.color || '').toLowerCase().replace(/[\s\-_]/g, '')
      const branch = (v.branchLabel || '').toLowerCase().replace(/[\s\-_]/g, '')
      const vinStr = v.vin.toLowerCase().replace(/[\s\-_]/g, '')
      return (
        reg.includes(q) ||
        model.includes(q) ||
        variant.includes(q) ||
        color.includes(q) ||
        branch.includes(q) ||
        vinStr.includes(q)
      )
    })
  }, [vehicles, vehicleSearch])

  const filteredDrivers = useMemo<Driver[]>(() => {
    if (!driverSearch.trim()) return drivers
    const q = driverSearch.trim().toLowerCase()
    return drivers.filter((d) =>
      d.fullName.toLowerCase().includes(q) ||
      (d.email && d.email.toLowerCase().includes(q)) ||
      (d.role && d.role.toLowerCase().includes(q))
    )
  }, [drivers, driverSearch])

  const chosenVehicle = vehicles.find((v) => v.vin === vin) ?? null
  const chosenDriver = drivers.find((d) =>
    (driverUserId && d.userId === driverUserId) ||
    (driverName.trim() && d.fullName.toLowerCase() === driverName.trim().toLowerCase())
  ) ?? null

  const hasValidLicenceOnFile = Boolean(
    !isManualDriver && chosenDriver && (chosenDriver.hasLicencePhoto || chosenDriver.hasLicence)
  )

  const reset = () => {
    setVin('')
    setIsManualDriver(false)
    setDriverUserId('')
    setDriverName('')
    setDriverSearch('')
    setPurpose(GATE_PASS_PURPOSES[0])
    setRemarks('')
    setLicencePhoto(null)
    setEditingLicence(false)
    setError('')
  }

  const submit = async () => {
    setError('')
    if (!driverName.trim()) {
      return setError('Please select an employee or enter the driver name.')
    }
    if (!vin) return setError('Please select a vehicle.')
    if (!purpose) return setError('Please select a purpose for travel.')

    setSaving(true)
    try {
      if (!isManualDriver && driverUserId && licencePhoto) {
        const formData = new FormData()
        formData.append('userId', driverUserId)
        formData.append('licenceNo', 'VERIFIED')
        formData.append('licencePhoto', licencePhoto)

        const uploadRes = await fetch('/api/gate-pass/drivers', {
          method: 'POST',
          body: formData,
        })
        if (!uploadRes.ok) {
          const uErr = await uploadRes.json().catch(() => ({}))
          throw new Error(uErr.error || 'Failed to save driver license against employee.')
        }
        await refetchDrivers()
      }

      const res = await fetch('/api/gate-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vin,
          driverKind: 'staff',
          driverUserId: !isManualDriver && driverUserId ? driverUserId : null,
          driverName: driverName.trim() || chosenDriver?.fullName || 'Staff Driver',
          driverLicenceNo: !isManualDriver && (chosenDriver?.hasLicence || licencePhoto) ? 'VERIFIED' : null,
          purpose,
          remarks: remarks.trim() || null,
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not raise the pass.')

      toast({
        title: `Gate pass ${json.pass?.passNo ?? ''} raised`,
        description: 'Sent for approval.',
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
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
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
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
                <User className="h-4 w-4 text-indigo-600" />
                Employee &amp; Driver Details
              </h3>
              <div className="flex items-center gap-1.5 bg-slate-200/70 p-0.5 rounded-lg text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    setIsManualDriver(false)
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    !isManualDriver
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  KIA Employee
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsManualDriver(true)
                    setDriverUserId('')
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    isManualDriver
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Manual Entry
                </button>
              </div>
            </div>

            {!isManualDriver ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-700">
                    Person Taking Car (KIA Employee) <span className="text-rose-500">*</span>
                  </Label>
                  {currentUser?.fullName && driverUserId !== currentUser.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setDriverUserId(currentUser.id)
                        setDriverName(currentUser.fullName || '')
                      }}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold hover:underline"
                    >
                      Self ({currentUser.fullName})
                    </button>
                  )}
                </div>

                {driverUserId && chosenDriver ? (
                  <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 shadow-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-xs uppercase shadow-sm">
                        <UserCheck className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {chosenDriver.fullName}
                        </p>
                        <p className="text-[11px] text-slate-600 truncate">
                          {chosenDriver.role ? chosenDriver.role.replace(/_/g, ' ') : 'KIA Staff'}
                          {chosenDriver.email ? ` · ${chosenDriver.email}` : ''}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDriverUserId('')
                        setDriverName('')
                        setLicencePhoto(null)
                        setEditingLicence(false)
                      }}
                      className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 bg-white border border-indigo-200 hover:bg-indigo-50 px-2.5 py-1 rounded-md transition-colors"
                    >
                      Change Employee
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 border border-slate-200 rounded-lg p-3 bg-white">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input
                        type="text"
                        value={driverSearch}
                        onChange={(e) => setDriverSearch(e.target.value)}
                        placeholder="Search KIA employee by name or role…"
                        className="h-8 pl-8 text-xs bg-slate-50 border-slate-200 rounded-lg"
                      />
                      {driverSearch && (
                        <button
                          type="button"
                          onClick={() => setDriverSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                        >
                          ×
                        </button>
                      )}
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-slate-100">
                      {loadingDrivers ? (
                        <p className="p-3 text-center text-xs text-slate-400">Loading KIA employees…</p>
                      ) : filteredDrivers.length === 0 ? (
                        <div className="p-3 text-center text-xs text-slate-500">
                          <p>No matching employees found.</p>
                          <button
                            type="button"
                            onClick={() => setIsManualDriver(true)}
                            className="mt-1 text-indigo-600 font-bold hover:underline"
                          >
                            Or enter driver name manually
                          </button>
                        </div>
                      ) : (
                        filteredDrivers.map((emp) => {
                          const isSelf = currentUser?.id === emp.userId
                          const hasDL = emp.hasLicencePhoto || emp.hasLicence
                          return (
                            <button
                              key={emp.userId}
                              type="button"
                              onClick={() => {
                                setDriverUserId(emp.userId)
                                setDriverName(emp.fullName)
                                setLicencePhoto(null)
                                setEditingLicence(false)
                              }}
                              className="w-full flex items-center justify-between p-2 text-left hover:bg-indigo-50/70 rounded-md transition-colors group"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-700">
                                    {emp.fullName}
                                  </span>
                                  {isSelf && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-700">
                                      You
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 truncate">
                                  {emp.role ? emp.role.replace(/_/g, ' ') : 'Staff'}
                                  {emp.email ? ` · ${emp.email}` : ''}
                                </p>
                              </div>
                              {hasDL ? (
                                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded shrink-0">
                                  License on File
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400 shrink-0">
                                  No License Saved
                                </span>
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Person Taking Car (Name) <span className="text-rose-500">*</span>
                </Label>
                <div className="relative">
                  <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  <Input
                    value={driverName}
                    onChange={(e) => {
                      setDriverName(e.target.value)
                      setDriverUserId('')
                    }}
                    placeholder="Enter full name of driver / guest…"
                    className="bg-white pl-9 text-xs sm:text-sm"
                    required
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Manual entry: this driver's license will not be saved into the employee database profile.
                </p>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-indigo-600" />
                  Driver Driving License Photo
                </Label>
                {hasValidLicenceOnFile && !editingLicence ? (
                  <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
                    Verified On File
                  </span>
                ) : !isManualDriver && driverUserId ? (
                  <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    Saves to employee profile
                  </span>
                ) : null}
              </div>

              {hasValidLicenceOnFile && !editingLicence ? (
                <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold text-emerald-950">Driving License Saved on Profile</p>
                      <p className="text-[11px] text-emerald-700">
                        {chosenDriver?.fullName}'s driving license is already on file and ready.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingLicence(true)}
                    className="text-xs h-7 border-emerald-300 text-emerald-800 bg-white hover:bg-emerald-100 shrink-0 font-semibold"
                  >
                    Update / Retake
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {editingLicence && hasValidLicenceOnFile && (
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-xs text-slate-600 font-medium">
                        Updating license for <strong>{chosenDriver?.fullName}</strong>:
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingLicence(false)
                          setLicencePhoto(null)
                        }}
                        className="text-xs text-slate-500 hover:text-slate-800 font-bold"
                      >
                        Keep existing license
                      </button>
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500">
                    Capture or upload a clear photo of the driver's license. Full-screen camera will open for crisp detail.
                  </p>

                  <VehicleTrackerCamera
                    label="Driver License"
                    onCapture={(file) => setLicencePhoto(file)}
                    allowUpload={true}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
                <Car className="h-4 w-4 text-indigo-600" />
                Vehicle Details
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 font-medium">
                  {loadingVehicles ? 'Loading…' : `${vehicles.length} cars`}
                </span>
                <button
                  type="button"
                  onClick={() => refetchVehicles()}
                  disabled={loadingVehicles || refetchingVehicles}
                  className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition-colors"
                >
                  <RefreshCw className={`h-3 w-3 ${refetchingVehicles ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="space-y-2 mb-2">
              <div className="relative">
                <Input
                  type="text"
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value)}
                  placeholder="Search by Reg No, Model, or Color…"
                  className="h-8 text-xs bg-white pr-7 rounded-lg"
                />
                {vehicleSearch && (
                  <button
                    type="button"
                    onClick={() => setVehicleSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-1"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            <Select value={vin} onValueChange={setVin}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="-- Select Vehicle from Demo Fleet --" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {loadingVehicles ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    Loading demo fleet…
                  </div>
                ) : filteredVehicles.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500 space-y-2">
                    <p>No matching vehicles found.</p>
                  </div>
                ) : (
                  filteredVehicles.map((v) => (
                    <SelectItem key={v.vin} value={v.vin} className="text-xs">
                      {v.registrationNumber || v.vin.slice(-6)} - {v.model} ({v.branchLabel})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
              <FileText className="h-4 w-4 text-indigo-600" />
              Trip Details
            </h3>

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
              <Label htmlFor="remarks" className="text-xs font-semibold text-slate-700">
                Remarks <span className="text-slate-400 font-normal">(Optional)</span>
              </Label>
              <Textarea
                id="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                className="mt-1 bg-white"
                placeholder="Any additional trip notes..."
              />
            </div>
          </div>

          {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 font-medium">{error}</p> : null}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit Gate Pass
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
