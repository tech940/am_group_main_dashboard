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
  TriangleAlert,
  CheckCircle2,
  Info,
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
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

// 'YYYY-MM' -> 'June 2026'
function formatMonthYear(value: string | null | undefined) {
  const [year, month] = String(value || '').split('-').map(Number)
  if (!year || !month) return value || ''
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
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

// Chart series palette (kept as distinct hues; the first is the theme accent).
const COLORS = ['var(--dashboard-action-bg)', '#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e', '#14b8a6']
const SURFACE = 'kia-surface rounded-[2rem]'
const PAGE_BACKGROUND = 'bg-[var(--kia-canvas)]'

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
  return `${new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))} IST`
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
  return <div className={cn('animate-pulse rounded-[1.5rem] bg-[var(--kia-surface)]', className)} />
}

function ChartEmpty({ label = 'No stock data' }: { label?: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center rounded-[1.5rem] bg-[var(--kia-surface-sunken)] text-center">
      <BarChart3 className="mb-3 h-8 w-8 text-slate-300" />
      <p className="font-black text-[var(--kia-text)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--kia-text-soft)]">Try a different dealer, date mode, or month.</p>
    </div>
  )
}

function BarPanel({ title, subtitle, data }: { title: string; subtitle?: string; data: Array<{ name: string; value: number }> }) {
  return (
    <Card className={SURFACE}>
      <CardHeader>
        <CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[var(--dashboard-action-bg)]">{title}</CardTitle>
        {subtitle ? <p className="text-sm font-semibold text-[var(--kia-text-soft)]">{subtitle}</p> : null}
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--kia-hairline)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--dashboard-action-bg)" radius={[10, 10, 0, 0]} />
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
        <CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[var(--dashboard-action-bg)]">{title}</CardTitle>
        {subtitle ? <p className="text-sm font-semibold text-[var(--kia-text-soft)]">{subtitle}</p> : null}
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
                <div key={item.name} className="flex items-center justify-between rounded-2xl bg-[var(--kia-surface-sunken)] px-4 py-3 text-sm font-black">
                  <span className="flex items-center gap-2 text-[var(--kia-text-soft)]"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{item.name}</span>
                  <span className="text-[var(--kia-text)]">{item.value}</span>
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
        <CardTitle className="text-[13px] font-black uppercase tracking-[0.24em] text-[var(--dashboard-action-bg)]">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-bg)]">
                {['Dealer', 'Status', 'Model', 'VIN', 'Age', 'Value'].map((heading) => (
                  <TableHead key={heading} className="text-[11px] font-black uppercase tracking-[0.18em] text-white">{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={`${row.rowKey}-${index}`} className="text-[13px]">
                  <TableCell className="font-black text-[var(--dashboard-action-bg)]">{row.dealer}</TableCell>
                  <TableCell><Badge variant="outline">{row.stockStatus}</Badge></TableCell>
                  <TableCell className="font-bold">{row.model}<div className="text-xs text-[var(--kia-text-soft)]">{row.variant}</div></TableCell>
                  <TableCell className="font-mono text-xs">{row.vin || '-'}</TableCell>
                  <TableCell>{row.stockAge}D</TableCell>
                  <TableCell className="font-black">{formatMoney(row.stockValue)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="py-8 text-center font-bold text-[var(--kia-text-soft)]">No rows found.</TableCell></TableRow> : null}
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
      <h2 className="text-xl font-black tracking-tight text-[var(--kia-text)] md:text-2xl">{title}</h2>
      {description && <p className="text-sm font-semibold text-[var(--kia-text-soft)] mt-1">{description}</p>}
    </div>
  )
}

export function KiaStockReportPage({ initialSearchParams }: { initialSearchParams: SearchParamsInput }) {
  const router = useRouter()
  const pathname = usePathname()
  const [selectedDealer, setSelectedDealer] = useState(firstParam(initialSearchParams, 'dealer_code') || 'all')
  const [explainKpi, setExplainKpi] = useState<string | null>(null)
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
  const [isRefreshing, setIsRefreshing] = useState(false)

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

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await fetch(`/api/brands/kia/stock-report/freshness?refresh=true&dealer_code=${selectedDealer}`)
      await Promise.all([
        freshnessQuery.refetch(),
        summaryQuery.refetch(),
        reportQuery.refetch(),
      ])
    } catch (e) {
      console.error(e)
    } finally {
      setIsRefreshing(false)
    }
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
  // Use the latest month we actually HAVE retail data for (monthly[0]) for BOTH the value and its
  // label, so they never diverge. (The stock feed's context month can run ahead of the retail feed,
  // which previously showed last month's number under this month's label.)
  const retailMonth = summary?.movement.monthly?.[0]
  const soldThisMonth = retailMonth?.retail ?? 0
  const retailMonthLabel = retailMonth ? formatMonthYear(retailMonth.month) : (summary?.context.selectedMonthLabel || '')
  const agedRows = summary?.aging.rows || []
  const rows90Plus = summary?.aging?.rows90Plus || []
  const aged90Rows = agedRows.filter((row) => row.stockAge >= 90)
  const aged90Value = aged90Rows.reduce((sum, row) => sum + row.stockValue, 0)
  const interestRate = 10
  const interestAccrued = summary?.overview.totalInterestAccrued ?? agedRows.reduce((sum, row) => sum + ((row.stockValue * interestRate) / 100 / 365) * row.stockAge, 0)
  const monthlyCarrying = (stockValue * interestRate) / 100 / 12
  const dailyAgedBleed = aged90Rows.reduce((sum, row) => sum + (row.stockValue * interestRate) / 100 / 365, 0)

  // Accurate trailing-90-day retail (distinct VINs delivered in the last 90 days), computed server-
  // side. Fall back to summing the last 3 monthly buckets only if the field is absent (old payload).
  const retailed90 = summary?.movement?.retailed90
    ?? (summary?.movement?.monthly?.slice(0, 3).reduce((sum, row) => sum + row.retail, 0) || 0)
  const avgDailySales = retailed90 / 90
  const daysOfSupply = avgDailySales > 0 ? Math.round(availableStock / avgDailySales) : 0
  const annualizedTurns = avgDailySales > 0 ? ((avgDailySales * 365) / Math.max(1, availableStock)).toFixed(1) : '0'
  const aged60Count = agedRows.filter((row) => row.stockAge >= 60).length

  // Click-to-explain: how each KPI card is computed, with the LIVE inputs behind the number.
  const kpiExplanations: Record<string, { title: string; formula: string; inputs: Array<[string, string]> }> = {
    units: {
      title: 'Units in stock',
      formula: 'Count of VINs in the latest DMS stock feed that are not yet delivered or retailed (includes booked-but-not-delivered and in-transit cars; excludes cars already delivered in the app or retailed in the sales feed), de-duplicated one per VIN.',
      inputs: [['Live units', String(availableStock)], ['Scope', selectedDealer === 'all' ? 'All dealers' : selectedDealer]],
    },
    value: {
      title: 'Inventory value',
      formula: 'Sum over every in-stock car of (ex-factory base price × 1.36). The ×1.36 is a flat GST/cess estimate; a car with only a KIN invoice amount (already GST-inclusive) is counted as-is. This is an estimate, not exact on-road value.',
      inputs: [['Units', String(availableStock)], ['Total est. value', formatMoney(stockValue)], ['Avg / car', formatMoney(availableStock ? stockValue / availableStock : 0)]],
    },
    avgAge: {
      title: 'Avg days in stock',
      formula: 'Average of (today − KIN invoice date) across all in-stock cars — i.e. days since KIA invoiced each car to the dealership.',
      inputs: [['Units', String(availableStock)], ['Average age', `${avgStockAge} days`]],
    },
    retailed: {
      title: 'Retailed this month',
      formula: 'Distinct vehicles delivered (kia_sales_report.delivery_date) during the latest month with retail data, scoped to the selected dealer. Measures actual deliveries, not bookings.',
      inputs: [['Month', retailMonthLabel || '—'], ['Retailed', String(soldThisMonth)]],
    },
    daysSupply: {
      title: 'Lot days of supply',
      formula: 'Units in stock ÷ average cars retailed per day over the trailing 90 days. Lower = leaner lot. Healthy band ≈ 21–45 days.',
      inputs: [['Units in stock', String(availableStock)], ['Retailed last 90d', String(retailed90)], ['Retail / day', avgDailySales.toFixed(2)], ['Days of supply', `${daysOfSupply} days`]],
    },
    turns: {
      title: 'Inventory turns',
      formula: 'Annualised: (cars retailed per day over the last 90 days × 365) ÷ units in stock. Uses the SAME 90-day rate as Lot days of supply, so the two always agree (turns ≈ 365 ÷ days of supply).',
      inputs: [['Retail / day (90d)', avgDailySales.toFixed(2)], ['Units in stock', String(availableStock)], ['Turns', `${annualizedTurns}x/yr`], ['Implied days of supply', `${daysOfSupply} days`]],
    },
    aged60: {
      title: 'Aged 60+ days',
      formula: 'Count of in-stock cars aged ≥ 60 days (cumulative — includes the 90+ cars). % of lot = that count ÷ units in stock.',
      inputs: [['Units ≥ 60d', String(aged60Count)], ['Units in stock', String(availableStock)], ['% of lot', `${availableStock ? Math.round((aged60Count / availableStock) * 100) : 0}%`]],
    },
    aged90: {
      title: 'Aged 90+ days',
      formula: 'Count of in-stock cars aged ≥ 90 days; "capital frozen" = sum of their estimated value (same base × 1.36).',
      inputs: [['Units ≥ 90d', String(aged90Rows.length)], ['Capital frozen', formatMoney(aged90Value)]],
    },
  }
  const activeExplain = explainKpi ? kpiExplanations[explainKpi] : null

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

  // Capture "now" once on mount (and whenever the feed timestamp changes) — reading
  // the clock during render is impure, so it lives in an effect instead.
  const [nowMs, setNowMs] = useState(0)
  useEffect(() => {
    setNowMs(Date.now())
  }, [freshnessQuery.data?.sourceUpdatedAt])

  // DMS import health — how stale is the last stock feed? Fresh ≤ 2 days, stale 2–7 days, critical > 7 days.
  const importHealth = useMemo(() => {
    const raw = freshnessQuery.data?.sourceUpdatedAt
    if (!raw || !nowMs) return { level: 'unknown' as const, ageDays: null as number | null, when: null as string | null }
    const ts = new Date(raw).getTime()
    if (Number.isNaN(ts)) return { level: 'unknown' as const, ageDays: null, when: null }
    const ageDays = Math.max(0, Math.floor((nowMs - ts) / 86_400_000))
    const level = ageDays <= 2 ? ('fresh' as const) : ageDays <= 7 ? ('stale' as const) : ('critical' as const)
    return { level, ageDays, when: formatDateTime(raw) }
  }, [freshnessQuery.data?.sourceUpdatedAt, nowMs])

  return (
    <MainLayout title="Stock Report" subtitle="AM Kia stock analytics workspace">
      <div className={cn('kia-premium -m-4 min-h-screen p-4 md:-m-6 md:p-6', PAGE_BACKGROUND)}>
        <section className={cn(SURFACE, 'overflow-hidden p-6 md:p-8')}>
          <div className="grid gap-6 lg:grid-cols-[1fr_560px]">
            <div>
              <Badge className="rounded-full bg-[color-mix(in_srgb,var(--dashboard-action-bg)_14%,transparent)] px-4 py-2 text-[var(--dashboard-action-bg)] hover:bg-[color-mix(in_srgb,var(--dashboard-action-bg)_14%,transparent)]">
                <PackageCheck className="mr-2 h-4 w-4" /> AM Kia Stock
              </Badge>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-[var(--kia-text)] md:text-4xl">Stock Report</h1>
              <p className="mt-2 max-w-3xl text-base font-semibold leading-7 text-[var(--kia-text-soft)]">
                Current unsold vehicle stock, transit pipeline, stock value, model mix, dealer split, and purchase report drill-downs.
              </p>
              <p className="mt-3 text-sm font-black uppercase tracking-[0.2em] text-[var(--kia-text-soft)]">
                {formatDateTime(freshnessQuery.data?.sourceUpdatedAt)}
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] p-4 shadow-inner">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex-1 min-w-[200px] space-y-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--kia-text-soft)]">Dealer</span>
                  <Select value={selectedDealer} onValueChange={(value) => { setSelectedDealer(value); setPage(1) }}>
                    <SelectTrigger className="h-12 rounded-2xl bg-[var(--kia-surface)] font-bold"><SelectValue placeholder="All dealers" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All dealers</SelectItem>
                      {(freshnessQuery.data?.dealerOptions || []).map((dealer) => <SelectItem key={dealer} value={dealer}>{dealer}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <Button onClick={handleRefresh} className="h-12 rounded-2xl bg-[var(--dashboard-action-bg)] font-black text-white hover:bg-[var(--dashboard-action-hover)] px-6" disabled={isRefreshing}>
                  <RefreshCw className={cn('mr-2 h-4 w-4', (summaryQuery.isFetching || freshnessQuery.isFetching || isRefreshing) && 'animate-spin')} /> Refresh
                </Button>
              </div>
            </div>
          </div>
        </section>

        <div
          className={cn(
            'mt-6 flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-4',
            importHealth.level === 'critical'
              ? 'border-[color-mix(in_srgb,var(--dashboard-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--dashboard-danger)_10%,transparent)]'
              : importHealth.level === 'stale'
                ? 'border-[color-mix(in_srgb,var(--dashboard-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--dashboard-warning)_12%,transparent)]'
                : importHealth.level === 'fresh'
                  ? 'border-[color-mix(in_srgb,var(--dashboard-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--dashboard-success)_10%,transparent)]'
                  : 'border-[var(--kia-hairline)] bg-[var(--kia-surface-sunken)]',
          )}
        >
          {importHealth.level === 'critical' ? (
            <TriangleAlert className="h-5 w-5 shrink-0 text-[var(--dashboard-danger)]" />
          ) : importHealth.level === 'stale' ? (
            <Clock className="h-5 w-5 shrink-0 text-[var(--dashboard-warning)]" />
          ) : importHealth.level === 'fresh' ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--dashboard-success)]" />
          ) : (
            <Clock className="h-5 w-5 shrink-0 text-[var(--kia-text-soft)]" />
          )}
          <div className="flex-1 min-w-[240px]">
            <p className="text-sm font-black text-[var(--kia-text)]">
              {importHealth.level === 'critical'
                ? `DMS stock feed hasn't updated in ${importHealth.ageDays} days`
                : importHealth.level === 'stale'
                  ? `DMS stock feed is ${importHealth.ageDays} days old`
                  : importHealth.level === 'fresh'
                    ? importHealth.ageDays === 0
                      ? 'DMS stock feed is up to date (imported today)'
                      : `DMS stock feed is up to date (${importHealth.ageDays} day${importHealth.ageDays === 1 ? '' : 's'} ago)`
                    : 'DMS stock feed timestamp unavailable'}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-[var(--kia-text-soft)]">
              {importHealth.when
                ? importHealth.level === 'fresh'
                  ? `Last import: ${importHealth.when}. Stock counts reflect the latest DMS feed.`
                  : `Last import: ${importHealth.when}. Stock counts may be out of date — re-run the DMS import to refresh.`
                : 'Could not read the last import time from the DMS feed. Verify the import job is running.'}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-10 rounded-xl border-[var(--kia-hairline)] bg-[var(--kia-surface)] font-bold text-[var(--kia-text)]"
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', (freshnessQuery.isFetching || isRefreshing) && 'animate-spin')} /> Re-check
          </Button>
        </div>

        <div className="sticky top-0 z-20 mt-6 flex h-auto flex-wrap justify-between items-center border-y border-[var(--kia-hairline)] bg-[var(--kia-surface-sunken)] px-4 py-1 backdrop-blur shadow-sm">
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
                    "border-b-2 px-3 py-3 text-[13px] font-black transition hover:border-[var(--dashboard-action-bg)] hover:text-[var(--kia-text)]",
                    isActive ? "border-[var(--dashboard-action-bg)] text-[var(--kia-text)]" : "border-transparent text-[var(--kia-text-soft)]"
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
          <div className="mt-6 space-y-8 text-[14px] text-[var(--kia-text-soft)]">
            {viewMode === 'dashboard' ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                { key: 'units', label: 'Units in stock', value: availableStock, helper: `live vehicles at ${selectedDealer === 'all' ? 'all dealers' : selectedDealer}`, dark: true },
                { key: 'value', label: 'Inventory value', value: formatMoney(stockValue), helper: '≈ base price × 1.36 (GST est.)', dark: true },
                { key: 'avgAge', label: 'Avg days in stock', value: `${avgStockAge}d`, helper: 'days since KIN invoice' },
                { key: 'retailed', label: 'Retailed this month', value: soldThisMonth, helper: `delivered · ${retailMonthLabel}` },
                { key: 'daysSupply', label: 'Lot days of supply', value: `${daysOfSupply}d`, helper: `${availableStock} units ÷ retail/day (90d)`, dark: true },
                { key: 'turns', label: 'Inventory turns', value: `${annualizedTurns}x/yr`, helper: 'trailing 90-day retail, annualized' },
                { key: 'aged60', label: 'Aged 60+ days', value: agedRows.filter((row) => row.stockAge >= 60).length, helper: `${availableStock ? Math.round((agedRows.filter((row) => row.stockAge >= 60).length / availableStock) * 100) : 0}% of lot` },
                { key: 'aged90', label: 'Aged 90+ days', value: aged90Rows.length, helper: `${formatMoney(aged90Value)} frozen` },
              ].map((item, index) => (
                <Card key={item.label} onClick={() => setExplainKpi(item.key)} title="Click to see how this is calculated" className={cn('cursor-pointer rounded-[1.2rem] border bg-[var(--kia-surface)] shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-shadow hover:shadow-[0_14px_32px_rgba(15,23,42,0.16)]', item.dark && 'bg-[var(--dashboard-action-bg)] text-white', index >= 6 && 'border-l-4 border-l-[var(--dashboard-danger)]')}>
                  <CardContent className="p-5">
                    <p className={cn('flex items-center justify-between text-[11px] font-black uppercase tracking-[0.12em]', item.dark ? 'text-slate-300' : 'text-[var(--kia-text-soft)]')}>{item.label}<Info className="h-3.5 w-3.5 opacity-50" /></p>
                    <p className={cn('mt-3 text-[28px] font-black leading-none', item.dark ? 'text-white' : 'text-[var(--kia-text)]')}>{item.value}</p>
                    <p className={cn('mt-2 text-[13px] font-semibold', item.dark ? 'text-slate-300' : 'text-[var(--kia-text-soft)]')}>{item.helper}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Click-to-explain: how the selected KPI is calculated, with its live inputs. */}
            <Dialog open={explainKpi !== null} onOpenChange={(open) => { if (!open) setExplainKpi(null) }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-[var(--kia-text)]"><Info className="h-5 w-5 text-[var(--dashboard-action-bg)]" /> {activeExplain?.title || 'How this is calculated'}</DialogTitle>
                  <DialogDescription className="pt-2 text-[14px] leading-relaxed text-[var(--kia-text-soft)]">{activeExplain?.formula}</DialogDescription>
                </DialogHeader>
                {activeExplain && (
                  <div className="mt-2 overflow-hidden rounded-xl border border-[var(--kia-hairline)]">
                    {activeExplain.inputs.map(([label, value], i) => (
                      <div key={label} className={cn('flex items-center justify-between px-4 py-2.5 text-[14px]', i % 2 === 0 && 'bg-[var(--kia-surface-sunken)]')}>
                        <span className="font-semibold text-[var(--kia-text-soft)]">{label}</span>
                        <span className="font-black tabular-nums text-[var(--kia-text)]">{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </DialogContent>
            </Dialog>

            <section id="stock-aging" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-[var(--kia-text)]"><span className="mr-4 text-[13px] text-[var(--dashboard-action-bg)]">01</span>Inventory aging</h2>
                <p className="text-[15px] font-semibold text-[var(--kia-text-faint)]">Stock age = days since KIN invoice. Click any band to see vehicles in it.</p>
              </div>
              <Card className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                <CardContent className="space-y-4 p-7">
                  {ageBandRows.map((band) => {
                    const pct = availableStock ? (band.units / availableStock) * 100 : 0
                    const showInside = pct >= 15
                    return (
                      <div key={band.name} className="grid grid-cols-[86px_1fr_90px] items-center gap-4">
                        <span className="text-[15px] font-black text-[var(--kia-text-soft)]">{band.name}</span>
                        <div className="relative flex items-center h-8 rounded-md bg-[var(--kia-surface-sunken)] w-full overflow-hidden">
                          <div 
                            className="h-full rounded-md transition-all duration-500" 
                            style={{ width: `${pct}%`, backgroundColor: band.color }} 
                          />
                          <span 
                            className={cn(
                              "absolute text-[13px] font-black transition-all duration-500",
                              showInside 
                                ? "left-3 text-white" 
                                : "text-[var(--kia-text-soft)]"
                            )}
                            style={showInside ? undefined : { left: `${pct + 3}%` }}
                          >
                            {band.units}
                          </span>
                        </div>
                        <span className="text-right text-[15px] font-bold text-[var(--kia-text-faint)]">{formatMoney(band.value)}</span>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </section>

            <section id="stock-interest" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-[var(--kia-text)]"><span className="mr-4 text-[13px] text-[var(--dashboard-action-bg)]">02</span>Interest accrued to date</h2>
                <p className="text-[15px] font-semibold text-[var(--kia-text-faint)]">Floor-plan interest already spent carrying today&apos;s stock</p>
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
                <Card className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                  <CardContent className="grid gap-3 p-6 sm:grid-cols-2">
                    {[
                      { label: 'Interest accrued to date', value: formatMoneyExpanded(interestAccrued), dark: true },
                      { label: 'Of which on 90+ day stock', value: formatMoneyExpanded(aged90Rows.reduce((sum, row) => sum + ((row.stockValue * interestRate) / 100 / 365) * row.stockAge, 0)) },
                      { label: 'Carrying cost / month · whole lot', value: formatMoneyExpanded(monthlyCarrying) },
                      { label: 'Daily bleed · aged 90+', value: formatMoneyExpanded(dailyAgedBleed) },
                    ].map((item) => (
                      <div key={item.label} className={cn('rounded-xl border border-[var(--kia-hairline)] p-5', item.dark ? 'bg-[var(--dashboard-action-bg)] text-white' : 'bg-[var(--kia-surface-sunken)]')}>
                        <p className="text-[26px] font-black">{item.value}</p>
                        <p className={cn('mt-2 text-[11px] font-black uppercase tracking-[0.1em]', item.dark ? 'text-rose-100' : 'text-[var(--kia-text-soft)]')}>{item.label}</p>
                      </div>
                    ))}
                    <p className="col-span-full border-t border-dashed border-slate-300 pt-3 text-[13px] font-semibold text-[var(--kia-text-soft)]">
                      At {interestRate.toFixed(2)}%/yr on {formatMoneyExpanded(stockValue)} of landed stock.
                    </p>
                  </CardContent>
                </Card>
                <Card className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                  <CardHeader><CardTitle className="text-[18px] font-black">Interest accrued by aging band</CardTitle><CardDescription>Where the carrying cost has actually gone</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    {ageBandRows.map((band) => {
                      const value = band.interestAccrued
                      const pct = interestAccrued ? (value / interestAccrued) * 100 : 0
                      const showInside = pct >= 25
                      return (
                        <div key={band.name} className="grid grid-cols-[70px_1fr_42px] items-center gap-3 text-[13px] font-bold">
                          <span>{band.name}</span>
                          <div className="relative flex items-center h-7 rounded-md bg-[var(--kia-surface-sunken)] w-full overflow-hidden">
                            <div 
                              className="h-full rounded-md transition-all duration-500" 
                              style={{ width: `${pct}%`, backgroundColor: band.color }} 
                            />
                            <span 
                              className={cn(
                                "absolute text-[11px] font-black tracking-wider whitespace-nowrap transition-all duration-500",
                                showInside 
                                  ? "left-3 text-white" 
                                  : "text-[var(--kia-text-soft)]"
                              )}
                              style={showInside ? undefined : { left: `${pct + 2}%` }}
                            >
                              {formatMoneyExpanded(value)}
                            </span>
                          </div>
                          <span className="text-[var(--kia-text-faint)]">
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
                <h2 className="text-[23px] font-black text-[var(--kia-text)]"><span className="mr-4 text-[13px] text-[var(--dashboard-action-bg)]">03</span>Inventory turns & days of supply</h2>
                <p className="text-[15px] font-semibold text-[var(--kia-text-faint)]">How fast the whole lot converts to sales</p>
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
                <BarPanel title="Monthly retail trend" subtitle="Units delivered by selected period" data={summary.movement.monthly.slice(0, 8).reverse().map((row) => {
                  const [year, month] = row.month.split('-').map(Number)
                  const label = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short' }) + " '" + String(year).slice(2)
                  return { name: label, value: row.retail }
                })} />
                <Card className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                  <CardHeader><CardTitle className="text-[18px] font-black">Lot velocity</CardTitle><CardDescription>Run-rate from recent sales</CardDescription></CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    {[
                      [`${daysOfSupply}d`, 'Days of supply on lot'],
                      [`${annualizedTurns}x`, 'Annualized turns'],
                      [soldThisMonth, 'Sold · 30 days'],
                      [summary.movement.monthly.slice(0, 3).reduce((sum, row) => sum + row.retail, 0), 'Sold · 90 days'],
                      [summary.movement.monthly.slice(0, 12).reduce((sum, row) => sum + row.retail, 0), 'Sold · 12 months'],
                    ].map(([value, label], index) => <div key={label} className={cn('rounded-xl border border-[var(--kia-hairline)] p-4', index === 0 && 'bg-[var(--dashboard-action-bg)] text-white')}><p className="text-[26px] font-black">{value}</p><p className="mt-2 text-[11px] font-black uppercase text-[var(--kia-text-soft)]">{label}</p></div>)}
                  </CardContent>
                </Card>
              </div>
            </section>

            <section id="stock-mix" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-[var(--kia-text)]"><span className="mr-4 text-[13px] text-[var(--dashboard-action-bg)]">04</span>Inventory mix</h2>
                <p className="text-[15px] font-semibold text-[var(--kia-text-faint)]">What the {availableStock} units are made of</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ['By model', stockByModel],
                  ['By status', summary.overview.statusMix],
                  ['By dealer', summary.overview.dealerSplit],
                  ['By colour', summary.models.colorMix],
                ].map(([title, items]) => (
                  <Card key={title as string} className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                    <CardHeader><CardTitle className="text-[18px] font-black">{title as string}</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {(items as Array<{ name: string; value: number }>).slice(0, 6).map((item) => <div key={item.name} className="grid grid-cols-[110px_1fr_30px] items-center gap-3 text-[14px]"><span className="font-semibold text-[var(--kia-text-soft)]">{item.name}</span><span className="h-2 rounded-full bg-[var(--kia-surface-sunken)]"><span className="block h-2 rounded-full bg-[var(--dashboard-action-bg)]" style={{ width: `${Math.max(6, (item.value / Math.max(1, availableStock)) * 100)}%` }} /></span><span className="font-black">{item.value}</span></div>)}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <section id="stock-supply" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-[var(--kia-text)]"><span className="mr-4 text-[13px] text-[var(--dashboard-action-bg)]">05</span>Days of supply — the stocking engine</h2>
                <p className="text-[15px] font-semibold text-[var(--kia-text-faint)]">Current stock ÷ daily sales rate. Healthy band 21–45 days.</p>
              </div>
              <Card className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                <CardContent className="space-y-5 p-7">
                  {modelCards.slice(0, 5).map((card) => {
                    const supply = soldThisMonth ? Math.round((card.units / Math.max(1, soldThisMonth / 30))) : 0
                    const statusText = supply < 21 ? 'RUNNING DRY' : supply > 90 ? 'OVERSTOCKED' : 'HEALTHY'
                    return <div key={card.model} className="grid grid-cols-[190px_1fr_140px] items-center gap-5 border-b border-[var(--kia-hairline)] pb-4 last:border-0"><div><p className="text-[16px] font-black text-[var(--kia-text)]">{card.model}</p><p className="text-[13px] font-semibold text-[var(--kia-text-soft)]">{card.units} in stock</p></div><div className="relative h-3 rounded-full bg-[var(--kia-surface-sunken)]"><span className="absolute left-[23%] top-0 h-3 w-[22%] bg-emerald-100" /><span className="absolute top-[-9px] h-8 w-1 rounded bg-[var(--dashboard-danger)]" style={{ left: `${Math.min(96, supply)}%` }} /></div><div className="text-right"><span className={cn('rounded-lg px-3 py-2 text-[13px] font-black', statusText === 'HEALTHY' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-[var(--dashboard-danger)]')}>{statusText}</span><p className="mt-2 text-[12px] font-semibold text-[var(--kia-text-soft)]">{supply}d supply</p></div></div>
                  })}
                </CardContent>
              </Card>
            </section>

            <section id="stock-by-model" className="scroll-mt-24">
              <div className="mb-4 flex items-end justify-between gap-4">
                <h2 className="text-[23px] font-black text-[var(--kia-text)]"><span className="mr-4 text-[13px] text-[var(--dashboard-action-bg)]">06</span>Stock by model & trim</h2>
                <p className="text-[15px] font-semibold text-[var(--kia-text-faint)]">Detailed stock levels and trim mix by vehicle model</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                {modelCards.map((card) => (
                  <Card key={card.model} className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm hover:shadow-md transition">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-[20px] font-black text-[var(--kia-text)]">{card.model}</CardTitle>
                          <CardDescription className="font-semibold text-[var(--kia-text-soft)]">{formatMoney(card.stockValue)} total capital</CardDescription>
                        </div>
                        <Badge className="bg-[var(--dashboard-action-bg)] text-white hover:bg-[var(--dashboard-action-bg)] rounded-lg px-3 py-1 font-black text-[13px]">
                          {card.units} Units
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 rounded-xl bg-[var(--kia-surface-sunken)] p-3.5 text-center">
                        <div>
                          <p className="text-[11px] font-black uppercase text-[var(--kia-text-soft)]">Avg Stock Age</p>
                          <p className="mt-1 text-[20px] font-black text-[var(--kia-text)]">{card.avgAge} days</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-black uppercase text-[var(--kia-text-soft)]">Free / In-Transit</p>
                          <p className="mt-1 text-[20px] font-black text-[var(--kia-text)]">{card.freeStock} / {card.inTransit}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-[var(--kia-text-soft)] mb-2.5">Stock by Trim</p>
                        <div className="space-y-2">
                          {card.variants.map((trim) => (
                            <div key={trim.name} className="grid grid-cols-[160px_1fr_30px] items-center gap-3 text-[13px]">
                              <span className="font-semibold text-[var(--kia-text-soft)] truncate" title={trim.name}>{trim.name}</span>
                              <span className="h-2.5 rounded-full bg-[var(--kia-surface-sunken)] relative overflow-hidden">
                                <span className="absolute left-0 top-0 h-full rounded-full bg-[var(--dashboard-action-bg)]" style={{ width: `${(trim.value / card.units) * 100}%` }} />
                              </span>
                              <span className="font-black text-[var(--kia-text)] text-right">{trim.value}</span>
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
                <h2 className="text-[23px] font-black text-[var(--kia-text)]"><span className="mr-4 text-[13px] text-[var(--dashboard-action-bg)]">06</span>Reorder & clear</h2>
                <p className="text-[15px] font-semibold text-[var(--kia-text-faint)]">Where to chase supply vs. where to free up cash</p>
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <Card className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                      <CardTitle className="text-[18px] font-black text-emerald-700">▲ Fast movers — protect availability</CardTitle>
                      <CardDescription>Ranked by recent sales/stock concentration</CardDescription>
                    </div>
                    <div className="flex rounded-lg bg-[var(--kia-surface-sunken)] p-1">
                      <button 
                        type="button" 
                        onClick={() => setFastMovingMode('models')} 
                        className={cn('rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider transition', fastMovingMode === 'models' ? 'bg-[var(--kia-surface)] text-[var(--kia-text)] shadow-sm' : 'text-[var(--kia-text-soft)] hover:text-[var(--kia-text)]')}
                      >
                        Models
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setFastMovingMode('trims')} 
                        className={cn('rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider transition', fastMovingMode === 'trims' ? 'bg-[var(--kia-surface)] text-[var(--kia-text)] shadow-sm' : 'text-[var(--kia-text-soft)] hover:text-[var(--kia-text)]')}
                      >
                        Trims
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {fastMovingMode === 'models' ? (
                      fastestModels.map((card, index) => (
                        <div key={card.model} className="border-b border-[var(--kia-hairline)] pb-4 last:border-0">
                          <div className="flex justify-between">
                            <p className="font-black">
                              <span className="mr-3 rounded-md bg-[var(--dashboard-action-bg)] px-2 py-1 text-white">{index + 1}</span>
                              {card.model}
                            </p>
                            <p className="font-black">{card.units} units</p>
                          </div>
                          <p className="mt-1 text-[13px] font-semibold text-[var(--kia-text-soft)]">Protect availability; review fast-selling trims weekly.</p>
                        </div>
                      ))
                    ) : (
                      (summary.trims?.fastest || []).map((trim, index) => (
                        <div key={`${trim.model}-${trim.variant}`} className="border-b border-[var(--kia-hairline)] pb-4 last:border-0">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-black text-[var(--kia-text)]">
                                <span className="mr-3 rounded-md bg-[var(--dashboard-action-bg)] px-2 py-0.5 text-white text-[12px]">{index + 1}</span>
                                {trim.variant}
                              </p>
                              <p className="mt-1 text-[12px] font-bold text-[var(--kia-text-faint)]">{trim.model}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-emerald-700">{trim.salesCount90d} sold (90d)</p>
                              <p className="mt-0.5 text-[12px] font-semibold text-[var(--kia-text-soft)]">{trim.stockCount} in stock</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                <Card className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                      <CardTitle className="text-[18px] font-black text-[var(--dashboard-danger)]">▼ Slow movers — free the cash</CardTitle>
                      <CardDescription>High age against weak recent movement</CardDescription>
                    </div>
                    <div className="flex rounded-lg bg-[var(--kia-surface-sunken)] p-1">
                      <button 
                        type="button" 
                        onClick={() => setSlowMovingMode('models')} 
                        className={cn('rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider transition', slowMovingMode === 'models' ? 'bg-[var(--kia-surface)] text-[var(--kia-text)] shadow-sm' : 'text-[var(--kia-text-soft)] hover:text-[var(--kia-text)]')}
                      >
                        Models
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setSlowMovingMode('trims')} 
                        className={cn('rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider transition', slowMovingMode === 'trims' ? 'bg-[var(--kia-surface)] text-[var(--kia-text)] shadow-sm' : 'text-[var(--kia-text-soft)] hover:text-[var(--kia-text)]')}
                      >
                        Trims
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {slowMovingMode === 'models' ? (
                      slowestModels.map((card) => (
                        <div key={card.model} className="border-b border-[var(--kia-hairline)] pb-4 last:border-0">
                          <div className="flex justify-between">
                            <p className="font-black">{card.model}</p>
                            <p className="font-black">{card.avgAge}d avg</p>
                          </div>
                          <p className="mt-1 text-[13px] font-semibold text-[var(--kia-text-soft)]">{card.units} stock · cut fresh orders and push exchange/discount focus.</p>
                        </div>
                      ))
                    ) : (
                      (summary.trims?.slowest || []).map((trim) => (
                        <div key={`${trim.model}-${trim.variant}`} className="border-b border-[var(--kia-hairline)] pb-4 last:border-0">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-black text-[var(--kia-text)]">{trim.variant}</p>
                              <p className="mt-1 text-[12px] font-bold text-[var(--kia-text-faint)]">{trim.model} · {trim.stockCount} in stock</p>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-rose-700">{trim.avgAge}d avg age</p>
                              <p className="mt-0.5 text-[12px] font-semibold text-[var(--kia-text-soft)]">{trim.salesCount90d} sold (90d)</p>
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
                <h2 className="text-[23px] font-black text-[var(--kia-text)]"><span className="mr-4 text-[13px] text-[var(--dashboard-action-bg)]">07</span>Aged inventory action list — 90+ days</h2>
                <p className="text-[15px] font-semibold text-[var(--kia-text-faint)]">
                  {rows90Plus.length} units · {formatMoneyExpanded(rows90Plus.reduce((sum, r) => sum + r.stockValue, 0))} capital frozen
                </p>
              </div>
              <Card className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                <CardContent className="overflow-x-auto p-4">
                  <Table className="[&_td]:py-2.5 [&_td]:text-[12px] [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow>
                        {['Age', 'Model', 'Variant', 'Colour', 'VIN', 'In stock', 'Value', 'Carrying Cost (MO)', 'Interest Accrued', 'Suggested action'].map((heading) => (
                          <TableHead key={heading} className="font-black uppercase tracking-[0.08em] text-[var(--kia-text-soft)]">{heading}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows90Plus.map((row) => (
                        <TableRow key={row.rowKey}>
                          <TableCell>
                            <span className={cn('rounded-full px-3 py-1 text-white font-black', row.stockAge > 120 ? 'bg-[var(--dashboard-danger)]' : 'bg-[#e17a29]')}>
                              {row.stockAge}d
                            </span>
                          </TableCell>
                          <TableCell className="font-black text-[var(--kia-text)]">{row.model}</TableCell>
                          <TableCell className="font-semibold text-[var(--kia-text-soft)]">{row.variant}</TableCell>
                          <TableCell className="text-[var(--kia-text-soft)]">{row.color}</TableCell>
                          <TableCell className="font-mono text-[12px]">{row.vin || '-'}</TableCell>
                          <TableCell className="text-[var(--kia-text-soft)]">{formatDate(row.grnDate || row.departureDate)}</TableCell>
                          <TableCell className="font-black text-[var(--kia-text)]">{formatMoneyExpanded(row.stockValue)}</TableCell>
                          <TableCell className="font-bold text-[var(--kia-text-soft)]">{formatMoneyExpanded(row.carryingCostMonth)}</TableCell>
                          <TableCell className="font-black text-red-700">{formatMoneyExpanded(row.interestAccrued)}</TableCell>
                          <TableCell className="text-[var(--kia-text-soft)] font-medium">Liquidate: max discount + exchange</TableCell>
                        </TableRow>
                      ))}
                      {!rows90Plus.length ? (
                        <TableRow>
                          <TableCell colSpan={10} className="py-10 text-center font-bold text-[var(--kia-text-soft)]">
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
                <h2 className="text-[23px] font-black text-[var(--kia-text)]"><span className="mr-4 text-[13px] text-[var(--dashboard-action-bg)]">08</span>Stock explorer</h2>
                <p className="text-[15px] font-semibold text-[var(--kia-text-faint)]">Filter, search and sort the live lot</p>
              </div>
              <Card className="rounded-[1.2rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                <CardContent className="space-y-5 p-5">
                  <div className="grid gap-3 xl:grid-cols-[1fr_150px_150px_auto]">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kia-text-faint)]" />
                      <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="search VIN / variant..." className="h-11 rounded-xl bg-[var(--kia-surface)] pl-11 font-semibold" />
                    </div>
                    <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1) }}><SelectTrigger className="h-11 rounded-xl bg-[var(--kia-surface)] font-bold"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{(freshnessQuery.data?.statusOptions || []).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                    <Select value={model} onValueChange={(value) => { setModel(value); setPage(1) }}><SelectTrigger className="h-11 rounded-xl bg-[var(--kia-surface)] font-bold"><SelectValue placeholder="Model" /></SelectTrigger><SelectContent><SelectItem value="all">All models</SelectItem>{modelOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                    <Button onClick={handleExport} className="h-11 rounded-xl bg-[var(--dashboard-action-bg)] font-black text-white hover:bg-[var(--dashboard-action-hover)]"><Download className="mr-2 h-4 w-4" /> Export</Button>
                  </div>
                  <p className="text-[14px] font-semibold text-[var(--kia-text-soft)]">Showing {explorerRows.length} of {report?.pagination.totalRows || 0} units · {formatMoney(stockValue)} landed</p>
                  {reportQuery.isLoading ? <SkeletonBlock className="h-96" /> : (
                    <>
                      <div className="overflow-x-auto">
                        <Table className="[&_td]:text-[13px] [&_th]:text-[11px]">
                          <TableHeader><TableRow>{displayedColumns.map((column) => <TableHead key={column} className="border-b-2 border-slate-300 font-black uppercase tracking-[0.08em] text-[var(--kia-text-soft)]"><ColumnFilterDropdown column={column} label={toColumnLabel(column)} uniqueValues={reportQuery.data?.uniqueValues?.[column] || []} activeFilters={columnFilters[column] || []} onApply={(values) => { setColumnFilters((prev) => ({ ...prev, [column]: values })); setPage(1) }} onSort={(direction) => { setReportSort(column); setReportDirection(direction); setPage(1) }} isSortedAsc={reportSort === column && reportDirection === 'asc'} isSortedDesc={reportSort === column && reportDirection === 'desc'} /></TableHead>)}</TableRow></TableHeader>
                          <TableBody>{explorerRows.map((row, rowIndex) => <TableRow key={`${row.id || row.vin_no || rowIndex}-${rowIndex}`} className="odd:bg-[var(--kia-surface-sunken)] even:bg-[var(--kia-surface)] hover:bg-[var(--kia-surface-sunken)]/80 transition">{displayedColumns.map((column) => <TableCell key={column} className="whitespace-nowrap font-semibold text-[var(--kia-text-soft)]" title={String(row[column] ?? '')}>{String(row[column] ?? '-')}</TableCell>)}</TableRow>)}{!explorerRows.length ? <TableRow><TableCell colSpan={displayedColumns.length || 1} className="py-10 text-center font-bold text-[var(--kia-text-soft)]">No report rows found.</TableCell></TableRow> : null}</TableBody>
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

        <div className="mt-6 grid gap-3 rounded-[1.5rem] border border-[var(--kia-hairline)] bg-[var(--kia-surface)]/75 p-4 text-sm font-semibold text-[var(--kia-text-soft)] md:grid-cols-3">
          <p><CarFront className="mr-2 inline h-4 w-4 text-[var(--dashboard-action-bg)]" />Available stock counts only Free Stock + In transit.</p>
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
            "inline-flex items-center gap-1.5 text-left font-black tracking-wide transition rounded-md px-1.5 py-0.5 hover:bg-[var(--kia-surface-sunken)]/80 outline-none focus:ring-1 focus:ring-[var(--dashboard-action-bg)]/20 cursor-pointer select-none",
            hasActiveFilter && "text-[var(--dashboard-action-bg)] bg-rose-50 hover:bg-rose-100/70"
          )}
        >
          <span>{label}</span>
          <span className="flex items-center gap-0.5">
            {isSortedAsc && <ChevronDown className="h-3 w-3 rotate-180 text-[var(--dashboard-action-bg)]" />}
            {isSortedDesc && <ChevronDown className="h-3 w-3 text-[var(--dashboard-action-bg)]" />}
            {hasActiveFilter ? (
              <Filter className="h-3 w-3 fill-current text-[var(--dashboard-action-bg)]" />
            ) : (
              (!isSortedAsc && !isSortedDesc) && <ChevronDown className="h-3.5 w-3.5 text-[var(--kia-text-faint)] opacity-60" />
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-64 bg-[var(--dashboard-action-bg)] text-white border-white/15 shadow-xl rounded-[1.2rem] p-3 flex flex-col focus:outline-none"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Sort Section */}
        <button
          type="button"
          onClick={() => {
            onSort('asc')
            setOpen(false)
          }}
          className="flex items-center gap-2.5 w-full text-left rounded-lg px-2.5 py-2 text-[12px] font-semibold text-slate-300 hover:text-white hover:bg-black/20 transition cursor-pointer"
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
          className="flex items-center gap-2.5 w-full text-left rounded-lg px-2.5 py-2 text-[12px] font-semibold text-slate-300 hover:text-white hover:bg-black/20 transition cursor-pointer"
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
              ? "text-rose-400 hover:text-rose-300 hover:bg-black/20 cursor-pointer"
              : "text-[var(--kia-text-soft)] cursor-not-allowed opacity-50"
          )}
        >
          <XCircle className="h-4 w-4" />
          <span>Clear Filter from &quot;{label}&quot;</span>
        </button>

        <div className="my-1.5 border-t border-slate-700/50" />

        {/* Search Input Box */}
        <div className="relative mb-2 px-0.5">
          <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-[var(--kia-text-faint)]" />
          <Input
            type="text"
            placeholder="Search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="h-8 pl-8 pr-3 text-[11px] bg-black/20 border-slate-700 text-white rounded-lg focus-visible:ring-1 focus-visible:ring-rose-500 focus-visible:ring-offset-0 focus-visible:border-slate-600 placeholder-slate-400 shadow-inner"
            onKeyDown={(e) => e.stopPropagation()} // Stop propagation to prevent radix from closing
          />
        </div>

        {/* Scrollable Checkbox List */}
        <div className="max-h-44 overflow-y-auto space-y-1 px-0.5 pr-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {filteredValues.length > 0 && (
            <label className="flex items-center gap-2 px-1.5 py-1 hover:bg-black/20 rounded cursor-pointer text-[12px] text-slate-300 hover:text-white select-none transition">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={handleSelectAllChange}
                className="rounded border-slate-700 bg-transparent text-[var(--dashboard-action-bg)] focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5 cursor-pointer accent-[var(--dashboard-action-bg)]"
              />
              <span className="font-semibold text-slate-200">(Select All)</span>
            </label>
          )}
          {filteredValues.length === 0 ? (
            <div className="text-center py-4 text-[11px] text-[var(--kia-text-faint)] italic">
              No matches found
            </div>
          ) : (
            filteredValues.map((val) => (
              <label key={val} className="flex items-center gap-2 px-1.5 py-1 hover:bg-black/20 rounded cursor-pointer text-[12px] text-slate-300 hover:text-white select-none transition">
                <input
                  type="checkbox"
                  checked={tempChecked.includes(val)}
                  onChange={() => handleCheckboxChange(val)}
                  className="rounded border-slate-700 bg-transparent text-[var(--dashboard-action-bg)] focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5 cursor-pointer accent-[var(--dashboard-action-bg)]"
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
            className="h-7 px-2.5 text-[11px] font-semibold text-[var(--kia-text-faint)] hover:text-white hover:bg-transparent"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            type="button"
            className="h-7 px-3.5 text-[11px] font-bold bg-[var(--dashboard-action-bg)] text-white hover:bg-[var(--dashboard-action-bg)]/90 rounded-lg shadow-sm"
            onClick={handleApply}
          >
            OK
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
