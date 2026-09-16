'use client'

import { useMemo } from 'react'
import {
  History,
  TrendingUp,
  Percent,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  ShieldCheck,
  CalendarClock,
  Clock,
  Building2,
  Car,
  Layers,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { InsuranceBrandId } from '@/lib/insurance/brands'
import { INSURANCE_BRANDS } from '@/lib/insurance/brands'

type Props = {
  brand: InsuranceBrandId
  analyticsData: any
  isLoading: boolean
}

function formatInr(val?: number | null) {
  const n = Number(val || 0)
  if (!Number.isFinite(n) || n === 0) return '₹0'
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatCount(val?: number | null) {
  return new Intl.NumberFormat('en-IN').format(Number(val || 0))
}

function monthLabel(ym?: string) {
  if (!ym) return '—'
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return `${new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short' })} ${String(y).slice(2)}`
}

export function CohortsWorkspace({ brand, analyticsData, isLoading }: Props) {
  const brandConfig = INSURANCE_BRANDS[brand]

  const retention = analyticsData?.retention || {
    expired: 0,
    retained: 0,
    lapsed: 0,
    retentionPct: 0,
    premiumRetained: 0,
    premiumLost: 0,
  }

  const cohorts = analyticsData?.cohorts || []
  const yoyData = analyticsData?.yoy || []
  const forwardBook = analyticsData?.forwardBook || []
  const insurers = analyticsData?.insurers || []
  const movement = analyticsData?.movement || []
  const timing = analyticsData?.timing || []
  const urgency = analyticsData?.urgency || []
  const leaks = analyticsData?.leaks || { byModel: [], byBranch: [] }
  const segments = analyticsData?.segments || { byNcb: [], byPremiumBand: [] }

  // YoY Growth calculations
  const yoyRows = useMemo(() => {
    return (yoyData || []).map((point: any) => {
      const base = point.priorYearToSameDate
      const policyGrowth =
        base && base.policies > 0
          ? ((point.policies - base.policies) / base.policies) * 100
          : null
      const premiumGrowth =
        base && base.premium > 0
          ? ((point.premium - base.premium) / base.premium) * 100
          : null
      return { ...point, policyGrowth, premiumGrowth, base }
    })
  }, [yoyData])

  const forwardTotal = useMemo(() => {
    return (forwardBook || []).reduce(
      (acc: any, m: any) => ({
        vehicles: acc.vehicles + (m.vehicles || 0),
        premium: acc.premium + (m.premium || 0),
      }),
      { vehicles: 0, premium: 0 }
    )
  }, [forwardBook])

  const peakForward = useMemo(() => {
    return Math.max(1, ...(forwardBook || []).map((m: any) => m.vehicles || 0))
  }, [forwardBook])

  const timingTotal = useMemo(() => {
    return (timing || []).reduce((sum: number, b: any) => sum + (b.policies || 0), 0) || 1
  }, [timing])

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-2xl bg-slate-100 dark:bg-slate-800" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 rounded-2xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-64 rounded-2xl bg-slate-100 dark:bg-slate-800" />
        </div>
        <div className="h-80 rounded-2xl bg-slate-100 dark:bg-slate-800" />
      </div>
    )
  }

  const retPct = retention.retentionPct !== null && retention.retentionPct !== undefined ? Number(retention.retentionPct) : null

  return (
    <div className="space-y-5">
      {/* ── Headline Summary Card ── */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/70 text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-900/50">
              <History className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Retention Dynamics & Actuarial Cohorts
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Scope: {brandConfig.retentionScopeNote}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'text-xs font-black tracking-tight px-3 py-1',
                retPct && retPct >= 50
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300 border-teal-200 dark:border-teal-800'
              )}
            >
              Lifetime Retention: {retPct !== null ? `${retPct.toFixed(1)}%` : '—'}
            </Badge>
          </div>
        </div>

        {/* 4 Headline Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/40 p-3.5 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 mb-1">
              <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Expired Policies Due</span>
            </div>
            <span className="text-xl font-black text-slate-900 dark:text-slate-100 block">
              {formatCount(retention.expired)}
            </span>
            <span className="text-[11px] text-slate-500 font-medium mt-0.5 block">
              {formatCount(retention.retained)} renewed ({retPct !== null ? `${retPct.toFixed(1)}%` : '0%'})
            </span>
          </div>

          <div className="rounded-xl bg-rose-50/50 dark:bg-rose-950/20 p-3.5 border border-rose-100 dark:border-rose-900/30">
            <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Lapsed / Lost Units</span>
            </div>
            <span className="text-xl font-black text-rose-700 dark:text-rose-300 block">
              {formatCount(retention.lapsed)}
            </span>
            <span className="text-[11px] text-rose-600/80 dark:text-rose-400/80 font-medium mt-0.5 block">
              Vehicles not renewed with AM
            </span>
          </div>

          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/40 p-3.5 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-teal-600" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Retained Premium</span>
            </div>
            <span className="text-xl font-black text-teal-600 dark:text-teal-400 block">
              {formatInr(retention.premiumRetained)}
            </span>
            <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium mt-0.5 block">
              Lost: {formatInr(retention.premiumLost)}
            </span>
          </div>

          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/40 p-3.5 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 mb-1">
              <CalendarClock className="h-3.5 w-3.5 text-indigo-500" />
              <span className="text-[10px] font-bold uppercase tracking-wider">12M Forward Pipeline</span>
            </div>
            <span className="text-xl font-black text-slate-900 dark:text-slate-100 block">
              {formatCount(forwardTotal.vehicles)}
            </span>
            <span className="text-[11px] text-slate-500 font-medium mt-0.5 block">
              {formatInr(forwardTotal.premium)} pipeline value
            </span>
          </div>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic bg-slate-50/70 dark:bg-slate-800/30 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
          ℹ️ {brandConfig.renewalEventNote}
        </p>
      </div>

      {/* ── Section 1: Year-over-Year Trajectory & 12M Forward Book ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* YoY Performance */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Year-over-Year Growth & Trajectory
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">Like-for-like baseline</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="pb-2">Year</th>
                  <th className="pb-2 text-right">Policies</th>
                  <th className="pb-2 text-right">Premium</th>
                  <th className="pb-2 text-right">Growth YoY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {yoyRows.map((row: any) => (
                  <tr key={row.year} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      {row.year}
                      {row.partial && (
                        <span className="rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
                          part year
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-bold tabular-nums text-slate-800 dark:text-slate-200">
                      {formatCount(row.policies)}
                    </td>
                    <td className="py-2.5 text-right font-semibold tabular-nums text-slate-600 dark:text-slate-400">
                      {formatInr(row.premium)}
                    </td>
                    <td className="py-2.5 text-right font-black tabular-nums">
                      {row.policyGrowth === null ? (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5',
                            row.policyGrowth >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          )}
                        >
                          {row.policyGrowth >= 0 ? (
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDownRight className="h-3.5 w-3.5" />
                          )}
                          {Math.abs(row.policyGrowth).toFixed(0)}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 font-medium">
            Part-year periods are calibrated against the exact matching dates of the previous year.
          </p>
        </div>

        {/* 12-Month Forward Book */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Forward Book Pipeline (Next 12 Months)
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">Upcoming expiries</span>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {forwardBook.map((month: any) => {
              const pct = Math.max(2, (month.vehicles / peakForward) * 100)
              return (
                <div key={month.month} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {monthLabel(month.month)}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded bg-indigo-500/80 dark:bg-indigo-400 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[11px] font-black tabular-nums text-slate-900 dark:text-slate-100">
                    {formatCount(month.vehicles)}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">
                    {formatInr(month.premium)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Section 2: Expiry Cohort Matrix & Insurer Mix ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Cohort Matrix Table */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Retention by Expiry Month (Past 12 Months)
            </span>
            <span className="text-[10px] text-slate-400 font-medium">Cohort conversion</span>
          </div>

          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <Table>
              <TableHeader className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider">Month</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Due</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Kept</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right">Rate</TableHead>
                  <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider pr-4">
                    Premium Lost
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cohorts.slice(-12).reverse().map((c: any) => {
                  const rRate = c.retentionPct !== null && c.retentionPct !== undefined ? Number(c.retentionPct) : null
                  return (
                    <TableRow key={c.month} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                      <td className="font-bold text-xs text-slate-900 dark:text-slate-100 py-2">
                        {monthLabel(c.month)}
                      </td>
                      <td className="font-medium text-xs text-slate-700 dark:text-slate-300 text-right py-2 tabular-nums">
                        {formatCount(c.expired)}
                      </td>
                      <td className="font-bold text-xs text-emerald-600 dark:text-emerald-400 text-right py-2 tabular-nums">
                        {formatCount(c.retained)}
                      </td>
                      <td className="text-right py-2 tabular-nums">
                        {rRate === null ? (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        ) : (
                          <Badge
                            variant="secondary"
                            className={cn(
                              'text-[10px] font-bold px-1.5 py-0',
                              rRate >= 40
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            )}
                          >
                            {rRate.toFixed(1)}%
                          </Badge>
                        )}
                      </td>
                      <td className="text-right text-xs font-semibold text-rose-600 dark:text-rose-400 pr-4 py-2 tabular-nums">
                        {formatInr(c.premiumLost)}
                      </td>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Insurer Mix */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-slate-400" />
              Underwriter / Insurer Market Share
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">Top 8 insurers</span>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {insurers.slice(0, 8).map((ins: any) => (
              <div key={ins.insurer} className="flex items-center gap-3">
                <span
                  className="w-36 shrink-0 truncate text-[11px] font-bold text-slate-700 dark:text-slate-300"
                  title={ins.insurer}
                >
                  {ins.insurer}
                </span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded bg-teal-600 dark:bg-teal-500"
                    style={{ width: `${Math.max(2, ins.sharePct)}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-[11px] font-black tabular-nums text-slate-900 dark:text-slate-100">
                  {Number(ins.sharePct).toFixed(1)}%
                </span>
                <span className="w-16 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">
                  {formatInr(ins.premium)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section 3: Act On Now Urgency Buckets & Renewal Timing ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Urgency Buckets */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              Immediate Action Pipeline (Urgency Buckets)
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">Renewal windows</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {urgency.map((bucket: any) => (
              <div
                key={bucket.bucket}
                className={cn(
                  'rounded-xl border p-3.5',
                  bucket.bucket === 'overdue'
                    ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20'
                    : bucket.bucket === 'week'
                    ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20'
                    : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-850/50'
                )}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                  {bucket.label}
                </span>
                <span className="text-lg font-black text-slate-900 dark:text-slate-100 mt-1 block">
                  {formatCount(bucket.vehicles)}
                </span>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5 block">
                  {formatInr(bucket.premium)} premium
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Renewal Timing Distribution */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              When Renewals Actually Convert
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">Conversion timeline</span>
          </div>

          <div className="space-y-2.5">
            {timing.map((b: any) => {
              const pct = ((b.policies / timingTotal) * 100).toFixed(0)
              return (
                <div key={b.bucket} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    {b.label}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div
                      className={cn(
                        'h-full rounded',
                        b.bucket === 'on_time'
                          ? 'bg-emerald-500/80 dark:bg-emerald-400'
                          : 'bg-slate-400/80 dark:bg-slate-600'
                      )}
                      style={{ width: `${Math.max(2, Number(pct))}%` }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-[11px] font-black tabular-nums text-slate-800 dark:text-slate-200">
                    {formatCount(b.policies)}
                  </span>
                  <span className="w-10 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">
                    {pct}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Section 4: Customer Movement Dynamics ── */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-400" />
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Customer Net Movement Flow (New, Retained, Won-Back, Lost)
            </h3>
          </div>
          <span className="text-[10px] text-slate-400 font-medium">Monthly dynamics</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <th className="py-2.5 px-4">Month</th>
                <th className="py-2.5 text-right">New Inflow</th>
                <th className="py-2.5 text-right">Renewed</th>
                <th className="py-2.5 text-right">Won Back</th>
                <th className="py-2.5 text-right">Lost / Lapsed</th>
                <th className="py-2.5 text-right pr-4">Net Growth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {movement.slice(-12).reverse().map((point: any) => (
                <tr key={point.month} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    {monthLabel(point.month)}
                    {!point.lossesFinal && (
                      <span className="rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                        grace period
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    +{formatCount(point.newCustomers)}
                  </td>
                  <td className="py-2.5 text-right font-medium tabular-nums text-slate-700 dark:text-slate-300">
                    {formatCount(point.renewed)}
                  </td>
                  <td className="py-2.5 text-right font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
                    +{formatCount(point.wonBack)}
                  </td>
                  <td className="py-2.5 text-right font-bold tabular-nums text-rose-600 dark:text-rose-400">
                    {point.lossesFinal ? `-${formatCount(point.lost)}` : <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="py-2.5 text-right pr-4 font-black tabular-nums">
                    {!point.lossesFinal ? (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    ) : (
                      <span
                        className={cn(
                          point.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        )}
                      >
                        {point.net >= 0 ? `+${formatCount(point.net)}` : formatCount(point.net)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 5: Coverage Leak Points (By Model & By Branch) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Leaks by Model */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5 text-slate-400" />
              Lapse Leak Points — By Vehicle Model
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">Top loss drivers</span>
          </div>

          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="pb-2">Model</th>
                  <th className="pb-2 text-right">Lost</th>
                  <th className="pb-2 text-right">Total Due</th>
                  <th className="pb-2 text-right">Lapse %</th>
                  <th className="pb-2 text-right">Lost Premium</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {leaks.byModel.slice(0, 8).map((row: any) => (
                  <tr key={row.key} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2 font-bold text-slate-900 dark:text-slate-100 truncate max-w-[120px]" title={row.key}>
                      {row.key}
                    </td>
                    <td className="py-2 text-right font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                      {formatCount(row.lost)}
                    </td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">
                      {formatCount(row.expired)}
                    </td>
                    <td className="py-2 text-right font-black tabular-nums text-slate-800 dark:text-slate-200">
                      {row.lapsePct !== null ? `${Number(row.lapsePct).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                      {formatInr(row.premiumLost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Leaks by Branch */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-slate-400" />
              Lapse Leak Points — By Dealership Branch
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">Dealer locations</span>
          </div>

          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="pb-2">Branch</th>
                  <th className="pb-2 text-right">Lost</th>
                  <th className="pb-2 text-right">Total Due</th>
                  <th className="pb-2 text-right">Lapse %</th>
                  <th className="pb-2 text-right">Lost Premium</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {leaks.byBranch.slice(0, 8).map((row: any) => (
                  <tr key={row.key} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2 font-bold text-slate-900 dark:text-slate-100 truncate max-w-[120px]" title={row.key}>
                      {row.key}
                    </td>
                    <td className="py-2 text-right font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                      {formatCount(row.lost)}
                    </td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">
                      {formatCount(row.expired)}
                    </td>
                    <td className="py-2 text-right font-black tabular-nums text-slate-800 dark:text-slate-200">
                      {row.lapsePct !== null ? `${Number(row.lapsePct).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                      {formatInr(row.premiumLost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Section 6: Retention by Segment (NCB Slab & Premium Band) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* By NCB Slab */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Retention by No-Claim Bonus (NCB Slab)
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">Customer loyalty</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="pb-2">NCB Slab</th>
                  <th className="pb-2 text-right">Due</th>
                  <th className="pb-2 text-right">Kept</th>
                  <th className="pb-2">Retention Rate</th>
                  <th className="pb-2 text-right">Lost Premium</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {segments.byNcb.map((row: any) => {
                  const rate = row.retentionPct !== null && row.retentionPct !== undefined ? Number(row.retentionPct) : null
                  return (
                    <tr key={row.key} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 font-bold text-slate-900 dark:text-slate-100">
                        {row.key}
                      </td>
                      <td className="py-2.5 text-right font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatCount(row.expired)}
                      </td>
                      <td className="py-2.5 text-right font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {formatCount(row.retained)}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-16 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full rounded bg-teal-500"
                              style={{ width: `${Math.max(2, rate || 0)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-black tabular-nums text-slate-900 dark:text-slate-100">
                            {rate !== null ? `${rate.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                        {formatInr(row.premiumLost)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* By Premium Band */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Retention by Premium Ticket Size
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">Ticket size band</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="pb-2">Premium Band</th>
                  <th className="pb-2 text-right">Due</th>
                  <th className="pb-2 text-right">Kept</th>
                  <th className="pb-2">Retention Rate</th>
                  <th className="pb-2 text-right">Lost Premium</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {segments.byPremiumBand.map((row: any) => {
                  const rate = row.retentionPct !== null && row.retentionPct !== undefined ? Number(row.retentionPct) : null
                  return (
                    <tr key={row.key} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 font-bold text-slate-900 dark:text-slate-100">
                        {row.key}
                      </td>
                      <td className="py-2.5 text-right font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatCount(row.expired)}
                      </td>
                      <td className="py-2.5 text-right font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {formatCount(row.retained)}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-16 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full rounded bg-teal-500"
                              style={{ width: `${Math.max(2, rate || 0)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-black tabular-nums text-slate-900 dark:text-slate-100">
                            {rate !== null ? `${rate.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                        {formatInr(row.premiumLost)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

