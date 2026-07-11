'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarDays,
  CarFront,
  ChevronDown,
  Clock3,
  Maximize2,
  MessageSquare,
  PhoneCall,
  ShieldAlert,
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
import { logApiTimings } from '@/lib/api/client-timing'
import { BusinessDateFilterValue, appendBusinessComparisonParams } from '@/lib/business-excellence/comparison'
import { appendKiaDealerCodeParam } from '@/lib/kia/dealer-branch'
import { cn } from '@/lib/utils'

function ResponsiveContainer(props: React.ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

type ComplaintsDateFilter = {
  mode: 'month' | 'range' | 'preset' | 'custom' | 'year'
  preset?: BusinessDateFilterValue['preset']
  month: number
  year: number
  startDate: string
  endDate: string
  comparison?: BusinessDateFilterValue['comparison']
} | null

type ComplaintKpis = {
  total: number
  open: number
  closed: number
  over15: number
  delayRelated: number
  avgResolutionDays: number
  maxResolutionDays: number
}

type ComplaintDetailRow = {
  id: number
  complaintNo: string
  srNo: string
  status: string
  statusGroup: string
  type: string
  customerName: string
  mobileNo: string
  vinNo: string
  dealerName: string
  dealerCode: string
  region: string
  complaintDate: string | null
  resolvingDate: string | null
  closeDate: string | null
  resolvedByDealer: string
  closedBy: string
  source: string
  customerRemark: string
  remarks: string
  observation: string
  complaintType: string
  srArea: string
  srSubArea: string
  srType: string
  vehicleModel: string
  variant: string
  dealerArea: string
  dealerSubArea: string
  dealerType: string
  pendingReason: string
  resolutionDays: number
  openDays: number
  signalArea: string
}

type ComplaintResponse = {
  asOfDate: string
  trendYear: number
  metadata: {
    totalRows: number
    minDate: string | null
    maxDate: string | null
    uploadedAt: string | null
  }
  kpis: ComplaintKpis
  comparison: {
    selectedYear: number
    previousYear: number
    currentPeriod: { startDate: string; endDate: string; count: number; open: number; avgDays: number }
    previousPeriod: { startDate: string; endDate: string; count: number; open: number; avgDays: number }
    yearly: Array<{ year: number; total: number; closed: number; open: number; over15: number; avgDays: number }>
  }
  charts: {
    monthlyTrend: Array<{
      month: string
      cyCount: number
      lyCount: number
      cyOpen: number
      lyOpen: number
      cyClosed: number
      lyClosed: number
      cyAvgDays: number
      lyAvgDays: number
      growthPct: number
    }>
    areaBreakdown: Array<{ name: string; total: number; open: number; avgDays: number }>
    subAreaBreakdown: Array<{ name: string; total: number; open: number; avgDays: number }>
    dealerPerformance: Array<{ dealer: string; dealerCode: string; total: number; open: number; avgDays: number; over15: number }>
    modelBreakdown: Array<{ model: string; total: number; avgDays: number }>
    sourceBreakdown: Array<{ source: string; total: number }>
  }
  rows: ComplaintDetailRow[]
  filterOptions: {
    statuses: string[]
    dealers: string[]
    areas: string[]
    models: string[]
    sources: string[]
  }
  meta?: {
    chunk?: string
  }
}

type ComplaintFilters = {
  status: string
  dealer: string
  area: string
  model: string
  source: string
}

const ALL_VALUE = '__all'
const EMPTY_FILTERS: ComplaintFilters = {
  status: ALL_VALUE,
  dealer: ALL_VALUE,
  area: ALL_VALUE,
  model: ALL_VALUE,
  source: ALL_VALUE,
}

const PIE_COLORS = ['#023468', '#2563eb', '#f59e0b', '#ef4444', '#7c3aed', '#64748b']
const filterSelectClass = 'h-9 rounded-xl border border-teal-200 bg-white text-xs font-bold text-slate-800 shadow-sm shadow-teal-100/40 ring-1 ring-teal-50 transition hover:border-teal-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-100'
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

function formatGrowth(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatOneDecimal(value)}%`
}

function formatDateLabel(value: string | null) {
  if (!value) return '-'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function truncateLabel(value: string, length = 20) {
  const text = value.trim()
  if (!text) return 'Unspecified'
  return text.length > length ? `${text.slice(0, length - 2)}..` : text
}

function getInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getComplaintsDateRange(dateFilter: ComplaintsDateFilter) {
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

function buildQueryString(filters: ComplaintFilters, dateRange: { startDate: string; endDate: string }, dateFilter?: ComplaintsDateFilter, dealerCode?: string | null) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== ALL_VALUE) params.set(key, value)
  })
  if (dateRange.startDate) params.set('startDate', dateRange.startDate)
  if (dateRange.endDate) params.set('endDate', dateRange.endDate)
  appendBusinessComparisonParams(params, dateFilter)
  appendKiaDealerCodeParam(params, dealerCode)
  return params.toString()
}

function withChunk(queryString: string, chunk: string) {
  const params = new URLSearchParams(queryString)
  params.set('chunk', chunk)
  return params.toString()
}

function statusClass(statusGroup: string) {
  if (statusGroup === 'Closed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (statusGroup === 'Hold') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (statusGroup === 'Pending') return 'border-orange-200 bg-orange-50 text-orange-700'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

function riskClass(days: number, statusGroup: string) {
  if (statusGroup !== 'Closed' && days > 7) return 'border-rose-200 bg-rose-50 text-rose-700'
  if (days > 15) return 'border-rose-200 bg-rose-50 text-rose-700'
  if (days > 7) return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function growthClass(value: number) {
  if (value > 0) return 'text-rose-700'
  if (value < 0) return 'text-emerald-700'
  return 'text-slate-600'
}

function complaintSkeleton() {
  return (
    <div className="space-y-5 bg-slate-50 p-6 lg:p-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-[1.25rem] bg-white shadow-lg shadow-slate-200/50" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="h-[340px] animate-pulse rounded-[1.5rem] bg-white shadow-lg shadow-slate-200/50" />
        <div className="h-[340px] animate-pulse rounded-[1.5rem] bg-white shadow-lg shadow-slate-200/50" />
      </div>
      <div className="h-[440px] animate-pulse rounded-[1.5rem] bg-white shadow-lg shadow-slate-200/50" />
    </div>
  )
}

export function KiaComplaintsSection({ dateFilter, dealerCode }: { dateFilter: ComplaintsDateFilter; dealerCode?: string | null }) {
  const queryClient = useQueryClient()
  const [data, setData] = useState<ComplaintResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [filters, setFilters] = useState<ComplaintFilters>(EMPTY_FILTERS)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())
  const [expandedChart, setExpandedChart] = useState<{ id: string; title: string } | null>(null)
  const [showCalendarView, setShowCalendarView] = useState(false)
  const [selectedCalendarDate, setSelectedCalendarDate] = useState('')

  const dateRange = useMemo(() => getComplaintsDateRange(dateFilter), [dateFilter])
  const queryString = useMemo(() => buildQueryString(filters, dateRange, dateFilter, dealerCode), [dateFilter, dateRange, dealerCode, filters])

  const fetchComplaints = useCallback(async () => {
    try {
      setIsLoading(true)
      setIsDetailLoading(false)
      setData(null)
      const summaryQueryString = withChunk(queryString, 'summary')
      const result = await queryClient.fetchQuery({
        queryKey: ['business-excellence', 'kia-complaints', summaryQueryString],
        queryFn: async () => {
          const suffix = summaryQueryString ? `?${summaryQueryString}` : ''
          const response = await fetch(`/api/brands/kia/business-excellence/complaints${suffix}`)
          logApiTimings(response, 'kia-complaints')
          if (!response.ok) throw new Error('Failed to load KIA complaints dashboard')
          return await response.json() as ComplaintResponse
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
      setData(result)
      setIsLoading(false)

      setIsDetailLoading(true)
      const secondaryQueryString = withChunk(queryString, 'secondary')
      const detailsQueryString = withChunk(queryString, 'details')
      const secondaryPromise = queryClient.fetchQuery({
        queryKey: ['business-excellence', 'kia-complaints', secondaryQueryString],
        queryFn: async () => {
          const suffix = secondaryQueryString ? `?${secondaryQueryString}` : ''
          const response = await fetch(`/api/brands/kia/business-excellence/complaints${suffix}`)
          logApiTimings(response, 'kia-complaints-secondary')
          if (!response.ok) throw new Error('Failed to load KIA complaints secondary data')
          return await response.json() as ComplaintResponse
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      }).catch((error) => {
        console.error('Failed to load KIA complaints secondary data:', error)
        return null
      })

      try {
        const detailsResult = await queryClient.fetchQuery({
          queryKey: ['business-excellence', 'kia-complaints', detailsQueryString],
          queryFn: async () => {
            const suffix = detailsQueryString ? `?${detailsQueryString}` : ''
            const response = await fetch(`/api/brands/kia/business-excellence/complaints${suffix}`)
            logApiTimings(response, 'kia-complaints-details')
            if (!response.ok) throw new Error('Failed to load KIA complaints detail rows')
            return await response.json() as ComplaintResponse
          },
          staleTime: DASHBOARD_STALE_TIME_MS,
        })

        setData((current) => current ? {
          ...current,
          rows: detailsResult.rows ?? current.rows,
        } : current)
      } catch (error) {
        console.error('Failed to load KIA complaints detail rows:', error)
      } finally {
        setIsDetailLoading(false)
      }

      const secondaryResult = await secondaryPromise
      if (!secondaryResult) return

      setData((current) => current ? {
        ...current,
        comparison: secondaryResult.comparison || current.comparison,
        charts: {
          ...current.charts,
          monthlyTrend: secondaryResult.charts?.monthlyTrend?.length ? secondaryResult.charts.monthlyTrend : current.charts.monthlyTrend,
          subAreaBreakdown: secondaryResult.charts?.subAreaBreakdown?.length ? secondaryResult.charts.subAreaBreakdown : current.charts.subAreaBreakdown,
        },
      } : current)
    } catch (error) {
      console.error('Failed to load KIA complaints dashboard:', error)
    } finally {
      setIsLoading(false)
      setIsDetailLoading(false)
    }
  }, [queryClient, queryString])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void fetchComplaints()
  }, [fetchComplaints])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!showCalendarView) return
    const bodyOverflow = document.body.style.overflow
    const rootOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = bodyOverflow
      document.documentElement.style.overflow = rootOverflow
    }
  }, [showCalendarView])

  const setFilter = (key: keyof ComplaintFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setExpandedRows(new Set())
  }

  const hasFilters = Object.values(filters).some((value) => value && value !== ALL_VALUE)

  const escalationRows = useMemo(() => {
    return (data?.rows || [])
      .filter((row) => row.statusGroup !== 'Closed' || row.resolutionDays > 15 || row.signalArea.includes('Delay'))
      .slice(0, 5)
  }, [data?.rows])

  const calendarView = useMemo(() => {
    const anchor = new Date(`${dateRange.endDate}T00:00:00`)
    const anchorDate = Number.isNaN(anchor.getTime()) ? new Date() : anchor
    const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
    const gridStart = new Date(monthStart)
    gridStart.setDate(monthStart.getDate() - monthStart.getDay())
    const rowsByDate = new Map<string, ComplaintDetailRow[]>()

    ;(data?.rows || []).forEach((row) => {
      const key = row.complaintDate?.slice(0, 10)
      if (!key) return
      rowsByDate.set(key, [...(rowsByDate.get(key) || []), row])
    })

    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + index)
      const key = getInputDate(date)
      const rows = rowsByDate.get(key) || []
      return {
        key,
        date,
        inMonth: date.getMonth() === anchorDate.getMonth(),
        rows,
        total: rows.length,
        open: rows.filter((row) => row.statusGroup !== 'Closed').length,
        closed: rows.filter((row) => row.statusGroup === 'Closed').length,
        aged: rows.filter((row) => row.resolutionDays > 15).length,
      }
    })

    return {
      monthLabel: anchorDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      days,
      rowsByDate,
    }
  }, [data?.rows, dateRange.endDate])

  const toggleRow = (complaintNo: string) => {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(complaintNo)) next.delete(complaintNo)
      else next.add(complaintNo)
      return next
    })
  }

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
    if (!data) return null

    if (chartId === 'monthly-trend') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.charts.monthlyTrend} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`complaintTrend-${chartId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#023468" stopOpacity={0.28} />
                <stop offset="95%" stopColor="#023468" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 10, fontWeight: 800, fill: '#475569' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="cyCount" name={`${data.trendYear} Complaints`} stroke="#023468" strokeWidth={3} fill={`url(#complaintTrend-${chartId})`} />
            <Area type="monotone" dataKey="lyCount" name={`${data.trendYear - 1} Complaints`} stroke="#94a3b8" strokeWidth={2} fill="transparent" />
          </AreaChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'area-breakdown') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.charts.areaBreakdown} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis type="category" dataKey="name" width={130} tickFormatter={(value) => truncateLabel(String(value), 18)} tick={{ fontSize: 10, fontWeight: 800, fill: '#475569' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="total" name="Complaints" fill="#2563eb" radius={[0, 10, 10, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'model-mix') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.charts.modelBreakdown} dataKey="total" nameKey="model" innerRadius={78} outerRadius={126} paddingAngle={3}>
              {data.charts.modelBreakdown.map((entry, index) => (
                <Cell key={entry.model} fill={PIE_COLORS[index % PIE_COLORS.length]} />
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
        <BarChart data={data.charts.dealerPerformance} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="dealerCode" tick={{ fontSize: 10, fontWeight: 800, fill: '#475569' }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="total" name="Total" fill="#023468" radius={[10, 10, 0, 0]} />
          <Bar dataKey="over15" name=">15 Days" fill="#ef4444" radius={[10, 10, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (isLoading && !data) return complaintSkeleton()

  if (!data) {
    return (
      <div className="bg-slate-50 p-8">
        <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-xl shadow-slate-200/50">
          <MessageSquare className="mx-auto mb-4 h-10 w-10 text-slate-300" />
          <p className="text-sm font-black uppercase tracking-widest text-slate-400">KIA complaints data is unavailable.</p>
        </div>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Complaints', value: formatNumber(data.kpis.total), icon: MessageSquare, tone: 'text-teal-700 bg-teal-50 border-teal-100' },
    { label: 'Open / Pending', value: formatNumber(data.kpis.open), icon: AlertTriangle, tone: 'text-rose-700 bg-rose-50 border-rose-100' },
    { label: 'Closed', value: formatNumber(data.kpis.closed), icon: ShieldCheck, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
    { label: 'Avg Closure', value: `${formatOneDecimal(data.kpis.avgResolutionDays)}D`, icon: Clock3, tone: 'text-blue-700 bg-blue-50 border-blue-100' },
    { label: '>15 Days', value: formatNumber(data.kpis.over15), icon: ShieldAlert, tone: 'text-orange-700 bg-orange-50 border-orange-100' },
    { label: 'Delay Signals', value: formatNumber(data.kpis.delayRelated), icon: Activity, tone: 'text-[#023468] bg-[#edf4fb] border-[#b9ccde]' },
  ]
  const activeCalendarDate = selectedCalendarDate && selectedCalendarDate.slice(0, 7) === dateRange.endDate.slice(0, 7)
    ? selectedCalendarDate
    : dateRange.endDate
  const selectedCalendarRows = calendarView.rowsByDate.get(activeCalendarDate) || []

  return (
    <div className="space-y-5 bg-slate-50 p-4 lg:p-6">
      {expandedChart && (
        <div className="fixed inset-0 z-[9999] bg-white p-4">
          <div
            className="expanded-chart-shell flex h-full w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl"
            style={{ backgroundColor: '#ffffff' }}
          >
            <div
              className="expanded-chart-header flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3"
              style={{ backgroundColor: '#ffffff' }}
            >
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Expanded Complaints Chart</p>
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
            <MessageSquare className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Customer Voice Control</p>
            <p className="text-xs font-bold text-slate-500">
              Complaint Date: {formatDateLabel(dateRange.startDate)} to {formatDateLabel(dateRange.endDate)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center xl:justify-end">
          <Select value={filters.status} onValueChange={(value) => setFilter('status', value)}>
            <SelectTrigger className={cn(filterSelectClass, 'w-[145px]')}>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
              <SelectItem value={ALL_VALUE} className="text-xs font-bold">All Status</SelectItem>
              {data.filterOptions.statuses.map((status) => (
                <SelectItem key={status} value={status} className="text-xs font-bold">{status}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.dealer} onValueChange={(value) => setFilter('dealer', value)}>
            <SelectTrigger className={cn(filterSelectClass, 'w-[190px]')}>
              <SelectValue placeholder="Dealer" />
            </SelectTrigger>
            <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
              <SelectItem value={ALL_VALUE} className="text-xs font-bold">All Dealers</SelectItem>
              {data.filterOptions.dealers.map((dealer) => (
                <SelectItem key={dealer} value={dealer} className="text-xs font-bold">{truncateLabel(dealer, 34)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.area} onValueChange={(value) => setFilter('area', value)}>
            <SelectTrigger className={cn(filterSelectClass, 'w-[170px]')}>
              <SelectValue placeholder="Area" />
            </SelectTrigger>
            <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
              <SelectItem value={ALL_VALUE} className="text-xs font-bold">All Areas</SelectItem>
              {data.filterOptions.areas.map((area) => (
                <SelectItem key={area} value={area} className="text-xs font-bold">{area}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.model} onValueChange={(value) => setFilter('model', value)}>
            <SelectTrigger className={cn(filterSelectClass, 'w-[150px]')}>
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
              <SelectItem value={ALL_VALUE} className="text-xs font-bold">All Models</SelectItem>
              {data.filterOptions.models.map((model) => (
                <SelectItem key={model} value={model} className="text-xs font-bold">{model}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.source} onValueChange={(value) => setFilter('source', value)}>
            <SelectTrigger className={cn(filterSelectClass, 'w-[150px]')}>
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
              <SelectItem value={ALL_VALUE} className="text-xs font-bold">All Sources</SelectItem>
              {data.filterOptions.sources.map((source) => (
                <SelectItem key={source} value={source} className="text-xs font-bold">{source}</SelectItem>
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
          <Button
            type="button"
            variant={showCalendarView ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowCalendarView((current) => !current)}
            className={cn(
              'h-9 rounded-xl px-3 text-xs font-black',
              showCalendarView
                ? 'app-primary-action'
                : 'border-[#b9ccde] bg-white text-[#023468] hover:bg-[#edf4fb]'
            )}
          >
            <CalendarDays className="mr-2 h-3.5 w-3.5" />
            {showCalendarView ? 'Hide Calendar' : 'Calendar View'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className={cn('rounded-[1.25rem] border p-4 shadow-sm transition hover:shadow-md duration-200', card.tone)}>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/40 bg-white/60">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span className="text-2xl font-black tracking-tight">{card.value}</span>
              </div>
              <p className="mt-3 text-[10px] font-black uppercase tracking-widest opacity-80">{card.label}</p>
            </div>
          )
        })}
      </div>

      {showCalendarView && (
        <div
          className="fixed inset-0 z-[9999] bg-slate-950/60 p-3 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Kia complaints calendar"
        >
        <div className="solid-calendar-surface flex h-full w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl" style={{ backgroundColor: '#ffffff' }}>
          <div className="solid-calendar-surface flex flex-col gap-3 border-b border-slate-100 bg-white p-5 lg:flex-row lg:items-center lg:justify-between" style={{ backgroundColor: '#ffffff' }}>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#b9ccde] bg-[#edf4fb] text-[#023468]">
                <CalendarDays className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#023468]">Complaint Calendar</p>
                <h3 className="text-xl font-black tracking-tight text-slate-950">Daily complaint load by complaint date</h3>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5"><span className="h-2 w-2 rounded-full bg-slate-900" /> Total</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-rose-700"><span className="h-2 w-2 rounded-full bg-rose-500" /> Open</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Closed</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-500" /> &gt;15D</span>
              <button
                type="button"
                onClick={() => setShowCalendarView(false)}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 transition hover:bg-slate-50"
              >
                <X className="h-3.5 w-3.5" />
                Close
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-black text-slate-950">{calendarView.monthLabel}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {isDetailLoading ? 'Loading complaints...' : `${formatNumber(data.rows.length)} complaints loaded`}
                </p>
              </div>
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-900 text-white">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="border-r border-slate-700 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest last:border-r-0">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 bg-white">
                {calendarView.days.map((day) => {
                  const isSelected = day.key === activeCalendarDate
                  const hasPressure = day.open > 0 || day.aged > 0
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => setSelectedCalendarDate(day.key)}
                      className={cn(
                        'min-h-[108px] border-r border-b border-slate-200 p-2 text-left transition last:border-r-0 hover:bg-[#edf4fb]',
                        !day.inMonth && 'bg-slate-50 text-slate-300',
                        isSelected && 'bg-[#edf4fb] ring-2 ring-inset ring-[#023468]',
                        hasPressure && day.inMonth && !isSelected && 'bg-rose-50'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={cn('text-xs font-black', day.inMonth ? 'text-slate-900' : 'text-slate-300')}>
                          {day.date.getDate().toString().padStart(2, '0')}
                        </span>
                        {day.total > 0 && (
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-900 shadow-sm">
                            {day.total}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-1">
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700">{day.total} total</span>
                        <span className="rounded-md bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700">{day.open} open</span>
                        <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{day.closed} closed</span>
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">{day.aged} &gt;15D</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="hidden">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Selected Date</p>
                  <h4 className="text-lg font-black text-slate-950">{formatDateLabel(activeCalendarDate)}</h4>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-700">
                  {selectedCalendarRows.length} complaints
                </span>
              </div>
              <div className="mt-4 max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto pr-1">
                {selectedCalendarRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-sm font-bold text-slate-500">
                    No complaints on this date.
                  </div>
                ) : selectedCalendarRows.map((row) => (
                  <button
                    key={`${activeCalendarDate}-${row.complaintNo}-${row.id}`}
                    type="button"
                    onClick={() => {
                      toggleRow(row.complaintNo)
                      setShowCalendarView(false)
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-[#b9ccde] hover:bg-[#edf4fb]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-black text-blue-700">{row.complaintNo}</p>
                        <p className="mt-1 truncate text-[11px] font-bold text-slate-500">{row.customerName || '-'} / {row.vehicleModel || '-'}</p>
                      </div>
                      <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black', statusClass(row.statusGroup))}>
                        {row.statusGroup}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[11px] font-semibold leading-5 text-slate-600">
                      {row.signalArea} / {row.srSubArea}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Monthly Trend</p>
              <h3 className="text-lg font-black tracking-tight text-slate-950">Complaint inflow vs last year</h3>
            </div>
            {renderExpandButton('monthly-trend', 'Monthly Complaint Trend')}
          </div>
          <div className="h-[300px]">
            {renderChart('monthly-trend')}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Control Queue</p>
            <h3 className="text-lg font-black tracking-tight text-slate-950">Complaints needing attention</h3>
          </div>
          <div className="space-y-3">
            {escalationRows.length === 0 ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
                No high-risk complaint signals in this selection.
              </div>
            ) : (
              escalationRows.map((row) => (
                <div key={row.complaintNo} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">{row.complaintNo} - {row.vehicleModel}</p>
                      <p className="mt-1 truncate text-[11px] font-bold text-slate-500">{row.signalArea} / {row.dealerCode}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black', riskClass(row.resolutionDays, row.statusGroup))}>
                      {row.resolutionDays}D
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[11px] font-semibold leading-5 text-slate-600">
                    {row.customerRemark || row.remarks || row.observation || row.srSubArea}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Year & Month Comparison</p>
            <h3 className="text-xl font-black tracking-tight text-slate-950">
              {data.comparison.selectedYear} vs {data.comparison.previousYear} complaint movement
            </h3>
          </div>
          <p className="text-[11px] font-bold text-slate-500">
            YTD window: {formatDateLabel(data.comparison.currentPeriod.startDate)} to {formatDateLabel(data.comparison.currentPeriod.endDate)}
          </p>
        </div>
        <div className="grid gap-3 border-b border-slate-100 p-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: `${data.comparison.selectedYear} YTD Complaints`, value: formatNumber(data.comparison.currentPeriod.count), sub: `${formatNumber(data.comparison.currentPeriod.open)} open`, tone: 'text-[#023468] bg-[#edf4fb] border-[#b9ccde]' },
            { label: `${data.comparison.previousYear} Same Period`, value: formatNumber(data.comparison.previousPeriod.count), sub: `${formatNumber(data.comparison.previousPeriod.open)} open`, tone: 'text-slate-700 bg-slate-50 border-[#b9ccde]' },
            {
              label: 'YTD Growth / Degrowth',
              value: formatGrowth(data.comparison.previousPeriod.count > 0
                ? ((data.comparison.currentPeriod.count - data.comparison.previousPeriod.count) / data.comparison.previousPeriod.count) * 100
                : data.comparison.currentPeriod.count > 0 ? 100 : 0),
              sub: `${formatNumber(data.comparison.currentPeriod.count - data.comparison.previousPeriod.count)} complaint delta`,
              tone: 'text-rose-700 bg-rose-50 border-rose-100',
            },
            { label: 'Avg Closure Movement', value: `${formatOneDecimal(data.comparison.currentPeriod.avgDays)}D`, sub: `LY ${formatOneDecimal(data.comparison.previousPeriod.avgDays)}D`, tone: 'text-blue-700 bg-blue-50 border-blue-100' },
          ].map((card) => (
            <div key={card.label} className={cn('rounded-2xl border p-4 shadow-sm', card.tone)}>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-75">{card.label}</p>
              <p className="mt-2 text-2xl font-black tracking-tight">{card.value}</p>
              <p className="mt-1 text-xs font-bold opacity-75">{card.sub}</p>
            </div>
          ))}
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="border border-slate-800 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Month</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">{data.comparison.previousYear} Count</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">{data.comparison.selectedYear} Count</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Growth / Degrowth</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">CY Open</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">CY Closed</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">CY Avg Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.charts.monthlyTrend.map((row) => (
                <tr key={row.month} className="bg-white hover:bg-slate-50">
                  <td className="border border-slate-200 px-4 py-3 text-sm font-black text-slate-900">{row.month}</td>
                  <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-slate-700">{formatNumber(row.lyCount)}</td>
                  <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-teal-700">{formatNumber(row.cyCount)}</td>
                  <td className={cn('border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black', growthClass(row.growthPct))}>
                    {formatGrowth(row.growthPct)}
                  </td>
                  <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-rose-700">{formatNumber(row.cyOpen)}</td>
                  <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-emerald-700">{formatNumber(row.cyClosed)}</td>
                  <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-blue-700">{formatOneDecimal(row.cyAvgDays)}D</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.comparison.yearly.length > 0 && (
          <div className="border-t border-slate-100 p-5">
            <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Yearly Snapshot</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {data.comparison.yearly.map((year) => (
                <div key={year.year} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-lg font-black text-slate-950">{year.year}</p>
                  <p className="mt-1 text-2xl font-black text-teal-700">{formatNumber(year.total)}</p>
                  <p className="mt-2 text-[11px] font-bold text-slate-500">
                    Closed {formatNumber(year.closed)} / Open {formatNumber(year.open)} / Avg {formatOneDecimal(year.avgDays)}D
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Primary Complaint Areas</p>
              <h3 className="text-lg font-black tracking-tight text-slate-950">What customers complain about</h3>
            </div>
            {renderExpandButton('area-breakdown', 'Complaint Area Breakdown')}
          </div>
          <div className="h-[300px]">
            {renderChart('area-breakdown')}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Model Mix</p>
              <h3 className="text-lg font-black tracking-tight text-slate-950">Complaints by vehicle model</h3>
            </div>
            {renderExpandButton('model-mix', 'Model Complaint Mix')}
          </div>
          <div className="h-[300px]">
            {renderChart('model-mix')}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#023468]">Dealer Heat</p>
              <h3 className="text-lg font-black tracking-tight text-slate-950">Dealer complaint load</h3>
            </div>
            {renderExpandButton('dealer-performance', 'Dealer Complaint Load')}
          </div>
          <div className="h-[300px]">
            {renderChart('dealer-performance')}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Deep Dive Analysis</p>
          <h3 className="text-xl font-black tracking-tight text-slate-950">Sub-area and dealer resolution summary</h3>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="border border-slate-800 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Complaint Sub-Area</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Total</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Open</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Avg Days</th>
                <th className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.charts.subAreaBreakdown.map((row) => (
                <tr key={row.name} className="bg-white hover:bg-slate-50">
                  <td className="border border-slate-200 px-4 py-3 text-sm font-black text-slate-900">{row.name}</td>
                  <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black">{formatNumber(row.total)}</td>
                  <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-rose-700">{formatNumber(row.open)}</td>
                  <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-blue-700">{formatOneDecimal(row.avgDays)}D</td>
                  <td className="border border-slate-200 px-4 py-3 text-center">
                    <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black', row.open > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                      {row.open > 0 ? 'WATCH' : 'RESOLVED'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Channel Mix</p>
        <h3 className="text-xl font-black tracking-tight text-slate-950">Complaint source signals</h3>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {data.charts.sourceBreakdown.map((row) => {
            const max = Math.max(...data.charts.sourceBreakdown.map((item) => item.total), 1)
            return (
              <div key={row.source} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between text-xs font-black text-slate-700">
                  <span>{row.source}</span>
                  <span>{formatNumber(row.total)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max((row.total / max) * 100, 5)}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Complaint Register</p>
              <h3 className="text-xl font-black tracking-tight text-slate-950">Customer complaint details</h3>
            </div>
            {isDetailLoading && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Loading rows
              </span>
            )}
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Complaint</th>
                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Customer / Vehicle</th>
                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Dealer</th>
                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Area</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Days</th>
                <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data.rows || []).map((row) => {
                const isExpanded = expandedRows.has(row.complaintNo)
                const customerRemark = row.customerRemark || row.remarks
                return (
                  <React.Fragment key={`${row.complaintNo}-${row.id}`}>
                    <tr className="bg-white hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleRow(row.complaintNo)}
                          className="be-borderless-action inline-flex items-start gap-2 text-left transition hover:text-[#023468]"
                        >
                          <ChevronDown className={cn('mt-0.5 h-4 w-4 transition', !isExpanded && '-rotate-90')} />
                          <span>
                            <span className="block text-sm font-black text-slate-950">{row.complaintNo}</span>
                            <span className="mt-1 block text-[11px] font-bold text-slate-500">SR {row.srNo} / {formatDateLabel(row.complaintDate)}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-black text-slate-900">{row.customerName}</p>
                        <p className="mt-1 text-[11px] font-bold text-slate-500">{row.vehicleModel} / {row.variant}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-black text-slate-900">{truncateLabel(row.dealerName, 32)}</p>
                        <p className="mt-1 text-[11px] font-bold text-slate-500">{row.dealerCode} / {row.region}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-black text-slate-900">{row.signalArea}</p>
                        <p className="mt-1 text-[11px] font-bold text-slate-500">{row.srSubArea}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black', riskClass(row.resolutionDays, row.statusGroup))}>
                          {row.resolutionDays}D
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black', statusClass(row.statusGroup))}>
                          {row.statusGroup}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={6} className="border border-slate-200 px-4 py-4">
                          <div className="grid gap-4 xl:grid-cols-[0.8fr_1.4fr_0.8fr]">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vehicle & Contact</p>
                              <div className="mt-3 space-y-3 text-xs font-bold text-slate-600">
                                <p className="flex items-center gap-2"><CarFront className="h-3.5 w-3.5 text-teal-700" /> VIN {row.vinNo}</p>
                                <p className="flex items-center gap-2"><PhoneCall className="h-3.5 w-3.5 text-teal-700" /> {row.mobileNo}</p>
                                <p className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-teal-700" /> {row.resolvedByDealer}</p>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Customer Remark</p>
                              <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-6 text-slate-700">
                                {customerRemark || 'No customer remark captured.'}
                              </p>
                              {row.observation && (
                                <p className="mt-3 rounded-xl border border-teal-100 bg-teal-50 p-3 text-xs font-bold leading-5 text-teal-800">
                                  {row.observation}
                                </p>
                              )}
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Resolution Timeline</p>
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <div className="rounded-xl bg-slate-50 p-3 text-center">
                                  <p className="text-[9px] font-black uppercase text-slate-400">Opened</p>
                                  <p className="mt-1 text-xs font-black text-slate-900">{formatDateLabel(row.complaintDate)}</p>
                                </div>
                                <div className="rounded-xl bg-slate-50 p-3 text-center">
                                  <p className="text-[9px] font-black uppercase text-slate-400">Closed</p>
                                  <p className="mt-1 text-xs font-black text-slate-900">{formatDateLabel(row.closeDate)}</p>
                                </div>
                              </div>
                              <div className="mt-3 rounded-xl border border-slate-200 p-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Categorization</p>
                                <p className="mt-2 text-xs font-black text-slate-900">{row.srArea} / {row.srSubArea}</p>
                                <p className="mt-1 text-[11px] font-bold text-slate-500">{row.dealerArea} / {row.dealerSubArea}</p>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                    {isDetailLoading ? 'Loading complaint rows...' : 'No complaints match the current filters.'}
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
