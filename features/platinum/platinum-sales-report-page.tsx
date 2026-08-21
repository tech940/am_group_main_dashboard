'use client'

import type { ComponentProps, ReactNode } from 'react'
import { startTransition, useDeferredValue, useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowDown, ArrowDownUp, ArrowUp, BarChart3, CalendarDays, CarFront, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Download, Filter, Loader2, RefreshCw, Search, Target, TrendingUp, XCircle, FileText, CheckCircle2, Clock, Truck, IndianRupee, Users, AlertTriangle, FilterX } from 'lucide-react'
import { KpiCard as KpiCardComponent } from '@/components/ui/kpi-card'
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
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PlatinumRetailReviewPanel } from './platinum-retail-review-panel'
import { logApiTimings } from '@/lib/api/client-timing'
import type {
  ReportKey,
  SalesReportFreshnessPayload,
  SalesReportListPayload,
  SalesReportMetricPoint,
  SalesReportSummaryPayload,
} from '@/lib/platinum/sales-report-types'
import { getPlatinumBranchLabel } from '@/lib/platinum/dealer-branch'
import { cn } from '@/lib/utils'

type SearchParamsInput = Record<string, string | string[] | undefined>
type PageTab = 'overview' | 'models' | 'sources' | 'team' | 'trend' | 'lost' | 'retail' | 'review' | 'reports'

const PAGE_TABS: Array<{ key: PageTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'models', label: 'Models' },
  { key: 'sources', label: 'Sources' },
  { key: 'team', label: 'Team' },
  { key: 'trend', label: 'Trend' },
  { key: 'lost', label: 'Lost' },
  { key: 'retail', label: 'Retail' },
  // Mirrors KIA's tab of the same name: the two-year month x model retail matrix with the Q4
  // baseline. Kept separate from 'retail' (which is period-scoped KPIs) because this one spans two
  // full years and ignores the page's period filter entirely.
  { key: 'review', label: 'MD Review' },
  { key: 'reports', label: 'Reports' },
]

const REPORT_TABS: Array<{ key: ReportKey; label: string }> = [
  { key: 'enquiry', label: 'Enquiry Report' },
  { key: 'booking', label: 'Booking Report' },
  { key: 'sales', label: 'Sales Report' },
  { key: 'purchase', label: 'Purchase Report' },
]

const REPORT_SOURCE_COLUMN_LABEL: Record<ReportKey, string> = {
  enquiry: 'Sub Source',
  booking: 'Sub Source',
  sales: 'Sub Source',
  purchase: 'Source',
}

const REPORT_CONSULTANT_LABEL: Record<ReportKey, string> = {
  enquiry: 'Consultant',
  booking: 'Consultant',
  sales: 'Consultant',
  purchase: 'Dealer',
}

const CHART_COLORS = [
  '#055B65',
  '#0284C7',
  '#0D9488',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#0891B2',
  '#22C55E',
]

const PRIMARY_SURFACE =
  'rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white/88 shadow-xl shadow-slate-900/5 backdrop-blur-xl'

const TAB_TRIGGER_BASE_CLASS =
  'rounded-2xl border px-4 py-2 text-sm font-black shadow-sm transition'

function getTabTriggerClass(isActive: boolean) {
  return cn(
    TAB_TRIGGER_BASE_CLASS,
    isActive
      ? 'app-primary-action border-[color-mix(in_srgb,var(--dashboard-action-bg)_55%,transparent)] text-[var(--dashboard-action-fg)]'
      : 'border-[var(--dashboard-primary-border)] bg-white text-slate-600 hover:bg-[var(--dashboard-primary-soft)] hover:text-[var(--dashboard-action-bg)]'
  )
}

const REPORT_EXPANDED_DEFAULTS: Record<ReportKey, boolean> = {
  enquiry: false,
  booking: false,
  sales: false,
  purchase: false,
}

function readSingleParam(input: string | string[] | undefined) {
  return Array.isArray(input) ? input[0] : input
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN').format(Number.isFinite(value) ? value : 0)
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'NA'
  return `${Number(value).toFixed(digits)}%`
}

function formatCurrency(value: number | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0)
}

function formatCompactCurrency(value: number | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number.isFinite(amount) ? amount : 0)
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'NA'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function isInputDate(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function formatDateRangeLabel(startDate: string | null | undefined, endDate: string | null | undefined) {
  if (!isInputDate(startDate) || !isInputDate(endDate)) return null
  if (startDate === endDate) return formatDate(startDate)
  return `${formatDate(startDate)} – ${formatDate(endDate)}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'NA'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'NA'
  return `${date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })} IST`
}

function toColumnLabel(column: string) {
  return column
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function buildQueryString(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || value === 'all') return
    searchParams.set(key, String(value))
  })
  return searchParams.toString()
}

async function fetchReportJson<T>(url: string, label: string, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  let response: Response

  try {
    response = await fetch(url, { cache: 'no-store', signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`)
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }

  logApiTimings(response, label)
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error || `Request failed for ${label}`)
  }
  return (await response.json()) as T
}

function downloadBlob(content: BlobPart, fileName: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function ResponsiveContainer(props: ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center">
      <BarChart3 className="h-8 w-8 text-slate-400" />
      <p className="mt-3 text-base font-black text-slate-900">{title}</p>
      <p className="mt-1 max-w-xl text-sm font-medium leading-6 text-slate-500">{body}</p>
    </div>
  )
}

function ChartCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn(PRIMARY_SURFACE, className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-5 pb-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--dashboard-action-bg)]">{title}</p>
          {subtitle ? <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-5 pt-0">{children}</CardContent>
    </Card>
  )
}

const KPI_CARD_STYLES = [
  'border-t-[4px] border-t-rose-600',
  'border-t-[4px] border-t-sky-500',
  'border-t-[4px] border-t-emerald-600',
  'border-t-[4px] border-t-amber-500',
  'border-t-[4px] border-t-red-600',
  'border-t-[4px] border-t-purple-600',
  'border-t-[4px] border-t-indigo-600',
  'border-t-[4px] border-t-teal-600',
]

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4 mt-6">
      <h2 className="text-xl font-black tracking-tight text-slate-900 md:text-2xl">{title}</h2>
      {description && <p className="text-sm font-semibold text-slate-500 mt-1">{description}</p>}
    </div>
  )
}


function KpiCard({
  item,
  index,
}: {
  item: SalesReportSummaryPayload['overview']['kpis'][number]
  index: number
}) {
  const isPositiveDirection = item.trendDirection === 'lower_is_better'
    ? (item.changePct ?? 0) <= 0
    : (item.changePct ?? 0) >= 0
  const tone = item.changePct === null
    ? 'border-slate-200 bg-white/90 text-slate-500'
    : isPositiveDirection
      ? 'border-emerald-200 bg-emerald-50/85 text-emerald-700'
      : 'border-rose-200 bg-rose-50/85 text-rose-700'

  return (
    <Card className={cn(PRIMARY_SURFACE, KPI_CARD_STYLES[index % KPI_CARD_STYLES.length], 'min-h-[148px]')}>
      <CardContent className="p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{item.label}</p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[25px] font-black tracking-tight text-slate-950">{item.formattedValue}</p>
            <p className="mt-3 text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">{item.comparisonLabel}</p>
            <p className="mt-1 text-[16px] font-black text-slate-700">{item.formattedComparisonValue}</p>
            {item.comparisonContext ? <p className="mt-1 text-[11px] font-medium text-slate-500">{item.comparisonContext}</p> : null}
          </div>
          <span className={cn('rounded-full border px-2.5 py-1 text-[12px] font-black', tone)}>
            {item.changePct === null ? 'NA' : item.changeLabel}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryRailChip({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'red' | 'green'
}) {
  return (
    <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
      <span>
        {label}: <strong className="text-slate-900">{value}</strong>
      </span>
      {tone ? (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-black',
            tone === 'red' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
          )}
        >
          {tone === 'red' ? '▼' : '▲'} MoM
        </span>
      ) : null}
    </div>
  )
}

function renderPieChart(data: SalesReportMetricPoint[], valueFormatter?: (value: number) => string) {
  if (!data.length) return <EmptyState title="No chart data" body="This month does not have enough rows for the selected slice." />

  return (
    <div className="space-y-4">
      <div className="mx-auto h-72 max-w-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={68}
              outerRadius={104}
              paddingAngle={3}
              stroke="#ffffff"
              strokeWidth={3}
            >
              {data.map((entry, index) => (
                <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => (valueFormatter ? valueFormatter(Number(value)) : formatNumber(Number(value)))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.map((entry, index) => (
          <div key={`${entry.name}-${index}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
              <span className="text-sm font-bold text-slate-700">{entry.name}</span>
            </div>
            <span className="text-sm font-black text-slate-950">{valueFormatter ? valueFormatter(entry.value) : formatNumber(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function renderBarChart<T extends Record<string, string | number>>({
  data,
  xKey,
  bars,
  stacked = false,
  height = 300,
}: {
  data: T[]
  xKey: keyof T
  bars: Array<{ key: keyof T; label: string; color: string }>
  stacked?: boolean
  height?: number
}) {
  if (!data.length) return <EmptyState title="No chart data" body="This month does not have enough rows for the selected view." />

  return (
    <div className={`h-[${height}px]`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.26)" vertical={false} />
          <XAxis dataKey={String(xKey)} tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
          <Tooltip formatter={(value) => formatNumber(Number(value))} />
          <Legend />
          {bars.map((bar, index) => (
            <Bar
              key={String(bar.key)}
              dataKey={String(bar.key)}
              name={bar.label}
              fill={bar.color || CHART_COLORS[index % CHART_COLORS.length]}
              radius={stacked ? [0, 0, 0, 0] : [8, 8, 0, 0]}
              stackId={stacked ? 'stack' : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function renderAreaChart(data: Array<Record<string, string | number>>, xKey: string, yKey: string, color: string) {
  if (!data.length) return <EmptyState title="No trend data" body="Daily rows are not available for the selected month." />

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="platinumSalesArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.26)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
          <Tooltip formatter={(value) => formatNumber(Number(value))} />
          <Area type="monotone" dataKey={yKey} stroke={color} fill="url(#platinumSalesArea)" strokeWidth={3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function ProgressMetricRow({
  label,
  value,
  subtitle,
  percent,
  color,
  trailing,
}: {
  label: string
  value?: string
  subtitle?: string
  percent: number
  color: string
  trailing?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-900">{label}</p>
          {subtitle ? <p className="mt-0.5 text-[13px] font-medium text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="text-right">
          {value ? <p className="text-[15px] font-black text-slate-950">{value}</p> : null}
          {trailing ? <p className="text-[11px] font-bold text-slate-500">{trailing}</p> : null}
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function getMetricOptions(summary: SalesReportSummaryPayload | undefined) {
  const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right))
  return {
    source: unique(summary?.sources.items.map((item) => item.source) || []),
    model: unique(summary?.models.items.map((item) => item.model) || []),
    consultant: unique(summary?.team.leaderboard.map((item) => item.consultant) || []),
  }
}

function formatCellValue(column: string, value: unknown) {
  if (value === null || value === undefined || value === '') return 'NA'
  const text = String(value)
  if (column.includes('date') || column.endsWith('_at')) {
    return column.endsWith('_at') ? formatDateTime(text) : formatDate(text)
  }
  if (typeof value === 'number') {
    if (column.includes('amount') || column.includes('price') || column.includes('revenue') || column.includes('tax')) {
      return formatCurrency(value)
    }
    return formatNumber(value)
  }
  if (/^-?\d+(\.\d+)?$/.test(text) && (column.includes('amount') || column.includes('price') || column.includes('revenue') || column.includes('tax'))) {
    return formatCurrency(Number(text))
  }
  return text
}

export function PlatinumSalesReportPage({
  initialSearchParams = {},
  currentUserRole = null,
}: {
  initialSearchParams?: SearchParamsInput
  currentUserRole?: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [activeTab, setActiveTab] = useState<PageTab>(() => {
    const raw = readSingleParam(initialSearchParams.tab)
    return PAGE_TABS.some((tab) => tab.key === raw) ? (raw as PageTab) : 'overview'
  })
  const [activeReport, setActiveReport] = useState<ReportKey>(() => {
    const raw = readSingleParam(initialSearchParams.report)
    return REPORT_TABS.some((tab) => tab.key === raw) ? (raw as ReportKey) : 'sales'
  })
  const [selectedYear, setSelectedYear] = useState<number | null>(() => {
    const raw = Number(readSingleParam(initialSearchParams.year))
    return Number.isFinite(raw) ? raw : null
  })
  const [selectedMonth, setSelectedMonth] = useState<number | null>(() => {
    const raw = Number(readSingleParam(initialSearchParams.month))
    return Number.isFinite(raw) ? Math.max(0, raw - 1) : null
  })
  const [selectedStartDate, setSelectedStartDate] = useState<string>(() => {
    const raw = readSingleParam(initialSearchParams.startDate)
    return isInputDate(raw) ? (raw as string) : ''
  })
  const [selectedEndDate, setSelectedEndDate] = useState<string>(() => {
    const raw = readSingleParam(initialSearchParams.endDate)
    return isInputDate(raw) ? (raw as string) : ''
  })
  const [selectedDealerCode, setSelectedDealerCode] = useState<string | null>(readSingleParam(initialSearchParams.dealer_code) || null)
  const [modelSourceFilter, setModelSourceFilter] = useState('all')
  const [reportSearch, setReportSearch] = useState(readSingleParam(initialSearchParams.search) || '')
  const [reportPage, setReportPage] = useState(1)
  const [reportPageSize, setReportPageSize] = useState(25)
  const [reportSort, setReportSort] = useState(readSingleParam(initialSearchParams.sort) || '')
  const [reportDirection, setReportDirection] = useState<'asc' | 'desc'>((readSingleParam(initialSearchParams.direction) || 'desc') === 'asc' ? 'asc' : 'desc')
  const [reportSource, setReportSource] = useState('all')
  const [reportModel, setReportModel] = useState('all')
  const [reportConsultant, setReportConsultant] = useState('all')
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [monthPickerView, setMonthPickerView] = useState(() => new Date())
  const [pendingStartDate, setPendingStartDate] = useState('')
  const [pendingEndDate, setPendingEndDate] = useState('')
  const [lostDialogOpen, setLostDialogOpen] = useState(false)
  const [lostSearch, setLostSearch] = useState('')
  const [retailSearch, setRetailSearch] = useState('')
  const [expandedReportColumns, setExpandedReportColumns] = useState(REPORT_EXPANDED_DEFAULTS)
  const shouldRefreshNext = useRef(false)

  /*
   * Every filter on this page and its default, in one place.
   *
   * `activeTab` is deliberately NOT reset — which tab you are reading is navigation, not a filter,
   * and yanking someone back to Overview when they asked to clear a search would be its own bug.
   * Month/year and the custom range clear to null/'' rather than to "this month", so the
   * report-aware default (newest period that actually has data for the open tab) takes over again.
   */
  const filtersAreDefault =
    activeReport === 'sales' &&
    selectedYear === null &&
    selectedMonth === null &&
    selectedStartDate === '' &&
    selectedEndDate === '' &&
    selectedDealerCode === null &&
    reportSearch === '' &&
    reportSort === '' &&
    reportDirection === 'desc' &&
    reportSource === 'all' &&
    reportModel === 'all' &&
    reportConsultant === 'all' &&
    reportPage === 1 &&
    reportPageSize === 25

  const resetFilters = useCallback(() => {
    setActiveReport('sales')
    setSelectedYear(null)
    setSelectedMonth(null)
    setSelectedStartDate('')
    setSelectedEndDate('')
    setPendingStartDate('')
    setPendingEndDate('')
    setSelectedDealerCode(null)
    setReportSearch('')
    setReportSort('')
    setReportDirection('desc')
    setReportSource('all')
    setReportModel('all')
    setReportConsultant('all')
    setReportPage(1)
    setReportPageSize(25)
    // The URL is rebuilt from this state by the sync effect below, so clearing the state clears the
    // query string too — a reset that survives a page reload.
  }, [])

  // Retail accessories filter & sorting
  const [retailAccFilter, setRetailAccFilter] = useState<'all' | 'zero' | 'above5k' | 'under5k' | 'withAcc'>('all')
  const [retailSortField, setRetailSortField] = useState<string>('deliveryDate')
  const [retailSortDirection, setRetailSortDirection] = useState<'asc' | 'desc'>('desc')

  const deferredReportSearch = useDeferredValue(reportSearch)
  const deferredLostSearch = useDeferredValue(lostSearch)
  const deferredRetailSearch = useDeferredValue(retailSearch)

  const freshnessQuery = useQuery({
    queryKey: ['platinum-sales-report-freshness', selectedDealerCode || 'all'],
    queryFn: () =>
      fetchReportJson<SalesReportFreshnessPayload>(
        `/api/brands/platinum/sales-report/freshness?${buildQueryString({
          dealer_code: selectedDealerCode,
        })}`,
        'platinum-sales-report-freshness',
        25000
      ),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const now = new Date()
  const currentCalendarYear = now.getFullYear()
  const currentCalendarMonth = now.getMonth()
  const currentCalendarMonthKey = `${currentCalendarYear}-${String(currentCalendarMonth + 1).padStart(2, '0')}`

  /*
   * The default month must have data for the report you are actually looking at.
   *
   * `availableMonths` is a UNION across all four sources, so a month counts as "available" when any
   * ONE feed has rows for it. Measured 2026-08-20: platinum_booking_report was current (150 rows this
   * month) while platinum_sales_report and platinum_enquiry_report had not been uploaded since 28/29
   * July. August therefore looked available, the page defaulted to it, and the Sales tab — the main
   * tab of a Sales Report — queried a month its own feed had nothing for and rendered empty. It read
   * as "the data is not loading" when the feed was simply 23 days stale.
   *
   * So: prefer the newest month that has data for THIS report, and only then fall back to the union.
   * A month the user picked explicitly is always honoured — this changes the default, never a choice.
   */
  const monthsForActiveReport = (freshnessQuery.data?.availableMonths || [])
    .filter((item) => !item.sourceKeys || item.sourceKeys.length === 0 || item.sourceKeys.includes(activeReport))

  const effectiveSelectedMonthOption =
    freshnessQuery.data?.availableMonths.find((item) => item.year === selectedYear && item.month === selectedMonth) ||
    monthsForActiveReport.find((item) => item.key === (selectedYear !== null ? undefined : currentCalendarMonthKey)) ||
    monthsForActiveReport.find((item) => item.key === freshnessQuery.data?.selectedMonthKey) ||
    monthsForActiveReport[0] ||
    freshnessQuery.data?.availableMonths.find((item) => item.key === (selectedYear !== null ? undefined : currentCalendarMonthKey)) ||
    freshnessQuery.data?.availableMonths.find((item) => item.key === freshnessQuery.data?.selectedMonthKey) ||
    freshnessQuery.data?.availableMonths[0]

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
        monthKey: effectiveSelectedMonthOption?.key,
      }

  const periodReady = hasCompleteCustomRange || (effectiveSelectedYear !== null && effectiveSelectedMonth !== null)

  const summaryQuery = useQuery({
    queryKey: [
      'platinum-sales-report-summary',
      hasCompleteCustomRange ? selectedRangeStart : effectiveSelectedYear,
      hasCompleteCustomRange ? selectedRangeEnd : effectiveSelectedMonth,
      selectedDealerCode || 'all',
    ],
    enabled: periodReady,
    queryFn: () => {
      const refresh = shouldRefreshNext.current
      return fetchReportJson<SalesReportSummaryPayload>(
        `/api/brands/platinum/sales-report/summary?${buildQueryString({
          ...periodQueryParams,
          dealer_code: selectedDealerCode,
          refresh: refresh ? 'true' : undefined,
        })}`,
        'platinum-sales-report-summary',
        25000
      )
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  })

  const reportQuery = useQuery({
    queryKey: [
      'platinum-sales-report-report',
      activeReport,
      hasCompleteCustomRange ? selectedRangeStart : effectiveSelectedYear,
      hasCompleteCustomRange ? selectedRangeEnd : effectiveSelectedMonth,
      selectedDealerCode || 'all',
      reportSource,
      reportModel,
      reportConsultant,
      deferredReportSearch,
      reportSort,
      reportDirection,
      reportPage,
      reportPageSize,
    ],
    enabled: periodReady && activeTab === 'reports' && summaryQuery.isSuccess,
    queryFn: () => {
      const refresh = shouldRefreshNext.current
      return fetchReportJson<SalesReportListPayload>(
        `/api/brands/platinum/sales-report/reports?${buildQueryString({
          report: activeReport,
          ...periodQueryParams,
          dealer_code: selectedDealerCode,
          source: reportSource,
          model: reportModel,
          consultant: reportConsultant,
          search: deferredReportSearch,
          sort: reportSort,
          direction: reportDirection,
          page: reportPage,
          pageSize: reportPageSize,
          refresh: refresh ? 'true' : undefined,
        })}`,
        'platinum-sales-report-reports',
        25000
      )
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  })

  useEffect(() => {
    const params = new URLSearchParams()
    if (activeTab !== 'overview') params.set('tab', activeTab)
    if (activeReport !== 'sales') params.set('report', activeReport)
    if (hasCompleteCustomRange) {
      params.set('startDate', selectedRangeStart)
      params.set('endDate', selectedRangeEnd)
    } else {
      if (effectiveSelectedYear !== null) params.set('year', String(effectiveSelectedYear))
      if (effectiveSelectedMonth !== null) params.set('month', String(effectiveSelectedMonth + 1))
    }
    if (selectedDealerCode) params.set('dealer_code', selectedDealerCode)

    startTransition(() => {
      router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false })
    })
  }, [activeReport, activeTab, effectiveSelectedMonth, effectiveSelectedYear, hasCompleteCustomRange, pathname, router, selectedDealerCode, selectedRangeEnd, selectedRangeStart])

  const freshness = freshnessQuery.data
  const summary = summaryQuery.data
  const selectedMonthOption = effectiveSelectedMonthOption
  const activePeriodLabel = summary?.context.selectedMonthLabel || customRangeLabel || selectedMonthOption?.label || 'Current period'
  // What the KPI values actually cover. A custom range must show the RANGE — with 01–20 Aug selected,
  // captioning the cards "Aug 2026" implies a full month of data that is not there.
  const selectedPeriodLabel = (hasCompleteCustomRange ? customRangeLabel : selectedMonthOption?.label)
    || customRangeLabel || selectedMonthOption?.label || 'Selected period'
  const metricOptions = getMetricOptions(summary)
  const visibleColumns = reportQuery.data
    ? expandedReportColumns[activeReport]
      ? reportQuery.data.columns
      : reportQuery.data.defaultVisibleColumns
    : []

  const modelBreakdown =
    modelSourceFilter === 'all'
      ? summary?.models.items.map((item) => ({ model: item.model, enquiries: item.enquiries, bookings: item.bookings })) || []
      : summary?.models.sourceBreakdown[modelSourceFilter] || []

  const testDrivesByModel = summary?.models.testDrivesByModel || []
  const testDrivesTotal = testDrivesByModel.reduce((sum, item) => sum + item.testDrives, 0)

  /*
   * Grand total for the leaderboard table. The counts are summed, but every rate is RECOMPUTED from
   * the summed numerator and denominator — averaging the per-consultant percentages would weight a
   * consultant with three enquiries the same as one with three hundred and produce a figure that
   * matches nothing else on the page. Because the query no longer truncates to a top 20, these sums
   * tie back to the headline Enquiries and Bookings cards.
   */
  const leaderboardTotals = useMemo(() => {
    const rows = summary?.team.leaderboard || []
    const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0)
    const enquiries = sum((row) => row.enquiries)
    const bookings = sum((row) => row.bookings)
    const walkinEnquiries = sum((row) => row.walkinEnquiries)
    const walkinBookings = sum((row) => row.walkinBookings)
    const testDrives = sum((row) => row.testDrives)
    return {
      consultants: rows.length,
      enquiries,
      bookings,
      walkinEnquiries,
      walkinBookings,
      testDrives,
      bookingRatePct: enquiries > 0 ? (bookings / enquiries) * 100 : 0,
      walkinConversionPct: walkinEnquiries > 0 ? (walkinBookings / walkinEnquiries) * 100 : 0,
      tdRatePct: enquiries > 0 ? (testDrives / enquiries) * 100 : 0,
    }
  }, [summary?.team.leaderboard])

  const filteredLostRows =
    summary?.lost.rows.filter((row) => {
      const needle = deferredLostSearch.trim().toLowerCase()
      if (!needle) return true
      return [
        row.customer,
        row.phone,
        row.model,
        row.source,
        row.consultant,
        row.lostReason,
        row.lostDueTo,
        row.lostRemark,
      ].some((value) => value.toLowerCase().includes(needle))
    }) || []

  const filteredRetailRows = useMemo(() => {
    let rows = summary?.retail.transactions || []

    if (retailAccFilter === 'zero') {
      rows = rows.filter((r) => !r.accessoriesValue || r.accessoriesValue === 0)
    } else if (retailAccFilter === 'above5k') {
      rows = rows.filter((r) => Number(r.accessoriesValue || 0) > 5000)
    } else if (retailAccFilter === 'under5k') {
      rows = rows.filter((r) => Number(r.accessoriesValue || 0) > 0 && Number(r.accessoriesValue || 0) <= 5000)
    } else if (retailAccFilter === 'withAcc') {
      rows = rows.filter((r) => Number(r.accessoriesValue || 0) > 0)
    }

    const needle = deferredRetailSearch.trim().toLowerCase()
    if (needle) {
      rows = rows.filter((row) =>
        [
          row.customerName,
          row.phone,
          row.model,
          row.variant,
          row.consultant,
          row.source,
          row.financier,
          row.vin,
          row.customerId,
        ].some((value) => String(value || '').toLowerCase().includes(needle))
      )
    }

    const sorted = [...rows].sort((a, b) => {
      let comp = 0
      if (
        retailSortField === 'accessoriesValue' ||
        retailSortField === 'exShowroomPrice' ||
        retailSortField === 'accessoriesCount' ||
        retailSortField === 'deliveryDays'
      ) {
        const valA = Number(a[retailSortField as keyof typeof a] ?? 0)
        const valB = Number(b[retailSortField as keyof typeof b] ?? 0)
        comp = valA - valB
      } else {
        const strA = String(a[retailSortField as keyof typeof a] ?? '')
        const strB = String(b[retailSortField as keyof typeof b] ?? '')
        comp = strA.localeCompare(strB)
      }
      return retailSortDirection === 'asc' ? comp : -comp
    })

    return sorted
  }, [summary?.retail.transactions, retailAccFilter, deferredRetailSearch, retailSortField, retailSortDirection])

  async function handleCsvExport() {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    const response = await fetch(
      `/api/brands/platinum/sales-report/reports?${buildQueryString({
        report: activeReport,
        ...periodQueryParams,
        dealer_code: selectedDealerCode,
        source: reportSource,
        model: reportModel,
        consultant: reportConsultant,
        search: deferredReportSearch,
        sort: reportSort,
        direction: reportDirection,
        format: 'csv',
      })}`,
      { cache: 'no-store', signal: controller.signal }
    ).finally(() => window.clearTimeout(timeout))

    logApiTimings(response, 'platinum-sales-report-export')
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(payload?.error || 'Unable to export report')
    }
    const content = await response.text()
    const disposition = response.headers.get('content-disposition') || ''
    const fileNameMatch = disposition.match(/filename="([^"]+)"/i)
    downloadBlob(content, fileNameMatch?.[1] || `platinum-${activeReport}.csv`, 'text/csv;charset=utf-8')
  }

  function handleMonthChange(key: string) {
    const month = freshness?.availableMonths.find((item) => item.key === key)
    if (!month) return
    setSelectedYear(month.year)
    setSelectedMonth(month.month)
    setSelectedStartDate('')
    setSelectedEndDate('')
    setPendingStartDate('')
    setPendingEndDate('')
    setReportPage(1)
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
    setReportPage(1)
    setMonthPickerOpen(false)
  }

  function clearCustomDateRange() {
    setPendingStartDate('')
    setPendingEndDate('')
    setSelectedStartDate('')
    setSelectedEndDate('')
    setReportPage(1)
  }

  function handleReportColumnSort(column: string) {
    if (reportSort === column) {
      setReportDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setReportSort(column)
    setReportDirection('asc')
  }

  function resetReportFilters() {
    setReportSearch('')
    setReportSource('all')
    setReportModel('all')
    setReportConsultant('all')
    setReportPage(1)
    setReportSort('')
    setReportDirection('desc')
  }

  function handleRetailSort(field: string) {
    if (retailSortField === field) {
      setRetailSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setRetailSortField(field)
      setRetailSortDirection(
        field === 'accessoriesValue'
          ? 'asc'
          : field === 'customerName' || field === 'model' || field === 'variant' || field === 'consultant'
          ? 'asc'
          : 'desc'
      )
    }
  }

  const summaryMonthReady = periodReady
  const summaryUpdating = freshnessQuery.isFetching || (summaryMonthReady && summaryQuery.isFetching)
  const headerLoading = summaryUpdating
  const pageError = freshnessQuery.error || summaryQuery.error

  const availableMonthKeys = new Set((freshness?.availableMonths || []).map((item) => item.key))
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
  const selectedMonthDateKey = selectedMonthOption
    ? `${selectedMonthOption.year}-${String(selectedMonthOption.month + 1).padStart(2, '0')}-${String(
        selectedMonthOption.year === today.getFullYear() && selectedMonthOption.month === today.getMonth()
          ? today.getDate()
          : 1
      ).padStart(2, '0')}`
    : ''

  const enquiryKpi = summary?.overview.kpis.find((k) => k.label.toLowerCase().includes('enquir'))
  const bookingKpi = summary?.overview.kpis.find((k) => k.label.toLowerCase().includes('book'))
  const deliveryKpi = summary?.overview.kpis.find((k) => k.label.toLowerCase().includes('deliver') || k.label.toLowerCase().includes('retail'))
  const revenueKpi = summary?.overview.kpis.find((k) => k.label.toLowerCase().includes('revenue'))

  return (
    <MainLayout title="Sales Report" subtitle="AM Platinum sales analytics workspace">
      <div className="space-y-6 pb-4">
        {/* Unified Top Header Bar with Date Range, Calendar Picker & Summary Rail */}
        <div className="overflow-hidden rounded-[2rem] border border-[#cbd8e4] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
          <div className="h-1.5 bg-[linear-gradient(90deg,#055B65_0%,#0284C7_28%,#0D9488_55%,#F59E0B_78%,#EF4444_100%)]" />
          <div className="flex flex-col gap-4 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Left side: Period info & KPI chips */}
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Updated {formatDateTime(freshness?.sourceUpdatedAt || null)}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[26px] font-black text-[#071a2b]">
                  <CalendarDays className="h-6 w-6 shrink-0 text-[#0284C7]" />
                  <span>{headerLoading ? 'Loading period...' : activePeriodLabel}</span>
                </div>
              </div>
              <div className="hidden h-6 w-px bg-[#d6e0ea] lg:block" />
              <div className="flex flex-wrap items-center gap-3">
                {enquiryKpi ? (
                  <SummaryRailChip
                    label="Enquiries"
                    value={enquiryKpi.formattedValue}
                    tone={enquiryKpi.changePct !== null && enquiryKpi.changePct >= 0 ? 'green' : 'red'}
                  />
                ) : null}
                {bookingKpi ? (
                  <SummaryRailChip
                    label="Bookings"
                    value={bookingKpi.formattedValue}
                    tone={bookingKpi.changePct !== null && bookingKpi.changePct >= 0 ? 'green' : 'red'}
                  />
                ) : null}
                {deliveryKpi ? (
                  <SummaryRailChip
                    label="Deliveries"
                    value={deliveryKpi.formattedValue}
                    tone={deliveryKpi.changePct !== null && deliveryKpi.changePct >= 0 ? 'green' : 'red'}
                  />
                ) : null}
                {revenueKpi ? (
                  <SummaryRailChip
                    label="Revenue"
                    value={revenueKpi.formattedValue}
                    tone={revenueKpi.changePct !== null && revenueKpi.changePct >= 0 ? 'green' : 'red'}
                  />
                ) : null}
              </div>
            </div>

            {/* Right side controls: Date Range Calendar Dropdown, Dealer Selector & Refresh Button */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-end">
              <div className="min-w-[240px] sm:flex-1">
                <p className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Date Range</p>
                <DropdownMenu
                  open={monthPickerOpen}
                  onOpenChange={(open) => {
                    setMonthPickerOpen(open)
                    if (open) {
                      setPendingStartDate(selectedStartDate)
                      setPendingEndDate(selectedEndDate)
                      const anchorDate = selectedEndDate || selectedStartDate
                      const parsedAnchor = anchorDate ? new Date(`${anchorDate}T00:00:00`) : null
                      setMonthPickerView(
                        new Date(
                          parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
                            ? parsedAnchor.getFullYear()
                            : selectedMonthOption?.year ?? today.getFullYear(),
                          parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
                            ? parsedAnchor.getMonth()
                            : selectedMonthOption?.month ?? today.getMonth(),
                          1
                        )
                      )
                    }
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full flex items-center justify-between gap-2 rounded-[1rem] border-[#d8e2ec] bg-white px-4 text-[13px] font-semibold text-slate-900 shadow-sm hover:bg-white min-w-0"
                    >
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="truncate text-left">
                          {customRangeLabel || selectedMonthOption?.label || 'Select dates'}
                        </span>
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[340px] rounded-[1.5rem] border border-[#d8e2ec] bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                    <div className="space-y-4">
                      {/* Month navigation header */}
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

                      {/* Day headers */}
                      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                          <div key={`${day}-${index}`} className="py-1">
                            {day}
                          </div>
                        ))}
                      </div>

                      {/* Day cells */}
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
                                day.isAvailable ? 'hover:bg-[#edf4fb] hover:text-[#071a2b]' : 'cursor-not-allowed opacity-35',
                                isInSelectedRange && 'bg-[#e6f2fb] text-[#071a2b]',
                                isToday && 'ring-2 ring-[#0284C7]/50 ring-offset-2',
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
                        {/* Range status label */}
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

                        {/* Action buttons */}
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              'flex-1 rounded-full border px-3 py-1 text-[11px] font-black shadow-none',
                              availableMonthKeys.has(todayMonthKey)
                                ? 'border-[#0284C7]/35 bg-white text-[#0284C7] hover:bg-sky-50'
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

              <div className="min-w-[170px] sm:flex-1">
                <p className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Dealer</p>
                <Select
                  value={selectedDealerCode || 'all'}
                  onValueChange={(value) => {
                    setSelectedDealerCode(value === 'all' ? null : value)
                    setReportPage(1)
                  }}
                >
                  <SelectTrigger className="h-11 rounded-[1rem] border-[#d8e2ec] bg-white px-4 text-[13px] font-semibold text-slate-900 shadow-sm">
                    <SelectValue placeholder="All dealers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All dealers</SelectItem>
                    {(freshness?.dealerOptions || []).map((dealerCode) => (
                      <SelectItem key={dealerCode} value={dealerCode}>
                        {getPlatinumBranchLabel(dealerCode)} ({dealerCode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="button"
                variant="outline"
                title={filtersAreDefault ? 'No filters applied' : 'Clear date range, dealer, search, sorting and report filters'}
                className="h-11 rounded-[1rem] border-slate-200 px-4 text-[13px] font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                onClick={resetFilters}
                disabled={filtersAreDefault}
              >
                <FilterX className="h-4 w-4" />
                Reset
              </Button>
              <Button
                type="button"
                className="h-11 rounded-[1rem] border border-[#071a2b] bg-[#071a2b] px-5 text-[13px] font-black text-white hover:bg-[#071a2b]/95"
                onClick={() => {
                  shouldRefreshNext.current = true
                  void freshnessQuery.refetch()
                  void summaryQuery.refetch()
                  if (activeTab === 'reports') void reportQuery.refetch()
                  setTimeout(() => {
                    shouldRefreshNext.current = false
                  }, 1000)
                }}
                disabled={headerLoading}
              >
                {headerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {pageError ? (
          <div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-rose-700">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-lg font-black">Unable to load Platinum Sales Report</p>
                <p className="mt-1 text-sm font-medium">{pageError instanceof Error ? pageError.message : 'Unknown error'}</p>
              </div>
            </div>
          </div>
        ) : null}

        {summaryUpdating ? (
          <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] px-4 py-2.5">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--dashboard-primary)]" />
            <p className="text-xs font-bold text-[var(--dashboard-primary-dark)]">
              Loading {selectedDealerCode ? getPlatinumBranchLabel(selectedDealerCode) : 'all dealerships'} &mdash; figures below are from the previous selection until this finishes.
            </p>
          </div>
        ) : null}

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as PageTab)}
          className={cn('space-y-4 transition-opacity', summaryUpdating && 'pointer-events-none opacity-40')}
        >
          <TabsList className="flex h-auto flex-wrap justify-start gap-2 rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white/80 p-2 shadow-sm">
            {PAGE_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className={getTabTriggerClass(activeTab === tab.key)}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-5">
            {(summary?.assumptions || []).filter((note) => note.includes('upload gap')).map((note) => (
              <div key={note} role="status" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                <p className="text-sm font-semibold text-amber-900">{note}</p>
              </div>
            ))}

            <SectionHeading title="Key Performance Metrics" description="Core enquiry, booking and conversion figures for the selected period" />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-5">
              {(summary?.overview.kpis || []).map((item, index) => (
                <KpiCard key={item.label} item={item} index={index} />
              ))}
              {summary?.missedFollowups ? (
                <Card className={cn(PRIMARY_SURFACE, 'min-h-[148px] border-rose-100 bg-[#fff5f5] hover:bg-[#ffebeb] transition-colors shadow-sm')}>
                  <CardContent className="p-4 flex flex-col justify-between h-full">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#c5162f]">Missed Follow-Ups</p>
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-[25px] font-black tracking-tight text-[#071a2b]">{summary.missedFollowups.count.toLocaleString('en-IN')}</p>
                        <Clock className="h-6 w-6 text-[#c5162f] animate-pulse" />
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Action Required</p>
                      <p className="text-[11px] font-semibold text-slate-600 mt-1">Pending customer outreach</p>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            {summary?.missedFollowups && summary.missedFollowups.count > 0 ? (
              <>
                <SectionHeading title="Missed Follow-Up Breakdown" description="Consultants, models and lead sources with pending customer outreach" />
                <div className="grid gap-5 md:grid-cols-3">
                  <Card className={cn(PRIMARY_SURFACE, 'border-rose-100/50 shadow-md')}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span className="text-base">👤</span> Missed by Consultant
                      </CardTitle>
                      <CardDescription className="text-[11px] text-slate-400">Consultants with pending outreach</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-2">
                      {summary.missedFollowups.byConsultant.length ? (
                        summary.missedFollowups.byConsultant.map((item) => {
                          const total = summary.missedFollowups!.count
                          const percentVal = total > 0 ? (item.value / total) * 100 : 0
                          return (
                            <ProgressMetricRow
                              key={item.name}
                              label={item.name}
                              value={formatNumber(item.value)}
                              trailing={`(${formatPercent(percentVal)})`}
                              percent={percentVal}
                              color="#e11d0f"
                            />
                          )
                        })
                      ) : (
                        <EmptyState title="No missed follow-ups" body="All consultants are caught up!" />
                      )}
                    </CardContent>
                  </Card>

                  <Card className={cn(PRIMARY_SURFACE, 'border-rose-100/50 shadow-md')}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-black text-slate-900 flex items-center gap-2">
                        <CarFront className="h-4 w-4 text-rose-500" /> Missed by Model
                      </CardTitle>
                      <CardDescription className="text-[11px] text-slate-400">Models with delayed follow-ups</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-2">
                      {summary.missedFollowups.byModel.length ? (
                        summary.missedFollowups.byModel.map((item) => {
                          const total = summary.missedFollowups!.count
                          const percentVal = total > 0 ? (item.value / total) * 100 : 0
                          return (
                            <ProgressMetricRow
                              key={item.name}
                              label={item.name}
                              value={formatNumber(item.value)}
                              trailing={`(${formatPercent(percentVal)})`}
                              percent={percentVal}
                              color="#c5162f"
                            />
                          )
                        })
                      ) : (
                        <EmptyState title="No missed follow-ups" body="No vehicle models have pending follow-ups." />
                      )}
                    </CardContent>
                  </Card>

                  <Card className={cn(PRIMARY_SURFACE, 'border-rose-100/50 shadow-md')}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span className="text-base">🔌</span> Missed by Lead Source
                      </CardTitle>
                      <CardDescription className="text-[11px] text-slate-400">Sources needing immediate attention</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-2">
                      {summary.missedFollowups.bySource.length ? (
                        summary.missedFollowups.bySource.map((item) => {
                          const total = summary.missedFollowups!.count
                          const percentVal = total > 0 ? (item.value / total) * 100 : 0
                          return (
                            <ProgressMetricRow
                              key={item.name}
                              label={item.name}
                              value={formatNumber(item.value)}
                              trailing={`(${formatPercent(percentVal)})`}
                              percent={percentVal}
                              color="#e11d0f"
                            />
                          )
                        })
                      ) : (
                        <EmptyState title="No missed follow-ups" body="No sources with delayed follow-ups." />
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : null}

            <div className="grid gap-5 xl:grid-cols-2">
              <ChartCard title="Enquiry Status" subtitle="Current pipeline state mix">
                {renderPieChart(summary?.overview.enquiryStatus || [])}
              </ChartCard>
              {/* Both series, from sources.items. This plotted `sourceShare` — enquiries alone — so
                  with the enquiry feed stale the chart rendered an empty axis even though 36 bookings
                  existed for the same period and the same channels. */}
              <ChartCard title="Source Share" subtitle="Enquiries and bookings by source">
                {renderBarChart({
                  data: (summary?.sources.items || []).map((row) => ({
                    name: row.source,
                    enquiries: row.enquiries,
                    bookings: row.bookings,
                  })),
                  xKey: 'name',
                  bars: [
                    { key: 'enquiries', label: 'Enquiries', color: CHART_COLORS[0] },
                    { key: 'bookings', label: 'Bookings', color: CHART_COLORS[1] },
                  ],
                })}
              </ChartCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              <ChartCard title="Dealer Summary" subtitle="Dealer-level enquiry contribution" className="xl:col-span-1">
                {renderBarChart({
                  data: summary?.overview.dealerSummary || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Enquiries', color: CHART_COLORS[1] }],
                  height: 280,
                })}
              </ChartCard>
              <ChartCard title="Lead Temperature" subtitle="Hot, warm, and cold mix" className="xl:col-span-1">
                {renderPieChart(summary?.overview.leadTemperature || [])}
              </ChartCard>
              <ChartCard title="Test Drive" subtitle="Completed vs pending momentum" className="xl:col-span-1">
                {renderBarChart({
                  data: summary?.overview.testDrive || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Count', color: CHART_COLORS[4] }],
                  height: 280,
                })}
              </ChartCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <ChartCard title="Funnel" subtitle="Enquiry to booking to retail">
                {renderBarChart({
                  data: summary?.overview.funnel || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Volume', color: CHART_COLORS[0] }],
                })}
              </ChartCard>
              <ChartCard title="Walk-In Spotlight" subtitle="Primary walk-in performance read">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/85 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Walk-In Leads</p>
                    <p className="mt-3 text-3xl font-black text-slate-950">{formatNumber(summary?.overview.walkinSpotlight.enquiries || 0)}</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/85 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Share</p>
                    <p className="mt-3 text-3xl font-black text-slate-950">{formatPercent(summary?.overview.walkinSpotlight.sharePct || 0)}</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/85 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Read</p>
                    <p className="mt-3 text-sm font-bold leading-6 text-slate-700">
                      {summary?.overview.walkinSpotlight.message || 'No walk-in read for this month yet.'}
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {(summary?.overview.sourceCards || []).map((card) => (
                    <div
                      key={card.source}
                      className={cn(
                        'flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border px-4 py-3',
                        card.highlightWalkIn ? 'border-amber-200 bg-amber-50/80' : 'border-slate-200 bg-white'
                      )}
                    >
                      <div>
                        <p className="text-sm font-black text-slate-950">{card.source}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {formatNumber(card.enquiries)} enquiries · {formatNumber(card.bookings)} bookings
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-700">
                          Share {formatPercent(card.enquirySharePct)}
                        </Badge>
                        <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">
                          Conv {formatPercent(card.conversionPct)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </div>

            <ChartCard title="Top Models" subtitle="Highest enquiry contribution this month">
              {renderBarChart({
                data: summary?.overview.topModels || [],
                xKey: 'name',
                bars: [{ key: 'value', label: 'Enquiries', color: CHART_COLORS[2] }],
                height: 340,
              })}
            </ChartCard>
          </TabsContent>

          <TabsContent value="models" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <ChartCard title="Model Ranking" subtitle="Enquiry and booking volume by model">
                {renderBarChart({
                  data: summary?.models.items || [],
                  xKey: 'model',
                  bars: [
                    { key: 'enquiries', label: 'Enquiries', color: CHART_COLORS[0] },
                    { key: 'bookings', label: 'Bookings', color: CHART_COLORS[5] },
                  ],
                })}
              </ChartCard>
              <ChartCard title="Top 5 Share" subtitle="Largest model slices this month">
                {renderPieChart(summary?.models.topFive || [])}
              </ChartCard>
            </div>

            <ChartCard
              title="Source Breakdown"
              subtitle="Model mix under a selected lead source"
              action={
                <Select value={modelSourceFilter} onValueChange={setModelSourceFilter}>
                  <SelectTrigger className="w-[220px] rounded-2xl">
                    <SelectValue placeholder="All sources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    {(summary?.models.sourceOptions || []).map((item, index) => (
                      <SelectItem key={`${item}-${index}`} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            >
              {renderBarChart({
                data: modelBreakdown,
                xKey: 'model',
                bars: [
                  { key: 'enquiries', label: 'Enquiries', color: CHART_COLORS[1] },
                  { key: 'bookings', label: 'Bookings', color: CHART_COLORS[6] },
                ],
                height: 360,
              })}
            </ChartCard>
          </TabsContent>

          <TabsContent value="sources" className="space-y-6">
            <ChartCard title="Source Volume" subtitle="Lead volume and conversion by source">
              {renderBarChart({
                data: summary?.sources.items || [],
                xKey: 'source',
                bars: [
                  { key: 'enquiries', label: 'Enquiries', color: CHART_COLORS[0] },
                  { key: 'bookings', label: 'Bookings', color: CHART_COLORS[2] },
                ],
                height: 380,
              })}
            </ChartCard>

            <ChartCard title="Walk-In Spotlight & Source Breakdown" subtitle="Lead-source focus and channel performance">
              <div className="space-y-5">
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50/80 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700">Walk-In Spotlight</p>
                      <p className="mt-2 text-4xl font-black text-amber-950">{formatNumber(summary?.sources.walkinSpotlight.enquiries || 0)}</p>
                      <p className="mt-1 text-sm font-bold text-amber-900">Share {formatPercent(summary?.sources.walkinSpotlight.sharePct || 0)}</p>
                    </div>
                    <p className="max-w-xl text-sm font-medium leading-6 text-amber-800">
                      {summary?.sources.walkinSpotlight.message || 'No current walk-in message.'}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                  {(summary?.sources.items || []).map((item, index) => (
                    <div key={`${item.source}-${index}`} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-xs">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-slate-950 truncate" title={item.source}>{item.source}</p>
                        <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-700 shrink-0">
                          {formatPercent(item.sharePct)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs font-semibold text-slate-500">
                        {formatNumber(item.enquiries)} enquiries · {formatNumber(item.bookings)} bookings
                      </p>
                      <p className="mt-2 text-sm font-black text-emerald-700">Conversion {formatPercent(item.conversionPct)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </ChartCard>
          </TabsContent>

          <TabsContent value="team" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <ChartCard title="Consultant Leaderboard" subtitle="Top consultants by enquiry and booking volume">
                {renderBarChart({
                  data: summary?.team.comparison || [],
                  xKey: 'consultant',
                  bars: [
                    { key: 'enquiries', label: 'Enquiries', color: CHART_COLORS[0] },
                    { key: 'bookings', label: 'Bookings', color: CHART_COLORS[2] },
                  ],
                  height: 360,
                })}
              </ChartCard>
              <ChartCard title="Consultant Metrics" subtitle="Walk-in conversion and TD performance">
                {(summary?.team.leaderboard || []).length ? (
                  <div className="space-y-3">
                    {(summary?.team.leaderboard || []).slice(0, 8).map((item) => (
                      <div key={item.consultant} className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-slate-950">{item.consultant}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              {formatNumber(item.enquiries)} enquiries · {formatNumber(item.bookings)} bookings
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">
                              Booking {formatPercent(item.bookingRatePct)}
                            </Badge>
                            <Badge className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-black text-sky-700">
                              TD {formatPercent(item.tdRatePct)}
                            </Badge>
                            <Badge className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-black text-amber-700">
                              Walk-in {formatPercent(item.walkinConversionPct)}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No consultant metrics" body="Consultant slices will appear when data is available." />
                )}
              </ChartCard>
            </div>

            <ChartCard
              title="Leaderboard Table"
              subtitle={`All ${formatNumber(leaderboardTotals.consultants)} consultants for ${selectedPeriodLabel} \u2014 totals tie to the Enquiries and Bookings cards`}
            >
              {(summary?.team.leaderboard || []).length ? (
                /*
                 * The height cap targets Table's OWN inner wrapper, which already carries
                 * overflow-auto. Capping this outer div instead would leave that inner div at
                 * full content height, and the sticky header and total row would resolve
                 * against it and never pin.
                 */
                <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 [&>div]:max-h-[32rem]">
                  <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                    <caption className="sr-only">
                      Consultant performance for {selectedPeriodLabel}. Nine columns: consultant, enquiries, bookings,
                      booking rate, walk-in enquiries, walk-in bookings, walk-in conversion, test drives and test
                      drive rate. The final row is the grand total across every consultant.
                    </caption>
                    <TableHeader>
                      <TableRow className="border-b border-white/10 hover:bg-transparent">
                        {['Consultant', 'Enquiries', 'Bookings', 'Booking %', 'Walk-In Enq', 'Walk-In Book', 'Walk-In %', 'TD', 'TD %'].map((label, index) => (
                          <TableHead
                            key={label}
                            scope="col"
                            className={cn(
                              'sticky top-0 z-20 bg-[var(--dashboard-action-bg)] text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-fg)]',
                              index > 0 && 'text-right',
                            )}
                          >
                            {label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(summary?.team.leaderboard || []).map((item) => (
                        <TableRow key={item.consultant} className="odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)]">
                          <TableCell className="font-black text-slate-950">{item.consultant}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(item.enquiries)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(item.bookings)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPercent(item.bookingRatePct)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(item.walkinEnquiries)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(item.walkinBookings)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPercent(item.walkinConversionPct)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(item.testDrives)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPercent(item.tdRatePct)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter className="border-t-0 bg-transparent">
                      <TableRow className="hover:bg-transparent">
                        {[
                          { key: 'label', node: 'Grand Total', lead: true },
                          { key: 'enq', node: formatNumber(leaderboardTotals.enquiries) },
                          { key: 'book', node: formatNumber(leaderboardTotals.bookings) },
                          { key: 'bookPct', node: formatPercent(leaderboardTotals.bookingRatePct) },
                          { key: 'wEnq', node: formatNumber(leaderboardTotals.walkinEnquiries) },
                          { key: 'wBook', node: formatNumber(leaderboardTotals.walkinBookings) },
                          { key: 'wPct', node: formatPercent(leaderboardTotals.walkinConversionPct) },
                          { key: 'td', node: formatNumber(leaderboardTotals.testDrives) },
                          { key: 'tdPct', node: formatPercent(leaderboardTotals.tdRatePct) },
                        ].map((cell) => (
                          <TableCell
                            key={cell.key}
                            style={{ backgroundColor: '#0f172a' }}
                            className={cn(
                              'sticky bottom-0 z-20 text-[13px] font-black tabular-nums',
                              cell.lead ? 'text-left text-white' : 'text-right text-amber-300',
                            )}
                          >
                            {cell.node}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No consultant rows" body="Consultant leaderboard data is not available for this period." />
              )}
            </ChartCard>
          </TabsContent>

          <TabsContent value="trend" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <ChartCard title="Daily Enquiry Trend" subtitle="Day-by-day enquiry build for the selected period">
                {renderAreaChart(summary?.trend.daily || [], 'day', 'enquiries', CHART_COLORS[0])}
              </ChartCard>
              <ChartCard title="Trend Read" subtitle="Auto-generated period note">
                <div className="rounded-[1.5rem] border border-[var(--dashboard-primary-border)] bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_48%,white)] p-5">
                  <p className="text-base font-black leading-7 text-slate-950">{summary?.trend.trendNote || 'No trend note available.'}</p>
                </div>
                <div className="mt-4 grid gap-3">
                  {(summary?.trend.weeks || []).map((item) => (
                    <div key={item.week} className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-slate-950">{item.week}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{item.dates}</p>
                        </div>
                        <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-700">
                          Peak {item.peak}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Total</p>
                          <p className="mt-2 text-2xl font-black text-slate-950">{formatNumber(item.total)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Avg / Day</p>
                          <p className="mt-2 text-2xl font-black text-slate-950">{item.avg.toFixed(1)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </div>
          </TabsContent>

          <TabsContent value="lost" className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className={PRIMARY_SURFACE}>
                <CardContent className="p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Lost Enquiries</p>
                  <p className="mt-3 text-3xl font-black text-slate-950">{formatNumber(summary?.lost.totalLost || 0)}</p>
                </CardContent>
              </Card>
              <Card className={PRIMARY_SURFACE}>
                <CardContent className="p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Lost Rate</p>
                  <p className="mt-3 text-3xl font-black text-slate-950">{formatPercent(summary?.lost.lostRatePct || 0)}</p>
                </CardContent>
              </Card>
              <Card className={PRIMARY_SURFACE}>
                <CardContent className="p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">MoM Change</p>
                  <p className="mt-3 text-3xl font-black text-slate-950">
                    {summary?.lost.lostRateChangePct === null || summary?.lost.lostRateChangePct === undefined
                      ? 'NA'
                      : `${summary.lost.lostRateChangePct.toFixed(1)}%`}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <ChartCard title="Lost By Reason" subtitle="Primary lost reasons this period">
                {renderBarChart({
                  data: summary?.lost.reasons || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Cases', color: CHART_COLORS[7] }],
                })}
              </ChartCard>
              <ChartCard title="Lost By Consultant" subtitle="Consultants most impacted by lost leads">
                {renderBarChart({
                  data: summary?.lost.consultants || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Cases', color: CHART_COLORS[5] }],
                })}
              </ChartCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <ChartCard title="Lost By Model" subtitle="Model-level loss concentration">
                {renderBarChart({
                  data: summary?.lost.models || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Cases', color: CHART_COLORS[3] }],
                })}
              </ChartCard>
              <ChartCard
                title="Lost By Source"
                subtitle="Lead source quality signal"
                action={
                  <Button type="button" className="app-outline-action rounded-2xl px-4" onClick={() => setLostDialogOpen(true)}>
                    <Search className="h-4 w-4" />
                    View cases
                  </Button>
                }
              >
                {renderBarChart({
                  data: summary?.lost.sources || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Cases', color: CHART_COLORS[6] }],
                })}
              </ChartCard>
            </div>
          </TabsContent>

          <TabsContent value="review" className="space-y-5">
            <PlatinumRetailReviewPanel />
          </TabsContent>

          <TabsContent value="retail" className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(summary?.retail.kpis || []).map((item) => (
                <Card key={item.label} className={PRIMARY_SURFACE}>
                  <CardContent className="p-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                    <p className="mt-3 text-3xl font-black text-slate-950">{item.formattedValue}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <ChartCard title="Finance Mix" subtitle="Retail finance mode split">
                {renderPieChart((summary?.retail.financeSummary || []).map((item) => ({ name: item.name, value: item.units })))}
              </ChartCard>
              <ChartCard title="Accessories" subtitle="Cross-sell and revenue summary">
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { label: 'Revenue', value: formatCompactCurrency(summary?.retail.accessories.totalRevenue || 0), icon: CircleDollarSign },
                    { label: 'Items', value: formatNumber(summary?.retail.accessories.totalItems || 0), icon: Activity },
                    { label: 'Acc / Car', value: formatCurrency(summary?.retail.accessories.avgPerCar || 0), icon: CarFront },
                    { label: 'Cross-Sell', value: formatPercent(summary?.retail.accessories.crossSellRatePct || 0), icon: Target },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
                        <item.icon className="h-4 w-4 text-[var(--dashboard-action-bg)]" />
                      </div>
                      <p className="mt-3 text-2xl font-black text-slate-950">{item.value}</p>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <ChartCard title="Finance By Model" subtitle="Mode split at model level">
                {renderBarChart({
                  data: summary?.retail.financeByModel || [],
                  xKey: 'model',
                  bars: [
                    { key: 'Cash', label: 'Cash', color: CHART_COLORS[0] },
                    { key: 'In-house', label: 'In-house', color: CHART_COLORS[4] },
                    { key: 'Self-Finance', label: 'Self-Finance', color: CHART_COLORS[5] },
                  ],
                  stacked: true,
                  height: 360,
                })}
              </ChartCard>
              <ChartCard title="Finance By Consultant" subtitle="Consultant finance composition">
                {renderBarChart({
                  data: summary?.retail.financeByConsultant || [],
                  xKey: 'consultant',
                  bars: [
                    { key: 'Cash', label: 'Cash', color: CHART_COLORS[0] },
                    { key: 'In-house', label: 'In-house', color: CHART_COLORS[4] },
                    { key: 'Self-Finance', label: 'Self-Finance', color: CHART_COLORS[5] },
                  ],
                  stacked: true,
                  height: 360,
                })}
              </ChartCard>
            </div>

            <ChartCard title="Retail Model Cards" subtitle="Revenue and mix per model">
              {(summary?.retail.modelCards || []).length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {(summary?.retail.modelCards || []).map((item) => (
                    <div key={item.model} className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-lg font-black text-slate-950">{item.model}</p>
                          <p className="mt-1 text-sm font-medium text-slate-500">
                            {formatNumber(item.units)} retails · Avg price {formatCompactCurrency(item.avgPrice)}
                          </p>
                        </div>
                        <Badge className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-black text-sky-700">
                          Revenue {formatCompactCurrency(item.revenue)}
                        </Badge>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Avg Delivery</p>
                          <p className="mt-2 text-xl font-black text-slate-950">
                            {item.avgDeliveryDays === null ? 'NA' : `${item.avgDeliveryDays.toFixed(1)}d`}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Top Variant</p>
                          <p className="mt-2 text-xl font-black text-slate-950">{item.variants[0]?.name || 'NA'}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Top Color</p>
                          <p className="mt-2 text-xl font-black text-slate-950">{item.colors[0]?.name || 'NA'}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No retail models" body="Retail model cards will appear when retail rows are available for the selected period." />
              )}
            </ChartCard>

            <ChartCard title="Retail Transactions" subtitle="Searchable transaction detail">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full sm:w-72 lg:w-80">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={retailSearch}
                    onChange={(event) => setRetailSearch(event.target.value)}
                    placeholder="Search customer, VIN, consultant..."
                    className="h-9 w-full rounded-full border-[#d5dfea] pl-10 text-[13px]"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-start lg:justify-end gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500 hidden sm:inline">Sort:</span>
                    <Select
                      value={`${retailSortField}-${retailSortDirection}`}
                      onValueChange={(val) => {
                        const [field, dir] = val.split('-') as [string, 'asc' | 'desc']
                        setRetailSortField(field)
                        setRetailSortDirection(dir)
                      }}
                    >
                      <SelectTrigger className="h-9 rounded-full border-[#d5dfea] bg-white px-3 text-xs font-black text-slate-700 shadow-sm hover:border-slate-300 min-w-[170px]">
                        <ArrowDownUp className="h-3.5 w-3.5 text-slate-400 mr-1.5" />
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent className="rounded-2xl border-slate-200">
                        <SelectItem value="deliveryDate-desc" className="text-xs font-bold">
                          Delivery Date: Newest First
                        </SelectItem>
                        <SelectItem value="deliveryDate-asc" className="text-xs font-bold">
                          Delivery Date: Oldest First
                        </SelectItem>
                        <SelectItem value="invoiceDate-desc" className="text-xs font-bold">
                          Invoice Date: Newest First
                        </SelectItem>
                        <SelectItem value="exShowroomPrice-desc" className="text-xs font-bold">
                          Ex-Showroom: High → Low
                        </SelectItem>
                        <SelectItem value="customerName-asc" className="text-xs font-bold">
                          Customer: A → Z
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-600 whitespace-nowrap">
                    {formatNumber(filteredRetailRows.length)} transactions
                  </div>
                </div>
              </div>

              {filteredRetailRows.length ? (
                <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
                  <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow className="border-b-2 border-[#071a2b] bg-[#071a2b] hover:bg-[#071a2b] select-none text-white">
                        {[
                          { key: 'customerName', label: 'Customer' },
                          { key: 'model', label: 'Model' },
                          { key: 'consultant', label: 'Consultant' },
                          { key: 'financeType', label: 'Finance' },
                          { key: 'financier', label: 'Financier' },
                          { key: 'exShowroomPrice', label: 'Revenue' },
                          { key: 'invoiceDate', label: 'Invoice' },
                          { key: 'deliveryDate', label: 'Delivery' },
                        ].map((col) => {
                          const isActive = retailSortField === col.key
                          return (
                            <TableHead key={col.key} className="text-[10px] font-black text-white p-0">
                              <button
                                type="button"
                                onClick={() => handleRetailSort(col.key)}
                                className={cn(
                                  'w-full h-full px-3 py-3 flex items-center gap-1 transition-colors text-left font-black cursor-pointer',
                                  isActive ? 'text-white bg-white/20 shadow-inner' : 'text-white/90 hover:text-white hover:bg-white/10'
                                )}
                                title={`Sort by ${col.label}`}
                              >
                                <span>{col.label}</span>
                                {isActive ? (
                                  retailSortDirection === 'desc' ? (
                                    <ArrowDown className="h-3.5 w-3.5 text-white stroke-[2.5]" />
                                  ) : (
                                    <ArrowUp className="h-3.5 w-3.5 text-white stroke-[2.5]" />
                                  )
                                ) : (
                                  <ArrowDownUp className="h-3 w-3 text-white/40 opacity-60" />
                                )}
                              </button>
                            </TableHead>
                          )
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRetailRows.slice(0, 50).map((row) => (
                        <TableRow
                          key={row.rowKey}
                          className="odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)] hover:bg-blue-50/20 transition-colors"
                        >
                          <TableCell className="font-black text-slate-950 px-3 py-2.5">{row.customerName}</TableCell>
                          <TableCell className="px-3 py-2.5">
                            {row.model} {row.variant ? `· ${row.variant}` : ''}
                          </TableCell>
                          <TableCell className="px-3 py-2.5">{row.consultant}</TableCell>
                          <TableCell className="px-3 py-2.5">{row.financeType}</TableCell>
                          <TableCell className="px-3 py-2.5">{row.financier || 'NA'}</TableCell>
                          <TableCell className="px-3 py-2.5 font-bold text-slate-800">{formatCurrency(row.exShowroomPrice)}</TableCell>
                          <TableCell className="px-3 py-2.5">{formatDate(row.invoiceDate)}</TableCell>
                          <TableCell className="px-3 py-2.5">{formatDate(row.deliveryDate)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No matching retail rows" body="Try a different date range or clear the retail search to see transactions." />
              )}
            </ChartCard>

            <div className="grid gap-5 xl:grid-cols-2">
              <ChartCard title="Financiers" subtitle="Top finance partners by retail count">
                {(summary?.retail.financiers || []).length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(summary?.retail.financiers || []).map((item, index) => (
                      <div
                        key={`${item.financier}-${index}`}
                        className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white px-4 py-3 shadow-xs hover:border-slate-300 transition-colors"
                      >
                        <span className="text-xs font-black text-slate-950 truncate pr-2" title={item.financier}>
                          {item.financier}
                        </span>
                        <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-700">
                          {formatNumber(item.count)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No financier mix" body="Financier rows will appear when retail finance data is available." />
                )}
              </ChartCard>

              <ChartCard title="Finance Mode Mix" subtitle="Cash vs In-house vs Self-Finance distribution">
                {(summary?.retail.financeSummary || []).length ? (
                  <div className="space-y-4 pt-2">
                    {(summary?.retail.financeSummary || []).map((item, index) => (
                      <ProgressMetricRow
                        key={item.name}
                        label={item.name}
                        value={formatNumber(item.units)}
                        trailing={`${formatPercent(item.sharePct)} (${formatNumber(item.units)} units)`}
                        percent={item.sharePct}
                        color={index === 0 ? '#18a7d0' : index === 1 ? '#8835a7' : '#269442'}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No finance mode data" body="Finance mode distribution will appear when retail rows are available." />
                )}
              </ChartCard>
            </div>
          </TabsContent>

          <TabsContent value="reports" className="space-y-5">
            <Tabs
              value={activeReport}
              onValueChange={(value) => {
                setActiveReport(value as ReportKey)
                setReportPage(1)
                setReportSort('')
                setReportDirection('desc')
              }}
              className="space-y-4"
            >
              <TabsList className="flex h-auto flex-wrap justify-start gap-2 rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white/80 p-2 shadow-sm">
                {REPORT_TABS.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key} className={getTabTriggerClass(activeReport === tab.key)}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <ChartCard
              title={REPORT_TABS.find((item) => item.key === activeReport)?.label || 'Report'}
              subtitle="Server-side search, sorting, pagination, and CSV export"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className="app-outline-action rounded-2xl px-4" onClick={resetReportFilters}>
                    <Filter className="h-4 w-4" />
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="app-outline-action rounded-2xl px-4"
                    onClick={() => {
                      setExpandedReportColumns((current) => ({ ...current, [activeReport]: !current[activeReport] }))
                    }}
                  >
                    {expandedReportColumns[activeReport] ? 'Default columns' : 'Show all columns'}
                  </Button>
                  <Button
                    type="button"
                    className="app-primary-action rounded-2xl px-4"
                    onClick={() => {
                      void handleCsvExport()
                    }}
                    disabled={reportQuery.isFetching}
                  >
                    <Download className="h-4 w-4" />
                    Export CSV
                  </Button>
                </div>
              }
            >
              <div className="grid gap-3 xl:grid-cols-5">
                <div className="relative xl:col-span-2">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={reportSearch}
                    onChange={(event) => {
                      setReportSearch(event.target.value)
                      setReportPage(1)
                    }}
                    placeholder="Search current report..."
                    className="rounded-2xl pl-10"
                  />
                </div>
                <Select
                  value={reportSource}
                  onValueChange={(value) => {
                    setReportSource(value)
                    setReportPage(1)
                  }}
                >
                  <SelectTrigger className="rounded-2xl">
                    <SelectValue placeholder={REPORT_SOURCE_COLUMN_LABEL[activeReport]} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All {REPORT_SOURCE_COLUMN_LABEL[activeReport]}</SelectItem>
                    {metricOptions.source.map((item, index) => (
                      <SelectItem key={`${item}-${index}`} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={reportModel}
                  onValueChange={(value) => {
                    setReportModel(value)
                    setReportPage(1)
                  }}
                >
                  <SelectTrigger className="rounded-2xl">
                    <SelectValue placeholder="Model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All models</SelectItem>
                    {metricOptions.model.map((item, index) => (
                      <SelectItem key={`${item}-${index}`} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={reportConsultant}
                  onValueChange={(value) => {
                    setReportConsultant(value)
                    setReportPage(1)
                  }}
                >
                  <SelectTrigger className="rounded-2xl">
                    <SelectValue placeholder={REPORT_CONSULTANT_LABEL[activeReport]} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All {REPORT_CONSULTANT_LABEL[activeReport]}</SelectItem>
                    {metricOptions.consultant.map((item, index) => (
                      <SelectItem key={`${item}-${index}`} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-700">
                    {(reportQuery.data?.pagination.totalRows || 0).toLocaleString('en-IN')} rows
                  </Badge>
                  <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-700">
                    {visibleColumns.length} columns visible
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Page Size</span>
                  <Select
                    value={String(reportPageSize)}
                    onValueChange={(value) => {
                      setReportPageSize(Number(value))
                      setReportPage(1)
                    }}
                  >
                    <SelectTrigger className="w-24 rounded-2xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[25, 50, 100].map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {reportQuery.isLoading ? (
                <div className="flex h-72 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-action-bg)]" />
                </div>
              ) : reportQuery.error ? (
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">
                  {reportQuery.error instanceof Error ? reportQuery.error.message : 'Unable to load report'}
                </div>
              ) : reportQuery.data ? (
                <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-slate-200">
                  <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow className="border-b border-white/10 bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-bg)]">
                        {visibleColumns.map((column) => (
                          <TableHead key={column} className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-fg)]">
                            <button type="button" className="inline-flex items-center gap-1 text-left" onClick={() => handleReportColumnSort(column)}>
                              <span>{toColumnLabel(column)}</span>
                              <ArrowDownUp className="h-3.5 w-3.5" />
                            </button>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportQuery.data.rows.map((row, rowIndex) => (
                        <TableRow
                          key={`${activeReport}-${rowIndex}`}
                          className="odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)]"
                        >
                          {visibleColumns.map((column) => (
                            <TableCell
                              key={`${rowIndex}-${column}`}
                              className="max-w-[240px] truncate text-[13px] font-medium text-slate-700"
                              title={String(row[column] ?? '')}
                            >
                              {formatCellValue(column, row[column])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No report data" body="This report did not return rows for the selected filters." />
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-500">
                  Page {reportQuery.data?.pagination.page || 1} of {reportQuery.data?.pagination.totalPages || 1}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="app-outline-action rounded-2xl px-4"
                    disabled={(reportQuery.data?.pagination.page || 1) <= 1}
                    onClick={() => setReportPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="app-outline-action rounded-2xl px-4"
                    disabled={(reportQuery.data?.pagination.page || 1) >= (reportQuery.data?.pagination.totalPages || 1)}
                    onClick={() => setReportPage((current) => current + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </ChartCard>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={lostDialogOpen} onOpenChange={setLostDialogOpen}>
        <DialogContent className="max-w-[96vw] w-[96vw] md:max-w-[96vw] rounded-[2rem] border border-slate-200 p-0">
          <DialogHeader className="rounded-t-[2rem] border-b border-white/10 bg-[var(--dashboard-action-bg)] px-6 py-5 text-[var(--dashboard-action-fg)]">
            <DialogTitle className="text-2xl font-black">Lost Cases</DialogTitle>
            <DialogDescription className="text-white/75">
              Search lost enquiries by customer, model, source, consultant, or reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={lostSearch}
                onChange={(event) => setLostSearch(event.target.value)}
                placeholder="Search lost rows..."
                className="rounded-2xl pl-10"
              />
            </div>

            {filteredLostRows.length ? (
              <div className="max-h-[70vh] overflow-auto rounded-[1.5rem] border border-slate-200">
                <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                  <TableHeader>
                    <TableRow className="sticky top-0 border-b border-white/10 bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-bg)]">
                      {['Enquiry Date', 'Customer', 'Phone', 'Model', 'Source', 'Consultant', 'Status', 'Reason', 'Lost Due To', 'Remark'].map((label) => (
                        <TableHead key={label} className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-fg)]">
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLostRows.map((row, index) => (
                      <TableRow key={`${row.customer}-${row.phone}-${index}`} className="odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)]">
                        <TableCell>{row.enquiryDate || 'NA'}</TableCell>
                        <TableCell className="font-black text-slate-950">{row.customer}</TableCell>
                        <TableCell>{row.phone || 'NA'}</TableCell>
                        <TableCell>{row.model || 'NA'}</TableCell>
                        <TableCell>{row.source || 'NA'}</TableCell>
                        <TableCell>{row.consultant || 'NA'}</TableCell>
                        <TableCell>{row.status || 'NA'}</TableCell>
                        <TableCell>{row.lostReason || 'NA'}</TableCell>
                        <TableCell>{row.lostDueTo || 'NA'}</TableCell>
                        <TableCell className="max-w-[320px] whitespace-normal text-[13px]">{row.lostRemark || 'NA'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState title="No lost rows found" body="Try another search term or a different date range." />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
