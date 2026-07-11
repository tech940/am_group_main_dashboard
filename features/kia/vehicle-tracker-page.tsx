'use client'

/* eslint-disable react-hooks/set-state-in-effect -- default date/time + live clock are seeded in effects to keep render pure. */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Car, LogOut, LogIn, RefreshCw, Timer, CheckCircle2, Eye } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

const INPUT = 'h-12 w-full rounded-xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] px-3 text-base font-semibold text-[var(--kia-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-action-bg)]'
const LABEL = 'text-xs font-bold uppercase tracking-wide text-[var(--kia-text-soft)]'

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
  return h <= 0 ? `${m}m` : `${h}h ${m}m`
}
function formatTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
}

export function VehicleTrackerPage({ canFill = false }: { canFill?: boolean }) {
  const queryClient = useQueryClient()
  const [now, setNow] = useState<number>(0)
  const [mode, setMode] = useState<'out' | 'in'>('out')
  const [filterStatus, setFilterStatus] = useState<'all' | 'out' | 'returned'>('all')

  // Out form
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [outTime, setOutTime] = useState('')
  const [dealer, setDealer] = useState<string>(DEFAULT_KIA_DEALER_CODE)
  const [notes, setNotes] = useState('')
  const [outPhoto, setOutPhoto] = useState<File | null>(null)
  const [outCamKey, setOutCamKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // In form
  const [selectedId, setSelectedId] = useState('')
  const [returnAt, setReturnAt] = useState('')
  const [inPhoto, setInPhoto] = useState<File | null>(null)
  const [inCamKey, setInCamKey] = useState(0)
  const [returning, setReturning] = useState(false)

  useEffect(() => {
    const n = new Date()
    setDate(todayIso(n))
    setOutTime(timeHm(n))
    setReturnAt(`${todayIso(n)}T${timeHm(n)}`)
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

  // Currently-out vehicles for the "Vehicle In" picker (always fetched, unfiltered).
  const outQuery = useQuery({
    queryKey: ['kia-vehicle-tracker', 'out'],
    queryFn: async () => {
      const res = await fetch('/api/brands/kia/vehicle-tracker?status=out', { cache: 'no-store' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Failed to load out vehicles.')
      return (payload.rows || []) as Entry[]
    },
    staleTime: 15_000,
    enabled: canFill,
  })

  const rows = useMemo(() => listQuery.data || [], [listQuery.data])
  const outVehicles = useMemo(() => outQuery.data || [], [outQuery.data])
  const selected = outVehicles.find((v) => v.id === selectedId) || null
  const returnPreviewMin = selected && returnAt
    ? Math.max(0, Math.round((new Date(returnAt).getTime() - new Date(selected.vehicleOutAt).getTime()) / 60000))
    : null

  function refreshAll() {
    void queryClient.invalidateQueries({ queryKey: ['kia-vehicle-tracker'] })
  }

  async function submitOut() {
    if (!name.trim()) return toast({ title: 'Name required', description: 'Enter the vehicle / driver name.', variant: 'error' })
    if (!date || !outTime) return toast({ title: 'Time out required', description: 'Set the date and out time.', variant: 'error' })
    if (!outPhoto) return toast({ title: 'Front photo required', description: 'Capture the FRONT of the vehicle with the camera.', variant: 'error' })

    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('entryDate', date)
      fd.append('vehicleOut', combineLocalIso(date, outTime))
      fd.append('dealerCode', dealer)
      if (notes.trim()) fd.append('notes', notes.trim())
      fd.append('photo', outPhoto)

      const res = await fetch('/api/brands/kia/vehicle-tracker', { method: 'POST', body: fd })
      const payload = await res.json()
      if (!res.ok) {
        if (payload.code === 'not_a_vehicle') return toast({ title: 'Photo rejected', description: payload.error, variant: 'error' })
        throw new Error(payload.error || 'Failed to log the vehicle.')
      }
      toast({ title: 'Vehicle out logged', description: `${name.trim()} recorded.`, variant: 'success' })
      setName(''); setNotes(''); setOutPhoto(null); setOutTime(timeHm(new Date())); setOutCamKey((k) => k + 1)
      refreshAll()
    } catch (error) {
      toast({ title: 'Could not save', description: error instanceof Error ? error.message : 'Try again.', variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function submitIn() {
    if (!selectedId) return toast({ title: 'Select a vehicle', description: 'Pick a vehicle that is currently out.', variant: 'error' })
    if (!returnAt) return toast({ title: 'Time in required', description: 'Set the return time.', variant: 'error' })
    if (!inPhoto) return toast({ title: 'Front photo required', description: 'Capture the FRONT of the returning vehicle.', variant: 'error' })

    setReturning(true)
    try {
      const fd = new FormData()
      fd.append('vehicleIn', new Date(returnAt).toISOString())
      fd.append('photo', inPhoto)
      const res = await fetch(`/api/brands/kia/vehicle-tracker/${selectedId}`, { method: 'PATCH', body: fd })
      const payload = await res.json()
      if (!res.ok) {
        if (payload.code === 'not_a_vehicle') return toast({ title: 'Photo rejected', description: payload.error, variant: 'error' })
        throw new Error(payload.error || 'Failed to mark returned.')
      }
      toast({ title: 'Vehicle in logged', description: `Out for ${formatDuration(payload.row?.durationMinutes ?? null)}.`, variant: 'success' })
      setSelectedId(''); setInPhoto(null); setInCamKey((k) => k + 1); setReturnAt(`${todayIso(new Date())}T${timeHm(new Date())}`)
      refreshAll()
    } catch (error) {
      toast({ title: 'Could not update', description: error instanceof Error ? error.message : 'Try again.', variant: 'error' })
    } finally {
      setReturning(false)
    }
  }

  return (
    <MainLayout title="Vehicle Tracker" subtitle="AM Kia · Service">
      <div className="kia-premium -m-4 min-h-screen bg-[var(--kia-canvas)] p-3 sm:p-4 md:-m-6 md:p-6">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,440px)_1fr] lg:gap-5">

          {/* ── Form (fill roles only) ── */}
          {canFill && (
            <section className="kia-surface rounded-2xl p-3.5 sm:p-5">
              {/* Segmented Out / In */}
              <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-[var(--kia-surface-sunken)] p-1.5">
                {([['out', 'Vehicle Out', LogOut], ['in', 'Vehicle In', LogIn]] as const).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    onClick={() => setMode(value)}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black transition',
                      mode === value ? 'bg-[var(--dashboard-action-bg)] text-white shadow' : 'text-[var(--kia-text-soft)]',
                    )}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>

              {mode === 'out' ? (
                <div className="mt-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label className={LABEL}>Name</Label>
                    <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Driver / vehicle name" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className={LABEL}>Date</Label>
                      <input type="date" className={INPUT} value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className={LABEL}>Time out</Label>
                      <input type="time" className={INPUT} value={outTime} onChange={(e) => setOutTime(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className={LABEL}>Branch</Label>
                    <select className={INPUT} value={dealer} onChange={(e) => setDealer(e.target.value)}>
                      {KIA_BRANCH_DEALERS.map((b) => <option key={b.dealerCode} value={b.dealerCode}>{b.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className={LABEL}>Front photo (camera only)</Label>
                    <VehicleTrackerCamera key={outCamKey} label="front of the vehicle" onCapture={setOutPhoto} />
                    <p className="text-[11px] font-medium text-[var(--kia-text-faint)]">Only the vehicle&rsquo;s front is accepted — AI checks each photo.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className={LABEL}>Notes <span className="font-medium normal-case text-[var(--kia-text-faint)]">(optional)</span></Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Purpose / destination" className="rounded-xl text-base" />
                  </div>
                  <Button onClick={submitOut} disabled={submitting} className="h-12 w-full rounded-xl bg-[var(--dashboard-action-bg)] text-base font-black text-white hover:bg-[var(--dashboard-action-hover)]">
                    {submitting ? <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> : <LogOut className="mr-2 h-5 w-5" />}
                    {submitting ? 'Saving…' : 'Log vehicle out'}
                  </Button>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label className={LABEL}>Vehicle that is returning</Label>
                    <select className={INPUT} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                      <option value="">{outVehicles.length ? 'Select a vehicle that is out…' : 'No vehicles are currently out'}</option>
                      {outVehicles.map((v) => (
                        <option key={v.id} value={v.id}>{v.name} · out {formatTime(v.vehicleOutAt)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className={LABEL}>Time in</Label>
                    <input type="datetime-local" className={INPUT} value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
                    {returnPreviewMin != null && (
                      <p className="text-[11px] font-bold text-[var(--kia-text-soft)]">Out for {formatDuration(returnPreviewMin)}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className={LABEL}>Front photo on return (camera only)</Label>
                    <VehicleTrackerCamera key={inCamKey} label="front of the vehicle" onCapture={setInPhoto} />
                  </div>
                  <Button onClick={submitIn} disabled={returning || !selectedId} className="h-12 w-full rounded-xl bg-emerald-600 text-base font-black text-white hover:bg-emerald-700">
                    {returning ? <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> : <LogIn className="mr-2 h-5 w-5" />}
                    {returning ? 'Saving…' : 'Log vehicle in'}
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* ── Live list ── */}
          <section className="space-y-3">
            {!canFill && (
              <div className="flex items-center gap-2 rounded-xl bg-[var(--kia-surface-sunken)] px-3 py-2 text-xs font-bold text-[var(--kia-text-soft)]">
                <Eye className="h-4 w-4" /> View only — General Service Manager
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {([['all', 'All'], ['out', `Out (${outVehicles.length || rows.filter((r) => r.status === 'out').length})`], ['returned', 'Returned']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setFilterStatus(value)}
                    className={cn(
                      'rounded-full px-3.5 py-1.5 text-xs font-black transition',
                      filterStatus === value ? 'bg-[var(--dashboard-action-bg)] text-white' : 'bg-[var(--kia-surface-sunken)] text-[var(--kia-text-soft)]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button variant="outline" onClick={() => { listQuery.refetch(); outQuery.refetch() }} disabled={listQuery.isFetching} className="h-9 rounded-xl">
                <RefreshCw className={cn('mr-2 h-4 w-4', listQuery.isFetching && 'animate-spin')} /> Refresh
              </Button>
            </div>

            {listQuery.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-[var(--kia-surface-sunken)]" />)}</div>
            ) : rows.length === 0 ? (
              <div className="kia-surface grid place-items-center gap-2 rounded-2xl px-6 py-16 text-center">
                <Car className="h-10 w-10 text-[var(--kia-text-faint)]" />
                <p className="text-sm font-bold text-[var(--kia-text)]">No vehicles logged yet</p>
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
                            <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide', isOut ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600')}>
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
                      {isOut && canFill && (
                        <div className="border-t border-[var(--kia-hairline)] p-2">
                          <Button
                            onClick={() => { setMode('in'); setSelectedId(entry.id); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                            className="h-9 w-full rounded-xl bg-emerald-600 text-xs font-black text-white hover:bg-emerald-700"
                          >
                            <LogIn className="mr-1.5 h-4 w-4" /> Log this vehicle in
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
    </MainLayout>
  )
}
