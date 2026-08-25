'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, Loader2, ShieldCheck, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Renewal pipeline & retention, inside the Insurance Analysis section.
 *
 * Reads /api/insurance/renewal-analytics. Every figure here is derived from own-damage policies
 * keyed on chassis — see lib/insurance/renewal-analytics.ts for why both of those matter.
 *
 * ⚠️ Nothing on this panel is a placeholder or an illustrative constant. This page has a history of
 * fabricated figures (a hardcoded "Claims Ratio 18.6%" shipped against a feed carrying no claims
 * data at all), so anything that cannot be computed is rendered as an explicit gap rather than
 * filled with something plausible.
 */

type YoyPoint = {
  year: number
  policies: number
  premium: number
  partial: boolean
  priorYearToSameDate?: { policies: number; premium: number }
}

type Cohort = {
  month: string
  expired: number
  retained: number
  lapsed: number
  retentionPct: number | null
  premiumRetained: number
  premiumLost: number
}

type MovementPoint = {
  month: string
  newCustomers: number
  renewed: number
  wonBack: number
  lost: number
  net: number
  premiumNew: number
  premiumLost: number
  /** False while the month is still inside the grace window — its losses are not countable yet. */
  lossesFinal: boolean
}

type LeakPoint = {
  key: string
  expired: number
  lost: number
  lapsePct: number | null
  premiumLost: number
}

type SegmentRetention = {
  key: string
  order: number
  expired: number
  retained: number
  retentionPct: number | null
  premiumLost: number
}

type Analytics = {
  asOf: string
  yoy: YoyPoint[]
  segments: { byNcb: SegmentRetention[]; byPremiumBand: SegmentRetention[] }
  movement: MovementPoint[]
  leaks: { byModel: LeakPoint[]; byBranch: LeakPoint[] }
  timing: { bucket: string; label: string; policies: number }[]
  urgency: { bucket: string; label: string; vehicles: number; premium: number }[]
  retention: {
    expired: number
    retained: number
    lapsed: number
    retentionPct: number | null
    premiumRetained: number
    premiumLost: number
  }
  cohorts: Cohort[]
  insurers: { insurer: string; policies: number; premium: number; sharePct: number }[]
  forwardBook: { month: string; vehicles: number; premium: number }[]
}

const inr = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`
  if (Math.abs(value) >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}
const count = (value: number) => Math.round(value || 0).toLocaleString('en-IN')
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return `${new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short' })} ${String(y).slice(2)}`
}

function Kpi({ label, value, sub, tone = 'default', icon: Icon }: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'good' | 'warn' | 'bad'
  icon?: typeof ShieldCheck
}) {
  const toneClass = {
    default: 'text-slate-900',
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    bad: 'text-rose-700',
  }[tone]
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      </div>
      <p className={cn('mt-2 text-2xl font-black tabular-nums tracking-tight', toneClass)}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{sub}</p>}
    </div>
  )
}

export function RenewalPipelinePanel({ brands }: { brands?: string[] }) {
  const brandKey = (brands || []).slice().sort().join(',')
  const query = useQuery<Analytics>({
    queryKey: ['insurance-renewal-analytics', brandKey],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (brandKey) params.set('brands', brandKey)
      // no-store: the app caches same-origin API GETs for 30 min keyed on URL only, which replays
      // an old payload shape after a deploy.
      const response = await fetch(`/api/insurance/renewal-analytics?${params.toString()}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to load renewal analytics')
      return payload as Analytics
    },
    staleTime: 10 * 60 * 1000,
  })

  const data = query.data

  /** Only years with a like-for-like base can show growth; the rest render the figure alone. */
  const yoyRows = useMemo(() => (data?.yoy || []).map((point) => {
    const base = point.priorYearToSameDate
    const policyGrowth = base && base.policies > 0
      ? ((point.policies - base.policies) / base.policies) * 100
      : null
    const premiumGrowth = base && base.premium > 0
      ? ((point.premium - base.premium) / base.premium) * 100
      : null
    return { ...point, policyGrowth, premiumGrowth, base }
  }), [data?.yoy])

  const forwardTotal = useMemo(() => (data?.forwardBook || []).reduce(
    (acc, month) => ({ vehicles: acc.vehicles + month.vehicles, premium: acc.premium + month.premium }),
    { vehicles: 0, premium: 0 },
  ), [data?.forwardBook])

  const peakForward = useMemo(
    () => Math.max(1, ...(data?.forwardBook || []).map((m) => m.vehicles)),
    [data?.forwardBook],
  )

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-slate-200/80 bg-white py-16">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none text-slate-300" />
      </div>
    )
  }

  if (query.isError || !data) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-rose-900">{(query.error as Error)?.message || 'Failed to load renewal analytics'}</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-2 text-xs font-bold text-rose-700 underline">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const retention = data.retention

  return (
    <div className="space-y-4">
      {/* ── Headline ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Retention"
          value={retention.retentionPct === null ? '—' : `${retention.retentionPct.toFixed(1)}%`}
          sub={`${count(retention.retained)} of ${count(retention.expired)} kept`}
          tone={retention.retentionPct !== null && retention.retentionPct >= 70 ? 'good' : 'warn'}
          icon={ShieldCheck}
        />
        <Kpi
          label="Lapsed"
          value={count(retention.lapsed)}
          sub="vehicles that did not come back"
          tone="bad"
          icon={AlertTriangle}
        />
        <Kpi
          label="Premium lost to lapses"
          value={inr(retention.premiumLost)}
          sub={`${inr(retention.premiumRetained)} retained`}
          tone="bad"
        />
        <Kpi
          label="Due next 12 months"
          value={count(forwardTotal.vehicles)}
          sub={`${inr(forwardTotal.premium)} of premium up for renewal`}
          tone="default"
          icon={CalendarClock}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ── Year on year ── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">Year on year</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th scope="col" className="pb-2">Year</th>
                  <th scope="col" className="pb-2 text-right">Policies</th>
                  <th scope="col" className="pb-2 text-right">Premium</th>
                  <th scope="col" className="pb-2 text-right">Growth</th>
                </tr>
              </thead>
              <tbody>
                {yoyRows.map((row) => (
                  <tr key={row.year} className="border-t border-slate-50">
                    <td className="py-2 font-bold text-slate-800">
                      {row.year}
                      {row.partial && (
                        // Never let a part-year be read as a full one — the raw figures showed
                        // 2026 "down 34%" simply because August is not December.
                        <span className="ml-1.5 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700 bg-amber-50">
                          part year
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right font-bold tabular-nums text-slate-900">{count(row.policies)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-700">{inr(row.premium)}</td>
                    <td className="py-2 text-right">
                      {row.policyGrowth === null ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className={cn(
                          'inline-flex items-center gap-0.5 font-black tabular-nums',
                          row.policyGrowth >= 0 ? 'text-emerald-700' : 'text-rose-700',
                        )}>
                          {row.policyGrowth >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {Math.abs(row.policyGrowth).toFixed(0)}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] font-medium text-slate-400">
            A part year is compared against the same dates of the year before, not against a full one.
          </p>
        </div>

        {/* ── Forward book ── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">
            Renewals due — next 12 months
          </h3>
          <div className="mt-3 space-y-1.5">
            {data.forwardBook.map((month) => (
              <div key={month.month} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-[11px] font-bold text-slate-500">{monthLabel(month.month)}</span>
                <div className="h-5 flex-1 overflow-hidden rounded-md bg-slate-100">
                  <div
                    className="h-full rounded-md bg-indigo-500/80"
                    style={{ width: `${Math.max(2, (month.vehicles / peakForward) * 100)}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-[11px] font-black tabular-nums text-slate-800">
                  {count(month.vehicles)}
                </span>
                <span className="w-16 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">
                  {inr(month.premium)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ── Retention by cohort ── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">
            Retention by expiry month
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th scope="col" className="pb-2">Expired in</th>
                  <th scope="col" className="pb-2 text-right">Due</th>
                  <th scope="col" className="pb-2 text-right">Kept</th>
                  <th scope="col" className="pb-2 text-right">Rate</th>
                  <th scope="col" className="pb-2 text-right">Premium lost</th>
                </tr>
              </thead>
              <tbody>
                {data.cohorts.slice(-12).reverse().map((cohort) => (
                  <tr key={cohort.month} className="border-t border-slate-50">
                    <td className="py-2 font-bold text-slate-800">{monthLabel(cohort.month)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700">{count(cohort.expired)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700">{count(cohort.retained)}</td>
                    <td className={cn(
                      'py-2 text-right font-black tabular-nums',
                      (cohort.retentionPct ?? 0) >= 70 ? 'text-emerald-700' : 'text-amber-700',
                    )}>
                      {cohort.retentionPct === null ? '—' : `${cohort.retentionPct.toFixed(0)}%`}
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums text-rose-600">{inr(cohort.premiumLost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] font-medium text-slate-400">
            Months too recent to judge are left out — a policy that expired last week has not had a
            chance to renew, and counting it would drag the rate down every day.
          </p>
        </div>

        {/* ── Insurer mix ── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <h3 className="flex items-center gap-2 border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">
            <TrendingUp className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Where the book sits
          </h3>
          <div className="mt-3 space-y-2">
            {data.insurers.slice(0, 8).map((insurer) => (
              <div key={insurer.insurer} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-[11px] font-bold text-slate-700" title={insurer.insurer}>
                  {insurer.insurer}
                </span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                  <div className="h-full rounded bg-slate-700/80" style={{ width: `${Math.max(2, insurer.sharePct)}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-[11px] font-black tabular-nums text-slate-800">
                  {insurer.sharePct.toFixed(1)}%
                </span>
                <span className="w-16 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">
                  {inr(insurer.premium)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── What to act on now ── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">Act on now</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.urgency.map((bucket) => (
            <div
              key={bucket.bucket}
              className={cn(
                'rounded-xl border p-4',
                bucket.bucket === 'overdue' ? 'border-rose-200 bg-rose-50/70'
                  : bucket.bucket === 'week' ? 'border-amber-200 bg-amber-50/70'
                  : 'border-slate-200 bg-slate-50/70',
              )}
            >
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{bucket.label}</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{count(bucket.vehicles)}</p>
              <p className="text-[11px] font-semibold text-slate-500">{inr(bucket.premium)} of premium</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ── Customer movement ── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">
            Customers gained &amp; lost
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th scope="col" className="pb-2">Month</th>
                  <th scope="col" className="pb-2 text-right">New</th>
                  <th scope="col" className="pb-2 text-right">Renewed</th>
                  <th scope="col" className="pb-2 text-right">Won back</th>
                  <th scope="col" className="pb-2 text-right">Lost</th>
                  <th scope="col" className="pb-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {data.movement.slice(-12).reverse().map((point) => (
                  <tr key={point.month} className="border-t border-slate-50">
                    <td className="py-2 font-bold text-slate-800">
                      {monthLabel(point.month)}
                      {!point.lossesFinal && (
                        /*
                         * Losses for this month are still inside the grace window. Without saying so,
                         * the newest rows always read as pure growth — August showed net +171 with
                         * zero losses simply because nothing had run out of time to renew yet.
                         */
                        <span
                          className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500"
                          title="Too recent to count losses — these policies still have time to renew"
                        >
                          partial
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right font-bold tabular-nums text-emerald-700">{count(point.newCustomers)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700">{count(point.renewed)}</td>
                    <td className="py-2 text-right tabular-nums text-indigo-700">{count(point.wonBack)}</td>
                    <td className="py-2 text-right font-bold tabular-nums text-rose-600">
                      {point.lossesFinal ? count(point.lost) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={cn(
                      'py-2 text-right font-black tabular-nums',
                      !point.lossesFinal ? 'text-slate-300' : point.net >= 0 ? 'text-emerald-700' : 'text-rose-700',
                    )}>
                      {point.lossesFinal ? `${point.net >= 0 ? '+' : ''}${count(point.net)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] font-medium text-slate-400">
            Won back = the vehicle had lapsed and came back later. Counted apart from renewals so it
            is neither hidden inside them nor double-counted as a new customer.
          </p>
        </div>

        {/* ── Renewal timing ── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">
            When renewals actually happen
          </h3>
          <div className="mt-3 space-y-2">
            {(() => {
              const total = data.timing.reduce((sum, bucket) => sum + bucket.policies, 0) || 1
              return data.timing.map((bucket) => (
                <div key={bucket.bucket} className="flex items-center gap-3">
                  <span className="w-52 shrink-0 text-[11px] font-bold text-slate-700">{bucket.label}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <div
                      className={cn('h-full rounded', bucket.bucket === 'on_time' ? 'bg-emerald-500/80' : 'bg-slate-400/70')}
                      style={{ width: `${Math.max(1, (bucket.policies / total) * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-[11px] font-black tabular-nums text-slate-800">
                    {count(bucket.policies)}
                  </span>
                  <span className="w-10 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">
                    {((bucket.policies / total) * 100).toFixed(0)}%
                  </span>
                </div>
              ))
            })()}
          </div>
          <p className="mt-2 text-[10px] font-medium text-slate-400">
            Read this before setting a calling schedule: if the book renews in the week around expiry,
            a campaign that starts on expiry day is already late for most of it.
          </p>
        </div>
      </div>

      {/* ── Where cover leaks ── */}
      <div className="grid gap-4 xl:grid-cols-2">
        {([
          { title: 'Where we lose most — by model', rows: data.leaks.byModel },
          { title: 'Where we lose most — by branch', rows: data.leaks.byBranch },
        ] as const).map((section) => (
          <div key={section.title} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
            <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">{section.title}</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <th scope="col" className="pb-2">Name</th>
                    <th scope="col" className="pb-2 text-right">Lost</th>
                    <th scope="col" className="pb-2 text-right">Of</th>
                    <th scope="col" className="pb-2 text-right">Lapse rate</th>
                    <th scope="col" className="pb-2 text-right">Premium lost</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.slice(0, 8).map((row) => (
                    <tr key={row.key} className="border-t border-slate-50">
                      <td className="max-w-[10rem] truncate py-2 font-bold text-slate-800" title={row.key}>{row.key}</td>
                      <td className="py-2 text-right font-bold tabular-nums text-rose-600">{count(row.lost)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-500">{count(row.expired)}</td>
                      <td className="py-2 text-right font-black tabular-nums text-slate-800">
                        {row.lapsePct === null ? '—' : `${row.lapsePct.toFixed(0)}%`}
                      </td>
                      <td className="py-2 text-right font-semibold tabular-nums text-slate-600">{inr(row.premiumLost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] font-medium text-slate-400">
              The biggest loss is usually just the biggest seller — the lapse RATE is what points at a
              problem worth chasing.
            </p>
          </div>
        ))}
      </div>

      {/* ── Who we lose ── */}
      <div className="grid gap-4 xl:grid-cols-2">
        {([
          {
            title: 'Retention by no-claim bonus',
            note: 'Higher NCB means longer claim-free tenure. Read down the rate column — if it climbs, loyalty compounds and the 0% slab is where the book actually leaks.',
            rows: data.segments.byNcb,
            nameHeader: 'NCB slab',
          },
          {
            title: 'Retention by premium band',
            note: 'What the customer was paying on the policy that expired. A book that keeps its cheap policies and loses its expensive ones has a value problem the headline rate hides.',
            rows: data.segments.byPremiumBand,
            nameHeader: 'Premium band',
          },
        ] as const).map((section) => {
          // Scale bars against the best rate present, so differences between slabs stay visible
          // instead of every bar sitting at roughly three-quarters full.
          const peak = Math.max(1, ...section.rows.map((row) => row.retentionPct ?? 0))
          return (
            <div key={section.title} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">{section.title}</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th scope="col" className="pb-2">{section.nameHeader}</th>
                      <th scope="col" className="pb-2 text-right">Due</th>
                      <th scope="col" className="pb-2 text-right">Kept</th>
                      <th scope="col" className="pb-2">Rate</th>
                      <th scope="col" className="pb-2 text-right">Premium lost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => (
                      <tr key={row.key} className="border-t border-slate-50">
                        <td className="py-2 font-bold text-slate-800">
                          {row.key}
                          {row.key === 'Not recorded' && (
                            <span
                              className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500"
                              title="The feed does not carry this field for these policies — shown so the slabs are not read as covering the whole book"
                            >
                              no data
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600">{count(row.expired)}</td>
                        <td className="py-2 text-right tabular-nums text-slate-600">{count(row.retained)}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-3.5 w-20 overflow-hidden rounded bg-slate-100">
                              <div
                                className={cn(
                                  'h-full rounded',
                                  (row.retentionPct ?? 0) >= 75 ? 'bg-emerald-500/80'
                                    : (row.retentionPct ?? 0) >= 65 ? 'bg-amber-500/80'
                                    : 'bg-rose-500/80',
                                )}
                                style={{ width: `${Math.max(2, ((row.retentionPct ?? 0) / peak) * 100)}%` }}
                              />
                            </div>
                            <span className={cn(
                              'w-12 text-right font-black tabular-nums',
                              (row.retentionPct ?? 0) >= 75 ? 'text-emerald-700'
                                : (row.retentionPct ?? 0) >= 65 ? 'text-amber-700'
                                : 'text-rose-700',
                            )}>
                              {row.retentionPct === null ? '—' : `${row.retentionPct.toFixed(1)}%`}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 text-right font-semibold tabular-nums text-rose-600">{inr(row.premiumLost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[10px] font-medium text-slate-400">{section.note}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
