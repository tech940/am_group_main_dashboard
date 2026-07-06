'use client'

/* eslint-disable react-hooks/set-state-in-effect -- pre-existing reset-on-dependency-change effects; consistent with sibling KIA client files. */

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
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { logApiTimings } from '@/lib/api/client-timing'
import { cn } from '@/lib/utils'
import type {
  KiaStockDateMode,
  KiaStockFreshnessPayload,
  KiaStockReportPayload,
  KiaStockSummaryPayload,
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

const STOCK_SECTIONS = [
  { key: 'aging', label: 'Aging' },
  { key: 'interest', label: 'Interest' },
  { key: 'turns', label: 'Turns' },
  { key: 'mix', label: 'Mix' },
  { key: 'supply', label: 'Supply' },
  { key: 'by-model', label: 'Model & Trim' },
  { key: 'reorder', label: 'Reorder' },
  { key: 'aged', label: 'Aged 90+' },
  { key: 'explorer', label: 'Explorer' },
] as const

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
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)}L`
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

function formatMoneyExpanded(value: number) {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
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
  const [selectedDealer, setSelectedDealer] = useState(firstParam(initialSearchParams, 'dealer_code') || 'all')
  const [status, setStatus] = useState(firstParam(initialSearchParams, 'status') || 'all')
  const [model, setModel] = useState(firstParam(initialSearchParams, 'model') || 'all')
  const [search, setSearch] = useState(firstParam(initialSearchParams, 'search') || '')
  const [page, setPage] = useState(Number(firstParam(initialSearchParams, 'page')) || 1)
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({})
  const [reportSort, setReportSort] = useState(firstParam(initialSearchParams, 'sort') || '')
  const [reportDirection, setReportDirection] = useState<'asc' | 'desc'>((firstParam(initialSearchParams, 'direction') || 'desc') === 'asc' ? 'asc' : 'desc')
  const [fastMovingMode, setFastMovingMode] = useState<'models' | 'trims'>('models')
  const [slowMovingMode, setSlowMovingMode] = useState<'models' | 'trims'>('models')
  const [viewMode, setViewMode] = useState<'dashboard' | 'explorer'>('dashboard')

  const deferredSearch = useDeferredValue(search)

  const freshnessQuery = useQuery({
    queryKey: ['kia-stock-report-freshness', selectedDealer],
    queryFn: () => fetchJson<KiaStockFreshnessPayload>(`/api/brands/kia/stock-report/freshness?${buildQueryString({ dealer_code: selectedDealer })}`, 'kia-stock-report-freshness'),
    staleTime: 60_000,
  })

  const summaryQuery = useQuery({
    queryKey: [
      'kia-stock-report-summary',
      selectedDealer,
    ],
    queryFn: () => fetchJson<KiaStockSummaryPayload>(`/api/brands/kia/stock-report/summary?${buildQueryString({
      dealer_code: selectedDealer,
    })}`, 'kia-stock-report-summary'),
    staleTime: 30_000,
  })

  const reportQuery = useQuery({
    queryKey: [
      'kia-stock-report-table',
      selectedDealer,
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
        dealer_code: selectedDealer,
        status,
        model,
        search: deferredSearch,
        page: 1,
        pageSize: 9999,
        sort: reportSort,
        direction: reportDirection,
        ...filterParams,
      })}`, 'kia-stock-report-reports')
    },
    staleTime: 15_000,
  })

  // Reset column filters when dealer changes
  useEffect(() => {
    setColumnFilters({})
    setPage(1)
  }, [selectedDealer])

  useEffect(() => {
    const params = new URLSearchParams()
    if (selectedDealer !== 'all') params.set('dealer_code', selectedDealer)
    if (status !== 'all') params.set('status', status)
    if (model !== 'all') params.set('model', model)
    if (search) params.set('search', search)
    if (page > 1) params.set('page', String(page))

    startTransition(() => {
      router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false })
    })
  }, [pathname, router, selectedDealer, status, model, search, page])

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

  const scrollToSection = (section: string) => {
    const el = document.getElementById(`stock-${section}`)
    if (!el) return
    // Scroll ONLY the <main> content scroller. scrollIntoView() scrolls every
    // scrollable ancestor — including the overflow-hidden layout column that
    // holds the top navbar (overflow-hidden is still programmatically
    // scrollable), which pushed the navbar out of view with no way to scroll it
    // back. Scrolling the main container directly avoids that entirely.
    const scroller = el.closest('main')
    if (!scroller) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    const STICKY_NAV_OFFSET = 64 // leave room for the sticky section-tabs bar
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - STICKY_NAV_OFFSET
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  const handleExport = async () => {
    const filterParams: Record<string, string> = {}
    Object.entries(columnFilters).forEach(([col, vals]) => {
      if (vals && vals.length > 0) {
        filterParams[`filter_${col}`] = vals.map(encodeURIComponent).join(',')
      }
    })
    const response = await fetch(`/api/brands/kia/stock-report/reports?${buildQueryString({
      dealer_code: selectedDealer,
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
  const kpiValue = (label: string) => summary?.overview.kpis.find((item) => item.label === label)?.value || 0
  const availableStock = kpiValue('Available Stock')
  const stockValue = kpiValue('Stock Value')
  const avgStockAge = kpiValue('Avg Stock Age')
  const soldThisMonth = summary?.movement.monthly[0]?.retail || 0
  const agedRows = summary?.aging.rows || []
  const rows90Plus = summary?.aging?.rows90Plus || []
  const aged90Rows = agedRows.filter((row) => row.stockAge >= 90)
  const aged90Value = aged90Rows.reduce((sum, row) => sum + row.stockValue, 0)
  const interestRate = 10
  const interestAccrued = summary?.overview.totalInterestAccrued ?? agedRows.reduce((sum, row) => sum + ((row.stockValue * interestRate) / 100 / 365) * row.stockAge, 0)
  const monthlyCarrying = (stockValue * interestRate) / 100 / 12
  const dailyAgedBleed = aged90Rows.reduce((sum, row) => sum + (row.stockValue * interestRate) / 100 / 365, 0)

  const retailed90 = summary?.movement?.monthly?.slice(0, 3).reduce((sum, row) => sum + row.retail, 0) || 0
  const avgDailySales = retailed90 / 90
  const daysOfSupply = avgDailySales > 0 ? Math.round(availableStock / avgDailySales) : 0
  const annualizedTurns = avgDailySales > 0 ? ((avgDailySales * 365) / Math.max(1, availableStock)).toFixed(1) : '0'

  const stockByModel = summary?.overview.modelMix || []
  const modelCards = summary?.models.cards || []
  const explorerRows = report?.rows || []
  const ageBandRows = [
    { name: '0-30d', min: 0, max: 30, color: '#238f5a' },
    { name: '31-60d', min: 31, max: 60, color: '#6da94a' },
    { name: '61-90d', min: 61, max: 90, color: '#e3aa2f' },
    { name: '91-120d', min: 91, max: 120, color: '#df7828' },
    { name: '120+d', min: 121, max: Infinity, color: '#c73b32' },
  ].map((band) => {
    const rows = agedRows.filter((row) => row.stockAge >= band.min && row.stockAge <= band.max)
    return {
      ...band,
      units: rows.length,
      value: rows.reduce((sum, row) => sum + row.stockValue, 0),
      interestAccrued: rows.reduce((sum, row) => sum + ((row.stockValue * interestRate) / 100 / 365) * row.stockAge, 0),
    }
  })
  const fastestModels = [...modelCards].sort((a, b) => b.units - a.units).slice(0, 4)
  const slowestModels = [...modelCards].sort((a, b) => b.avgAge - a.avgAge).slice(0, 4)

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
                {formatDateTime(freshnessQuery.data?.sourceUpdatedAt)}
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/70 bg-white/85 p-4 shadow-inner">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex-1 min-w-[200px] space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Dealer</span>
                  <Select value={selectedDealer} onValueChange={(value) => { setSelectedDealer(value); setPage(1) }}>
                    <SelectTrigger className="h-12 rounded-2xl bg-white font-bold"><SelectValue placeholder="All dealers" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All dealers</SelectItem>
                      {(freshnessQuery.data?.dealerOptions || []).map((dealer) => <SelectItem key={dealer} value={dealer}>{dealer}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <Button onClick={handleRefresh} className="h-12 rounded-2xl bg-[#071a2b] font-black text-white hover:bg-[#102b46] px-6">
                  <RefreshCw className={cn('mr-2 h-4 w-4', (summaryQuery.isFetching || freshnessQuery.isFetching) && 'animate-spin')} /> Refresh
                </Button>
              </div>
            </div>
          </div>
        </section>

        <div className="sticky top-0 z-20 mt-6 flex h-auto flex-wrap justify-between items-center border-y border-[#c9d5e2] bg-[#edf3f9]/95 px-4 py-1 backdrop-blur shadow-sm">
          <div className="flex flex-wrap gap-2">
            {STOCK_SECTIONS.map((section) => {
              const isActive = (section.key as string) === 'explorer' 
                ? viewMode === 'explorer' 
                : (viewMode === 'dashboard' && (section.key as string) !== 'explorer')
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => {
                    if ((section.key as string) === 'explorer') {
                      setViewMode('explorer')
                    } else {
                      setViewMode('dashboard')
                      setTimeout(() => scrollToSection(section.key), 50)
                    }
                  }}
                  className={cn(
                    "border-b-2 px-3 py-3 text-[13px] font-black transition hover:border-[#caa144] hover:text-slate-950",
                    isActive ? "border-[#caa144] text-slate-950" : "border-transparent text-slate-600"
                  )}
                >
                  {section.label}
                </button>
              )
            })}
          </div>
        </div>

        {isLoadingSummary ? (
          <div className="mt-6 space-y-5">
            <div className="grid gap-4 md:grid-cols-4"><SkeletonBlock className="h-32" /><SkeletonBlock className="h-32" /><SkeletonBlock className="h-32" /><SkeletonBlock className="h-32" /></div>
            <SkeletonBlock className="h-72" />
            <SkeletonBlock className="h-96" />
          </div>
        ) : summary ? (
          <div className="mt-6 space-y-8 text-[14px] text-slate-700">
            {viewMode === 'dashboard' ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Units in stock', value: availableStock, helper: `live vehicles at ${selectedDealer === 'all' ? 'all dealers' : selectedDealer}`, dark: true },
                { label: 'Inventory value', value: formatMoney(stockValue), helper: 'landed cost incl GST · purchase report', dark: true },
                { label: 'Avg days in stock', value: `${avgStockAge}d`, helper: 'current available stock age' },
                { label: 'Retailed this month', value: soldThisMonth, helper: summary.context.selectedMonthLabel },
                { label: 'Lot days of supply', value: `${daysOfSupply}d`, helper: `${availableStock} units ÷ daily sales rate`, dark: true },
                { label: 'Inventory turns', value: soldThisMonth ? `${((soldThisMonth * 12) / Math.max(1, availableStock)).toFixed(1)}x/yr` : '0x/yr', helper: 'run-rate' },
                { label: 'Aged 60+ days', value: agedRows.filter((row) => row.stockAge >= 60).length, helper: `${availableStock ? Math.round((agedRows.filter((row) => row.stockAge >= 60).length / availableStock) * 100) : 0}% of lot` },
                { label: 'Aged 90+ days', value: aged90Rows.length, helper: `${formatMoney(aged90Value)} frozen` },
              ].map((item, index) => (
                <Card key={item.label} className={cn('rounded-[1.2rem] border bg-white shadow-[0_10px_24px_rgba(15,23,42,0.08)]', item.dark && 'bg-[#18283e] text-white', index >= 6 && 'border-l-4 border-l-[#d33d34]')}>
                  <CardContent className="p-5">
                    <p className={cn('text-[11px] font-black uppercase tracking-[0.12em]', item.dark ? 'text-slate-300' : 'text-slate-500')}>{item.label}</p>
                    <p className={cn('mt-3 text-[28px] font-black leading-none', item.dark ? 'text-white' : 'text-slate-950')}>{item.value}</p>
                    <p className={cn('mt-2 text-[13px] font-semibold', item.dark ? 'text-slate-300' : 'text-slate-500')}>{item.helper}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <section id="stock-aging" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-slate-900"><span className="mr-4 text-[13px] text-[#b4912f]">01</span>Inventory aging</h2>
                <p className="text-[15px] font-semibold text-slate-400">Stock age = days since KIN invoice. Click any band to see vehicles in it.</p>
              </div>
              <Card className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                <CardContent className="space-y-4 p-7">
                  {ageBandRows.map((band) => {
                    const pct = availableStock ? (band.units / availableStock) * 100 : 0
                    const showInside = pct >= 15
                    return (
                      <div key={band.name} className="grid grid-cols-[86px_1fr_90px] items-center gap-4">
                        <span className="text-[15px] font-black text-slate-600">{band.name}</span>
                        <div className="relative flex items-center h-8 rounded-md bg-slate-100 w-full overflow-hidden">
                          <div 
                            className="h-full rounded-md transition-all duration-500" 
                            style={{ width: `${pct}%`, backgroundColor: band.color }} 
                          />
                          <span 
                            className={cn(
                              "absolute text-[13px] font-black transition-all duration-500",
                              showInside 
                                ? "left-3 text-white" 
                                : "text-slate-700"
                            )}
                            style={showInside ? undefined : { left: `${pct + 3}%` }}
                          >
                            {band.units}
                          </span>
                        </div>
                        <span className="text-right text-[15px] font-bold text-slate-400">{formatMoney(band.value)}</span>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </section>

            <section id="stock-interest" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-slate-900"><span className="mr-4 text-[13px] text-[#b4912f]">02</span>Interest accrued to date</h2>
                <p className="text-[15px] font-semibold text-slate-400">Floor-plan interest already spent carrying today&apos;s stock</p>
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
                <Card className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                  <CardContent className="grid gap-3 p-6 sm:grid-cols-2">
                    {[
                      { label: 'Interest accrued to date', value: formatMoneyExpanded(interestAccrued), dark: true },
                      { label: 'Of which on 90+ day stock', value: formatMoneyExpanded(aged90Rows.reduce((sum, row) => sum + ((row.stockValue * interestRate) / 100 / 365) * row.stockAge, 0)) },
                      { label: 'Carrying cost / month · whole lot', value: formatMoneyExpanded(monthlyCarrying) },
                      { label: 'Daily bleed · aged 90+', value: formatMoneyExpanded(dailyAgedBleed) },
                    ].map((item) => (
                      <div key={item.label} className={cn('rounded-xl border border-[#dbe4ee] p-5', item.dark ? 'bg-[#552019] text-white' : 'bg-slate-50')}>
                        <p className="text-[26px] font-black">{item.value}</p>
                        <p className={cn('mt-2 text-[11px] font-black uppercase tracking-[0.1em]', item.dark ? 'text-rose-100' : 'text-slate-500')}>{item.label}</p>
                      </div>
                    ))}
                    <p className="col-span-full border-t border-dashed border-slate-300 pt-3 text-[13px] font-semibold text-slate-500">
                      At {interestRate.toFixed(2)}%/yr on {formatMoneyExpanded(stockValue)} of landed stock.
                    </p>
                  </CardContent>
                </Card>
                <Card className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                  <CardHeader><CardTitle className="text-[18px] font-black">Interest accrued by aging band</CardTitle><CardDescription>Where the carrying cost has actually gone</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    {ageBandRows.map((band) => {
                      const value = band.interestAccrued
                      const pct = interestAccrued ? (value / interestAccrued) * 100 : 0
                      const showInside = pct >= 25
                      return (
                        <div key={band.name} className="grid grid-cols-[70px_1fr_42px] items-center gap-3 text-[13px] font-bold">
                          <span>{band.name}</span>
                          <div className="relative flex items-center h-7 rounded-md bg-slate-100 w-full overflow-hidden">
                            <div 
                              className="h-full rounded-md transition-all duration-500" 
                              style={{ width: `${pct}%`, backgroundColor: band.color }} 
                            />
                            <span 
                              className={cn(
                                "absolute text-[11px] font-black tracking-wider whitespace-nowrap transition-all duration-500",
                                showInside 
                                  ? "left-3 text-white" 
                                  : "text-slate-700"
                              )}
                              style={showInside ? undefined : { left: `${pct + 2}%` }}
                            >
                              {formatMoneyExpanded(value)}
                            </span>
                          </div>
                          <span className="text-slate-400">
                            {interestAccrued ? Math.round(pct) : 0}%
                          </span>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              </div>
            </section>

            <section id="stock-turns" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-slate-900"><span className="mr-4 text-[13px] text-[#b4912f]">03</span>Inventory turns & days of supply</h2>
                <p className="text-[15px] font-semibold text-slate-400">How fast the whole lot converts to sales</p>
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
                <BarPanel title="Monthly retail trend" subtitle="Units delivered by selected period" data={summary.movement.monthly.slice(0, 8).reverse().map((row) => {
                  const [year, month] = row.month.split('-').map(Number)
                  const label = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short' }) + " '" + String(year).slice(2)
                  return { name: label, value: row.retail }
                })} />
                <Card className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                  <CardHeader><CardTitle className="text-[18px] font-black">Lot velocity</CardTitle><CardDescription>Run-rate from recent sales</CardDescription></CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    {[
                      [`${daysOfSupply}d`, 'Days of supply on lot'],
                      [soldThisMonth ? `${((soldThisMonth * 12) / Math.max(1, availableStock)).toFixed(1)}x` : '0x', 'Annualized turns'],
                      [soldThisMonth, 'Sold · 30 days'],
                      [summary.movement.monthly.slice(0, 3).reduce((sum, row) => sum + row.retail, 0), 'Sold · 90 days'],
                      [summary.movement.monthly.slice(0, 12).reduce((sum, row) => sum + row.retail, 0), 'Sold · 12 months'],
                    ].map(([value, label], index) => <div key={label} className={cn('rounded-xl border border-[#dbe4ee] p-4', index === 0 && 'bg-[#18283e] text-white')}><p className="text-[26px] font-black">{value}</p><p className="mt-2 text-[11px] font-black uppercase text-slate-500">{label}</p></div>)}
                  </CardContent>
                </Card>
              </div>
            </section>

            <section id="stock-mix" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-slate-900"><span className="mr-4 text-[13px] text-[#b4912f]">04</span>Inventory mix</h2>
                <p className="text-[15px] font-semibold text-slate-400">What the {availableStock} units are made of</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ['By model', stockByModel],
                  ['By status', summary.overview.statusMix],
                  ['By dealer', summary.overview.dealerSplit],
                  ['By colour', summary.models.colorMix],
                ].map(([title, items]) => (
                  <Card key={title as string} className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                    <CardHeader><CardTitle className="text-[18px] font-black">{title as string}</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {(items as Array<{ name: string; value: number }>).slice(0, 6).map((item) => <div key={item.name} className="grid grid-cols-[110px_1fr_30px] items-center gap-3 text-[14px]"><span className="font-semibold text-slate-500">{item.name}</span><span className="h-2 rounded-full bg-slate-100"><span className="block h-2 rounded-full bg-[#18283e]" style={{ width: `${Math.max(6, (item.value / Math.max(1, availableStock)) * 100)}%` }} /></span><span className="font-black">{item.value}</span></div>)}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <section id="stock-supply" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-slate-900"><span className="mr-4 text-[13px] text-[#b4912f]">05</span>Days of supply — the stocking engine</h2>
                <p className="text-[15px] font-semibold text-slate-400">Current stock ÷ daily sales rate. Healthy band 21–45 days.</p>
              </div>
              <Card className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                <CardContent className="space-y-5 p-7">
                  {modelCards.slice(0, 5).map((card) => {
                    const supply = soldThisMonth ? Math.round((card.units / Math.max(1, soldThisMonth / 30))) : 0
                    const statusText = supply < 21 ? 'RUNNING DRY' : supply > 90 ? 'OVERSTOCKED' : 'HEALTHY'
                    return <div key={card.model} className="grid grid-cols-[190px_1fr_140px] items-center gap-5 border-b border-slate-200 pb-4 last:border-0"><div><p className="text-[16px] font-black text-slate-900">{card.model}</p><p className="text-[13px] font-semibold text-slate-500">{card.units} in stock</p></div><div className="relative h-3 rounded-full bg-slate-100"><span className="absolute left-[23%] top-0 h-3 w-[22%] bg-emerald-100" /><span className="absolute top-[-9px] h-8 w-1 rounded bg-[#c83d34]" style={{ left: `${Math.min(96, supply)}%` }} /></div><div className="text-right"><span className={cn('rounded-lg px-3 py-2 text-[13px] font-black', statusText === 'HEALTHY' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-[#c73b32]')}>{statusText}</span><p className="mt-2 text-[12px] font-semibold text-slate-500">{supply}d supply</p></div></div>
                  })}
                </CardContent>
              </Card>
            </section>

            <section id="stock-by-model" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-slate-900"><span className="mr-4 text-[13px] text-[#b4912f]">06</span>Stock by model & trim</h2>
                <p className="text-[15px] font-semibold text-slate-400">Detailed stock levels and trim mix by vehicle model</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                {modelCards.map((card) => (
                  <Card key={card.model} className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm hover:shadow-md transition">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-[20px] font-black text-slate-900">{card.model}</CardTitle>
                          <CardDescription className="font-semibold text-slate-500">{formatMoney(card.stockValue)} total capital</CardDescription>
                        </div>
                        <Badge className="bg-[#18283e] text-white hover:bg-[#18283e] rounded-lg px-3 py-1 font-black text-[13px]">
                          {card.units} Units
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-3.5 text-center">
                        <div>
                          <p className="text-[11px] font-black uppercase text-slate-500">Avg Stock Age</p>
                          <p className="mt-1 text-[20px] font-black text-slate-900">{card.avgAge} days</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-black uppercase text-slate-500">Free / In-Transit</p>
                          <p className="mt-1 text-[20px] font-black text-slate-900">{card.freeStock} / {card.inTransit}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2.5">Stock by Trim</p>
                        <div className="space-y-2">
                          {card.variants.map((trim) => (
                            <div key={trim.name} className="grid grid-cols-[160px_1fr_30px] items-center gap-3 text-[13px]">
                              <span className="font-semibold text-slate-600 truncate" title={trim.name}>{trim.name}</span>
                              <span className="h-2.5 rounded-full bg-slate-100 relative overflow-hidden">
                                <span className="absolute left-0 top-0 h-full rounded-full bg-[#caa144]" style={{ width: `${(trim.value / card.units) * 100}%` }} />
                              </span>
                              <span className="font-black text-slate-800 text-right">{trim.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

             <section id="stock-reorder" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-slate-900"><span className="mr-4 text-[13px] text-[#b4912f]">06</span>Reorder & clear</h2>
                <p className="text-[15px] font-semibold text-slate-400">Where to chase supply vs. where to free up cash</p>
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <Card className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                      <CardTitle className="text-[18px] font-black text-emerald-700">▲ Fast movers — protect availability</CardTitle>
                      <CardDescription>Ranked by recent sales/stock concentration</CardDescription>
                    </div>
                    <div className="flex rounded-lg bg-slate-100 p-1">
                      <button 
                        type="button" 
                        onClick={() => setFastMovingMode('models')} 
                        className={cn('rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider transition', fastMovingMode === 'models' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900')}
                      >
                        Models
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setFastMovingMode('trims')} 
                        className={cn('rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider transition', fastMovingMode === 'trims' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900')}
                      >
                        Trims
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {fastMovingMode === 'models' ? (
                      fastestModels.map((card, index) => (
                        <div key={card.model} className="border-b border-slate-200 pb-4 last:border-0">
                          <div className="flex justify-between">
                            <p className="font-black">
                              <span className="mr-3 rounded-md bg-[#18283e] px-2 py-1 text-white">{index + 1}</span>
                              {card.model}
                            </p>
                            <p className="font-black">{card.units} units</p>
                          </div>
                          <p className="mt-1 text-[13px] font-semibold text-slate-500">Protect availability; review fast-selling trims weekly.</p>
                        </div>
                      ))
                    ) : (
                      (summary.trims?.fastest || []).map((trim, index) => (
                        <div key={`${trim.model}-${trim.variant}`} className="border-b border-slate-200 pb-4 last:border-0">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-black text-slate-900">
                                <span className="mr-3 rounded-md bg-[#18283e] px-2 py-0.5 text-white text-[12px]">{index + 1}</span>
                                {trim.variant}
                              </p>
                              <p className="mt-1 text-[12px] font-bold text-slate-400">{trim.model}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-emerald-700">{trim.salesCount90d} sold (90d)</p>
                              <p className="mt-0.5 text-[12px] font-semibold text-slate-500">{trim.stockCount} in stock</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                <Card className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                      <CardTitle className="text-[18px] font-black text-[#c73b32]">▼ Slow movers — free the cash</CardTitle>
                      <CardDescription>High age against weak recent movement</CardDescription>
                    </div>
                    <div className="flex rounded-lg bg-slate-100 p-1">
                      <button 
                        type="button" 
                        onClick={() => setSlowMovingMode('models')} 
                        className={cn('rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider transition', slowMovingMode === 'models' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900')}
                      >
                        Models
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setSlowMovingMode('trims')} 
                        className={cn('rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider transition', slowMovingMode === 'trims' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900')}
                      >
                        Trims
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {slowMovingMode === 'models' ? (
                      slowestModels.map((card) => (
                        <div key={card.model} className="border-b border-slate-200 pb-4 last:border-0">
                          <div className="flex justify-between">
                            <p className="font-black">{card.model}</p>
                            <p className="font-black">{card.avgAge}d avg</p>
                          </div>
                          <p className="mt-1 text-[13px] font-semibold text-slate-500">{card.units} stock · cut fresh orders and push exchange/discount focus.</p>
                        </div>
                      ))
                    ) : (
                      (summary.trims?.slowest || []).map((trim) => (
                        <div key={`${trim.model}-${trim.variant}`} className="border-b border-slate-200 pb-4 last:border-0">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-black text-slate-900">{trim.variant}</p>
                              <p className="mt-1 text-[12px] font-bold text-slate-400">{trim.model} · {trim.stockCount} in stock</p>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-rose-700">{trim.avgAge}d avg age</p>
                              <p className="mt-0.5 text-[12px] font-semibold text-slate-500">{trim.salesCount90d} sold (90d)</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </section>

            <section id="stock-aged" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-slate-900"><span className="mr-4 text-[13px] text-[#b4912f]">07</span>Aged inventory action list — 90+ days</h2>
                <p className="text-[15px] font-semibold text-slate-400">
                  {rows90Plus.length} units · {formatMoneyExpanded(rows90Plus.reduce((sum, r) => sum + r.stockValue, 0))} capital frozen
                </p>
              </div>
              <Card className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                <CardContent className="overflow-x-auto p-4">
                  <Table className="[&_td]:py-2.5 [&_td]:text-[12px] [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow>
                        {['Age', 'Model', 'Variant', 'Colour', 'VIN', 'In stock', 'Value', 'Carrying Cost (MO)', 'Interest Accrued', 'Suggested action'].map((heading) => (
                          <TableHead key={heading} className="font-black uppercase tracking-[0.08em] text-slate-500">{heading}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows90Plus.map((row) => (
                        <TableRow key={row.rowKey}>
                          <TableCell>
                            <span className={cn('rounded-full px-3 py-1 text-white font-black', row.stockAge > 120 ? 'bg-[#c73b32]' : 'bg-[#e17a29]')}>
                              {row.stockAge}d
                            </span>
                          </TableCell>
                          <TableCell className="font-black text-slate-900">{row.model}</TableCell>
                          <TableCell className="font-semibold text-slate-700">{row.variant}</TableCell>
                          <TableCell className="text-slate-600">{row.color}</TableCell>
                          <TableCell className="font-mono text-[12px]">{row.vin || '-'}</TableCell>
                          <TableCell className="text-slate-600">{formatDate(row.grnDate || row.departureDate)}</TableCell>
                          <TableCell className="font-black text-slate-900">{formatMoneyExpanded(row.stockValue)}</TableCell>
                          <TableCell className="font-bold text-slate-700">{formatMoneyExpanded(row.carryingCostMonth)}</TableCell>
                          <TableCell className="font-black text-red-700">{formatMoneyExpanded(row.interestAccrued)}</TableCell>
                          <TableCell className="text-slate-500 font-medium">Liquidate: max discount + exchange</TableCell>
                        </TableRow>
                      ))}
                      {!rows90Plus.length ? (
                        <TableRow>
                          <TableCell colSpan={10} className="py-10 text-center font-bold text-slate-500">
                            No 90+ days aged vehicles currently in stock.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>
          </>
        ) : (
          <section id="stock-explorer" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-slate-900"><span className="mr-4 text-[13px] text-[#b4912f]">08</span>Stock explorer</h2>
                <p className="text-[15px] font-semibold text-slate-400">Filter, search and sort the live lot</p>
              </div>
              <Card className="rounded-[1.2rem] border border-[#d7e0ea] bg-white shadow-sm">
                <CardContent className="space-y-5 p-5">
                  <div className="grid gap-3 xl:grid-cols-[1fr_150px_150px_auto]">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="search VIN / variant..." className="h-11 rounded-xl bg-white pl-11 font-semibold" />
                    </div>
                    <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1) }}><SelectTrigger className="h-11 rounded-xl bg-white font-bold"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{(freshnessQuery.data?.statusOptions || []).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                    <Select value={model} onValueChange={(value) => { setModel(value); setPage(1) }}><SelectTrigger className="h-11 rounded-xl bg-white font-bold"><SelectValue placeholder="Model" /></SelectTrigger><SelectContent><SelectItem value="all">All models</SelectItem>{modelOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                    <Button onClick={handleExport} className="h-11 rounded-xl bg-[#071a2b] font-black text-white hover:bg-[#102b46]"><Download className="mr-2 h-4 w-4" /> Export</Button>
                  </div>
                  <p className="text-[14px] font-semibold text-slate-500">Showing {explorerRows.length} of {report?.pagination.totalRows || 0} units · {formatMoney(stockValue)} landed</p>
                  {reportQuery.isLoading ? <SkeletonBlock className="h-96" /> : (
                    <>
                      <div className="overflow-x-auto">
                        <Table className="[&_td]:text-[13px] [&_th]:text-[11px]">
                          <TableHeader><TableRow>{displayedColumns.map((column) => <TableHead key={column} className="border-b-2 border-slate-300 font-black uppercase tracking-[0.08em] text-slate-500"><ColumnFilterDropdown column={column} label={toColumnLabel(column)} uniqueValues={reportQuery.data?.uniqueValues?.[column] || []} activeFilters={columnFilters[column] || []} onApply={(values) => { setColumnFilters((prev) => ({ ...prev, [column]: values })); setPage(1) }} onSort={(direction) => { setReportSort(column); setReportDirection(direction); setPage(1) }} isSortedAsc={reportSort === column && reportDirection === 'asc'} isSortedDesc={reportSort === column && reportDirection === 'desc'} /></TableHead>)}</TableRow></TableHeader>
                          <TableBody>{explorerRows.map((row, rowIndex) => <TableRow key={`${row.id || row.vin_no || rowIndex}-${rowIndex}`} className="odd:bg-[#f8fafc] even:bg-white hover:bg-slate-50/80 transition">{displayedColumns.map((column) => <TableCell key={column} className="whitespace-nowrap font-semibold text-slate-700" title={String(row[column] ?? '')}>{String(row[column] ?? '-')}</TableCell>)}</TableRow>)}{!explorerRows.length ? <TableRow><TableCell colSpan={displayedColumns.length || 1} className="py-10 text-center font-bold text-slate-500">No report rows found.</TableCell></TableRow> : null}</TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      ) : null}

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
