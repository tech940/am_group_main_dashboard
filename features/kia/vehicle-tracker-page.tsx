'use client'

/* eslint-disable react-hooks/set-state-in-effect -- default date/time + live clock are seeded in effects to keep render pure. */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Car, LogOut, LogIn, RefreshCw, Timer, CheckCircle2, CalendarDays } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { KIA_BRANCH_DEALERS, DEFAULT_KIA_DEALER_CODE } from '@/lib/kia/dealer-branch'
import { VehicleTrackerCamera } from '@/features/kia/vehicle-tracker-camera'

type Entry = {
  id: string
  name: string
  entryDate: string
  vehicleOutAt: string
  vehicleInAt: string | null
  status: 'out' | 'returned'
  durationMinutes: number | null
  outPhotoUrl: string
  inPhotoUrl: string | null
  dealerCode: string | null
  notes: string | null
  createdAt: string
}

const INPUT = 'h-11 w-full rounded-xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] px-3 text-sm font-semibold text-[var(--kia-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-action-bg)]'

function todayIso(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
function timeHm(now: Date) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}
function combineLocalIso(date: string, time: string) {
  const d = new Date(`${date}T${time || '00:00'}`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}
function formatDuration(min: number | null) {
  if (min == null || min < 0) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${m}m`
}
function formatTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
}

export function VehicleTrackerPage() {
  const queryClient = useQueryClient()
  const [now, setNow] = useState<number>(0)

  // Form state
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [outTime, setOutTime] = useState('')
  const [inTime, setInTime] = useState('')
  const [dealer, setDealer] = useState<string>(DEFAULT_KIA_DEALER_CODE)
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [cameraKey, setCameraKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // Filters
  const [filterStatus, setFilterStatus] = useState<'all' | 'out' | 'returned'>('all')

  // Mark-returned dialog
  const [returnTarget, setReturnTarget] = useState<Entry | null>(null)
  const [returnAt, setReturnAt] = useState('')
  const [returnPhoto, setReturnPhoto] = useState<File | null>(null)
  const [returning, setReturning] = useState(false)

  // Seed default date/time on mount + tick a live clock every 30s for elapsed timers.
  useEffect(() => {
    const n = new Date()
    setDate(todayIso(n))
    setOutTime(timeHm(n))
    setNow(n.getTime())
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const listQuery = useQuery({
    queryKey: ['kia-vehicle-tracker', filterStatus],
    queryFn: async () => {
      const res = await fetch(`/api/brands/kia/vehicle-tracker?status=${filterStatus}`, { cache: 'no-store' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Failed to load entries.')
      return (payload.rows || []) as Entry[]
    },
    staleTime: 15_000,
  })

  const rows = useMemo(() => listQuery.data || [], [listQuery.data])
  const outCount = rows.filter((r) => r.status === 'out').length

  async function submit() {
    if (!name.trim()) return toast({ title: 'Name required', description: 'Enter the name.', variant: 'error' })
    if (!date) return toast({ title: 'Date required', description: 'Pick a date.', variant: 'error' })
    if (!outTime) return toast({ title: 'Vehicle-out time required', description: 'Set when the vehicle went out.', variant: 'error' })
    if (!photo) return toast({ title: 'Photo required', description: 'Capture a photo of the vehicle with the camera first.', variant: 'error' })

    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('entryDate', date)
      fd.append('vehicleOut', combineLocalIso(date, outTime))
      if (inTime) fd.append('vehicleIn', combineLocalIso(date, inTime))
      fd.append('dealerCode', dealer)
      if (notes.trim()) fd.append('notes', notes.trim())
      fd.append('photo', photo)

      const res = await fetch('/api/brands/kia/vehicle-tracker', { method: 'POST', body: fd })
      const payload = await res.json()
      if (!res.ok) {
        if (payload.code === 'not_a_vehicle') {
          return toast({ title: 'Not a vehicle photo', description: payload.error, variant: 'error' })
        }
        throw new Error(payload.error || 'Failed to log the vehicle.')
      }
      toast({ title: 'Logged', description: `${name.trim()} recorded.`, variant: 'success' })
      // Reset for the next entry (keep date + dealer).
      setName('')
      setInTime('')
      setNotes('')
      setPhoto(null)
      setOutTime(timeHm(new Date()))
      setCameraKey((k) => k + 1)
      void queryClient.invalidateQueries({ queryKey: ['kia-vehicle-tracker'] })
    } catch (error) {
      toast({ title: 'Could not save', description: error instanceof Error ? error.message : 'Try again.', variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  function openReturn(entry: Entry) {
    const n = new Date()
    setReturnTarget(entry)
    setReturnPhoto(null)
    // datetime-local wants local time without seconds/zone
    setReturnAt(`${todayIso(n)}T${timeHm(n)}`)
  }

  async function submitReturn() {
    if (!returnTarget) return
    setReturning(true)
    try {
      const fd = new FormData()
      if (returnAt) {
        const iso = new Date(returnAt).toISOString()
        if (!Number.isNaN(new Date(returnAt).getTime())) fd.append('vehicleIn', iso)
      }
      if (returnPhoto) fd.append('photo', returnPhoto)
      const res = await fetch(`/api/brands/kia/vehicle-tracker/${returnTarget.id}`, { method: 'PATCH', body: fd })
      const payload = await res.json()
      if (!res.ok) {
        if (payload.code === 'not_a_vehicle') {
          return toast({ title: 'Not a vehicle photo', description: payload.error, variant: 'error' })
        }
        throw new Error(payload.error || 'Failed to mark returned.')
      }
      toast({ title: 'Marked returned', description: `Out for ${formatDuration(payload.row?.durationMinutes ?? null)}.`, variant: 'success' })
      setReturnTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['kia-vehicle-tracker'] })
    } catch (error) {
      toast({ title: 'Could not update', description: error instanceof Error ? error.message : 'Try again.', variant: 'error' })
    } finally {
      setReturning(false)
    }
  }

  return (
    <MainLayout title="Vehicle Tracker" subtitle="AM Kia · Service">
      <div className="kia-premium -m-4 min-h-screen bg-[var(--kia-canvas)] p-4 md:-m-6 md:p-6">
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
          {/* ── New entry form ── */}
          <section className="kia-surface rounded-[1.5rem] p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--dashboard-action-bg)_16%,transparent)] text-[var(--dashboard-action-bg)]">
                <LogOut className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-black tracking-tight text-[var(--kia-text)]">Log a vehicle out</h2>
                <p className="text-xs font-semibold text-[var(--kia-text-soft)]">Camera photo is AI-checked for a vehicle.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]">Name</Label>
                <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Driver / vehicle name" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]">Date</Label>
                  <input type="date" className={INPUT} value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]">Branch</Label>
                  <select className={INPUT} value={dealer} onChange={(e) => setDealer(e.target.value)}>
                    {KIA_BRANCH_DEALERS.map((b) => (
                      <option key={b.dealerCode} value={b.dealerCode}>{b.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]">Vehicle out</Label>
                  <input type="time" className={INPUT} value={outTime} onChange={(e) => setOutTime(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]">Vehicle in <span className="font-medium normal-case text-[var(--kia-text-faint)]">(optional)</span></Label>
                  <input type="time" className={INPUT} value={inTime} onChange={(e) => setInTime(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]">Vehicle photo (camera only)</Label>
                <VehicleTrackerCamera key={cameraKey} onCapture={setPhoto} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]">Notes <span className="font-medium normal-case text-[var(--kia-text-faint)]">(optional)</span></Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Purpose / destination" className="rounded-xl" />
              </div>

              <Button onClick={submit} disabled={submitting} className="h-12 w-full rounded-xl bg-[var(--dashboard-action-bg)] text-base font-black text-white hover:bg-[var(--dashboard-action-hover)]">
                {submitting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Car className="mr-2 h-5 w-5" />}
                {submitting ? 'Saving…' : 'Log vehicle out'}
              </Button>
            </div>
          </section>

          {/* ── Live list ── */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {([['all', 'All'], ['out', `Out (${outCount})`], ['returned', 'Returned']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setFilterStatus(value)}
                    className={cn(
                      'rounded-full px-4 py-1.5 text-xs font-black transition',
                      filterStatus === value
                        ? 'bg-[var(--dashboard-action-bg)] text-white'
                        : 'bg-[var(--kia-surface-sunken)] text-[var(--kia-text-soft)] hover:text-[var(--kia-text)]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button variant="outline" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching} className="h-9 rounded-xl">
                <RefreshCw className={cn('mr-2 h-4 w-4', listQuery.isFetching && 'animate-spin')} /> Refresh
              </Button>
            </div>

            {listQuery.isLoading ? (
              <div className="grid gap-3">
                {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-[var(--kia-surface-sunken)]" />)}
              </div>
            ) : rows.length === 0 ? (
              <div className="kia-surface grid place-items-center gap-2 rounded-2xl px-6 py-16 text-center">
                <Car className="h-10 w-10 text-[var(--kia-text-faint)]" />
                <p className="text-sm font-bold text-[var(--kia-text)]">No vehicles logged yet</p>
                <p className="max-w-xs text-xs font-semibold text-[var(--kia-text-soft)]">Log a vehicle out from the form to start tracking.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {rows.map((entry) => {
                  const isOut = entry.status === 'out'
                  const liveMin = isOut && now ? Math.max(0, Math.round((now - new Date(entry.vehicleOutAt).getTime()) / 60000)) : null
                  return (
                    <article key={entry.id} className="kia-surface overflow-hidden rounded-2xl">
                      <div className="flex gap-3 p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={entry.outPhotoUrl} alt={entry.name} className="h-20 w-24 shrink-0 rounded-xl object-cover" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-black text-[var(--kia-text)]">{entry.name}</p>
                            <span className={cn(
                              'shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide',
                              isOut ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600',
                            )}>
                              {isOut ? 'Out' : 'Returned'}
                            </span>
                          </div>
                          <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-semibold text-[var(--kia-text-soft)]">
                            <span className="inline-flex items-center gap-1"><LogOut className="h-3 w-3" /> {formatTime(entry.vehicleOutAt)}</span>
                            <span className="inline-flex items-center gap-1"><LogIn className="h-3 w-3" /> {formatTime(entry.vehicleInAt)}</span>
                          </div>
                          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-[var(--kia-surface-sunken)] px-2 py-1 text-[11px] font-black text-[var(--kia-text)]">
                            {isOut ? <Timer className="h-3.5 w-3.5 text-amber-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                            {isOut ? `Out for ${formatDuration(liveMin)}` : `Was out ${formatDuration(entry.durationMinutes)}`}
                          </div>
                        </div>
                      </div>
                      {isOut && (
                        <div className="border-t border-[var(--kia-hairline)] p-2">
                          <Button onClick={() => openReturn(entry)} className="h-9 w-full rounded-xl bg-emerald-600 text-xs font-black text-white hover:bg-emerald-700">
                            <LogIn className="mr-1.5 h-4 w-4" /> Mark returned
                          </Button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* ── Mark returned dialog ── */}
      <Dialog open={Boolean(returnTarget)} onOpenChange={(open) => { if (!open) setReturnTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><LogIn className="h-5 w-5" /> Mark returned</DialogTitle>
          </DialogHeader>
          {returnTarget && (
            <div className="space-y-3">
              <div className="rounded-xl bg-[var(--kia-surface-sunken)] p-3 text-sm">
                <p className="font-black text-[var(--kia-text)]">{returnTarget.name}</p>
                <p className="text-xs font-semibold text-[var(--kia-text-soft)]">Out at {formatTime(returnTarget.vehicleOutAt)}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]"><CalendarDays className="mr-1 inline h-3.5 w-3.5" /> Return time</Label>
                <input type="datetime-local" className={INPUT} value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]">Return photo <span className="font-medium normal-case text-[var(--kia-text-faint)]">(optional)</span></Label>
                <VehicleTrackerCamera key={returnTarget.id} label="return photo" onCapture={setReturnPhoto} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReturnTarget(null)} className="rounded-xl">Cancel</Button>
            <Button onClick={submitReturn} disabled={returning} className="rounded-xl bg-emerald-600 font-black text-white hover:bg-emerald-700">
              {returning ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Confirm return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
