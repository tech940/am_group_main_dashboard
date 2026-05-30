'use client'

import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Maximize2,
  MessageSquareWarning,
  ShieldCheck,
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
  LabelList,
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
import { logApiTimings } from '@/lib/api/client-timing'
import { BusinessDateFilterValue, appendBusinessComparisonParams } from '@/lib/business-excellence/comparison'
import { cn } from '@/lib/utils'

function ResponsiveContainer(props: React.ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

type BusinessDateFilter = {
  mode: 'month' | 'range' | 'preset' | 'custom'
  preset?: BusinessDateFilterValue['preset']
  month: number
  year: number
  startDate: string
  endDate: string
  comparison?: BusinessDateFilterValue['comparison']
} | null

type WorkshopSnapshot = {
  totalJc: number
  labourAmount: number
  partsAmount: number
  totalRevenue: number
  vasAmount: number
  labourPerRo: number
  minDate: string | null
  maxDate: string | null
  serviceMix: Array<{
    name: string
    totalJc: number
    labourAmount: number
    partsAmount: number
    totalRevenue: number
    vasAmount: number
  }>
}

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
  comparison?: {
    lyRange: { startDate: string; endDate: string }
    revenue: ComparisonMetric
    labour: ComparisonMetric
    parts: ComparisonMetric
    totalJc: ComparisonMetric
    avgBilling: ComparisonMetric
    openRo: ComparisonMetric
    delayedRo: ComparisonMetric
    openOver15: ComparisonMetric
    complaintsTotal: ComparisonMetric
    complaintsOpen: ComparisonMetric
    complaintsOver15: ComparisonMetric
    addOnTotal: ComparisonMetric
    ewCount: ComparisonMetric
    rsaCount: ComparisonMetric
    mcpCount: ComparisonMetric
    workshopRevenue: ComparisonMetric
    workshopTotalJc: ComparisonMetric
    workshopLabourPerRo: ComparisonMetric
    workshopVasAmount: ComparisonMetric
  }
  workshopSnapshot: WorkshopSnapshot
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
    chunk?: string
    cacheTtlSeconds: number
    sourceCoverage?: {
      roBilling?: { minDate: string | null; maxDate: string | null }
      openRo?: { minDate: string | null; maxDate: string | null }
      complaints?: { minDate: string | null; maxDate: string | null }
      workshopPerformance?: { minDate: string | null; maxDate: string | null }
    }
  }
}

function withChunk(queryString: string, chunk: 'summary' | 'secondary') {
  const params = new URLSearchParams(queryString)
  params.set('chunk', chunk)
  return params.toString()
}

type ComparisonMetric = {
  cy: number
  ly: number
  deltaPct: number
}

const CHART_COLORS = ['#023468', '#2563eb', '#f97316', '#e11d48', '#7c3aed', '#0891b2']
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
  if (dateFilter?.startDate && dateFilter.endDate && isInputDate(dateFilter.startDate) && isInputDate(dateFilter.endDate)) {
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
  if (Math.abs(rounded) >= 10000000) return `Rs ${(rounded / 10000000).toFixed(2)}Cr`
  if (Math.abs(rounded) >= 100000) return `Rs ${(rounded / 100000).toFixed(2)}L`
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

function formatDelta(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0
  const prefix = safeValue > 0 ? '+' : ''
  return `${prefix}${safeValue.toFixed(1)}%`
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
  return 'border-slate-300 bg-white text-slate-700'
}

function deltaClass(deltaPct: number, positiveIsGood = true) {
  const good = positiveIsGood ? deltaPct >= 0 : deltaPct <= 0
  return good ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
}

function comparisonText(metric?: ComparisonMetric, formatter: (value: number) => string = formatNumber) {
  if (!metric) return 'LY loading'
  return `LY ${formatter(metric.ly)}`
}

function deltaText(metric?: ComparisonMetric) {
  if (!metric) return 'vs LY'
  if (metric.ly <= 0 && metric.cy > 0) return 'New vs LY'
  if (metric.ly <= 0 && metric.cy <= 0) return 'No LY data'
  return `${formatDelta(metric.deltaPct)} vs LY`
}

function buildWeeklyBillingTrend(
  rows: OverviewData['charts']['revenueTrend'],
  startDate: string
) {
  const start = new Date(`${startDate}T00:00:00`)
  const groups = new Map<number, {
    index: number
    minDate: string
    maxDate: string
    revenue: number
    totalJc: number
  }>()

  rows.forEach((row) => {
    if (!row.date) return
    const date = new Date(`${row.date}T00:00:00`)
    if (Number.isNaN(date.getTime()) || Number.isNaN(start.getTime())) return

    const diffDays = Math.max(0, Math.floor((date.getTime() - start.getTime()) / 86400000))
    const index = Math.floor(diffDays / 7)
    const existing = groups.get(index)

    if (existing) {
      existing.minDate = row.date < existing.minDate ? row.date : existing.minDate
      existing.maxDate = row.date > existing.maxDate ? row.date : existing.maxDate
      existing.revenue += row.revenue
      existing.totalJc += row.totalJc
      return
    }

    groups.set(index, {
      index,
      minDate: row.date,
      maxDate: row.date,
      revenue: row.revenue,
      totalJc: row.totalJc,
    })
  })

  return Array.from(groups.values())
    .sort((a, b) => a.index - b.index)
    .map((group) => ({
      label: group.minDate === group.maxDate
        ? formatDisplayDate(group.minDate)
        : `${formatDisplayDate(group.minDate)} - ${formatDisplayDate(group.maxDate)}`,
      revenue: group.revenue,
      totalJc: group.totalJc,
    }))
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

function SnapshotTile({
  icon: Icon,
  label,
  value,
  meta,
  comparison,
  positiveIsGood = true,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  meta: string
  comparison?: {
    lyText: string
    deltaText: string
    deltaPct: number
  }
  positiveIsGood?: boolean
  tone?: 'good' | 'watch' | 'risk' | 'neutral'
}) {
  return (
    <div className={cn('min-h-[104px] rounded-xl border p-4 shadow-sm', toneClass(tone))}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-[10px] font-black uppercase tracking-widest opacity-65">{label}</p>
            <span className="text-slate-300">...</span>
          </div>
          <p className="mt-2 text-2xl font-black leading-none tracking-tight">{value}</p>
          <p className="mt-2 truncate text-[11px] font-black opacity-75">{meta}</p>
        </div>
      </div>
      {comparison && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider shadow-sm">
          <span className="truncate opacity-75">{comparison.lyText}</span>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5',
            comparison.deltaText === 'No LY data' || comparison.deltaText === 'Insufficient history'
              ? 'bg-slate-100 text-slate-500'
              : deltaClass(comparison.deltaPct, positiveIsGood)
          )}>
            {comparison.deltaText}
          </span>
        </div>
      )}
    </div>
  )
}

function ChartShell({
  eyebrow,
  title,
  caption,
  children,
  onExpand,
}: {
  eyebrow: string
  title: string
  caption?: string
  children: React.ReactNode
  onExpand: () => void
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">{eyebrow}</p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{title}</h3>
          {caption && <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{caption}</p>}
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
  const queryString = useMemo(() => {
    const params = new URLSearchParams(range)
    appendBusinessComparisonParams(params, dateFilter)
    return params.toString()
  }, [dateFilter, range])
  const summaryQueryString = useMemo(() => withChunk(queryString, 'summary'), [queryString])
  const secondaryQueryString = useMemo(() => withChunk(queryString, 'secondary'), [queryString])

  const { data: summaryData, isLoading, error } = useQuery<OverviewData, Error>({
    queryKey: ['business-excellence', 'overview', summaryQueryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/business-excellence/overview?${summaryQueryString}`)
      logApiTimings(response, 'business-excellence-overview')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to load Business Excellence overview')
      return payload as OverviewData
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  })

  const { data: secondaryData } = useQuery<OverviewData, Error>({
    queryKey: ['business-excellence', 'overview', secondaryQueryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/business-excellence/overview?${secondaryQueryString}`)
      logApiTimings(response, 'business-excellence-overview-secondary')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to load Business Excellence overview details')
      return payload as OverviewData
    },
    enabled: Boolean(summaryData),
    staleTime: DASHBOARD_STALE_TIME_MS,
  })

  const data = useMemo<OverviewData | undefined>(() => {
    if (!summaryData) return undefined
    if (!secondaryData) return summaryData

    return {
      ...summaryData,
      comparison: secondaryData.comparison || summaryData.comparison,
      charts: {
        ...summaryData.charts,
        revenueTrend: secondaryData.charts.revenueTrend,
        serviceMix: secondaryData.charts.serviceMix,
        advisorRevenue: secondaryData.charts.advisorRevenue,
        agingDistribution: secondaryData.charts.agingDistribution,
        openRoAdvisorLoad: secondaryData.charts.openRoAdvisorLoad,
        openRoWorkType: secondaryData.charts.openRoWorkType,
        complaintAreas: secondaryData.charts.complaintAreas,
        complaintStatus: secondaryData.charts.complaintStatus,
        complaintMonthlyComparison: secondaryData.charts.complaintMonthlyComparison,
      },
      meta: {
        ...summaryData.meta,
        ...secondaryData.meta,
        sourceCoverage: {
          ...summaryData.meta.sourceCoverage,
          ...secondaryData.meta.sourceCoverage,
        },
      },
    }
  }, [summaryData, secondaryData])

  const renderChart = (chartId: string) => {
    if (!data) return null

    if (chartId === 'revenue') {
      const weeklyBillingTrend = buildWeeklyBillingTrend(data.charts.revenueTrend, range.startDate)

      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={weeklyBillingTrend} margin={{ top: 26, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" interval={0} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis yAxisId="left" tickFormatter={formatCompact} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fontWeight: 800, fill: '#023468' }} />
            <Tooltip
              formatter={(value, name) => [
                name === 'Revenue'
                  ? formatCurrency(Number(value || 0))
                  : formatNumber(Number(value || 0)),
                String(name),
              ]}
              contentStyle={tooltipStyle}
            />
            <Legend />
            <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#2563eb" radius={[10, 10, 0, 0]} maxBarSize={62} isAnimationActive={false}>
              <LabelList dataKey="revenue" position="top" formatter={(value) => formatCompact(Number(value || 0))} fill="#2563eb" fontSize={10} fontWeight={900} />
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="totalJc" name="Closed RO" stroke="#023468" strokeWidth={3} dot={{ r: 4, fill: '#ffffff', strokeWidth: 2 }} isAnimationActive={false}>
              <LabelList dataKey="totalJc" position="top" offset={10} formatter={(value) => formatNumber(Number(value || 0))} fill="#023468" fontSize={10} fontWeight={900} />
            </Line>
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
            <Bar dataKey="totalJc" name="JC" fill="#023468" radius={[0, 8, 8, 0]} />
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
              {data.charts.agingDistribution.map((_, index) => <Cell key={index} fill={['#10b981', '#f59e0b', '#f97316', '#e11d48'][index] || '#023468'} />)}
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

  const addonTotal = data.kpis.ewCount + data.kpis.rsaCount + data.kpis.mcpCount
  const hasWorkshopRisk = data.kpis.delayedRo > 0 || data.kpis.openOver15 > 0
  const hasComplaintRisk = data.kpis.complaintsOpen > 0
  const latestBillingDate = formatDisplayDate(data.meta.sourceCoverage?.roBilling?.maxDate)
  const latestOpenRoDate = formatDisplayDate(data.meta.sourceCoverage?.openRo?.maxDate)
  const latestComplaintDate = formatDisplayDate(data.meta.sourceCoverage?.complaints?.maxDate)
  const latestWorkshopDate = formatDisplayDate(data.meta.sourceCoverage?.workshopPerformance?.maxDate || data.workshopSnapshot.maxDate)
  const periodLabel = `${formatDisplayDate(range.startDate)} - ${formatDisplayDate(range.endDate)}`
  const lyPeriodLabel = data.comparison
    ? `${formatDisplayDate(data.comparison.lyRange.startDate)} - ${formatDisplayDate(data.comparison.lyRange.endDate)}`
    : 'Loading LY'
  const priorityTotal = data.kpis.delayedRo + data.kpis.openOver15 + data.kpis.complaintsOpen
  const topWorkshopServices = data.workshopSnapshot.serviceMix.slice(0, 3)

  return (
    <div className="space-y-4 p-4">
      <section className="rounded-[1.5rem] border border-[#b9ccde] bg-white/85 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-teal-700 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">MD View</span>
              <span className="rounded-full border border-teal-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-700">CY {periodLabel}</span>
              <span className="rounded-full border border-blue-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-700">LY {lyPeriodLabel}</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">Business Snapshot</h2>
          </div>
          <div className="grid gap-2 text-[9px] font-black uppercase tracking-widest sm:grid-cols-4">
            <span className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-blue-700">Billing {latestBillingDate}</span>
            <span className="rounded-xl border border-cyan-100 bg-white px-3 py-2 text-cyan-700">Workshop {latestWorkshopDate}</span>
            <span className="rounded-xl border border-teal-100 bg-white px-3 py-2 text-teal-700">Open RO {latestOpenRoDate}</span>
            <span className="rounded-xl border border-amber-100 bg-white px-3 py-2 text-amber-700">Complaints {latestComplaintDate}</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SnapshotTile
              icon={TrendingUp}
              label="Billing"
              value={formatCurrency(data.kpis.revenue)}
              meta={`${formatNumber(data.kpis.totalJc)} closed RO`}
              comparison={{
                lyText: comparisonText(data.comparison?.revenue, formatCurrency),
                deltaText: deltaText(data.comparison?.revenue),
                deltaPct: data.comparison?.revenue.deltaPct || 0,
              }}
              tone="good"
            />
          <SnapshotTile
              icon={ShieldCheck}
              label="Avg Billing"
              value={formatCurrency(data.kpis.avgBilling)}
              meta={`${formatCurrency(data.kpis.labour)} labour`}
              comparison={{
                lyText: comparisonText(data.comparison?.avgBilling, formatCurrency),
                deltaText: deltaText(data.comparison?.avgBilling),
                deltaPct: data.comparison?.avgBilling.deltaPct || 0,
              }}
              tone="neutral"
            />
          <SnapshotTile
              icon={Wrench}
              label="Workshop WIP"
              value={formatNumber(data.kpis.openRo)}
              meta={`${formatNumber(data.kpis.delayedRo)} delayed / ${formatNumber(data.kpis.openOver15)} over 15D`}
              comparison={{
                lyText: 'Historical comparison disabled',
                deltaText: 'Insufficient history',
                deltaPct: 0,
              }}
              positiveIsGood={false}
              tone={hasWorkshopRisk ? 'risk' : 'good'}
            />
          <SnapshotTile
              icon={MessageSquareWarning}
              label="Complaints"
              value={formatNumber(data.kpis.complaintsTotal)}
              meta={`${formatNumber(data.kpis.complaintsOpen)} open / ${data.kpis.avgComplaintDays.toFixed(1)}D avg`}
              comparison={{
                lyText: comparisonText(data.comparison?.complaintsTotal),
                deltaText: deltaText(data.comparison?.complaintsTotal),
                deltaPct: data.comparison?.complaintsTotal.deltaPct || 0,
              }}
              positiveIsGood={false}
              tone={hasComplaintRisk ? 'watch' : 'good'}
            />
        </div>

        <div className="mt-3 rounded-xl border border-cyan-100 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-700">Workshop Snapshot</p>
              <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">Performance from closed workshop jobs</h3>
            </div>
            <span className="rounded-full bg-cyan-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-700">
              Through {latestWorkshopDate}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Workshop JC</p>
              <p className="mt-2 text-2xl font-black leading-none text-slate-950">{formatNumber(data.workshopSnapshot.totalJc)}</p>
              <p className="mt-2 text-[10px] font-black uppercase tracking-wider text-slate-500">{deltaText(data.comparison?.workshopTotalJc)}</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Workshop Revenue</p>
              <p className="mt-2 text-2xl font-black leading-none text-blue-800">{formatCurrency(data.workshopSnapshot.totalRevenue)}</p>
              <p className="mt-2 text-[10px] font-black uppercase tracking-wider text-blue-700">{comparisonText(data.comparison?.workshopRevenue, formatCurrency)}</p>
            </div>
            <div className="rounded-xl bg-teal-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Labour / RO</p>
              <p className="mt-2 text-2xl font-black leading-none text-teal-800">{formatCurrency(data.workshopSnapshot.labourPerRo)}</p>
              <p className="mt-2 text-[10px] font-black uppercase tracking-wider text-teal-700">{deltaText(data.comparison?.workshopLabourPerRo)}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">VAS Amount</p>
              <p className="mt-2 text-2xl font-black leading-none text-amber-800">{formatCurrency(data.workshopSnapshot.vasAmount)}</p>
              <p className="mt-2 text-[10px] font-black uppercase tracking-wider text-amber-700">{comparisonText(data.comparison?.workshopVasAmount, formatCurrency)}</p>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 bg-white">
            <div className="grid grid-cols-[minmax(0,1.4fr)_88px_120px] bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <span>Service Type</span>
              <span className="text-right">Job Cards</span>
              <span className="text-right">Revenue</span>
            </div>
            {topWorkshopServices.length ? topWorkshopServices.map((row) => (
              <div key={row.name} className="grid grid-cols-[minmax(0,1.4fr)_88px_120px] items-center gap-3 border-t border-slate-100 px-3 py-2.5">
                <span className="truncate text-xs font-black text-slate-800" title={row.name}>{row.name}</span>
                <span className="text-right font-mono text-xs font-black text-slate-700">{formatNumber(row.totalJc)}</span>
                <span className="text-right font-mono text-xs font-black text-slate-950">{formatCurrency(row.totalRevenue)}</span>
              </div>
            )) : (
              <div className="border-t border-slate-100 px-3 py-3 text-xs font-black text-slate-500">
                No workshop performance rows match the selected period.
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Billing Trend</p>
                <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">Weekly Billing And Closed RO</h3>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={() => setExpandedChart({ id: 'revenue', title: 'Weekly Billing And Closed RO' })} className="h-9 w-9 rounded-xl border-teal-200 bg-white text-teal-700">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[280px]">{renderChart('revenue')}</div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Add-ons</p>
                  <h3 className="mt-1 text-base font-black tracking-tight text-slate-950">EW / RSA / MCP Mix</h3>
                </div>
                <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-700">{formatNumber(addonTotal)}</span>
              </div>
              <div className="h-[170px]">{renderChart('addons')}</div>
            </div>

            <div className="rounded-xl bg-[linear-gradient(135deg,#023468,#034b82)] p-4 text-white shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-violet-100">Priority Queue</p>
              <p className="mt-3 text-4xl font-black leading-none">{formatNumber(priorityTotal)}</p>
              <p className="mt-2 text-xs font-bold text-violet-100">Items need management attention</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] font-black">
                <div className="rounded-xl bg-white/14 p-2">
                  <p className="text-lg">{formatNumber(data.kpis.delayedRo)}</p>
                  <p className="text-violet-100">Delayed</p>
                </div>
                <div className="rounded-xl bg-white/14 p-2">
                  <p className="text-lg">{formatNumber(data.kpis.openOver15)}</p>
                  <p className="text-violet-100">15D+</p>
                </div>
                <div className="rounded-xl bg-white/14 p-2">
                  <p className="text-lg">{formatNumber(data.kpis.complaintsOpen)}</p>
                  <p className="text-violet-100">Open</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_0.72fr_0.72fr]">
          <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Complaints</p>
                <h3 className="mt-1 text-base font-black tracking-tight text-slate-950">Complaint Movement</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Monthly</span>
            </div>
            <div className="h-[190px]">{renderChart('complaintTrend')}</div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Advisor WIP</p>
            <h3 className="mt-1 text-base font-black tracking-tight text-slate-950">Open RO Load</h3>
            <div className="mt-3 space-y-2">
              {data.charts.openRoAdvisorLoad.slice(0, 5).map((row) => (
                <div key={row.advisor} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="truncate text-xs font-black text-slate-700">{row.advisor}</span>
                  <span className="font-mono text-xs font-black text-slate-950">{formatNumber(row.openRo)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Revenue Split</p>
            <h3 className="mt-1 text-base font-black tracking-tight text-slate-950">Labour And Parts</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-teal-50 p-3">
                <p className="text-[10px] font-black uppercase text-teal-700">Labour</p>
                <p className="mt-2 text-lg font-black text-teal-800">{formatCurrency(data.kpis.labour)}</p>
              </div>
              <div className="rounded-xl bg-blue-50 p-3">
                <p className="text-[10px] font-black uppercase text-blue-700">Parts</p>
                <p className="mt-2 text-lg font-black text-blue-800">{formatCurrency(data.kpis.parts)}</p>
              </div>
              <div className="col-span-2 rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-black uppercase text-slate-400">Add-on Count</p>
                <p className="mt-2 text-lg font-black text-slate-950">{formatNumber(data.kpis.ewCount)} EW / {formatNumber(data.kpis.rsaCount)} RSA / {formatNumber(data.kpis.mcpCount)} MCP</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartShell eyebrow="Workshop Pending" title="How Old Are Open Repair Orders?" caption="Vehicles pending beyond 15 days are the main escalation group." onExpand={() => setExpandedChart({ id: 'aging', title: 'How Old Are Open Repair Orders?' })}>
          {renderChart('aging')}
        </ChartShell>
        <ChartShell eyebrow="Service Mix" title="Where Billing Is Coming From" caption="Closed RO billing split by service category for the selected period." onExpand={() => setExpandedChart({ id: 'serviceMix', title: 'Where Billing Is Coming From' })}>
          {renderChart('serviceMix')}
        </ChartShell>
        <div className="xl:col-span-2">
          <ChartShell eyebrow="Customer Voice" title="Top Complaint Reasons" caption="Complaint areas ranked by total cases and open cases." onExpand={() => setExpandedChart({ id: 'complaints', title: 'Top Complaint Reasons' })}>
            {renderChart('complaints')}
          </ChartShell>
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

