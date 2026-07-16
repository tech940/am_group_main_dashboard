'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Loader2, Search, Plus, Check, Clock, Copy, X, Lock, AlertTriangle, PhoneCall, User2 } from 'lucide-react'
import { canRevealKiaFollowupPhone } from '@/lib/kia/pii'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type Followup = {
  id: string; bookingId: string; customerName: string; model: string | null; variant: string | null
  bookingNumber: string | null; bookingStatus: string; dealer: string | null
  assignedTo: string | null; assignedName: string | null; dueAt: string; status: string
  reason: string; priority: string; notes: string | null; source: string; outcome: string | null
  completedAt: string | null; createdAt: string
  notInterestedReason: string | null
  bucket: 'not_connected' | 'pending' | 'next_day'
  overdue: boolean
  /** Null unless the server decided this viewer may see it (canRevealKiaFollowupPhone). */
  customerPhone: string | null
}
type Counts = { not_connected: number; pending: number; next_day: number; overdue: number }
type ListResponse = { rows: Followup[]; counts: Counts; now: string }
type BookingHit = { id: string; customerName: string; model: string; variant: string; bookingNumber: string | null; dealer: string | null; status: string; consultantName: string | null }

const DEALER_LABELS: Record<string, string> = { JK402: 'Jammu', JK501: 'Udhampur' }
const REASONS = [
  { value: 'callback', label: 'Callback' },
  { value: 'payment_pending', label: 'Payment pending' },
  { value: 'document_pending', label: 'Documents' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'general', label: 'General' },
]
const OUTCOMES = [
  { value: 'reached', label: 'Reached / spoke' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'converted', label: 'Converted 🎉' },
  { value: 'done', label: 'Done / resolved' },
]
// Why the customer declined. Must mirror NOT_INTERESTED_REASONS in lib/kia/lead-followups.ts —
// the server rejects anything else.
const NOT_INTERESTED_REASONS = [
  { value: 'price', label: 'Price' },
  { value: 'bought_elsewhere', label: 'Bought elsewhere' },
  { value: 'finance_declined', label: 'Finance declined' },
  { value: 'postponed', label: 'Postponed purchase' },
  { value: 'model_unavailable', label: 'Model unavailable' },
  { value: 'other', label: 'Other' },
]
const REASON_LABEL: Record<string, string> = Object.fromEntries(REASONS.map((r) => [r.value, r.label]))
const NOT_INTERESTED_LABEL: Record<string, string> = Object.fromEntries(NOT_INTERESTED_REASONS.map((r) => [r.value, r.label]))

// The three categories. Between them they cover EVERY open follow-up — nothing is hidden.
const BUCKETS: { key: Followup['bucket']; label: string; tone: string; hint: string }[] = [
  { key: 'not_connected', label: 'Not Connected', tone: 'text-rose-600', hint: 'Last attempt didn\'t reach anyone — retry' },
  { key: 'pending', label: 'Pending Follow-ups', tone: 'text-amber-600', hint: 'Open — overdue first' },
  { key: 'next_day', label: 'Next Day', tone: 'text-indigo-600', hint: 'Due tomorrow' },
]

/** Remarks are mandatory server-side; mirror the rule so the button disables instead of erroring. */
const MIN_REMARK_LENGTH = 10
const MIN_REMARK_WORDS = 15
function countWords(str: string): number {
  return str.trim().split(/\s+/).filter(Boolean).length
}
// canRevealKiaFollowupPhone is client-safe by design (lib/kia/pii.ts) — same rule both sides.
/** Days the server auto-schedules the next touch after a successful contact. */
const FOLLOWUP_REPEAT_DAYS = 7
/** Outcomes the server treats as "contacted" and auto-repeats — mirrors CONTACTED_OUTCOMES. */
const CONTACTED_OUTCOME_VALUES = new Set(['reached', 'done'])

function dealerLabel(code: string | null) { return code ? (DEALER_LABELS[code] || code) : '—' }
function priorityDot(p: string) { return p === 'high' ? 'bg-rose-500' : p === 'low' ? 'bg-slate-300' : 'bg-amber-400' }
function defaultLocal(daysAhead = 1) {
  const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(10, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function formatDue(iso: string, bucket: Followup['bucket']) {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const diffMs = d.getTime() - Date.now()
  const days = Math.round(diffMs / 86_400_000)
  if (diffMs < 0 && bucket === 'pending') {
    const mins = Math.floor(-diffMs / 60_000)
    // Don't round a few minutes up to "1d overdue" — Math.ceil used to, which made a just-enrolled
    // booking claim it had been ignored for a day.
    if (mins < 60) return 'Due now'
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h overdue`
    return `${date} · ${Math.floor(hours / 24)}d overdue`
  }
  if (days === 0) return `Today · ${time}`
  if (days === 1) return `Tomorrow · ${time}`
  return `${date} · ${time}`
}

export function KiaFollowUpsPage({ currentUserRole }: { currentUserRole: string }) {
  const [mine, setMine] = useState(false)
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('all')
  const [adding, setAdding] = useState(false)
  const [calling, setCalling] = useState<Followup | null>(null)
  const [completing, setCompleting] = useState<Followup | null>(null)
  const [rescheduling, setRescheduling] = useState<Followup | null>(null)

  // UI hint only — the reveal endpoint re-checks the role server-side.
  const canCall = canRevealKiaFollowupPhone(currentUserRole)

  const query = useQuery<ListResponse>({
    queryKey: ['kia-followups', mine, search, reason],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (mine) params.set('mine', '1')
      if (search) params.set('search', search)
      if (reason !== 'all') params.set('reason', reason)
      const res = await fetch(`/api/brands/kia/follow-ups?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })
  const data = query.data
  const grouped = useMemo(() => {
    const g: Record<Followup['bucket'], Followup[]> = { not_connected: [], pending: [], next_day: [] }
    for (const r of data?.rows || []) g[r.bucket].push(r)
    return g
  }, [data])

  async function patch(id: string, body: Record<string, unknown>, successMsg: string) {
    const res = await fetch(`/api/brands/kia/follow-ups/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(result.error || 'Failed')
    toast({ title: successMsg, variant: 'success' })
    void query.refetch()
    return result
  }

  const stat = (label: string, value: number, tone: string) => (
    <div className="flex flex-col rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] px-4 py-3 shadow-sm">
      <span className={cn('text-2xl font-black', tone)}>{value}</span>
      <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</span>
    </div>
  )

  return (
    <MainLayout title="Booking Follow-ups" subtitle="Never let a lead go cold — every booking followed up until the vehicle is delivered">
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stat('Not Connected', data?.counts.not_connected ?? 0, 'text-rose-600')}
          {stat('Pending', data?.counts.pending ?? 0, 'text-amber-600')}
          {stat('Next Day', data?.counts.next_day ?? 0, 'text-indigo-600')}
          {stat('Overdue', data?.counts.overdue ?? 0, 'text-rose-600')}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {[{ k: false, l: 'All' }, { k: true, l: 'Assigned to me' }].map((t) => (
                <button key={t.l} onClick={() => setMine(t.k)} className={cn('rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors', mine === t.k ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900')}>{t.l}</button>
              ))}
            </div>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-9 w-40 rounded-xl text-xs font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reasons</SelectItem>
                {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, model or booking #…" className="ml-2 w-52 border-0 bg-transparent text-xs font-semibold outline-none" />
            </div>
          </div>
          <Button onClick={() => setAdding(true)} className="h-9 gap-1.5 rounded-xl bg-indigo-600 px-4 font-bold text-white hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add follow-up</Button>
        </div>

        {query.isLoading ? (
          <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(query.error as Error)?.message || 'Failed to load.'}</div>
        ) : (
          <div className="space-y-6">
            {BUCKETS.map((b) => {
              const rows = grouped[b.key]
              if (!rows.length) return null
              return (
                <div key={b.key}>
                  <div className="mb-2 flex items-center gap-2">
                    {b.key === 'not_connected' && <AlertTriangle className="h-4 w-4 text-rose-500" />}
                    <h3 className={cn('text-[12px] font-black uppercase tracking-wider', b.tone)}>{b.label}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">{rows.length}</span>
                    <span className="text-[11px] font-semibold text-slate-400">{b.hint}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {rows.map((f) => (
                      <FollowupCard key={f.id} f={f}
                        canCall={canCall}
                        onCall={() => setCalling(f)}
                        onComplete={() => setCompleting(f)}
                        onReschedule={() => setRescheduling(f)}
                        onCancel={async () => { try { await patch(f.id, { action: 'cancel' }, 'Follow-up cancelled') } catch (e) { toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'error' }) } }}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {(data?.rows.length ?? 0) === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 p-12 text-center">
                <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-bold text-slate-500">No follow-ups yet.</p>
                <p className="text-[12px] font-semibold text-slate-400">Schedule one from a call, or add it here.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {calling && <CallDialog f={calling} onClose={() => setCalling(null)} />}
      {adding && <AddFollowupDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void query.refetch() }} />}
      {completing && <CompleteDialog f={completing} onClose={() => setCompleting(null)} onSaved={() => { setCompleting(null); void query.refetch() }} />}
      {rescheduling && <RescheduleDialog f={rescheduling} onClose={() => setRescheduling(null)} onSaved={() => { setRescheduling(null); void query.refetch() }} />}
    </MainLayout>
  )
}

function FollowupCard({ f, canCall, onCall, onComplete, onReschedule, onCancel }: {
  f: Followup; canCall: boolean; onCall: () => void; onComplete: () => void; onReschedule: () => void; onCancel: () => void
}) {
  const done = f.status !== 'pending'
  return (
    <Card className={cn('rounded-2xl border shadow-sm', f.overdue || f.bucket === 'not_connected' ? 'border-rose-200 bg-rose-50/40' : 'border-[var(--kia-hairline)] bg-[var(--kia-surface)]', done && 'opacity-70')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', priorityDot(f.priority))} title={`${f.priority} priority`} />
              <p className="truncate font-black text-[var(--kia-text)]">{f.customerName}</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500"><Lock className="h-2.5 w-2.5" /> No.</span>
            </div>
            <p className="mt-0.5 truncate text-[12px] font-semibold text-slate-500">
              {[f.model, f.variant].filter(Boolean).join(' ') || '—'} · {dealerLabel(f.dealer)}{f.bookingNumber ? ` · ${f.bookingNumber}` : ''}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-indigo-600">{REASON_LABEL[f.reason] || f.reason}</span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold">
          <span className={cn('inline-flex items-center gap-1', f.overdue ? 'text-rose-600' : 'text-slate-500')}><Clock className="h-3 w-3" /> {formatDue(f.dueAt, f.bucket)}</span>
          {f.assignedName && <span className="inline-flex items-center gap-1 text-slate-500"><User2 className="h-3 w-3" /> {f.assignedName}</span>}
          {f.source === 'call' && <span className="inline-flex items-center gap-1 text-slate-400"><PhoneCall className="h-3 w-3" /> from call</span>}
        </div>
        {f.notes && <p className="mt-1.5 line-clamp-2 text-[12px] italic text-slate-500">“{f.notes}”</p>}
        {done && (
          <p className="mt-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-600">
            {f.status === 'cancelled' ? 'Cancelled' : `Done${f.outcome ? ` · ${f.outcome.replace(/_/g, ' ')}` : ''}`}
          </p>
        )}

        {!done && (
          <div className="mt-3 flex items-center gap-2">
            {canCall && (
              <Button onClick={onCall} className="h-8 gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700"><PhoneCall className="h-3.5 w-3.5" /> Call</Button>
            )}
            <Button onClick={onComplete} className="h-8 gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"><Check className="h-3.5 w-3.5" /> Complete</Button>
            <Button onClick={onReschedule} variant="outline" className="h-8 gap-1 rounded-lg px-3 text-xs font-bold"><CalendarClock className="h-3.5 w-3.5" /> Reschedule</Button>
            <button onClick={onCancel} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-500" title="Cancel follow-up"><X className="h-4 w-4" /></button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Shows the customer's mobile number to call.
 *
 * The number arrives WITH the list (server-side, and only for roles that pass
 * canRevealKiaFollowupPhone — everyone else gets null), so opening this costs no request and there
 * is no spinner. The server is the gate: never infer permission from this component.
 */
function CallDialog({ f, onClose }: { f: Followup; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const phone = f.customerPhone
  const error = phone ? null : 'No mobile number is on file for this customer.'

  async function copy() {
    if (!phone) return
    try {
      await navigator.clipboard.writeText(phone)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { toast({ title: 'Could not copy', variant: 'error' }) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PhoneCall className="h-5 w-5 text-indigo-600" /> Call {f.customerName}</DialogTitle>
          <DialogDescription>{[f.model, f.variant].filter(Boolean).join(' ') || '—'}{f.bookingNumber ? ` · ${f.bookingNumber}` : ''}</DialogDescription>
        </DialogHeader>

        <div className="pt-2">
          {!phone ? (
            <p className="rounded-xl bg-rose-50 px-3 py-3 text-center text-[13px] font-semibold text-rose-600">{error}</p>
          ) : (
            <>
              <div className="rounded-2xl bg-gradient-to-b from-indigo-50 to-white px-4 py-5 text-center ring-1 ring-inset ring-indigo-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Mobile</p>
                <p className="mt-1 select-all text-2xl font-black tracking-tight text-slate-900 tabular-nums">{phone}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  href={`tel:${phone}`}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 text-xs font-bold text-white transition-colors hover:bg-indigo-700"
                >
                  <PhoneCall className="h-3.5 w-3.5" /> Call now
                </a>
                <Button variant="outline" className="h-10 gap-1.5 rounded-xl text-xs font-bold" onClick={() => void copy()}>
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CompleteDialog({ f, onClose, onSaved }: { f: Followup; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [notInterestedReason, setNotInterestedReason] = useState('')
  const [scheduleNext, setScheduleNext] = useState(false)
  const [nextAt, setNextAt] = useState(defaultLocal(FOLLOWUP_REPEAT_DAYS))
  const [saving, setSaving] = useState(false)

  const isNotInterested = outcome === 'not_interested'
  // Mirror the server rules so Save disables rather than round-tripping to an error.
  const remarksOk = countWords(notes) > MIN_REMARK_WORDS
  const canSave = Boolean(outcome) && remarksOk && (!isNotInterested || Boolean(notInterestedReason))
  // Reached / Done auto-schedule +7d server-side; say so rather than letting it surprise them.
  const autoRepeats = CONTACTED_OUTCOME_VALUES.has(outcome)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/brands/kia/follow-ups/${f.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          outcome: outcome || undefined,
          notes,
          notInterestedReason: isNotInterested ? notInterestedReason : undefined,
          nextDueAt: scheduleNext && nextAt ? new Date(nextAt).toISOString() : undefined,
        }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      toast({ title: 'Follow-up completed', description: result.next ? 'Next follow-up scheduled.' : undefined, variant: 'success' })
      onSaved()
    } catch (err) { toast({ title: 'Could not save', description: err instanceof Error ? err.message : 'Try again', variant: 'error' }) } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Check className="h-5 w-5 text-emerald-600" /> Complete follow-up · {f.customerName}</DialogTitle>
          <DialogDescription>Record what happened. You can chain the next touch if the lead is still open.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Outcome</label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="Select outcome" /></SelectTrigger>
              <SelectContent>{OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {isNotInterested && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
              <label className="text-[11px] font-black uppercase tracking-wider text-rose-600">Why is the customer not proceeding? *</label>
              <Select value={notInterestedReason} onValueChange={setNotInterestedReason}>
                <SelectTrigger className="mt-1 h-10 rounded-xl bg-white"><SelectValue placeholder="Select their reason" /></SelectTrigger>
                <SelectContent>{NOT_INTERESTED_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] font-semibold text-rose-500">Required. Explain the detail in the remarks below.</p>
            </div>
          )}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Remarks *</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={isNotInterested ? 'What exactly did the customer say about not proceeding?' : 'What did the customer say?'}
              className={cn(
                'mt-1 w-full rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-slate-400',
                notes.length > 0 && !remarksOk ? 'border-rose-300' : 'border-slate-200',
              )}
            />
            <p className={cn('mt-1 text-[11px] font-semibold', notes.length > 0 && !remarksOk ? 'text-rose-500' : 'text-slate-400')}>
              Required — more than {MIN_REMARK_WORDS} words (entered: {countWords(notes)} words). This is the customer&apos;s communication history.
            </p>
          </div>
          {autoRepeats && !scheduleNext && (
            <p className="rounded-xl bg-indigo-50 px-3 py-2 text-[12px] font-semibold text-indigo-700">
              The next follow-up will be scheduled automatically in {FOLLOWUP_REPEAT_DAYS} days.
            </p>
          )}
          <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <input type="checkbox" checked={scheduleNext} onChange={(e) => setScheduleNext(e.target.checked)} className="h-4 w-4 rounded" />
            {autoRepeats ? 'Choose a different date instead' : 'Schedule the next follow-up'}
          </label>
          {scheduleNext && <input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400" />}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-10 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-700" onClick={() => void save()} disabled={saving || !canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RescheduleDialog({ f, onClose, onSaved }: { f: Followup; onClose: () => void; onSaved: () => void }) {
  const [dueAt, setDueAt] = useState(defaultLocal(1))
  const [priority, setPriority] = useState(f.priority)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // A reschedule is a submission — the server requires remarks for it too, so collect them here
  // rather than letting the request fail.
  const remarksOk = countWords(notes) > MIN_REMARK_WORDS

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/brands/kia/follow-ups/${f.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update', dueAt: new Date(dueAt).toISOString(), priority, notes }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed')
      toast({ title: 'Rescheduled', variant: 'success' })
      onSaved()
    } catch (err) { toast({ title: 'Could not reschedule', description: err instanceof Error ? err.message : 'Try again', variant: 'error' }) } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-indigo-600" /> Reschedule · {f.customerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">New date &amp; time</label>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400" />
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Priority</label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Remarks *</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Why are you moving this follow-up?"
              className={cn(
                'mt-1 w-full rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-slate-400',
                notes.length > 0 && !remarksOk ? 'border-rose-300' : 'border-slate-200',
              )}
            />
            <p className={cn('mt-1 text-[11px] font-semibold', notes.length > 0 && !remarksOk ? 'text-rose-500' : 'text-slate-400')}>
              Required — more than {MIN_REMARK_WORDS} words (entered: {countWords(notes)} words).
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-10 gap-2 rounded-xl bg-indigo-600 px-6 font-bold text-white hover:bg-indigo-700" onClick={() => void save()} disabled={saving || !remarksOk}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AddFollowupDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [bookingSearch, setBookingSearch] = useState('')
  const [selected, setSelected] = useState<BookingHit | null>(null)
  const [dueAt, setDueAt] = useState(defaultLocal(1))
  const [reason, setReason] = useState('callback')
  const [priority, setPriority] = useState('normal')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [hits, setHits] = useState<BookingHit[]>([])
  const [searching, setSearching] = useState(false)

  // Remarks are mandatory server-side on create too.
  const remarksOk = countWords(notes) > MIN_REMARK_WORDS

  useEffect(() => {
    if (selected) return
    let active = true
    const t = setTimeout(async () => {
      if (active) setSearching(true)
      try {
        const res = await fetch(`/api/brands/kia/follow-ups/bookings?search=${encodeURIComponent(bookingSearch)}`, { cache: 'no-store' })
        const d = await res.json().catch(() => ({ bookings: [] }))
        if (active) setHits(d.bookings || [])
      } finally { if (active) setSearching(false) }
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [bookingSearch, selected])

  async function save() {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch('/api/brands/kia/follow-ups', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: selected.id, dueAt: new Date(dueAt).toISOString(), reason, priority, notes }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create')
      toast({ title: 'Follow-up scheduled', variant: 'success' })
      onSaved()
    } catch (err) { toast({ title: 'Could not create', description: err instanceof Error ? err.message : 'Try again', variant: 'error' }) } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-indigo-600" /> Add follow-up</DialogTitle>
          <DialogDescription>Pick a customer, set when to follow up. It&apos;s assigned to their sales consultant.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {selected ? (
            <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2">
              <div>
                <p className="font-black text-slate-800">{selected.customerName}</p>
                <p className="text-[12px] font-semibold text-slate-500">{[selected.model, selected.variant].filter(Boolean).join(' ')} · {dealerLabel(selected.dealer)}{selected.bookingNumber ? ` · ${selected.bookingNumber}` : ''}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div>
              <div className="relative flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2">
                <Search className="h-4 w-4 text-slate-400" />
                <input autoFocus value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)} placeholder="Search customer, model or booking #…" className="ml-2 flex-1 border-0 bg-transparent text-sm font-semibold outline-none" />
                {searching && <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
              </div>
              <div className="kia-scroll mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                {hits.map((b) => (
                  <button key={b.id} onClick={() => setSelected(b)} className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-left hover:border-indigo-200 hover:bg-indigo-50/40">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-800">{b.customerName}</p>
                      <p className="truncate text-[12px] font-semibold text-slate-500">{[b.model, b.variant].filter(Boolean).join(' ')} · {dealerLabel(b.dealer)}{b.bookingNumber ? ` · ${b.bookingNumber}` : ''}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500"><Lock className="h-2.5 w-2.5" /> No.</span>
                  </button>
                ))}
                {!hits.length && !searching && <p className="px-1 py-3 text-center text-[12px] font-semibold text-slate-400">No matching bookings.</p>}
              </div>
            </div>
          )}

          {selected && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Reason</label>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Priority</label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Follow up on</label>
                <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400" />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Remarks *</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Why are you scheduling this follow-up?"
                  className={cn(
                    'mt-1 w-full rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-slate-400',
                    notes.length > 0 && !remarksOk ? 'border-rose-300' : 'border-slate-200',
                  )}
                />
                <p className={cn('mt-1 text-[11px] font-semibold', notes.length > 0 && !remarksOk ? 'text-rose-500' : 'text-slate-400')}>
                  Required — more than {MIN_REMARK_WORDS} words (entered: {countWords(notes)} words).
                </p>
              </div>
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-10 gap-2 rounded-xl bg-indigo-600 px-6 font-bold text-white hover:bg-indigo-700 disabled:opacity-50" onClick={() => void save()} disabled={saving || !selected || !remarksOk}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Schedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
