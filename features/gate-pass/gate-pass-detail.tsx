'use client'

import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowRight, Camera, Clock, Gauge, Loader2, MapPin, PenLine, Route,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { formatIndiaDateTime } from '@/lib/date-time'
import { formatDuration, type GatePassMetrics } from '@/lib/gate-pass/metrics'
import { getGatePassStatusInfo } from '@/lib/gate-pass/status'

type Detail = {
  pass: Record<string, unknown>
  metrics: GatePassMetrics
  evidence: {
    outPhotos: Record<string, string>
    inPhotos: Record<string, string>
    outSignature: string | null
    inSignature: string | null
  }
  events: Array<{
    id: string
    action: string
    actorName: string
    actorRole: string | null
    remarks: string | null
    createdAt: string
  }>
}

const ACTION_LABEL: Record<string, string> = {
  created: 'Raised',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  gate_out: 'Left the premises',
  gate_in: 'Returned',
  expired: 'Expired',
}

/**
 * One pass, end to end: what happened, when, how far, and what evidence exists.
 *
 * The timings are the point. A trip duration alone hides the two gaps that actually cost time —
 * how long the requester waited for a decision, and how long the car then sat approved before it
 * moved. On the first real pass through this module those were 2 minutes and 2 hours respectively,
 * and only one of them is a trip.
 */
export function GatePassDetail({
  passId,
  open,
  onOpenChange,
}: {
  passId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['gate-pass-detail', passId],
    queryFn: async () => {
      const res = await fetch(`/api/gate-pass/${passId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load this pass.')
      return res.json() as Promise<Detail>
    },
    enabled: open && Boolean(passId),
  })

  const p = data?.pass as Record<string, string | null> | undefined
  const m = data?.metrics
  const ev = data?.evidence

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {p?.passNo ?? 'Gate pass'}
            {p?.status ? (
              <span className="ml-2 text-sm font-normal text-slate-500">
                {getGatePassStatusInfo(p.status).label}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !data || !m || !p ? (
          <div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-6">
            {/* ── Readings ─────────────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat icon={<Gauge className="h-4 w-4" />} label="Odometer out"
                value={p.gateOutOdo ? `${p.gateOutOdo} km` : '—'} />
              <Stat icon={<Gauge className="h-4 w-4" />} label="Odometer in"
                value={p.gateInOdo ? `${p.gateInOdo} km` : '—'} />
              <Stat icon={<Route className="h-4 w-4" />} label="Distance"
                value={m.distanceKm === null ? '—' : `${m.distanceKm} km`}
                tone={m.odometerWentBackwards ? 'danger' : undefined} />
              <Stat icon={<Clock className="h-4 w-4" />} label="Time out"
                value={formatDuration(m.tripMinutes)} />
            </div>

            {m.odometerWentBackwards ? (
              <Note tone="danger">
                The closing odometer is lower than the opening one. Either a reading was mistyped, or
                this is not the same vehicle. The figures are shown exactly as recorded.
              </Note>
            ) : null}

            {/* ── Delay ────────────────────────────────────────────────────────────────── */}
            {m.lateMinutes !== null ? (
              <Note tone={m.lateMinutes > 0 ? 'warn' : 'ok'}>
                {m.lateMinutes > 0 ? (
                  <>
                    <strong>{formatDuration(m.lateMinutes)} late.</strong>{' '}
                    {m.lateBasis === 'still_out'
                      ? 'Still out — measured against now, and growing.'
                      : `Due back ${formatIndiaDateTime(p.expectedReturnAt)}, returned ${formatIndiaDateTime(p.gateInAt)}.`}
                  </>
                ) : (
                  <>Returned on time — {formatDuration(Math.abs(m.lateMinutes))} to spare.</>
                )}
              </Note>
            ) : null}

            {/* ── Timeline, with the gap between each step ─────────────────────────────── */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">What happened, and when</h3>
              <ol className="space-y-0">
                {data.events.map((e, i) => {
                  const prev = i > 0 ? data.events[data.events.length - i] : null
                  return (
                    <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                      <div className="flex flex-col items-center">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                        {i < data.events.length - 1 ? <span className="w-px flex-1 bg-slate-200" /> : null}
                      </div>
                      <div className="flex-1 pb-1">
                        <p className="text-sm font-medium text-slate-900">
                          {ACTION_LABEL[e.action] ?? e.action}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatIndiaDateTime(e.createdAt)} · {e.actorName}
                          {/* A guard has no account by design — say so rather than leaving a blank
                              that reads like missing data. */}
                          {e.actorRole ? ` (${e.actorRole})` : ' (guard, no login)'}
                        </p>
                        {e.remarks ? <p className="mt-0.5 text-xs text-slate-600">{e.remarks}</p> : null}
                      </div>
                      {prev ? null : null}
                    </li>
                  )
                })}
              </ol>

              <div className="mt-2 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3">
                <Gap label="Waited for approval" value={formatDuration(m.approvalMinutes)} />
                <Gap label="Approved → left the gate" value={formatDuration(m.dispatchMinutes)}
                  hint="How long the car sat approved before it actually moved" />
                <Gap label="Out of the premises" value={formatDuration(m.tripMinutes)} />
              </div>
            </section>

            {/* ── Return details ───────────────────────────────────────────────────────── */}
            {p.gateInAt ? (
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Stat icon={<MapPin className="h-4 w-4" />} label="Parked at" value={p.parkedLocation || '—'} />
                <Stat icon={<PenLine className="h-4 w-4" />} label="Keys handed to" value={p.keyHandoverTo || '—'} />
              </section>
            ) : null}

            {/* ── Evidence ─────────────────────────────────────────────────────────────── */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Evidence at the gate</h3>
                <span className={`text-xs font-medium ${m.evidence.complete ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {m.evidence.expected === 0
                    ? 'Nothing captured yet'
                    : `${m.evidence.captured} of ${m.evidence.expected} captured`}
                </span>
              </div>

              {m.evidence.expected > 0 && !m.evidence.complete ? (
                <Note tone="warn">
                  {[
                    !m.evidence.outSignature && p.gateOutAt ? 'no signature on the way out' : null,
                    !m.evidence.inSignature && p.gateInAt ? 'no signature on the way back' : null,
                    !m.evidence.outVehiclePhoto && p.gateOutAt ? 'no vehicle photo out' : null,
                    !m.evidence.outOdometerPhoto && p.gateOutAt ? 'no odometer photo out' : null,
                    !m.evidence.inVehiclePhoto && p.gateInAt ? 'no vehicle photo in' : null,
                    !m.evidence.inOdometerPhoto && p.gateInAt ? 'no odometer photo in' : null,
                  ].filter(Boolean).join(' · ')}
                </Note>
              ) : null}

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Evidence label="Vehicle — out" url={ev?.outPhotos?.vehicle_front} />
                <Evidence label="Odometer — out" url={ev?.outPhotos?.odometer} />
                <Evidence label="Vehicle — in" url={ev?.inPhotos?.vehicle_front} />
                <Evidence label="Odometer — in" url={ev?.inPhotos?.odometer} />
                <Evidence label="Signature — out" url={ev?.outSignature ?? undefined} />
                <Evidence label="Signature — in" url={ev?.inSignature ?? undefined} />
                <Evidence label="Customer licence" url={ev?.outPhotos?.['customer-licence']} />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Images are held privately and opened through links that expire after five minutes.
              </p>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string; tone?: 'danger'
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</div>
      <p className={`mt-1 text-lg font-semibold ${tone === 'danger' ? 'text-rose-700' : 'text-slate-900'}`}>
        {value}
      </p>
    </div>
  )
}

function Gap({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <ArrowRight className="h-3 w-3" />{label}
      </div>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] leading-tight text-slate-400">{hint}</p> : null}
    </div>
  )
}

/* Inline styles, not Tailwind colour classes — globals.css retints these with !important. */
const NOTE_STYLE = {
  ok: { bg: '#ecfdf5', fg: '#065f46', border: '#a7f3d0' },
  warn: { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' },
  danger: { bg: '#fff1f2', fg: '#9f1239', border: '#fecdd3' },
} as const

function Note({ tone, children }: { tone: keyof typeof NOTE_STYLE; children: React.ReactNode }) {
  const s = NOTE_STYLE[tone]
  return (
    <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
      style={{ backgroundColor: s.bg, color: s.fg, borderColor: s.border }}>
      {tone !== 'ok' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : null}
      <span>{children}</span>
    </p>
  )
}

function Evidence({ label, url }: { label: string; url?: string }) {
  if (!url) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center">
        <Camera className="mx-auto h-4 w-4 text-slate-300" />
        <p className="mt-1 text-[11px] leading-tight text-slate-400">{label}</p>
        <p className="text-[11px] font-medium text-slate-400">Not captured</p>
      </div>
    )
  }
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="group block overflow-hidden rounded-lg border border-slate-200 transition hover:border-indigo-300">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="h-24 w-full bg-slate-50 object-cover" />
      <p className="px-2 py-1.5 text-[11px] font-medium text-slate-600 group-hover:text-indigo-700">{label}</p>
    </a>
  )
}
