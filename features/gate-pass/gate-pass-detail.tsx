'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Camera,
  Car,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Gauge,
  Key,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Route,
  ShieldCheck,
  User,
  X,
  Satellite,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatIndiaDate, formatIndiaDateTime } from '@/lib/date-time'
import { formatDuration, type GatePassMetrics } from '@/lib/gate-pass/metrics'
import { getGatePassStatusInfo } from '@/lib/gate-pass/status'
import { groupAlerts } from '@/lib/loconav/timeline'

const STATUS_TONE_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
  danger: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
  active: 'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
  muted: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700',
}

type Trip = {
  status: 'reconciled' | 'untracked' | 'unavailable' | 'failed'
  detail: string | null
  providerDistanceKm: number | null
  odometerDistanceKm: number | null
  deltaKm: number | null
  discrepancy: boolean
  maxSegmentAverageSpeedKph: number | null
  movingSeconds: number | null
  stoppedSeconds: number | null
  stopCount: number | null
  alertCount: number
  alerts: Array<{ label: string | null; eventType?: string | null; eventTimeMs: number | null; address: string | null; value: number | null; unit: string | null }>
  /** Set when the tracker that measured this drive was linked to the car only after it — see getTripForPass. */
  linkedAfterDrive: { linkedAt: string } | null
}

type Detail = {
  pass: Record<string, unknown>
  metrics: GatePassMetrics
  /*
   * ⚠️ null is NOT "no discrepancy". It means there is no reconciliation row at all — the sweep has
   * not run, the integration is off, or 0058 is unapplied. Rendering nothing for it would read as
   * "checked, all fine", which is the opposite of the truth.
   */
  trip: Trip | null
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

const ACTION_MAP: Record<string, { label: string; icon: typeof FileText; color: string; bg: string; border: string }> = {
  created: {
    label: 'Raised',
    icon: FileText,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/60',
    border: 'border-blue-200 dark:border-blue-800',
  },
  approved: {
    label: 'Approved',
    icon: ShieldCheck,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/60',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
  rejected: {
    label: 'Rejected',
    icon: X,
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-950/60',
    border: 'border-rose-200 dark:border-rose-800',
  },
  gate_out: {
    label: 'Gate Out',
    icon: LogOut,
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-950/60',
    border: 'border-indigo-200 dark:border-indigo-800',
  },
  gate_in: {
    label: 'Gate In',
    icon: LogIn,
    color: 'text-teal-600 dark:text-teal-400',
    bg: 'bg-teal-50 dark:bg-teal-950/60',
    border: 'border-teal-200 dark:border-teal-800',
  },
  cancelled: {
    label: 'Cancelled',
    icon: AlertTriangle,
    color: 'text-slate-600 dark:text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-900',
    border: 'border-slate-200 dark:border-slate-800',
  },
  expired: {
    label: 'Expired',
    icon: Clock,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/60',
    border: 'border-amber-200 dark:border-amber-800',
  },
}

export function GatePassDetail({
  passId,
  open,
  onOpenChange,
  onCancelPass,
}: {
  passId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancelPass?: (pass: {
    id: string
    passNo: string
    registrationNumber: string | null
    model: string | null
    driverName: string
    purpose: string
    status: string
  }) => void
}) {
  const [lightboxImage, setLightboxImage] = useState<{ label: string; url: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['gate-pass-detail', passId],
    queryFn: async () => {
      const res = await fetch(`/api/gate-pass/${passId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load this pass.')
      return res.json() as Promise<Detail>
    },
    enabled: Boolean(passId),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })

  const p = data?.pass as Record<string, string | null> | undefined
  const m = data?.metrics
  const ev = data?.evidence
  const statusInfo = p?.status ? getGatePassStatusInfo(p.status) : null
  /*
   * ⚠️ Grouped by type, never a bare count. Every alert on the first real drives was a Geofence event — the
   * car leaving and re-entering the showroom fence — and "5 alerts" on its own reads as bad driving.
   * Empty for non-approvers: the route redacts the alert list together with the route.
   */
  const alertSummary = groupAlerts(
    (data?.trip?.alerts ?? []).map((a) => ({ label: a.label, eventType: a.eventType ?? null })),
  )
    .map((g) => `${g.label} ×${g.count}`)
    .join(' · ')
  /*
   * ⚠️ The trip's own note — an expired subscription, a route or alert list that could not be fetched, a mistyped
   * odometer — must not pass for a quiet drive, so the alert summary never stands in for it. An untracked pass's
   * stored note predates linking trackers on the Trackers screen; its tile already says what it needs to.
   */
  const tripNote = data?.trip && data.trip.status !== 'untracked' ? data.trip.detail : null
  /*
   * ⚠️ Checked with a tracker linked to this car only after the drive. Trackers are moved off sold cars onto others, so
   * the unit may have been on a different car that day: a gap between GPS and odometer is a question about the link
   * first, and must never read as a proven mismatch.
   */
  const linkedAfter = data?.trip?.linkedAfterDrive ?? null
  const linkNote = linkedAfter
    ? `Checked with a tracker linked on ${formatIndiaDate(linkedAfter.linkedAt)}, after this drive.` +
      (data?.trip?.discrepancy
        ? ' The gap between GPS and odometer may be because the tracker was not on this car at the time.'
        : '')
    : null

  // Extract events by stage for row-wise display
  const createdEvt = data?.events.find((e) => e.action === 'created')
  const approvedEvt = data?.events.find((e) => e.action === 'approved' || e.action === 'rejected')
  const gateOutEvt = data?.events.find((e) => e.action === 'gate_out')
  const gateInEvt = data?.events.find((e) => e.action === 'gate_in')

  const stages = [
    {
      step: 1,
      name: 'Request Raised',
      icon: FileText,
      active: Boolean(createdEvt),
      actor: p?.requestedByName || createdEvt?.actorName || 'Staff',
      role: 'Requester',
      time: createdEvt?.createdAt || p?.createdAt,
      remarks: p?.remarks,
      color: 'blue',
    },
    {
      step: 2,
      name: p?.status === 'rejected' ? 'Rejected' : 'Approval',
      icon: p?.status === 'rejected' ? X : ShieldCheck,
      active: Boolean(approvedEvt) || p?.status === 'approved' || p?.status === 'out' || p?.status === 'returned',
      actor: p?.approvedByName || approvedEvt?.actorName || (p?.status === 'pending_approval' ? 'Pending Approval' : '—'),
      role: approvedEvt?.actorRole || 'Approver',
      time: approvedEvt?.createdAt || p?.approvedAt,
      remarks: p?.approvalRemarks,
      color: p?.status === 'rejected' ? 'rose' : 'emerald',
    },
    {
      step: 3,
      name: 'Gate Out',
      icon: LogOut,
      active: Boolean(gateOutEvt) || p?.status === 'out' || p?.status === 'returned',
      actor: p?.gateOutGuardName || gateOutEvt?.actorName || (p?.status === 'approved' ? 'Awaiting Checkout' : '—'),
      role: 'Inspector',
      time: p?.gateOutAt || gateOutEvt?.createdAt,
      extra: p?.gateOutOdo ? `${p.gateOutOdo} km` : null,
      color: 'indigo',
    },
    {
      step: 4,
      name: 'Gate In (Return)',
      icon: LogIn,
      active: Boolean(gateInEvt) || p?.status === 'returned',
      actor: p?.gateInGuardName || gateInEvt?.actorName || (p?.status === 'out' ? 'On The Road' : '—'),
      role: 'Inspector',
      time: p?.gateInAt || gateInEvt?.createdAt,
      extra: p?.gateInOdo ? `${p.gateInOdo} km` : null,
      color: 'teal',
    },
  ]

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto no-scrollbar scrollbar-none sm:max-w-3xl lg:max-w-4xl p-0 gap-0 rounded-2xl bg-slate-50 border border-slate-200 shadow-2xl">
          {/* ── Top Header Banner ── */}
          <div className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20 rounded-t-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <DialogTitle className="text-xl font-black tracking-tight text-slate-900 font-mono">
                    {p?.passNo ?? 'Gate Pass'}
                  </DialogTitle>
                  {statusInfo && (
                    <span
                      className={cn(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border',
                        STATUS_TONE_STYLES[statusInfo.tone] ?? STATUS_TONE_STYLES.muted
                      )}
                    >
                      {statusInfo.label}
                    </span>
                  )}
                  {p?.dealerCode && (
                    <Badge variant="outline" className="text-[11px] font-semibold text-slate-600 bg-slate-100 border-slate-200">
                      Branch: {p.dealerCode}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                  <span className="font-semibold text-slate-800 flex items-center gap-1">
                    <Car className="h-3.5 w-3.5 text-indigo-600" />
                    {p?.model || 'DEMO CAR'} {p?.registrationNumber ? `(${p.registrationNumber})` : ''}
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    Driver: <strong className="text-slate-700">{p?.driverName || 'Staff'}</strong>
                  </span>
                  {p?.purpose && (
                    <>
                      <span className="text-slate-300">•</span>
                      <span className="bg-slate-100 text-slate-700 font-medium px-2 py-0.5 rounded text-[11px]">
                        {p.purpose}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {onCancelPass && p && (p.status === 'pending_approval' || p.status === 'approved') ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onCancelPass({
                      id: p.id as string,
                      passNo: (p.passNo as string) || 'Gate Pass',
                      registrationNumber: p.registrationNumber,
                      model: p.model,
                      driverName: p.driverName || 'Staff',
                      purpose: p.purpose || 'Official',
                      status: p.status as string,
                    })
                  }
                  className="h-8 px-3 rounded-xl text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-200 dark:border-rose-900 cursor-pointer gap-1.5 shrink-0"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Cancel Pass
                </Button>
              ) : null}
            </div>
          </div>

          {isLoading || !data || !m || !p ? (
            <div className="py-24 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
              <p className="mt-2 text-xs font-medium text-slate-500">Loading trip summary…</p>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* ── 1. KPI Metric Summary Cards ── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard
                  label="Odometer Out"
                  value={p.gateOutOdo ? `${p.gateOutOdo} km` : '—'}
                  icon={<Gauge className="h-4 w-4 text-indigo-600" />}
                  bg="bg-indigo-50/80 dark:bg-indigo-950/20"
                  border="border-indigo-200 dark:border-indigo-900/50"
                  textColor="text-indigo-950 dark:text-indigo-200"
                />
                <MetricCard
                  label="Odometer In"
                  value={p.gateInOdo ? `${p.gateInOdo} km` : '—'}
                  icon={<Gauge className="h-4 w-4 text-emerald-600" />}
                  bg="bg-emerald-50/80 dark:bg-emerald-950/20"
                  border="border-emerald-200 dark:border-emerald-900/50"
                  textColor="text-emerald-950 dark:text-emerald-200"
                />
                <MetricCard
                  label="Distance Covered"
                  value={m.distanceKm === null ? '—' : `${m.distanceKm} km`}
                  icon={<Route className="h-4 w-4 text-purple-600" />}
                  bg="bg-purple-50/80 dark:bg-purple-950/20"
                  border="border-purple-200 dark:border-purple-900/50"
                  textColor="text-purple-950 dark:text-purple-200"
                  alert={m.odometerWentBackwards}
                />
                <MetricCard
                  label="GPS Distance"
                  value={
                    !data?.trip ? 'Not checked'
                    : data.trip.status === 'untracked' ? 'No tracker'
                    : data.trip.status === 'unavailable' ? 'No GPS data'
                    : data.trip.status === 'failed' ? 'Check failed'
                    : data.trip.providerDistanceKm === null ? '—'
                    : `${data.trip.providerDistanceKm} km`
                  }
                  icon={<Satellite className="h-4 w-4 text-teal-600" />}
                  bg="bg-teal-50/80 dark:bg-teal-950/20"
                  border="border-teal-200 dark:border-teal-900/50"
                  textColor="text-teal-950 dark:text-teal-200"
                  /* Flagged only when BOTH thresholds trip — see isTripDiscrepancy. A prompt to look,
                     never an accusation: GPS and a typed odometer disagree for honest reasons. */
                  alert={Boolean(data?.trip?.discrepancy)}
                  /* The alert groups only. The trip's own note has a full-width line under the tiles: sharing this
                     clamped line, it was hidden whenever the drive had an alert, and cut to a few words on a phone. */
                  sub={data?.trip?.status === 'untracked' ? 'No tracker linked' : alertSummary || undefined}
                />
                <MetricCard
                  label="Trip Duration"
                  value={formatDuration(m.tripMinutes)}
                  icon={<Clock className="h-4 w-4 text-sky-600" />}
                  bg="bg-sky-50/80 dark:bg-sky-950/20"
                  border="border-sky-200 dark:border-sky-900/50"
                  textColor="text-sky-950 dark:text-sky-200"
                />
                {linkNote ? (
                  <p className="col-span-2 break-words text-[11px] font-medium text-slate-500 sm:col-span-4">
                    {linkNote}
                  </p>
                ) : null}
                {tripNote ? (
                  <p className="col-span-2 break-words text-[11px] font-medium text-slate-500 sm:col-span-4">
                    GPS check: {tripNote}
                  </p>
                ) : null}
              </div>

              {/* ── 2. Trip Status Banner ── */}
              {p.gateInAt ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 flex items-center justify-between text-xs text-emerald-900 shadow-xs">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold text-sm">Trip Completed &amp; Closed</p>
                      <p className="text-[11px] opacity-80 mt-0.5">
                        {p.gateOutAt ? `Departed ${formatIndiaDateTime(p.gateOutAt)} · ` : ''}
                        Returned on {formatIndiaDateTime(p.gateInAt)}
                      </p>
                    </div>
                  </div>
                  <span className="hidden sm:inline-block px-2.5 py-1 rounded-md font-bold text-[11px] bg-white border border-slate-200 text-emerald-800">
                    Closed Trip
                  </span>
                </div>
              ) : p.gateOutAt ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3.5 flex items-center justify-between text-xs text-sky-900 shadow-xs">
                  <div className="flex items-center gap-2.5">
                    <Clock className="h-5 w-5 text-sky-600 shrink-0" />
                    <div>
                      <p className="font-bold text-sm">Vehicle Out on Road</p>
                      <p className="text-[11px] opacity-80 mt-0.5">
                        Departed at {formatIndiaDateTime(p.gateOutAt)}
                      </p>
                    </div>
                  </div>
                  <span className="hidden sm:inline-block px-2.5 py-1 rounded-md font-bold text-[11px] bg-white border border-slate-200 text-sky-800">
                    Active Trip
                  </span>
                </div>
              ) : null}

              {/* ── 3. Row-Wise Horizontal Timeline (Approvals Style) ── */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-indigo-600" />
                    Approval & Gate Lifecycle Timeline
                  </h3>
                  <span className="text-[11px] font-semibold text-slate-400">Step 1 to 4</span>
                </div>

                {/* Horizontal scrollable track on mobile, clean 4-col row on desktop */}
                <div className="overflow-x-auto pb-1 pt-1 -mx-1 px-1 no-scrollbar scrollbar-none">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 min-w-[620px] sm:min-w-0">
                    {stages.map((st, i) => {
                      const Icon = st.icon
                      return (
                        <div
                          key={st.step}
                          className={`relative rounded-xl border p-3.5 flex flex-col justify-between transition-all ${
                            st.active
                              ? 'bg-slate-50/80 border-slate-200 shadow-xs'
                              : 'bg-slate-50/30 border-slate-100 opacity-60'
                          }`}
                        >
                          <div className="space-y-2">
                            {/* Step Header */}
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Stage {st.step}
                              </span>
                              <div
                                className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  st.active
                                    ? st.color === 'emerald'
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : st.color === 'rose'
                                      ? 'bg-rose-100 text-rose-700'
                                      : st.color === 'indigo'
                                      ? 'bg-indigo-100 text-indigo-700'
                                      : st.color === 'teal'
                                      ? 'bg-teal-100 text-teal-700'
                                      : 'bg-blue-100 text-blue-700'
                                    : 'bg-slate-200 text-slate-500'
                                }`}
                              >
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                            </div>

                            {/* Title & Actor */}
                            <div>
                              <p className="font-bold text-slate-900 text-sm">{st.name}</p>
                              <p className="text-xs font-medium text-slate-700 mt-0.5 truncate" title={st.actor}>
                                {st.actor}
                              </p>
                              <p className="text-[10px] text-slate-400 capitalize">{st.role}</p>
                            </div>
                          </div>

                          {/* Timestamp & Extra Info Footer */}
                          <div className="pt-3 mt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px]">
                            <span className="text-slate-500 font-medium font-mono">
                              {st.time ? formatIndiaDateTime(st.time) : 'Pending'}
                            </span>
                            {st.extra && (
                              <span className="font-bold font-mono text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                                {st.extra}
                              </span>
                            )}
                          </div>

                          {st.remarks && (
                            <p className="mt-2 text-[10px] italic text-slate-500 bg-white p-1.5 rounded border border-slate-100 truncate">
                              &ldquo;{st.remarks}&rdquo;
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Efficiency Gaps / Duration Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-100">
                  <div className="rounded-lg bg-slate-50 border border-slate-200/60 p-2.5 flex items-center gap-2 text-xs">
                    <Clock className="h-4 w-4 text-blue-600 shrink-0" />
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase font-bold block">Approval Lag</span>
                      <span className="font-bold text-slate-800">{formatDuration(m.approvalMinutes)}</span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200/60 p-2.5 flex items-center gap-2 text-xs">
                    <ArrowRight className="h-4 w-4 text-indigo-600 shrink-0" />
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase font-bold block">Dispatch Delay</span>
                      <span className="font-bold text-slate-800">{formatDuration(m.dispatchMinutes)}</span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200/60 p-2.5 flex items-center gap-2 text-xs">
                    <Route className="h-4 w-4 text-emerald-600 shrink-0" />
                    <div>
                      <span className="text-slate-400 text-[10px] uppercase font-bold block">Total Out Time</span>
                      <span className="font-bold text-slate-800">{formatDuration(m.tripMinutes)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── 4. Parking Bay & Key Handover (If Returned) ── */}
              {p.gateInAt && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Parked Location</span>
                      <span className="text-sm font-bold text-slate-900">{p.parkedLocation || 'Showroom Bay'}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                      <Key className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Keys Handed Over To</span>
                      <span className="text-sm font-bold text-slate-900">{p.keyHandoverTo || 'Security Desk'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── 5. Evidence at the Gate (Photo Gallery) ── */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Camera className="h-4 w-4 text-indigo-600" />
                    <h3 className="text-sm font-bold text-slate-900">Gate Condition Photos & Evidence</h3>
                  </div>
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                      m.evidence.complete
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {m.evidence.captured} of {m.evidence.expected} Photos Verified
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                  <EvidenceCard
                    label="Front View (Out)"
                    url={ev?.outPhotos?.front || ev?.outPhotos?.vehicle_front}
                    onZoom={() =>
                      ev?.outPhotos?.front || ev?.outPhotos?.vehicle_front
                        ? setLightboxImage({
                            label: 'Front View (Gate Out)',
                            url: ev?.outPhotos?.front || ev?.outPhotos?.vehicle_front,
                          })
                        : null
                    }
                  />
                  <EvidenceCard
                    label="Back View (Out)"
                    url={ev?.outPhotos?.back}
                    onZoom={() =>
                      ev?.outPhotos?.back
                        ? setLightboxImage({ label: 'Back View (Gate Out)', url: ev.outPhotos.back })
                        : null
                    }
                  />
                  <EvidenceCard
                    label="Right Side (Out)"
                    url={ev?.outPhotos?.right}
                    onZoom={() =>
                      ev?.outPhotos?.right
                        ? setLightboxImage({ label: 'Right Side (Gate Out)', url: ev.outPhotos.right })
                        : null
                    }
                  />
                  <EvidenceCard
                    label="Left Side (Out)"
                    url={ev?.outPhotos?.left}
                    onZoom={() =>
                      ev?.outPhotos?.left
                        ? setLightboxImage({ label: 'Left Side (Gate Out)', url: ev.outPhotos.left })
                        : null
                    }
                  />
                  <EvidenceCard
                    label="Odometer (Out)"
                    url={ev?.outPhotos?.odometer}
                    tag={p.gateOutOdo ? `${p.gateOutOdo} km` : undefined}
                    onZoom={() =>
                      ev?.outPhotos?.odometer
                        ? setLightboxImage({ label: 'Odometer (Gate Out)', url: ev.outPhotos.odometer })
                        : null
                    }
                  />
                  <EvidenceCard
                    label="Odometer (In)"
                    url={ev?.inPhotos?.odometer_in || ev?.inPhotos?.odometer}
                    tag={p.gateInOdo ? `${p.gateInOdo} km` : undefined}
                    onZoom={() =>
                      ev?.inPhotos?.odometer_in || ev?.inPhotos?.odometer
                        ? setLightboxImage({
                            label: 'Odometer (Gate In)',
                            url: ev?.inPhotos?.odometer_in || ev?.inPhotos?.odometer,
                          })
                        : null
                    }
                  />
                </div>
                <p className="text-[11px] text-slate-400 italic">
                  * High-resolution encrypted evidence. Click any photo to inspect in full resolution.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Photo Lightbox Dialog ── */}
      {lightboxImage && (
        <Dialog open={Boolean(lightboxImage)} onOpenChange={() => setLightboxImage(null)}>
          <DialogContent className="max-w-2xl p-2 bg-slate-900 border-slate-800 text-white">
            <DialogHeader className="p-2 flex flex-row items-center justify-between">
              <DialogTitle className="text-sm font-bold text-slate-200">{lightboxImage.label}</DialogTitle>
              <a
                href={lightboxImage.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
              >
                Open original <ExternalLink className="h-3 w-3" />
              </a>
            </DialogHeader>
            <div className="flex items-center justify-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxImage.url}
                alt={lightboxImage.label}
                className="max-h-[75vh] w-auto rounded-lg object-contain shadow-2xl"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function MetricCard({
  label,
  value,
  icon,
  bg,
  border,
  textColor,
  alert,
  sub,
}: {
  label: string
  value: string
  icon: React.ReactNode
  bg: string
  border: string
  textColor: string
  alert?: boolean
  sub?: string
}) {
  return (
    <div className={`rounded-xl border p-3.5 flex flex-col justify-between transition-all ${bg} ${border} shadow-xs`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">{label}</span>
        {icon}
      </div>
      <p className={`mt-2 text-lg sm:text-xl font-black font-mono ${alert ? 'text-rose-600' : textColor}`}>
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 line-clamp-2 break-words text-[11px] font-medium text-slate-500" title={sub}>
          {sub}
        </p>
      ) : null}
    </div>
  )
}

function EvidenceCard({
  label,
  url,
  tag,
  onZoom,
}: {
  label: string
  url?: string
  tag?: string
  onZoom: () => void
}) {
  if (!url) {
    return (
      <div className="h-28 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center p-2 text-center">
        <Camera className="h-5 w-5 text-slate-300 mb-1" />
        <span className="text-[10px] font-medium text-slate-400 leading-tight">{label}</span>
        <span className="text-[9px] text-slate-300 font-semibold mt-0.5">Not recorded</span>
      </div>
    )
  }

  return (
    <div
      onClick={onZoom}
      className="group relative h-28 rounded-xl border border-slate-200 bg-white overflow-hidden cursor-pointer shadow-2xs hover:shadow-md hover:border-indigo-300 transition-all"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={label}
        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex flex-col justify-end p-2 text-white">
        <p className="text-[10px] font-bold leading-tight drop-shadow-sm">{label}</p>
        {tag && <p className="text-[9px] font-mono font-medium text-indigo-200">{tag}</p>}
      </div>
    </div>
  )
}
