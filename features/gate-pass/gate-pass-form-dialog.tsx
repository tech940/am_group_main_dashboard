'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { GATE_PASS_PURPOSES, purposeRequiresNote } from '@/lib/gate-pass/status'
import { LicenceCapture } from './licence-capture'

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

/**
 * Raise a gate pass.
 *
 * ── The two things this form is careful about ─────────────────────────────────────────────────
 * 1. Vehicles are chosen by VIN, and the label shows model + colour + plate + VIN tail. A
 *    registration number does NOT identify a car here: `JK02C0059TC` is a trade-certificate plate
 *    worn by five different vehicles. Picking by plate alone would put the wrong car on the pass.
 * 2. An expired licence is refused here, at the desk — not at the gate with a customer waiting.
 */
export function GatePassFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [vin, setVin] = useState('')
  const [driverKind, setDriverKind] = useState<'staff' | 'customer'>('staff')
  const [driverUserId, setDriverUserId] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [purpose, setPurpose] = useState<string>(GATE_PASS_PURPOSES[0])
  const [purposeNote, setPurposeNote] = useState('')
  const [expectedReturnAt, setExpectedReturnAt] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
  const chosenDriver = drivers.find((d) => d.userId === driverUserId) ?? null

  // Pre-fill the driver's name from their profile, which is the whole point of the registry.
  useEffect(() => {
    if (driverKind === 'staff' && chosenDriver) {
      setDriverName(chosenDriver.fullName)
      setDriverPhone(chosenDriver.phone ?? '')
    }
  }, [driverKind, chosenDriver])

  const licenceProblem = useMemo(() => {
    if (driverKind !== 'staff' || !chosenDriver) return null
    if (!chosenDriver.hasLicence) return `${chosenDriver.fullName} has no driving licence on file.`
    if (chosenDriver.expired) return `${chosenDriver.fullName}'s driving licence has expired.`
    return null
  }, [driverKind, chosenDriver])

  const reset = () => {
    setVin(''); setDriverKind('staff'); setDriverUserId(''); setDriverName('')
    setDriverPhone(''); setPurpose(GATE_PASS_PURPOSES[0]); setPurposeNote('')
    setExpectedReturnAt(''); setRemarks(''); setError('')
  }

  const submit = async () => {
    setError('')
    if (!vin) return setError('Choose a vehicle.')
    if (!driverName.trim()) return setError('Name the driver.')
    if (!expectedReturnAt) return setError('Say when the vehicle is due back.')
    if (purposeRequiresNote(purpose) && !purposeNote.trim()) return setError('Say what the trip is for.')
    // Point at the fix, not just the problem — the capture panel is open right above this button.
    if (licenceProblem) return setError(`${licenceProblem} Record it in the panel above, then raise the pass.`)

    setSaving(true)
    try {
      const res = await fetch('/api/gate-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vin,
          driverKind,
          driverUserId: driverKind === 'staff' ? driverUserId || null : null,
          driverName: driverName.trim(),
          driverPhone: driverPhone.trim() || null,
          purpose,
          purposeNote: purposeNote.trim() || null,
          // datetime-local has no zone; the browser's own zone is what the user meant.
          expectedReturnAt: new Date(expectedReturnAt).toISOString(),
          remarks: remarks.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not raise the pass.')

      toast({
        title: `Gate pass ${json.pass?.passNo ?? ''} raised`,
        // A pass nobody can approve is a silent dead end — say so rather than letting it sit.
        description: json.unstaffed
          ? 'No active approver is set for this branch. Chase a manager directly.'
          : 'The Sales Manager has been notified.',
        variant: json.unstaffed ? 'warning' : 'success',
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
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next) }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise a demo car gate pass</DialogTitle>
          <DialogDescription>
            The Sales Manager approves it, then you get a QR code to show at the gate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Vehicle</Label>
            <Select value={vin} onValueChange={setVin}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={loadingVehicles ? 'Loading the demo fleet…' : 'Choose a demo car'} />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => (
                  <SelectItem key={v.vin} value={v.vin}>
                    {[v.model, v.color].filter(Boolean).join(' ')}
                    {v.registrationNumber ? ` · ${v.registrationNumber}` : ''}
                    {` · ${v.vin.slice(-6)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosenVehicle?.sharedPlate ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Other demo cars share this registration number (it is a trade plate). Check the last
                six of the VIN — <strong>{chosenVehicle.vin.slice(-6)}</strong> — against the car itself.
              </p>
            ) : null}
            {chosenVehicle ? (
              <p className="mt-1 text-xs text-slate-500">
                {chosenVehicle.branchLabel}
                {chosenVehicle.lastKnownKms ? ` · last known ${chosenVehicle.lastKnownKms} km` : ''}
              </p>
            ) : null}
          </div>

          <div>
            <Label>Who is driving?</Label>
            <Select value={driverKind} onValueChange={(v) => setDriverKind(v as 'staff' | 'customer')}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">A member of staff</SelectItem>
                <SelectItem value="customer">A customer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {driverKind === 'staff' ? (
            <div>
              <Label>Staff driver</Label>
              <Select value={driverUserId} onValueChange={setDriverUserId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a colleague" /></SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => (
                    <SelectItem key={d.userId} value={d.userId}>
                      {d.fullName}
                      {d.hasLicence ? ` · ${d.licenceMasked}` : ' · no licence on file'}
                      {d.expired ? ' · EXPIRED' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {licenceProblem && chosenDriver ? (
                <div className="mt-2">
                  {/* Refusing without a way through is a dead end — and the way people get past a
                      dead end is to put somebody else's name in the driver field. */}
                  <LicenceCapture
                    key={chosenDriver.userId}
                    userId={chosenDriver.userId}
                    driverName={chosenDriver.fullName}
                    expired={chosenDriver.expired === true}
                    onSaved={async () => {
                      await refetchDrivers()
                      toast({ title: 'Licence saved', description: 'It will fill in automatically next time.', variant: 'success' })
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              The guard photographs the customer&apos;s licence at the gate. We do not store its number.
            </p>
          )}

          <div>
            <Label htmlFor="driverName">Driver name</Label>
            <Input id="driverName" value={driverName} onChange={(e) => setDriverName(e.target.value)}
              className="mt-1" placeholder="Name as it appears on the licence" />
          </div>

          <div>
            <Label>Purpose</Label>
            <Select value={purpose} onValueChange={setPurpose}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GATE_PASS_PURPOSES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {purposeRequiresNote(purpose) ? (
            <div>
              <Label htmlFor="purposeNote">What is it for?</Label>
              <Input id="purposeNote" value={purposeNote} onChange={(e) => setPurposeNote(e.target.value)}
                className="mt-1" placeholder="Required when the purpose is Other" />
            </div>
          ) : null}

          <div>
            <Label htmlFor="due">Due back</Label>
            <Input id="due" type="datetime-local" value={expectedReturnAt}
              onChange={(e) => setExpectedReturnAt(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label htmlFor="remarks">Remarks</Label>
            <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)}
              rows={2} className="mt-1" placeholder="Optional" />
          </div>

          {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Raise pass
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
