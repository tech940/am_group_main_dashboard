'use client'

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  CalendarDays,
  CarFront,
  Download,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
  Filter,
  XCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { logApiTimings } from '@/lib/api/client-timing'
import { cn } from '@/lib/utils'
import type {
  KiaStockDateMode,
  KiaStockFreshnessPayload,
  KiaStockReportPayload,
  KiaStockSummaryPayload,
  KiaStockTab,
} from '@/lib/kia/stock-report-types'

function isInputDate(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'NA'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateRangeLabel(startDate: string | null | undefined, endDate: string | null | undefined) {
  if (!isInputDate(startDate) || !isInputDate(endDate)) return null
  if (startDate === endDate) return formatDate(startDate)
  return `${formatDate(startDate)} - ${formatDate(endDate)}`
}

type SearchParamsInput = Record<string, string | string[] | undefined>

const PAGE_TABS: Array<{ key: KiaStockTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'models', label: 'Models' },
  { key: 'dealers', label: 'Dealers' },
  { key: 'movement', label: 'Movement' },
  { key: 'aging', label: 'Aging' },
  { key: 'reports', label: 'Reports' },
]

const DATE_MODE_OPTIONS: Array<{ value: KiaStockDateMode; label: string }> = [
  { value: 'grn_date', label: 'GRN date' },
  { value: 'departure_date', label: 'Departure date' },
  { value: 'order_date', label: 'Order date' },
  { value: 'retail_date', label: 'Retail date' },
]

const COLORS = ['#c5162f', '#071a2b', '#18a7d0', '#269442', '#8835a7', '#f07c1a', '#d76478']
const SURFACE = 'rounded-[2rem] border border-[#d5dfea] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]'
const PAGE_BACKGROUND = 'bg-[linear-gradient(180deg,#edf3f9_0%,#eef3f8_42%,#e7eef6_100%)]'

function firstParam(params: SearchParamsInput, key: string) {
  const value = params[key]
  return Array.isArray(value) ? value[0] : value
}

function buildQueryString(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === 'all') continue
    searchParams.set(key, String(value))
  }
  return searchParams.toString()
}

function monthParts(key: string | null) {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return { year: null, month: null }
  const [year, month] = key.split('-').map(Number)
  return { year, month }
}

async function fetchJson<T>(url: string, label: string) {
  const response = await fetch(url, { cache: 'no-store' })
  logApiTimings(response, label)
  if (!response.ok) throw new Error(`Request failed for ${label}`)
  return await response.json() as T
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Updated NA'
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
}

function formatMoney(value: number) {
  if (Math.abs(value) >= 10000000) return `Rs ${(value / 10000000).toFixed(2)}Cr`
  if (Math.abs(value) >= 100000) return `Rs ${(value / 100000).toFixed(2)}L`
  return `Rs ${Math.round(value).toLocaleString('en-IN')}`
}

function toColumnLabel(column: string) {
  return column.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-[1.5rem] bg-white/70', className)} />
}

function ChartEmpty({ label = 'No stock data' }: { label?: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center rounded-[1.5rem] bg-slate-50 text-center">
      <BarChart3 className="mb-3 h-8 w-8 text-slate-300" />
      <p className="font-black text-slate-950">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-500">Try a different dealer, date mode, or month.</p>
    </div>
  )
}

function BarPanel({ title, subtitle, data }: { title: string; subtitle?: string; data: Array<{ name: string; value: number }> }) {
  return (
    <Card className={SURFACE}>
      <CardHeader>
        <CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[#c5162f]">{title}</CardTitle>
        {subtitle ? <p className="text-sm font-semibold text-slate-500">{subtitle}</p> : null}
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#071a2b" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <ChartEmpty />}
      </CardContent>
    </Card>
  )
}

function DonutPanel({ title, subtitle, data }: { title: string; subtitle?: string; data: Array<{ name: string; value: number }> }) {
  return (
    <Card className={SURFACE}>
      <CardHeader>
        <CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[#c5162f]">{title}</CardTitle>
        {subtitle ? <p className="text-sm font-semibold text-slate-500">{subtitle}</p> : null}
      </CardHeader>
      <CardContent>
        {data.some((item) => item.value > 0) ? (
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={2}>
                    {data.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 self-center">
              {data.map((item, index) => (
                <div key={item.name} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black">
                  <span className="flex items-center gap-2 text-slate-700"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{item.name}</span>
                  <span className="text-slate-950">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : <ChartEmpty />}
      </CardContent>
    </Card>
  )
}

function VehicleTable({ title, rows }: { title: string; rows: KiaStockSummaryPayload['overview']['highValue'] }) {
  return (
    <Card className={SURFACE}>
      <CardHeader>
        <CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[#c5162f]">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#071a2b] hover:bg-[#071a2b]">
                {['Dealer', 'Status', 'Model', 'VIN', 'Age', 'Value'].map((heading) => (
                  <TableHead key={heading} className="text-[11px] font-black uppercase tracking-[0.18em] text-white">{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={`${row.rowKey}-${index}`} className="text-[13px]">
                  <TableCell className="font-black text-[#c5162f]">{row.dealer}</TableCell>
                  <TableCell><Badge variant="outline">{row.stockStatus}</Badge></TableCell>
                  <TableCell className="font-bold">{row.model}<div className="text-xs text-slate-500">{row.variant}</div></TableCell>
                  <TableCell className="font-mono text-xs">{row.vin || '-'}</TableCell>
                  <TableCell>{row.stockAge}D</TableCell>
                  <TableCell className="font-black">{formatMoney(row.stockValue)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="py-8 text-center font-bold text-slate-500">No rows found.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

export function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4 mt-6">
      <h2 className="text-xl font-black tracking-tight text-slate-900 md:text-2xl">{title}</h2>
      {description && <p className="text-sm font-semibold text-slate-500 mt-1">{description}</p>}
    </div>
  )
}

export function KiaStockReportPage({ initialSearchParams }: { initialSearchParams: SearchParamsInput }) {
  const router = useRouter()
  const pathname = usePathname()
  const [activeTab, setActiveTab] = useState<KiaStockTab>((firstParam(initialSearchParams, 'tab') as KiaStockTab) || 'overview')
  const [selectedYear, setSelectedYear] = useState<number | null>((() => {
    const raw = Number(firstParam(initialSearchParams, 'year'))
    return Number.isFinite(raw) ? raw : null
  })())
  const [selectedMonth, setSelectedMonth] = useState<number | null>((() => {
    const raw = Number(firstParam(initialSearchParams, 'month'))
    return Number.isFinite(raw) ? Math.max(0, raw - 1) : null
  })())
  const [selectedStartDate, setSelectedStartDate] = useState<string>(() => {
    const raw = firstParam(initialSearchParams, 'startDate')
    return isInputDate(raw) ? raw as string : ''
  })
  const [selectedEndDate, setSelectedEndDate] = useState<string>(() => {
    const raw = firstParam(initialSearchParams, 'endDate')
    return isInputDate(raw) ? raw as string : ''
  })
  const [selectedDealer, setSelectedDealer] = useState(firstParam(initialSearchParams, 'dealer_code') || 'all')
  const [dateMode, setDateMode] = useState<KiaStockDateMode>((firstParam(initialSearchParams, 'dateMode') as KiaStockDateMode) || 'grn_date')
  const [status, setStatus] = useState(firstParam(initialSearchParams, 'status') || 'all')
  const [model, setModel] = useState(firstParam(initialSearchParams, 'model') || 'all')
  const [search, setSearch] = useState(firstParam(initialSearchParams, 'search') || '')
  const [page, setPage] = useState(Number(firstParam(initialSearchParams, 'page')) || 1)
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({})
  const [reportSort, setReportSort] = useState(firstParam(initialSearchParams, 'sort') || '')
  const [reportDirection, setReportDirection] = useState<'asc' | 'desc'>((firstParam(initialSearchParams, 'direction') || 'desc') === 'asc' ? 'asc' : 'desc')

  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [monthPickerView, setMonthPickerView] = useState(() => new Date())
  const [pendingStartDate, setPendingStartDate] = useState('')
  const [pendingEndDate, setPendingEndDate] = useState('')

  const deferredSearch = useDeferredValue(search)

  const freshnessQuery = useQuery({
    queryKey: ['kia-stock-report-freshness', selectedDealer],
    queryFn: () => fetchJson<KiaStockFreshnessPayload>(`/api/brands/kia/stock-report/freshness?${buildQueryString({ dealer_code: selectedDealer })}`, 'kia-stock-report-freshness'),
    staleTime: 60_000,
  })

  // Set default month if none is selected
  useEffect(() => {
    if (selectedYear === null && selectedMonth === null && !selectedStartDate && !selectedEndDate) {
      const firstMonth = freshnessQuery.data?.availableMonths[0]
      if (firstMonth) {
        setSelectedYear(firstMonth.year)
        setSelectedMonth(firstMonth.month)
      }
    }
  }, [freshnessQuery.data, selectedMonth, selectedYear, selectedStartDate, selectedEndDate])

  const effectiveSelectedMonthOption = freshnessQuery.data?.availableMonths.find(
    (item) => item.year === selectedYear && item.month === selectedMonth
  ) || freshnessQuery.data?.availableMonths[0]
  const effectiveSelectedYear = effectiveSelectedMonthOption?.year ?? selectedYear
  const effectiveSelectedMonth = effectiveSelectedMonthOption?.month ?? selectedMonth
  const hasCompleteCustomRange = isInputDate(selectedStartDate) && isInputDate(selectedEndDate)
  const customRangeLabel = formatDateRangeLabel(selectedStartDate, selectedEndDate)
  const selectedRangeStart = hasCompleteCustomRange && selectedStartDate <= selectedEndDate ? selectedStartDate : selectedEndDate
  const selectedRangeEnd = hasCompleteCustomRange && selectedStartDate <= selectedEndDate ? selectedEndDate : selectedStartDate
  const periodQueryParams = hasCompleteCustomRange
    ? {
        startDate: selectedRangeStart,
        endDate: selectedRangeEnd,
      }
    : {
        year: effectiveSelectedYear,
        month: effectiveSelectedMonth !== null ? effectiveSelectedMonth + 1 : null,
      }
  const periodReady = hasCompleteCustomRange || (effectiveSelectedYear !== null && effectiveSelectedMonth !== null)

  const summaryQuery = useQuery({
    queryKey: [
      'kia-stock-report-summary',
      hasCompleteCustomRange ? selectedRangeStart : effectiveSelectedYear,
      hasCompleteCustomRange ? selectedRangeEnd : effectiveSelectedMonth,
      selectedDealer,
      dateMode,
    ],
    queryFn: () => fetchJson<KiaStockSummaryPayload>(`/api/brands/kia/stock-report/summary?${buildQueryString({
      ...periodQueryParams,
      dealer_code: selectedDealer,
      dateMode,
    })}`, 'kia-stock-report-summary'),
    enabled: periodReady,
    staleTime: 30_000,
  })

  const reportQuery = useQuery({
    queryKey: [
      'kia-stock-report-table',
      hasCompleteCustomRange ? selectedRangeStart : effectiveSelectedYear,
      hasCompleteCustomRange ? selectedRangeEnd : effectiveSelectedMonth,
      selectedDealer,
      dateMode,
      status,
      model,
      deferredSearch,
      page,
      columnFilters,
      reportSort,
      reportDirection,
    ],
    queryFn: () => {
      const filterParams: Record<string, string> = {}
      Object.entries(columnFilters).forEach(([col, vals]) => {
        if (vals && vals.length > 0) {
          filterParams[`filter_${col}`] = vals.map(encodeURIComponent).join(',')
        }
      })
      return fetchJson<KiaStockReportPayload>(`/api/brands/kia/stock-report/reports?${buildQueryString({
        ...periodQueryParams,
        dealer_code: selectedDealer,
        dateMode,
        status,
        model,
        search: deferredSearch,
        page,
        pageSize: 10,
        sort: reportSort,
        direction: reportDirection,
        ...filterParams,
      })}`, 'kia-stock-report-reports')
    },
    enabled: activeTab === 'reports' && periodReady,
    staleTime: 15_000,
  })

  // Reset column filters when date or dealer changes
  useEffect(() => {
    setColumnFilters({})
    setPage(1)
  }, [selectedDealer, selectedYear, selectedMonth, selectedStartDate, selectedEndDate])

  useEffect(() => {
    const params = new URLSearchParams()
    if (activeTab !== 'overview') params.set('tab', activeTab)
    if (hasCompleteCustomRange) {
      params.set('startDate', selectedRangeStart)
      params.set('endDate', selectedRangeEnd)
    } else {
      if (effectiveSelectedYear !== null) params.set('year', String(effectiveSelectedYear))
      if (effectiveSelectedMonth !== null) params.set('month', String(effectiveSelectedMonth + 1))
    }
    if (selectedDealer !== 'all') params.set('dealer_code', selectedDealer)
    if (dateMode !== 'grn_date') params.set('dateMode', dateMode)
    if (status !== 'all') params.set('status', status)
    if (model !== 'all') params.set('model', model)
    if (search) params.set('search', search)
    if (page > 1) params.set('page', String(page))

    startTransition(() => {
      router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false })
    })
  }, [activeTab, effectiveSelectedMonth, effectiveSelectedYear, hasCompleteCustomRange, pathname, router, selectedDealer, selectedRangeEnd, selectedRangeStart, dateMode, status, model, search, page])

  const isLoadingSummary = summaryQuery.isLoading || summaryQuery.isFetching || !summaryQuery.data
  const summary = summaryQuery.data
  const report = reportQuery.data
  const modelOptions = useMemo(() => summary?.overview.modelMix.map((item) => item.name) || [], [summary])
  const displayedColumns = report?.defaultVisibleColumns?.length ? report.defaultVisibleColumns : report?.columns.slice(0, 10) || []

  const handleRefresh = () => {
    freshnessQuery.refetch()
    summaryQuery.refetch()
    reportQuery.refetch()
  }

  const handleExport = async () => {
    const filterParams: Record<string, string> = {}
    Object.entries(columnFilters).forEach(([col, vals]) => {
      if (vals && vals.length > 0) {
        filterParams[`filter_${col}`] = vals.map(encodeURIComponent).join(',')
      }
    })
    const response = await fetch(`/api/brands/kia/stock-report/reports?${buildQueryString({
      ...periodQueryParams,
      dealer_code: selectedDealer,
      dateMode,
      status,
      model,
      search,
      format: 'csv',
      ...filterParams,
    })}`)
    logApiTimings(response, 'kia-stock-report-export')
    if (!response.ok) return
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'kia-stock-report.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleMonthChange(key: string) {
    const month = freshnessQuery.data?.availableMonths.find((item) => item.key === key)
    if (!month) return
    setSelectedYear(month.year)
    setSelectedMonth(month.month)
    setSelectedStartDate('')
    setSelectedEndDate('')
    setPendingStartDate('')
    setPendingEndDate('')
    setPage(1)
    setMonthPickerOpen(false)
  }

  function handleCalendarDateClick(dateKey: string) {
    if (!availableMonthKeys.has(dateKey.slice(0, 7))) return

    if (!pendingStartDate || (pendingStartDate && pendingEndDate)) {
      setPendingStartDate(dateKey)
      setPendingEndDate('')
      return
    }

    const start = pendingStartDate <= dateKey ? pendingStartDate : dateKey
    const end = pendingStartDate <= dateKey ? dateKey : pendingStartDate
    setPendingStartDate(start)
    setPendingEndDate(end)
  }

  function applyCustomDateRange() {
    if (!pendingStartDate || !pendingEndDate) return
    setSelectedStartDate(pendingStartDate)
    setSelectedEndDate(pendingEndDate)
    setSelectedYear(Number(pendingEndDate.slice(0, 4)))
    setSelectedMonth(Number(pendingEndDate.slice(5, 7)) - 1)
    setPage(1)
    setMonthPickerOpen(false)
  }

  function clearCustomDateRange() {
    setPendingStartDate('')
    setPendingEndDate('')
    setSelectedStartDate('')
    setSelectedEndDate('')
    setPage(1)
  }

  const availableMonthKeys = new Set((freshnessQuery.data?.availableMonths || []).map((item) => item.key))
  const monthPickerViewLabel = monthPickerView.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const monthPickerGridStart = (() => {
    const monthStart = new Date(monthPickerView.getFullYear(), monthPickerView.getMonth(), 1)
    const gridStart = new Date(monthStart)
    gridStart.setDate(monthStart.getDate() - monthStart.getDay())
    return gridStart
  })()
  const monthPickerDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(monthPickerGridStart)
    date.setDate(monthPickerGridStart.getDate() + index)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      date,
      dateKey: `${monthKey}-${String(date.getDate()).padStart(2, '0')}`,
      monthKey,
      inCurrentMonth: date.getMonth() === monthPickerView.getMonth(),
      isAvailable: availableMonthKeys.has(monthKey),
    }
  })
  const today = new Date()
  const todayMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const todayDateKey = `${todayMonthKey}-${String(today.getDate()).padStart(2, '0')}`
  const selectedMonthDateKey = effectiveSelectedMonthOption
    ? `${effectiveSelectedMonthOption.year}-${String(effectiveSelectedMonthOption.month + 1).padStart(2, '0')}-${String(
      effectiveSelectedMonthOption.year === today.getFullYear() && effectiveSelectedMonthOption.month === today.getMonth()
        ? today.getDate()
        : 1
    ).padStart(2, '0')}`
    : ''

  return (
    <MainLayout title="Stock Report" subtitle="AM Kia stock analytics workspace">
      <div className={cn('-m-4 min-h-screen p-4 md:-m-6 md:p-6', PAGE_BACKGROUND)}>
        <section className={cn(SURFACE, 'overflow-hidden p-6 md:p-8')}>
          <div className="grid gap-6 lg:grid-cols-[1fr_560px]">
            <div>
              <Badge className="rounded-full bg-[#e8f7ff] px-4 py-2 text-[#0073b5] hover:bg-[#e8f7ff]">
                <PackageCheck className="mr-2 h-4 w-4" /> AM Kia Stock
              </Badge>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">Stock Report</h1>
              <p className="mt-2 max-w-3xl text-base font-semibold leading-7 text-slate-600">
                Current unsold vehicle stock, transit pipeline, stock value, model mix, dealer split, and purchase report drill-downs.
              </p>
              <p className="mt-3 text-sm font-black uppercase tracking-[0.2em] text-slate-500">
                {formatDateTime(summary?.context.updatedAt || freshnessQuery.data?.sourceUpdatedAt)}
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/70 bg-white/85 p-4 shadow-inner">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Month</span>
                  <DropdownMenu
                    open={monthPickerOpen}
                    onOpenChange={(open) => {
                      setMonthPickerOpen(open)
                      if (open) {
                        setPendingStartDate(selectedStartDate)
                        setPendingEndDate(selectedEndDate)
                        const anchorDate = selectedEndDate || selectedStartDate
                        const parsedAnchor = anchorDate ? new Date(`${anchorDate}T00:00:00`) : null
                        setMonthPickerView(new Date(
                          parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
                            ? parsedAnchor.getFullYear()
                            : effectiveSelectedMonthOption?.year ?? today.getFullYear(),
                          parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
                            ? parsedAnchor.getMonth()
                            : effectiveSelectedMonthOption?.month ?? today.getMonth(),
                          1,
                        ))
                      }
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" className="h-12 w-full justify-between rounded-2xl border-[#d5dfea] bg-white px-4 text-[14px] font-bold text-slate-900 shadow-sm hover:bg-white">
                        <span className="inline-flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-slate-400" />
                          {customRangeLabel || effectiveSelectedMonthOption?.label || 'Select dates'}
                        </span>
                        <ChevronDown className="h-4 w-4 text-slate-500" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[340px] rounded-[1.5rem] border border-[#d8e2ec] bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d8e2ec] bg-white text-slate-600 transition hover:border-[#071a2b]/35 hover:text-[#071a2b]"
                            onClick={() => setMonthPickerView((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                            aria-label="Previous month"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <div className="text-center">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Select date range</p>
                            <p className="mt-1 text-[15px] font-black text-slate-950">{monthPickerViewLabel}</p>
                          </div>
                          <button
                            type="button"
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d8e2ec] bg-white text-slate-600 transition hover:border-[#071a2b]/35 hover:text-[#071a2b]"
                            onClick={() => setMonthPickerView((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                            aria-label="Next month"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                            <div key={`${day}-${index}`} className="py-1">{day}</div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1">
                          {monthPickerDays.map((day) => {
                            const hasPendingRange = isInputDate(pendingStartDate) && isInputDate(pendingEndDate)
                            const pendingRangeStart = hasPendingRange && pendingStartDate <= pendingEndDate ? pendingStartDate : pendingEndDate
                            const pendingRangeEnd = hasPendingRange && pendingStartDate <= pendingEndDate ? pendingEndDate : pendingStartDate
                            const isSelected = hasPendingRange
                              ? day.dateKey === pendingRangeStart || day.dateKey === pendingRangeEnd
                              : !hasCompleteCustomRange
                                ? day.dateKey === selectedMonthDateKey || day.dateKey === pendingStartDate
                                : day.dateKey === selectedRangeStart || day.dateKey === selectedRangeEnd
                            const isInSelectedRange = hasPendingRange
                              ? day.dateKey > pendingRangeStart && day.dateKey < pendingRangeEnd
                              : hasCompleteCustomRange && day.dateKey > selectedRangeStart && day.dateKey < selectedRangeEnd
                            const isToday = day.dateKey === todayDateKey
                            return (
                              <button
                                key={day.dateKey}
                                type="button"
                                disabled={!day.isAvailable}
                                className={cn(
                                  'flex h-10 items-center justify-center rounded-xl text-[12px] font-black transition',
                                  day.inCurrentMonth ? 'text-slate-700' : 'text-slate-300',
                                  day.isAvailable
                                    ? 'hover:bg-[#edf4fb] hover:text-[#071a2b]'
                                    : 'cursor-not-allowed opacity-35',
                                  isInSelectedRange && 'bg-[#e6f2fb] text-[#071a2b]',
                                  isToday && 'ring-2 ring-[#18a7d0]/50 ring-offset-2',
                                  isSelected && 'bg-[#071a2b] text-white shadow-[0_10px_18px_rgba(7,26,43,0.18)] hover:bg-[#071a2b]'
                                )}
                                onClick={() => handleCalendarDateClick(day.dateKey)}
                              >
                                {day.date.getDate()}
                              </button>
                            )
                          })}
                        </div>

                        <div className="space-y-2">
                          <div className="rounded-[1.1rem] border border-[#e4ebf2] bg-[#f8fbfd] px-3 py-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                              {pendingStartDate && !pendingEndDate ? 'Pick end date' : 'Date range'}
                            </p>
                            <p className="mt-1 text-[13px] font-semibold text-slate-700">
                              {pendingStartDate && pendingEndDate
                                ? `${formatDate(pendingStartDate)} – ${formatDate(pendingEndDate)}`
                                : pendingStartDate
                                  ? `Start: ${formatDate(pendingStartDate)}`
                                  : 'Click a start day, then an end day.'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className={cn(
                                'flex-1 rounded-full border px-3 py-1 text-[11px] font-black shadow-none',
                                availableMonthKeys.has(todayMonthKey)
                                  ? 'border-[#18a7d0]/35 bg-white text-[#0f5e97] hover:bg-white'
                                  : 'border-[#d8e2ec] bg-white text-slate-400 hover:bg-white'
                              )}
                              onClick={() => {
                                if (!availableMonthKeys.has(todayMonthKey)) return
                                handleMonthChange(todayMonthKey)
                              }}
                              disabled={!availableMonthKeys.has(todayMonthKey)}
                            >
                              Current month
                            </Button>
                            {(pendingStartDate || pendingEndDate || selectedStartDate || selectedEndDate) && (
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-full border border-rose-200 bg-white px-3 py-1 text-[11px] font-black text-rose-500 shadow-none hover:bg-rose-50"
                                onClick={clearCustomDateRange}
                              >
                                Clear
                              </Button>
                            )}
                            <Button
                              type="button"
                              disabled={!(pendingStartDate && pendingEndDate)}
                              className={cn(
                                'rounded-full px-4 py-1 text-[11px] font-black shadow-none',
                                pendingStartDate && pendingEndDate
                                  ? 'bg-[#071a2b] text-white hover:bg-[#071a2b]/90'
                                  : 'cursor-not-allowed bg-slate-200 text-slate-400'
                              )}
                              onClick={applyCustomDateRange}
                            >
                              Apply
                            </Button>
                          </div>
                        </div>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <label className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Dealer</span>
                  <Select value={selectedDealer} onValueChange={(value) => { setSelectedDealer(value); setPage(1) }}>
                    <SelectTrigger className="h-12 rounded-2xl bg-white font-bold"><SelectValue placeholder="All dealers" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All dealers</SelectItem>
                      {(freshnessQuery.data?.dealerOptions || []).map((dealer) => <SelectItem key={dealer} value={dealer}>{dealer}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Date mode</span>
                  <Select value={dateMode} onValueChange={(value) => { setDateMode(value as KiaStockDateMode); setPage(1) }}>
                    <SelectTrigger className="h-12 rounded-2xl bg-white font-bold"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DATE_MODE_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <Button onClick={handleRefresh} className="mt-7 h-12 rounded-2xl bg-[#071a2b] font-black text-white hover:bg-[#102b46]">
                  <RefreshCw className={cn('mr-2 h-4 w-4', (summaryQuery.isFetching || freshnessQuery.isFetching) && 'animate-spin')} /> Refresh
                </Button>
              </div>
            </div>
          </div>
        </section>

        <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value as KiaStockTab) }} className="mt-6">
          <TabsList className="flex h-auto flex-wrap justify-start gap-3 rounded-[2rem] border border-[#bfd0e4] bg-white/75 p-3">
            {PAGE_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="rounded-2xl px-6 py-3 text-sm font-black data-[state=active]:bg-[#071a2b] data-[state=active]:text-white">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="mt-6 space-y-6">
            {isLoadingSummary ? (
               <>
                 <div className="grid gap-4 md:grid-cols-3"><SkeletonBlock className="h-36" /><SkeletonBlock className="h-36" /><SkeletonBlock className="h-36" /></div>
                 <SkeletonBlock className="h-96" />
               </>
            ) : summary ? (
              <>
                <SectionHeading title="Key Inventory Metrics" description="Current summary of available stock, pipeline, and average age" />
                <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                  {summary.overview.kpis.map((kpi, index) => (
                    <Card key={kpi.label} className={cn(SURFACE, 'border-t-[5px]')} style={{ borderTopColor: COLORS[index % COLORS.length] }}>
                      <CardContent className="p-5">
                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{kpi.label}</p>
                        <p className="mt-4 text-3xl font-black text-slate-950">{kpi.formattedValue}</p>
                        <p className="mt-2 text-xs font-bold text-slate-500">{kpi.helper}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <SectionHeading title="Stock Mix & Distribution" description="Analysis of current inventory by status, model mix, dealer location, and aging buckets" />
                <div className="grid gap-6 xl:grid-cols-2">
                  <DonutPanel title="Status Mix" subtitle="Only available stock contributes to stock KPIs" data={summary.overview.statusMix} />
                  <BarPanel title="Model Mix" subtitle="Current available stock by model" data={summary.overview.modelMix} />
                  <BarPanel title="Dealer Split" subtitle="Dealer-level available stock" data={summary.overview.dealerSplit} />
                  <BarPanel title="Aging Buckets" subtitle="Current stock age distribution" data={summary.overview.agingBuckets} />
                </div>

                <SectionHeading title="Stock Highlights" description="Detailed list of high value and slow moving inventory requiring attention" />
                <div className="grid gap-6 xl:grid-cols-2">
                  <VehicleTable title="High Value Stock" rows={summary.overview.highValue} />
                  <VehicleTable title="Slow Moving Stock" rows={summary.overview.slowMoving} />
                </div>
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="models" className="mt-6 space-y-6">
            {isLoadingSummary ? <SkeletonBlock className="h-96" /> : summary ? (
              <>
                <div className="grid gap-5 xl:grid-cols-3">
                  {summary.models.cards.map((card, index) => (
                    <Card key={card.model} className={cn(SURFACE, 'border-t-[5px]')} style={{ borderTopColor: COLORS[index % COLORS.length] }}>
                      <CardHeader>
                        <CardTitle className="text-xl font-black text-slate-950">{card.model}</CardTitle>
                        <p className="text-sm font-semibold text-slate-500">{card.units} units · avg age {card.avgAge}D · {formatMoney(card.stockValue)}</p>
                      </CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                        <div>
                          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Variants</p>
                          {card.variants.map((item) => <div key={item.name} className="mb-2 flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold"><span>{item.name}</span><span>{item.value}</span></div>)}
                        </div>
                        <div>
                          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Colors</p>
                          {card.colors.map((item) => <div key={item.name} className="mb-2 flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold"><span>{item.name}</span><span>{item.value}</span></div>)}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="dealers" className="mt-6">
            {isLoadingSummary ? <SkeletonBlock className="h-96" /> : summary ? (
              <Card className={SURFACE}>
                <CardHeader><CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[#c5162f]">Dealer Stock Position</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow className="bg-[#071a2b] hover:bg-[#071a2b]">{['Dealer', 'Available', 'Free', 'Transit', 'Value', 'Avg Age'].map((heading) => <TableHead key={heading} className="text-white">{heading}</TableHead>)}</TableRow></TableHeader>
                    <TableBody>
                      {summary.dealers.rows.map((row) => (
                        <TableRow key={row.dealer} className="text-sm">
                          <TableCell className="font-black text-[#c5162f]">{row.dealer}</TableCell>
                          <TableCell className="font-black">{row.total}</TableCell>
                          <TableCell>{row.freeStock}</TableCell>
                          <TableCell>{row.inTransit}</TableCell>
                          <TableCell>{formatMoney(row.stockValue)}</TableCell>
                          <TableCell>{row.avgAge}D</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="movement" className="mt-6 space-y-6">
            {isLoadingSummary ? <SkeletonBlock className="h-96" /> : summary ? (
              <div className="grid gap-6 xl:grid-cols-2">
                <BarPanel title="Daily Movement" subtitle={`${summary.context.selectedMonthLabel} by ${DATE_MODE_OPTIONS.find((item) => item.value === summary.context.dateMode)?.label}`} data={summary.movement.arrivals} />
                <DonutPanel title="Period Status Counts" subtitle="All statuses are shown here for movement context" data={summary.movement.statusCounts} />
                <Card className={cn(SURFACE, 'xl:col-span-2')}>
                  <CardHeader><CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[#c5162f]">Monthly Movement</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow className="bg-[#071a2b] hover:bg-[#071a2b]">{['Month', 'Available statuses', 'Retail', 'Transfers', 'Test Drive'].map((heading) => <TableHead key={heading} className="text-white">{heading}</TableHead>)}</TableRow></TableHeader>
                      <TableBody>{summary.movement.monthly.map((row) => <TableRow key={row.month}><TableCell className="font-black">{row.month}</TableCell><TableCell>{row.arrivals}</TableCell><TableCell>{row.retail}</TableCell><TableCell>{row.transfers}</TableCell><TableCell>{row.testDrive}</TableCell></TableRow>)}</TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="aging" className="mt-6 space-y-6">
            {isLoadingSummary ? <SkeletonBlock className="h-96" /> : summary ? (
              <div className="grid gap-6 xl:grid-cols-2">
                <BarPanel title="Aging Distribution" subtitle="Current available stock age buckets" data={summary.aging.buckets} />
                <Card className={SURFACE}>
                  <CardHeader><CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[#c5162f]">Oldest Average Age By Model</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {summary.aging.byModel.slice(0, 10).map((item) => <div key={item.model} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 font-bold"><span>{item.model}</span><span>{item.avgAge}D · {item.units} units</span></div>)}
                  </CardContent>
                </Card>
                <div className="xl:col-span-2"><VehicleTable title="Oldest Vehicles" rows={summary.aging.rows} /></div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="reports" className="mt-6 space-y-4">
            <Card className={SURFACE}>
              <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_180px_180px_auto]">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search VIN, model, variant, customer..." className="h-12 rounded-2xl bg-white pl-11 font-semibold" />
                </div>
                <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1) }}>
                  <SelectTrigger className="h-12 rounded-2xl bg-white font-bold"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All statuses</SelectItem>{(freshnessQuery.data?.statusOptions || []).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={model} onValueChange={(value) => { setModel(value); setPage(1) }}>
                  <SelectTrigger className="h-12 rounded-2xl bg-white font-bold"><SelectValue placeholder="Model" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All models</SelectItem>{modelOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={handleExport} className="h-12 rounded-2xl bg-[#071a2b] font-black text-white hover:bg-[#102b46]"><Download className="mr-2 h-4 w-4" /> Export</Button>
              </CardContent>
            </Card>

            <Card className={SURFACE}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[#c5162f]">Purchase Report Rows</CardTitle>
                  <p className="mt-1 text-sm font-semibold text-slate-500">10 rows per page · date mode: {DATE_MODE_OPTIONS.find((item) => item.value === dateMode)?.label}</p>
                </div>
                {reportQuery.isFetching ? <Loader2 className="h-5 w-5 animate-spin text-[#c5162f]" /> : null}
              </CardHeader>
              <CardContent>
                {reportQuery.isLoading ? <SkeletonBlock className="h-96" /> : (
                  <>
                    <div className="overflow-x-auto">
                      <Table className="[&_td]:text-[11px] [&_td]:font-medium [&_th]:text-[10px]">
                        <TableHeader>
                          <TableRow className="border-b-2 border-[#071a2b] bg-white hover:bg-white">
                            {displayedColumns.map((column) => (
                              <TableHead key={column} className="px-4 py-2 text-[10px] font-black text-[#25303b]">
                                <ColumnFilterDropdown
                                  column={column}
                                  label={toColumnLabel(column)}
                                  uniqueValues={reportQuery.data?.uniqueValues?.[column] || []}
                                  activeFilters={columnFilters[column] || []}
                                  onApply={(values) => {
                                    setColumnFilters((prev) => ({
                                      ...prev,
                                      [column]: values,
                                    }))
                                    setPage(1)
                                  }}
                                  onSort={(direction) => {
                                    setReportSort(column)
                                    setReportDirection(direction)
                                    setPage(1)
                                  }}
                                  isSortedAsc={reportSort === column && reportDirection === 'asc'}
                                  isSortedDesc={reportSort === column && reportDirection === 'desc'}
                                />
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(report?.rows || []).map((row, rowIndex) => (
                            <TableRow key={`${row.id || row.vin_no || rowIndex}-${rowIndex}`} className="odd:bg-[#f6f9fd] even:bg-white text-[12px]">
                              {displayedColumns.map((column) => (
                                <TableCell key={column} className="max-w-[220px] truncate font-semibold text-slate-700" title={String(row[column] ?? '')}>
                                  {String(row[column] ?? '-')}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                          {!report?.rows?.length ? <TableRow><TableCell colSpan={displayedColumns.length || 1} className="py-10 text-center font-bold text-slate-500">No report rows found.</TableCell></TableRow> : null}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-500">Page {report?.pagination.page || 1} of {report?.pagination.totalPages || 1} · {report?.pagination.totalRows || 0} rows</p>
                      <div className="flex gap-2">
                        <Button variant="outline" disabled={(report?.pagination.page || 1) <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-2xl bg-white font-black">Previous</Button>
                        <Button variant="outline" disabled={(report?.pagination.page || 1) >= (report?.pagination.totalPages || 1)} onClick={() => setPage((p) => p + 1)} className="rounded-2xl bg-white font-black">Next</Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {summaryQuery.error ? (
          <div className="mt-6 rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 font-bold text-rose-700">
            Unable to load KIA Stock Report: {summaryQuery.error instanceof Error ? summaryQuery.error.message : 'Unknown error'}
          </div>
        ) : null}

        <div className="mt-6 grid gap-3 rounded-[1.5rem] border border-slate-200 bg-white/75 p-4 text-sm font-semibold text-slate-600 md:grid-cols-3">
          <p><CarFront className="mr-2 inline h-4 w-4 text-[#c5162f]" />Available stock counts only Free Stock + In transit.</p>
          <p><Truck className="mr-2 inline h-4 w-4 text-[#18a7d0]" />Retail, transfers, allocated, and test-drive rows are movement context only.</p>
          <p><CalendarDays className="mr-2 inline h-4 w-4 text-[#269442]" />Main stock cards use the latest uploaded VIN snapshot.</p>
        </div>
      </div>
    </MainLayout>
  )
}

interface ColumnFilterDropdownProps {
  column: string
  label: string
  uniqueValues: string[]
  activeFilters: string[]
  onApply: (values: string[]) => void
  onSort: (direction: 'asc' | 'desc') => void
  isSortedAsc: boolean
  isSortedDesc: boolean
}

function ColumnFilterDropdown({
  label,
  uniqueValues = [],
  activeFilters = [],
  onApply,
  onSort,
  isSortedAsc,
  isSortedDesc,
}: ColumnFilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [tempChecked, setTempChecked] = useState<string[]>([])

  // Sync state on dropdown open
  useEffect(() => {
    if (open) {
      setTempChecked(activeFilters)
      setSearchText('')
    }
  }, [open, activeFilters])

  // Filter values matching search term
  const filteredValues = uniqueValues.filter((val) => {
    const displayVal = val === '' ? 'blanks' : val
    return displayVal.toLowerCase().includes(searchText.toLowerCase())
  })

  const isAllSelected = filteredValues.length > 0 && filteredValues.every((val) => tempChecked.includes(val))

  const handleSelectAllChange = () => {
    if (isAllSelected) {
      // Uncheck all visible items
      setTempChecked((prev) => prev.filter((val) => !filteredValues.includes(val)))
    } else {
      // Check all visible items
      setTempChecked((prev) => {
        const next = [...prev]
        filteredValues.forEach((val) => {
          if (!next.includes(val)) next.push(val)
        })
        return next
      })
    }
  }

  const handleCheckboxChange = (val: string) => {
    setTempChecked((prev) =>
      prev.includes(val) ? prev.filter((item) => item !== val) : [...prev, val]
    )
  }

  const handleApply = () => {
    onApply(tempChecked)
    setOpen(false)
  }

  const handleClear = () => {
    onApply([])
    setOpen(false)
  }

  const hasActiveFilter = activeFilters.length > 0

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 text-left font-black tracking-wide transition rounded-md px-1.5 py-0.5 hover:bg-slate-100/80 outline-none focus:ring-1 focus:ring-[#071a2b]/20 cursor-pointer select-none",
            hasActiveFilter && "text-[#c5162f] bg-rose-50 hover:bg-rose-100/70"
          )}
        >
          <span>{label}</span>
          <span className="flex items-center gap-0.5">
            {isSortedAsc && <ChevronDown className="h-3 w-3 rotate-180 text-[#c5162f]" />}
            {isSortedDesc && <ChevronDown className="h-3 w-3 text-[#c5162f]" />}
            {hasActiveFilter ? (
              <Filter className="h-3 w-3 fill-current text-[#c5162f]" />
            ) : (
              (!isSortedAsc && !isSortedDesc) && <ChevronDown className="h-3.5 w-3.5 text-slate-400 opacity-60" />
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-64 bg-[#071a2b] text-white border-[#122130] shadow-xl rounded-[1.2rem] p-3 flex flex-col focus:outline-none"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Sort Section */}
        <button
          type="button"
          onClick={() => {
            onSort('asc')
            setOpen(false)
          }}
          className="flex items-center gap-2.5 w-full text-left rounded-lg px-2.5 py-2 text-[12px] font-semibold text-slate-300 hover:text-white hover:bg-[#122130] transition cursor-pointer"
        >
          <span className="text-[10px] border border-slate-500 rounded px-1 py-0.5 font-bold">A-Z</span>
          <span>Sort A to Z</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onSort('desc')
            setOpen(false)
          }}
          className="flex items-center gap-2.5 w-full text-left rounded-lg px-2.5 py-2 text-[12px] font-semibold text-slate-300 hover:text-white hover:bg-[#122130] transition cursor-pointer"
        >
          <span className="text-[10px] border border-slate-500 rounded px-1 py-0.5 font-bold">Z-A</span>
          <span>Sort Z to A</span>
        </button>

        <div className="my-1.5 border-t border-slate-700/50" />

        {/* Clear Filter Section */}
        <button
          type="button"
          disabled={!hasActiveFilter}
          onClick={handleClear}
          className={cn(
            "flex items-center gap-2.5 w-full text-left rounded-lg px-2.5 py-2 text-[12px] font-semibold transition",
            hasActiveFilter
              ? "text-rose-400 hover:text-rose-300 hover:bg-[#122130] cursor-pointer"
              : "text-slate-500 cursor-not-allowed opacity-50"
          )}
        >
          <XCircle className="h-4 w-4" />
          <span>Clear Filter from &quot;{label}&quot;</span>
        </button>

        <div className="my-1.5 border-t border-slate-700/50" />

        {/* Search Input Box */}
        <div className="relative mb-2 px-0.5">
          <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-slate-400" />
          <Input
            type="text"
            placeholder="Search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="h-8 pl-8 pr-3 text-[11px] bg-[#122130] border-slate-700 text-white rounded-lg focus-visible:ring-1 focus-visible:ring-rose-500 focus-visible:ring-offset-0 focus-visible:border-slate-600 placeholder-slate-400 shadow-inner"
            onKeyDown={(e) => e.stopPropagation()} // Stop propagation to prevent radix from closing
          />
        </div>

        {/* Scrollable Checkbox List */}
        <div className="max-h-44 overflow-y-auto space-y-1 px-0.5 pr-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {filteredValues.length > 0 && (
            <label className="flex items-center gap-2 px-1.5 py-1 hover:bg-[#122130] rounded cursor-pointer text-[12px] text-slate-300 hover:text-white select-none transition">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={handleSelectAllChange}
                className="rounded border-slate-700 bg-transparent text-[#c5162f] focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5 cursor-pointer accent-[#c5162f]"
              />
              <span className="font-semibold text-slate-200">(Select All)</span>
            </label>
          )}
          {filteredValues.length === 0 ? (
            <div className="text-center py-4 text-[11px] text-slate-400 italic">
              No matches found
            </div>
          ) : (
            filteredValues.map((val) => (
              <label key={val} className="flex items-center gap-2 px-1.5 py-1 hover:bg-[#122130] rounded cursor-pointer text-[12px] text-slate-300 hover:text-white select-none transition">
                <input
                  type="checkbox"
                  checked={tempChecked.includes(val)}
                  onChange={() => handleCheckboxChange(val)}
                  className="rounded border-slate-700 bg-transparent text-[#c5162f] focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5 cursor-pointer accent-[#c5162f]"
                />
                <span>{val === '' ? '(Blanks)' : val}</span>
              </label>
            ))
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-1.5 mt-2 pt-2 border-t border-slate-700/50">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            className="h-7 px-2.5 text-[11px] font-semibold text-slate-400 hover:text-white hover:bg-transparent"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            type="button"
            className="h-7 px-3.5 text-[11px] font-bold bg-[#c5162f] text-white hover:bg-[#c5162f]/90 rounded-lg shadow-sm"
            onClick={handleApply}
          >
            OK
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
