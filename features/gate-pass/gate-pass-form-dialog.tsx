'use client'

import { useEffect, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
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

const KIA_QUICK_MODELS = ['SONET', 'SELTOS', 'CARENS', 'CARNIVAL', 'SYROS', 'EV6', 'EV9']
const KIA_BRANCH_OPTIONS = [
  { code: 'JK402', label: 'Jammu (JK402)' },
  { code: 'PB402', label: 'Pathankot (PB402)' },
  { code: 'JK403', label: 'Udhampur (JK403)' },
]

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
  const [isAddingNewVehicle, setIsAddingNewVehicle] = useState(false)
  const [manualRegNo, setManualRegNo] = useState('')
  const [manualModel, setManualModel] = useState('')
  const [manualVariant, setManualVariant] = useState('')
  const [manualVin, setManualVin] = useState('')
  const [manualColor, setManualColor] = useState('')
  const [manualDealerCode, setManualDealerCode] = useState('JK402')
  const [manualKms, setManualKms] = useState('')
  const [creatingVehicle, setCreatingVehicle] = useState(false)

  const [isManualDriver, setIsManualDriver] = useState(false)
  const [driverUserId, setDriverUserId] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverSearch, setDriverSearch] = useState('')
  const [isAddingNewEmployee, setIsAddingNewEmployee] = useState(false)
  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [newEmployeePhone, setNewEmployeePhone] = useState('')
  const [newEmployeeDept, setNewEmployeeDept] = useState('Driver')
  const [creatingEmployee, setCreatingEmployee] = useState(false)
  const [saveManualAsEmployee, setSaveManualAsEmployee] = useState(false)

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

  const handleAddNewEmployee = async (nameToUse?: string) => {
    const targetName = (nameToUse || newEmployeeName || driverSearch).trim()
    if (!targetName) {
      toast({ title: 'Name Required', description: 'Please enter employee name.', variant: 'error' })
      return
    }
    setCreatingEmployee(true)
    try {
      const res = await fetch('/api/gate-pass/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_employee',
          fullName: targetName,
          phone: newEmployeePhone.trim() || undefined,
          department: newEmployeeDept.trim() || 'Driver',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add employee.')

      toast({
        title: 'Employee Added',
        description: `${targetName} has been added to KIA Employees.`,
        variant: 'success',
      })

      await refetchDrivers()
      setDriverUserId(data.userId)
      setDriverName(targetName)
      setIsManualDriver(false)
      setIsAddingNewEmployee(false)
      setNewEmployeeName('')
      setNewEmployeePhone('')
      setDriverSearch('')
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add employee',
        variant: 'error',
      })
    } finally {
      setCreatingEmployee(false)
    }
  }

  const handleAddNewVehicle = async (regToUse?: string) => {
    const reg = (regToUse || manualRegNo || vehicleSearch).trim().toUpperCase()
    if (!reg) {
      toast({ title: 'Registration Required', description: 'Please enter vehicle registration number.', variant: 'error' })
      return null
    }
    const model = (manualModel || 'SONET').trim().toUpperCase()
    setCreatingVehicle(true)
    try {
      const res = await fetch('/api/gate-pass/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationNumber: reg,
          model,
          variant: manualVariant.trim().toUpperCase() || undefined,
          vin: manualVin.trim().toUpperCase() || undefined,
          color: manualColor.trim().toUpperCase() || undefined,
          dealerCode: manualDealerCode || 'JK402',
          currentKms: manualKms ? Number(manualKms) : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add vehicle.')

      toast({
        title: 'Vehicle Added to Fleet',
        description: `${reg} (${model}) has been saved permanently to the fleet.`,
        variant: 'success',
      })

      await refetchVehicles()
      setVin(data.vehicle.vin)
      setIsAddingNewVehicle(false)
      setManualRegNo('')
      setManualModel('')
      setManualVariant('')
      setManualVin('')
      setManualColor('')
      setManualKms('')
      setVehicleSearch('')
      return data.vehicle.vin as string
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add vehicle',
        variant: 'error',
      })
      return null
    } finally {
      setCreatingVehicle(false)
    }
  }

  const reset = () => {
    setVin('')
    setIsAddingNewVehicle(false)
    setManualRegNo('')
    setManualModel('')
    setManualVariant('')
    setManualVin('')
    setManualColor('')
    setManualDealerCode('JK402')
    setManualKms('')
    setVehicleSearch('')

    setIsManualDriver(false)
    setDriverUserId('')
    setDriverName('')
    setDriverSearch('')
    setIsAddingNewEmployee(false)
    setNewEmployeeName('')
    setNewEmployeePhone('')
    setSaveManualAsEmployee(false)
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
    if (!vin && !manualRegNo.trim()) {
      return setError('Please select or add a vehicle.')
    }
    if (!purpose) return setError('Please select a purpose for travel.')

    setSaving(true)
    try {
      let finalDriverUserId = driverUserId
      let finalVin = vin

      // If user is adding a new vehicle inline and hasn't saved yet, save permanently now
      if (isAddingNewVehicle && manualRegNo.trim()) {
        const addedVin = await handleAddNewVehicle()
        if (!addedVin) {
          setSaving(false)
          return
        }
        finalVin = addedVin
      }

      if (!finalVin) {
        setSaving(false)
        return setError('Please select a vehicle.')
      }

      // If user selected Manual Entry but checked "Save as KIA Employee", create them now
      if (isManualDriver && saveManualAsEmployee && driverName.trim()) {
        const empRes = await fetch('/api/gate-pass/drivers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_employee',
            fullName: driverName.trim(),
            department: 'Driver',
          }),
        })
        if (empRes.ok) {
          const empData = await empRes.json()
          finalDriverUserId = empData.userId
        }
      }

      // Save driver license against employee if an employee is linked and a photo was taken
      if ((!isManualDriver && driverUserId && licencePhoto) || (finalDriverUserId && licencePhoto)) {
        const formData = new FormData()
        formData.append('userId', finalDriverUserId || driverUserId)
        formData.append('licenceNo', 'VERIFIED')
        formData.append('licencePhoto', licencePhoto)

        const uploadRes = await fetch('/api/gate-pass/drivers', {
          method: 'POST',
          body: formData,
        })
        if (!uploadRes.ok) {
          const uErr = await uploadRes.json().catch(() => ({}))
          console.warn('License upload error:', uErr)
        }
        await refetchDrivers()
      }

      const res = await fetch('/api/gate-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vin: finalVin,
          driverKind: 'staff',
          driverUserId: finalDriverUserId || (!isManualDriver && driverUserId ? driverUserId : null),
          driverName: driverName.trim() || chosenDriver?.fullName || 'Staff Driver',
          driverLicenceNo: (finalDriverUserId || !isManualDriver) && (chosenDriver?.hasLicence || licencePhoto) ? 'VERIFIED' : null,
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
                ) : isAddingNewEmployee ? (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-3.5 space-y-3 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                        <UserPlus className="h-4 w-4 text-indigo-600" /> Add New KIA Employee / Driver
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsAddingNewEmployee(false)}
                        className="text-xs text-slate-400 hover:text-slate-700 font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-bold text-slate-700">Full Name *</Label>
                      <Input
                        value={newEmployeeName}
                        onChange={(e) => setNewEmployeeName(e.target.value)}
                        placeholder="e.g. Ramesh Sharma"
                        className="h-8 text-xs bg-white"
                        autoFocus
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-700">Phone (Optional)</Label>
                        <Input
                          value={newEmployeePhone}
                          onChange={(e) => setNewEmployeePhone(e.target.value)}
                          placeholder="9876543210"
                          className="h-8 text-xs bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-700">Department / Role</Label>
                        <Input
                          value={newEmployeeDept}
                          onChange={(e) => setNewEmployeeDept(e.target.value)}
                          placeholder="Driver / Sales / Staff"
                          className="h-8 text-xs bg-white"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setIsAddingNewEmployee(false)}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleAddNewEmployee()}
                        disabled={creatingEmployee || !newEmployeeName.trim()}
                        className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                      >
                        {creatingEmployee ? (
                          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-1.5 h-3 w-3" />
                        )}
                        Save &amp; Select Employee
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 border border-slate-200 rounded-lg p-3 bg-white">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setNewEmployeeName(driverSearch.trim())
                          setIsAddingNewEmployee(true)
                        }}
                        className="h-8 px-2.5 text-xs text-indigo-700 border-indigo-200 hover:bg-indigo-50 font-bold shrink-0"
                      >
                        <UserPlus className="mr-1 h-3.5 w-3.5" /> + Add New
                      </Button>
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-slate-100">
                      {loadingDrivers ? (
                        <p className="p-3 text-center text-xs text-slate-400">Loading KIA employees…</p>
                      ) : filteredDrivers.length === 0 ? (
                        <div className="p-3 text-center text-xs text-slate-500 space-y-2">
                          <p>No matching employees found.</p>
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                setNewEmployeeName(driverSearch.trim())
                                setIsAddingNewEmployee(true)
                              }}
                              className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                            >
                              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                              Add &quot;{driverSearch.trim() || 'New Employee'}&quot; to KIA
                            </Button>
                            <button
                              type="button"
                              onClick={() => {
                                setDriverName(driverSearch.trim())
                                setIsManualDriver(true)
                              }}
                              className="text-xs text-slate-600 font-medium hover:underline"
                            >
                              Or enter manually
                            </button>
                          </div>
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
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-700">
                    Person Taking Car (Name) <span className="text-rose-500">*</span>
                  </Label>
                  <label className="flex items-center gap-1.5 text-xs text-indigo-700 cursor-pointer select-none font-semibold">
                    <input
                      type="checkbox"
                      checked={saveManualAsEmployee}
                      onChange={(e) => setSaveManualAsEmployee(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                    />
                    Save as KIA Employee
                  </label>
                </div>
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
                  {saveManualAsEmployee
                    ? 'This driver will be saved into KIA Employees database, and any license photo captured below will be stored permanently on their profile.'
                    : "Manual entry: this driver's license will not be saved into the employee database profile."}
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
                ) : (!isManualDriver && driverUserId) || (isManualDriver && saveManualAsEmployee) ? (
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

          {/* Section 2: Vehicle Details */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
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
                  title="Refresh vehicle list"
                  className="text-slate-400 hover:text-slate-700 p-1 rounded transition-colors"
                >
                  <RefreshCw className={`h-3 w-3 ${refetchingVehicles ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {vin && chosenVehicle && !isAddingNewVehicle ? (
                <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 shadow-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-xs uppercase shadow-sm">
                      <Car className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {chosenVehicle.registrationNumber || 'No Reg Number'}
                        </p>
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800">
                          {chosenVehicle.model || 'Demo Car'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 truncate">
                        {[chosenVehicle.variant, chosenVehicle.color, chosenVehicle.branchLabel].filter(Boolean).join(' · ')}
                        {chosenVehicle.sharedPlate ? ` · VIN ${chosenVehicle.vin.slice(-6)}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVin('')}
                    className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 bg-white border border-indigo-200 hover:bg-indigo-50 px-2.5 py-1 rounded-md transition-colors shrink-0"
                  >
                    Change Vehicle
                  </button>
                </div>
              ) : isAddingNewVehicle ? (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-3.5 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                      <Plus className="h-4 w-4 text-indigo-600" /> Add Demo Vehicle to Fleet
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAddingNewVehicle(false)}
                      className="text-xs text-slate-400 hover:text-slate-700 font-medium"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label className="text-[11px] font-bold text-slate-700">Reg No / Plate *</Label>
                      <Input
                        value={manualRegNo}
                        onChange={(e) => setManualRegNo(e.target.value.toUpperCase())}
                        placeholder="e.g. JK02CR-0880"
                        className="h-8 text-xs bg-white font-mono uppercase font-semibold"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-bold text-slate-700">Model *</Label>
                      <Input
                        value={manualModel}
                        onChange={(e) => setManualModel(e.target.value.toUpperCase())}
                        placeholder="e.g. SONET, SELTOS"
                        className="h-8 text-xs bg-white uppercase font-semibold"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="text-[10px] text-slate-400 font-medium mr-1">Quick Select:</span>
                    {KIA_QUICK_MODELS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setManualModel(m)}
                        className={`px-2 py-0.5 text-[10px] rounded font-semibold border transition-all ${
                          manualModel === m
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-700">Variant / Trim</Label>
                      <Input
                        value={manualVariant}
                        onChange={(e) => setManualVariant(e.target.value.toUpperCase())}
                        placeholder="e.g. HTX D1.5 6AT / GRAVITY"
                        className="h-8 text-xs bg-white uppercase"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-700">Color</Label>
                      <Input
                        value={manualColor}
                        onChange={(e) => setManualColor(e.target.value.toUpperCase())}
                        placeholder="e.g. CLEAR WHITE"
                        className="h-8 text-xs bg-white uppercase"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-700">Chassis / VIN (Optional)</Label>
                      <Input
                        value={manualVin}
                        onChange={(e) => setManualVin(e.target.value.toUpperCase())}
                        placeholder="e.g. MZBFB813..."
                        className="h-8 text-xs bg-white font-mono uppercase"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-700">Branch / Dealer</Label>
                      <Select value={manualDealerCode} onValueChange={setManualDealerCode}>
                        <SelectTrigger className="h-8 text-xs bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {KIA_BRANCH_OPTIONS.map((b) => (
                            <SelectItem key={b.code} value={b.code} className="text-xs">
                              {b.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-700">Current Kms</Label>
                      <Input
                        type="number"
                        value={manualKms}
                        onChange={(e) => setManualKms(e.target.value)}
                        placeholder="e.g. 1500"
                        className="h-8 text-xs bg-white"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setIsAddingNewVehicle(false)}
                      className="h-7 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleAddNewVehicle()}
                      disabled={creatingVehicle || !manualRegNo.trim()}
                      className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                    >
                      {creatingVehicle ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-1.5 h-3 w-3" />
                      )}
                      Save &amp; Select Vehicle
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 border border-slate-200 rounded-lg p-3 bg-white">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input
                        type="text"
                        value={vehicleSearch}
                        onChange={(e) => setVehicleSearch(e.target.value)}
                        placeholder="Search demo cars by Reg No, Model, Color, or Branch…"
                        className="h-8 pl-8 text-xs bg-slate-50 border-slate-200 rounded-lg"
                      />
                      {vehicleSearch && (
                        <button
                          type="button"
                          onClick={() => setVehicleSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setManualRegNo(vehicleSearch.trim().toUpperCase())
                        setIsAddingNewVehicle(true)
                      }}
                      className="h-8 px-2.5 text-xs text-indigo-700 border-indigo-200 hover:bg-indigo-50 font-bold shrink-0"
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> + Add Vehicle
                    </Button>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-slate-100">
                    {loadingVehicles ? (
                      <p className="p-3 text-center text-xs text-slate-400">Loading demo fleet…</p>
                    ) : filteredVehicles.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-500 space-y-2">
                        <p>No matching vehicles found.</p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              setManualRegNo(vehicleSearch.trim().toUpperCase())
                              setIsAddingNewVehicle(true)
                            }}
                            className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                          >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Add &quot;{vehicleSearch.trim() || 'New Vehicle'}&quot; to Fleet
                          </Button>
                        </div>
                      </div>
                    ) : (
                      filteredVehicles.map((v) => (
                        <button
                          key={v.vin}
                          type="button"
                          onClick={() => {
                            setVin(v.vin)
                            setVehicleSearch('')
                          }}
                          className="w-full flex items-center justify-between p-2 text-left hover:bg-indigo-50/70 rounded-md transition-colors group"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-700 font-mono">
                                {v.registrationNumber || v.vin.slice(-6)}
                              </span>
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 group-hover:bg-indigo-100 group-hover:text-indigo-800">
                                {v.model || 'Demo'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 truncate">
                              {[v.variant, v.color, v.branchLabel].filter(Boolean).join(' · ')}
                              {v.sharedPlate ? ` · VIN ${v.vin.slice(-6)}` : ''}
                            </p>
                          </div>
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded shrink-0">
                            {v.branchLabel}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
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
