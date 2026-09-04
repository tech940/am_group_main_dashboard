'use client'

import { useRef, useState } from 'react'
import { Camera, Check, Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Record a driving licence without leaving the request form.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * The form refuses a driver with no licence on file. Refusing without offering a way through is a
 * dead end, and the way people get past a dead end is to type a colleague's name into the driver
 * field instead — which defeats the entire point of recording who drove the car.
 *
 * ── Why a file input and not the camera component ─────────────────────────────────────────────
 * features/kia/vehicle-tracker-camera.tsx is camera-ONLY on purpose: at a gate you want proof the
 * photo was taken then and there. A licence is recorded at a desk, days before any trip, and the
 * person may well already have a photo of it. So this accepts either — a plain `accept="image/*"`
 * input, which on a phone offers "Take Photo or Choose", and on a laptop opens the file picker.
 * Forcing `capture="environment"` would block the gallery and make a desk-bound colleague
 * photograph a licence they are not holding.
 */
export function LicenceCapture({
  userId,
  driverName,
  expired,
  onSaved,
}: {
  userId: string
  driverName: string
  expired: boolean
  onSaved: () => void
}) {
  const [licenceNo, setLicenceNo] = useState('')
  const [licenceName, setLicenceName] = useState(driverName)
  const [expiry, setExpiry] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const save = async () => {
    setError('')
    if (!licenceNo.trim()) return setError('Enter the licence number.')
    setSaving(true)
    try {
      const body = new FormData()
      body.set('userId', userId)
      body.set('licenceNo', licenceNo.trim())
      body.set('licenceName', licenceName.trim())
      if (expiry) body.set('licenceExpiry', expiry)
      if (photo) body.set('licencePhoto', photo)

      const res = await fetch('/api/gate-pass/drivers', { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not save the licence.')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the licence.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-sm font-medium text-amber-900">
        {expired
          ? `${driverName}'s licence has expired — record the current one.`
          : `Add ${driverName}'s driving licence`}
      </p>
      <p className="mt-0.5 text-xs text-amber-800">
        Recorded once, then it fills in automatically on every future pass.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="lic-no" className="text-xs">Licence number</Label>
          <Input
            id="lic-no"
            value={licenceNo}
            onChange={(e) => setLicenceNo(e.target.value)}
            className="mt-1 bg-white"
            placeholder="e.g. JK0220110012345"
            autoComplete="off"
          />
        </div>

        <div>
          <Label htmlFor="lic-name" className="text-xs">Name as printed on the licence</Label>
          <Input
            id="lic-name"
            value={licenceName}
            onChange={(e) => setLicenceName(e.target.value)}
            className="mt-1 bg-white"
            placeholder="Exactly as it appears on the card"
          />
          <p className="mt-1 text-xs text-amber-700">
            The guard checks the physical card against this, so use what the card says — not what we
            have on file.
          </p>
        </div>

        <div>
          <Label htmlFor="lic-exp" className="text-xs">Valid until</Label>
          <Input
            id="lic-exp"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="mt-1 bg-white"
          />
        </div>

        <div>
          <Label className="text-xs">Photo of the licence (optional)</Label>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              if (file && file.size > 10 * 1024 * 1024) {
                setError('That image is larger than 10 MB.')
                return
              }
              setError('')
              setPhoto(file)
            }}
          />
          {photo ? (
            <div className="mt-1 flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              <span className="flex-1 truncate text-sm text-slate-700">{photo.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => {
                setPhoto(null)
                if (fileRef.current) fileRef.current.value = ''
              }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="mt-1 w-full bg-white"
              onClick={() => fileRef.current?.click()}
            >
              <Camera className="mr-1.5 h-4 w-4" />
              Take a photo
              <span className="mx-1.5 text-slate-300">/</span>
              <Upload className="mr-1.5 h-4 w-4" />
              Choose a file
            </Button>
          )}
          <p className="mt-1 text-xs text-amber-700">
            Stored privately — never shown on the guard&apos;s screen, which sees only the last four digits.
          </p>
        </div>

        {error ? (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}

        <Button type="button" onClick={save} disabled={saving} className="w-full">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save licence
        </Button>
      </div>
    </div>
  )
}
