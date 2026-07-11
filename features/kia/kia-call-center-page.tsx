'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Phone, PhoneOutgoing, Lock, Loader2, Search, History, Save, X, ShieldCheck, PhoneCall, CheckCircle2, XCircle, Radio, Settings2 } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type Callback = { id: string; bookingId: string; customerName: string; preferredTime: string | null; note: string | null; createdAt: string; model: string | null; variant: string | null; dealer: string | null; bookingNumber: string | null }
type Booking = { id: string; customerName: string; model: string; variant: string; color: string | null; dealer: string | null; status: string; bookingNumber: string | null; createdAt: string }
type CallHistory = { id: string; bookingId: string | null; status: string; disposition: string | null; durationSec: number; provider: string; startedAt: string; customerName: string | null; model: string | null }
type TelephonyStatus = {
  requestedProvider: string
  activeProvider: string
  live: boolean
  exotel: { hasSid: boolean; hasApiKey: boolean; hasApiToken: boolean; hasCallerId: boolean; subdomain: string }
  webhook: { publicBaseUrl: string | null; reachable: boolean; secretSet: boolean }
}
type Queue = { callbacks: Callback[]; bookings: Booking[]; history: CallHistory[]; agentPhoneSet: boolean; provider: string; telephonyStatus: TelephonyStatus | null }

const DEALER_LABELS: Record<string, string> = { JK402: 'Jammu', JK501: 'Udhampur' }
const DISPOSITIONS = [
  { value: 'interested', label: 'Interested' },
  { value: 'callback_later', label: 'Call back later' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'done', label: 'Done / resolved' },
]
function dealerLabel(code: string | null) { return code ? (DEALER_LABELS[code] || code) : '—' }
// Default a follow-up to tomorrow 10:00, formatted for a <input type="datetime-local"> (local time).
function defaultFollowUpLocal() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function timeAgo(iso: string) { const d = new Date(iso); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }

// The core promise, shown everywhere a customer appears: the number is never revealed.
function HiddenNumber() {
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-500"><Lock className="h-3 w-3" /> Number hidden</span>
}

export function KiaCallCenterPage() {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'callbacks' | 'bookings'>('callbacks')
  const [phoneInput, setPhoneInput] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [placingId, setPlacingId] = useState<string | null>(null)
  const [activeCall, setActiveCall] = useState<{ callId: string; name: string; callbackId: string | null } | null>(null)

  const query = useQuery<Queue>({
    queryKey: ['kia-call-center', search],
    queryFn: async () => {
      const res = await fetch(`/api/brands/kia/call-center?search=${encodeURIComponent(search)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })
  const data = query.data

  async function saveAgentPhone() {
    setSavingPhone(true)
    try {
      const res = await fetch('/api/brands/kia/call-center/agent-phone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: phoneInput }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save')
      toast({ title: 'Number saved', description: 'The system will ring this number to connect you.', variant: 'success' })
      void query.refetch()
    } catch (err) { toast({ title: 'Could not save', description: err instanceof Error ? err.message : 'Try again', variant: 'error' }) } finally { setSavingPhone(false) }
  }

  async function placeCall(target: { bookingId?: string; callbackRequestId?: string; name: string; callbackId: string | null; rowId: string }) {
    setPlacingId(target.rowId)
    try {
      const res = await fetch('/api/brands/kia/call-center/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bookingId: target.bookingId, callbackRequestId: target.callbackRequestId }) })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error || 'Could not place the call')
      toast({ title: `Calling ${target.name}…`, description: 'Your phone will ring first, then the customer — over a masked line.', variant: 'success' })
      setActiveCall({ callId: result.callId, name: target.name, callbackId: target.callbackId })
    } catch (err) { toast({ title: 'Call failed', description: err instanceof Error ? err.message : 'Try again', variant: 'error' }) } finally { setPlacingId(null) }
  }

  const CallButton = ({ target, disabled }: { target: Parameters<typeof placeCall>[0]; disabled?: boolean }) => (
    <Button
      onClick={() => void placeCall(target)}
      disabled={disabled || !data?.agentPhoneSet || placingId === target.rowId}
      className="h-9 gap-1.5 rounded-xl bg-emerald-600 px-4 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
    >
      {placingId === target.rowId ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOutgoing className="h-4 w-4" />} Call
    </Button>
  )

  return (
    <MainLayout title="Call Center" subtitle="Masked click-to-call — customer numbers are never shown">
      <div className="space-y-6">
        {/* Assurance banner */}
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
          <p className="text-[13px] font-semibold text-emerald-800">Calls go through a masked line — you never see the customer&apos;s mobile number, before, during or after the call.
            <span className="ml-2 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-emerald-700">via {data?.provider || '—'}</span></p>
        </div>

        {/* Telephony readiness — admins only (server sends telephonyStatus only to them) */}
        {data?.telephonyStatus ? <TelephonyReadiness status={data.telephonyStatus} /> : null}

        {/* Agent phone setup */}
        {data && !data.agentPhoneSet ? (
          <Card className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
            <CardContent className="flex flex-wrap items-end gap-3 p-5">
              <div className="flex-1 min-w-[220px]">
                <p className="text-[13px] font-black text-amber-800">Set your call-back number to start</p>
                <p className="mt-1 text-[12px] font-semibold text-amber-700">The system rings this number first, then connects you to the customer. Only you see this — never the customer.</p>
                <Input value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder="Your phone e.g. 9876543210" inputMode="tel" className="mt-2 h-10 max-w-xs rounded-xl" />
              </div>
              <Button onClick={() => void saveAgentPhone()} disabled={savingPhone} className="h-10 gap-2 rounded-xl bg-amber-600 px-5 font-bold text-white hover:bg-amber-700">
                {savingPhone ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save number
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {/* Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {(['callbacks', 'bookings'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn('rounded-lg px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors', tab === t ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900')}>
                {t === 'callbacks' ? `Callback Requests${data ? ` (${data.callbacks.length})` : ''}` : 'All Bookings'}
              </button>
            ))}
          </div>
          {tab === 'bookings' && (
            <div className="relative flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, model or booking #…" className="ml-2 w-56 border-0 bg-transparent text-xs font-semibold outline-none" />
            </div>
          )}
        </div>

        {query.isLoading ? (
          <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(query.error as Error)?.message || 'Failed to load.'}</div>
        ) : data ? (
          <Card className="overflow-hidden rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
            <div className="divide-y divide-[var(--kia-hairline)]">
              {tab === 'callbacks' ? (
                data.callbacks.length === 0 ? (
                  <div className="p-10 text-center text-sm font-semibold text-slate-400">No pending callback requests.</div>
                ) : data.callbacks.map((cb) => (
                  <div key={cb.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-[var(--kia-text)]">{cb.customerName}</p>
                        <HiddenNumber />
                      </div>
                      <p className="mt-0.5 text-[12px] font-semibold text-slate-500">
                        {[cb.model, cb.variant].filter(Boolean).join(' ') || '—'} · {dealerLabel(cb.dealer)}{cb.preferredTime ? ` · prefers ${cb.preferredTime}` : ''}
                      </p>
                      {cb.note && <p className="mt-0.5 text-[12px] italic text-slate-500">“{cb.note}”</p>}
                    </div>
                    <CallButton target={{ callbackRequestId: cb.id, bookingId: cb.bookingId, name: cb.customerName, callbackId: cb.id, rowId: cb.id }} />
                  </div>
                ))
              ) : (
                data.bookings.length === 0 ? (
                  <div className="p-10 text-center text-sm font-semibold text-slate-400">No bookings match.</div>
                ) : data.bookings.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-[var(--kia-text)]">{b.customerName}</p>
                        <HiddenNumber />
                      </div>
                      <p className="mt-0.5 text-[12px] font-semibold text-slate-500">
                        {[b.model, b.variant, b.color].filter(Boolean).join(' ') || '—'} · {dealerLabel(b.dealer)}{b.bookingNumber ? ` · ${b.bookingNumber}` : ''} · {String(b.status).replace(/_/g, ' ')}
                      </p>
                    </div>
                    <CallButton target={{ bookingId: b.id, name: b.customerName, callbackId: null, rowId: b.id }} />
                  </div>
                ))
              )}
            </div>
          </Card>
        ) : null}

        {/* Call history */}
        {data && data.history.length > 0 && (
          <Card className="overflow-hidden rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
            <div className="flex items-center gap-2 border-b border-[var(--kia-hairline)] px-5 py-3">
              <History className="h-4 w-4 text-slate-400" />
              <p className="text-[12px] font-black uppercase tracking-wider text-slate-500">Recent Calls</p>
            </div>
            <div className="divide-y divide-[var(--kia-hairline)]">
              {data.history.map((h) => (
                <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-[13px]">
                  <div className="flex items-center gap-2">
                    <PhoneCall className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-bold text-[var(--kia-text)]">{h.customerName || 'Customer'}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500">{h.model || '—'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {h.disposition && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold capitalize text-slate-600">{h.disposition.replace(/_/g, ' ')}</span>}
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{h.status}</span>
                    <span className="text-[11px] font-semibold text-slate-400">{timeAgo(h.startedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {activeCall && (
        <DispositionDialog
          call={activeCall}
          onClose={() => setActiveCall(null)}
          onSaved={() => { setActiveCall(null); void query.refetch() }}
        />
      )}
    </MainLayout>
  )
}

// Admin-only setup panel: shows whether real calling is live and, if not, exactly what env config is
// still missing. Booleans only — no secrets ever reach the client.
function TelephonyReadiness({ status }: { status: TelephonyStatus }) {
  const [open, setOpen] = useState(!status.live)
  const wantsExotel = status.requestedProvider === 'exotel'
  const checks = [
    { label: 'EXOTEL_SID (Account SID)', ok: status.exotel.hasSid },
    { label: 'EXOTEL_API_KEY', ok: status.exotel.hasApiKey },
    { label: 'EXOTEL_API_TOKEN', ok: status.exotel.hasApiToken },
    { label: 'EXOTEL_CALLER_ID (Exophone / virtual number)', ok: status.exotel.hasCallerId },
    { label: 'TELEPHONY_PROVIDER = exotel', ok: wantsExotel },
    { label: 'Public webhook reachable (not localhost)', ok: status.webhook.reachable },
    { label: 'TELEPHONY_WEBHOOK_SECRET (recommended)', ok: status.webhook.secretSet, optional: true },
  ]
  const blocking = checks.filter((c) => !c.optional)
  const done = blocking.filter((c) => c.ok).length

  return (
    <Card className={cn('rounded-2xl border shadow-sm', status.live ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50')}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left">
        <span className={cn('inline-flex h-9 w-9 items-center justify-center rounded-xl', status.live ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600')}>
          {status.live ? <Radio className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-black text-slate-800">
            {status.live ? `Live calling active — via ${status.activeProvider}` : 'Simulation mode — real calls not connected yet'}
          </p>
          <p className="mt-0.5 text-[12px] font-semibold text-slate-500">
            {status.live ? 'Calls place real PSTN calls through your provider.' : `Provider setup ${done}/${blocking.length} complete. Click to see what's left.`}
          </p>
        </div>
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">{open ? 'Hide' : 'Setup'}</span>
      </button>
      {open && (
        <CardContent className="border-t border-slate-200 pt-4">
          <p className="mb-3 text-[12px] font-semibold text-slate-600">
            Set these in <code className="rounded bg-slate-200 px-1 py-0.5 text-[11px] font-bold">.env.local</code> (then restart the server). Values come from your Exotel dashboard → API Settings, and the Exophone you provision.
          </p>
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[12px] font-semibold">
                {c.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className={cn('h-4 w-4 shrink-0', c.optional ? 'text-amber-500' : 'text-rose-500')} />}
                <span className={c.ok ? 'text-slate-700' : 'text-slate-500'}>{c.label}{c.optional && !c.ok ? ' — optional' : ''}</span>
              </li>
            ))}
          </ul>
          {!status.webhook.reachable && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
              Set <code className="font-bold">TELEPHONY_PUBLIC_BASE_URL</code> to your public https domain so Exotel can post call status back. Current base: {status.webhook.publicBaseUrl || 'not set'}.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function DispositionDialog({ call, onClose, onSaved }: { call: { callId: string; name: string; callbackId: string | null }; onClose: () => void; onSaved: () => void }) {
  const [disposition, setDisposition] = useState('')
  const [notes, setNotes] = useState('')
  const [markContacted, setMarkContacted] = useState(Boolean(call.callbackId))
  const [followUpAt, setFollowUpAt] = useState(defaultFollowUpLocal())
  const [saving, setSaving] = useState(false)
  const wantsFollowUp = disposition === 'callback_later'

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/brands/kia/call-center/disposition', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callId: call.callId,
          disposition: disposition || undefined,
          notes,
          markCallbackContacted: markContacted && Boolean(call.callbackId),
          followUpAt: wantsFollowUp && followUpAt ? new Date(followUpAt).toISOString() : undefined,
        }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      toast({ title: 'Call logged', description: result.followupId ? 'Outcome saved + follow-up scheduled.' : 'Outcome saved.', variant: 'success' })
      onSaved()
    } catch (err) { toast({ title: 'Could not save', description: err instanceof Error ? err.message : 'Try again', variant: 'error' }) } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Phone className="h-5 w-5 text-emerald-600" /> Log the call · {call.name}</DialogTitle>
          <DialogDescription>Your phone was connected to the customer over a masked line. Record what happened.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Outcome</label>
            <Select value={disposition} onValueChange={setDisposition}>
              <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="Select outcome" /></SelectTrigger>
              <SelectContent>{DISPOSITIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {wantsFollowUp && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
              <label className="text-[11px] font-black uppercase tracking-wider text-indigo-600">Schedule follow-up</label>
              <p className="mt-0.5 text-[11px] font-semibold text-indigo-500">Adds a reminder for the consultant so this lead isn&apos;t forgotten.</p>
              <input type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400" />
            </div>
          )}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What did the customer say?" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium outline-none focus:border-slate-400" />
          </div>
          {call.callbackId && (
            <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
              <input type="checkbox" checked={markContacted} onChange={(e) => setMarkContacted(e.target.checked)} className="h-4 w-4 rounded" />
              Mark this callback request as contacted
            </label>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={onClose} disabled={saving}><X className="mr-1 h-4 w-4" /> Skip</Button>
          <Button className="h-10 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-700" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
