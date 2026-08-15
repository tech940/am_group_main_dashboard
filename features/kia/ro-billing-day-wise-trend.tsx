'use client'

import type { ReactNode } from 'react'
import {
  CartesianGrid, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'

// The KIA RO Billing "Day Wise Trend" section, extracted verbatim from business-excellence-page.tsx
// so it can be reused (RO Billing report + Workshop Summary) instead of duplicated. Pure/presentational:
// give it the already-shaped trendData, dailyTarget and the 7-card kpiStats and it renders identically.

export type RoTrendPoint = { day: string; cy: number; ly: number; target?: number }
export type RoKpiStat = { label: string; value: string; color?: string }

function formatChartLabel(value: unknown) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return ''
  const abs = Math.abs(num)
  if (abs < 0.5) return '0'
  if (abs >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`
  if (abs >= 100000) return `${(num / 100000).toFixed(1)}L`
  if (abs >= 1000) return `${(num / 1000).toFixed(1)}K`
  return Math.round(num).toLocaleString('en-IN')
}

function SmartTrendValueLabel({
  x, y, value, index = 0, series = 'cy',
}: { x?: number | string; y?: number | string; value?: number | string; index?: number; total?: number; series?: 'cy' | 'ly' }) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  const xPos = Number(x || 0)
  const yPos = Number(y || 0) + (series === 'cy' ? (index % 2 === 0 ? -12 : -20) : (index % 2 === 0 ? 16 : 24))
  return (
    <text x={xPos} y={yPos} textAnchor="middle" fill={Math.abs(num) < 0.5 ? '#94a3b8' : series === 'cy' ? '#0B5D7A' : '#D97706'} fontSize={8} fontWeight={900} paintOrder="stroke" stroke="#ffffff" strokeWidth={3}>
      {formatChartLabel(num)}
    </text>
  )
}

function TrendAxisTick({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value?: string } }) {
  const [date = '', day = ''] = String(payload?.value || '').split(' ')
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <text textAnchor="middle" fill="#64748b" fontSize={9} fontWeight={900}>
        <tspan x="0" dy="0">{date}</tspan>
        <tspan x="0" dy="13" fill="#94a3b8" fontSize={8} fontWeight={800}>{day}</tspan>
      </text>
    </g>
  )
}

// (Σ last-year × 1.1) / days — the chart's flat reference line. Matches business-excellence-page.tsx:6803.
export function computeDailyTarget(trendData: RoTrendPoint[]) {
  return trendData.length > 0 ? (trendData.reduce((acc, day) => acc + Number(day.ly || 0), 0) * 1.1) / trendData.length : 0
}

// The 7-card MTD KPI strip (Month Target / MTD Target / MTD Achieved / Shortfall / Monthly Shortfall /
// Projected Closing / Asking Rate). Same formula as business-excellence-page.tsx:6695-6726:
// monthTarget = Σ(ly)×1.1; mtdTarget prorated by elapsed days; projected = run-rate; asking = required pace.
export function computeRoBillingKpiStats(trendData: RoTrendPoint[], opts: { throughDay: number; daysInMonth: number }): RoKpiStat[] {
  const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
  if (trendData.length === 0) {
    return ['Month Target', 'MTD Target', 'MTD Achieved', 'Shortfall T.D', 'Monthly Shortfall', 'Projected Closing', 'Asking Rate']
      .map((label) => ({ label, value: 'N/A', color: label.includes('Shortfall') ? 'text-rose-600' : undefined }))
  }
  const daysInMonth = opts.daysInMonth
  const elapsedDays = Math.min(Math.max(opts.throughDay, 1), daysInMonth)
  const monthTarget = trendData.reduce((acc, d) => acc + Number(d.ly || 0), 0) * 1.1
  const mtdTarget = monthTarget * (elapsedDays / daysInMonth)
  const mtdAchieved = trendData.slice(0, elapsedDays).reduce((acc, d) => acc + Number(d.cy || 0), 0)
  const shortfall = Math.max(mtdTarget - mtdAchieved, 0)
  const projectedClosing = elapsedDays > 0 ? (mtdAchieved / elapsedDays) * daysInMonth : 0
  const monthlyShortfall = Math.max(monthTarget - projectedClosing, 0)
  const remainingDays = daysInMonth - elapsedDays
  const askingRate = remainingDays > 0 ? Math.max(monthTarget - mtdAchieved, 0) / remainingDays : 0
  return [
    { label: 'Month Target', value: fmt(monthTarget) },
    { label: 'MTD Target', value: fmt(mtdTarget) },
    { label: 'MTD Achieved', value: fmt(mtdAchieved) },
    { label: 'Shortfall T.D', value: fmt(shortfall), color: shortfall > 0 ? 'text-rose-600' : 'text-emerald-600' },
    { label: 'Monthly Shortfall', value: fmt(monthlyShortfall), color: monthlyShortfall > 0 ? 'text-rose-600' : 'text-emerald-600' },
    { label: 'Projected Closing', value: fmt(projectedClosing) },
    { label: 'Asking Rate', value: fmt(askingRate), color: askingRate > 0 ? 'text-teal-700' : undefined },
  ]
}

export function RoDayWiseTrendChart({
  trendData, dailyTarget, kpiStats, expandButton,
}: { trendData: RoTrendPoint[]; dailyTarget: number; kpiStats: RoKpiStat[]; expandButton?: ReactNode }) {
  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between gap-4 pr-10">
        <div />
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-[#0B5D7A] bg-white" />
            <span className="text-[10px] font-bold text-slate-600">This Year</span>
          </div>
          <div className="flex items-center gap-2">
            <div aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-amber-600 bg-white" />
            <span className="text-[10px] font-bold text-slate-600">Last Year</span>
          </div>
          <div className="flex items-center gap-2">
            <div aria-hidden="true" className="h-0.5 w-6 bg-rose-400 border-t border-dashed border-rose-600" />
            <span className="text-[10px] font-bold text-slate-600">Target</span>
          </div>
          {expandButton}
        </div>
      </div>

      <div
        id="analysis-day-wise-trend-chart"
        className="h-[350px] w-full"
        role="img"
        aria-label="Day-wise RO billing trend line chart comparing this year against last year, with a daily target reference line"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendData} margin={{ top: 28, right: 28, bottom: 10, left: 18 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={<TrendAxisTick />} tickMargin={12} interval={0} minTickGap={0} height={44} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} width={54} />
            <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }} />
            <ReferenceLine y={dailyTarget} stroke="#f43f5e" strokeDasharray="5 5" label={{ position: 'right', value: 'Target', fill: '#f43f5e', fontSize: 10, fontWeight: 900 }} />
            <Line type="monotone" dataKey="cy" stroke="#0B5D7A" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6, strokeWidth: 0 }}>
              <LabelList dataKey="cy" content={<SmartTrendValueLabel total={trendData.length} series="cy" />} />
            </Line>
            <Line type="monotone" dataKey="ly" stroke="#D97706" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6, strokeWidth: 0 }}>
              <LabelList dataKey="ly" content={<SmartTrendValueLabel total={trendData.length} series="ly" />} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-7 gap-3 mt-10">
        {kpiStats.map((kpi, kIdx) => (
          <div key={kIdx} className="bg-slate-50/50 border border-slate-100 rounded-2xl p-4 text-center shadow-sm">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-2">{kpi.label}</p>
            <p className={cn('text-lg font-black tracking-tight', kpi.color || 'text-slate-800')}>{kpi.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
