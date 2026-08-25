'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2, Wrench, ShieldAlert, IndianRupee, Gauge, TrendingUp, TrendingDown, MinusCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  RoDayWiseTrendChart, computeDailyTarget, computeRoBillingKpiStats,
} from '@/features/kia/ro-billing-day-wise-trend'

type Split = { roCount: number; labour: number; parts: number; billing: number }
type Location = { dealer: string; label: string; billing: number; roCount: number; labour: number; parts: number; growth: number | null }
type WorkshopSummary = {
  meta: { monthLabel: string; startDate: string; endDate: string; throughDay: number; daysInMonth: number; dealerCode: string | null; dataAvailable: boolean }
  total: Split & { avgBilling: number }
  mechanical: Split
  accidental: Split
  lyTotal: Split & { avgBilling: number }
  lyMechanical: Split
  lyAccidental: Split
  locations: Location[]
  trend: { day: string; cy: number; ly: number }[]
  /**
   * The MD's targets for this month and this scope, from /targets. NULL throughout when nothing is
   * set, or when the targets table is not reachable — never 0, so an unset branch can render an
   * em-dash rather than claiming 0% achieved.
   */
  targets: {
    roCount: number | null
    mechLabour: number | null
    bodyshopLabour: number | null
    labourTotal: number | null
    branchesWithTarget: number
    branchesInScope: number
  } | null
  targetPeriod: { year: number; month: number; daysInMonth: number; throughDay: number }
}

function formatCurrency(value: number) {
  const v = Number.isFinite(value) ? value : 0
  const rounded = Math.round(Math.abs(v))
  const sign = v < 0 ? '-' : ''
  if (rounded >= 10000000) return `${sign}₹${(rounded / 10000000).toFixed(2)}Cr`
  if (rounded >= 100000) return `${sign}₹${(rounded / 100000).toFixed(2)}L`
  return `${sign}₹${rounded.toLocaleString('en-IN')}`
}
function formatInt(value: number) { return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-IN') }

export function WorkshopSummarySection({ endDate, dealerCode }: { endDate?: string | null; dealerCode?: string | null }) {
  const query = useQuery<WorkshopSummary>({
    queryKey: ['platinum-workshop-summary', endDate || 'today', dealerCode || 'all'],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (endDate) params.set('endDate', endDate)
      if (dealerCode) params.set('dealer_code', dealerCode)
      const res = await fetch(`/api/brands/platinum/business-excellence/workshop-summary?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })
  const d = query.data

  if (query.isLoading) return <div className="flex h-72 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
  if (query.isError) return <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(query.error as Error)?.message || 'Failed to load Workshop Summary.'}</div>
  if (!d) return null

  const kpiStats = computeRoBillingKpiStats(d.trend, { throughDay: d.meta.throughDay, daysInMonth: d.meta.daysInMonth })
  const dailyTarget = computeDailyTarget(d.trend)

  // YoY calculations helper
  const getGrowth = (cy: number, ly: number) => {
    if (!ly || ly <= 0) return null
    return ((cy - ly) / ly) * 100
  }

  // matrix cell rendering helper
  /**
   * Achievement against the MD's target, PRO-RATED to the day.
   *
   * The CY beside it is month-to-date, so comparing it with a whole-month target would report every
   * workshop as far behind until the last day of the month. `throughDay / daysInMonth` is the same
   * elapsed-time basis the /targets grid uses for its "due by today" figure, so the two screens
   * agree. The full-month target is still what is DISPLAYED — that is the number the MD set.
   */
  const paceAgainstTarget = (cy: number, target: number | null) => {
    if (target === null || target <= 0) return null
    const { throughDay, daysInMonth } = d.targetPeriod
    const expected = target * (daysInMonth > 0 ? throughDay / daysInMonth : 1)
    if (expected <= 0) return null
    return Math.round((cy / expected) * 100)
  }

  const renderCell = (cy: number, ly: number, formatter: (v: number) => string, target: number | null = null) => {
    const growth = getGrowth(cy, ly)
    const pace = paceAgainstTarget(cy, target)
    return (
      <div className="text-right">
        <div className="text-[14px] font-black text-slate-900">{formatter(cy)}</div>
        <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[10px] font-semibold text-slate-400">
          <span>LY: {formatter(ly)}</span>
          {growth !== null && (
            <span className={cn(
              'font-black',
              growth >= 0 ? 'text-emerald-600' : 'text-rose-600'
            )}>
              ({growth >= 0 ? '+' : ''}{growth.toFixed(1)}%)
            </span>
          )}
        </div>
        {/*
          * Rendered only when a target actually exists. An em-dash row for every unset metric would
          * add four empty lines to the matrix and teach the reader to ignore the third line.
          */}
        {target !== null && (
          <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[10px] font-semibold text-indigo-700">
            <span>Target: {formatter(target)}</span>
            {pace !== null && (
              <span
                className={cn('font-black', pace >= 100 ? 'text-emerald-600' : pace >= 90 ? 'text-amber-600' : 'text-rose-600')}
                title={`Month-to-date billing is ${pace}% of the ${d.targetPeriod.throughDay}/${d.targetPeriod.daysInMonth} of the monthly target due by today. The figure shown is the FULL month target.`}
              >
                {pace}%
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  const matrix = [
    {
      label: 'Total Billing',
      total: { cy: d.total.billing, ly: d.lyTotal.billing, formatter: formatCurrency },
      mech: { cy: d.mechanical.billing, ly: d.lyMechanical.billing, formatter: formatCurrency },
      acc: { cy: d.accidental.billing, ly: d.lyAccidental.billing, formatter: formatCurrency }
    },
    {
      // The MD's four workshop targets land here and in the Labour Revenue row, with no new rows:
      // RO -> RO Count/Total, Mech labour -> Labour Revenue/Mechanical, Bodyshop labour ->
      // Labour Revenue/Accidental, Labour -> Labour Revenue/Total.
      label: 'RO Count',
      total: { cy: d.total.roCount, ly: d.lyTotal.roCount, formatter: (v: number) => formatInt(v), target: d.targets?.roCount ?? null },
      mech: { cy: d.mechanical.roCount, ly: d.lyMechanical.roCount, formatter: (v: number) => formatInt(v) },
      acc: { cy: d.accidental.roCount, ly: d.lyAccidental.roCount, formatter: (v: number) => formatInt(v) }
    },
    {
      label: 'Labour Revenue',
      total: { cy: d.total.labour, ly: d.lyTotal.labour, formatter: formatCurrency, target: d.targets?.labourTotal ?? null },
      mech: { cy: d.mechanical.labour, ly: d.lyMechanical.labour, formatter: formatCurrency, target: d.targets?.mechLabour ?? null },
      acc: { cy: d.accidental.labour, ly: d.lyAccidental.labour, formatter: formatCurrency, target: d.targets?.bodyshopLabour ?? null }
    },
    {
      label: 'Parts Revenue',
      total: { cy: d.total.parts, ly: d.lyTotal.parts, formatter: formatCurrency },
      mech: { cy: d.mechanical.parts, ly: d.lyMechanical.parts, formatter: formatCurrency },
      acc: { cy: d.accidental.parts, ly: d.lyAccidental.parts, formatter: formatCurrency }
    }
  ]

  return (
    <div className="space-y-6 p-6">
      {/* Headline KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BigKpi 
          icon={<IndianRupee className="h-5 w-5" />} 
          label="Total Billing" 
          value={formatCurrency(d.total.billing)} 
          tone="from-[#0B5D7A] to-[#0e7490]" 
          sub={`${d.meta.monthLabel} · MTD`} 
          comparison={{ lyValue: formatCurrency(d.lyTotal.billing), growth: getGrowth(d.total.billing, d.lyTotal.billing) }}
        />
        <BigKpi 
          icon={<Gauge className="h-5 w-5" />} 
          label="Average Billing / RO" 
          value={formatCurrency(d.total.avgBilling)} 
          tone="from-indigo-600 to-indigo-500" 
          sub={`${formatInt(d.total.roCount)} ROs`} 
          comparison={{ lyValue: formatCurrency(d.lyTotal.avgBilling), growth: getGrowth(d.total.avgBilling, d.lyTotal.avgBilling) }}
        />
        <BigKpi 
          icon={<Wrench className="h-5 w-5" />} 
          label="Total RO Count" 
          value={formatInt(d.total.roCount)} 
          tone="from-[#24766d] to-[#2f8f83]" 
          sub={`${formatInt(d.mechanical.roCount)} mech · ${formatInt(d.accidental.roCount)} accidental`} 
          comparison={{ lyValue: formatInt(d.lyTotal.roCount), growth: getGrowth(d.total.roCount, d.lyTotal.roCount) }}
        />
      </div>

      {/*
        * Partial-coverage warning for the All-Locations view.
        *
        * ⚠️ Summing the branches that DO have a target produces a group figure that looks complete
        * and is not — the same class of quiet under-report as a failed read cached as Rs0. So when
        * only some branches are set, say so rather than showing a bare number.
        */}
      {d.targets && d.targets.branchesWithTarget > 0
        && d.targets.branchesWithTarget < d.targets.branchesInScope && (
        <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-[11px] font-bold text-amber-900">
          Targets are set for {d.targets.branchesWithTarget} of {d.targets.branchesInScope} branches,
          so the group target below is the sum of those {d.targets.branchesWithTarget} only.
        </div>
      )}

      {/* Mechanical vs Accidental matrix */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <span>Metric</span>
          <span className="text-right">Total</span>
          <span className="text-right"><Wrench className="mr-1 inline h-3 w-3 text-slate-400" />Mechanical</span>
          <span className="text-right"><ShieldAlert className="mr-1 inline h-3 w-3 text-rose-400" />Accidental</span>
        </div>
        {matrix.map((row) => (
          <div key={row.label} className="grid grid-cols-4 items-center border-b border-slate-50 px-5 py-3.5 last:border-0">
            <span className="text-[13px] font-bold text-slate-700">{row.label}</span>
            {/* Rows without a target simply pass undefined — renderCell then omits the third line. */}
            {renderCell(row.total.cy, row.total.ly, row.total.formatter, 'target' in row.total ? row.total.target : null)}
            {renderCell(row.mech.cy, row.mech.ly, row.mech.formatter, 'target' in row.mech ? row.mech.target : null)}
            {renderCell(row.acc.cy, row.acc.ly, row.acc.formatter, 'target' in row.acc ? row.acc.target : null)}
          </div>
        ))}
      </div>

      {/* Day Wise Trend */}
      <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-6 pt-5">
          <TrendingUp className="h-4 w-4 text-[#0B5D7A]" />
          <h3 className="pb-4 text-[12px] font-black uppercase tracking-widest text-slate-500">Day Wise Trend &amp; Month-to-Date Targets</h3>
        </div>
        {d.trend.length === 0 ? (
          <div className="p-10 text-center text-sm font-semibold text-slate-400">No trend data available.</div>
        ) : (
          <RoDayWiseTrendChart trendData={d.trend} dailyTarget={dailyTarget} kpiStats={kpiStats} />
        )}
      </div>

      {/* Location-wise breakdown */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3"><p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Location-wise breakdown</p></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-5 py-2.5 text-left">Location</th>
                <th className="px-5 py-2.5 text-right">Billing</th>
                <th className="px-5 py-2.5 text-right">RO Count</th>
                <th className="px-5 py-2.5 text-right">Labour</th>
                <th className="px-5 py-2.5 text-right">Parts</th>
                <th className="px-5 py-2.5 text-right">Growth</th>
              </tr>
            </thead>
            <tbody>
              {d.locations.map((loc) => (
                <tr key={loc.dealer} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 text-left font-black text-slate-800">{loc.label}</td>
                  <td className="px-5 py-3 text-right font-black text-slate-900">{formatCurrency(loc.billing)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatInt(loc.roCount)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatCurrency(loc.labour)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatCurrency(loc.parts)}</td>
                  <td className="px-5 py-3 text-right"><GrowthPill value={loc.growth} /></td>
                </tr>
              ))}
              {d.locations.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-[12px] font-semibold text-slate-400">No location data.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function BigKpi({ 
  icon, 
  label, 
  value, 
  tone, 
  sub, 
  comparison 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  tone: string; 
  sub?: string;
  comparison?: { lyValue: string; growth: number | null } 
}) {
  return (
    <div className={cn('rounded-2xl bg-gradient-to-br p-5 text-white shadow-md flex flex-col justify-between min-h-[128px]', tone)}>
      <div>
        <div className="flex items-center gap-1.5 opacity-90">{icon}<span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
        <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
        {sub && <p className="mt-1 text-[11px] font-semibold opacity-80">{sub}</p>}
      </div>
      {comparison && (
        <div className="mt-3 flex items-center justify-between border-t border-white/20 pt-2.5 text-[10px] font-black uppercase tracking-wider">
          <span className="opacity-95">LY: {comparison.lyValue}</span>
          {comparison.growth !== null ? (
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[9px] font-black',
              comparison.growth >= 0 ? 'bg-emerald-500/20 text-emerald-100' : 'bg-rose-500/20 text-rose-100'
            )}>
              {comparison.growth >= 0 ? '+' : ''}{comparison.growth.toFixed(1)}%
            </span>
          ) : (
            <span className="opacity-60">No LY data</span>
          )}
        </div>
      )}
    </div>
  )
}

function GrowthPill({ value }: { value: number | null }) {
  if (value === null) return <span className="inline-flex items-center gap-1 text-[12px] font-bold text-slate-400"><MinusCircle className="h-3.5 w-3.5" /> —</span>
  const up = value >= 0
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-black', up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}
