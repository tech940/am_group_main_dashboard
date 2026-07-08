'use client'

import type { ComponentProps, ReactNode } from 'react'
import { startTransition, useDeferredValue, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowDownUp,
  BarChart3,
  CarFront,
  CircleDollarSign,
  Download,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  XCircle,
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
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { logApiTimings } from '@/lib/api/client-timing'
import type {
  ReportKey,
  SalesReportFreshnessPayload,
  SalesReportListPayload,
  SalesReportMetricPoint,
  SalesReportSummaryPayload,
} from '@/lib/kia/sales-report-types'
import { cn } from '@/lib/utils'

type SearchParamsInput = Record<string, string | string[] | undefined>
type PageTab = 'overview' | 'models' | 'sources' | 'team' | 'trend' | 'lost' | 'retail' | 'reports'

const PAGE_TABS: Array<{ key: PageTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'models', label: 'Models' },
  { key: 'sources', label: 'Sources' },
  { key: 'team', label: 'Team' },
  { key: 'trend', label: 'Trend' },
  { key: 'lost', label: 'Lost' },
  { key: 'retail', label: 'Retail' },
  { key: 'reports', label: 'Reports' },
]

const REPORT_TABS: Array<{ key: ReportKey; label: string }> = [
  { key: 'enquiry', label: 'Enquiry Report' },
  { key: 'booking', label: 'Booking Report' },
  { key: 'sales', label: 'Sales Report' },
  { key: 'accessories', label: 'Accessories Report' },
]

const REPORT_SOURCE_COLUMN_LABEL: Record<ReportKey, string> = {
  enquiry: 'Source',
  booking: 'Main Source',
  sales: 'Source',
  accessories: 'Bill Status',
}

const REPORT_CONSULTANT_LABEL: Record<ReportKey, string> = {
  enquiry: 'Consultant',
  booking: 'Consultant',
  sales: 'Consultant',
  accessories: 'Customer',
}

const CHART_COLORS = [
  '#0f172a',
  '#2563eb',
  '#0f766e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#0891b2',
  '#22c55e',
]

const PRIMARY_SURFACE =
  'rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white/88 shadow-xl shadow-slate-900/5 backdrop-blur-xl'

const HERO_SURFACE =
  'rounded-[2.25rem] border border-slate-200/85 bg-[radial-gradient(circle_at_12%_18%,rgba(191,219,254,0.18),transparent_26%),radial-gradient(circle_at_88%_12%,rgba(220,252,231,0.14),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.97)_52%,rgba(241,245,249,0.94)_100%)] shadow-[0_30px_80px_-48px_rgba(15,23,42,0.22)] backdrop-blur-xl'

const KPI_CARD_STYLES = [
  'border-sky-200 bg-[linear-gradient(180deg,#eff6ff_0%,#ffffff_68%)]',
  'border-indigo-200 bg-[linear-gradient(180deg,#eef2ff_0%,#ffffff_68%)]',
  'border-emerald-200 bg-[linear-gradient(180deg,#ecfdf5_0%,#ffffff_68%)]',
  'border-amber-200 bg-[linear-gradient(180deg,#fffbeb_0%,#ffffff_68%)]',
  'border-rose-200 bg-[linear-gradient(180deg,#fff1f2_0%,#ffffff_68%)]',
  'border-cyan-200 bg-[linear-gradient(180deg,#ecfeff_0%,#ffffff_68%)]',
  'border-violet-200 bg-[linear-gradient(180deg,#f5f3ff_0%,#ffffff_68%)]',
  'border-orange-200 bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_68%)]',
] as const

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
  accessories: false,
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'NA'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'NA'
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || `Request failed for ${label}`)
  }
  return await response.json() as T
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

function KpiCard({
  item,
  index,
}: {
  item: SalesReportSummaryPayload['overview']['kpis'][number]
  index: number
}) {
  const isPositive = item.changePct !== null && item.changePct >= 0
  const tone = item.changePct === null
    ? 'border-slate-200 bg-white/88 text-slate-500'
    : isPositive
      ? 'border-emerald-200 bg-emerald-50/75 text-emerald-700'
      : 'border-rose-200 bg-rose-50/75 text-rose-700'

  return (
    <Card className={cn(PRIMARY_SURFACE, KPI_CARD_STYLES[index % KPI_CARD_STYLES.length])}>
      <CardContent className="p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-black tracking-tight text-slate-950">{item.formattedValue}</p>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{item.comparisonLabel}</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">{item.formattedComparisonValue}</p>
          </div>
          <span className={cn('rounded-full border px-3 py-1 text-[11px] font-black', tone)}>
            {item.changePct === null ? 'NA' : item.changeLabel}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function SourceCoverageBadge({
  label,
  sourceUpdatedAt,
  rowCount,
  index,
}: {
  label: string
  sourceUpdatedAt: string | null
  rowCount: number
  index: number
}) {
  const styles = [
    'border-sky-200/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.96)_0%,rgba(255,255,255,0.96)_100%)] text-sky-950',
    'border-indigo-200/80 bg-[linear-gradient(135deg,rgba(238,242,255,0.96)_0%,rgba(255,255,255,0.96)_100%)] text-indigo-950',
    'border-emerald-200/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.96)_0%,rgba(255,255,255,0.96)_100%)] text-emerald-950',
    'border-amber-200/80 bg-[linear-gradient(135deg,rgba(255,251,235,0.96)_0%,rgba(255,255,255,0.96)_100%)] text-amber-950',
  ]

  return (
    <div className={cn('rounded-[1.65rem] border p-4 shadow-sm transition-all hover:shadow-md hover:scale-[1.01]', styles[index % styles.length])}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-2 text-xl font-black">{formatNumber(rowCount)} rows</p>
      <p className="mt-1 text-[11px] font-semibold opacity-80">Updated {formatDateTime(sourceUpdatedAt)}</p>
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
              {data.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value) => valueFormatter ? valueFormatter(Number(value)) : formatNumber(Number(value))} />
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
            <linearGradient id="kiaSalesArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.26)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: '#64748b', fontSize: 11 }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
          <Tooltip formatter={(value) => formatNumber(Number(value))} />
          <Area type="monotone" dataKey={yKey} stroke={color} fill="url(#kiaSalesArea)" strokeWidth={3} />
        </AreaChart>
      </ResponsiveContainer>
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

export function KiaSalesReportPage({ initialSearchParams }: { initialSearchParams: SearchParamsInput }) {
  const router = useRouter()
  const pathname = usePathname()

  const [activeTab, setActiveTab] = useState<PageTab>((() => {
    const raw = readSingleParam(initialSearchParams.tab)
    return PAGE_TABS.some((tab) => tab.key === raw) ? raw as PageTab : 'overview'
  })())
  const [activeReport, setActiveReport] = useState<ReportKey>((() => {
    const raw = readSingleParam(initialSearchParams.report)
    return REPORT_TABS.some((tab) => tab.key === raw) ? raw as ReportKey : 'enquiry'
  })())
  const [selectedYear, setSelectedYear] = useState<number | null>((() => {
    const raw = Number(readSingleParam(initialSearchParams.year))
    return Number.isFinite(raw) ? raw : null
  })())
  const [selectedMonth, setSelectedMonth] = useState<number | null>((() => {
    const raw = Number(readSingleParam(initialSearchParams.month))
    return Number.isFinite(raw) ? Math.max(0, raw - 1) : null
  })())
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
  const [lostDialogOpen, setLostDialogOpen] = useState(false)
  const [lostSearch, setLostSearch] = useState('')
  const [retailSearch, setRetailSearch] = useState('')
  const [expandedReportColumns, setExpandedReportColumns] = useState(REPORT_EXPANDED_DEFAULTS)

  const deferredReportSearch = useDeferredValue(reportSearch)
  const deferredLostSearch = useDeferredValue(lostSearch)
  const deferredRetailSearch = useDeferredValue(retailSearch)

  const freshnessQuery = useQuery({
    queryKey: ['kia-sales-report-freshness', selectedDealerCode || 'all'],
    queryFn: () => fetchReportJson<SalesReportFreshnessPayload>(`/api/brands/kia/sales-report/freshness?${buildQueryString({
      dealer_code: selectedDealerCode,
    })}`, 'kia-sales-report-freshness', 25000),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const effectiveSelectedMonthOption = freshnessQuery.data?.availableMonths.find(
    (item) => item.year === selectedYear && item.month === selectedMonth
  ) || freshnessQuery.data?.availableMonths[0]
  const effectiveSelectedYear = effectiveSelectedMonthOption?.year ?? selectedYear
  const effectiveSelectedMonth = effectiveSelectedMonthOption?.month ?? selectedMonth
  
  const summaryQuery = useQuery({
    queryKey: ['kia-sales-report-summary', effectiveSelectedYear, effectiveSelectedMonth, selectedDealerCode || 'all'],
    enabled: effectiveSelectedYear !== null && effectiveSelectedMonth !== null,
    queryFn: () => fetchReportJson<SalesReportSummaryPayload>(`/api/brands/kia/sales-report/summary?${buildQueryString({
      year: effectiveSelectedYear,
      month: effectiveSelectedMonth !== null ? effectiveSelectedMonth + 1 : null,
      dealer_code: selectedDealerCode,
    })}`, 'kia-sales-report-summary', 25000),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  })

  const reportQuery = useQuery({
    queryKey: [
      'kia-sales-report-report',
      activeReport,
      effectiveSelectedYear,
      effectiveSelectedMonth,
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
    enabled: effectiveSelectedYear !== null && effectiveSelectedMonth !== null && activeTab === 'reports' && summaryQuery.isSuccess,
    queryFn: () => fetchReportJson<SalesReportListPayload>(`/api/brands/kia/sales-report/reports?${buildQueryString({
      report: activeReport,
      year: effectiveSelectedYear,
      month: effectiveSelectedMonth !== null ? effectiveSelectedMonth + 1 : null,
      dealer_code: selectedDealerCode,
      source: reportSource,
      model: reportModel,
      consultant: reportConsultant,
      search: deferredReportSearch,
      sort: reportSort,
      direction: reportDirection,
      page: reportPage,
      pageSize: reportPageSize,
    })}`, 'kia-sales-report-reports', 25000),
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
    if (activeReport !== 'enquiry') params.set('report', activeReport)
    if (effectiveSelectedYear !== null) params.set('year', String(effectiveSelectedYear))
    if (effectiveSelectedMonth !== null) params.set('month', String(effectiveSelectedMonth + 1))
    if (selectedDealerCode) params.set('dealer_code', selectedDealerCode)

    startTransition(() => {
      router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false })
    })
  }, [activeReport, activeTab, effectiveSelectedMonth, effectiveSelectedYear, pathname, router, selectedDealerCode])

  const freshness = freshnessQuery.data
  const summary = summaryQuery.data
  const selectedMonthOption = effectiveSelectedMonthOption
  const metricOptions = getMetricOptions(summary)
  const visibleColumns = reportQuery.data
    ? (expandedReportColumns[activeReport] ? reportQuery.data.columns : reportQuery.data.defaultVisibleColumns)
    : []
  const modelBreakdown = modelSourceFilter === 'all'
    ? summary?.models.items.map((item) => ({ model: item.model, enquiries: item.enquiries, bookings: item.bookings })) || []
    : summary?.models.sourceBreakdown[modelSourceFilter] || []
  const filteredLostRows = summary?.lost.rows.filter((row) => {
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
  const filteredRetailRows = summary?.retail.transactions.filter((row) => {
    const needle = deferredRetailSearch.trim().toLowerCase()
    if (!needle) return true
    return [
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
  }) || []

  async function handleCsvExport() {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    const response = await fetch(`/api/brands/kia/sales-report/reports?${buildQueryString({
      report: activeReport,
      year: effectiveSelectedYear,
      month: effectiveSelectedMonth !== null ? effectiveSelectedMonth + 1 : null,
      dealer_code: selectedDealerCode,
      source: reportSource,
      model: reportModel,
      consultant: reportConsultant,
      search: deferredReportSearch,
      sort: reportSort,
      direction: reportDirection,
      format: 'csv',
    })}`, { cache: 'no-store', signal: controller.signal }).finally(() => window.clearTimeout(timeout))
    logApiTimings(response, 'kia-sales-report-export')
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || 'Unable to export report')
    }
    const content = await response.text()
    const disposition = response.headers.get('content-disposition') || ''
    const fileNameMatch = disposition.match(/filename="([^"]+)"/i)
    downloadBlob(content, fileNameMatch?.[1] || `kia-${activeReport}.csv`, 'text/csv;charset=utf-8')
  }

  function handleMonthChange(key: string) {
    const month = freshness?.availableMonths.find((item) => item.key === key)
    if (!month) return
    setSelectedYear(month.year)
    setSelectedMonth(month.month)
    setReportPage(1)
  }

  function handleReportColumnSort(column: string) {
    if (reportSort === column) {
      setReportDirection((current) => current === 'asc' ? 'desc' : 'asc')
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

  const summaryMonthReady = effectiveSelectedYear !== null && effectiveSelectedMonth !== null
  const headerLoading = freshnessQuery.isLoading || (summaryMonthReady && summaryQuery.isLoading && !summary)
  const pageError = freshnessQuery.error || summaryQuery.error

  return (
    <MainLayout title="Sales Report" subtitle="AM Kia sales analytics workspace">
      <div className="space-y-6 pb-4">
        {/* Unified White Card Header Container */}
        <Card className={cn(HERO_SURFACE, 'p-6')}>
          {/* Clean, Professional Header Row */}
          <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200/85 bg-[linear-gradient(135deg,rgba(239,246,255,0.96)_0%,rgba(255,255,255,0.98)_100%)] px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-sky-700">
                <TrendingUp className="h-3.5 w-3.5" />
                AM Kia Sales
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Sales Report</h1>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                Unified enquiry, booking, retail, and accessories analytics with live month coverage.
              </p>
            </div>

            {/* Controls (Quiet premium surface inside section shell) */}
            <div className="flex flex-wrap items-center gap-3 rounded-[1.6rem] border border-white/85 bg-[linear-gradient(135deg,rgba(255,255,255,0.92)_0%,rgba(248,250,252,0.9)_100%)] p-2.5 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.18)]">
              <div className="min-w-[160px] max-w-[200px]">
                <p className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Month</p>
                <Select value={selectedMonthOption?.key || ''} onValueChange={handleMonthChange}>
                  <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 bg-white/96 text-xs font-semibold text-slate-800 shadow-sm focus:ring-sky-500 [&>span]:truncate">
                    <SelectValue placeholder="Select month" />
                  </SelectTrigger>
                  <SelectContent>
                    {(freshness?.availableMonths || []).map((month) => (
                      <SelectItem key={month.key} value={month.key}>{month.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[140px]">
                <p className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Dealer</p>
                <Select value={selectedDealerCode || 'all'} onValueChange={(value) => {
                  setSelectedDealerCode(value === 'all' ? null : value)
                  setReportPage(1)
                }}>
                  <SelectTrigger className="h-9 rounded-xl border-slate-200 bg-white/96 text-xs font-semibold text-slate-800 shadow-sm focus:ring-sky-500">
                    <SelectValue placeholder="All dealers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All dealers</SelectItem>
                    {(freshness?.dealerOptions || []).map((dealerCode) => (
                      <SelectItem key={dealerCode} value={dealerCode}>{dealerCode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col justify-end pt-4">
                <Button type="button" className="h-9 rounded-xl border border-[color-mix(in_srgb,var(--dashboard-action-bg)_55%,transparent)] bg-[var(--dashboard-action-bg)] px-4 text-xs font-black text-[var(--dashboard-action-fg)] shadow-sm hover:bg-[var(--dashboard-action-hover)]" onClick={() => {
                  void freshnessQuery.refetch()
                  void summaryQuery.refetch()
                  if (activeTab === 'reports') void reportQuery.refetch()
                }} disabled={headerLoading}>
                  {headerLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {/* Clean Source Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-5">
            {(freshness?.sources || []).map((source, index) => (
              <SourceCoverageBadge
                key={source.key}
                label={source.label}
                sourceUpdatedAt={source.sourceUpdatedAt}
                rowCount={source.rowCount}
                index={index}
              />
            ))}
          </div>

          {/* Collapsible Assumptions / Explanations Banner */}
          {(summary?.assumptions || []).length ? (
            <div className="mt-5 rounded-[1.75rem] border border-white/85 bg-[linear-gradient(135deg,rgba(255,255,255,0.78)_0%,rgba(248,250,252,0.78)_100%)] p-4 transition-all hover:border-slate-200 hover:bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(248,250,252,0.88)_100%)]">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-black uppercase tracking-[0.16em] text-slate-600 select-none">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-600">i</span>
                    About these metrics & assumptions
                  </div>
                  <span className="transition group-open:rotate-180">
                    <svg fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="24" className="h-4 w-4 text-slate-500"><path d="M6 9l6 6 6-6"></path></svg>
                  </span>
                </summary>
                <div className="mt-3 grid gap-2.5 border-t border-slate-200/70 pt-3 text-xs text-slate-700">
                  {summary?.assumptions.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                      <p className="font-semibold leading-relaxed">{item}</p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ) : null}
        </Card>

        {pageError ? (
          <div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-6 text-rose-700">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="text-lg font-black">Unable to load KIA Sales Report</p>
                <p className="mt-1 text-sm font-medium">{pageError instanceof Error ? pageError.message : 'Unknown error'}</p>
              </div>
            </div>
          </div>
        ) : null}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PageTab)} className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start gap-2 rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white/80 p-2 shadow-sm">
            {PAGE_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className={getTabTriggerClass(activeTab === tab.key)}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(summary?.overview.kpis || []).map((item, index) => <KpiCard key={item.label} item={item} index={index} />)}
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <ChartCard title="Enquiry Status" subtitle="Current month pipeline state mix">
                {renderPieChart(summary?.overview.enquiryStatus || [])}
              </ChartCard>
              <ChartCard title="Source Share" subtitle="Lead contribution by source">
                {renderBarChart({
                  data: summary?.overview.sourceShare || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Enquiries', color: CHART_COLORS[0] }],
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
                    <p className="mt-3 text-sm font-bold leading-6 text-slate-700">{summary?.overview.walkinSpotlight.message || 'No walk-in read for this month yet.'}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {(summary?.overview.sourceCards || []).map((card) => (
                    <div key={card.source} className={cn(
                      'flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border px-4 py-3',
                      card.highlightWalkIn ? 'border-amber-200 bg-amber-50/80' : 'border-slate-200 bg-white',
                    )}>
                      <div>
                        <p className="text-sm font-black text-slate-950">{card.source}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{formatNumber(card.enquiries)} enquiries · {formatNumber(card.bookings)} bookings</p>
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
              action={(
                <Select value={modelSourceFilter} onValueChange={setModelSourceFilter}>
                  <SelectTrigger className="w-[220px] rounded-2xl">
                    <SelectValue placeholder="All sources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    {(summary?.models.sourceOptions || []).map((item, index) => (
                      <SelectItem key={`${item}-${index}`} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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

          <TabsContent value="sources" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <ChartCard title="Source Volume" subtitle="Lead volume and conversion by source">
                {renderBarChart({
                  data: summary?.sources.items || [],
                  xKey: 'source',
                  bars: [
                    { key: 'enquiries', label: 'Enquiries', color: CHART_COLORS[0] },
                    { key: 'bookings', label: 'Bookings', color: CHART_COLORS[2] },
                  ],
                })}
              </ChartCard>
              <ChartCard title="Walk-In Spotlight" subtitle="Lead-source focus card">
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50/80 p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700">Walk-In</p>
                  <p className="mt-3 text-4xl font-black text-amber-950">{formatNumber(summary?.sources.walkinSpotlight.enquiries || 0)}</p>
                  <p className="mt-2 text-sm font-bold text-amber-900">Share {formatPercent(summary?.sources.walkinSpotlight.sharePct || 0)}</p>
                  <p className="mt-4 text-sm font-medium leading-6 text-amber-800">{summary?.sources.walkinSpotlight.message || 'No current walk-in message.'}</p>
                </div>
                <div className="mt-4 space-y-3">
                  {(summary?.sources.items || []).map((item) => (
                    <div key={item.source} className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-slate-950">{item.source}</p>
                        <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-700">
                          {formatPercent(item.sharePct)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs font-semibold text-slate-500">{formatNumber(item.enquiries)} enquiries · {formatNumber(item.bookings)} bookings</p>
                      <p className="mt-2 text-sm font-black text-emerald-700">Conversion {formatPercent(item.conversionPct)}</p>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </div>

            <ChartCard title="Dealer Source Matrix" subtitle="Matrix view for future multi-dealer coverage">
              {(summary?.sources.dealerMatrix || []).length ? (
                <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
                  <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow className="border-b border-white/10 bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-bg)]">
                        <TableHead className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-fg)]">Dealer</TableHead>
                        {(summary?.sources.items || []).map((item) => (
                          <TableHead key={item.source} className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-fg)]">{item.source}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(summary?.sources.dealerMatrix || []).map((dealer) => (
                        <TableRow key={dealer.dealer} className="odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)]">
                          <TableCell className="font-black text-slate-950">{dealer.dealer}</TableCell>
                          {dealer.values.map((value) => (
                            <TableCell key={`${dealer.dealer}-${value.source}`} className="font-semibold text-slate-600">{formatNumber(value.enquiries)}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No matrix available" body="Dealer-source matrix will appear once month coverage is available." />
              )}
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
                            <p className="mt-1 text-xs font-semibold text-slate-500">{formatNumber(item.enquiries)} enquiries · {formatNumber(item.bookings)} bookings</p>
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
                  <EmptyState title="No consultant metrics" body="Consultant slices will appear when month data is available." />
                )}
              </ChartCard>
            </div>

            <ChartCard title="Leaderboard Table" subtitle="Detailed consultant comparison table">
              {(summary?.team.leaderboard || []).length ? (
                <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
                  <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow className="border-b border-white/10 bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-bg)]">
                        {['Consultant', 'Enquiries', 'Bookings', 'Booking %', 'Walk-In Enq', 'Walk-In Book', 'Walk-In %', 'TD', 'TD %'].map((label) => (
                          <TableHead key={label} className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-fg)]">{label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(summary?.team.leaderboard || []).map((item) => (
                        <TableRow key={item.consultant} className="odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)]">
                          <TableCell className="font-black text-slate-950">{item.consultant}</TableCell>
                          <TableCell>{formatNumber(item.enquiries)}</TableCell>
                          <TableCell>{formatNumber(item.bookings)}</TableCell>
                          <TableCell>{formatPercent(item.bookingRatePct)}</TableCell>
                          <TableCell>{formatNumber(item.walkinEnquiries)}</TableCell>
                          <TableCell>{formatNumber(item.walkinBookings)}</TableCell>
                          <TableCell>{formatPercent(item.walkinConversionPct)}</TableCell>
                          <TableCell>{formatNumber(item.testDrives)}</TableCell>
                          <TableCell>{formatPercent(item.tdRatePct)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No consultant rows" body="Consultant leaderboard data is not available for this month." />
              )}
            </ChartCard>
          </TabsContent>

          <TabsContent value="trend" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <ChartCard title="Daily Enquiry Trend" subtitle="Day-by-day enquiry build for the selected month">
                {renderAreaChart(summary?.trend.daily || [], 'day', 'enquiries', CHART_COLORS[0])}
              </ChartCard>
              <ChartCard title="Trend Read" subtitle="Auto-generated month note">
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
                  <p className="mt-3 text-3xl font-black text-slate-950">{summary?.lost.lostRateChangePct === null || summary?.lost.lostRateChangePct === undefined ? 'NA' : `${summary.lost.lostRateChangePct.toFixed(1)}%`}</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <ChartCard title="Lost By Reason" subtitle="Primary lost reasons this month">
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
                action={(
                  <Button type="button" className="app-outline-action rounded-2xl px-4" onClick={() => setLostDialogOpen(true)}>
                    <Search className="h-4 w-4" />
                    View cases
                  </Button>
                )}
              >
                {renderBarChart({
                  data: summary?.lost.sources || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Cases', color: CHART_COLORS[6] }],
                })}
              </ChartCard>
            </div>
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
                          <p className="mt-1 text-sm font-medium text-slate-500">{formatNumber(item.units)} retails · Avg price {formatCompactCurrency(item.avgPrice)}</p>
                        </div>
                        <Badge className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-black text-sky-700">
                          Revenue {formatCompactCurrency(item.revenue)}
                        </Badge>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Avg Delivery</p>
                          <p className="mt-2 text-xl font-black text-slate-950">{item.avgDeliveryDays === null ? 'NA' : `${item.avgDeliveryDays.toFixed(1)}d`}</p>
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
                <EmptyState title="No retail models" body="Retail model cards will appear when retail rows are available for the selected month." />
              )}
            </ChartCard>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <ChartCard title="Retail Transactions" subtitle="Searchable transaction detail">
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={retailSearch} onChange={(event) => setRetailSearch(event.target.value)} placeholder="Search customer, VIN, consultant, financier..." className="rounded-2xl pl-10" />
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-600">
                    {formatNumber(filteredRetailRows.length)} transactions
                  </div>
                </div>
                {filteredRetailRows.length ? (
                  <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
                    <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                      <TableHeader>
                        <TableRow className="border-b border-white/10 bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-bg)]">
                          {['Customer', 'Model', 'Consultant', 'Finance', 'Financier', 'Revenue', 'Invoice', 'Delivery', 'Accessories'].map((label) => (
                            <TableHead key={label} className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-fg)]">{label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRetailRows.slice(0, 50).map((row) => (
                          <TableRow key={row.rowKey} className="odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)]">
                            <TableCell className="font-black text-slate-950">{row.customerName}</TableCell>
                            <TableCell>{row.model} {row.variant ? `· ${row.variant}` : ''}</TableCell>
                            <TableCell>{row.consultant}</TableCell>
                            <TableCell>{row.financeType}</TableCell>
                            <TableCell>{row.financier || 'NA'}</TableCell>
                            <TableCell>{formatCurrency(row.exShowroomPrice)}</TableCell>
                            <TableCell>{formatDate(row.invoiceDate)}</TableCell>
                            <TableCell>{formatDate(row.deliveryDate)}</TableCell>
                            <TableCell>{formatCurrency(row.accessoriesValue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState title="No matching retail rows" body="Try a different month or clear the retail search to see transactions." />
                )}
              </ChartCard>
              <ChartCard title="Financiers" subtitle="Top finance partners by retail count">
                {(summary?.retail.financiers || []).length ? (
                  <div className="space-y-3">
                    {(summary?.retail.financiers || []).map((item) => (
                      <div key={item.financier} className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white px-4 py-3">
                        <span className="text-sm font-black text-slate-950">{item.financier}</span>
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
            </div>
          </TabsContent>

          <TabsContent value="reports" className="space-y-5">
            <Tabs value={activeReport} onValueChange={(value) => {
              setActiveReport(value as ReportKey)
              setReportPage(1)
              setReportSort('')
              setReportDirection('desc')
            }} className="space-y-4">
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
              action={(
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className="app-outline-action rounded-2xl px-4" onClick={resetReportFilters}>
                    <Filter className="h-4 w-4" />
                    Clear
                  </Button>
                  <Button type="button" variant="outline" className="app-outline-action rounded-2xl px-4" onClick={() => {
                    setExpandedReportColumns((current) => ({ ...current, [activeReport]: !current[activeReport] }))
                  }}>
                    {expandedReportColumns[activeReport] ? 'Default columns' : 'Show all columns'}
                  </Button>
                  <Button type="button" className="app-primary-action rounded-2xl px-4" onClick={() => { void handleCsvExport() }} disabled={reportQuery.isFetching}>
                    <Download className="h-4 w-4" />
                    Export CSV
                  </Button>
                </div>
              )}
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
                <Select value={reportSource} onValueChange={(value) => {
                  setReportSource(value)
                  setReportPage(1)
                }}>
                  <SelectTrigger className="rounded-2xl">
                    <SelectValue placeholder={REPORT_SOURCE_COLUMN_LABEL[activeReport]} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All {REPORT_SOURCE_COLUMN_LABEL[activeReport]}</SelectItem>
                    {metricOptions.source.map((item, index) => <SelectItem key={`${item}-${index}`} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={reportModel} onValueChange={(value) => {
                  setReportModel(value)
                  setReportPage(1)
                }}>
                  <SelectTrigger className="rounded-2xl">
                    <SelectValue placeholder="Model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All models</SelectItem>
                    {metricOptions.model.map((item, index) => <SelectItem key={`${item}-${index}`} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={reportConsultant} onValueChange={(value) => {
                  setReportConsultant(value)
                  setReportPage(1)
                }}>
                  <SelectTrigger className="rounded-2xl">
                    <SelectValue placeholder={REPORT_CONSULTANT_LABEL[activeReport]} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All {REPORT_CONSULTANT_LABEL[activeReport]}</SelectItem>
                    {metricOptions.consultant.map((item, index) => <SelectItem key={`${item}-${index}`} value={item}>{item}</SelectItem>)}
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
                  <Select value={String(reportPageSize)} onValueChange={(value) => {
                    setReportPageSize(Number(value))
                    setReportPage(1)
                  }}>
                    <SelectTrigger className="w-24 rounded-2xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
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
                        <TableRow key={`${activeReport}-${rowIndex}`} className="odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)]">
                          {visibleColumns.map((column) => (
                            <TableCell key={`${rowIndex}-${column}`} className="max-w-[240px] truncate text-[13px] font-medium text-slate-700" title={String(row[column] ?? '')}>
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
                  <Button type="button" variant="outline" className="app-outline-action rounded-2xl px-4" disabled={(reportQuery.data?.pagination.page || 1) <= 1} onClick={() => setReportPage((current) => Math.max(1, current - 1))}>
                    Previous
                  </Button>
                  <Button type="button" variant="outline" className="app-outline-action rounded-2xl px-4" disabled={(reportQuery.data?.pagination.page || 1) >= (reportQuery.data?.pagination.totalPages || 1)} onClick={() => setReportPage((current) => current + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </ChartCard>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={lostDialogOpen} onOpenChange={setLostDialogOpen}>
        <DialogContent className="max-w-6xl rounded-[2rem] border border-slate-200 p-0">
          <DialogHeader className="rounded-t-[2rem] border-b border-white/10 bg-[var(--dashboard-action-bg)] px-6 py-5 text-[var(--dashboard-action-fg)]">
            <DialogTitle className="text-2xl font-black">Lost Cases</DialogTitle>
            <DialogDescription className="text-white/75">
              Search lost enquiries by customer, model, source, consultant, or reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={lostSearch} onChange={(event) => setLostSearch(event.target.value)} placeholder="Search lost rows..." className="rounded-2xl pl-10" />
            </div>

            {filteredLostRows.length ? (
              <div className="max-h-[70vh] overflow-auto rounded-[1.5rem] border border-slate-200">
                <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                  <TableHeader>
                    <TableRow className="sticky top-0 border-b border-white/10 bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-bg)]">
                      {['Enquiry Date', 'Customer', 'Phone', 'Model', 'Source', 'Consultant', 'Status', 'Reason', 'Lost Due To', 'Remark'].map((label) => (
                        <TableHead key={label} className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-fg)]">{label}</TableHead>
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
              <EmptyState title="No lost rows found" body="Try another search term or a different month." />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
