'use client'

import { useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { VehicleTrackerCamera } from '@/features/kia/vehicle-tracker-camera'
import { GateSignaturePad } from './signature-pad'

type GuardView = {
  passNo: string
  status: string
  purposeOfVisit: 'out' | 'in'
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  keyNumber: string | null
  branchLabel: string
  driverName: string
  driverLicenceMasked: string | null
  driverLicenceValid: boolean | null
  purpose: string
  purposeNote: string | null
  expectedReturnAt: string
  approvedByName: string | null
  approvedAt: string | null
  gateOutAt: string | null
  gateOutOdo: string | null
  blockedReason: string | null
}

/**
 * The guard's screen. Reached by scanning a QR with the phone's own camera — no app, no login.
 *
 * Designed for one hand, outdoors, in a hurry: large targets, one column, and nothing optional
 * above anything required.
 */
export function GuardForm({ pass, token }: { pass: GuardView; token: string }) {
  const isOut = pass.purposeOfVisit === 'out'
  const [guardName, setGuardName] = useState('')
  const [odometer, setOdometer] = useState('')
  const [parkedLocation, setParkedLocation] = useState('')
  const [keyHandoverTo, setKeyHandoverTo] = useState('')
  const [notes, setNotes] = useState('')
  const [frontPhoto, setFrontPhoto] = useState<File | null>(null)
  const [odoPhoto, setOdoPhoto] = useState<File | null>(null)
  const [signature, setSignature] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<'recorded' | 'already' | null>(null)

  if (pass.blockedReason) {
    return (
      <Shell pass={pass}>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mb-2 h-5 w-5" />
          <p className="font-medium">{pass.blockedReason}</p>
          <p className="mt-1 text-amber-800">Nothing to do here. Let the vehicle through or ask the driver to check with the showroom.</p>
        </div>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell pass={pass}>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
          <p className="text-base font-semibold text-emerald-900">
            {isOut ? 'Vehicle signed out' : 'Vehicle signed back in'}
          </p>
          <p className="mt-1 text-sm text-emerald-800">
            {done === 'already'
              ? 'This was already recorded — nothing was changed.'
              : 'Recorded. The showroom has been notified.'}
          </p>
        </div>
      </Shell>
    )
  }

  const submit = async () => {
    setError('')
    if (!guardName.trim()) return setError('Please enter your name.')
    setSubmitting(true)
    try {
      const body = new FormData()
      body.set('guardName', guardName.trim())
      body.set('odometer', odometer)
      body.set('passNo', pass.passNo)
      body.set('notes', notes)
      if (!isOut) {
        body.set('parkedLocation', parkedLocation)
        body.set('keyHandoverTo', keyHandoverTo)
      }
      if (frontPhoto) {
        body.append('photos', frontPhoto)
        body.append('photoKinds', 'vehicle_front')
      }
      if (odoPhoto) {
        body.append('photos', odoPhoto)
        body.append('photoKinds', 'odometer')
      }
      if (signature) body.set('signature', signature)

      const res = await fetch(`/api/gate/${encodeURIComponent(token)}/submit`, { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not record that.')
      setDone(json.alreadyDone ? 'already' : 'recorded')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Shell pass={pass}>
      <div className="space-y-5">
        <div>
          <Label htmlFor="guardName">Your name</Label>
          <Input
            id="guardName"
            value={guardName}
            onChange={(e) => setGuardName(e.target.value)}
            placeholder="Security guard on duty"
            className="mt-1 h-12 text-base"
            autoComplete="name"
          />
        </div>

        <div>
          <Label htmlFor="odometer">Odometer (km)</Label>
          <Input
            id="odometer"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            placeholder={pass.gateOutOdo ? `Reading when it left: ${pass.gateOutOdo}` : 'Reading on the dashboard'}
            className="mt-1 h-12 text-base"
          />
        </div>

        {!isOut ? (
          <>
            <div>
              <Label htmlFor="parked">Where is it parked?</Label>
              <Input id="parked" value={parkedLocation} onChange={(e) => setParkedLocation(e.target.value)}
                className="mt-1 h-12 text-base" placeholder="e.g. Front yard, bay 3" />
            </div>
            <div>
              <Label htmlFor="keys">Keys handed to</Label>
              <Input id="keys" value={keyHandoverTo} onChange={(e) => setKeyHandoverTo(e.target.value)}
                className="mt-1 h-12 text-base" placeholder="Name of whoever took the keys" />
            </div>
          </>
        ) : null}

        {/* Reused as-is from the Vehicle Tracker: rear camera, burned-in IST timestamp, retake,
            and it already handles a blocked permission and the black-screen race.
            ⚠️ It renders its label only inside a sentence, so two of these stacked look identical.
            The headings below are what tells a guard which photo is which. */}
        <div className="space-y-1.5">
          <Label>Photo of the vehicle {frontPhoto ? <Check className="ml-1 inline h-3.5 w-3.5 text-emerald-600" /> : null}</Label>
          <VehicleTrackerCamera label="front of the vehicle" onCapture={setFrontPhoto} />
        </div>
        <div className="space-y-1.5">
          <Label>Photo of the odometer {odoPhoto ? <Check className="ml-1 inline h-3.5 w-3.5 text-emerald-600" /> : null}</Label>
          <VehicleTrackerCamera label="odometer reading" onCapture={setOdoPhoto} />
        </div>

        <GateSignaturePad label="Driver's signature" onCapture={setSignature} />

        <div>
          <Label htmlFor="notes">Anything to note?</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
            className="mt-1" rows={2} placeholder="Damage, missing items, anything unusual" />
        </div>

        {error ? (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}

        <Button onClick={submit} disabled={submitting} className="h-14 w-full text-base">
          {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
          {isOut ? 'Sign vehicle OUT' : 'Sign vehicle IN'}
        </Button>

        <p className="text-center text-xs text-slate-500">
          Photos are optional if the camera will not open — the reading and your name are what matter.
        </p>
      </div>
    </Shell>
  )
}

/** The identity block. Everything here comes from the server-side allowlist. */
function Shell({ pass, children }: { pass: GuardView; children: React.ReactNode }) {
  const vehicle = [pass.model, pass.variant, pass.color].filter(Boolean).join(' · ')
  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-slate-50 px-4 py-6">
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          {pass.purposeOfVisit === 'out' ? 'Vehicle going out' : 'Vehicle coming in'}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          {pass.registrationNumber || 'No registration recorded'}
        </h1>
        <p className="text-sm text-slate-600">{vehicle || 'Vehicle details not recorded'}</p>

        <dl className="mt-4 space-y-1.5 text-sm">
          <Row label="Pass" value={pass.passNo} />
          <Row label="Branch" value={pass.branchLabel} />
          <Row label="Driver" value={pass.driverName} />
          <Row
            label="Licence"
            value={pass.driverLicenceMasked ?? 'Check physically'}
            warn={pass.driverLicenceValid === false}
            warnText={pass.driverLicenceValid === false ? 'EXPIRED' : undefined}
          />
          <Row label="Purpose" value={pass.purposeNote ? `${pass.purpose} — ${pass.purposeNote}` : pass.purpose} />
          <Row label="Due back" value={pass.expectedReturnAt} />
          {pass.approvedByName ? <Row label="Approved by" value={pass.approvedByName} /> : null}
          {pass.gateOutAt ? <Row label="Left at" value={pass.gateOutAt} /> : null}
          {pass.keyNumber ? <Row label="Key number" value={pass.keyNumber} /> : null}
        </dl>

        {pass.driverLicenceValid === false ? (
          <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
            This driver&apos;s licence has expired. Do not release the vehicle without checking with the showroom.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{children}</div>
    </div>
  )
}

function Row({ label, value, warn, warnText }: { label: string; value: string; warn?: boolean; warnText?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={warn ? 'text-right font-semibold text-rose-700' : 'text-right font-medium text-slate-900'}>
        {value}{warnText ? ` (${warnText})` : ''}
      </dd>
    </div>
  )
}
