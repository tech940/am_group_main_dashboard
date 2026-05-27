'use client'

import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Gauge,
  Maximize2,
  MessageSquareWarning,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wrench,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer as RechartsResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'
import { cn } from '@/lib/utils'

function ResponsiveContainer(props: React.ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

type BusinessDateFilter = {
  mode: 'month' | 'range'
  month: number
  year: number
  startDate: string
  endDate: string
} | null

type OverviewData = {
  asOfDate: string
  dateRange: { startDate: string; endDate: string }
  kpis: {
    revenue: number
    labour: number
    parts: number
    totalJc: number
    avgBilling: number
    openRo: number
    delayedRo: number
    openOver15: number
    avgOpenAging: number
    accidentOpenJobs: number
    complaintsTotal: number
    complaintsOpen: number
    complaintsClosed: number
    complaintsOver15: number
    avgComplaintDays: number
    ewCount: number
    rsaCount: number
    mcpCount: number
    rsaAmount: number
    delayedRoPct: number
    agedRoPct: number
    complaintOpenPct: number
    addOnPerJc: number
  }
  charts: {
    revenueTrend: Array<{ date: string | null; label: string; revenue: number; totalJc: number }>
    serviceMix: Array<{ name: string; totalJc: number; revenue: number }>
    advisorRevenue: Array<{ advisor: string; totalJc: number; revenue: number }>
    agingDistribution: Array<{ bucket: string; count: number }>
    openRoAdvisorLoad: Array<{ advisor: string; openRo: number; avgAging: number }>
    openRoWorkType: Array<{ name: string; value: number }>
    complaintAreas: Array<{ name: string; total: number; open: number; avgDays: number }>
    complaintStatus: Array<{ status: string; count: number }>
    complaintMonthlyComparison: Array<{ month: string; monthNo: number; cyCount: number; lyCount: number; growthPct: number }>
    addOnMix: Array<{ name: string; value: number }>
  }
  insights: Array<{
    label: string
    value: string
    context: string
    tone: 'good' | 'watch' | 'risk' | 'neutral'
  }>
  meta: {
    cacheTtlSeconds: number
    sourceCoverage?: {
      roBilling?: { minDate: string | null; maxDate: string | null }
      openRo?: { minDate: string | null; maxDate: string | null }
      complaints?: { minDate: string | null; maxDate: string | null }
    }
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const CHART_COLORS = ['#0f766e', '#2563eb', '#f97316', '#e11d48', '#7c3aed', '#0891b2']
const tooltipStyle = {
  borderRadius: 16,
  border: '1px solid #e2e8f0',
  boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
  fontWeight: 800,
} as const

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isInputDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function getDateRange(dateFilter: BusinessDateFilter) {
  const today = new Date()
  if (dateFilter?.mode === 'range' && isInputDate(dateFilter.startDate) && isInputDate(dateFilter.endDate)) {
    return { startDate: dateFilter.startDate, endDate: dateFilter.endDate }
  }

  if (
    dateFilter?.mode === 'month'
    && Number.isInteger(dateFilter.month)
    && dateFilter.month >= 0
    && dateFilter.month <= 11
    && Number.isInteger(dateFilter.year)
  ) {
    const monthStart = new Date(dateFilter.year, dateFilter.month, 1)
    const monthEnd = dateFilter.year === today.getFullYear() && dateFilter.month === today.getMonth()
      ? today
      : new Date(dateFilter.year, dateFilter.month + 1, 0)
    return { startDate: toInputDate(monthStart), endDate: toInputDate(monthEnd) }
  }

  return {
    startDate: toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: toInputDate(today),
  }
}

function formatCurrency(value: number) {
  const rounded = Math.round(Number.isFinite(value) ? value : 0)
  if (Math.abs(rounded) >= 10000000) return `Rs ${(rounded / 10000000).toFixed(1)}Cr`
  if (Math.abs(rounded) >= 100000) return `Rs ${(rounded / 100000).toFixed(1)}L`
  return `Rs ${rounded.toLocaleString('en-IN')}`
}

function formatNumber(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-IN')
}

function formatCompact(value: number) {
  const num = Number.isFinite(value) ? value : 0
  if (Math.abs(num) >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`
  if (Math.abs(num) >= 100000) return `${(num / 100000).toFixed(1)}L`
  if (Math.abs(num) >= 1000) return `${(num / 1000).toFixed(1)}K`
  return Math.round(num).toLocaleString('en-IN')
}

function formatDisplayDate(value?: string | null) {
  if (!value) return 'No data'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function toneClass(tone: string) {
  if (tone === 'good') return 'border-emerald-100 bg-emerald-50 text-emerald-800'
  if (tone === 'risk') return 'border-rose-100 bg-rose-50 text-rose-800'
  if (tone === 'watch') return 'border-amber-100 bg-amber-50 text-amber-800'
  return 'border-slate-100 bg-slate-50 text-slate-700'
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="h-40 animate-pulse rounded-[1.5rem] bg-slate-100" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded-[1.25rem] bg-slate-100" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-80 animate-pulse rounded-[1.5rem] bg-slate-100" />)}
      </div>
    </div>
  )
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub: string
  tone?: 'good' | 'watch' | 'risk' | 'neutral'
}) {
  return (
    <div className={cn('rounded-[1.25rem] border p-4 shadow-sm', toneClass(tone))}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/75 shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-xs font-bold leading-5 opacity-80">{sub}</p>
    </div>
  )
}

function ChartShell({
  eyebrow,
  title,
  children,
  onExpand,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
  onExpand: () => void
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">{eyebrow}</p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{title}</h3>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onExpand}
          className="h-9 w-9 rounded-xl border border-teal-200 bg-white text-teal-700 shadow-sm hover:bg-teal-50"
          title={`Maximise ${title}`}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="h-72 min-h-0 rounded-2xl bg-slate-50 p-3">{children}</div>
    </div>
  )
}

export function BusinessExcellenceOverview({ dateFilter }: { dateFilter: BusinessDateFilter }) {
  const [expandedChart, setExpandedChart] = useState<{ id: string; title: string } | null>(null)
  const range = useMemo(() => getDateRange(dateFilter), [dateFilter])
  const queryString = useMemo(() => new URLSearchParams(range).toString(), [range])

  const { data, isLoading, error } = useQuery<OverviewData, Error>({
    queryKey: ['business-excellence', 'overview', queryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/business-excellence/overview?${queryString}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to load Business Excellence overview')
      return payload as OverviewData
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  })

  const rangeLabel = useMemo(() => {
    if (dateFilter?.mode === 'month') return `${MONTHS[dateFilter.month]} ${dateFilter.year}`
    return `${range.startDate} to ${range.endDate}`
  }, [dateFilter, range.endDate, range.startDate])

  const renderChart = (chartId: string) => {
    if (!data) return null

    if (chartId === 'revenue') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.charts.revenueTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis yAxisId="left" tickFormatter={formatCompact} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fontWeight: 800, fill: '#0f766e' }} />
            <Tooltip formatter={(value, name) => [name === 'revenue' ? formatCurrency(Number(value || 0)) : formatNumber(Number(value || 0)), String(name)]} contentStyle={tooltipStyle} />
            <Legend />
            <Area yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" fill="#dbeafe" strokeWidth={3} />
            <Line yAxisId="right" type="monotone" dataKey="totalJc" name="JC" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'serviceMix') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.charts.serviceMix} layout="vertical" margin={{ top: 5, right: 24, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tickFormatter={formatCompact} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fontWeight: 900, fill: '#0f172a' }} />
            <Tooltip formatter={(value, name) => [name === 'revenue' ? formatCurrency(Number(value || 0)) : formatNumber(Number(value || 0)), String(name)]} contentStyle={tooltipStyle} />
            <Legend />
            <Bar dataKey="totalJc" name="JC" fill="#0f766e" radius={[0, 8, 8, 0]} />
            <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[0, 8, 8, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'aging') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.charts.agingDistribution} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fontWeight: 900, fill: '#0f172a' }} />
            <YAxis tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" name="Open RO" radius={[10, 10, 0, 0]}>
              {data.charts.agingDistribution.map((_, index) => <Cell key={index} fill={['#10b981', '#f59e0b', '#f97316', '#e11d48'][index] || '#0f766e'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'complaints') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.charts.complaintAreas} layout="vertical" margin={{ top: 5, right: 24, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis type="category" dataKey="name" width={122} tick={{ fontSize: 10, fontWeight: 900, fill: '#0f172a' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            <Bar dataKey="total" name="Total" fill="#2563eb" radius={[0, 8, 8, 0]} />
            <Bar dataKey="open" name="Open" fill="#e11d48" radius={[0, 8, 8, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'complaintTrend') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.charts.complaintMonthlyComparison} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            <Area type="monotone" dataKey="cyCount" name="Current Year" stroke="#2563eb" fill="#dbeafe" strokeWidth={3} />
            <Area type="monotone" dataKey="lyCount" name="Last Year" stroke="#f97316" fill="#ffedd5" strokeWidth={3} />
          </AreaChart>
        </ResponsiveContainer>
      )
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Pie data={data.charts.addOnMix} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={4}>
            {data.charts.addOnMix.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
          </Pie>
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (isLoading) return <OverviewSkeleton />

  if (error || !data) {
    return (
      <div className="p-4">
        <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          {error?.message || 'Business Excellence overview is not available right now.'}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="overflow-hidden rounded-[1.5rem] border border-teal-100 bg-gradient-to-br from-white via-cyan-50 to-emerald-50 p-5 shadow-sm">
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr] xl:items-end">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-teal-700 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">Default View</span>
              <span className="rounded-full border border-teal-100 bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-700">Unified Analytics</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">Business Excellence Command Center</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
              One operational view across RO billing, workshop performance, open repair orders and customer complaints for {rangeLabel}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-blue-100 bg-white/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-blue-700">
                Billing data through {formatDisplayDate(data.meta.sourceCoverage?.roBilling?.maxDate)}
              </span>
              <span className="rounded-full border border-teal-100 bg-white/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-teal-700">
                Open RO through {formatDisplayDate(data.meta.sourceCoverage?.openRo?.maxDate)}
              </span>
              <span className="rounded-full border border-amber-100 bg-white/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Complaints through {formatDisplayDate(data.meta.sourceCoverage?.complaints?.maxDate)}
              </span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Revenue</p>
              <p className="mt-2 text-xl font-black text-slate-950">{formatCurrency(data.kpis.revenue)}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Open WIP</p>
              <p className="mt-2 text-xl font-black text-slate-950">{formatNumber(data.kpis.openRo)}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Complaints</p>
              <p className="mt-2 text-xl font-black text-slate-950">{formatNumber(data.kpis.complaintsTotal)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={TrendingUp} label="RO Billing" value={formatCurrency(data.kpis.revenue)} sub={`${formatNumber(data.kpis.totalJc)} JC, ${formatCurrency(data.kpis.avgBilling)} avg billing`} tone="good" />
        <KpiCard icon={Wrench} label="Workshop WIP" value={formatNumber(data.kpis.openRo)} sub={`${formatNumber(data.kpis.delayedRo)} delayed, ${formatNumber(data.kpis.openOver15)} beyond 15 days`} tone={data.kpis.delayedRo > 0 ? 'risk' : 'good'} />
        <KpiCard icon={MessageSquareWarning} label="Customer Complaints" value={formatNumber(data.kpis.complaintsTotal)} sub={`${formatNumber(data.kpis.complaintsOpen)} open, ${data.kpis.avgComplaintDays.toFixed(1)}d avg resolution`} tone={data.kpis.complaintsOpen > 0 ? 'watch' : 'good'} />
        <KpiCard icon={ShieldCheck} label="Add-on Coverage" value={formatNumber(data.kpis.ewCount + data.kpis.rsaCount + data.kpis.mcpCount)} sub={`${formatNumber(data.kpis.ewCount)} EW, ${formatNumber(data.kpis.rsaCount)} RSA, ${formatNumber(data.kpis.mcpCount)} MCP`} tone="neutral" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartShell eyebrow="Billing Pulse" title="Revenue and Job Card Trend" onExpand={() => setExpandedChart({ id: 'revenue', title: 'Revenue and Job Card Trend' })}>
          {renderChart('revenue')}
        </ChartShell>
        <ChartShell eyebrow="Service Mix" title="Closed RO Service Composition" onExpand={() => setExpandedChart({ id: 'serviceMix', title: 'Closed RO Service Composition' })}>
          {renderChart('serviceMix')}
        </ChartShell>
        <ChartShell eyebrow="Open RO Control" title="Aging Distribution" onExpand={() => setExpandedChart({ id: 'aging', title: 'Open RO Aging Distribution' })}>
          {renderChart('aging')}
        </ChartShell>
        <ChartShell eyebrow="Customer Voice" title="Complaint Area Pressure" onExpand={() => setExpandedChart({ id: 'complaints', title: 'Complaint Area Pressure' })}>
          {renderChart('complaints')}
        </ChartShell>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <ChartShell eyebrow="Complaints Comparison" title="Current Year vs Last Year" onExpand={() => setExpandedChart({ id: 'complaintTrend', title: 'Complaint Year-Month Comparison' })}>
          {renderChart('complaintTrend')}
        </ChartShell>
        <div className="grid gap-3 md:grid-cols-2">
          {data.insights.map((insight) => (
            <div key={insight.label} className={cn('rounded-[1.25rem] border p-4 shadow-sm', toneClass(insight.tone))}>
              <div className="mb-3 flex items-center gap-2">
                {insight.tone === 'risk' ? <AlertTriangle className="h-4 w-4" /> : insight.tone === 'good' ? <Sparkles className="h-4 w-4" /> : <Gauge className="h-4 w-4" />}
                <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{insight.label}</p>
              </div>
              <p className="text-xl font-black tracking-tight">{insight.value}</p>
              <p className="mt-2 text-xs font-bold leading-5 opacity-80">{insight.context}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Advisor Load</p>
          <div className="mt-3 space-y-2">
            {data.charts.openRoAdvisorLoad.slice(0, 5).map((row) => (
              <div key={row.advisor} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="truncate text-xs font-black text-slate-700">{row.advisor}</span>
                <span className="font-mono text-xs font-black text-slate-950">{formatNumber(row.openRo)} RO</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Add-on Mix</p>
          <div className="mt-2 h-44">{renderChart('addons')}</div>
        </div>
        <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Fast Read</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase text-slate-400">Delayed RO</p>
              <p className="mt-1 text-lg font-black text-rose-600">{data.kpis.delayedRoPct.toFixed(1)}%</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase text-slate-400">Complaint Open</p>
              <p className="mt-1 text-lg font-black text-amber-600">{data.kpis.complaintOpenPct.toFixed(1)}%</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase text-slate-400">Labour</p>
              <p className="mt-1 text-lg font-black text-teal-700">{formatCurrency(data.kpis.labour)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase text-slate-400">Parts</p>
              <p className="mt-1 text-lg font-black text-blue-700">{formatCurrency(data.kpis.parts)}</p>
            </div>
          </div>
        </div>
      </div>

      {expandedChart && (
        <div className="fixed inset-0 z-[90] bg-slate-950/50 p-4 backdrop-blur-sm md:p-6">
          <div className="expanded-chart-shell flex h-full w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl" style={{ backgroundColor: '#ffffff' }}>
            <div className="expanded-chart-header flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3" style={{ backgroundColor: '#ffffff' }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Expanded Business Excellence Chart</p>
                <h3 className="text-xl font-black tracking-tight text-slate-950">{expandedChart.title}</h3>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={() => setExpandedChart(null)} className="h-10 w-10 rounded-xl bg-white">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="expanded-chart-body min-h-0 flex-1 bg-white p-5" style={{ backgroundColor: '#ffffff' }}>
              <div className="expanded-chart-surface h-full rounded-2xl bg-white" style={{ backgroundColor: '#ffffff' }}>
                {renderChart(expandedChart.id)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
