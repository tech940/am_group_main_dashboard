'use client'

import type { ComponentProps, ReactNode } from 'react'
import { startTransition, useDeferredValue, useEffect, useState, useRef, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowDownUp,
  BarChart3,
  CalendarDays,
  CarFront,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  Trophy,
  XCircle,
  Clock,
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
type PageTab = 'overview' | 'models' | 'sources' | 'team' | 'testdrives' | 'trend' | 'lost' | 'retail' | 'reports'

const PAGE_TABS: Array<{ key: PageTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'models', label: 'Models' },
  { key: 'sources', label: 'Sources' },
  { key: 'team', label: 'Team' },
  { key: 'testdrives', label: 'Test Drives' },
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
  '#c5162f',
  '#071a2b',
  '#269442',
  '#18a7d0',
  '#8835a7',
  '#f07c1a',
  '#d76478',
  '#e7bcc6',
]

const PRIMARY_SURFACE =
  'rounded-[2rem] border border-[#d5dfea] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]'

const PAGE_BACKGROUND =
  'bg-[linear-gradient(180deg,#edf3f9_0%,#eef3f8_38%,#e7eef6_100%)]'

const KPI_CARD_STYLES = [
  'border-t-[5px] border-t-[#c5162f]',
  'border-t-[5px] border-t-[#18a7d0]',
  'border-t-[5px] border-t-[#269442]',
  'border-t-[5px] border-t-[#f07c1a]',
  'border-t-[5px] border-t-[#d90416]',
  'border-t-[5px] border-t-[#8835a7]',
  'border-t-[5px] border-t-[#071a2b]',
  'border-t-[5px] border-t-[#d76478]',
] as const

const TAB_TRIGGER_BASE_CLASS =
  'rounded-full border border-[#d5dfea] bg-white px-4 py-2 text-[13px] font-black text-slate-600 shadow-sm transition'

function getTabTriggerClass(isActive: boolean) {
  return cn(
    TAB_TRIGGER_BASE_CLASS,
    isActive
      ? 'border-[#071a2b] bg-[#071a2b] text-white shadow-[0_10px_20px_rgba(7,26,43,0.24)]'
      : 'hover:border-[#071a2b]/35 hover:text-[#071a2b]'
  )
}

const MODEL_ACCENTS: Record<string, { text: string; line: string; pill: string; hex: string }> = {
  SONET: { text: 'text-[#071a2b]', line: 'bg-[#071a2b]', pill: 'bg-[#edf2f6] text-[#071a2b]', hex: '#071a2b' },
  'NEW SELTOS': { text: 'text-[#c5162f]', line: 'bg-[#c5162f]', pill: 'bg-[#fdecee] text-[#c5162f]', hex: '#c5162f' },
  SELTOS: { text: 'text-[#8835a7]', line: 'bg-[#8835a7]', pill: 'bg-[#f3eafa] text-[#8835a7]', hex: '#8835a7' },
  SYROS: { text: 'text-[#f07c1a]', line: 'bg-[#f07c1a]', pill: 'bg-[#fff1e4] text-[#f07c1a]', hex: '#f07c1a' },
  CARENS: { text: 'text-[#269442]', line: 'bg-[#269442]', pill: 'bg-[#edf8f0] text-[#269442]', hex: '#269442' },
}

const REPORT_EXPANDED_DEFAULTS: Record<ReportKey, boolean> = {
  enquiry: false,
  booking: false,
  sales: false,
  accessories: false,
}
const SALES_REPORT_TABLE_PAGE_SIZE = 10

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
  return `${formatDate(startDate)} - ${formatDate(endDate)}`
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

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-2xl bg-slate-200/80', className)} />
}

function ChartCardSkeleton({ height = 'h-72' }: { height?: string }) {
  return (
    <Card className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
      <div className="h-1.5 bg-slate-200" />
      <CardHeader className="space-y-3 p-5 pb-3">
        <SkeletonBlock className="h-3 w-32" />
        <SkeletonBlock className="h-3 w-52" />
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <SkeletonBlock className={cn('w-full', height)} />
      </CardContent>
    </Card>
  )
}

function TableSkeleton({
  columns,
  rows = SALES_REPORT_TABLE_PAGE_SIZE,
}: {
  columns: number
  rows?: number
}) {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-[#d8e2ec]">
      <div className="grid gap-px bg-[#e6edf5]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }).map((_, index) => (
          <div key={`head-${index}`} className="bg-white p-4">
            <SkeletonBlock className="h-3 w-20" />
          </div>
        ))}
        {Array.from({ length: rows * columns }).map((_, index) => (
          <div key={`cell-${index}`} className="bg-white p-4">
            <SkeletonBlock className="h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function TablePagination({
  page,
  totalPages,
  onPrevious,
  onNext,
}: {
  page: number
  totalPages: number
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs font-semibold text-slate-500">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" className="rounded-full border-[#d5dfea] bg-white px-3 py-1.5 text-[12px] font-black text-slate-700 hover:text-[#071a2b]" disabled={page <= 1} onClick={onPrevious}>
          Previous
        </Button>
        <Button type="button" variant="outline" className="rounded-full border-[#d5dfea] bg-white px-3 py-1.5 text-[12px] font-black text-slate-700 hover:text-[#071a2b]" disabled={page >= totalPages} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-[#d8e2ec] bg-[#f8fbfd] px-6 py-10 text-center">
      <BarChart3 className="h-8 w-8 text-slate-400" />
      <p className="mt-3 text-[15px] font-black text-slate-900">{title}</p>
      <p className="mt-1 max-w-xl text-[13px] font-medium leading-6 text-slate-500">{body}</p>
    </div>
  )
}

function ChartCard({
  title,
  subtitle,
  action,
  titleIcon,
  children,
  className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  titleIcon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn(PRIMARY_SURFACE, 'overflow-hidden', className)}>
      <div className="h-1.5 bg-[linear-gradient(90deg,#c5162f_0%,#071a2b_40%,#18a7d0_100%)]" />
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-5 pb-3">
        <div>
          <div className="flex items-center gap-1.5">
            {titleIcon}
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c5162f]">{title}</p>
          </div>
          {subtitle ? <p className="mt-1 text-[13px] font-medium text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-5 pt-0">{children}</CardContent>
    </Card>
  )
}

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
    'border-[#d5e8fb] bg-[#eff7ff] text-[#0f5e97]',
    'border-[#ddd8fb] bg-[#f3f1ff] text-[#4c46aa]',
    'border-[#d7f0dd] bg-[#eef9f0] text-[#188543]',
    'border-[#fde7cb] bg-[#fff5e9] text-[#b8650f]',
  ]
  
  return (
    <div className={cn('rounded-[1.5rem] border p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md', styles[index % styles.length])}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-75">{label}</p>
      <p className="mt-2 text-[24px] font-black leading-none">{formatNumber(rowCount)}</p>
      <p className="mt-2 text-[13px] font-semibold opacity-80">Updated {formatDateTime(sourceUpdatedAt)}</p>
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
              innerRadius={58}
              outerRadius={102}
              paddingAngle={2}
              stroke="#ffffff"
              strokeWidth={2.5}
            >
              {data.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value) => valueFormatter ? valueFormatter(Number(value)) : formatNumber(Number(value))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.map((entry, index) => (
          <div key={`${entry.name}-${index}`} className="flex items-center justify-between rounded-full border border-[#e1e8ef] bg-[#f8fbfd] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
              <span className="text-[13px] font-bold text-slate-700">{entry.name}</span>
            </div>
            <span className="text-[13px] font-black text-slate-950">{valueFormatter ? valueFormatter(entry.value) : formatNumber(entry.value)}</span>
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
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(203,213,225,0.55)" vertical={false} />
          <XAxis dataKey={String(xKey)} tick={{ fill: '#7b8794', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#7b8794', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value) => formatNumber(Number(value))} />
          <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
          {bars.map((bar, index) => (
            <Bar
              key={String(bar.key)}
              dataKey={String(bar.key)}
              name={bar.label}
              fill={bar.color || CHART_COLORS[index % CHART_COLORS.length]}
              radius={stacked ? [0, 0, 0, 0] : [6, 6, 0, 0]}
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
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(203,213,225,0.55)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: '#7b8794', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#7b8794', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value) => formatNumber(Number(value))} />
          <Area type="monotone" dataKey={yKey} stroke={color} fill="url(#kiaSalesArea)" strokeWidth={3.5} />
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

function getModelAccent(modelName: string) {
  return MODEL_ACCENTS[modelName.toUpperCase()] || {
    text: 'text-[#071a2b]',
    line: 'bg-[#071a2b]',
    pill: 'bg-[#eef3f7] text-[#071a2b]',
    hex: '#071a2b',
  }
}

function getKpiByLabel(kpis: SalesReportSummaryPayload['overview']['kpis'] | undefined, label: string) {
  return (kpis || []).find((item) => item.label.toLowerCase().includes(label.toLowerCase()))
}

function buildRetailBreakdown(
  rows: SalesReportSummaryPayload['retail']['transactions'],
  key: 'model' | 'source' | 'consultant',
) {
  const totals = new Map<string, number>()
  rows.forEach((row) => {
    const label = row[key]
    if (!label) return
    totals.set(label, (totals.get(label) || 0) + 1)
  })

  const grandTotal = Array.from(totals.values()).reduce((sum, value) => sum + value, 0)
  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([name, value]) => ({
      name,
      value,
      sharePct: grandTotal > 0 ? (value / grandTotal) * 100 : 0,
    }))
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
          {value ? <p className="text-[15px] font-black text-slate-900">{value}</p> : null}
          {trailing ? <p className="text-[12px] font-semibold text-slate-400">{trailing}</p> : null}
        </div>
      </div>
      <div className="h-3 rounded-full bg-[#eef2f7]">
        <div
          className="h-3 rounded-full"
          style={{ width: `${Math.max(2, Math.min(100, percent))}%`, backgroundColor: color }}
        />
      </div>
    </div>
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
      <span>{label}: {value}</span>
      {tone ? (
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-black',
            tone === 'red' ? 'bg-[#fdecee] text-[#c5162f]' : 'bg-[#edf8f0] text-[#269442]',
          )}
        >
          {tone === 'red' ? '▼' : '▼'} MoM
        </span>
      ) : null}
    </div>
  )
}

function WeekStatCard({
  title,
  dates,
  total,
  average,
  peak,
  accent,
}: {
  title: string
  dates: string
  total: string
  average: string
  peak: string
  accent: string
}) {
  return (
    <Card className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
      <div className={cn('h-1.5', accent)} />
      <CardContent className="p-5">
        <p className="text-[12px] font-black text-slate-900">{title}</p>
        <p className="mt-1 text-[13px] font-medium text-slate-500">{dates}</p>
        <p className="mt-5 text-[38px] font-black tracking-tight text-slate-950">{total}</p>
        <p className="mt-2 text-[13px] font-semibold text-slate-600">Avg/day: {average}</p>
        <p className="mt-2 text-[13px] font-semibold text-slate-600">Peak: {peak}</p>
      </CardContent>
    </Card>
  )
}

function ModelStoryCard({ item }: { item: SalesReportSummaryPayload['retail']['modelCards'][number] }) {
  const accent = getModelAccent(item.model)

  return (
    <Card className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
      <div className={cn('h-1.5', accent.line)} />
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={cn('text-[26px] font-black uppercase tracking-[0.04em]', accent.text)}>{item.model}</p>
            <p className="mt-2 text-[13px] font-medium text-slate-500">
              {formatNumber(item.units)} units · avg {item.avgDeliveryDays === null ? 'NA' : `${item.avgDeliveryDays.toFixed(1)}d`} delivery
            </p>
          </div>
          <div className="text-right">
            <p className={cn('text-[32px] font-black leading-none', accent.text)}>{formatCompactCurrency(item.revenue)}</p>
            <p className="mt-2 text-[13px] font-medium text-slate-500">Avg {formatCompactCurrency(item.avgPrice)}/unit</p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <p className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-500">Variants sold</p>
          {item.variants.slice(0, 7).map((variant) => {
            const max = item.variants[0]?.count || 1
            return (
              <div key={`${item.model}-${variant.name}`} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-medium text-slate-700">{variant.name}</span>
                  <span className={cn('font-black', accent.text)}>{variant.count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#eef2f7]">
                  <div className={cn('h-1.5 rounded-full', accent.line)} style={{ width: `${(variant.count / max) * 100}%` }} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-500">Colors</p>
            <div className="mt-3 space-y-2.5">
              {item.colors.slice(0, 5).map((color) => (
                <div key={`${item.model}-${color.name}`} className="flex items-center justify-between gap-3 text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-slate-300 ring-1 ring-slate-200" />
                    <span className="font-medium text-slate-700">{color.name}</span>
                  </div>
                  <span className={cn('font-black', accent.text)}>{color.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[12px] font-black uppercase tracking-[0.16em] text-slate-500">Finance</p>
            <div className="mt-3 space-y-2.5">
              {item.financeBreakdown.map((finance) => (
                <div key={`${item.model}-${finance.name}`} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-medium text-slate-700">{finance.name}</span>
                  <span className={cn('rounded-full px-3 py-1 text-xs font-black', accent.pill)}>{finance.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function KiaSalesReportPage({ initialSearchParams, currentUserRole }: { initialSearchParams: SearchParamsInput; currentUserRole?: string }) {
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
  const [selectedStartDate, setSelectedStartDate] = useState<string>(() => {
    const raw = readSingleParam(initialSearchParams.startDate)
    return isInputDate(raw) ? raw as string : ''
  })
  const [selectedEndDate, setSelectedEndDate] = useState<string>(() => {
    const raw = readSingleParam(initialSearchParams.endDate)
    return isInputDate(raw) ? raw as string : ''
  })
  const [selectedDealerCode, setSelectedDealerCode] = useState<string | null>(readSingleParam(initialSearchParams.dealer_code) || null)
  const [modelSourceFilter, setModelSourceFilter] = useState('all')
  const [reportSearch, setReportSearch] = useState(readSingleParam(initialSearchParams.search) || '')
  const [reportPage, setReportPage] = useState(1)
  const [reportPageSize] = useState(SALES_REPORT_TABLE_PAGE_SIZE)
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
  const [lostPage, setLostPage] = useState(1)
  const [retailSearch, setRetailSearch] = useState('')
  const [retailPage, setRetailPage] = useState(1)
  const [teamPage, setTeamPage] = useState(1)
  const [heatmapPage, setHeatmapPage] = useState(1)
  const [expandedReportColumns, setExpandedReportColumns] = useState(REPORT_EXPANDED_DEFAULTS)
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({})
  const [missedFollowupsOnly, setMissedFollowupsOnly] = useState(false)
  const shouldRefreshNext = useRef(false)
  // Dedicated Test Drives tab — its own isolated filters + pagination (independent of the Reports tab).
  const [tdSource, setTdSource] = useState('all')
  const [tdModel, setTdModel] = useState('all')
  const [tdConsultant, setTdConsultant] = useState('all')
  const [tdSearch, setTdSearch] = useState('')
  const [tdPage, setTdPage] = useState(1)
  const [tdPageSize, setTdPageSize] = useState(25)


  const deferredReportSearch = useDeferredValue(reportSearch)
  const deferredTdSearch = useDeferredValue(tdSearch)
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
      'kia-sales-report-summary',
      hasCompleteCustomRange ? selectedRangeStart : effectiveSelectedYear,
      hasCompleteCustomRange ? selectedRangeEnd : effectiveSelectedMonth,
      selectedDealerCode || 'all',
    ],
    enabled: periodReady,
    queryFn: () => {
      const refresh = shouldRefreshNext.current
      return fetchReportJson<SalesReportSummaryPayload>(`/api/brands/kia/sales-report/summary?${buildQueryString({
        ...periodQueryParams,
        dealer_code: selectedDealerCode,
        refresh: refresh ? 'true' : undefined,
      })}`, 'kia-sales-report-summary', 25000)
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
      'kia-sales-report-report',
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
      columnFilters,
      missedFollowupsOnly,
    ],
    enabled: periodReady && activeTab === 'reports' && summaryQuery.isSuccess,
    queryFn: () => {
      const refresh = shouldRefreshNext.current
      const filterParams: Record<string, string> = {}
      Object.entries(columnFilters).forEach(([col, vals]) => {
        if (vals && vals.length > 0) {
          filterParams[`filter_${col}`] = vals.map(encodeURIComponent).join(',')
        }
      })
      return fetchReportJson<SalesReportListPayload>(`/api/brands/kia/sales-report/reports?${buildQueryString({
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
        missedFollowups: missedFollowupsOnly ? 'true' : 'false',
        refresh: refresh ? 'true' : undefined,
        ...filterParams,
      })}`, 'kia-sales-report-reports', 25000)
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  })

  // Dedicated Test Drives tab: the enquiry table filtered to td_status = "Done", with its own filters
  // + pagination. Reuses the /reports endpoint (report=test_drives) so the table shape is identical.
  const testDriveQuery = useQuery({
    queryKey: [
      'kia-sales-report-test-drives',
      hasCompleteCustomRange ? selectedRangeStart : effectiveSelectedYear,
      hasCompleteCustomRange ? selectedRangeEnd : effectiveSelectedMonth,
      selectedDealerCode || 'all',
      tdSource,
      tdModel,
      tdConsultant,
      deferredTdSearch,
      tdPage,
      tdPageSize,
    ],
    enabled: periodReady && activeTab === 'testdrives' && summaryQuery.isSuccess,
    queryFn: () => fetchReportJson<SalesReportListPayload>(`/api/brands/kia/sales-report/reports?${buildQueryString({
      report: 'test_drives',
      ...periodQueryParams,
      dealer_code: selectedDealerCode,
      source: tdSource,
      model: tdModel,
      consultant: tdConsultant,
      search: deferredTdSearch,
      page: tdPage,
      pageSize: tdPageSize,
    })}`, 'kia-sales-report-test-drives', 25000),
    staleTime: 2 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previousData) => previousData,
  })
  const tdVisibleColumns = testDriveQuery.data?.defaultVisibleColumns || []

  // Reset column filters when active report tab, date, or dealer changes
  useEffect(() => {
    setColumnFilters({})
    setMissedFollowupsOnly(false)
    setReportPage(1)
  }, [activeReport, selectedDealerCode, selectedYear, selectedMonth, selectedStartDate, selectedEndDate])

  useEffect(() => {
    const params = new URLSearchParams()
    if (activeTab !== 'overview') params.set('tab', activeTab)
    if (activeReport !== 'enquiry') params.set('report', activeReport)
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
  const metricOptions = getMetricOptions(summary)
  const visibleColumns = reportQuery.data
    ? (expandedReportColumns[activeReport] ? reportQuery.data.columns : reportQuery.data.defaultVisibleColumns)
    : []
  const modelBreakdown = modelSourceFilter === 'all'
    ? summary?.models.items.map((item) => ({ model: item.model, enquiries: item.enquiries, bookings: item.bookings })) || []
    : summary?.models.sourceBreakdown[modelSourceFilter] || []
  // Model-wise test drives (ranked high → low) + the total, for the Test Drives tab + Overview card.
  const testDrivesByModel = summary?.models.testDrivesByModel || []
  const testDrivesByModelVariant = summary?.models.testDrivesByModelVariant || []
  const testDrivesTotal = testDrivesByModel.reduce((sum, item) => sum + item.testDrives, 0)
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
  const overviewKpis = summary?.overview.kpis || []
  const enquiryKpi = getKpiByLabel(overviewKpis, 'enquiries')
  const bookingKpi = getKpiByLabel(overviewKpis, 'bookings')
  const retailKpi = getKpiByLabel(overviewKpis, 'retails')
  const lostKpi = getKpiByLabel(overviewKpis, 'lost')
  const retailByModel = buildRetailBreakdown(summary?.retail.transactions || [], 'model')
  const retailBySource = buildRetailBreakdown(summary?.retail.transactions || [], 'source')
  const retailByConsultant = buildRetailBreakdown(summary?.retail.transactions || [], 'consultant')
  const topConsultantList = summary?.team.leaderboard.slice(0, 10) || []
  const teamRows = summary?.team.leaderboard || []
  const teamGrandTotal = useMemo(() => {
    if (!teamRows.length) return null
    const totals = {
      enquiries: 0,
      testDrives: 0,
      bookings: 0,
      walkinEnquiries: 0,
      walkinBookings: 0,
    }
    teamRows.forEach(row => {
      totals.enquiries += row.enquiries || 0
      totals.testDrives += row.testDrives || 0
      totals.bookings += row.bookings || 0
      totals.walkinEnquiries += row.walkinEnquiries || 0
      totals.walkinBookings += row.walkinBookings || 0
    })
    
    const tdRatePct = totals.enquiries > 0 ? (totals.testDrives / totals.enquiries) * 100 : 0
    const bookingRatePct = totals.enquiries > 0 ? (totals.bookings / totals.enquiries) * 100 : 0
    const walkinConversionPct = totals.walkinEnquiries > 0 ? (totals.walkinBookings / totals.walkinEnquiries) * 100 : 0
    
    return {
      consultant: 'Grand Total',
      enquiries: totals.enquiries,
      testDrives: totals.testDrives,
      tdRatePct,
      bookings: totals.bookings,
      bookingRatePct,
      walkinEnquiries: totals.walkinEnquiries,
      walkinBookings: totals.walkinBookings,
      walkinConversionPct,
    }
  }, [teamRows])
  const teamTotalPages = Math.max(1, Math.ceil(teamRows.length / SALES_REPORT_TABLE_PAGE_SIZE))
  const pagedTeamRows = teamRows
  const heatmapRows = summary?.sources.dealerMatrix || []
  const heatmapTotalPages = Math.max(1, Math.ceil(heatmapRows.length / SALES_REPORT_TABLE_PAGE_SIZE))
  const pagedHeatmapRows = heatmapRows.slice((heatmapPage - 1) * SALES_REPORT_TABLE_PAGE_SIZE, heatmapPage * SALES_REPORT_TABLE_PAGE_SIZE)
  const lostTotalPages = 1
  const pagedLostRows = filteredLostRows
  const retailTotalPages = Math.max(1, Math.ceil(filteredRetailRows.length / SALES_REPORT_TABLE_PAGE_SIZE))
  const pagedRetailRows = filteredRetailRows.slice((retailPage - 1) * SALES_REPORT_TABLE_PAGE_SIZE, retailPage * SALES_REPORT_TABLE_PAGE_SIZE)
  const lowestBookingsList = (summary?.team.leaderboard || [])
    .filter((item) => item.enquiries >= 5)
    .sort((left, right) => left.bookings - right.bookings || right.enquiries - left.enquiries)
    .slice(0, 6)
  const highEnquiryLowConversionList = (summary?.team.leaderboard || [])
    .filter((item) => item.enquiries >= 20)
    .sort((left, right) => right.enquiries - left.enquiries || left.bookingRatePct - right.bookingRatePct)
    .slice(0, 6)

  async function handleCsvExport() {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    const filterParams: Record<string, string> = {}
    Object.entries(columnFilters).forEach(([col, vals]) => {
      if (vals && vals.length > 0) {
        filterParams[`filter_${col}`] = vals.map(encodeURIComponent).join(',')
      }
    })
    const response = await fetch(`/api/brands/kia/sales-report/reports?${buildQueryString({
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
      missedFollowups: missedFollowupsOnly ? 'true' : 'false',
      ...filterParams,
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
    setSelectedStartDate('')
    setSelectedEndDate('')
    setPendingStartDate('')
    setPendingEndDate('')
    setReportPage(1)
    setRetailPage(1)
    setLostPage(1)
    setTeamPage(1)
    setHeatmapPage(1)
    setMonthPickerOpen(false)
  }

  // Writes to pending (draft) state only — no API trigger until Apply is clicked
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

  // Commits the pending range to the real query state
  function applyCustomDateRange() {
    if (!pendingStartDate || !pendingEndDate) return
    setSelectedStartDate(pendingStartDate)
    setSelectedEndDate(pendingEndDate)
    setSelectedYear(Number(pendingEndDate.slice(0, 4)))
    setSelectedMonth(Number(pendingEndDate.slice(5, 7)) - 1)
    setReportPage(1)
    setRetailPage(1)
    setLostPage(1)
    setTeamPage(1)
    setHeatmapPage(1)
    setMonthPickerOpen(false)
  }

  function clearCustomDateRange() {
    setPendingStartDate('')
    setPendingEndDate('')
    setSelectedStartDate('')
    setSelectedEndDate('')
    setReportPage(1)
    setRetailPage(1)
    setLostPage(1)
    setTeamPage(1)
    setHeatmapPage(1)
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

  const summaryMonthReady = periodReady
  const headerLoading = freshnessQuery.isLoading || freshnessQuery.isFetching || (summaryMonthReady && summaryQuery.isLoading && !summary)
  const summarySkeletonVisible = summaryMonthReady && (summaryQuery.isLoading || summaryQuery.isFetching)
  const reportSkeletonVisible = activeTab === 'reports' && reportQuery.isLoading
  const reportRefetching = activeTab === 'reports' && reportQuery.isFetching && !reportQuery.isLoading
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


  const renderActiveTabSkeleton = () => {
    if (activeTab === 'reports') {
      return (
        <ChartCard title="Loading report" subtitle="Preparing filters, table, and pagination">
          <div className="grid gap-3 xl:grid-cols-5">
            <SkeletonBlock className="h-11 xl:col-span-2" />
            <SkeletonBlock className="h-11" />
            <SkeletonBlock className="h-11" />
            <SkeletonBlock className="h-11" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <SkeletonBlock className="h-8 w-24 rounded-full" />
            <SkeletonBlock className="h-8 w-28 rounded-full" />
          </div>
          <div className="mt-4">
            <TableSkeleton columns={8} />
          </div>
        </ChartCard>
      )
    }

    if (activeTab === 'team') {
      return (
        <>
          <div className="flex gap-3">
            <SkeletonBlock className="h-10 w-28 rounded-full" />
            <SkeletonBlock className="h-10 w-24 rounded-full" />
            <SkeletonBlock className="h-10 w-24 rounded-full" />
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
            <ChartCardSkeleton height="h-80" />
            <ChartCardSkeleton height="h-80" />
          </div>
          <ChartCardSkeleton height="h-[420px]" />
        </>
      )
    }

    if (activeTab === 'retail') {
      return (
        <>
          <Card className="overflow-hidden rounded-[2rem] border border-[#1a2633] bg-[#162737] text-white shadow-[0_20px_46px_rgba(7,26,43,0.24)]">
            <div className="p-6">
              <SkeletonBlock className="h-3 w-24 bg-white/15" />
              <SkeletonBlock className="mt-4 h-10 w-96 bg-white/15" />
              <SkeletonBlock className="mt-3 h-4 w-52 bg-white/15" />
              <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, index) => <SkeletonBlock key={index} className="h-20 bg-white/15" />)}
              </div>
            </div>
          </Card>
          <div className="grid gap-5 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => <ChartCardSkeleton key={index} height="h-72" />)}
          </div>
          <ChartCardSkeleton height="h-[420px]" />
        </>
      )
    }

    if (activeTab === 'sources') {
      return (
        <>
          <ChartCardSkeleton height="h-[440px]" />
          <ChartCardSkeleton height="h-[320px]" />
        </>
      )
    }

    if (activeTab === 'trend') {
      return (
        <>
          <ChartCardSkeleton height="h-80" />
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <ChartCardSkeleton key={index} height="h-40" />)}
          </div>
        </>
      )
    }

    if (activeTab === 'lost') {
      return (
        <>
          <div className="grid gap-5 xl:grid-cols-2">
            <ChartCardSkeleton height="h-80" />
            <ChartCardSkeleton height="h-80" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <ChartCardSkeleton height="h-80" />
            <ChartCardSkeleton height="h-80" />
          </div>
        </>
      )
    }

    if (activeTab === 'models') {
      return (
        <>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
            <ChartCardSkeleton height="h-80" />
            <ChartCardSkeleton height="h-80" />
          </div>
          <ChartCardSkeleton height="h-80" />
          <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <ChartCardSkeleton key={index} height="h-72" />)}
          </div>
        </>
      )
    }

    return (
      <>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className={cn(PRIMARY_SURFACE, 'min-h-[148px]')}>
              <CardContent className="p-4">
                <SkeletonBlock className="h-3 w-24" />
                <SkeletonBlock className="mt-4 h-10 w-24" />
                <SkeletonBlock className="mt-6 h-3 w-20" />
                <SkeletonBlock className="mt-2 h-6 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(320px,0.9fr)]">
          <ChartCardSkeleton height="h-72" />
          <ChartCardSkeleton height="h-72" />
          <ChartCardSkeleton height="h-72" />
        </div>
        <div className="grid gap-5 xl:grid-cols-3">
          <ChartCardSkeleton height="h-72" />
          <ChartCardSkeleton height="h-72" />
          <ChartCardSkeleton height="h-72" />
        </div>
      </>
    )
  }

  return (
    <MainLayout title="Sales Report" subtitle="AM Kia sales analytics workspace">
      <div className={cn('space-y-6 rounded-[2.4rem] p-4 pb-6 md:p-6', PAGE_BACKGROUND)}>
        <div className="overflow-hidden rounded-[2rem] border border-[#cbd8e4] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
          <div className="h-1.5 bg-[linear-gradient(90deg,#c5162f_0%,#071a2b_28%,#18a7d0_55%,#269442_78%,#f07c1a_100%)]" />
          <div className="flex flex-col gap-4 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Updated {formatDateTime(freshness?.sourceUpdatedAt || null)}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[28px] font-black text-[#071a2b]">
                  <CalendarDays className="h-6 w-6 shrink-0 text-[#18a7d0]" />
                  <span>{headerLoading ? 'Loading period...' : activePeriodLabel}</span>
                </div>
              </div>
              <div className="hidden h-6 w-px bg-[#d6e0ea] lg:block" />
              <div className="flex flex-wrap items-center gap-4">
                {enquiryKpi ? <SummaryRailChip label="Enquiries" value={String(enquiryKpi.value)} tone={enquiryKpi.changePct !== null && (enquiryKpi.trendDirection === 'lower_is_better' ? enquiryKpi.changePct <= 0 : enquiryKpi.changePct >= 0) ? 'green' : 'red'} /> : null}
                {bookingKpi ? <SummaryRailChip label="Bookings" value={String(bookingKpi.value)} tone={bookingKpi.changePct !== null && (bookingKpi.trendDirection === 'lower_is_better' ? bookingKpi.changePct <= 0 : bookingKpi.changePct >= 0) ? 'green' : 'red'} /> : null}
                {retailKpi ? <SummaryRailChip label="Retails" value={String(retailKpi.value)} tone={retailKpi.changePct !== null && (retailKpi.trendDirection === 'lower_is_better' ? retailKpi.changePct <= 0 : retailKpi.changePct >= 0) ? 'green' : 'red'} /> : null}
                {lostKpi ? <SummaryRailChip label="Lost" value={String(lostKpi.value)} tone={lostKpi.changePct !== null && (lostKpi.trendDirection === 'lower_is_better' ? lostKpi.changePct <= 0 : lostKpi.changePct >= 0) ? 'green' : 'red'} /> : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-end">
              <div className="min-w-[240px] sm:flex-1">
                <p className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Month</p>
                <DropdownMenu
                  open={monthPickerOpen}
                  onOpenChange={(open) => {
                      setMonthPickerOpen(open)
                      if (open) {
                        // Initialise pending states from committed values each time picker opens
                        setPendingStartDate(selectedStartDate)
                        setPendingEndDate(selectedEndDate)
                        const anchorDate = selectedEndDate || selectedStartDate
                        const parsedAnchor = anchorDate ? new Date(`${anchorDate}T00:00:00`) : null
                        setMonthPickerView(new Date(
                          parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
                            ? parsedAnchor.getFullYear()
                            : selectedMonthOption?.year ?? today.getFullYear(),
                          parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
                            ? parsedAnchor.getMonth()
                            : selectedMonthOption?.month ?? today.getMonth(),
                          1,
                        ))
                      }
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="h-12 w-full flex items-center justify-between gap-2 rounded-[1rem] border-[#d8e2ec] bg-white px-4 text-[14px] font-semibold text-slate-900 shadow-sm hover:bg-white min-w-0">
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
              <div className="min-w-[170px] sm:flex-1">
                <p className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Dealer</p>
                <Select value={selectedDealerCode || 'all'} onValueChange={(value) => {
                  setSelectedDealerCode(value === 'all' ? null : value)
                  setReportPage(1)
                  setRetailPage(1)
                  setLostPage(1)
                  setTeamPage(1)
                  setHeatmapPage(1)
                }}>
                  <SelectTrigger className="h-12 rounded-[1rem] border-[#d8e2ec] bg-white px-4 text-[14px] font-semibold text-slate-900 shadow-sm">
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
              <Button
                type="button"
                className="h-12 rounded-[1rem] border border-[#071a2b] bg-[#071a2b] px-5 text-[13px] font-black text-white hover:bg-[#071a2b]/95"
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
                <p className="text-lg font-black">Unable to load KIA Sales Report</p>
                <p className="mt-1 text-sm font-medium">{pageError instanceof Error ? pageError.message : 'Unknown error'}</p>
              </div>
            </div>
          </div>
        ) : null}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PageTab)} className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start gap-3 rounded-[2rem] border border-[#d5dfea] bg-white p-3 shadow-sm">
            {PAGE_TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className={getTabTriggerClass(activeTab === tab.key)}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {summarySkeletonVisible ? renderActiveTabSkeleton() : (
            <>
          <TabsContent value="overview" className="space-y-5">
            <SectionHeading title="Key Performance Metrics" description="Core enquiry, booking and conversion figures for the selected period" />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-5">
              {(summary?.overview.kpis || []).map((item, index) => <KpiCard key={item.label} item={item} index={index} />)}
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
                            color="#f07c1a"
                          />
                        )
                      })
                    ) : (
                      <EmptyState title="No missed follow-ups" body="All lead sources are fully up to date." />
                    )}
                  </CardContent>
                </Card>
              </div>
              </>
            ) : null}

            <SectionHeading title="Pipeline & Engagement Analysis" description="Enquiry status breakdown, lead sources, dealer distribution, temperature and test-drive engagement" />
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(320px,0.9fr)]">
              <ChartCard title="Enquiry Status" subtitle="Current month pipeline state mix">
                {renderPieChart(summary?.overview.enquiryStatus || [])}
              </ChartCard>
              <ChartCard title="Enquiry by Source" subtitle="Lead contribution by source">
                {renderPieChart(summary?.overview.sourceShare || [])}
              </ChartCard>
              <ChartCard title="Dealer-wise Enquiries" subtitle="Dealer concentration for the selected month">
                {(summary?.overview.dealerSummary || []).length ? (
                  <div className="space-y-4 pt-3">
                    {(summary?.overview.dealerSummary || []).map((item, index) => {
                      const total = (summary?.overview.dealerSummary || []).reduce((sum, entry) => sum + entry.value, 0)
                      return (
                        <ProgressMetricRow
                          key={`${item.name}-${index}`}
                          label={item.name}
                          value={formatNumber(item.value)}
                          trailing={`(${formatPercent(total > 0 ? (item.value / total) * 100 : 0)})`}
                          percent={total > 0 ? (item.value / total) * 100 : 0}
                          color={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState title="No dealer rows" body="Dealer summary will appear once enquiries are available." />
                )}
              </ChartCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              <ChartCard title="Lead Temperature" subtitle="Cold, warm, and hot mix">
                {(summary?.overview.leadTemperature || []).length ? (
                  <div className="space-y-5 pt-2">
                    {(summary?.overview.leadTemperature || []).map((item, index) => {
                      const total = (summary?.overview.leadTemperature || []).reduce((sum, entry) => sum + entry.value, 0)
                      return (
                        <ProgressMetricRow
                          key={item.name}
                          label={item.name}
                          value={formatNumber(item.value)}
                          trailing={`(${formatPercent(total > 0 ? (item.value / total) * 100 : 0)})`}
                          percent={total > 0 ? (item.value / total) * 100 : 0}
                          color={CHART_COLORS[index + 3]}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState title="No temperature mix" body="Lead temperature will appear when summary metrics are available." />
                )}
              </ChartCard>
              <ChartCard title="Test Drive Engagement" subtitle="Share of enquiries that took a TD">
                {renderPieChart(summary?.overview.testDrive || [])}
              </ChartCard>
              <ChartCard title="Conversion Funnel" subtitle="Volume through the funnel">
                {(summary?.overview.funnel || []).length ? (
                  <div className="space-y-5 pt-2">
                    {(summary?.overview.funnel || []).map((item, index) => {
                      const total = summary?.overview.funnel?.[0]?.value || item.value
                      return (
                        <ProgressMetricRow
                          key={`${item.name}-${index}`}
                          label={item.name}
                          value={formatNumber(item.value)}
                          trailing={`(${formatPercent(total > 0 ? (item.value / total) * 100 : 0)})`}
                          percent={total > 0 ? (item.value / total) * 100 : 0}
                          color={index === 0 ? CHART_COLORS[0] : index === 1 ? CHART_COLORS[1] : index === 2 ? CHART_COLORS[2] : '#e11d0f'}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState title="No funnel data" body="Funnel metrics will appear when the selected month has rows." />
                )}
              </ChartCard>
            </div>

            <SectionHeading title="Lead Source & Model Performance" description="Per-source enquiry share and conversion rate, alongside model-wise demand ranking" />
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              {(summary?.overview.sourceCards || []).map((card, index) => (
                <Card key={card.source} className={cn(PRIMARY_SURFACE, card.highlightWalkIn ? 'border-[#f4d5ac] bg-[#fff8ef]' : '')}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                      <p className="text-[16px] font-black text-slate-950">{card.source}</p>
                    </div>
                    <p className="mt-3 text-[32px] font-black text-slate-950">{formatNumber(card.enquiries)}</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-500">{formatPercent(card.enquirySharePct)} of total enquiries</p>
                    <div className="mt-4 h-2 rounded-full bg-[#eef2f7]">
                      <div className="h-2 rounded-full" style={{ width: `${Math.min(100, card.conversionPct * 4)}%`, backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
                      <span className="font-semibold text-slate-500">Est. {formatNumber(card.bookings)} bookings</span>
                      <span className="rounded-full bg-[#fff1e4] px-3 py-1 text-xs font-black text-[#b8650f]">{formatPercent(card.conversionPct)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
              <ChartCard title="Model-wise Enquiry Volume" subtitle={`${activePeriodLabel} model demand mix`}>
                {renderBarChart({
                  data: summary?.overview.topModels || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Enquiries', color: CHART_COLORS[1] }],
                  height: 360,
                })}
              </ChartCard>
              <ChartCard title="Top 5 Share" subtitle="Largest model slices">
                {renderPieChart(summary?.models.topFive || [])}
                <div className="mt-4 space-y-3">
                  {(summary?.models.topFive || []).map((item, index) => (
                    <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#c5162f] text-sm font-black text-white">#{index + 1}</span>
                        <span className="text-[15px] font-black text-slate-900">{item.name}</span>
                      </div>
                      <span className={cn('text-[20px] font-black', getModelAccent(item.name).text)}>{formatNumber(item.value)}</span>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </div>
          </TabsContent>

          <TabsContent value="models" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
              <ChartCard title="Model-wise Enquiry Volume" subtitle={`${activePeriodLabel} demand build by model`}>
                {renderBarChart({
                  data: summary?.models.items || [],
                  xKey: 'model',
                  bars: [
                    { key: 'enquiries', label: 'Enquiries', color: CHART_COLORS[1] },
                    { key: 'bookings', label: 'Bookings', color: CHART_COLORS[0] },
                  ],
                  height: 360,
                })}
              </ChartCard>
              <ChartCard title="Top 5 Share" subtitle="Largest model slices this month">
                {renderPieChart(summary?.models.topFive || [])}
                <div className="mt-5 space-y-3">
                  {(summary?.models.topFive || []).map((item, index) => (
                    <div key={`${item.name}-${index}`} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#c5162f] text-sm font-black text-white">#{index + 1}</span>
                          <span className="text-[15px] font-black text-slate-900">{item.name}</span>
                        </div>
                        <span className={cn('text-[20px] font-black', getModelAccent(item.name).text)}>{formatNumber(item.value)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[#eef2f7]">
                        <div className={cn('h-2 rounded-full', getModelAccent(item.name).line)} style={{ width: `${Math.min(100, (item.value / (summary?.models.topFive?.[0]?.value || item.value)) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </ChartCard>
            </div>

            <ChartCard
              title="Source Breakdown"
              subtitle="Model mix under a selected lead source"
              action={(
                <Select value={modelSourceFilter} onValueChange={setModelSourceFilter}>
                  <SelectTrigger className="w-[220px] rounded-full border-[#d5dfea] bg-white shadow-sm">
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
                  { key: 'bookings', label: 'Bookings', color: CHART_COLORS[0] },
                ],
                height: 360,
              })}
            </ChartCard>

            <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-4">
              {(summary?.retail.modelCards || []).slice(0, 4).map((item) => (
                <ModelStoryCard key={item.model} item={item} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="sources" className="space-y-5">
            <ChartCard title="Source Distribution" subtitle="Lead contribution by source">
                {renderBarChart({
                  data: summary?.sources.items || [],
                  xKey: 'source',
                  bars: [
                    { key: 'enquiries', label: 'Enquiries', color: CHART_COLORS[1] },
                  ],
                  height: 340,
                })}
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(summary?.sources.items || []).map((item, index) => (
                    <Card key={item.source} className={cn(PRIMARY_SURFACE, 'border-l-[5px] p-0', index === 0 ? 'border-l-[#c5162f]' : index === 1 ? 'border-l-[#269442]' : index === 2 ? 'border-l-[#071a2b]' : index === 3 ? 'border-l-[#18a7d0]' : index === 4 ? 'border-l-[#8835a7]' : 'border-l-[#f07c1a]')}>
                      <CardContent className="p-4">
                        <p className="text-[32px] font-black leading-none text-slate-900">{formatNumber(item.enquiries)}</p>
                        <p className="mt-2 text-[15px] font-black text-slate-800">{item.source}</p>
                        <p className="mt-1 text-[13px] font-medium text-slate-500">{formatPercent(item.sharePct)} · Drill →</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
            </ChartCard>

            <ChartCard title="Dealer × Source Heatmap" subtitle="Dealer level source mix for the selected month">
              {pagedHeatmapRows.length ? (
                <>
                  <div className="overflow-hidden rounded-[1.5rem] border border-[#e0e7ef]">
                    <Table className="[&_td]:text-[11px] [&_td]:font-medium [&_th]:text-[10px]">
                      <TableHeader>
                        <TableRow className="border-b border-[#edf2f7] bg-white hover:bg-white">
                          <TableHead className="text-[10px] font-black text-slate-500">Dealer</TableHead>
                          {(summary?.sources.items || []).map((item) => (
                            <TableHead key={item.source} className="text-[10px] font-black text-slate-500">{item.source}</TableHead>
                          ))}
                          <TableHead className="text-[10px] font-black text-slate-500">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedHeatmapRows.map((dealer) => (
                          <TableRow key={dealer.dealer} className="bg-white">
                            <TableCell className="font-black text-[#c5162f]">{dealer.dealer}</TableCell>
                            {dealer.values.map((value) => (
                              <TableCell key={`${dealer.dealer}-${value.source}`}>
                                <div className="rounded-xl bg-[#f9ecf0] px-3 py-2 text-center font-black text-[#c5162f]">
                                  {formatNumber(value.enquiries)}
                                </div>
                              </TableCell>
                            ))}
                            <TableCell className="font-black text-[#c5162f]">
                              {formatNumber(dealer.values.reduce((sum, item) => sum + item.enquiries, 0))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <TablePagination
                    page={heatmapPage}
                    totalPages={heatmapTotalPages}
                    onPrevious={() => setHeatmapPage((current) => Math.max(1, current - 1))}
                    onNext={() => setHeatmapPage((current) => Math.min(heatmapTotalPages, current + 1))}
                  />
                </>
              ) : (
                <EmptyState title="No matrix available" body="Dealer-source matrix will appear once month coverage is available." />
              )}
            </ChartCard>
          </TabsContent>

          <TabsContent value="team" className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[16px] font-semibold text-slate-400">Filter by dealership:</span>
              <Button
                type="button"
                variant={!selectedDealerCode ? 'default' : 'outline'}
                className="rounded-full px-5 text-[13px] font-black"
                onClick={() => {
                  setSelectedDealerCode(null)
                  setTeamPage(1)
                  setHeatmapPage(1)
                  setRetailPage(1)
                  setLostPage(1)
                }}
              >
                🏢 All
              </Button>
              {(freshness?.dealerOptions || []).map((dealerCode) => (
                <Button
                  key={dealerCode}
                  type="button"
                  variant={selectedDealerCode === dealerCode ? 'default' : 'outline'}
                  className="rounded-full px-5 text-[13px] font-black"
                  onClick={() => {
                    setSelectedDealerCode(dealerCode)
                    setTeamPage(1)
                    setHeatmapPage(1)
                    setRetailPage(1)
                    setLostPage(1)
                  }}
                >
                  {dealerCode}
                </Button>
              ))}
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
              <ChartCard title={`Top Consultants — ${activePeriodLabel}`} subtitle="All dealerships combined">
                {renderBarChart({
                  data: summary?.team.comparison || [],
                  xKey: 'consultant',
                  bars: [
                    { key: 'enquiries', label: 'Enquiries', color: CHART_COLORS[0] },
                    { key: 'bookings', label: 'Bookings', color: CHART_COLORS[1] },
                  ],
                  height: 360,
                })}
              </ChartCard>
              <ChartCard title="Leaderboard" subtitle="Booking leaders ranked by output" titleIcon={<Trophy className="h-4 w-4 text-amber-500" />}>
                {topConsultantList.length ? (
                  <div className="space-y-3">
                    {topConsultantList.map((item, index) => (
                      <div key={item.consultant} className="flex items-center justify-between gap-3 border-b border-[#eef2f7] pb-3 last:border-b-0">
                        <div className="flex items-center gap-3">
                          <span className={cn(
                            'flex h-11 w-11 items-center justify-center rounded-full text-sm font-black text-white',
                            index === 0 ? 'bg-[#ffca1c] text-[#8f5a00]' : index === 1 ? 'bg-[#c9c9ce]' : index === 2 ? 'bg-[#de9034]' : 'bg-[#c5162f]',
                          )}>
                            {index < 3 ? `${index + 1}` : `#${index + 1}`}
                          </span>
                          <div>
                            <p className="text-[15px] font-black text-slate-900">{item.consultant}</p>
                            <p className="text-sm font-medium text-slate-500">{formatNumber(item.enquiries)} enquiries</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="rounded-full bg-[#eef2f7] px-4 py-1 text-sm font-black text-slate-800">{formatNumber(item.bookings)} bkgs</span>
                          <p className="mt-1 text-sm font-medium text-slate-400">{formatPercent(item.bookingRatePct)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No consultant metrics" body="Consultant slices will appear when month data is available." />
                )}
              </ChartCard>
            </div>

            <ChartCard title={`Consultant Performance Report — ${activePeriodLabel}`} subtitle="Enquiry → Test Drive → Booking conversion · Walk-in breakdown">
              {pagedTeamRows.length ? (
                <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
                  <Table className="[&_td]:text-[11px] [&_td]:font-medium [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow className="border-b-2 border-[#071a2b] bg-white hover:bg-white">
                        {['Consultant', 'Enquiries', 'Test Drives', 'TD Ratio', 'Bookings', 'Conv. Rate', 'Walk-ins', 'WI Bkgs', 'WI Conv.'].map((label) => (
                          <TableHead key={label} className="text-[10px] font-black text-[#071a2b]">{label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedTeamRows.map((item) => (
                        <TableRow key={item.consultant} className="odd:bg-white even:bg-[#fbfdff]">
                          <TableCell className="font-black text-slate-950">{item.consultant}</TableCell>
                          <TableCell>{formatNumber(item.enquiries)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 rounded-full bg-[#eef2f7]">
                                <div className="h-1.5 rounded-full bg-[#8835a7]" style={{ width: `${Math.min(100, item.enquiries > 0 ? (item.testDrives / item.enquiries) * 100 : 0)}%` }} />
                              </div>
                              <span className="font-black text-[#8835a7]">{formatNumber(item.testDrives)}</span>
                            </div>
                          </TableCell>
                          <TableCell><span className="rounded-full bg-[#edf8f0] px-3 py-1 text-[12px] font-black text-[#0f8d63]">{formatPercent(item.tdRatePct)}</span></TableCell>
                          <TableCell className="font-black text-[#10b981]">{formatNumber(item.bookings)}</TableCell>
                          <TableCell><span className="rounded-full bg-[#fff4e8] px-3 py-1 text-[12px] font-black text-[#c96e11]">{formatPercent(item.bookingRatePct)}</span></TableCell>
                          <TableCell><span className="rounded-full bg-[#edf8f0] px-3 py-1 text-[12px] font-black text-[#269442]">{formatNumber(item.walkinEnquiries)}</span></TableCell>
                          <TableCell className="font-black text-[#269442]">{formatNumber(item.walkinBookings)}</TableCell>
                          <TableCell><span className="rounded-full px-3 py-1 text-[12px] font-black" style={{ backgroundColor: item.walkinConversionPct >= 30 ? '#edf8f0' : item.walkinConversionPct >= 15 ? '#fff4e8' : '#fdecee', color: item.walkinConversionPct >= 30 ? '#0f8d63' : item.walkinConversionPct >= 15 ? '#c96e11' : '#d90416' }}>{formatPercent(item.walkinConversionPct)}</span></TableCell>
                        </TableRow>
                      ))}
                      {teamGrandTotal && (
                        <TableRow style={{ backgroundColor: '#dbeafe' }} className="border-t-2 border-[#071a2b] font-black [&_td]:font-black hover:!bg-[#c7d2fe]">
                          <TableCell className="font-black text-[#071a2b]">{teamGrandTotal.consultant}</TableCell>
                          <TableCell className="text-[11px] font-black text-slate-900">{formatNumber(teamGrandTotal.enquiries)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 rounded-full bg-[#eef2f7]">
                                <div className="h-1.5 rounded-full bg-[#8835a7]" style={{ width: `${Math.min(100, teamGrandTotal.enquiries > 0 ? (teamGrandTotal.testDrives / teamGrandTotal.enquiries) * 100 : 0)}%` }} />
                              </div>
                              <span className="font-black text-[#8835a7]">{formatNumber(teamGrandTotal.testDrives)}</span>
                            </div>
                          </TableCell>
                          <TableCell><span className="rounded-full bg-[#edf8f0] px-3 py-1 text-[12px] font-black text-[#0f8d63]">{formatPercent(teamGrandTotal.tdRatePct)}</span></TableCell>
                          <TableCell className="font-black text-[#10b981]">{formatNumber(teamGrandTotal.bookings)}</TableCell>
                          <TableCell><span className="rounded-full bg-[#fff4e8] px-3 py-1 text-[12px] font-black text-[#c96e11]">{formatPercent(teamGrandTotal.bookingRatePct)}</span></TableCell>
                          <TableCell><span className="rounded-full bg-[#edf8f0] px-3 py-1 text-[12px] font-black text-[#269442]">{formatNumber(teamGrandTotal.walkinEnquiries)}</span></TableCell>
                          <TableCell className="font-black text-[#269442]">{formatNumber(teamGrandTotal.walkinBookings)}</TableCell>
                          <TableCell><span className="rounded-full px-3 py-1 text-[12px] font-black" style={{ backgroundColor: teamGrandTotal.walkinConversionPct >= 30 ? '#edf8f0' : teamGrandTotal.walkinConversionPct >= 15 ? '#fff4e8' : '#fdecee', color: teamGrandTotal.walkinConversionPct >= 30 ? '#0f8d63' : teamGrandTotal.walkinConversionPct >= 15 ? '#c96e11' : '#d90416' }}>{formatPercent(teamGrandTotal.walkinConversionPct)}</span></TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No consultant rows" body="Consultant leaderboard data is not available for this month." />
              )}
            </ChartCard>
          </TabsContent>

          <TabsContent value="testdrives" className="space-y-5">
            <ChartCard
              title="Test Drives by Model"
              subtitle={`Completed test drives per model · ${testDrivesTotal.toLocaleString('en-IN')} total`}
            >
              {renderBarChart({
                data: testDrivesByModel,
                xKey: 'model',
                bars: [{ key: 'testDrives', label: 'Test Drives', color: CHART_COLORS[3] }],
                height: 320,
              })}
            </ChartCard>

            <ChartCard
              title="Model & Variant Test Drive Count"
              subtitle={`Completed test drives per model and variant · ${testDrivesTotal.toLocaleString('en-IN')} total`}
            >
              {testDrivesByModelVariant.length ? (
                <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
                  <Table className="[&_td]:text-[11px] [&_td]:font-medium [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow className="border-b-2 border-[#071a2b] bg-white hover:bg-white">
                        {['#', 'Model', 'Variant', 'Test Drives', 'Share'].map((label) => (
                          <TableHead key={label} className="text-[10px] font-black text-[#071a2b]">{label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {testDrivesByModelVariant.map((item, index) => {
                        const sharePct = testDrivesTotal > 0 ? (item.testDrives / testDrivesTotal) * 100 : 0
                        return (
                          <TableRow key={`${item.model}-${item.variant}`} className="odd:bg-white even:bg-[#fbfdff]">
                            <TableCell className="text-[11px] font-black text-slate-400">{index + 1}</TableCell>
                            <TableCell className="font-black text-slate-950">{item.model}</TableCell>
                            <TableCell className="text-slate-700">{item.variant}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 rounded-full bg-[#eef2f7]">
                                  <div className="h-1.5 rounded-full bg-[#8835a7]" style={{ width: `${Math.min(100, sharePct)}%` }} />
                                </div>
                                <span className="font-black text-[#8835a7]">{item.testDrives.toLocaleString('en-IN')}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="rounded-full bg-[#edf8f0] px-3 py-1 text-[12px] font-black text-[#0f8d63]">
                                {sharePct.toFixed(1)}%
                              </span>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      <TableRow style={{ backgroundColor: '#dbeafe' }} className="border-t-2 border-[#071a2b] font-black [&_td]:font-black hover:!bg-[#c7d2fe]">
                        <TableCell className="font-black text-[#071a2b]" colSpan={3}>Total</TableCell>
                        <TableCell className="font-black text-[#071a2b]">{testDrivesTotal.toLocaleString('en-IN')}</TableCell>
                        <TableCell><span className="rounded-full bg-[#edf8f0] px-3 py-1 text-[12px] font-black text-[#0f8d63]">100%</span></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No test drive data" body="Model and variant breakdown will appear when test drive records are available for this period." />
              )}
            </ChartCard>

            <ChartCard title="Test Drive Records" subtitle="Every completed test drive with customer, model, variant and consultant — filterable">
              <div className="grid gap-3 xl:grid-cols-5">
                <div className="relative xl:col-span-2">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={tdSearch}
                    onChange={(event) => { setTdSearch(event.target.value); setTdPage(1) }}
                    placeholder="Search test drives..."
                    className="rounded-2xl pl-10"
                  />
                </div>
                <Select value={tdSource} onValueChange={(value) => { setTdSource(value); setTdPage(1) }}>
                  <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Source" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    {metricOptions.source.map((item, index) => <SelectItem key={`${item}-${index}`} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={tdModel} onValueChange={(value) => { setTdModel(value); setTdPage(1) }}>
                  <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Model" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All models</SelectItem>
                    {metricOptions.model.map((item, index) => <SelectItem key={`${item}-${index}`} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={tdConsultant} onValueChange={(value) => { setTdConsultant(value); setTdPage(1) }}>
                  <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Consultant" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All consultants</SelectItem>
                    {metricOptions.consultant.map((item, index) => <SelectItem key={`${item}-${index}`} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-700">
                  {(testDriveQuery.data?.pagination.totalRows || 0).toLocaleString('en-IN')} test drives
                </Badge>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Page Size</span>
                  <Select value={String(tdPageSize)} onValueChange={(value) => { setTdPageSize(Number(value)); setTdPage(1) }}>
                    <SelectTrigger className="w-24 rounded-2xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{[25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              {testDriveQuery.isLoading ? (
                <div className="flex h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-action-bg)]" /></div>
              ) : testDriveQuery.error ? (
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">
                  {testDriveQuery.error instanceof Error ? testDriveQuery.error.message : 'Unable to load test drives'}
                </div>
              ) : testDriveQuery.data && testDriveQuery.data.rows.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-slate-200">
                  <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow className="border-b border-white/10 bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-bg)]">
                        {tdVisibleColumns.map((column) => (
                          <TableHead key={column} className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-fg)]">
                            {toColumnLabel(column)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {testDriveQuery.data.rows.map((row, rowIndex) => (
                        <TableRow key={`td-${rowIndex}`} className="odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)]">
                          {tdVisibleColumns.map((column) => (
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
                <EmptyState title="No test drives" body="No completed test drives for the selected period and filters." />
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-500">
                  Page {testDriveQuery.data?.pagination.page || 1} of {testDriveQuery.data?.pagination.totalPages || 1}
                </p>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" className="app-outline-action rounded-2xl px-4" disabled={(testDriveQuery.data?.pagination.page || 1) <= 1} onClick={() => setTdPage((current) => Math.max(1, current - 1))}>Previous</Button>
                  <Button type="button" variant="outline" className="app-outline-action rounded-2xl px-4" disabled={(testDriveQuery.data?.pagination.page || 1) >= (testDriveQuery.data?.pagination.totalPages || 1)} onClick={() => setTdPage((current) => current + 1)}>Next</Button>
                </div>
              </div>
            </ChartCard>
          </TabsContent>

          <TabsContent value="trend" className="space-y-5">
            <ChartCard
              title={`Daily Enquiry Trend — ${activePeriodLabel}`}
              subtitle={summary?.trend.trendNote || 'Day-by-day enquiry build for the selected month'}
              action={(
                <Select value={selectedDealerCode || 'all'} onValueChange={(value) => setSelectedDealerCode(value === 'all' ? null : value)}>
                  <SelectTrigger className="w-[190px] rounded-[1rem] border-[#d5dfea] bg-white shadow-sm">
                    <SelectValue placeholder="All dealers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Dealers</SelectItem>
                    {(freshness?.dealerOptions || []).map((dealerCode) => (
                      <SelectItem key={dealerCode} value={dealerCode}>{dealerCode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            >
              {renderAreaChart(summary?.trend.daily || [], 'day', 'enquiries', CHART_COLORS[1])}
            </ChartCard>

            <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
              {(summary?.trend.weeks || []).map((item, index) => (
                <WeekStatCard
                  key={item.week}
                  title={item.week}
                  dates={item.dates}
                  total={formatNumber(item.total)}
                  average={item.avg.toFixed(0)}
                  peak={item.peak}
                  accent={index === 0 ? 'bg-[#c5162f]' : index === 1 ? 'bg-[#071a2b]' : index === 2 ? 'bg-[#269442]' : 'bg-[#f07c1a]'}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="lost" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-2">
              <ChartCard title="Lowest Bookings" subtitle="Across all dealerships · min 5 enquiries">
                {lowestBookingsList.length ? (
                  <div className="space-y-5 pt-2">
                    {lowestBookingsList.map((item) => (
                      <div key={item.consultant} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[20px] font-black uppercase text-slate-900">{item.consultant}</p>
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-slate-400">{formatNumber(item.enquiries)} enq</span>
                            <span className="rounded-full bg-[#fdecee] px-3 py-1 font-black text-[#d90416]">{formatNumber(item.bookings)} bkgs</span>
                            <span className="rounded-full px-3 py-1 font-black" style={{ backgroundColor: item.bookingRatePct >= 15 ? '#edf8f0' : item.bookingRatePct >= 10 ? '#fff4e8' : '#fdecee', color: item.bookingRatePct >= 15 ? '#0f8d63' : item.bookingRatePct >= 10 ? '#c96e11' : '#d90416' }}>
                              {formatPercent(item.bookingRatePct)}
                            </span>
                          </div>
                        </div>
                        <div className="h-2.5 rounded-full bg-[#eef2f7]">
                          <div className="h-2.5 rounded-full bg-[#ebb4bf]" style={{ width: `${Math.min(100, item.enquiries)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No consultant rows" body="Low-booking consultant signals will appear once enough enquiries are available." />
                )}
              </ChartCard>

              <ChartCard title="High Enquiries, Low Conversion" subtitle="Across all dealerships · volume there, bookings not">
                {highEnquiryLowConversionList.length ? (
                  <div className="space-y-5 pt-2">
                    {highEnquiryLowConversionList.map((item) => (
                      <div key={item.consultant} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[20px] font-black uppercase text-slate-900">{item.consultant}</p>
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="rounded-full bg-[#fdecee] px-3 py-1 font-black text-[#c5162f]">{formatNumber(item.enquiries)} enq</span>
                            <span className="rounded-full bg-[#fff4e8] px-3 py-1 font-black text-[#d16d0f]">{formatNumber(item.bookings)} bkgs</span>
                            <span className="rounded-full bg-[#fdecee] px-3 py-1 font-black text-[#d90416]">{formatPercent(item.bookingRatePct)}</span>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <div className="h-2.5 rounded-full bg-[#eef2f7]">
                            <div className="h-2.5 rounded-full bg-[#e4b8c4]" style={{ width: '100%' }} />
                          </div>
                          <div className="h-2.5 rounded-full bg-[#eef2f7]">
                            <div className="h-2.5 rounded-full bg-[#f07c1a]" style={{ width: `${Math.min(100, item.bookingRatePct * 3)}%` }} />
                          </div>
                        </div>
                        <div className="flex gap-5 text-sm font-medium text-slate-500">
                          <span className="flex items-center gap-2"><span className="h-3 w-3 bg-[#e4b8c4]" />Enquiries</span>
                          <span className="flex items-center gap-2"><span className="h-3 w-3 bg-[#f07c1a]" />Booked</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No low-conversion rows" body="Consultant conversion alerts will appear once enough enquiry volume is available." />
                )}
              </ChartCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <ChartCard title="Lost By Reason" subtitle="Primary lost reasons this month">
                {renderBarChart({
                  data: summary?.lost.reasons || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Cases', color: CHART_COLORS[0] }],
                })}
              </ChartCard>
              <ChartCard
                title="Lost By Source"
                subtitle="Lead source quality signal"
                action={(
                  <Button type="button" className="rounded-full border border-[#d5dfea] bg-white px-4 font-black text-slate-700 hover:text-[#c5162f]" onClick={() => setLostDialogOpen(true)}>
                    <Search className="h-4 w-4" />
                    View cases
                  </Button>
                )}
              >
                {renderBarChart({
                  data: summary?.lost.sources || [],
                  xKey: 'name',
                  bars: [{ key: 'value', label: 'Cases', color: CHART_COLORS[4] }],
                })}
              </ChartCard>
            </div>
          </TabsContent>

          <TabsContent value="retail" className="space-y-5">
            <Card className="overflow-hidden rounded-[2rem] border border-[#1a2633] bg-[#162737] text-white shadow-[0_20px_46px_rgba(7,26,43,0.24)]">
              <div className="relative overflow-hidden p-6">
                <div className="absolute right-[-70px] top-[-70px] h-60 w-60 rounded-full bg-[#2d2d3f]/80" />
                <p className="relative text-[11px] font-black uppercase tracking-[0.28em] text-[#ff4264]">Retail Report</p>
                <h2 className="relative mt-3 text-[34px] font-black uppercase tracking-[0.04em] text-white">
                  Vehicles Retailed — {activePeriodLabel}
                </h2>
                <p className="relative mt-3 text-[15px] font-medium text-slate-300">
                  {selectedDealerCode || 'JK402'} · Invoice confirmed retail deliveries
                </p>
                <div className="relative mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
                  {(summary?.retail.kpis || []).map((item, index) => (
                    <div key={item.label}>
                      <p className={cn('text-[38px] font-black leading-none', index === 0 ? 'text-[#d71933]' : index === 1 ? 'text-[#1aa5d1]' : index === 2 ? 'text-[#ff8f2a]' : index === 3 ? 'text-[#17d39b]' : 'text-[#f9c500]')}>{item.formattedValue}</p>
                      <p className="mt-3 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <div className="grid gap-5 xl:grid-cols-3">
              <ChartCard title="By Model" subtitle="Retail concentration by model">
                {(retailByModel || []).length ? (
                  <div className="space-y-5 pt-2">
                    {retailByModel.slice(0, 6).map((item) => (
                      <ProgressMetricRow key={item.name} label={item.name} value={formatNumber(item.value)} trailing={`${formatPercent(item.sharePct)}`} percent={item.sharePct} color={getModelAccent(item.name).hex} />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No retail model mix" body="Retail model breakdown will appear when retail rows are available." />
                )}
              </ChartCard>
              <ChartCard title="By Source" subtitle="Retail contribution by source">
                {(retailBySource || []).length ? (
                  <div className="space-y-5 pt-2">
                    {retailBySource.slice(0, 6).map((item, index) => (
                      <ProgressMetricRow key={item.name} label={item.name} value={formatNumber(item.value)} trailing={`${formatPercent(item.sharePct)}`} percent={item.sharePct} color={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No retail source mix" body="Retail source breakdown will appear when retail rows are available." />
                )}
              </ChartCard>
              <ChartCard title="By Consultant" subtitle="Retail contribution by consultant">
                {(retailByConsultant || []).length ? (
                  <div className="space-y-5 pt-2">
                    {retailByConsultant.slice(0, 10).map((item) => (
                      <ProgressMetricRow key={item.name} label={item.name} value={formatNumber(item.value)} trailing={`${formatPercent(item.sharePct)}`} percent={item.sharePct} color="#db7f93" />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No retail consultant mix" body="Retail consultant breakdown will appear when retail rows are available." />
                )}
              </ChartCard>
            </div>

            <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-4">
              {(summary?.retail.modelCards || []).slice(0, 4).map((item) => (
                <ModelStoryCard key={item.model} item={item} />
              ))}
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <ChartCard title="All Vehicles" subtitle={`${formatNumber(filteredRetailRows.length)} retail rows`}>
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={retailSearch} onChange={(event) => {
                      setRetailSearch(event.target.value)
                      setRetailPage(1)
                    }} placeholder="Search customer, VIN, consultant, financier..." className="rounded-full border-[#d5dfea] pl-10 text-[13px]" />
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-600">
                    {formatNumber(filteredRetailRows.length)} transactions
                  </div>
                </div>
                {pagedRetailRows.length ? (
                  <>
                  <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
                    <Table className="[&_td]:text-[11px] [&_td]:font-medium [&_th]:text-[10px]">
                      <TableHeader>
                        <TableRow className="border-b-2 border-[#071a2b] bg-white hover:bg-white">
                          {['Invoice', 'Delivery', 'Customer', 'Phone', 'Model', 'Variant', 'Color', 'Consultant', 'Source', 'Finance', 'Ex-Showroom', 'Accessories'].map((label) => (
                            <TableHead key={label} className="text-[10px] font-black text-[#25303b]">{label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedRetailRows.map((row) => (
                          <TableRow key={row.rowKey} className="odd:bg-[#f6f9fd] even:bg-white">
                            <TableCell>{formatDate(row.invoiceDate)}</TableCell>
                            <TableCell>{formatDate(row.deliveryDate)}</TableCell>
                            <TableCell className="font-black text-slate-950">{row.customerName}</TableCell>
                            <TableCell>{row.phone || 'NA'}</TableCell>
                            <TableCell><span className={cn('rounded-full px-3 py-1 text-[12px] font-black', getModelAccent(row.model).pill)}>{row.model}</span></TableCell>
                            <TableCell>{row.variant || 'NA'}</TableCell>
                            <TableCell>{row.color || 'NA'}</TableCell>
                            <TableCell>{row.consultant}</TableCell>
                            <TableCell>{row.source}</TableCell>
                            <TableCell>{row.financeType}</TableCell>
                            <TableCell>{formatCurrency(row.exShowroomPrice)}</TableCell>
                            <TableCell>{formatCurrency(row.accessoriesValue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <TablePagination
                    page={retailPage}
                    totalPages={retailTotalPages}
                    onPrevious={() => setRetailPage((current) => Math.max(1, current - 1))}
                    onNext={() => setRetailPage((current) => Math.min(retailTotalPages, current + 1))}
                  />
                  </>
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

            <ChartCard title="Consultant-wise Accessories Sales" subtitle="Accessories performance matched and attributed to sales consultants">
              {(summary?.retail.consultantAccessories || []).length ? (
                <div className="overflow-hidden rounded-[1.5rem] border border-slate-200">
                  <Table className="[&_td]:text-[13px] [&_td]:font-medium [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow className="border-b-2 border-[#071a2b] bg-white hover:bg-white">
                        {['Sales Consultant', 'Total Accessories Sold', 'Total Accessories Revenue', 'Number of Customers', 'Avg Revenue per Customer'].map((label) => (
                          <TableHead key={label} className="text-[10px] font-black text-[#25303b]">{label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(summary?.retail.consultantAccessories || []).map((row) => (
                        <TableRow key={row.consultant} className="odd:bg-[#f6f9fd] even:bg-white">
                          <TableCell className="font-black text-slate-950">{row.consultant}</TableCell>
                          <TableCell>{formatNumber(row.totalSold)}</TableCell>
                          <TableCell className="font-bold text-slate-800">{formatCurrency(row.totalRevenue)}</TableCell>
                          <TableCell>{formatNumber(row.customerCount)}</TableCell>
                          <TableCell className="text-slate-600">{formatCurrency(row.avgRevenuePerCustomer)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No accessories performance data" body="No matched accessories sales found for the selected filters." />
              )}
            </ChartCard>
          </TabsContent>

          <TabsContent value="reports" className="space-y-5">
            <Tabs value={activeReport} onValueChange={(value) => {
              setActiveReport(value as ReportKey)
              setReportPage(1)
              setReportSort('')
              setReportDirection('desc')
            }} className="space-y-4">
              <TabsList className="flex h-auto flex-wrap justify-start gap-2 rounded-[2rem] border border-[#d5dfea] bg-white p-2 shadow-sm">
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
                  <Button type="button" variant="outline" className="rounded-full border-[#d5dfea] bg-white px-4 text-[13px] font-black text-slate-700 hover:text-[#071a2b]" onClick={resetReportFilters}>
                    <Filter className="h-4 w-4" />
                    Clear
                  </Button>
                  <Button type="button" variant="outline" className="rounded-full border-[#d5dfea] bg-white px-4 text-[13px] font-black text-slate-700 hover:text-[#071a2b]" onClick={() => {
                    setExpandedReportColumns((current) => ({ ...current, [activeReport]: !current[activeReport] }))
                  }}>
                    {expandedReportColumns[activeReport] ? 'Default columns' : 'Show all columns'}
                  </Button>
                  <Button type="button" className="rounded-full border border-[#071a2b] bg-[#071a2b] px-4 text-[13px] font-black text-white hover:bg-[#071a2b]/95" onClick={() => { void handleCsvExport() }} disabled={reportQuery.isFetching}>
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
                    className="rounded-full border-[#d5dfea] pl-10 text-[13px]"
                  />
                </div>
                <Select value={reportSource} onValueChange={(value) => {
                  setReportSource(value)
                  setReportPage(1)
                }}>
                  <SelectTrigger className="rounded-full border-[#d5dfea] bg-white shadow-sm">
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
                  <SelectTrigger className="rounded-full border-[#d5dfea] bg-white shadow-sm">
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
                  <SelectTrigger className="rounded-full border-[#d5dfea] bg-white shadow-sm">
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
                  <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-700">
                    {SALES_REPORT_TABLE_PAGE_SIZE} rows / page
                  </Badge>
                  {activeReport === 'enquiry' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMissedFollowupsOnly((prev) => !prev)
                        setReportPage(1)
                      }}
                      className={cn(
                        "h-8 rounded-full text-[11px] font-bold px-3 transition-all cursor-pointer",
                        missedFollowupsOnly
                          ? "bg-[#c5162f] text-white border-[#c5162f] hover:bg-[#c5162f]/90 hover:text-white"
                          : "border-rose-200 text-[#c5162f] bg-rose-50/50 hover:bg-rose-50 hover:text-rose-800"
                      )}
                    >
                      <Clock className="mr-1.5 h-3.5 w-3.5" />
                      Missed Follow-Ups
                    </Button>
                  )}
                </div>
              </div>

              {reportSkeletonVisible ? (
                <div className="mt-4">
                  <TableSkeleton columns={Math.max(visibleColumns.length, 8)} />
                </div>
              ) : reportQuery.error ? (
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">
                  {reportQuery.error instanceof Error ? reportQuery.error.message : 'Unable to load report'}
                </div>
              ) : reportQuery.data ? (
                <div className={cn(
                  "mt-4 overflow-hidden rounded-[1.5rem] border border-[#d8e2ec] transition-opacity duration-200",
                  reportRefetching && "opacity-50 pointer-events-none"
                )}>
                    <Table className="[&_td]:text-[11px] [&_td]:font-medium [&_th]:text-[10px]">
                    <TableHeader>
                      <TableRow className="border-b-2 border-[#071a2b] bg-transparent hover:bg-transparent">
                        {visibleColumns.map((column) => (
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
                                setReportPage(1)
                              }}
                              onSort={(direction) => {
                                setReportSort(column)
                                setReportDirection(direction)
                                setReportPage(1)
                              }}
                              isSortedAsc={reportSort === column && reportDirection === 'asc'}
                              isSortedDesc={reportSort === column && reportDirection === 'desc'}
                            />
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportQuery.data.rows.map((row, rowIndex) => (
                        <TableRow key={`${activeReport}-${rowIndex}`} className="odd:bg-[#f6f9fd] even:bg-white">
                          {visibleColumns.map((column) => (
                            <TableCell key={`${rowIndex}-${column}`} className="max-w-[240px] truncate text-[11px] font-medium text-slate-700" title={String(row[column] ?? '')}>
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

              <TablePagination
                page={reportQuery.data?.pagination.page || 1}
                totalPages={reportQuery.data?.pagination.totalPages || 1}
                onPrevious={() => setReportPage((current) => Math.max(1, current - 1))}
                onNext={() => setReportPage((current) => Math.min(reportQuery.data?.pagination.totalPages || 1, current + 1))}
              />
            </ChartCard>
          </TabsContent>
            </>
          )}
        </Tabs>
      </div>

      <Dialog open={lostDialogOpen} onOpenChange={setLostDialogOpen}>
        <DialogContent className="max-w-[96vw] w-[96vw] md:max-w-[96vw] rounded-[2rem] border border-slate-200 p-0">
          <DialogHeader className="rounded-t-[2rem] border-b border-[#122130] bg-[#071a2b] px-6 py-5 text-white">
            <DialogTitle className="text-[24px] font-black">Lost Cases</DialogTitle>
            <DialogDescription className="text-white/75">
              Search lost enquiries by customer, model, source, consultant, or reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={lostSearch} onChange={(event) => {
                setLostSearch(event.target.value)
                setLostPage(1)
              }} placeholder="Search lost rows..." className="rounded-full border-[#d5dfea] pl-10 text-[13px]" />
            </div>

            {pagedLostRows.length ? (
              <div className="max-h-[70vh] overflow-auto rounded-[1.5rem] border border-slate-200">
                <Table className="[&_td]:text-[11px] [&_td]:font-medium [&_th]:text-[10px]">
                  <TableHeader>
                    <TableRow className="sticky top-0 border-b-2 border-[#071a2b] bg-white hover:bg-white">
                      {['Enquiry Date', 'Customer', 'Phone', 'Model', 'Source', 'Consultant', 'Status', 'Reason', 'Lost Due To', 'Remark'].map((label) => (
                        <TableHead key={label} className="text-[10px] font-black text-[#25303b]">{label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedLostRows.map((row, index) => (
                      <TableRow key={`${row.customer}-${row.phone}-${index}`} className="odd:bg-[#f6f9fd] even:bg-white">
                        <TableCell>{row.enquiryDate || 'NA'}</TableCell>
                        <TableCell className="font-black text-slate-950">{row.customer}</TableCell>
                        <TableCell>{row.phone || 'NA'}</TableCell>
                        <TableCell>{row.model || 'NA'}</TableCell>
                        <TableCell>{row.source || 'NA'}</TableCell>
                        <TableCell>{row.consultant || 'NA'}</TableCell>
                        <TableCell>{row.status || 'NA'}</TableCell>
                        <TableCell>{row.lostReason || 'NA'}</TableCell>
                        <TableCell>{row.lostDueTo || 'NA'}</TableCell>
                        <TableCell className="max-w-[320px] whitespace-normal text-[11px]">{row.lostRemark || 'NA'}</TableCell>
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
            "inline-flex items-center gap-1.5 text-left font-black tracking-wide transition rounded-md px-2 py-1 outline-none cursor-pointer select-none border-0",
            hasActiveFilter
              ? "text-white bg-rose-600 hover:bg-rose-700 shadow-sm"
              : "text-white bg-transparent hover:bg-white/12 focus:bg-white/15 focus:ring-1 focus:ring-white/20"
          )}
        >
          <span>{label}</span>
          <span className="flex items-center gap-0.5">
            {isSortedAsc && <ChevronDown className={cn("h-3 w-3 rotate-180", hasActiveFilter ? "text-white" : "text-rose-400")} />}
            {isSortedDesc && <ChevronDown className={cn("h-3 w-3", hasActiveFilter ? "text-white" : "text-rose-400")} />}
            {hasActiveFilter ? (
              <Filter className="h-3 w-3 fill-current text-white" />
            ) : (
              (!isSortedAsc && !isSortedDesc) && <ChevronDown className="h-3.5 w-3.5 text-white/55 opacity-70" />
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

