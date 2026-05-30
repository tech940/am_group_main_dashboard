'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart3,
  CarFront,
  ChevronDown,
  Clock3,
  Gauge,
  Maximize2,
  ShieldAlert,
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
  Legend,
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
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'
import { logApiTimings } from '@/lib/api/client-timing'
import { BusinessDateFilterValue, appendBusinessComparisonParams } from '@/lib/business-excellence/comparison'
import { cn } from '@/lib/utils'

function ResponsiveContainer(props: React.ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

type OpenRoKpis = {
  totalOpenRo: number
  avgAging: number
  over15Days: number
  delayedRo: number
  accidentJobs: number
  runningRepairs: number
}

type OpenRoSummaryRow = {
  serviceType: string
  totalWip: number
  bucket04: number
  bucket57: number
  bucket815: number
  bucketOver15: number
  avgDays: number
}

type OpenRoDelayReasonRow = {
  newStatus: string
  delayReason: string
  mechCount: number
  accCount: number
  bucket04: number
  bucket57: number
  bucket815: number
  bucketOver15: number
  total: number
  avgDays: number
}

type OpenRoDelayStatusRow = Omit<OpenRoDelayReasonRow, 'delayReason'> & {
  reasons: OpenRoDelayReasonRow[]
}

type OpenRoAlert = {
  label: string
  severity: 'high' | 'medium' | 'low'
}

type OpenRoDetailRow = {
  roNo: string
  roDate: string | null
  regNo: string
  customerName: string
  advisor: string
  technician: string
  model: string
  workType: string
  serviceType: string
  serviceCategory: string
  agingDays: number
  agingBucket: string
  currentStatus: string
  newStatus: string
  subStatus: string
  promiseDate: string | null
  delayStatus: 'Delayed' | 'On Track'
  insuranceCompany: string
  estimateAmount: number
  labourAmount: number
  partAmount: number
  totalAmount: number
  delayReason: string
  remarks: string
  alerts: OpenRoAlert[]
}

type OpenRoResponse = {
  asOfDate: string
  kpis: OpenRoKpis
  rows: OpenRoSummaryRow[]
  delayReasonSummary: OpenRoDelayReasonRow[]
  details: OpenRoDetailRow[]
  charts: {
    agingDistribution: Array<{ bucket: string; count: number }>
    advisorLoad: Array<{ advisor: string; openRo: number; avgAging: number }>
    workTypeDistribution: Array<{ name: string; value: number }>
    agingTrend: Array<{ date: string; openRo: number; avgAging: number }>
  }
  alerts: {
    summary: Array<{ label: string; count: number }>
    highPriority: OpenRoDetailRow[]
  }
  filterOptions: {
    advisors: string[]
    workTypes: string[]
    agingBuckets: string[]
    insuranceCompanies: string[]
  }
  meta: {
    rowCount: number
    detailLimit: number
    cacheTtlSeconds: number
    chunk?: string
    dateRange: { startDate: string | null; endDate: string | null }
    agingDefinition: string
    statusDefinition: string
    promiseDateDefinition: string
  }
}

type OpenRoFilters = {
  advisor: string
  workType: string
  agingBucket: string
  insurance: string
}

const ALL_VALUE = '__all'
const EMPTY_FILTERS: OpenRoFilters = {
  advisor: ALL_VALUE,
  workType: ALL_VALUE,
  agingBucket: ALL_VALUE,
  insurance: ALL_VALUE,
}
const PIE_COLORS = ['#023468', '#2563eb', '#f59e0b', '#ef4444', '#64748b']
const filterSelectClass = 'h-9 rounded-xl border border-teal-200 bg-white text-xs font-bold text-slate-800 shadow-sm shadow-teal-100/40 ring-1 ring-teal-50 transition hover:border-teal-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-100'
const tooltipStyle = {
  borderRadius: 16,
  border: '1px solid #e2e8f0',
  boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
}

function formatNumber(value: number) {
  return Math.round(value || 0).toLocaleString('en-IN')
}

function formatCurrency(value: number) {
  return `Rs ${Math.round(value || 0).toLocaleString('en-IN')}`
}

function formatOneDecimal(value: number) {
  return Number(value || 0).toFixed(1)
}

function formatDateLabel(value: string | null) {
  if (!value) return '-'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function normalizeDelayStatus(value: string) {
  return value.trim() || '-'
}

function shortName(value: string) {
  const text = value.trim()
  if (!text) return 'Unassigned'
  return text.length > 18 ? `${text.slice(0, 16)}...` : text
}

function severityClass(severity: OpenRoAlert['severity']) {
  if (severity === 'high') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (severity === 'medium') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function DetailField({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-slate-50/80 p-3', className)}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <div className="mt-1 text-sm font-black text-slate-900">{value || '-'}</div>
    </div>
  )
}

type OpenRoDateFilter = {
  mode: 'month' | 'range' | 'preset' | 'custom'
  preset?: BusinessDateFilterValue['preset']
  month: number
  year: number
  startDate: string
  endDate: string
  comparison?: BusinessDateFilterValue['comparison']
} | null

function getInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getOpenRoDateRange(dateFilter: OpenRoDateFilter) {
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

function buildQueryString(filters: OpenRoFilters, dateRange: { startDate: string; endDate: string }, dateFilter?: OpenRoDateFilter) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== ALL_VALUE) params.set(key, value)
  })
  if (dateRange.startDate) params.set('startDate', dateRange.startDate)
  if (dateRange.endDate) params.set('endDate', dateRange.endDate)
  appendBusinessComparisonParams(params, dateFilter)
  return params.toString()
}

function withChunk(queryString: string, chunk: string) {
  const params = new URLSearchParams(queryString)
  params.set('chunk', chunk)
  return params.toString()
}

export function OpenRoSection({ dateFilter }: { dateFilter: OpenRoDateFilter }) {
  const queryClient = useQueryClient()
  const [data, setData] = useState<OpenRoResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [filters, setFilters] = useState<OpenRoFilters>(EMPTY_FILTERS)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())
  const [expandedDelayStatuses, setExpandedDelayStatuses] = useState<Set<string>>(() => new Set())
  const [expandedChart, setExpandedChart] = useState<{ id: string; title: string } | null>(null)
  const [selectedVehicle, setSelectedVehicle] = useState<OpenRoDetailRow | null>(null)

  const dateRange = useMemo(() => getOpenRoDateRange(dateFilter), [dateFilter])
  const queryString = useMemo(() => buildQueryString(filters, dateRange, dateFilter), [dateFilter, dateRange, filters])

  const fetchOpenRo = useCallback(async () => {
    try {
      setIsLoading(true)
      setIsDetailLoading(false)
      const summaryQueryString = withChunk(queryString, 'summary')
      const result = await queryClient.fetchQuery({
        queryKey: ['business-excellence', 'open-ro', summaryQueryString],
        queryFn: async () => {
          const suffix = summaryQueryString ? `?${summaryQueryString}` : ''
          const response = await fetch(`/api/brands/kia/business-excellence/open-ro${suffix}`)
          logApiTimings(response, 'open-ro')
          if (!response.ok) throw new Error('Failed to load Open RO dashboard')
          return await response.json() as OpenRoResponse
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
      setData(result)
      setIsLoading(false)

      setIsDetailLoading(true)
      const detailsQueryString = withChunk(queryString, 'details')
      const detailsResult = await queryClient.fetchQuery({
        queryKey: ['business-excellence', 'open-ro', detailsQueryString],
        queryFn: async () => {
          const suffix = detailsQueryString ? `?${detailsQueryString}` : ''
          const response = await fetch(`/api/brands/kia/business-excellence/open-ro${suffix}`)
          logApiTimings(response, 'open-ro-details')
          if (!response.ok) throw new Error('Failed to load Open RO details')
          return await response.json() as OpenRoResponse
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
      setData((current) => current ? {
        ...current,
        details: detailsResult.details || [],
        alerts: {
          ...current.alerts,
          summary: detailsResult.alerts?.summary || current.alerts.summary,
          highPriority: detailsResult.alerts?.highPriority || current.alerts.highPriority,
        },
        meta: {
          ...current.meta,
          rowCount: detailsResult.details?.length ?? current.meta.rowCount,
        },
      } : current)
    } catch (error) {
      console.error('Failed to load Open RO dashboard:', error)
    } finally {
      setIsLoading(false)
      setIsDetailLoading(false)
    }
  }, [queryClient, queryString])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void fetchOpenRo()
  }, [fetchOpenRo])
  /* eslint-enable react-hooks/set-state-in-effect */

  const detailsByCategory = useMemo(() => {
    const grouped = new Map<string, OpenRoDetailRow[]>()
    data?.details.forEach((row) => {
      const key = row.serviceCategory || 'Others'
      grouped.set(key, [...(grouped.get(key) || []), row])
    })
    return grouped
  }, [data?.details])

  const detailsByDelayStatus = useMemo(() => {
    const grouped = new Map<string, OpenRoDetailRow[]>()
    data?.details.forEach((row) => {
      const key = normalizeDelayStatus(row.newStatus)
      grouped.set(key, [...(grouped.get(key) || []), row])
    })
    return grouped
  }, [data?.details])

  const topAlerts = data?.alerts.highPriority || []
  const hasFilters = Object.values(filters).some((value) => value && value !== ALL_VALUE)

  const setFilter = (key: keyof OpenRoFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setExpandedRows(new Set())
    setExpandedDelayStatuses(new Set())
  }

  const toggleRow = (serviceType: string) => {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(serviceType)) {
        next.delete(serviceType)
      } else {
        next.add(serviceType)
      }
      return next
    })
  }

  const toggleDelayStatus = (status: string) => {
    setExpandedDelayStatuses((current) => {
      const next = new Set(current)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-5 bg-slate-50 p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-[1.25rem] bg-white shadow-lg shadow-slate-200/50" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="h-[320px] animate-pulse rounded-[1.5rem] bg-white shadow-lg shadow-slate-200/50" />
          <div className="h-[320px] animate-pulse rounded-[1.5rem] bg-white shadow-lg shadow-slate-200/50" />
        </div>
        <div className="h-[420px] animate-pulse rounded-[1.5rem] bg-white shadow-lg shadow-slate-200/50" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-slate-50 p-8">
        <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-xl shadow-slate-200/50">
          <Wrench className="mx-auto mb-4 h-10 w-10 text-slate-300" />
          <p className="text-sm font-black uppercase tracking-widest text-slate-400">Open RO data is unavailable.</p>
        </div>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Open RO', value: formatNumber(data.kpis.totalOpenRo), icon: CarFront, tone: 'text-teal-700 bg-teal-50 border-teal-100' },
    { label: 'Avg Aging', value: `${formatOneDecimal(data.kpis.avgAging)}D`, icon: Clock3, tone: 'text-blue-700 bg-blue-50 border-blue-100' },
    { label: '>15 Days', value: formatNumber(data.kpis.over15Days), icon: ShieldAlert, tone: 'text-rose-700 bg-rose-50 border-rose-100' },
    { label: 'Delayed RO', value: formatNumber(data.kpis.delayedRo), icon: AlertTriangle, tone: 'text-amber-700 bg-amber-50 border-amber-100' },
    { label: 'Accident Jobs', value: formatNumber(data.kpis.accidentJobs), icon: Gauge, tone: 'text-[#023468] bg-[#edf4fb] border-[#b9ccde]' },
    { label: 'Running Repairs', value: formatNumber(data.kpis.runningRepairs), icon: Wrench, tone: 'text-cyan-700 bg-cyan-50 border-cyan-100' },
  ]

  const delayReasonRows = data.delayReasonSummary || []
  const delayReasonGrandTotal = delayReasonRows.reduce((total, row) => ({
    mechCount: total.mechCount + row.mechCount,
    accCount: total.accCount + row.accCount,
    bucket04: total.bucket04 + row.bucket04,
    bucket57: total.bucket57 + row.bucket57,
    bucket815: total.bucket815 + row.bucket815,
    bucketOver15: total.bucketOver15 + row.bucketOver15,
    total: total.total + row.total,
    weightedDays: total.weightedDays + (row.avgDays * row.total),
  }), {
    mechCount: 0,
    accCount: 0,
    bucket04: 0,
    bucket57: 0,
    bucket815: 0,
    bucketOver15: 0,
    total: 0,
    weightedDays: 0,
  })
  const delayReasonGrandAvg = delayReasonGrandTotal.total > 0
    ? delayReasonGrandTotal.weightedDays / delayReasonGrandTotal.total
    : 0
  const delayStatusRows = Array.from(delayReasonRows.reduce<Map<string, OpenRoDelayStatusRow & { weightedDays: number }>>((groups, row) => {
    const status = normalizeDelayStatus(row.newStatus)
    const current = groups.get(status) || {
      newStatus: status,
      mechCount: 0,
      accCount: 0,
      bucket04: 0,
      bucket57: 0,
      bucket815: 0,
      bucketOver15: 0,
      total: 0,
      avgDays: 0,
      weightedDays: 0,
      reasons: [],
    }

    current.mechCount += row.mechCount
    current.accCount += row.accCount
    current.bucket04 += row.bucket04
    current.bucket57 += row.bucket57
    current.bucket815 += row.bucket815
    current.bucketOver15 += row.bucketOver15
    current.total += row.total
    current.weightedDays += row.avgDays * row.total
    current.reasons.push(row)
    groups.set(status, current)
    return groups
  }, new Map()).values()).map(({ weightedDays, reasons, ...statusRow }) => ({
    ...statusRow,
    avgDays: statusRow.total > 0 ? weightedDays / statusRow.total : 0,
    reasons,
  })).sort((first, second) => second.total - first.total || first.newStatus.localeCompare(second.newStatus))
  const renderExpandButton = (id: string, title: string) => (
    <button
      type="button"
      onClick={() => setExpandedChart({ id, title })}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-teal-100 bg-white text-teal-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50"
      aria-label={`Expand ${title}`}
    >
      <Maximize2 className="h-4 w-4" />
    </button>
  )
  const renderChart = (chartId: string) => {
    if (chartId === 'aging-distribution') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.charts.agingDistribution} margin={{ top: 16, right: 18, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fontWeight: 900, fill: '#475569' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" name="Open RO" fill="#023468" radius={[12, 12, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'advisor-load') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.charts.advisorLoad} layout="vertical" margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis type="category" dataKey="advisor" width={120} tickFormatter={shortName} tick={{ fontSize: 10, fontWeight: 800, fill: '#475569' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="openRo" name="Open RO" fill="#2563eb" radius={[0, 10, 10, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'work-type-mix') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.charts.workTypeDistribution}
              dataKey="value"
              nameKey="name"
              innerRadius={84}
              outerRadius={132}
              paddingAngle={3}
            >
              {data.charts.workTypeDistribution.map((entry, index) => (
                <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
          </PieChart>
        </ResponsiveContainer>
      )
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.charts.agingTrend} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`openRoAgingGradient-${chartId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#023468" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#023468" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={18} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => formatDateLabel(String(label || ''))} />
          <Area type="monotone" dataKey="avgAging" name="Avg Aging" stroke="#023468" strokeWidth={3} fill={`url(#openRoAgingGradient-${chartId})`} />
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  return (
    <div className="space-y-5 bg-slate-50 p-4 lg:p-6">
      {expandedChart && (
        <div className="fixed inset-0 z-[120] bg-slate-950/70 p-4 backdrop-blur-sm">
          <div
            className="expanded-chart-shell flex h-full w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl"
            style={{ backgroundColor: '#ffffff' }}
          >
            <div
              className="expanded-chart-header flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3"
              style={{ backgroundColor: '#ffffff' }}
            >
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Expanded Open RO Chart</p>
                <h3 className="text-lg font-black tracking-tight text-slate-950">{expandedChart.title}</h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setExpandedChart(null)}
                className="h-9 w-9 rounded-xl p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close expanded chart"
              >
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
      <div className="flex flex-col gap-3 rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-teal-100 bg-teal-50 text-teal-700">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Workshop WIP</p>
            <p className="text-xs font-bold text-slate-500">As of {formatDateLabel(data.asOfDate)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center xl:justify-end">
          <Select value={filters.advisor} onValueChange={(value) => setFilter('advisor', value)}>
            <SelectTrigger className={cn(filterSelectClass, 'w-[170px]')}>
              <SelectValue placeholder="Advisor" />
            </SelectTrigger>
            <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
              <SelectItem value={ALL_VALUE} className="text-xs font-bold">All Advisors</SelectItem>
              {data.filterOptions.advisors.map((advisor) => (
                <SelectItem key={advisor} value={advisor} className="text-xs font-bold">{advisor}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.workType} onValueChange={(value) => setFilter('workType', value)}>
            <SelectTrigger className={cn(filterSelectClass, 'w-[170px]')}>
              <SelectValue placeholder="Work Type" />
            </SelectTrigger>
            <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
              <SelectItem value={ALL_VALUE} className="text-xs font-bold">All Work Types</SelectItem>
              {data.filterOptions.workTypes.map((workType) => (
                <SelectItem key={workType} value={workType} className="text-xs font-bold">{workType}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.agingBucket} onValueChange={(value) => setFilter('agingBucket', value)}>
            <SelectTrigger className={cn(filterSelectClass, 'w-[140px]')}>
              <SelectValue placeholder="Aging" />
            </SelectTrigger>
            <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
              <SelectItem value={ALL_VALUE} className="text-xs font-bold">All Aging</SelectItem>
              {data.filterOptions.agingBuckets.map((bucket) => (
                <SelectItem key={bucket} value={bucket} className="text-xs font-bold">{bucket}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.insurance} onValueChange={(value) => setFilter('insurance', value)}>
            <SelectTrigger className={cn(filterSelectClass, 'w-[190px]')}>
              <SelectValue placeholder="Insurance" />
            </SelectTrigger>
            <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
              <SelectItem value={ALL_VALUE} className="text-xs font-bold">All Insurance</SelectItem>
              {data.filterOptions.insuranceCompanies.map((company) => (
                <SelectItem key={company} value={company} className="text-xs font-bold">{company}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="h-9 rounded-xl border-slate-200 bg-white px-3 text-xs font-black"
            >
              <X className="mr-2 h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className={cn('inline-flex h-10 w-10 items-center justify-center rounded-xl border', card.tone)}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-2xl font-black tracking-tight text-slate-950">{card.value}</span>
              </div>
              <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-500">{card.label}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_0.78fr]">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Aging Distribution</p>
              <h3 className="text-lg font-black tracking-tight text-slate-950">Open ROs by aging bucket</h3>
            </div>
            {renderExpandButton('aging-distribution', 'Aging Distribution')}
          </div>
          <div className="h-[280px]">
            {renderChart('aging-distribution')}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Escalation Queue</p>
            <h3 className="text-lg font-black tracking-tight text-slate-950">Highest priority vehicles</h3>
          </div>
          <div className="space-y-3">
            {topAlerts.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm font-bold text-slate-500">
                No high priority Open RO alerts in the current filter.
              </div>
            ) : (
              topAlerts.map((row) => (
                <div key={row.roNo} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">{row.roNo} - {row.regNo}</p>
                      <p className="mt-1 truncate text-[11px] font-bold text-slate-500">{row.customerName} / {row.advisor}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black text-rose-700">
                      {row.agingDays}D
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.alerts.slice(0, 2).map((alert) => (
                      <span key={alert.label} className={cn('rounded-full border px-2 py-1 text-[9px] font-black', severityClass(alert.severity))}>
                        {alert.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Advisor Load</p>
              <h3 className="text-lg font-black tracking-tight text-slate-950">Pending ROs by advisor</h3>
            </div>
            {renderExpandButton('advisor-load', 'Advisor Load')}
          </div>
          <div className="mt-4 h-[300px]">
            {renderChart('advisor-load')}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Work Type Mix</p>
              <h3 className="text-lg font-black tracking-tight text-slate-950">WIP distribution</h3>
            </div>
            {renderExpandButton('work-type-mix', 'Work Type Mix')}
          </div>
          <div className="mt-4 h-[300px]">
            {renderChart('work-type-mix')}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#023468]">Aging Trend</p>
              <h3 className="text-lg font-black tracking-tight text-slate-950">Average aging by RO date</h3>
            </div>
            {renderExpandButton('aging-trend', 'Aging Trend')}
          </div>
          <div className="mt-4 h-[300px]">
            {renderChart('aging-trend')}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Open RO Matrix</p>
          <h3 className="text-xl font-black tracking-tight text-slate-950">Service type aging table</h3>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="border border-slate-800 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Service Type</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Total WIP</th>
                <th className="border border-emerald-700 bg-emerald-600 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">0-4D</th>
                <th className="border border-amber-600 bg-amber-500 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">5-7D</th>
                <th className="border border-orange-600 bg-orange-500 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">8-15D</th>
                <th className="border border-rose-700 bg-rose-600 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">&gt;15D</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Avg Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((row) => {
                const details = detailsByCategory.get(row.serviceType) || []
                const isExpanded = expandedRows.has(row.serviceType)
                return (
                  <React.Fragment key={row.serviceType}>
                    <tr className="bg-white hover:bg-slate-50">
                      <td className="border border-slate-200 px-4 py-3 text-sm font-black text-slate-900">
                        <button
                          type="button"
                          onClick={() => toggleRow(row.serviceType)}
                          className="be-borderless-action inline-flex items-center gap-2 rounded-lg text-left transition hover:text-teal-700"
                        >
                          <ChevronDown className={cn('h-4 w-4 transition', !isExpanded && '-rotate-90')} />
                          {row.serviceType}
                        </button>
                      </td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black">{formatNumber(row.totalWip)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-emerald-700">{formatNumber(row.bucket04)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-amber-600">{formatNumber(row.bucket57)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-orange-600">{formatNumber(row.bucket815)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-rose-700">{formatNumber(row.bucketOver15)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black">{formatOneDecimal(row.avgDays)}</td>
                    </tr>
                    {isExpanded && details.map((detail) => (
                      <tr key={detail.roNo} className="bg-slate-50/80">
                        <td colSpan={7} className="border border-slate-200 px-4 py-2">
                          <button
                            type="button"
                            onClick={() => setSelectedVehicle(detail)}
                            className="grid w-full grid-cols-[minmax(180px,1fr)_140px_180px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-[#b9ccde] hover:bg-[#edf4fb]"
                          >
                            <span>
                              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Vehicle No</span>
                              <span className="mt-1 block font-mono text-sm font-black text-blue-700">{detail.regNo}</span>
                            </span>
                            <span>
                              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Workshop Days</span>
                              <span className={cn(
                                'mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black',
                                detail.agingDays > 15 ? 'bg-rose-100 text-rose-700' : detail.agingDays > 7 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                              )}>
                                {detail.agingDays}D
                              </span>
                            </span>
                            <span>
                              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Aging Category</span>
                              <span className="mt-1 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-700">
                                {detail.agingBucket}
                              </span>
                            </span>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {isExpanded && details.length === 0 && isDetailLoading && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={7} className="border border-slate-200 px-4 py-4 text-center text-xs font-black uppercase tracking-widest text-slate-500">
                          Loading vehicle rows...
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    No open repair orders match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Delay Reason Control</p>
          <h3 className="text-xl font-black tracking-tight text-slate-950">Job Card Delay Reason Summary</h3>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="border border-slate-800 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Status</th>
                <th className="border border-slate-800 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Vehicles</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Mech Count</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Acc Count</th>
                <th className="border border-emerald-700 bg-emerald-600 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">0-4D</th>
                <th className="border border-amber-600 bg-amber-500 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">5-7D</th>
                <th className="border border-orange-600 bg-orange-500 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">8-15D</th>
                <th className="border border-rose-700 bg-rose-600 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">&gt;15D</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Total</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Avg Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {delayStatusRows.map((statusRow) => {
                const isExpanded = expandedDelayStatuses.has(statusRow.newStatus)
                return (
                  <React.Fragment key={statusRow.newStatus}>
                    <tr className="cursor-pointer bg-white transition hover:bg-slate-50" onClick={() => toggleDelayStatus(statusRow.newStatus)}>
                      <td className="border border-slate-200 px-4 py-3 text-sm font-black text-slate-900">
                        <button
                          type="button"
                          className="be-borderless-action inline-flex items-center gap-2 rounded-lg text-left transition hover:text-blue-700"
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleDelayStatus(statusRow.newStatus)
                          }}
                        >
                          <ChevronDown className={cn('h-4 w-4 transition', !isExpanded && '-rotate-90')} />
                          {statusRow.newStatus}
                        </button>
                      </td>
                      <td className="border border-slate-200 px-4 py-3 text-sm font-black text-slate-500">
                        {formatNumber(statusRow.total)} {statusRow.total === 1 ? 'vehicle' : 'vehicles'}
                      </td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-slate-700">{formatNumber(statusRow.mechCount)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-slate-700">{formatNumber(statusRow.accCount)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-emerald-700">{formatNumber(statusRow.bucket04)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-amber-600">{formatNumber(statusRow.bucket57)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-orange-600">{formatNumber(statusRow.bucket815)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-rose-700">{formatNumber(statusRow.bucketOver15)}</td>
                      <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-slate-950">{formatNumber(statusRow.total)}</td>
                      <td className={cn('border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black', statusRow.avgDays > 15 ? 'text-rose-700' : statusRow.avgDays > 7 ? 'text-amber-600' : 'text-blue-700')}>
                        {formatOneDecimal(statusRow.avgDays)}D
                      </td>
                    </tr>
                    {isExpanded && (detailsByDelayStatus.get(statusRow.newStatus) || []).map((vehicle) => (
                      <tr key={`${statusRow.newStatus}-${vehicle.roNo}-${vehicle.regNo}`} className="bg-slate-50">
                        <td colSpan={10} className="border border-slate-200 px-4 py-2">
                          <button
                            type="button"
                            onClick={() => setSelectedVehicle(vehicle)}
                            className="grid w-full grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.2fr)_140px_180px_180px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-[#b9ccde] hover:bg-[#edf4fb]"
                          >
                            <span>
                              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Vehicle No</span>
                              <span className="mt-1 block font-mono text-sm font-black text-blue-700">{vehicle.regNo}</span>
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Delay Reason</span>
                              <span className="mt-1 block truncate text-sm font-black text-slate-800">
                                {vehicle.delayReason || 'No Reason Specified'}
                              </span>
                            </span>
                            <span>
                              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Workshop Days</span>
                              <span className={cn(
                                'mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black',
                                vehicle.agingDays > 15 ? 'bg-rose-100 text-rose-700' : vehicle.agingDays > 7 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                              )}>
                                {vehicle.agingDays}D
                              </span>
                            </span>
                            <span>
                              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Aging Category</span>
                              <span className="mt-1 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-700">
                                {vehicle.agingBucket}
                              </span>
                            </span>
                            <span>
                              <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">RO Number</span>
                              <span className="mt-1 block font-mono text-sm font-black text-slate-800">{vehicle.roNo}</span>
                            </span>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {isExpanded && (detailsByDelayStatus.get(statusRow.newStatus) || []).length === 0 && isDetailLoading && (
                      <tr className="bg-slate-50">
                        <td colSpan={10} className="border border-slate-200 px-4 py-4 text-center text-xs font-black uppercase tracking-widest text-slate-500">
                          Loading vehicle rows...
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              {delayReasonRows.length > 0 && (
                <tr className="bg-slate-100 text-slate-950 shadow-[inset_4px_0_0_#023468]">
                  <td colSpan={2} className="border border-slate-300 px-4 py-3 text-center text-sm font-black uppercase tracking-widest">Grand Total</td>
                  <td className="border border-slate-300 px-4 py-3 text-center font-mono text-sm font-black">{formatNumber(delayReasonGrandTotal.mechCount)}</td>
                  <td className="border border-slate-300 px-4 py-3 text-center font-mono text-sm font-black">{formatNumber(delayReasonGrandTotal.accCount)}</td>
                  <td className="border border-slate-300 px-4 py-3 text-center font-mono text-sm font-black">{formatNumber(delayReasonGrandTotal.bucket04)}</td>
                  <td className="border border-slate-300 px-4 py-3 text-center font-mono text-sm font-black">{formatNumber(delayReasonGrandTotal.bucket57)}</td>
                  <td className="border border-slate-300 px-4 py-3 text-center font-mono text-sm font-black">{formatNumber(delayReasonGrandTotal.bucket815)}</td>
                  <td className="border border-slate-300 px-4 py-3 text-center font-mono text-sm font-black">{formatNumber(delayReasonGrandTotal.bucketOver15)}</td>
                  <td className="border border-slate-300 px-4 py-3 text-center font-mono text-sm font-black">{formatNumber(delayReasonGrandTotal.total)}</td>
                  <td className="border border-slate-300 px-4 py-3 text-center font-mono text-sm font-black">{formatOneDecimal(delayReasonGrandAvg)}D</td>
                </tr>
              )}
              {delayReasonRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    No delay reason data is available for the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={Boolean(selectedVehicle)} onOpenChange={(open) => {
        if (!open) setSelectedVehicle(null)
      }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl">
          {selectedVehicle && (
            <div>
              <div className="bg-[linear-gradient(135deg,var(--dashboard-primary),var(--dashboard-primary-light))] p-6 text-white">
                <DialogHeader className="space-y-2 text-left">
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/75">Open RO Vehicle Details</p>
                  <DialogTitle className="text-2xl font-black tracking-tight text-white">
                    {selectedVehicle.regNo}
                  </DialogTitle>
                </DialogHeader>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white/16 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                    {selectedVehicle.agingDays}D in workshop
                  </span>
                  <span className="rounded-full bg-white/16 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                    {selectedVehicle.agingBucket}
                  </span>
                  <span className={cn(
                    'rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                    selectedVehicle.delayStatus === 'Delayed' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                  )}>
                    {selectedVehicle.delayStatus}
                  </span>
                </div>
              </div>

              <div className="space-y-5 p-6">
                <div className="grid gap-3 md:grid-cols-3">
                  <DetailField label="RO Number" value={selectedVehicle.roNo} />
                  <DetailField label="RO Date" value={formatDateLabel(selectedVehicle.roDate)} />
                  <DetailField label="Promise Date" value={formatDateLabel(selectedVehicle.promiseDate)} />
                  <DetailField label="Customer" value={selectedVehicle.customerName} />
                  <DetailField label="Model" value={selectedVehicle.model} />
                  <DetailField label="Work Type" value={selectedVehicle.workType} />
                  <DetailField label="Service Type" value={selectedVehicle.serviceType} />
                  <DetailField label="Service Category" value={selectedVehicle.serviceCategory} />
                  <DetailField label="Insurance Company" value={selectedVehicle.insuranceCompany} />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <DetailField label="Advisor" value={selectedVehicle.advisor} />
                  <DetailField label="Technician" value={selectedVehicle.technician} />
                  <DetailField label="Current Status" value={selectedVehicle.currentStatus} />
                  <DetailField label="New RO Status" value={selectedVehicle.newStatus} />
                  <DetailField label="Sub Status" value={selectedVehicle.subStatus} />
                  <DetailField label="Delay Reason" value={selectedVehicle.delayReason || '-'} />
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <DetailField label="Estimate" value={formatCurrency(selectedVehicle.estimateAmount)} />
                  <DetailField label="Labour" value={formatCurrency(selectedVehicle.labourAmount)} />
                  <DetailField label="Parts" value={formatCurrency(selectedVehicle.partAmount)} />
                  <DetailField label="Total" value={formatCurrency(selectedVehicle.totalAmount)} />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Alerts</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedVehicle.alerts.length > 0 ? selectedVehicle.alerts.map((alert) => (
                      <span key={alert.label} className={cn('rounded-full border px-3 py-1 text-[10px] font-black', severityClass(alert.severity))}>
                        {alert.label}
                      </span>
                    )) : (
                      <span className="text-sm font-bold text-slate-500">No active alerts.</span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Remarks</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-700">
                    {selectedVehicle.remarks || '-'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

