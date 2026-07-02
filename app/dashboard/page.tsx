'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  IndianRupee,
  Wrench,
  Activity,
  Sparkles,
  RefreshCw,
  Car,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

// ─── Brand config ────────────────────────────────────────────────────────────

const BRANDS = [
  {
    id: 'hyundai' as const,
    label: 'Hyundai',
    color: '#0052cc',
    gradient: ['#0052cc', '#00a8e8'],
    apiPath: '/api/brands/hyundai/business-excellence/overview',
  },
  {
    id: 'kia' as const,
    label: 'Kia',
    color: '#c8102e',
    gradient: ['#c8102e', '#ff4f6e'],
    apiPath: '/api/brands/kia/business-excellence/overview',
  },
  {
    id: 'platinum' as const,
    label: 'Platinum',
    color: '#7c3aed',
    gradient: ['#7c3aed', '#a78bfa'],
    apiPath: '/api/brands/platinum/business-excellence/overview',
  },
]

type BrandId = 'hyundai' | 'kia' | 'platinum'

// ─── Real API types (from business-excellence-overview.tsx) ──────────────────

type ComparisonMetric = {
  cy: number
  ly: number
  deltaPct: number | null
  comparisonStatus?: string
  comparisonLabel?: string | null
}

type WorkshopSnapshot = {
  totalJc: number
  labourAmount: number
  partsAmount: number
  totalRevenue: number
  vasAmount: number
  labourPerRo: number
  serviceMix?: Array<{
    name: string
    totalJc: number
    labourAmount: number
    partsAmount: number
    totalRevenue: number
  }>
}

type OverviewData = {
  asOfDate?: string
  dateRange?: { startDate: string; endDate: string }
  kpis?: {
    revenue: number
    labour: number
    parts: number
    totalJc: number
    avgBilling: number
    openRo: number
    delayedRo: number
    openOver15: number
    avgOpenAging: number
    complaintsTotal: number
    complaintsOpen: number
    complaintsOver15: number
    ewCount: number
    rsaCount: number
    mcpCount: number
    addOnPerJc: number
  }
  comparison?: {
    revenue?: ComparisonMetric
    totalJc?: ComparisonMetric
    openRo?: ComparisonMetric
    workshopVasAmount?: ComparisonMetric
    addOnTotal?: ComparisonMetric
    ewCount?: ComparisonMetric
    rsaCount?: ComparisonMetric
    mcpCount?: ComparisonMetric
    workshopRevenue?: ComparisonMetric
    workshopTotalJc?: ComparisonMetric
  }
  workshopSnapshot?: WorkshopSnapshot
  charts?: {
    revenueTrend?: Array<{ date: string | null; label: string; revenue: number; totalJc: number }>
    serviceMix?: Array<{ name: string; totalJc: number; revenue: number }>
    advisorRevenue?: Array<{ advisor: string; totalJc: number; revenue: number }>
    agingDistribution?: Array<{ bucket: string; count: number }>
    addOnMix?: Array<{ name: string; value: number }>
    openRoWorkType?: Array<{ name: string; value: number }>
  }
  insights?: Array<{ label: string; value: string; context: string; tone: string }>
}

interface BrandState {
  data: OverviewData | null
  loading: boolean
  error: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateStr(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function currentMonthRange() {
  const today = new Date()
  return {
    startDate: toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: toDateStr(today),
  }
}

function fmtCurrency(value: number) {
  const v = Math.round(value)
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`
  return `₹${v.toLocaleString('en-IN')}`
}

function fmtCount(value: number) {
  return Math.round(value).toLocaleString('en-IN')
}

function DeltaBadge({ delta }: { delta: number | null | undefined }) {
  if (delta == null) return null
  const positive = delta >= 0
  const color = positive ? '#16a34a' : '#dc2626'
  const bg = positive ? '#dcfce7' : '#fee2e2'
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
  return (
    <span
      style={{ background: bg, color }}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
    >
      <Icon className="h-3 w-3" />
      {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
    </span>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-slate-100 ${className}`} style={style}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-7 w-28" />
      <Skeleton className="mt-2 h-3 w-24" />
      <Skeleton className="mt-1 h-3 w-20" />
    </div>
  )
}

function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <Skeleton className="mb-1 h-4 w-32" />
      <Skeleton className="mb-5 h-3 w-48" />
      <Skeleton className="w-full rounded-2xl" style={{ height }} />
    </div>
  )
}

function LoadingGrid() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <KpiSkeleton key={i} />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3"><ChartSkeleton height={260} /></div>
        <div className="lg:col-span-2"><ChartSkeleton height={260} /></div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartSkeleton height={220} />
        <ChartSkeleton height={220} />
      </div>
    </div>
  )
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  formatter?: (val: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur-sm">
      {label && <p className="mb-2 text-xs font-semibold text-slate-500">{label}</p>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: p.color }} />
          <span className="font-medium text-slate-700">{p.name}:</span>
          <span className="ml-1 font-bold text-slate-900">
            {formatter ? formatter(Number(p.value ?? 0)) : fmtCount(Number(p.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  delta,
  icon: Icon,
  color,
  sub,
}: {
  label: string
  value: string
  delta?: number | null
  icon: React.ElementType
  color: string
  sub?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="pointer-events-none absolute -right-5 -top-5 h-24 w-24 rounded-full opacity-10" style={{ background: color }} />
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: `${color}18`, color }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <DeltaBadge delta={delta} />
      </div>
      <p className="mt-3 text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// ─── Pie/Donut Colors ─────────────────────────────────────────────────────────

const PIE_COLORS = ['#0052cc', '#c8102e', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#64748b', '#f43f5e']

// ─── Service Mix Donut ────────────────────────────────────────────────────────

function ServiceMixDonut({
  data,
}: {
  data: Array<{ name: string; totalJc: number }>
}) {
  const total = data.reduce((s, d) => s + d.totalJc, 0)
  if (!data.length || total === 0) {
    return <div className="flex h-48 items-center justify-center text-sm text-slate-400">No service data</div>
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-shrink-0">
        <ResponsiveContainer width={150} height={150}>
          <PieChart>
            <Pie
              data={data}
              dataKey="totalJc"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={65}
              strokeWidth={2}
              stroke="#fff"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(val) => [`${fmtCount(Number(val ?? 0))} JC`, '']} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2">
        {data.slice(0, 7).map((d, i) => (
          <div key={d.name} className="flex items-center gap-2 text-[11px]">
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="flex-1 truncate text-slate-600">{d.name}</span>
            <span className="font-bold text-slate-800">{fmtCount(d.totalJc)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Aging Bar ────────────────────────────────────────────────────────────────

function AgingBar({ data, color }: { data: Array<{ bucket: string; count: number }>; color: string }) {
  if (!data.length) return <div className="flex h-44 items-center justify-center text-sm text-slate-400">No aging data</div>
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 0, right: 5, left: -15, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltip formatter={fmtCount} />} />
        <Bar dataKey="count" name="Open RO" fill={color} radius={[5, 5, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Addon Mix ────────────────────────────────────────────────────────────────

function AddonMixChart({ data, color }: { data: Array<{ name: string; value: number }>; color: string }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) return <div className="flex h-44 items-center justify-center text-sm text-slate-400">No add-on data</div>

  const colors = [color, '#0891b2', '#16a34a', '#d97706']
  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={130}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={58} strokeWidth={2} stroke="#fff">
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          <Tooltip formatter={(val) => [fmtCount(Number(val ?? 0)), '']} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-3 gap-2">
        {data.map((d, i) => (
          <div key={d.name} className="rounded-xl p-2 text-center" style={{ background: `${colors[i % colors.length]}15` }}>
            <p className="text-lg font-black" style={{ color: colors[i % colors.length] }}>{fmtCount(d.value)}</p>
            <p className="text-[10px] font-semibold text-slate-500">{d.name}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Multi-brand trend ────────────────────────────────────────────────────────

function MultiBrandRevenueTrend({ states }: { states: Record<BrandId, BrandState> }) {
  const dateMap: Record<string, Record<string, number>> = {}
  for (const brand of BRANDS) {
    const trend = states[brand.id].data?.charts?.revenueTrend ?? []
    for (const row of trend) {
      const d = row.label || row.date?.slice(5) || ''
      if (!dateMap[d]) dateMap[d] = {}
      dateMap[d][brand.label] = Math.round(row.revenue)
    }
  }
  const rows = Object.entries(dateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals }))

  if (rows.length === 0) {
    return <div className="flex h-60 items-center justify-center text-sm text-slate-400">No trend data</div>
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={rows} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
        <defs>
          {BRANDS.map((b) => (
            <linearGradient key={b.id} id={`mbt-grad-${b.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={b.color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={b.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => fmtCurrency(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={68} />
        <Tooltip content={<ChartTooltip formatter={fmtCurrency} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {BRANDS.map((b) => (
          <Area key={b.id} type="monotone" dataKey={b.label} stroke={b.color} strokeWidth={2.5}
            fill={`url(#mbt-grad-${b.id})`} dot={false} activeDot={{ r: 4 }} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── Brand comparison bars ────────────────────────────────────────────────────

function BrandCompareBar({
  states,
  dataKey,
  label,
  formatter,
  valueOf,
}: {
  states: Record<BrandId, BrandState>
  dataKey: string
  label: string
  formatter: (v: number) => string
  valueOf: (d: OverviewData) => number
}) {
  const data = BRANDS.map((b) => ({
    brand: b.label,
    [label]: states[b.id].data ? valueOf(states[b.id].data!) : 0,
    color: b.color,
    loading: states[b.id].loading,
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="brand" tick={{ fontSize: 12, fill: '#475569', fontWeight: 600 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => formatter(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={60} />
        <Tooltip content={<ChartTooltip formatter={formatter} />} />
        <Bar dataKey={label} radius={[8, 8, 0, 0]} maxBarSize={72}>
          {data.map((entry) => (
            <Cell key={entry.brand} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Brand detail panel ───────────────────────────────────────────────────────

function BrandDetailPanel({ brand, state }: { brand: typeof BRANDS[number]; state: BrandState }) {
  if (state.loading) return <LoadingGrid />

  if (state.error) {
    return (
      <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-2xl border border-red-100 bg-red-50 text-center p-6">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm font-semibold text-red-700">Failed to load {brand.label} data</p>
        <p className="text-xs text-red-500">{state.error}</p>
      </div>
    )
  }

  if (!state.data) return null

  const { data } = state
  const kpis = data.kpis
  const comparison = data.comparison
  const ws = data.workshopSnapshot
  const charts = data.charts ?? {}

  // Primary numbers from kpis (plain numbers)
  const revenue = kpis?.revenue ?? 0
  const totalJc = kpis?.totalJc ?? 0
  const openRo = kpis?.openRo ?? 0
  const delayedRo = kpis?.delayedRo ?? 0
  const openOver15 = kpis?.openOver15 ?? 0
  const ewCount = kpis?.ewCount ?? 0
  const rsaCount = kpis?.rsaCount ?? 0
  const mcpCount = kpis?.mcpCount ?? 0

  // VAS from workshopSnapshot
  const vasAmount = ws?.vasAmount ?? 0

  // Deltas from comparison object
  const revenueDelta = comparison?.revenue?.deltaPct ?? null
  const jcDelta = comparison?.totalJc?.deltaPct ?? null
  const openRoDelta = comparison?.openRo?.deltaPct ?? null
  const vasDelta = comparison?.workshopVasAmount?.deltaPct ?? null

  const lyRevenue = comparison?.revenue?.ly ?? 0
  const lyJc = comparison?.totalJc?.ly ?? 0

  // Charts
  const revenueTrend = charts.revenueTrend ?? []
  const serviceMix = charts.serviceMix ?? []
  const agingDist = charts.agingDistribution ?? []
  const addOnMix = charts.addOnMix ?? [
    { name: 'EW', value: ewCount },
    { name: 'RSA', value: rsaCount },
    { name: 'MCP', value: mcpCount },
  ]

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Revenue"
          value={fmtCurrency(revenue)}
          delta={revenueDelta}
          icon={IndianRupee}
          color={brand.color}
          sub={lyRevenue > 0 ? `vs ${fmtCurrency(lyRevenue)} LY` : 'LY comparison pending'}
        />
        <KpiCard
          label="Job Cards Closed"
          value={fmtCount(totalJc)}
          delta={jcDelta}
          icon={Wrench}
          color={brand.color}
          sub={lyJc > 0 ? `vs ${fmtCount(lyJc)} LY` : undefined}
        />
        <KpiCard
          label="Open RO (WIP)"
          value={fmtCount(openRo)}
          delta={openRoDelta}
          icon={Activity}
          color={brand.color}
          sub={`${delayedRo} delayed · ${openOver15} beyond 15d`}
        />
        <KpiCard
          label="VAS Revenue"
          value={fmtCurrency(vasAmount)}
          delta={vasDelta}
          icon={Sparkles}
          color={brand.color}
          sub={`EW ${ewCount} · RSA ${rsaCount} · MCP ${mcpCount}`}
        />
      </div>

      {/* Revenue Trend + Service Mix */}
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Section title="Revenue Trend" subtitle="Daily billing revenue for the selected period">
            {revenueTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={revenueTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`detail-grad-${brand.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={brand.color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={brand.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => fmtCurrency(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={68} />
                  <Tooltip content={<ChartTooltip formatter={fmtCurrency} />} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={brand.color}
                    strokeWidth={2.5}
                    fill={`url(#detail-grad-${brand.id})`}
                    dot={false}
                    activeDot={{ r: 5, fill: brand.color }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-slate-400">No daily trend data for this period</div>
            )}
          </Section>
        </div>
        <div className="lg:col-span-2">
          <Section title="Service Mix" subtitle="Job cards by service category">
            <ServiceMixDonut data={serviceMix} />
          </Section>
        </div>
      </div>

      {/* Open RO Aging + VAS */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Open RO Aging" subtitle="Current WIP distribution by age bucket">
          <AgingBar data={agingDist} color={brand.color} />
          {(openRo > 0) && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-xl font-black text-slate-700">{fmtCount(openRo)}</p>
                <p className="text-[10px] font-semibold text-slate-400">Total Open</p>
              </div>
              <div className="rounded-xl bg-orange-50 p-3 text-center">
                <p className="text-xl font-black text-orange-600">{fmtCount(delayedRo)}</p>
                <p className="text-[10px] font-semibold text-orange-400">Delayed</p>
              </div>
              <div className="rounded-xl bg-red-50 p-3 text-center">
                <p className="text-xl font-black text-red-600">{fmtCount(openOver15)}</p>
                <p className="text-[10px] font-semibold text-red-400">&gt;15 Days</p>
              </div>
            </div>
          )}
        </Section>
        <Section title="VAS / Add-on Sales" subtitle="Extended Warranty · RSA · MCP breakdown">
          <AddonMixChart data={addOnMix} color={brand.color} />
        </Section>
      </div>

      {/* Revenue by service category */}
      {serviceMix.length > 0 && serviceMix.some((r) => r.revenue > 0) && (
        <Section title="Revenue by Service Category" subtitle="Billing revenue breakdown by service type">
          <ResponsiveContainer width="100%" height={Math.min(serviceMix.length * 36 + 20, 260)}>
            <BarChart
              data={serviceMix.slice(0, 8)}
              layout="vertical"
              margin={{ top: 0, right: 20, left: 5, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => fmtCurrency(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={false} width={115} />
              <Tooltip content={<ChartTooltip formatter={fmtCurrency} />} />
              <Bar dataKey="revenue" name="Revenue" fill={brand.color} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [activeBrand, setActiveBrand] = useState<BrandId>('hyundai')
  const [states, setStates] = useState<Record<BrandId, BrandState>>({
    hyundai: { data: null, loading: true, error: null },
    kia: { data: null, loading: true, error: null },
    platinum: { data: null, loading: true, error: null },
  })
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const fetchBrand = useCallback(async (brand: typeof BRANDS[number]) => {
    const { startDate, endDate } = currentMonthRange()
    // chunk=secondary returns kpis + comparison + workshopSnapshot + charts
    const url = `${brand.apiPath}?startDate=${startDate}&endDate=${endDate}&chunk=secondary`

    setStates((prev) => ({
      ...prev,
      [brand.id]: { ...prev[brand.id], loading: true, error: null },
    }))

    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: OverviewData = await res.json()
      setStates((prev) => ({
        ...prev,
        [brand.id]: { data: json, loading: false, error: null },
      }))
    } catch (e) {
      setStates((prev) => ({
        ...prev,
        [brand.id]: {
          data: prev[brand.id].data,
          loading: false,
          error: e instanceof Error ? e.message : 'Failed to load',
        },
      }))
    }
  }, [])

  const fetchAll = useCallback(() => {
    setLastRefreshed(new Date())
    BRANDS.forEach((b) => fetchBrand(b))
  }, [fetchBrand])

  useEffect(() => { fetchAll() }, [fetchAll])

  const activeBrandConfig = BRANDS.find((b) => b.id === activeBrand)!
  const isAnyLoading = BRANDS.some((b) => states[b.id].loading)

  const totalRevenue = BRANDS.reduce((s, b) => s + (states[b.id].data?.kpis?.revenue ?? 0), 0)
  const totalJc = BRANDS.reduce((s, b) => s + (states[b.id].data?.kpis?.totalJc ?? 0), 0)
  const totalOpenRo = BRANDS.reduce((s, b) => s + (states[b.id].data?.kpis?.openRo ?? 0), 0)
  const totalVas = BRANDS.reduce((s, b) => s + (states[b.id].data?.workshopSnapshot?.vasAmount ?? 0), 0)

  const { startDate, endDate } = currentMonthRange()

  const groupSummaryItems = [
    { label: 'Group Revenue (MTD)', value: fmtCurrency(totalRevenue), icon: IndianRupee, color: '#0052cc' },
    { label: 'Total Job Cards', value: fmtCount(totalJc), icon: Wrench, color: '#c8102e' },
    { label: 'Total Open RO', value: fmtCount(totalOpenRo), icon: Activity, color: '#7c3aed' },
    { label: 'Group VAS Revenue', value: fmtCurrency(totalVas), icon: Sparkles, color: '#0891b2' },
  ]

  return (
    <MainLayout title="Operations Analytics" subtitle="Repair Orders · RO Billing · VAS — All Brands">
      {/* shimmer keyframe */}
      <style>{`
        @keyframes shimmer { 100% { transform: translateX(200%); } }
      `}</style>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Group Performance Overview</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {startDate} — {endDate} &nbsp;·&nbsp; Hyundai · Kia · Platinum
            </p>
          </div>
          <button
            onClick={fetchAll}
            disabled={isAnyLoading}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
          >
            {isAnyLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {/* Group summary strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {groupSummaryItems.map((item, i) =>
            isAnyLoading && totalRevenue === 0
              ? <KpiSkeleton key={i} />
              : <KpiCard key={item.label} label={item.label} value={item.value} icon={item.icon} color={item.color} />
          )}
        </div>

        {/* Cross-brand comparison */}
        <div className="grid gap-5 lg:grid-cols-3">
          <Section title="Revenue by Brand" subtitle="Current month total billing">
            {isAnyLoading && totalRevenue === 0
              ? <Skeleton className="h-48 w-full" />
              : <BrandCompareBar
                  states={states}
                  dataKey="revenue"
                  label="Revenue"
                  formatter={fmtCurrency}
                  valueOf={(d) => d.kpis?.revenue ?? 0}
                />
            }
          </Section>
          <Section title="Job Cards by Brand" subtitle="Closed ROs this month">
            {isAnyLoading && totalJc === 0
              ? <Skeleton className="h-48 w-full" />
              : <BrandCompareBar
                  states={states}
                  dataKey="totalJc"
                  label="Job Cards"
                  formatter={fmtCount}
                  valueOf={(d) => d.kpis?.totalJc ?? 0}
                />
            }
          </Section>
          <Section title="Combined Revenue Trend" subtitle="Daily billing — all brands">
            {isAnyLoading
              ? <Skeleton className="h-48 w-full" />
              : <MultiBrandRevenueTrend states={states} />
            }
          </Section>
        </div>

        {/* Brand drill-down */}
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 shadow-sm">
          {/* Tabs */}
          <div className="flex border-b border-slate-100 bg-white px-4 pt-3">
            {BRANDS.map((b) => {
              const isActive = activeBrand === b.id
              return (
                <button
                  key={b.id}
                  onClick={() => setActiveBrand(b.id)}
                  className="relative flex items-center gap-2 rounded-t-xl px-5 py-2.5 text-sm font-bold transition-colors"
                  style={{
                    color: isActive ? b.color : '#64748b',
                    borderBottom: isActive ? `2.5px solid ${b.color}` : '2.5px solid transparent',
                    background: isActive ? '#f8fafc' : 'transparent',
                  }}
                >
                  <Car className="h-4 w-4" />
                  {b.label}
                  {states[b.id].loading && <Loader2 className="h-3 w-3 animate-spin opacity-60" />}
                  {states[b.id].error && !states[b.id].loading && (
                    <AlertCircle className="h-3 w-3 text-red-400" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Brand content */}
          <div className="p-5">
            <BrandDetailPanel brand={activeBrandConfig} state={states[activeBrand]} />
          </div>
        </div>

        {/* Footer */}
        {lastRefreshed && (
          <p className="text-center text-xs text-slate-400">
            Last refreshed: {lastRefreshed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        )}
      </div>
    </MainLayout>
  )
}
