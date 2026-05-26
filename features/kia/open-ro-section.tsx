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
  ShieldAlert,
  UserRound,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'
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
const PIE_COLORS = ['#0f766e', '#2563eb', '#f59e0b', '#ef4444', '#64748b']
const tooltipStyle = {
  borderRadius: 16,
  border: '1px solid #e2e8f0',
  boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
}

function formatNumber(value: number) {
  return Math.round(value || 0).toLocaleString('en-IN')
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

type OpenRoDateFilter = {
  mode: 'month' | 'range'
  month: number
  year: number
  startDate: string
  endDate: string
} | null

function getInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getOpenRoDateRange(dateFilter: OpenRoDateFilter) {
  const today = new Date()

  if (dateFilter?.mode === 'range' && dateFilter.startDate && dateFilter.endDate) {
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

function buildQueryString(filters: OpenRoFilters, dateRange: { startDate: string; endDate: string }) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== ALL_VALUE) params.set(key, value)
  })
  if (dateRange.startDate) params.set('startDate', dateRange.startDate)
  if (dateRange.endDate) params.set('endDate', dateRange.endDate)
  return params.toString()
}

export function OpenRoSection({ dateFilter }: { dateFilter: OpenRoDateFilter }) {
  const queryClient = useQueryClient()
  const [data, setData] = useState<OpenRoResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [filters, setFilters] = useState<OpenRoFilters>(EMPTY_FILTERS)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())

  const dateRange = useMemo(() => getOpenRoDateRange(dateFilter), [dateFilter])
  const queryString = useMemo(() => buildQueryString(filters, dateRange), [dateRange, filters])

  const fetchOpenRo = useCallback(async () => {
    try {
      setIsLoading(true)
      const result = await queryClient.fetchQuery({
        queryKey: ['business-excellence', 'open-ro', queryString],
        queryFn: async () => {
          const suffix = queryString ? `?${queryString}` : ''
          const response = await fetch(`/api/brands/kia/business-excellence/open-ro${suffix}`)
          if (!response.ok) throw new Error('Failed to load Open RO dashboard')
          return await response.json() as OpenRoResponse
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
      setData(result)
    } catch (error) {
      console.error('Failed to load Open RO dashboard:', error)
    } finally {
      setIsLoading(false)
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

  const topAlerts = data?.alerts.highPriority || []
  const hasFilters = Object.values(filters).some((value) => value && value !== ALL_VALUE)

  const setFilter = (key: keyof OpenRoFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setExpandedRows(new Set())
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
    { label: 'Accident Jobs', value: formatNumber(data.kpis.accidentJobs), icon: Gauge, tone: 'text-indigo-700 bg-indigo-50 border-indigo-100' },
    { label: 'Running Repairs', value: formatNumber(data.kpis.runningRepairs), icon: Wrench, tone: 'text-cyan-700 bg-cyan-50 border-cyan-100' },
  ]

  return (
    <div className="space-y-5 bg-slate-50 p-4 lg:p-6">
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
            <SelectTrigger className="h-9 w-[170px] rounded-xl border border-slate-200 bg-white text-xs font-bold">
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
            <SelectTrigger className="h-9 w-[170px] rounded-xl border border-slate-200 bg-white text-xs font-bold">
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
            <SelectTrigger className="h-9 w-[140px] rounded-xl border border-slate-200 bg-white text-xs font-bold">
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
            <SelectTrigger className="h-9 w-[190px] rounded-xl border border-slate-200 bg-white text-xs font-bold">
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
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.agingDistribution} margin={{ top: 16, right: 18, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fontWeight: 900, fill: '#475569' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name="Open RO" fill="#0f766e" radius={[12, 12, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Advisor Load</p>
          <h3 className="text-lg font-black tracking-tight text-slate-950">Pending ROs by advisor</h3>
          <div className="mt-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.advisorLoad} layout="vertical" margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis type="category" dataKey="advisor" width={92} tickFormatter={shortName} tick={{ fontSize: 10, fontWeight: 800, fill: '#475569' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="openRo" name="Open RO" fill="#2563eb" radius={[0, 10, 10, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Work Type Mix</p>
          <h3 className="text-lg font-black tracking-tight text-slate-950">WIP distribution</h3>
          <div className="mt-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.charts.workTypeDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={64}
                  outerRadius={98}
                  paddingAngle={3}
                >
                  {data.charts.workTypeDistribution.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 800 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Aging Trend</p>
          <h3 className="text-lg font-black tracking-tight text-slate-950">Average aging by RO date</h3>
          <div className="mt-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.charts.agingTrend} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="openRoAgingGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={18} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => formatDateLabel(String(label || ''))} />
                <Area type="monotone" dataKey="avgAging" name="Avg Aging" stroke="#4f46e5" strokeWidth={3} fill="url(#openRoAgingGradient)" />
              </AreaChart>
            </ResponsiveContainer>
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
                          className="inline-flex items-center gap-2 rounded-lg text-left transition hover:text-teal-700"
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
                        <td colSpan={7} className="border border-slate-200 px-4 py-3">
                          <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr_1fr_0.8fr]">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-black text-blue-700">{detail.roNo} / {detail.regNo}</p>
                              <p className="mt-1 truncate text-[11px] font-bold text-slate-600">{detail.customerName} - {detail.model}</p>
                            </div>
                            <div className="flex min-w-0 items-center gap-2 text-[11px] font-bold text-slate-600">
                              <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <span className="truncate">{detail.advisor}</span>
                              <span className="text-slate-300">/</span>
                              <span className="truncate">{detail.technician}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={cn(
                                'rounded-full px-2 py-1 text-[10px] font-black',
                                detail.delayStatus === 'Delayed' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                              )}>
                                {detail.delayStatus}
                              </span>
                              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-600">
                                RO {formatDateLabel(detail.roDate)}
                              </span>
                              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-600">
                                Promise {formatDateLabel(detail.promiseDate)}
                              </span>
                              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-600">
                                {detail.newStatus}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center justify-start gap-1.5 xl:justify-end">
                              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black text-white">{detail.agingDays}D</span>
                              {detail.alerts.slice(0, 2).map((alert) => (
                                <span key={alert.label} className={cn('rounded-full border px-2 py-1 text-[9px] font-black', severityClass(alert.severity))}>
                                  {alert.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
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
    </div>
  )
}
