'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Award,
  BarChart3,
  CalendarDays,
  CarFront,
  IndianRupee,
  Maximize2,
  PackageCheck,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer as RechartsResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { logApiTimings } from '@/lib/api/client-timing'
import { BusinessDateFilterValue, appendBusinessComparisonParams } from '@/lib/business-excellence/comparison'
import { appendPlatinumDealerCodeParam } from '@/lib/platinum/dealer-branch'
import { cn } from '@/lib/utils'

function ResponsiveContainer(props: React.ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

const ALL_VALUE = '__all__'
const CHART_COLORS = ['#0f766e', '#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444']

type SotDateFilter = {
  mode: 'month' | 'range' | 'preset' | 'custom' | 'year'
  preset?: BusinessDateFilterValue['preset']
  month: number
  year: number
  startDate: string
  endDate: string
  comparison?: BusinessDateFilterValue['comparison']
} | null

type SotKpis = {
  certificates: number
  totalValue: number
  avgValue: number
  models: number
  schemes: number
  departments: number
  minDate: string | null
  maxDate: string | null
}

type SotBreakdownRow = {
  name: string
  certificates: number
  value: number
  avgValue: number
  share: number
}

type SotTrendRow = {
  date: string | null
  certificates: number
  value: number
}

type SotRegisterRow = {
  id: number
  section: string
  sourceDealerCode: string
  certNo: string
  regDate: string | null
  vin: string
  model: string
  schemeNo: string
  schemeDesc: string
  department: string
  customerName: string
  customerAddress: string
  hmilAmount: number
  uploadedAt: string | null
}

type SotResponse = {
  asOfDate: string
  dateRange: {
    startDate: string
    endDate: string
    comparisonStartDate: string | null
    comparisonEndDate: string | null
  }
  filters: {
    options: {
      models: string[]
      schemes: Array<{ schemeNo: string; schemeDesc: string }>
      departments: string[]
    }
  }
  kpis: SotKpis
  comparison: {
    enabled: boolean
    kpis: SotKpis | null
    growth: {
      certificates: number | null
      totalValue: number | null
      avgValue: number | null
    } | null
  }
  charts: {
    dailyTrend: SotTrendRow[]
    modelMix: SotBreakdownRow[]
    schemeMix: SotBreakdownRow[]
    departmentMix: SotBreakdownRow[]
  }
  rows: SotRegisterRow[]
  metadata: {
    totalRows: number
    minDate: string | null
    maxDate: string | null
    uploadedAt: string | null
    dealerScoped: boolean
    sourceWarnings: string[]
  }
}

type SotFilters = {
  model: string
  scheme: string
  department: string
}

function getInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getSotDateRange(dateFilter: SotDateFilter) {
  const today = new Date()

  if (dateFilter?.startDate && dateFilter.endDate) {
    return { startDate: dateFilter.startDate, endDate: dateFilter.endDate }
  }

  if (dateFilter?.mode === 'month') {
    const selectedMonthStart = new Date(dateFilter.year, dateFilter.month, 1)
    const selectedMonthEnd = dateFilter.year === today.getFullYear() && dateFilter.month === today.getMonth()
      ? today
      : new Date(dateFilter.year, dateFilter.month + 1, 0)

    return {
      startDate: getInputDate(selectedMonthStart),
      endDate: getInputDate(selectedMonthEnd),
    }
  }

  return {
    startDate: getInputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: getInputDate(today),
  }
}

function buildQueryString(filters: SotFilters, dateRange: { startDate: string; endDate: string }, dateFilter?: SotDateFilter, dealerCode?: string | null) {
  const params = new URLSearchParams()
  params.set('startDate', dateRange.startDate)
  params.set('endDate', dateRange.endDate)
  if (filters.model !== ALL_VALUE) params.set('model', filters.model)
  if (filters.scheme !== ALL_VALUE) params.set('scheme', filters.scheme)
  if (filters.department !== ALL_VALUE) params.set('department', filters.department)
  appendBusinessComparisonParams(params, dateFilter)
  appendPlatinumDealerCodeParam(params, dealerCode)
  return params.toString()
}

function formatMoney(value: number) {
  const numeric = Number(value) || 0
  const absolute = Math.abs(numeric)
  if (absolute >= 10000000) return `Rs ${(numeric / 10000000).toFixed(2)}Cr`
  if (absolute >= 100000) return `Rs ${(numeric / 100000).toFixed(2)}L`
  return `Rs ${Math.round(numeric).toLocaleString('en-IN')}`
}

function formatMoneyFull(value: number) {
  return `Rs ${Math.round(Number(value) || 0).toLocaleString('en-IN')}`
}

function formatNumber(value: number) {
  return Math.round(Number(value) || 0).toLocaleString('en-IN')
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatShortDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function formatGrowth(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'No LY data'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function kpiTone(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'text-slate-500 border-slate-200 bg-white'
  return value >= 0
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-rose-200 bg-rose-50 text-rose-700'
}

function SotKpiCard({
  icon,
  label,
  value,
  subValue,
  growthValue,
}: {
  icon: React.ReactNode
  label: string
  value: string
  subValue: string
  growthValue?: number | null
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-teal-700">
          {icon}
        </div>
        <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest', kpiTone(growthValue))}>
          {formatGrowth(growthValue)}
        </span>
      </div>
      <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-bold text-slate-500">{subValue}</p>
    </div>
  )
}

function ChartShell({
  title,
  eyebrow,
  children,
  onExpand,
}: {
  title: string
  eyebrow: string
  children: React.ReactNode
  onExpand: () => void
}) {
  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-700">{eyebrow}</p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{title}</h3>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExpand}
          className="h-9 w-9 rounded-xl border-teal-100 bg-white p-0 text-teal-700"
          aria-label={`Expand ${title}`}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="h-[280px] min-w-0">
        {children}
      </div>
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm font-bold text-slate-400">
      No SOT data in the current filter.
    </div>
  )
}

export function PlatinumSotAnalysisSection({ dateFilter, dealerCode }: { dateFilter: SotDateFilter; dealerCode?: string | null }) {
  const [filters, setFilters] = useState<SotFilters>({ model: ALL_VALUE, scheme: ALL_VALUE, department: ALL_VALUE })
  const [expandedChart, setExpandedChart] = useState<{ id: 'trend' | 'model' | 'scheme' | 'department'; title: string } | null>(null)
  const [data, setData] = useState<SotResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dateRange = useMemo(() => getSotDateRange(dateFilter), [dateFilter])
  const queryString = useMemo(() => buildQueryString(filters, dateRange, dateFilter, dealerCode), [dateFilter, dateRange, dealerCode, filters])

  const fetchSotAnalysis = useCallback(async () => {
    try {
      setError(null)
      setIsRefreshing(true)
      setIsLoading(true)
      const response = await fetch(`/api/brands/platinum/business-excellence/sot?${queryString}`)
      logApiTimings(response, 'business-excellence-sot')
      if (!response.ok) throw new Error('Failed to load SOT analysis')
      setData(await response.json() as SotResponse)
    } catch (err) {
      console.error(err)
      setError('SOT analysis could not be loaded.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [queryString])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSotAnalysis()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fetchSotAnalysis])

  const hasRows = Boolean(data?.rows?.length)
  const activeGrowth = data?.comparison.growth

  const renderTrendChart = (height = 280) => (
    data?.charts.dailyTrend.length ? (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data.charts.dailyTrend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sotTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0f766e" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis yAxisId="count" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
          <YAxis yAxisId="value" orientation="right" tickFormatter={(value: unknown) => formatMoney(Number(value))} tick={{ fontSize: 11, fill: '#64748b' }} />
          <Tooltip
            formatter={(value: unknown, name: unknown) => [
              String(name) === 'value' ? formatMoneyFull(Number(value)) : formatNumber(Number(value)),
              String(name) === 'value' ? 'HMIL Amount' : 'Certificates',
            ]}
            labelFormatter={(label) => formatDate(String(label))}
          />
          <Area yAxisId="value" type="monotone" dataKey="value" stroke="#0f766e" strokeWidth={2.5} fill="url(#sotTrendFill)" />
          <Bar yAxisId="count" dataKey="certificates" fill="#0ea5e9" radius={[8, 8, 0, 0]} maxBarSize={32} />
        </AreaChart>
      </ResponsiveContainer>
    ) : <EmptyChart />
  )

  const renderBarChart = (rows: SotBreakdownRow[] | undefined, dataKey: 'certificates' | 'value', height = 280) => (
    rows?.length ? (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} height={54} tickFormatter={(value) => String(value).slice(0, 18)} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(value: unknown) => dataKey === 'value' ? formatMoney(Number(value)) : formatNumber(Number(value))} />
          <Tooltip
            formatter={(value: unknown) => dataKey === 'value' ? formatMoneyFull(Number(value)) : formatNumber(Number(value))}
            labelFormatter={(label) => String(label)}
          />
          <Bar dataKey={dataKey} radius={[8, 8, 0, 0]} maxBarSize={42}>
            {rows.map((row, index) => (
              <Cell key={row.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    ) : <EmptyChart />
  )

  const renderDepartmentChart = (height = 280) => (
    data?.charts.departmentMix.length ? (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data.charts.departmentMix}
            dataKey="certificates"
            nameKey="name"
            innerRadius={height > 300 ? 82 : 58}
            outerRadius={height > 300 ? 132 : 96}
            paddingAngle={4}
          >
            {data.charts.departmentMix.map((row, index) => (
              <Cell key={row.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value: unknown) => [formatNumber(Number(value)), 'Certificates']} />
        </PieChart>
      </ResponsiveContainer>
    ) : <EmptyChart />
  )

  const expandedChartContent = () => {
    if (!expandedChart) return null
    if (expandedChart.id === 'trend') return renderTrendChart(520)
    if (expandedChart.id === 'model') return renderBarChart(data?.charts.modelMix, 'value', 520)
    if (expandedChart.id === 'scheme') return renderBarChart(data?.charts.schemeMix, 'certificates', 520)
    return renderDepartmentChart(520)
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-20 animate-pulse rounded-[1.25rem] bg-slate-100" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="h-80 animate-pulse rounded-[1.25rem] bg-slate-100" />
          <div className="h-80 animate-pulse rounded-[1.25rem] bg-slate-100" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 bg-slate-50/60 p-4">
      <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-teal-100 bg-teal-50 text-teal-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-teal-700">Shield Of Trust</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">SOT Package Analysis</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                Registration window {formatDate(data?.dateRange.startDate)} to {formatDate(data?.dateRange.endDate)}
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[640px]">
            <Select value={filters.model} onValueChange={(value) => setFilters((current) => ({ ...current, model: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-teal-200 bg-white text-xs font-black">
                <SelectValue placeholder="All Models" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value={ALL_VALUE}>All Models</SelectItem>
                {data?.filters.options.models.map((model) => (
                  <SelectItem key={model} value={model}>{model}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.scheme} onValueChange={(value) => setFilters((current) => ({ ...current, scheme: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-teal-200 bg-white text-xs font-black">
                <SelectValue placeholder="All Schemes" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value={ALL_VALUE}>All Schemes</SelectItem>
                {data?.filters.options.schemes.map((scheme) => (
                  <SelectItem key={scheme.schemeNo} value={scheme.schemeNo}>{scheme.schemeNo}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.department} onValueChange={(value) => setFilters((current) => ({ ...current, department: value }))}>
              <SelectTrigger className="h-10 rounded-xl border-teal-200 bg-white text-xs font-black">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value={ALL_VALUE}>All Departments</SelectItem>
                {data?.filters.options.departments.map((department) => (
                  <SelectItem key={department} value={department}>{department}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {data?.metadata.sourceWarnings?.length ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
            {data.metadata.sourceWarnings[0]}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SotKpiCard
          icon={<Award className="h-5 w-5" />}
          label="Certificates"
          value={formatNumber(data?.kpis.certificates || 0)}
          subValue={`${formatNumber(data?.metadata.totalRows || 0)} source rows`}
          growthValue={activeGrowth?.certificates}
        />
        <SotKpiCard
          icon={<IndianRupee className="h-5 w-5" />}
          label="HMIL Amount"
          value={formatMoney(data?.kpis.totalValue || 0)}
          subValue="Total package value"
          growthValue={activeGrowth?.totalValue}
        />
        <SotKpiCard
          icon={<PackageCheck className="h-5 w-5" />}
          label="Average Value"
          value={formatMoney(data?.kpis.avgValue || 0)}
          subValue="Value per certificate"
          growthValue={activeGrowth?.avgValue}
        />
        <SotKpiCard
          icon={<CarFront className="h-5 w-5" />}
          label="Models"
          value={formatNumber(data?.kpis.models || 0)}
          subValue="Unique model coverage"
        />
        <SotKpiCard
          icon={<CalendarDays className="h-5 w-5" />}
          label="Freshness"
          value={formatDate(data?.metadata.uploadedAt)}
          subValue={`Reg ${formatDate(data?.metadata.minDate)} to ${formatDate(data?.metadata.maxDate)}`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartShell title="SOT registrations by day" eyebrow="Trend" onExpand={() => setExpandedChart({ id: 'trend', title: 'SOT registrations by day' })}>
          {renderTrendChart()}
        </ChartShell>
        <ChartShell title="Model value mix" eyebrow="Model Analysis" onExpand={() => setExpandedChart({ id: 'model', title: 'Model value mix' })}>
          {renderBarChart(data?.charts.modelMix, 'value')}
        </ChartShell>
        <ChartShell title="Scheme certificate mix" eyebrow="Scheme Analysis" onExpand={() => setExpandedChart({ id: 'scheme', title: 'Scheme certificate mix' })}>
          {renderBarChart(data?.charts.schemeMix, 'certificates')}
        </ChartShell>
        <ChartShell title="Department split" eyebrow="Department" onExpand={() => setExpandedChart({ id: 'department', title: 'Department split' })}>
          {renderDepartmentChart()}
        </ChartShell>
      </div>

      <div className="rounded-[1.25rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-700">SOT Register</p>
            <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">Certificate level view</h3>
          </div>
          <div className="text-xs font-black text-slate-500">
            {formatNumber(data?.rows.length || 0)} shown
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">Cert No</th>
                <th className="px-4 py-3">Reg Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">VIN</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Scheme</th>
                <th className="px-4 py-3 text-right">HMIL Amt</th>
                <th className="px-4 py-3">Department</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {hasRows ? data?.rows.map((row) => (
                <tr key={`${row.id}-${row.certNo}`} className="align-top hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-black text-slate-900">{row.certNo}</td>
                  <td className="px-4 py-3 font-bold text-slate-600">{formatDate(row.regDate)}</td>
                  <td className="px-4 py-3">
                    <p className="font-black text-slate-900">{row.customerName}</p>
                    <p className="mt-1 line-clamp-2 max-w-[240px] text-[11px] font-semibold leading-4 text-slate-500">{row.customerAddress}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] font-bold text-slate-600">{row.vin}</td>
                  <td className="px-4 py-3 max-w-[220px] font-bold text-slate-700">{row.model}</td>
                  <td className="px-4 py-3 max-w-[260px]">
                    <p className="font-black text-slate-800">{row.schemeNo}</p>
                    <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-500">{row.schemeDesc}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-black text-slate-900">{formatMoneyFull(row.hmilAmount)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-teal-700">
                      {row.department}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                    No SOT certificates match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={Boolean(expandedChart)} onOpenChange={(open) => !open && setExpandedChart(null)}>
        <DialogContent className="max-h-[88vh] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-2xl sm:max-w-[1080px]">
          <DialogHeader className="border-b border-slate-100 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <DialogTitle className="text-xl font-black tracking-tight text-slate-950">{expandedChart?.title}</DialogTitle>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setExpandedChart(null)} className="h-9 w-9 rounded-xl p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="h-[560px] p-5">
            {expandedChartContent()}
          </div>
        </DialogContent>
      </Dialog>

      {isRefreshing && data ? (
        <div className="fixed bottom-4 right-4 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-500 shadow-lg">
          Refreshing SOT
        </div>
      ) : null}
    </div>
  )
}
