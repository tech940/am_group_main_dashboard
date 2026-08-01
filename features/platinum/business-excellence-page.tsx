'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { RevenueLeakagePanel } from '@/features/business-excellence/revenue-leakage-panel'
import { MainLayout } from '@/components/layout/main-layout'
import { formatBusinessFreshness, formatBusinessFreshnessShort } from '@/lib/business-excellence/freshness-format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  FileSpreadsheet,
  RefreshCw,
  Loader2,
  Activity,
  TrendingUp,
  IndianRupee,
  Users,
  Award,
  Sparkles,
  Table as TableIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  BarChart3,
  FileText,
  ShieldAlert,
  X,
  Maximize2,
  SlidersHorizontal,
  Crown,
  Wrench,
} from 'lucide-react'
import { BusinessExcellenceOverview } from '@/features/platinum/business-excellence-overview'
import { ExecutiveTableShell, type ExecutiveDashboardTableId } from '@/features/business-excellence/executive-table-shell'
import { OpenRoSection } from '@/features/platinum/open-ro-section'
import { KiaComplaintsSection } from '@/features/platinum/platinum-complaints-section'
import { PlatinumSotAnalysisSection } from '@/features/platinum/sot-analysis-section'
import { WorkshopSummarySection } from '@/features/platinum/workshop-summary-section'
import { ServiceDashboardPreviewSection } from '@/features/kia/service-dashboard-preview-section'
import { readPlatinumJson } from '@/features/platinum/api-client'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer as RechartsResponsiveContainer,
  ReferenceLine,
  Legend,
  AreaChart,
  Area,
  LabelList
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'
import { logApiTimings } from '@/lib/api/client-timing'
import {
  BUSINESS_DATE_PRESETS,
  BusinessDateFilterValue,
  BusinessDatePreset,
  appendBusinessComparisonParams,
  buildBusinessDateFilter,
  buildBusinessYearDateFilter,
  getBusinessAvailableYears,
  getBusinessYearRange,
  getEffectiveBusinessDateFilter,
  normalizeBusinessYear,
} from '@/lib/business-excellence/comparison'
import { EXECUTIVE_TARGETS } from '@/lib/business-excellence/executive-targets'
import {
  isMileageServiceTypeLabel,
  normalizeServiceTypeName,
  partitionServiceTypeRows,
} from '@/lib/business-excellence/workshop-classification'
import {
  DEFAULT_PLATINUM_DEALER_CODE as DEFAULT_KIA_DEALER_CODE,
  PLATINUM_ALL_LOCATIONS_CODE,
  PLATINUM_BRANCH_DEALERS as KIA_BRANCH_DEALERS,
  appendPlatinumDealerCodeParam as appendKiaDealerCodeParam,
  normalizePlatinumDealerSelection as normalizeKiaDealerCode,
} from '@/lib/platinum/dealer-branch'

function ResponsiveContainer(props: React.ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

interface StatRow {
  name: string
  isParent: boolean
  td: number
  cy: number
  ly: number | 'N/A'
  growth: string
  qtdCY: number
  qtdLY: number | 'N/A'
  qtdGrowth: string
  ytdCY: number
  ytdLY: number | 'N/A'
  ytdGrowth: string
  subRows: StatRow[]
}

type BusinessFreshnessResponse = {
  sourceUpdatedAt: string | null
  sources?: Array<{
    table: string
    label: string
    sourceUpdatedAt: string | null
    rowCount: number
  }>
}

function AnimatedMetric({
  value,
  formatter = (num: number) => Math.round(num).toLocaleString('en-IN'),
  className,
}: {
  value: number
  formatter?: (num: number) => string
  className?: string
}) {
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    let frame = 0
    const frameCount = 24
    const startValue = 0
    const delta = value - startValue
    const interval = window.setInterval(() => {
      frame += 1
      const progress = Math.min(frame / frameCount, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(startValue + delta * eased)
      if (progress >= 1) window.clearInterval(interval)
    }, 18)

    return () => window.clearInterval(interval)
  }, [value])

  return <span className={className}>{formatter(displayValue)}</span>
}

interface SavedSheetMetadata {
  id: string
  brand: string
  sheetName: string
  tableName?: string
  columns: string[]
  uploadedAt: string
  totalRows?: number
}

interface LoadedData {
  rows: Record<string, unknown>[]
  totalRows: number
}

interface LoadedRows {
  [sheetId: string]: LoadedData
}

type BusinessDateFilter = BusinessDateFilterValue | null

type AppliedBusinessDateFilter = NonNullable<BusinessDateFilter>

function AnalyticsDateRangePicker({
  title = 'Date Range',
  clearLabel = 'Clear range',
  startDate,
  endDate,
  onChange,
}: {
  title?: string
  clearLabel?: string
  startDate: string
  endDate: string
  onChange: (startDate: string, endDate: string) => void
}) {
  const initialViewDate = parseBusinessDate(startDate) || new Date()
  const [viewDate, setViewDate] = useState(() => new Date(initialViewDate.getFullYear(), initialViewDate.getMonth(), 1))
  const selectedStart = parseBusinessDate(startDate)
  const selectedEnd = parseBusinessDate(endDate)

  const monthLabel = viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const dayCells = useMemo(() => {
    const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
    const gridStart = new Date(monthStart)
    gridStart.setDate(monthStart.getDate() - monthStart.getDay())
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + index)
      return date
    })
  }, [viewDate])

  const selectDate = (date: Date) => {
    const selected = getInputDate(date)
    if (!selectedStart || selectedEnd || date < selectedStart) {
      onChange(selected, '')
      return
    }
    onChange(startDate, selected)
  }

  return (
    <div className="solid-calendar-surface rounded-[1.25rem] border border-[var(--dashboard-primary-border)] bg-white p-2.5 shadow-sm transition">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          className="app-outline-action flex h-9 w-9 items-center justify-center rounded-xl"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
          <p className="text-sm font-black text-slate-950 dark:text-white">{monthLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          className="app-outline-action flex h-9 w-9 items-center justify-center rounded-xl"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-black uppercase tracking-widest text-slate-400">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <div key={`${day}-${index}`} className="py-0.5">{day}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {dayCells.map((date) => {
          const dateValue = getInputDate(date)
          const inCurrentMonth = date.getMonth() === viewDate.getMonth()
          const isStart = dateValue === startDate
          const isEnd = dateValue === endDate
          const inRange = selectedStart && selectedEnd && date >= selectedStart && date <= selectedEnd
          return (
            <button
              key={dateValue}
              type="button"
              onClick={() => selectDate(date)}
              className={cn(
                'h-8 rounded-lg text-[11px] font-black transition',
                inCurrentMonth ? 'text-slate-700 dark:text-slate-100' : 'text-slate-300 dark:text-slate-600',
                inRange && 'bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-action-bg)]',
                (isStart || isEnd) && 'app-primary-action shadow-sm'
              )}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[11px] font-bold text-slate-600">
        <div className="flex items-center justify-between gap-3">
          <span>Start</span>
          <span className="font-black text-slate-950 dark:text-white">{startDate || 'Select date'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>End</span>
          <span className="font-black text-slate-950 dark:text-white">{endDate || 'Select date'}</span>
        </div>
        {(startDate || endDate) && (
          <button type="button" onClick={() => onChange('', '')} className="mt-1 text-left text-[11px] font-black text-rose-600">
            {clearLabel}
          </button>
        )}
      </div>
    </div>
  )
}

type BusinessAiSummary = {
  report: string
  summary: string
  structuredSummary?: {
    title: string
    executiveRead: string
    metricSignals: Array<{
      label: string
      value: string
      context: string
      tone?: 'good' | 'watch' | 'risk' | 'neutral'
    }>
    keyFindings: string[]
    risks: string[]
    actions: Array<{
      owner: string
      action: string
      priority?: 'High' | 'Medium' | 'Low'
    }>
  } | null
  model: string
  generatedAt: string
  dateRange: {
    startDate: string
    endDate: string
  }
}

const BUSINESS_EXCELLENCE_OVERVIEW_REPORT = 'Business Excellence Overview'
const EXECUTIVE_DASHBOARD_REPORT = 'Executive Dashboard'
const DEFAULT_BUSINESS_EXCELLENCE_SHEET = 'RO Billing Report'
const WORKSHOP_PERFORMANCE_REPORT = 'Workshop Performance'
const WORKSHOP_SUMMARY_REPORT = 'Workshop Summary'
const OPEN_RO_REPORT = 'Open RO (Repair Orders)'
const PLATINUM_COMPLAINTS_REPORT = 'Platinum Complaints'
const PLATINUM_SOT_REPORT = 'SOT Analysis'
const SERVICE_DASHBOARD_REPORT = 'Service Dashboard'
const REPORT_ROUTE_SLUGS: Record<string, string> = {
  [BUSINESS_EXCELLENCE_OVERVIEW_REPORT]: 'overview',
  [EXECUTIVE_DASHBOARD_REPORT]: 'executive-dashboard',
  [DEFAULT_BUSINESS_EXCELLENCE_SHEET]: 'ro-billing-report',
  [WORKSHOP_PERFORMANCE_REPORT]: 'workshop-performance',
  [WORKSHOP_SUMMARY_REPORT]: 'workshop-summary',
  [OPEN_RO_REPORT]: 'open-ro',
  [PLATINUM_COMPLAINTS_REPORT]: 'platinum-complaints',
  [PLATINUM_SOT_REPORT]: 'sot-analysis',
  [SERVICE_DASHBOARD_REPORT]: 'service-dashboard',
}
const REPORT_NAMES_BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(REPORT_ROUTE_SLUGS).map(([name, slug]) => [slug, name])
)
const BUSINESS_EXCELLENCE_REPORTS: SavedSheetMetadata[] = [
  {
    id: 'overview',
    brand: 'platinum',
    sheetName: BUSINESS_EXCELLENCE_OVERVIEW_REPORT,
    tableName: 'business_excellence_overview',
    columns: [],
    uploadedAt: new Date(0).toISOString(),
    totalRows: 0,
  },
  {
    id: 'executive-dashboard',
    brand: 'platinum',
    sheetName: EXECUTIVE_DASHBOARD_REPORT,
    tableName: 'am_platinum_ro_billing_report',
    columns: [],
    uploadedAt: new Date(0).toISOString(),
    totalRows: 0,
  },
  {
    id: 'ro-billing-report',
    brand: 'platinum',
    sheetName: DEFAULT_BUSINESS_EXCELLENCE_SHEET,
    tableName: 'am_platinum_ro_billing_report',
    columns: [],
    uploadedAt: new Date(0).toISOString(),
    totalRows: 0,
  },
  {
    id: 'workshop-performance',
    brand: 'platinum',
    sheetName: WORKSHOP_PERFORMANCE_REPORT,
    tableName: 'workshop_performance',
    columns: [],
    uploadedAt: new Date(0).toISOString(),
    totalRows: 0,
  },
  {
    id: 'workshop-summary',
    brand: 'platinum',
    sheetName: WORKSHOP_SUMMARY_REPORT,
    tableName: 'am_platinum_ro_billing_report',
    columns: [],
    uploadedAt: new Date(0).toISOString(),
    totalRows: 0,
  },
  {
    id: 'open-ro',
    brand: 'platinum',
    sheetName: OPEN_RO_REPORT,
    tableName: 'am_platinum_repair_order_list',
    columns: [],
    uploadedAt: new Date(0).toISOString(),
    totalRows: 0,
  },
  {
    id: 'platinum-complaints',
    brand: 'platinum',
    sheetName: PLATINUM_COMPLAINTS_REPORT,
    tableName: 'am_platinum_call_center_complaints',
    columns: [],
    uploadedAt: new Date(0).toISOString(),
    totalRows: 0,
  },
  {
    id: 'sot-analysis',
    brand: 'platinum',
    sheetName: PLATINUM_SOT_REPORT,
    tableName: 'am_platinum_trust_package',
    columns: [],
    uploadedAt: new Date(0).toISOString(),
    totalRows: 0,
  },
  {
    id: 'service-dashboard',
    brand: 'platinum',
    sheetName: SERVICE_DASHBOARD_REPORT,
    tableName: 'service_dashboard_export',
    columns: [],
    uploadedAt: new Date(0).toISOString(),
    totalRows: 0,
  },
]
const BUSINESS_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const PLATINUM_DATA_START_YEAR = 2021

function getPlatinumAvailableYears(today = new Date()) {
  return getBusinessAvailableYears(PLATINUM_DATA_START_YEAR, today)
}

function normalizePlatinumYear(value: string | number | null | undefined) {
  return normalizeBusinessYear(value, PLATINUM_DATA_START_YEAR)
}

function getPlatinumYearRange(year: number) {
  return getBusinessYearRange(year)
}

function buildPlatinumYearDateFilter(
  year: number,
  range = getPlatinumYearRange(year),
  customComparison?: Partial<{ startDate: string; endDate: string }>
): AppliedBusinessDateFilter {
  const start = parseBusinessDate(range.startDate)
  return {
    ...buildBusinessYearDateFilter(year, customComparison),
    startDate: range.startDate,
    endDate: range.endDate,
    month: start?.getMonth() ?? 0,
  }
}

function cleanAiText(value: string) {
  return value.replace(/\*\*/g, '').trim()
}

function aiToneClass(tone?: string) {
  if (tone === 'good') return 'border-emerald-100 bg-emerald-50 text-emerald-800'
  if (tone === 'risk') return 'border-rose-100 bg-rose-50 text-rose-800'
  if (tone === 'watch') return 'border-amber-100 bg-amber-50 text-amber-800'
  return 'border-slate-100 bg-slate-50 text-slate-800'
}

function priorityClass(priority?: string) {
  if (priority === 'High') return 'bg-rose-100 text-rose-700'
  if (priority === 'Low') return 'bg-slate-100 text-slate-600'
  return 'bg-amber-100 text-amber-700'
}

function normalizeSheetKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getRecordValue(row: Record<string, unknown>, snakeKey: string, legacyKey?: string) {
  return row[snakeKey] ?? (legacyKey ? row[legacyKey] : undefined)
}

function formatChartLabel(value: unknown) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return ''
  const abs = Math.abs(num)
  if (abs < 0.5) return '0'
  if (abs >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`
  if (abs >= 100000) return `${(num / 100000).toFixed(1)}L`
  if (abs >= 1000) return `${(num / 1000).toFixed(1)}K`
  return Math.round(num).toLocaleString('en-IN')
}

function formatChartNumber(value: unknown) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return '0'
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: Math.abs(num % 1) > 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

function getGrowthBadgeClass(value: number | string | 'N/A') {
  if (value === 'N/A') return 'text-slate-400 bg-white border-slate-200'
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 'text-slate-400 bg-white border-slate-200'
  return num >= 0
    ? 'text-emerald-700 bg-white border-emerald-200'
    : 'text-[lab(53_89.72_88.48)] bg-white border-[lab(53_89.72_88.48)]'
}

function isManagementTotalRowName(name: unknown) {
  const normalized = String(name || '').trim().toLowerCase()
  return normalized === 'mech' || normalized === 'mech total' || normalized === 'grand total'
}

function getManagementTotalRowClass(name: unknown) {
  return isManagementTotalRowName(name) ? 'be-management-total-row' : ''
}

function formatSignedGrowth(value: number | string | 'N/A') {
  if (value === 'N/A') return 'N/A'
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 'N/A'
  return `${num >= 0 ? '+' : '-'}${Math.abs(num).toFixed(1)}%`
}

function formatCurrency(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0
  const rounded = Math.round(Math.abs(safeValue))
  const sign = safeValue < 0 ? '-' : ''
  const currencyPrefix = '\u20b9'

  if (rounded >= 10000000) return `${sign}${currencyPrefix}${(rounded / 10000000).toFixed(2)}Cr`
  if (rounded >= 100000) return `${sign}${currencyPrefix}${(rounded / 100000).toFixed(2)}L`
  return `${sign}${currencyPrefix}${rounded.toLocaleString('en-IN')}`
}

function formatCompactBusinessDate(value?: string | null) {
  if (!value) return '-'
  const date = parseBusinessDate(value)
  if (!date) return value
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

type DealerCoverage = {
  dealerCode: string | null
  isAllLocations: boolean
  hasDataInRange: boolean
  rowCountInRange: number
  latestAvailableDate: string | null
  dateBasis: string
  sourceLabel: string
  emptyReason: string | null
}

type DealerCoverageBundle = {
  dealerCode: string | null
  isAllLocations: boolean
  primary?: DealerCoverage | null
  roBilling?: DealerCoverage | null
  openRo?: DealerCoverage | null
  complaints?: DealerCoverage | null
  sot?: DealerCoverage | null
}

function DealerCoverageNotice({ coverage }: { coverage?: DealerCoverage | null }) {
  if (!coverage || coverage.hasDataInRange || coverage.isAllLocations) return null

  const latest = coverage.latestAvailableDate ? formatCompactBusinessDate(coverage.latestAvailableDate) : null
  return (
    <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-900">
      No {coverage.sourceLabel} data for this dealer in the selected range.
      {latest ? ` Latest ${coverage.sourceLabel} data is ${latest}.` : ' No historical data found for this dealer.'}
    </div>
  )
}

// Freshness formatters are centralised (timezone-safe, IST) in
// '@/lib/business-excellence/freshness-format' — imported at the top of this file.

function SmartTrendValueLabel({
  x,
  y,
  value,
  index = 0,
  series = 'cy',
}: {
  x?: number | string
  y?: number | string
  value?: number | string
  index?: number
  total?: number
  series?: 'cy' | 'ly'
}) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null

  const xPos = Number(x || 0)
  const yPos = Number(y || 0) + (series === 'cy' ? (index % 2 === 0 ? -12 : -20) : (index % 2 === 0 ? 16 : 24))
  return (
    <text
      x={xPos}
      y={yPos}
      textAnchor="middle"
      fill={Math.abs(num) < 0.5 ? '#94a3b8' : series === 'cy' ? '#0B5D7A' : '#D97706'}
      fontSize={8}
      fontWeight={900}
      paintOrder="stroke"
      stroke="#ffffff"
      strokeWidth={3}
    >
      {formatChartLabel(num)}
    </text>
  )
}

function getBusinessExcellenceReportName(value?: string | null) {
  if (!value) return BUSINESS_EXCELLENCE_OVERVIEW_REPORT
  return REPORT_NAMES_BY_SLUG[value] || value
}

function getBusinessExcellenceReportPath(sheetName: string) {
  const slug = REPORT_ROUTE_SLUGS[sheetName] || normalizeSheetKey(sheetName).replace(/_/g, '-')
  return `/brands/platinum/business-excellence/${slug}`
}

function isBusinessDateParam(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseBusinessDate(value))
}

function buildDateFilterFromQuery(params: URLSearchParams): BusinessDateFilter {
  const startDate = params.get('startDate') || ''
  const endDate = params.get('endDate') || ''

  const compareStartDate = params.get('compareStartDate') || params.get('comparisonStartDate') || ''
  const compareEndDate = params.get('compareEndDate') || params.get('comparisonEndDate') || ''
  const comparisonRange = isBusinessDateParam(compareStartDate) && isBusinessDateParam(compareEndDate)
    ? { startDate: compareStartDate, endDate: compareEndDate }
    : {}
  const periodMode = params.get('periodMode')
  const queryYear = normalizePlatinumYear(params.get('year'))

  if (periodMode === 'year' && queryYear) {
    const range = isBusinessDateParam(startDate) && isBusinessDateParam(endDate)
      ? { startDate, endDate }
      : getPlatinumYearRange(queryYear)
    return buildPlatinumYearDateFilter(queryYear, range, comparisonRange)
  }

  if (!isBusinessDateParam(startDate) || !isBusinessDateParam(endDate)) return null

  const presetParam = params.get('periodPreset') as BusinessDatePreset | null
  const preset = presetParam && BUSINESS_DATE_PRESETS.some((item) => item.value === presetParam)
    ? presetParam
    : 'custom'

  return buildBusinessDateFilter(
    preset,
    { startDate, endDate },
    comparisonRange
  )
}

function buildBusinessExcellenceDateQuery(filter: BusinessDateFilter, dealerCode?: string | null) {
  const params = new URLSearchParams()
  appendKiaDealerCodeParam(params, dealerCode)
  if (filter) {
    params.set('startDate', filter.startDate)
    params.set('endDate', filter.endDate)
    if (filter.mode === 'year') {
      params.set('periodMode', 'year')
      params.set('year', String(filter.year))
    }
    if (filter.preset && filter.preset !== 'custom') {
      params.set('periodPreset', filter.preset)
    }
    if (filter.comparison?.previousStartDate && filter.comparison.previousEndDate) {
      params.set('compareStartDate', filter.comparison.previousStartDate)
      params.set('compareEndDate', filter.comparison.previousEndDate)
      params.set('comparisonStartDate', filter.comparison.previousStartDate)
      params.set('comparisonEndDate', filter.comparison.previousEndDate)
    }
  }
  return params.toString()
}

function appendBusinessExcellenceDateQuery(path: string, filter: BusinessDateFilter, dealerCode?: string | null) {
  const query = buildBusinessExcellenceDateQuery(filter, dealerCode)
  return query ? `${path}?${query}` : path
}

function WorkshopTrendValueLabel({
  x,
  y,
  value,
  index = 0,
  series,
}: {
  x?: number | string
  y?: number | string
  value?: number | string
  index?: number
  series: 'revenue' | 'jc'
}) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null

  const xPos = Number(x || 0)
  const baseY = Number(y || 0)
  const yPos = series === 'revenue'
    ? baseY + (index % 2 === 0 ? -13 : -22)
    : baseY + (index % 2 === 0 ? 17 : 26)

  return (
    <text
      x={xPos}
      y={yPos}
      textAnchor="middle"
      fill={series === 'revenue' ? '#2563EB' : '#023468'}
      fontSize={8}
      fontWeight={900}
      paintOrder="stroke"
      stroke="#ffffff"
      strokeWidth={4}
    >
      {series === 'revenue' ? formatChartLabel(num) : Math.round(num).toLocaleString('en-IN')}
    </text>
  )
}

function canAccessExecutiveDashboard(role?: string | null) {
  return ['developer', 'ceo', 'md', 'ea'].includes(String(role || '').trim().toLowerCase())
}

function getBusinessExcellenceReportOptions(sheets: SavedSheetMetadata[], role?: string | null) {
  const baseReports = canAccessExecutiveDashboard(role)
    ? BUSINESS_EXCELLENCE_REPORTS
    : BUSINESS_EXCELLENCE_REPORTS.filter((sheet) => sheet.sheetName !== EXECUTIVE_DASHBOARD_REPORT)

  if (sheets.length === 0) return baseReports

  const byName = new Map<string, SavedSheetMetadata>()
  baseReports.forEach((sheet) => byName.set(sheet.sheetName, sheet))
  sheets.forEach((sheet) => {
    if (byName.has(sheet.sheetName)) byName.set(sheet.sheetName, sheet)
  })

  return baseReports.map((sheet) => byName.get(sheet.sheetName) || sheet)
}

function TrendAxisTick({
  x,
  y,
  payload,
}: {
  x?: number | string
  y?: number | string
  payload?: { value?: string }
}) {
  const [date = '', day = ''] = String(payload?.value || '').split(' ')

  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <text textAnchor="middle" fill="#64748b" fontSize={9} fontWeight={900}>
        <tspan x="0" dy="0">{date}</tspan>
        <tspan x="0" dy="13" fill="#94a3b8" fontSize={8} fontWeight={800}>{day}</tspan>
      </text>
    </g>
  )
}

function parseBusinessDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }

  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  if (!trimmed || trimmed === '-' || trimmed === '\u2014') return null

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return new Date(Number(year), Number(month) - 1, Number(day))
  }

  const parts = trimmed.split(/[/-]/).map((part) => part.trim())
  if (parts.length === 3) {
    let day = Number(parts[0])
    let month = Number(parts[1])
    const year = Number(parts[2])

    if (day <= 12 && month > 12) {
      const originalDay = day
      day = month
      month = originalDay
    }

    if (year && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day)
    }
  }

  return null
}

type PerformanceIntelligenceRule = {
  key: string
  alertName: string
  formula: string
  impact: number
}

type PerformanceIntelligenceRow = {
  id: string
  sr: number
  branch: string
  type: string
  date: string
  billNo: string
  model: string
  regNumber: string
  advisor: string
  labourAmt: number
  partAmt: number
  discount: number
  alerts: string[]
  score: number
}

type PerformanceIntelligenceResponse = {
  dateRange: { startDate: string; endDate: string }
  metrics: {
    totalRecords: number
    filteredTransactions: number
    alertsFound: number
    avgAdvisorScore: number
    alertCounts: Record<string, number>
  }
  rules: PerformanceIntelligenceRule[]
  filterOptions: {
    branches: string[]
    serviceTypes: string[]
    advisors: string[]
    models: string[]
    alerts: string[]
  }
  advisorScores: Array<{
    advisor: string
    score: number
    transactions: number
    alerts: number
  }>
  rows: PerformanceIntelligenceRow[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  meta?: {
    dealerCode?: string | null
    dealerCoverage?: DealerCoverageBundle
  }
}

function formatPIAmount(value: number) {
  return `Rs. ${Math.round(value || 0).toLocaleString('en-IN')}`
}

function formatPIDate(value: string) {
  const date = parseBusinessDate(value)
  if (!date) return value || '-'
  return date.toLocaleDateString('en-CA')
}

function PerformanceIntelligenceReport({ dateFilter, dealerCode }: { dateFilter: BusinessDateFilter; dealerCode?: string | null }) {
  const queryClient = useQueryClient()
  const [data, setData] = useState<PerformanceIntelligenceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRules, setShowRules] = useState(false)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({
    searchReg: '',
    branch: 'all',
    serviceType: 'all',
    advisor: 'all',
    alert: 'all',
    model: 'all',
  })
  const range = getDefaultRODateRange(dateFilter)

  const fetchReport = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        startDate: range.startDate,
        endDate: range.endDate,
        page: String(page),
        limit: '50',
      })
      appendBusinessComparisonParams(params, dateFilter)
      appendKiaDealerCodeParam(params, dealerCode)

      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== 'all') params.set(key, value)
      })

      const queryString = params.toString()
      const report = await queryClient.fetchQuery({
        queryKey: ['business-excellence', 'performance-intelligence', queryString],
        queryFn: async () => {
          const response = await fetch(`/api/brands/platinum/business-excellence/performance-intelligence?${queryString}`)
          logApiTimings(response, 'performance-intelligence')
          return await readPlatinumJson<PerformanceIntelligenceResponse>(response, 'Performance Intelligence Report')
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
      setData(report)
    } catch (error) {
      console.error('Failed to load Performance Intelligence Report:', error)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [dateFilter, dealerCode, filters, page, queryClient, range.endDate, range.startDate])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchReport()
    }, 220)

    return () => window.clearTimeout(timer)
  }, [fetchReport])

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
  }

  const resetFilters = () => {
    setFilters({
      searchReg: '',
      branch: 'all',
      serviceType: 'all',
      advisor: 'all',
      alert: 'all',
      model: 'all',
    })
    setPage(1)
  }

  const fetchExportRows = async () => {
    const params = new URLSearchParams({
      startDate: range.startDate,
      endDate: range.endDate,
      page: '1',
      limit: '100',
      export: 'all',
    })
    appendBusinessComparisonParams(params, dateFilter)
    appendKiaDealerCodeParam(params, dealerCode)

    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all') params.set(key, value)
    })

    const queryString = params.toString()
    const exportData = await queryClient.fetchQuery({
      queryKey: ['business-excellence', 'performance-intelligence-export', queryString],
      queryFn: async () => {
        const response = await fetch(`/api/brands/platinum/business-excellence/performance-intelligence?${queryString}`)
        logApiTimings(response, 'performance-intelligence-export')
        return await readPlatinumJson<PerformanceIntelligenceResponse>(response, 'Performance Intelligence export')
      },
      staleTime: DASHBOARD_STALE_TIME_MS,
    })
    return exportData.rows || []
  }

  const getExportTable = (rowsToExport: PerformanceIntelligenceRow[]) => {
    const headers = ['Sr', 'Branch', 'Type', 'Date', 'Bill No', 'Model', 'Reg Number', 'Advisor', 'Labour Amt', 'Part Amt', 'Discount', 'Alerts', 'Score']
    const rows = rowsToExport.map((row) => [
      row.sr,
      row.branch,
      row.type,
      formatPIDate(row.date),
      row.billNo,
      row.model,
      row.regNumber,
      row.advisor,
      row.labourAmt,
      row.partAmt,
      row.discount,
      row.alerts.join('; '),
      row.score,
    ])
    return { headers, rows }
  }

  const downloadCsv = async () => {
    try {
      const { headers, rows } = getExportTable(await fetchExportRows())
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `performance-intelligence-${range.startDate}-${range.endDate}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to export Performance Intelligence CSV:', error)
    }
  }

  const downloadPdf = async () => {
    try {
      const { headers, rows } = getExportTable(await fetchExportRows())
      const printWindow = window.open('', '_blank')
      if (!printWindow) return

      const tableRows = rows.map((row) => `
        <tr>${row.map((cell) => `<td>${String(cell).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`).join('')}</tr>
      `).join('')

      printWindow.document.write(`
        <html>
          <head>
            <title>Performance Intelligence Report</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 16px; color: #0f172a; }
              h1 { font-size: 20px; margin: 0 0 4px; }
              p { margin: 0 0 14px; color: #475569; font-size: 11px; }
              table { width: 100%; border-collapse: collapse; font-size: 8px; }
              th { background: #0f172a; color: white; padding: 6px; text-align: left; }
              td { border-bottom: 1px solid #e2e8f0; padding: 5px; vertical-align: top; }
              tr:nth-child(even) { background: #f8fafc; }
              @page { size: landscape; margin: 10mm; }
            </style>
          </head>
          <body>
            <h1>Performance Intelligence Report</h1>
            <p>${range.startDate} to ${range.endDate} - ${rows.length.toLocaleString('en-IN')} filtered records</p>
            <table>
              <thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.focus()
      printWindow.print()
    } catch (error) {
      console.error('Failed to export Performance Intelligence PDF:', error)
    }
  }

  const alertSummaryCards = data?.rules || []

  return (
    <section className="flex flex-col gap-6 bg-slate-50 p-4 lg:p-6">
      <DealerCoverageNotice coverage={data?.meta?.dealerCoverage?.primary} />
      <div className="order-1 grid grid-cols-1 gap-5">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/60">
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-[repeat(4,minmax(135px,1fr))_repeat(3,minmax(110px,0.78fr))]">
            {[
              { label: 'Total Records', value: data?.metrics.totalRecords ?? 0, tone: 'slate' },
              { label: 'Filtered', value: data?.metrics.filteredTransactions ?? 0, tone: 'blue' },
              { label: 'Alerts Found', value: data?.metrics.alertsFound ?? 0, tone: 'rose' },
              { label: 'Advisor Score', value: data?.metrics.avgAdvisorScore ?? 0, tone: 'teal' },
            ].map((metric) => (
              <div key={metric.label} className={cn(
                'rounded-[1.25rem] border px-4 py-3',
                metric.tone === 'rose' ? 'border-rose-100 bg-rose-50/70' :
                  metric.tone === 'teal' ? 'border-teal-100 bg-teal-50/70' :
                    metric.tone === 'blue' ? 'border-blue-100 bg-blue-50/70' :
                      'border-slate-100 bg-slate-50'
              )}>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{metric.label}</p>
                <p className={cn(
                  'mt-3 text-3xl font-black tracking-tight text-slate-950',
                  metric.tone === 'rose' && 'text-rose-600',
                  metric.tone === 'teal' && 'text-teal-700'
                )}>
                  {loading ? '...' : Number(metric.value).toLocaleString('en-IN')}
                </p>
              </div>
            ))}
            <button type="button" onClick={() => setShowRules(true)} className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-xs font-black text-white shadow-lg shadow-slate-200 transition hover:-translate-y-0.5">
              <ShieldAlert className="mx-auto mb-1.5 h-4 w-4" />
              Rules
            </button>
            <button type="button" onClick={downloadCsv} className="rounded-2xl border border-teal-100 bg-teal-700 px-4 py-3 text-xs font-black text-white shadow-lg shadow-teal-100 transition hover:-translate-y-0.5">
              <FileSpreadsheet className="mx-auto mb-1.5 h-4 w-4" />
              Excel
            </button>
            <button type="button" onClick={downloadPdf} className="rounded-2xl border border-rose-100 bg-rose-600 px-4 py-3 text-xs font-black text-white shadow-lg shadow-rose-100 transition hover:-translate-y-0.5">
              <FileText className="mx-auto mb-1.5 h-4 w-4" />
              PDF
            </button>
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Alert Mix</p>
              <h3 className="text-xl font-black tracking-tight text-slate-950">Forensic signals detected</h3>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
              {loading ? '...' : `${alertSummaryCards.length} rules`}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {alertSummaryCards.map((rule) => {
              const value = data?.metrics.alertCounts[rule.alertName] || 0
              const total = data?.metrics.alertsFound || 0
              const width = total > 0 ? Math.min((value / total) * 100, 100) : 0

              return (
                <button
                  key={rule.key}
                  type="button"
                  onClick={() => updateFilter('alert', filters.alert === rule.alertName ? 'all' : rule.alertName)}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-lg",
                    filters.alert === rule.alertName
                      ? "border-rose-200 bg-rose-50 shadow-lg shadow-rose-100/60"
                      : "border-slate-100 bg-slate-50/80 hover:border-slate-200"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">{rule.alertName}</p>
                    <span className="text-lg font-black text-rose-600">
                      {loading ? '...' : value.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-500" style={{ width: `${width}%` }} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Advisor Scoreboard</p>
              <h3 className="text-xl font-black tracking-tight text-slate-950">Advisor-wise overall score</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">Updates with the active branch, model, alert, date, and advisor filters.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
              {loading ? '...' : `${data?.advisorScores?.length || 0} advisors`}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <div key={`advisor-score-skeleton-${index}`} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
              ))
            ) : data?.advisorScores?.length ? (
              data.advisorScores.slice(0, 12).map((advisor, index) => {
                const scoreTone = advisor.score >= 90
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
                  : advisor.score >= 70
                    ? 'text-amber-700 bg-amber-50 border-amber-100'
                    : 'text-rose-700 bg-rose-50 border-rose-100'
                return (
                  <div key={advisor.advisor} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-[10px] font-black text-white">
                            {index + 1}
                          </span>
                          <p className="truncate text-sm font-black text-slate-950" title={advisor.advisor}>{advisor.advisor}</p>
                        </div>
                        <p className="mt-2 text-[11px] font-bold text-slate-500">
                          {advisor.transactions.toLocaleString('en-IN')} transactions - {advisor.alerts.toLocaleString('en-IN')} alerts
                        </p>
                      </div>
                      <span className={cn('rounded-full border px-3 py-1 text-sm font-black', scoreTone)}>
                        {advisor.score}
                      </span>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          advisor.score >= 90 ? 'bg-emerald-600' : advisor.score >= 70 ? 'bg-amber-500' : 'bg-rose-500'
                        )}
                        style={{ width: `${Math.min(Math.max(advisor.score, 0), 100)}%` }}
                      />
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500 md:col-span-2 xl:col-span-3">
                No advisor score data for the selected filters.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="order-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
          {[
            { key: 'branch', label: 'Branch', options: data?.filterOptions.branches || [], all: 'All Locations' },
            { key: 'serviceType', label: 'Service Type', options: data?.filterOptions.serviceTypes || [], all: 'All Types' },
            { key: 'advisor', label: 'Advisor', options: data?.filterOptions.advisors || [], all: 'All Advisors' },
            { key: 'alert', label: 'Alert Filter', options: data?.filterOptions.alerts || [], all: 'All Cases' },
            { key: 'model', label: 'Model', options: data?.filterOptions.models || [], all: 'All Models' },
          ].map((filter) => (
            <label key={filter.key} className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{filter.label}</span>
              <Select value={filters[filter.key as keyof typeof filters]} onValueChange={(value) => updateFilter(filter.key as keyof typeof filters, value)}>
                <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-slate-50 text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[120] rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
                  <SelectItem value="all" className="text-xs font-bold">{filter.all}</SelectItem>
                  {filter.options.map((option) => (
                    <SelectItem key={option} value={option} className="text-xs font-bold">{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={resetFilters} className="h-10 w-full rounded-xl border-slate-200 font-black">
              Reset All
            </Button>
          </div>
        </div>
      </div>

      <div className="order-3 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/50">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[1120px] table-fixed text-[10px] leading-tight">
            <thead className="sticky top-0 z-10 bg-slate-950 text-white">
              <tr>
                {['Sr', 'Branch', 'Type', 'Date', 'Bill No', 'Model', 'Reg Number', 'Advisor', 'Labour Amt', 'Part Amt', 'Discount', 'Alerts', 'Score'].map((header) => (
                  <th key={header} className={cn(
                    'px-2 py-3 text-center font-black uppercase tracking-widest',
                    header === 'Alerts' && 'w-[210px] text-left',
                    header === 'Model' && 'w-[140px]',
                    header === 'Type' && 'w-[110px]',
                    header === 'Sr' && 'w-[42px]',
                    header === 'Score' && 'w-[54px]'
                  )}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, index) => (
                  <tr key={`pi-skeleton-${index}`} className="border-b border-slate-100">
                    {Array.from({ length: 13 }).map((__, cellIndex) => (
                      <td key={cellIndex} className="px-2 py-3">
                        <div className="mx-auto h-3 w-14 animate-pulse rounded-full bg-slate-200" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data?.rows.length ? (
                data.rows.map((row) => (
                  <tr key={row.id} className={cn('border-b border-slate-100 text-center', row.alerts.length > 0 ? 'bg-rose-50/40' : 'hover:bg-slate-50')}>
                    <td className="px-2 py-2">{row.sr}</td>
                    <td className="truncate px-2 py-2 font-bold" title={row.branch}>{row.branch}</td>
                    <td className="px-2 py-2">{row.type}</td>
                    <td className="px-2 py-2">{formatPIDate(row.date)}</td>
                    <td className="truncate px-2 py-2" title={row.billNo || '-'}>{row.billNo || '-'}</td>
                    <td className="truncate px-2 py-2" title={row.model}>{row.model}</td>
                    <td className="truncate px-2 py-2" title={row.regNumber || '-'}>{row.regNumber || '-'}</td>
                    <td className="truncate px-2 py-2" title={row.advisor}>{row.advisor}</td>
                    <td className="px-2 py-2 font-bold">{formatPIAmount(row.labourAmt)}</td>
                    <td className="px-2 py-2 font-bold">{formatPIAmount(row.partAmt)}</td>
                    <td className="px-2 py-2 font-bold">{formatPIAmount(row.discount)}</td>
                    <td className="px-2 py-3 text-left">
                      {row.alerts.length ? (
                        <div className="whitespace-pre-line text-[9px] font-black leading-4 text-rose-600">
                          {row.alerts.join('\n')}
                        </div>
                      ) : (
                        <span className="text-slate-400">No alerts</span>
                      )}
                    </td>
                    <td className={cn('px-2 py-2 text-sm font-black', row.score >= 90 ? 'text-emerald-600' : row.score >= 70 ? 'text-amber-600' : 'text-rose-600')}>{row.score}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center font-bold text-slate-500">No transactions found for the selected filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold text-slate-500">
            Page {data?.pagination.page || page} of {data?.pagination.totalPages || 1} - {data?.pagination.total || 0} records
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <Button type="button" variant="outline" size="sm" disabled={loading || page >= (data?.pagination.totalPages || 1)} onClick={() => setPage((current) => current + 1)}>Next</Button>
          </div>
        </div>
      </div>

      {showRules && data && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-6">
              <h3 className="text-3xl font-black text-blue-950">Forensic Audit Scoring Rules</h3>
              <button type="button" onClick={() => setShowRules(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="max-h-[72vh] overflow-auto p-6">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="border border-slate-200 px-5 py-4 text-left font-black">Alert Name</th>
                    <th className="border border-slate-200 px-5 py-4 text-left font-black">Logic / Formula</th>
                    <th className="border border-slate-200 px-5 py-4 text-center font-black">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rules.map((rule) => (
                    <tr key={rule.key}>
                      <td className="border border-slate-200 px-5 py-6 text-center font-black text-blue-950">{rule.alertName}</td>
                      <td className="border border-slate-200 px-5 py-6 text-center text-slate-700">{rule.formula}</td>
                      <td className="border border-slate-200 px-5 py-6 text-center font-black text-rose-500">{rule.impact} Points</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function BusinessExcellencePageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-[1.5rem] border border-slate-100 bg-white p-5 shadow-xl shadow-slate-200/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="space-y-2">
              <div className="h-5 w-56 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
          <div className="h-9 w-56 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </div>
      <SheetContentSkeleton />
    </div>
  )
}

function SheetContentSkeleton() {
  return (
    <div className="space-y-5 p-6">
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={`chart-placeholder-${index}`} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <div className="grid grid-cols-6 gap-3 border-b border-slate-100 bg-slate-50 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`header-placeholder-${index}`} className="h-3 animate-pulse rounded bg-slate-200" />
          ))}
        </div>
        <div className="divide-y divide-slate-100">
          {Array.from({ length: 8 }).map((_, rowIndex) => (
            <div key={`row-placeholder-${rowIndex}`} className="grid grid-cols-6 gap-3 p-4">
              {Array.from({ length: 6 }).map((__, colIndex) => (
                <div key={`cell-placeholder-${rowIndex}-${colIndex}`} className="h-3 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SheetRowsTable({
  sheet,
  data,
  loading,
  currentPage,
  onPageChange,
}: {
  sheet: SavedSheetMetadata
  data?: LoadedData
  loading: boolean
  currentPage: number
  onPageChange: (page: number) => void
}) {
  if (loading) {
    return <SheetContentSkeleton />
  }

  const rows = data?.rows || []
  const totalRows = data?.totalRows || 0
  const totalPages = Math.max(1, Math.ceil(totalRows / 10))
  const visibleColumns = sheet.columns.filter(Boolean)

  return (
    <div className="space-y-4 p-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-600">Selected Sheet</p>
          <p className="mt-1 text-lg font-black text-slate-900">{sheet.sheetName}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Rows In Sheet</p>
          <p className="mt-1 text-lg font-black text-slate-900">{totalRows.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Loaded Payload</p>
          <p className="mt-1 text-lg font-black text-slate-900">{rows.length.toLocaleString('en-IN')} rows</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-max text-xs">
          <thead className="bg-slate-900 text-white">
            <tr>
              {visibleColumns.map((column) => (
                <th key={column} className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-wider">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, visibleColumns.length)} className="px-4 py-12 text-center font-semibold text-slate-400">
                  No rows found for this sheet.
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={`sheet-row-${rowIndex}`} className="hover:bg-teal-50/40">
                  {visibleColumns.map((column) => (
                    <td key={`${rowIndex}-${column}`} className="max-w-[260px] px-4 py-3 text-slate-700">
                      <span className="line-clamp-2">{String(row[column] ?? '-')}</span>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 md:flex-row md:items-center md:justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Page {currentPage} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="rounded-xl bg-white"
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="rounded-xl bg-white"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function KiaBusinessExcellencePage({ initialReport, currentUserRole, allowedDealers }: { initialReport?: string; currentUserRole?: string | null; allowedDealers?: { code: string; label: string }[] } = {}) {
  // Branch-scoped users only see their assigned branch in the selector (server also enforces).
  const isDealerRestricted = Boolean(allowedDealers && allowedDealers.length)
  const scopedDealers = isDealerRestricted ? KIA_BRANCH_DEALERS.filter((dealer) => allowedDealers!.some((allowed) => allowed.code === dealer.dealerCode)) : KIA_BRANCH_DEALERS
  const scopedDefaultDealer = scopedDealers[0]?.dealerCode || DEFAULT_KIA_DEALER_CODE
  const clampDealer = (code: string | null) => (!isDealerRestricted || (code && scopedDealers.some((dealer) => dealer.dealerCode === code))) ? code : null
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const initialReportName = getBusinessExcellenceReportName(initialReport)
  const [savedSheets] = useState<SavedSheetMetadata[]>(BUSINESS_EXCELLENCE_REPORTS)
  const reportOptions = useMemo(() => getBusinessExcellenceReportOptions(savedSheets, currentUserRole), [currentUserRole, savedSheets])
  const [loadedRows, setLoadedRows] = useState<LoadedRows>({})
  const loading = false
  const [fetchingRows, setFetchingRows] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string | null>(initialReportName)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedPreset, setSelectedPreset] = useState<BusinessDatePreset>('mtd')
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [comparisonStartDate, setComparisonStartDate] = useState<string>('')
  const [comparisonEndDate, setComparisonEndDate] = useState<string>('')
  const [datePanelMode, setDatePanelMode] = useState<'current' | 'compare'>('current')
  const [appliedDateFilter, setAppliedDateFilter] = useState<BusinessDateFilter>(() => getEffectiveBusinessDateFilter())
  const [selectedDealerCode, setSelectedDealerCode] = useState<string | null>(() => {
    const normalized = clampDealer(normalizeKiaDealerCode(searchParams.get('dealer_code')))
    return normalized || scopedDefaultDealer
  })
  const [isApplyingFilter, setIsApplyingFilter] = useState(false)
  const [showDateControls, setShowDateControls] = useState(false)
  const [showHealthPanel, setShowHealthPanel] = useState(false)
  const [showAiSummary, setShowAiSummary] = useState(false)
  const [aiSummary, setAiSummary] = useState<BusinessAiSummary | null>(null)
  const [aiSummaryError, setAiSummaryError] = useState('')
  const [isAiSummaryLoading, setIsAiSummaryLoading] = useState(false)
  const [isServiceDashboardDownloading, setIsServiceDashboardDownloading] = useState(false)
  const [freshnessReady, setFreshnessReady] = useState(false)
  const itemsPerPage = 10
  const queryDateFilterKey = searchParams.toString()

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setFreshnessReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(queryDateFilterKey)
    const hasDateParams = params.has('startDate') || params.has('endDate') || params.has('compareStartDate') || params.has('compareEndDate') || params.get('periodMode') === 'year' || params.has('year')
    const timeout = window.setTimeout(() => {
      setSelectedDealerCode(clampDealer(normalizeKiaDealerCode(params.get('dealer_code'))) || scopedDefaultDealer)
      if (!hasDateParams) {
        const fallback = getEffectiveBusinessDateFilter()
        setSelectedPreset('mtd')
        setSelectedYear(null)
        setStartDate('')
        setEndDate('')
        setComparisonStartDate('')
        setComparisonEndDate('')
        setDatePanelMode('current')
        setAppliedDateFilter(fallback)
        return
      }

      const nextFilter = buildDateFilterFromQuery(params)
      if (!nextFilter) return

      setSelectedPreset(nextFilter.preset || 'custom')
      setSelectedYear(nextFilter.mode === 'year' ? nextFilter.year : null)
      setStartDate(nextFilter.startDate)
      setEndDate(nextFilter.endDate)
      setComparisonStartDate(nextFilter.comparison?.previousStartDate || '')
      setComparisonEndDate(nextFilter.comparison?.previousEndDate || '')
      setDatePanelMode(nextFilter.comparison?.previousStartDate && nextFilter.comparison.previousEndDate ? 'compare' : 'current')
      setAppliedDateFilter(nextFilter)
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [activeTab, initialReportName, queryDateFilterKey])

  useEffect(() => {
    if (activeTab && reportOptions.length > 0) {
      const selectedSheet = reportOptions.find((s) => s.sheetName === activeTab)
      if (!selectedSheet) {
        const fallbackSheet = reportOptions.find((s) => s.sheetName === BUSINESS_EXCELLENCE_OVERVIEW_REPORT) || reportOptions[0]
        if (fallbackSheet) {
          setActiveTab(fallbackSheet.sheetName)
          router.replace(appendBusinessExcellenceDateQuery(getBusinessExcellenceReportPath(fallbackSheet.sheetName), appliedDateFilter, selectedDealerCode))
        }
      }
    }
  }, [activeTab, reportOptions, router, appliedDateFilter, selectedDealerCode])

  const activeDateLabel = useMemo(() => {
    if (!appliedDateFilter) {
      const today = new Date()
      return `Current month - ${BUSINESS_MONTHS[today.getMonth()]} ${today.getFullYear()}`
    }

    if (appliedDateFilter.mode === 'year') {
      return `Year ${appliedDateFilter.year} - ${appliedDateFilter.startDate} to ${appliedDateFilter.endDate}`
    }

    const presetLabel = BUSINESS_DATE_PRESETS.find((preset) => preset.value === appliedDateFilter.preset)?.label
    if (presetLabel && appliedDateFilter.mode === 'preset') {
      return `${presetLabel} - ${appliedDateFilter.startDate} to ${appliedDateFilter.endDate}`
    }

    if (appliedDateFilter.mode === 'month') {
      return `${BUSINESS_MONTHS[appliedDateFilter.month]} ${appliedDateFilter.year}`
    }

    return `${appliedDateFilter.startDate || 'Start'} to ${appliedDateFilter.endDate || 'End'}`
  }, [appliedDateFilter])

  const freshnessQueryString = useMemo(() => {
    const params = new URLSearchParams({
      report: activeTab || initialReportName,
    })
    appendKiaDealerCodeParam(params, selectedDealerCode)
    return params.toString()
  }, [activeTab, initialReportName, selectedDealerCode])

  const freshnessQuery = useQuery<BusinessFreshnessResponse>({
    queryKey: ['business-excellence', 'freshness', freshnessQueryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/platinum/business-excellence/freshness?${freshnessQueryString}`, {
        cache: 'no-store',
        headers: {
          'cache-control': 'no-cache',
        },
      })
      logApiTimings(response, 'business-excellence-freshness')
      return await readPlatinumJson<BusinessFreshnessResponse>(response, 'Business Excellence freshness')
    },
    enabled: freshnessReady,
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    retry: 1,
  })

  const draftDateFilter = useMemo(
    () => selectedYear
      ? buildPlatinumYearDateFilter(
        selectedYear,
        { startDate, endDate },
        { startDate: comparisonStartDate, endDate: comparisonEndDate }
      )
      : buildBusinessDateFilter(
        startDate && endDate ? 'custom' : selectedPreset,
        { startDate, endDate },
        { startDate: comparisonStartDate, endDate: comparisonEndDate }
      ),
    [comparisonEndDate, comparisonStartDate, endDate, selectedPreset, selectedYear, startDate]
  )

  const draftDateLabel = draftDateFilter.mode === 'year'
    ? `Year ${draftDateFilter.year} - ${draftDateFilter.startDate} to ${draftDateFilter.endDate}`
    : `${draftDateFilter.startDate} to ${draftDateFilter.endDate}`
  const draftComparisonLabel = draftDateFilter.comparison?.previousStartDate && draftDateFilter.comparison.previousEndDate
    ? `${draftDateFilter.comparison.previousStartDate} to ${draftDateFilter.comparison.previousEndDate}`
    : 'Not selected'

  const applyDateFilter = useCallback(() => {
    const filter = selectedYear
      ? buildPlatinumYearDateFilter(
        selectedYear,
        { startDate, endDate },
        datePanelMode === 'compare'
          ? { startDate: comparisonStartDate, endDate: comparisonEndDate }
          : {}
      )
      : buildBusinessDateFilter(
        startDate && endDate ? 'custom' : selectedPreset,
        { startDate, endDate },
        datePanelMode === 'compare'
          ? { startDate: comparisonStartDate, endDate: comparisonEndDate }
          : {}
      )

    setIsApplyingFilter(true)
    setTimeout(() => {
      if (datePanelMode === 'current') {
        setComparisonStartDate('')
        setComparisonEndDate('')
      }
      setAppliedDateFilter(filter)
      router.replace(appendBusinessExcellenceDateQuery(getBusinessExcellenceReportPath(activeTab || initialReportName), filter, selectedDealerCode), { scroll: false })
      setShowDateControls(false)
      setTimeout(() => {
        setIsApplyingFilter(false)
      }, 300)
    }, 100)
  }, [activeTab, comparisonEndDate, comparisonStartDate, datePanelMode, endDate, initialReportName, router, selectedDealerCode, selectedPreset, selectedYear, startDate])

  const clearDateFilter = useCallback(() => {
    setIsApplyingFilter(true)
    setTimeout(() => {
      const fallback = getEffectiveBusinessDateFilter()
      setSelectedPreset('mtd')
      setSelectedYear(null)
      setStartDate('')
      setEndDate('')
      setComparisonStartDate('')
      setComparisonEndDate('')
      setDatePanelMode('current')
      setAppliedDateFilter(fallback)
      router.replace(appendBusinessExcellenceDateQuery(getBusinessExcellenceReportPath(activeTab || initialReportName), null, selectedDealerCode), { scroll: false })
      setShowDateControls(false)
      setTimeout(() => {
        setIsApplyingFilter(false)
      }, 300)
    }, 100)
  }, [activeTab, initialReportName, router, selectedDealerCode])

  const handleDealerChange = useCallback((dealerCode: string | null) => {
    const nextDealerCode = normalizeKiaDealerCode(dealerCode) || DEFAULT_KIA_DEALER_CODE
    setSelectedDealerCode(nextDealerCode)
    router.push(appendBusinessExcellenceDateQuery(getBusinessExcellenceReportPath(activeTab || initialReportName), appliedDateFilter, nextDealerCode), { scroll: false })
  }, [activeTab, appliedDateFilter, initialReportName, router])

  const resolveCurrentRange = useCallback(() => {
    if (startDate && endDate) return { startDate, endDate }
    if (appliedDateFilter?.startDate && appliedDateFilter.endDate) {
      return { startDate: appliedDateFilter.startDate, endDate: appliedDateFilter.endDate }
    }
    const fallback = buildBusinessDateFilter('mtd')
    return { startDate: fallback.startDate, endDate: fallback.endDate }
  }, [appliedDateFilter, endDate, startDate])

  const shiftDateByYears = useCallback((value: string, years: number) => {
    const parsed = parseBusinessDate(value)
    if (!parsed) return ''
    const shifted = new Date(parsed)
    shifted.setFullYear(shifted.getFullYear() + years)
    return getInputDate(shifted)
  }, [])

  const platinumYearOptions = useMemo(() => getPlatinumAvailableYears(), [])
  const selectedComparisonYear = parseBusinessDate(comparisonStartDate)?.getFullYear() || null
  const activeYearOption = datePanelMode === 'compare' ? selectedComparisonYear : selectedYear

  const selectPlatinumYear = useCallback((year: number) => {
    const range = getPlatinumYearRange(year)
    if (datePanelMode === 'compare') {
      setComparisonStartDate(range.startDate)
      setComparisonEndDate(range.endDate)
      return
    }

    setSelectedYear(year)
    setSelectedPreset('custom')
    setStartDate(range.startDate)
    setEndDate(range.endDate)
  }, [datePanelMode])

  const openDatePanel = useCallback((mode: 'current' | 'compare') => {
    const currentRange = resolveCurrentRange()
    if (!startDate || !endDate) {
      setStartDate(currentRange.startDate)
      setEndDate(currentRange.endDate)
    }
    if (mode === 'compare' && (!comparisonStartDate || !comparisonEndDate)) {
      if (selectedYear && selectedYear <= PLATINUM_DATA_START_YEAR) {
        setComparisonStartDate('')
        setComparisonEndDate('')
        setDatePanelMode(mode)
        setShowDateControls((visible) => (visible && datePanelMode === mode ? false : true))
        return
      }
      setComparisonStartDate(shiftDateByYears(currentRange.startDate, -1))
      setComparisonEndDate(shiftDateByYears(currentRange.endDate, -1))
    }
    setDatePanelMode(mode)
    setShowDateControls((visible) => (visible && datePanelMode === mode ? false : true))
  }, [comparisonEndDate, comparisonStartDate, datePanelMode, endDate, resolveCurrentRange, selectedYear, shiftDateByYears, startDate])

  const generateAiSummary = useCallback(async (report: string) => {
    setShowAiSummary(true)
    setIsAiSummaryLoading(true)
    setAiSummaryError('')

    try {
      const response = await fetch('/api/brands/platinum/business-excellence/ai-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          report,
          dateFilter: appliedDateFilter,
          dealerCode: selectedDealerCode,
        }),
      })
      logApiTimings(response, 'business-excellence-ai-summary')
      const data = await readPlatinumJson<BusinessAiSummary>(response, 'Business Excellence AI summary')

      setAiSummary(data as BusinessAiSummary)
    } catch (error) {
      console.error('Failed to generate Business Excellence AI summary:', error)
      setAiSummaryError(error instanceof Error ? error.message : 'Failed to generate AI summary')
    } finally {
      setIsAiSummaryLoading(false)
    }
  }, [appliedDateFilter, selectedDealerCode])

  const downloadServiceDashboard = useCallback(async () => {
    setIsServiceDashboardDownloading(true)
    try {
      const effectiveFilter = getEffectiveBusinessDateFilter(appliedDateFilter)
      const params = new URLSearchParams({ endDate: effectiveFilter.endDate })
      appendKiaDealerCodeParam(params, selectedDealerCode)
      const response = await fetch(
        `/api/brands/platinum/business-excellence/service-dashboard-export?${params.toString()}`,
        { cache: 'no-store' },
      )
      logApiTimings(response, 'platinum-service-dashboard-export')
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to download Service Dashboard')
      }

      const disposition = response.headers.get('Content-Disposition') || ''
      const fileNameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/)
      const fileName = fileNameMatch
        ? decodeURIComponent(fileNameMatch[1] || fileNameMatch[2])
        : `AM_PLATINUM_Service_Dashboard_${effectiveFilter.endDate}.xlsx`
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download Platinum Service Dashboard:', error)
      alert(error instanceof Error ? error.message : 'Failed to download Service Dashboard')
    } finally {
      setIsServiceDashboardDownloading(false)
    }
  }, [appliedDateFilter, selectedDealerCode])

  const fetchSheetRows = useCallback(async (sheet: SavedSheetMetadata, page: number = 1) => {
    const sheetId = sheet.id
    setFetchingRows(sheetId)
    try {
      const params = new URLSearchParams({
        brand: sheet.brand || 'platinum',
        sheet: normalizeSheetKey(sheet.sheetName),
        page: String(page),
        limit: String(itemsPerPage),
      })
      appendKiaDealerCodeParam(params, selectedDealerCode)
      const effectiveFilter = getEffectiveBusinessDateFilter(appliedDateFilter)
      params.set('startDate', effectiveFilter.startDate)
      params.set('endDate', effectiveFilter.endDate)
      appendBusinessComparisonParams(params, effectiveFilter)
      const queryString = params.toString()
      const fullData = await queryClient.fetchQuery({
        queryKey: ['business-excellence', 'sheet-rows', queryString],
        queryFn: async () => {
          const response = await fetch(`/api/brands/platinum/business-excellence?${queryString}`)
          logApiTimings(response, 'business-excellence-sheet-rows')
          return await readPlatinumJson<LoadedData>(response, 'Business Excellence sheet rows')
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
      setLoadedRows(prev => ({
        ...prev,
        [sheetId]: {
          rows: fullData.rows || [],
          totalRows: fullData.totalRows || 0
        }
      }))
    } catch (error) {
      console.error('Failed to fetch sheet rows:', error)
    } finally {
      setFetchingRows(null)
    }
  }, [appliedDateFilter, queryClient, selectedDealerCode]) // Removed loadedRows dependency

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setActiveTab(initialReportName)
    setCurrentPage(1)
    setShowHealthPanel(false)
  }, [initialReportName])

  useEffect(() => {
    setShowAiSummary(false)
    setAiSummary(null)
    setAiSummaryError('')
  }, [activeTab, appliedDateFilter, selectedDealerCode])

  useEffect(() => {
    if (activeTab && savedSheets.length > 0) {
      if (activeTab === BUSINESS_EXCELLENCE_OVERVIEW_REPORT || activeTab === EXECUTIVE_DASHBOARD_REPORT || activeTab === WORKSHOP_PERFORMANCE_REPORT || activeTab === DEFAULT_BUSINESS_EXCELLENCE_SHEET || activeTab === OPEN_RO_REPORT || activeTab === PLATINUM_COMPLAINTS_REPORT || activeTab === PLATINUM_SOT_REPORT || activeTab === SERVICE_DASHBOARD_REPORT || activeTab === WORKSHOP_SUMMARY_REPORT) {
        setFetchingRows(null)
        return
      }
      const sheet = savedSheets.find(s => s.sheetName === activeTab)
      if (sheet) {
        fetchSheetRows(sheet, currentPage)
      }
    }
  }, [activeTab, currentPage, fetchSheetRows, savedSheets])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleTabChange = (sheetName: string) => {
    const nextDealerCode = normalizeKiaDealerCode(selectedDealerCode) || DEFAULT_KIA_DEALER_CODE
    setSelectedDealerCode(nextDealerCode)
    router.push(appendBusinessExcellenceDateQuery(getBusinessExcellenceReportPath(sheetName), appliedDateFilter, nextDealerCode))
  }



  return (
    <MainLayout title="Business Excellence" subtitle="AM Platinum Performance Analytics">
      <div className="business-excellence-boundaries">
        <div className="space-y-4 w-full animate-in fade-in duration-500">
          {loading && savedSheets.length === 0 && <BusinessExcellencePageSkeleton />}

          {/* Performance Analytics Section - Show for selected sheet */}
          {reportOptions.length > 0 && activeTab && (
            <div className="space-y-4">
              {(() => {
              const selectedSheet = reportOptions.find(s => s.sheetName === activeTab)

              if (!selectedSheet) {
                return (
                  <Card className="rounded-[1.5rem] border-none bg-white shadow-xl shadow-slate-200/50 overflow-hidden p-8">
                    <div className="text-center text-slate-400">
                      <p className="font-bold">Sheet not found</p>
                    </div>
                  </Card>
                )
              }

              // Check if this is RO Billing sheet to show analytics
              const isOverviewSheet = selectedSheet.sheetName === BUSINESS_EXCELLENCE_OVERVIEW_REPORT
              const isROBillingSheet = selectedSheet.sheetName.toLowerCase().includes('ro billing')
              const isWorkshopPerformanceSheet = selectedSheet.sheetName === WORKSHOP_PERFORMANCE_REPORT
              const isWorkshopSummarySheet = selectedSheet.sheetName === WORKSHOP_SUMMARY_REPORT
              const isOpenRoSheet = selectedSheet.sheetName === OPEN_RO_REPORT
              const isKiaComplaintsSheet = selectedSheet.sheetName === PLATINUM_COMPLAINTS_REPORT
              const isSotSheet = selectedSheet.sheetName === PLATINUM_SOT_REPORT
              const isExecutiveDashboardSheet = selectedSheet.sheetName === EXECUTIVE_DASHBOARD_REPORT
              const isServiceDashboardSheet = selectedSheet.sheetName === SERVICE_DASHBOARD_REPORT
              const usesDateControls = isOverviewSheet || isExecutiveDashboardSheet || isROBillingSheet || isWorkshopPerformanceSheet || isWorkshopSummarySheet || isOpenRoSheet || isKiaComplaintsSheet || isSotSheet || isServiceDashboardSheet
              const supportsComparison = isOverviewSheet || isExecutiveDashboardSheet || isROBillingSheet || isWorkshopPerformanceSheet || isWorkshopSummarySheet || isKiaComplaintsSheet || isSotSheet
              const supportsHealthPanel = false
              const activeComparisonText = appliedDateFilter?.comparison?.previousStartDate && appliedDateFilter.comparison.previousEndDate
                ? `Compare ${appliedDateFilter.comparison.previousStartDate} - ${appliedDateFilter.comparison.previousEndDate}`
                : ''
              const branchOptions = (isExecutiveDashboardSheet && !isDealerRestricted)
                ? [{ label: 'All Locations', dealerCode: null as string | null }, ...scopedDealers]
                : scopedDealers

              return (
                <div className="animate-in slide-in-from-bottom-4 duration-500">
                  <Card className="overflow-visible rounded-[1.25rem] border border-slate-200 bg-white shadow-sm">
                    <CardHeader className="border-b border-slate-100 bg-white px-4 py-3">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex min-w-0 flex-wrap items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-teal-100 bg-teal-50 text-teal-700">
                            <Activity className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <CardTitle className="truncate text-lg font-black tracking-tight text-slate-900">{selectedSheet.sheetName}</CardTitle>
                          </div>
                          {usesDateControls && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-700">
                                {activeDateLabel}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-600">
                                Updated: {freshnessQuery.isLoading && !freshnessQuery.data ? 'Checking...' : freshnessQuery.isError ? 'Not available' : formatBusinessFreshness(freshnessQuery.data?.sourceUpdatedAt)}
                              </span>
                              <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm" aria-label="Business Excellence branch filter">
                                {branchOptions.map((branch) => {
                                  const isActive = branch.dealerCode
                                    ? selectedDealerCode === branch.dealerCode
                                    : !normalizeKiaDealerCode(selectedDealerCode)
                                  return (
                                    <button
                                      key={branch.dealerCode || 'all-locations'}
                                      type="button"
                                      onClick={() => handleDealerChange(branch.dealerCode)}
                                      className={cn(
                                        'rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest transition',
                                        isActive
                                          ? 'bg-[var(--dashboard-action-bg)] text-white shadow-sm'
                                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                                      )}
                                    >
                                      {branch.label}
                                    </button>
                                  )
                                })}
                              </div>
                              {activeComparisonText && (
                                <span className="rounded-full border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] px-3 py-1.5 text-[10px] font-black text-[var(--dashboard-action-bg)]">
                                  {activeComparisonText}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {/* Sheet Selector */}
                          <div className="flex items-center gap-2">
                            <Select
                              value={selectedSheet.sheetName}
                              onValueChange={(value) => {
                                console.log('Sheet changed to:', value)
                                handleTabChange(value)
                              }}
                            >
                              <SelectTrigger className="h-9 w-[220px] rounded-xl border border-teal-200/80 bg-white/65 text-xs font-bold text-slate-700 shadow-sm">
                                <SelectValue placeholder="Choose a sheet" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-slate-100 bg-white shadow-2xl z-[100]">
                                {reportOptions.map((sheet) => (
                                  <SelectItem key={sheet.id} value={sheet.sheetName} className="font-bold rounded-lg m-1 text-xs">
                                    {sheet.sheetName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {supportsHealthPanel && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isApplyingFilter}
                              onClick={() => setShowHealthPanel((visible) => !visible)}
                              className={cn(
                                'h-9 rounded-xl px-3 text-xs font-black shadow-sm',
                                showHealthPanel ? 'app-primary-action' : 'app-outline-action'
                              )}
                            >
                              <Activity className="mr-2 h-3.5 w-3.5" />
                              {showHealthPanel ? 'Hide Health' : 'Show Health'}
                            </Button>
                          )}

                          {usesDateControls && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openDatePanel('current')}
                              className="h-9 rounded-xl border border-teal-200/80 bg-white/65 px-3 text-xs font-black text-slate-700 shadow-sm hover:border-teal-300 hover:bg-white/85"
                            >
                              <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
                              {showDateControls && datePanelMode === 'current' ? 'Hide Date' : 'Select Date'}
                            </Button>
                          )}
                          {supportsComparison && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openDatePanel('compare')}
                              className={cn(
                                'h-9 rounded-xl px-3 text-xs font-black shadow-sm',
                                (showDateControls && datePanelMode === 'compare') || activeComparisonText ? 'app-primary-action' : 'app-outline-action'
                              )}
                            >
                              <CalendarDays className="mr-2 h-3.5 w-3.5" />
                              {showDateControls && datePanelMode === 'compare' ? 'Hide Compare' : 'Compare Dates'}
                            </Button>
                          )}
                          {usesDateControls && appliedDateFilter && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isApplyingFilter}
                              onClick={clearDateFilter}
                              className="app-outline-action h-9 rounded-xl px-3 text-xs font-black shadow-sm"
                            >
                              <X className="mr-2 h-3.5 w-3.5" />
                              Reset Dates
                            </Button>
                          )}
                        </div>
                      </div>

                      {freshnessQuery.data?.sources && freshnessQuery.data.sources.length > 0 && (
                        <div className="mt-3.5 flex flex-wrap gap-2 border-t border-slate-100 pt-3 items-center">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">Data Freshness:</span>
                          {freshnessQuery.data.sources.map((src) => (
                            <span key={src.table} className="rounded-full border border-slate-200/80 bg-slate-50/65 px-2.5 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-800 transition" title={`Table: ${src.table} (${(src.rowCount ?? 0).toLocaleString()} rows)`}>
                              {src.label}: <span className="font-extrabold text-slate-700">{formatBusinessFreshnessShort(src.sourceUpdatedAt)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </CardHeader>
                    <Dialog open={showAiSummary} onOpenChange={setShowAiSummary}>
                      <DialogContent className="max-h-[88vh] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-2xl sm:max-w-[980px]">
                        <DialogHeader className="border-b border-white/10 bg-[var(--dashboard-action-bg)] px-6 py-5 text-white">
                          <div className="flex items-start gap-3 pr-10">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10">
                              {isAiSummaryLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/70">CEO AI Brief</p>
                              <DialogTitle className="mt-1 text-2xl font-black tracking-tight text-white">
                                {aiSummary?.structuredSummary?.title || `${selectedSheet.sheetName} Summary`}
                              </DialogTitle>
                              <DialogDescription className="mt-2 text-sm font-semibold text-white/75">
                                {selectedSheet.sheetName} - {activeDateLabel}
                              </DialogDescription>
                            </div>
                          </div>
                        </DialogHeader>

                        <div className="max-h-[calc(88vh-116px)] overflow-y-auto bg-slate-50 p-5">
                          {isAiSummaryLoading ? (
                            <div className="space-y-4">
                              <div className="h-28 animate-pulse rounded-3xl bg-white" />
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                {[1, 2, 3, 4].map((item) => (
                                  <div key={item} className="h-28 animate-pulse rounded-2xl bg-white" />
                                ))}
                              </div>
                              <div className="grid gap-3 lg:grid-cols-3">
                                {[1, 2, 3].map((item) => (
                                  <div key={item} className="h-52 animate-pulse rounded-2xl bg-white" />
                                ))}
                              </div>
                            </div>
                          ) : aiSummaryError ? (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                              {aiSummaryError}
                            </div>
                          ) : aiSummary?.structuredSummary ? (
                            <div className="space-y-4">
                              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Executive Read</p>
                                <p className="mt-3 text-base font-semibold leading-7 text-slate-800">
                                  {cleanAiText(aiSummary.structuredSummary.executiveRead)}
                                </p>
                              </div>

                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                {aiSummary.structuredSummary.metricSignals.map((signal, index) => (
                                  <div key={`${signal.label}-${index}`} className={cn('rounded-2xl border p-4 shadow-sm', aiToneClass(signal.tone))}>
                                    <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{signal.label}</p>
                                    <p className="mt-2 text-2xl font-black tracking-tight">{signal.value}</p>
                                    <p className="mt-2 text-xs font-semibold leading-5 opacity-80">{cleanAiText(signal.context)}</p>
                                  </div>
                                ))}
                              </div>

                              <div className="grid gap-4 xl:grid-cols-3">
                                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                                  <div className="mb-4 flex items-center gap-2">
                                    <BarChart3 className="h-4 w-4 text-[var(--dashboard-action-bg)]" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Good News</p>
                                  </div>
                                  <div className="space-y-3">
                                    {aiSummary.structuredSummary.keyFindings.map((finding, index) => (
                                      <div key={`${finding}-${index}`} className="flex gap-3 text-sm font-semibold leading-5 text-slate-700">
                                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--dashboard-action-bg)]" />
                                        <span>{cleanAiText(finding)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="rounded-3xl border border-rose-200 bg-white p-5 shadow-sm">
                                  <div className="mb-4 flex items-center gap-2">
                                    <ShieldAlert className="h-4 w-4 text-rose-700" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Bad News</p>
                                  </div>
                                  <div className="space-y-3">
                                    {aiSummary.structuredSummary.risks.map((risk, index) => (
                                      <div key={`${risk}-${index}`} className="flex gap-3 text-sm font-semibold leading-5 text-rose-900">
                                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                                        <span>{cleanAiText(risk)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm">
                                  <div className="mb-4 flex items-center gap-2">
                                    <Wrench className="h-4 w-4 text-amber-700" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Immediate Actions</p>
                                  </div>
                                  <div className="space-y-3">
                                    {aiSummary.structuredSummary.actions.map((action, index) => (
                                      <div key={`${action.action}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{action.owner}</span>
                                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black', priorityClass(action.priority))}>
                                            {action.priority || 'Medium'}
                                          </span>
                                        </div>
                                        <p className="text-sm font-semibold leading-5 text-slate-800">{cleanAiText(action.action)}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-[10px] font-black uppercase tracking-widest text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                                <span>Generated with {aiSummary.model}</span>
                                <span>{new Date(aiSummary.generatedAt).toLocaleString('en-IN')}</span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={isAiSummaryLoading}
                                  onClick={() => void generateAiSummary(selectedSheet.sheetName)}
                                  className="app-outline-action h-8 rounded-xl px-3 text-[11px] font-black"
                                >
                                  <RefreshCw className="mr-2 h-3 w-3" />
                                  Regenerate
                                </Button>
                              </div>
                            </div>
                          ) : aiSummary ? (
                            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                              <div className="whitespace-pre-line text-sm font-semibold leading-6 text-slate-700">
                                {cleanAiText(aiSummary.summary)}
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
                              <Sparkles className="mx-auto h-8 w-8 text-[var(--dashboard-action-bg)]" />
                              <p className="mt-3 text-sm font-semibold text-slate-500">Generating a clean CEO-ready readout.</p>
                            </div>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
                    <CardContent className="p-0">
                      <>
                          {showDateControls && (
                            <div className="solid-calendar-surface border-b border-slate-100 bg-white p-3">
                              <div className={cn(
                                'solid-calendar-surface rounded-[1.25rem] border border-[var(--dashboard-primary-border)] bg-white p-3 shadow-sm',
                                datePanelMode === 'current' ? 'max-w-[640px]' : 'max-w-[860px]'
                              )}>
                                <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3">
                                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="grid flex-1 gap-3 sm:grid-cols-2">
                                      <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                          {datePanelMode === 'compare' ? 'CY Range' : 'Selected Range'}
                                        </p>
                                        <p className="mt-1 text-sm font-black text-slate-950">{draftDateLabel}</p>
                                      </div>
                                      {datePanelMode === 'compare' && (
                                        <div>
                                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">LY Range</p>
                                          <p className="mt-1 text-sm font-black text-slate-950">{draftComparisonLabel}</p>
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap gap-2 lg:justify-end">
                                      <Button
                                        size="sm"
                                        className="app-primary-action calendar-apply-action h-10 rounded-2xl px-5 text-xs font-black"
                                        disabled={isApplyingFilter}
                                        onClick={applyDateFilter}
                                      >
                                        {isApplyingFilter ? (
                                          <>
                                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                            Applying
                                          </>
                                        ) : (
                                          'Apply'
                                        )}
                                      </Button>
                                      {appliedDateFilter && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          disabled={isApplyingFilter}
                                          onClick={clearDateFilter}
                                          className="app-outline-action h-10 rounded-2xl px-4 text-xs font-black"
                                        >
                                          Clear
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                        Platinum Year
                                      </p>
                                      <p className="mt-1 text-xs font-bold text-slate-600">
                                        {PLATINUM_DATA_START_YEAR} to {platinumYearOptions[platinumYearOptions.length - 1]}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 lg:justify-end">
                                      {platinumYearOptions.map((year) => (
                                        <button
                                          key={year}
                                          type="button"
                                          onClick={() => selectPlatinumYear(year)}
                                          className={cn(
                                            'h-9 min-w-[4rem] rounded-xl border px-3 text-[11px] font-black transition-all',
                                            activeYearOption === year
                                              ? 'border-[var(--dashboard-action-bg)] bg-[var(--dashboard-action-bg)] text-white shadow-sm'
                                              : 'border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:text-slate-950'
                                          )}
                                        >
                                          {year}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                                {datePanelMode === 'current' ? (
                                  <AnalyticsDateRangePicker
                                    key={`platinum-current-${startDate}-${endDate}`}
                                    title="Current Date Range"
                                    clearLabel="Clear current range"
                                    startDate={startDate}
                                    endDate={endDate}
                                    onChange={(nextStart, nextEnd) => {
                                      setSelectedYear(null)
                                      setSelectedPreset('custom')
                                      setStartDate(nextStart)
                                      setEndDate(nextEnd)
                                    }}
                                  />
                                ) : (
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <AnalyticsDateRangePicker
                                      key={`platinum-cy-${startDate}-${endDate}`}
                                      title="CY Date Range"
                                      clearLabel="Clear CY range"
                                      startDate={startDate}
                                      endDate={endDate}
                                      onChange={(nextStart, nextEnd) => {
                                        setSelectedYear(null)
                                        setSelectedPreset('custom')
                                        setStartDate(nextStart)
                                        setEndDate(nextEnd)
                                      }}
                                    />
                                    <AnalyticsDateRangePicker
                                      key={`platinum-ly-${comparisonStartDate}-${comparisonEndDate}`}
                                      title="LY Date Range"
                                      clearLabel="Clear LY range"
                                      startDate={comparisonStartDate}
                                      endDate={comparisonEndDate}
                                      onChange={(nextStart, nextEnd) => {
                                        setComparisonStartDate(nextStart)
                                        setComparisonEndDate(nextEnd)
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        {/* Executive health panel is opt-in from the report header. */}
                        {showHealthPanel && supportsHealthPanel && !isApplyingFilter && (
                          <BusinessExecutiveDecisionLayer
                            dateFilter={appliedDateFilter}
                            reportName={selectedSheet.sheetName}
                            dealerCode={selectedDealerCode}
                          />
                        )}
                        {isExecutiveDashboardSheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <div className="space-y-4">
                              {/* Every dealer at once, on purpose — dealerCode is NOT passed. This is a
                                  comparison table: its whole value is seeing which branch is the outlier,
                                  which a single-row view cannot show. The branch selector above still
                                  scopes the rest of the dashboard. */}
                              <RevenueLeakagePanel
                                brand="platinum"
                                startDate={appliedDateFilter?.startDate ?? null}
                                endDate={appliedDateFilter?.endDate ?? null}
                              />
                              <BusinessExecutiveDashboard
                                dateFilter={appliedDateFilter}
                                dealerCode={selectedDealerCode}
                                onDealerChange={handleDealerChange}
                              />
                            </div>
                          )
                        ) : isOverviewSheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <BusinessExcellenceOverview dateFilter={appliedDateFilter} dealerCode={selectedDealerCode} />
                          )
                        ) : isWorkshopPerformanceSheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <WorkshopPerformanceSection dateFilter={appliedDateFilter} dealerCode={selectedDealerCode} />
                          )
                        ) : isOpenRoSheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <OpenRoSection dateFilter={appliedDateFilter} dealerCode={selectedDealerCode} />
                          )
                        ) : isKiaComplaintsSheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <KiaComplaintsSection dateFilter={appliedDateFilter} dealerCode={selectedDealerCode} />
                          )
                        ) : isWorkshopSummarySheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <WorkshopSummarySection
                              endDate={appliedDateFilter?.endDate || null}
                              dealerCode={selectedDealerCode}
                            />
                          )
                        ) : isSotSheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <PlatinumSotAnalysisSection dateFilter={appliedDateFilter} dealerCode={selectedDealerCode} />
                          )
                        ) : isServiceDashboardSheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <ServiceDashboardPreviewSection
                              brand="platinum"
                              dateFilter={appliedDateFilter}
                              dealerCode={selectedDealerCode}
                              onDownload={() => void downloadServiceDashboard()}
                              downloading={isServiceDashboardDownloading}
                            />
                          )
                        ) : isROBillingSheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <>
                              <ROBillingAnalytics
                                sheetId={selectedSheet.id}
                                sheetName={selectedSheet.sheetName}
                                activeSheet={selectedSheet.sheetName}
                                prefetchedData={null}
                                isPrefetching={false}
                                dateFilter={appliedDateFilter}
                                dealerCode={selectedDealerCode}
                              />
                            </>
                          )
                        ) : (
                          <SheetRowsTable
                            sheet={selectedSheet}
                            data={loadedRows[selectedSheet.id]}
                            loading={fetchingRows === selectedSheet.id}
                            currentPage={currentPage}
                            onPageChange={setCurrentPage}
                          />
                        )}
                      </>
                    </CardContent>
                  </Card>

                </div>
              )
              })()}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  )
}

// Wrapper component that uses pre-fetched data or fetches if not available
type ROAnalysisType = 'load' | 'labour' | 'parts' | 'lab_per_veh' | 'part_per_veh'
type ROAnalysisView = 'table' | 'trend' | 'calendar' | 'fy' | 'analytics' | 'revenue' | 'leaderboard' | 'intelligence'
type DailyProgressMetric = 'all' | 'revenue' | 'labour' | 'parts' | 'load'
type PeriodKey = 'td' | 'mtd' | 'qtd' | 'ytd'

type SalesLeaderboardRow = {
  name: string
  load: number
  labour: number
  parts: number
  revenue: number
  averageBilling: number
  contribution: number
}

type ROAnalysisMetric = {
  cy: number
  ly: number | 'N/A'
  growth: number | 'N/A'
}

type ROAnalysisRow = {
  name: string
  depth: number
  metrics: Record<'td' | 'mtd' | 'qtd' | 'ytd', ROAnalysisMetric>
  children?: ROAnalysisRow[]
}

type CancelledBillingRow = {
  billKey: string
  billNo: string
  roNo: string
  billDate: string | null
  workType: string
  serviceType: string
  advisor: string
  billStatus: string
  labour: number
  parts: number
  total: number
}

type CancelledBillingSummary = {
  count: number
  labour: number
  parts: number
  total: number
  rows: CancelledBillingRow[]
}

type ROAnalysisResponse = {
  analysisType: ROAnalysisType
  dateBasis: string
  dateRange: { startDate: string; endDate: string }
  totals: Record<'td' | 'mtd' | 'qtd' | 'ytd', ROAnalysisMetric>
  selectedRangeValue: number
  revenueSummary: {
    load: number
    labour: number
    parts: number
    total: number
    labPerVehicle: number
    partPerVehicle: number
  }
  analyticsSummary?: {
    avgRating: number
    avgRatingLy: number
    pickDropRate: number
    pickDropRateLy: number
  }
  rows: ROAnalysisRow[]
  trend: Array<{ date: string; label: string; cy: number; ly: number }>
  fyTrends: Array<{ fy: string; value: number }>
  distribution: Array<{ name: string; value: number }>
  advisorLeaderboard?: SalesLeaderboardRow[]
  byMetric?: Partial<Record<ROAnalysisType, ROAnalysisResponse>>
  cancelledSummary?: CancelledBillingSummary
  filterOptions: Record<string, string[]>
  rowCounts: { totalRows: number; rowsWithBillDate: number; filteredRows: number }
  meta?: {
    dealerCode?: string | null
    dealerCoverage?: DealerCoverageBundle
  }
}

function getInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDefaultRODateRange(dateFilter: BusinessDateFilter) {
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

function getSelectedBusinessDateRange(dateFilter?: BusinessDateFilter | null) {
  const today = new Date()
  const start = dateFilter?.startDate ? parseBusinessDate(dateFilter.startDate) : null
  const end = dateFilter?.endDate ? parseBusinessDate(dateFilter.endDate) : null

  if (start && end) {
    return { start, end }
  }

  if (dateFilter?.mode === 'month') {
    const selectedMonthStart = new Date(dateFilter.year, dateFilter.month, 1)
    const selectedMonthEnd = dateFilter.year === today.getFullYear() && dateFilter.month === today.getMonth()
      ? today
      : new Date(dateFilter.year, dateFilter.month + 1, 0)
    return { start: selectedMonthStart, end: selectedMonthEnd }
  }

  return {
    start: new Date(today.getFullYear(), today.getMonth(), 1),
    end: today,
  }
}

function formatCurrencyFull(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0
  const sign = safeValue < 0 ? '-' : ''
  return `${sign}\u20b9${Math.abs(safeValue).toLocaleString('en-IN', {
    minimumFractionDigits: Math.abs(safeValue % 1) > 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

type ExecutiveComparisonMetric = {
  cy: number
  ly: number
  deltaPct: number
}

type ExecutiveHealthModel = {
  title: string
  score: number
  previousScore: number | null
  status: string
  confidence: 'High Confidence' | 'Medium Confidence' | 'Limited Confidence'
  scoreDrivers: {
    positive: string[]
    negative: string[]
  }
  kpiStrip: ExecutiveMetricCard[]
  target: {
    label: string
    target: string
    achieved: string
    percent: number | null
    status: string
  }
  topDriver: ExecutiveMetricCard
  biggestConcern: ExecutiveMetricCard
  cards: {
    drivers: ExecutiveInsightCard
    risks: ExecutiveInsightCard
    opportunities: ExecutiveInsightCard
    focus: ExecutiveInsightCard
  }
  components: Array<{ label: string; score: number; helper: string }>
}

type ExecutiveTone = 'neutral' | 'good' | 'warning' | 'risk'

type ExecutiveMetricCard = {
  label: string
  value: string
  helper?: string
  tone?: ExecutiveTone
}

type ExecutiveInsightCard = {
  title: string
  items: ExecutiveMetricCard[]
  tone?: ExecutiveTone
}

type ExecutiveRequest = {
  endpoint: string
  timingLabel: string
}

type ExecutiveMetricPeriod = {
  cy: number
  ly: number | 'N/A'
  growth: number | string
}

type ExecutiveMetricRow = {
  name: string
  depth?: number
  metrics?: {
    mtd?: ExecutiveMetricPeriod
  }
  children?: ExecutiveMetricRow[]
}

type ExecutiveRoBillingData = {
  byMetric?: Partial<Record<ROAnalysisType, { rows?: ExecutiveMetricRow[] }>>
  cancelledSummary?: { total?: number }
}

type ExecutiveWorkshopData = {
  kpis?: Record<string, { value?: number; ly?: number; growth?: number | null }>
  rows?: Array<Record<string, unknown>>
}

type ExecutiveOpenRoData = {
  kpis?: {
    totalOpenRo?: number
    avgAging?: number
    over15Days?: number
    delayedRo?: number
  }
  rows?: Array<{ serviceType?: string; totalWip?: number; avgDays?: number; bucketOver15?: number }>
}

type ExecutiveComplaintsData = {
  kpis?: {
    total?: number
    open?: number
    closed?: number
    over15?: number
    delayRelated?: number
    avgResolutionDays?: number
  }
  comparison?: {
    currentPeriod?: { count?: number; open?: number; avgDays?: number }
    previousPeriod?: { count?: number; open?: number; avgDays?: number }
  }
  charts?: {
    areaBreakdown?: Array<{ name?: string; total?: number; open?: number; avgDays?: number }>
  }
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function scoreFromGrowth(growth: number | null | undefined, fallback = 72) {
  if (!Number.isFinite(Number(growth))) return fallback
  return clampScore(70 + Number(growth) * 1.35)
}

function scoreFromPressure(value: number | null | undefined, warningPoint: number, penalty = 2.2) {
  const safeValue = Number(value || 0)
  return clampScore(92 - Math.max(safeValue - warningPoint, 0) * penalty - Math.min(safeValue, warningPoint) * 0.45)
}

function executiveStatus(score: number) {
  if (score >= 90) return 'EXCELLENT'
  if (score >= 75) return 'GOOD'
  if (score >= 60) return 'WATCH'
  return 'CRITICAL'
}

function numberOrZero(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function metricGrowth(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : null
}

function scoreAgainstTarget(value: number, target: number, floor = 35) {
  if (target <= 0) return 70
  return clampScore(Math.max(floor, Math.min(100, (value / target) * 85)))
}

function scoreTrendLabel(previousScore: number | null, score: number) {
  if (previousScore === null) return 'Previous: insufficient history'
  const delta = score - previousScore
  return `${previousScore} previous / ${delta >= 0 ? '+' : ''}${delta} ${delta >= 0 ? 'improvement' : 'decline'}`
}

function topList(items: Array<string | null | false | undefined>, fallback: string, limit = 3) {
  const filtered = items.filter(Boolean) as string[]
  return (filtered.length ? filtered : [fallback]).slice(0, limit)
}

function targetPercent(achieved: number, target: number, mode: 'higher' | 'lower' = 'higher') {
  if (target <= 0) return null
  const percent = mode === 'higher' ? (achieved / target) * 100 : (target / Math.max(achieved, 1)) * 100
  return Math.max(0, Math.min(999, percent))
}

function targetStatus(percent: number | null) {
  if (percent === null) return 'LIMITED'
  if (percent >= 90) return 'EXCELLENT'
  if (percent >= 75) return 'GOOD'
  if (percent >= 60) return 'WATCH'
  return 'CRITICAL'
}

function formatPlainNumber(value: number) {
  return Math.round(value).toLocaleString('en-IN')
}

function targetCard(label: string, target: number, achieved: number, mode: 'higher' | 'lower' = 'higher', formatter: (value: number) => string = formatPlainNumber) {
  const percent = targetPercent(achieved, target, mode)
  return {
    label,
    target: formatter(target),
    achieved: formatter(achieved),
    percent,
    status: targetStatus(percent),
  }
}

function metricCard(label: string, value: string, helper?: string, tone: ExecutiveTone = 'neutral'): ExecutiveMetricCard {
  return { label, value, helper, tone }
}

function itemCards(items: Array<ExecutiveMetricCard | null | false | undefined>, fallback: ExecutiveMetricCard, limit = 3) {
  const filtered = items.filter(Boolean) as ExecutiveMetricCard[]
  return filtered.length ? filtered.slice(0, limit) : [fallback]
}

function buildExecutiveRequest(reportName: string, dateFilter: BusinessDateFilter, dealerCode?: string | null): ExecutiveRequest {
  const range = getDefaultRODateRange(dateFilter)
  const params = new URLSearchParams(range)
  appendBusinessComparisonParams(params, dateFilter)
  appendKiaDealerCodeParam(params, dealerCode)

  if (reportName.toLowerCase().includes('ro billing')) {
    params.set('brand', 'platinum')
    params.set('sheet', 'am_platinum_ro_billing_report')
    params.set('view', 'table')
    params.set('groupBy', 'work_type')
    params.set('metrics', 'all')
    return {
      endpoint: `/api/brands/platinum/business-excellence/ro-billing-analysis?${params.toString()}`,
      timingLabel: 'business-excellence-executive-ro-billing',
    }
  }

  if (reportName === WORKSHOP_PERFORMANCE_REPORT) {
    return {
      endpoint: `/api/brands/platinum/business-excellence/workshop-performance?${params.toString()}`,
      timingLabel: 'business-excellence-executive-workshop',
    }
  }

  if (reportName === OPEN_RO_REPORT) {
    params.set('chunk', 'summary')
    return {
      endpoint: `/api/brands/platinum/business-excellence/open-ro?${params.toString()}`,
      timingLabel: 'business-excellence-executive-open-ro',
    }
  }

  if (reportName === PLATINUM_COMPLAINTS_REPORT) {
    params.set('chunk', 'summary')
    return {
      endpoint: `/api/brands/platinum/business-excellence/complaints?${params.toString()}`,
      timingLabel: 'business-excellence-executive-complaints',
    }
  }

  params.set('chunk', 'summary')
  return {
    endpoint: `/api/brands/platinum/business-excellence/overview?${params.toString()}`,
    timingLabel: 'business-excellence-executive-overview',
  }
}

function roMetricTotal(data: ExecutiveRoBillingData | undefined, metric: ROAnalysisType, field: keyof ExecutiveMetricPeriod = 'cy') {
  const rows = data?.byMetric?.[metric]?.rows || []
  return rows
    .filter((row) => (row.depth || 0) === 0)
    .reduce((sum, row) => sum + numberOrZero(row.metrics?.mtd?.[field]), 0)
}

function buildRoBillingHealth(payload: unknown): ExecutiveHealthModel {
  const data = (payload ?? {}) as ExecutiveRoBillingData
  const load = roMetricTotal(data, 'load')
  const loadLy = roMetricTotal(data, 'load', 'ly')
  const labour = roMetricTotal(data, 'labour')
  const labourLy = roMetricTotal(data, 'labour', 'ly')
  const parts = roMetricTotal(data, 'parts')
  const partsLy = roMetricTotal(data, 'parts', 'ly')
  const revenue = labour + parts
  const revenueLy = labourLy + partsLy
  const billingQuality = load > 0 ? revenue / load : 0
  const previousBillingQuality = loadLy > 0 ? revenueLy / loadLy : 0
  const revenueGrowth = metricGrowth(revenue, revenueLy)
  const labourGrowth = metricGrowth(labour, labourLy)
  const partsGrowth = metricGrowth(parts, partsLy)
  const loadGrowth = metricGrowth(load, loadLy)
  const partsShare = revenue > 0 ? (parts / revenue) * 100 : 0
  const labourShare = revenue > 0 ? (labour / revenue) * 100 : 0
  const revenueScore = scoreFromGrowth(revenueGrowth)
  const labourScore = scoreFromGrowth(labourGrowth)
  const partsScore = scoreFromGrowth(partsGrowth)
  const loadScore = scoreFromGrowth(loadGrowth)
  const qualityScore = scoreAgainstTarget(billingQuality, Math.max(previousBillingQuality, 1), 45)
  const score = clampScore(revenueScore * 0.28 + labourScore * 0.2 + partsScore * 0.2 + loadScore * 0.17 + qualityScore * 0.15)
  const previousScore = revenueLy > 0 ? clampScore(70 + Math.min(Math.max(metricGrowth(revenueLy, revenue) || 0, -20), 20) * 0.4) : null
  const cancelledTotal = numberOrZero(data.cancelledSummary?.total)
  const billingQualityGap = Math.max(previousBillingQuality - billingQuality, 0)
  const revenueAtRisk = cancelledTotal + billingQualityGap * load
  const target = targetCard('Revenue Target', EXECUTIVE_TARGETS.roBilling.revenue, revenue, 'higher', formatCurrency)
  const topDriver = partsGrowth !== null && partsGrowth >= Math.max(labourGrowth ?? -999, revenueGrowth ?? -999)
    ? metricCard('Top Driver', 'Parts Revenue Growth', formatSignedGrowth(partsGrowth), 'good')
    : labourGrowth !== null && labourGrowth >= Math.max(partsGrowth ?? -999, revenueGrowth ?? -999)
      ? metricCard('Top Driver', 'Labour Revenue Growth', formatSignedGrowth(labourGrowth), 'good')
      : metricCard('Top Driver', 'Billing Revenue', formatCurrency(revenue), 'good')
  const biggestConcern = cancelledTotal > 0
    ? metricCard('Biggest Concern', 'Cancelled Billing', formatCurrency(cancelledTotal), 'risk')
    : billingQualityGap > 0
      ? metricCard('Biggest Concern', 'Billing Quality Gap', `${formatCurrency(billingQualityGap)} / RO`, 'risk')
      : metricCard('Biggest Concern', 'Discount Leakage', `Below ${formatCurrency(EXECUTIVE_TARGETS.roBilling.maxDiscountLeakage)} watch level`, 'warning')

  return {
    title: 'RO Billing Health',
    score,
    previousScore,
    status: executiveStatus(score),
    confidence: revenueLy > 0 ? 'High Confidence' : 'Medium Confidence',
    scoreDrivers: {
      positive: topList([
        revenueGrowth !== null && revenueGrowth > 0 && `Revenue ${formatSignedGrowth(revenueGrowth)}`,
        partsGrowth !== null && partsGrowth > 0 && `Parts ${formatSignedGrowth(partsGrowth)}`,
        labourGrowth !== null && labourGrowth > 0 && `Labour ${formatSignedGrowth(labourGrowth)}`,
      ], 'Billing quality is the primary support signal', 2),
      negative: topList([
        revenueGrowth !== null && revenueGrowth < 0 && `Revenue ${formatSignedGrowth(revenueGrowth)}`,
        labourGrowth !== null && labourGrowth < 0 && `Labour ${formatSignedGrowth(labourGrowth)}`,
        partsGrowth !== null && partsGrowth < 0 && `Parts ${formatSignedGrowth(partsGrowth)}`,
        cancelledTotal > 0 && `Cancelled billing ${formatCurrency(cancelledTotal)}`,
      ], 'No major billing detractor', 2),
    },
    kpiStrip: [
      metricCard('Revenue', formatCurrency(revenue), `${formatSignedGrowth(revenueGrowth ?? 'N/A')} vs comparison`, revenueGrowth !== null && revenueGrowth < 0 ? 'risk' : 'good'),
      metricCard('Revenue At Risk', formatCurrency(revenueAtRisk), 'Cancelled billing + billing quality gap', revenueAtRisk > 0 ? 'risk' : 'good'),
      metricCard('Top Contributor', parts > labour ? 'Parts' : 'Labour', `${Math.max(partsShare, labourShare).toFixed(1)}% of billing`, 'neutral'),
      metricCard('Weakest Area', labourGrowth !== null && labourGrowth < partsGrowth! ? 'Labour' : 'Billing Quality', `${formatCurrency(billingQuality)} / RO`, 'warning'),
      metricCard('Target Achievement', target.percent === null ? 'N/A' : `${target.percent.toFixed(1)}%`, target.status, target.percent !== null && target.percent < 75 ? 'risk' : 'good'),
    ],
    target,
    topDriver,
    biggestConcern,
    cards: {
      drivers: {
        title: 'Revenue Drivers',
        items: [
          metricCard('Parts Revenue', formatCurrency(parts), `${partsShare.toFixed(1)}% share`, 'neutral'),
          metricCard('Labour Revenue', formatCurrency(labour), `${labourShare.toFixed(1)}% share`, 'neutral'),
          metricCard('Billed RO Load', load.toLocaleString('en-IN'), `${formatCurrency(billingQuality)} / RO`, 'neutral'),
        ],
      },
      risks: {
        title: 'Revenue Risks',
        tone: 'risk',
        items: itemCards([
          cancelledTotal > 0 && metricCard('Cancelled Billing', formatCurrency(cancelledTotal), 'Direct leakage', 'risk'),
          billingQualityGap > 0 && metricCard('Billing Quality Gap', formatCurrency(billingQualityGap * load), `${formatCurrency(billingQualityGap)} / RO below comparison`, 'risk'),
          loadGrowth !== null && loadGrowth < 0 && metricCard('RO Load Drop', formatSignedGrowth(loadGrowth), 'Lower load can reduce revenue', 'warning'),
        ], metricCard('Leakage Watch', 'Controlled', 'No major revenue leakage signal', 'good')),
      },
      opportunities: {
        title: 'Revenue Opportunities',
        tone: 'good',
        items: [
          metricCard('Labour / Vehicle Lift', formatCurrency(labour * 0.1), '10% improvement potential', 'good'),
          metricCard('Parts / Vehicle Lift', formatCurrency(parts * 0.1), '10% improvement potential', 'good'),
          metricCard('Billing Quality', formatCurrency(Math.max(EXECUTIVE_TARGETS.roBilling.labourPerVehicle + EXECUTIVE_TARGETS.roBilling.partsPerVehicle - billingQuality, 0) * load), 'Target billing mix gap', 'good'),
        ],
      },
      focus: {
        title: 'Focus Areas',
        items: [
          metricCard('Improve Labour / Vehicle', formatCurrency(billingQuality), 'Raise average billing quality', 'neutral'),
          metricCard('Reduce Discount Leakage', formatCurrency(cancelledTotal), 'Review cancelled/discounted billing', 'warning'),
          metricCard('Protect RO Load', load.toLocaleString('en-IN'), 'Keep billed job-card flow steady', 'neutral'),
        ],
      },
    },
    components: [
      { label: 'Revenue Growth', score: revenueScore, helper: `${formatSignedGrowth(revenueGrowth ?? 'N/A')} vs comparison` },
      { label: 'Labour Growth', score: labourScore, helper: `${formatSignedGrowth(labourGrowth ?? 'N/A')} labour` },
      { label: 'Parts Growth', score: partsScore, helper: `${formatSignedGrowth(partsGrowth ?? 'N/A')} parts` },
      { label: 'Billing Quality', score: qualityScore, helper: `${formatCurrency(billingQuality)} per RO` },
    ],
  }
}

function buildWorkshopHealth(payload: unknown): ExecutiveHealthModel {
  const data = (payload ?? {}) as ExecutiveWorkshopData
  const kpis = data.kpis || {}
  const revenue = numberOrZero(kpis.totalRevenue?.value)
  const labour = numberOrZero(kpis.labourAmount?.value)
  const parts = numberOrZero(kpis.spareSale?.value)
  const vas = numberOrZero(kpis.vasAmount?.value)
  const totalJc = numberOrZero(kpis.totalJc?.value)
  const labPerRo = numberOrZero(kpis.labourPerRo?.value)
  const sparePerRo = numberOrZero(kpis.sparePerRo?.value)
  const revenueGrowth = kpis.totalRevenue?.growth
  const labPerRoGrowth = kpis.labourPerRo?.growth
  const partsGrowth = kpis.spareSale?.growth
  const vasGrowth = kpis.vasAmount?.growth
  const rows = data.rows || []
  const mech = rows.find((row) => row.serviceType === 'MECH')
  const accident = rows.find((row) => row.serviceType === 'Accident')
  const mechRevenue = numberOrZero(mech?.labourAmount) + numberOrZero(mech?.spareSale)
  const accidentRevenue = numberOrZero(accident?.labourAmount) + numberOrZero(accident?.spareSale)
  const waCount = rows.reduce((sum, row) => sum + numberOrZero(row.waCount), 0)
  const wbCount = rows.reduce((sum, row) => sum + numberOrZero(row.wbCount), 0)
  const vasPenetration = labour > 0 ? (vas / labour) * 100 : 0
  const revenueScore = scoreFromGrowth(Number(revenueGrowth))
  const labourEfficiencyScore = scoreFromGrowth(Number(labPerRoGrowth))
  const partsScore = scoreFromGrowth(Number(partsGrowth))
  const vasScore = scoreAgainstTarget(vasPenetration, 20, 35)
  const addonScore = scoreAgainstTarget(waCount + wbCount, Math.max(totalJc * 0.35, 1), 35)
  const score = clampScore(revenueScore * 0.25 + labourEfficiencyScore * 0.22 + partsScore * 0.2 + vasScore * 0.18 + addonScore * 0.15)
  const previousScore = numberOrZero(kpis.totalRevenue?.ly) > 0 ? 70 : null
  const addonPenetration = totalJc > 0 ? ((waCount + wbCount) / totalJc) * 100 : 0
  const revenueAtRisk = Math.max(EXECUTIVE_TARGETS.workshop.labourPerRo - labPerRo, 0) * totalJc
  const target = targetCard('Workshop Revenue Target', EXECUTIVE_TARGETS.workshop.revenue, revenue, 'higher', formatCurrency)
  const topDriver = accidentRevenue > mechRevenue
    ? metricCard('Top Driver', 'Accident Revenue', formatCurrency(accidentRevenue), 'good')
    : metricCard('Top Driver', 'MECH Revenue', formatCurrency(mechRevenue), 'good')
  const biggestConcern = addonPenetration < EXECUTIVE_TARGETS.workshop.addonPenetrationPct
    ? metricCard('Biggest Concern', 'Low WA/WB Penetration', `${addonPenetration.toFixed(1)}%`, 'risk')
    : vasPenetration < EXECUTIVE_TARGETS.workshop.vasPenetrationPct
      ? metricCard('Biggest Concern', 'Low VAS Penetration', `${vasPenetration.toFixed(1)}%`, 'risk')
      : metricCard('Biggest Concern', 'Labour / RO Watch', formatCurrency(labPerRo), 'warning')

  return {
    title: 'Workshop Health',
    score,
    previousScore,
    status: executiveStatus(score),
    confidence: numberOrZero(kpis.totalRevenue?.ly) > 0 ? 'High Confidence' : 'Medium Confidence',
    scoreDrivers: {
      positive: topList([
        Number(revenueGrowth) > 0 && `Revenue ${formatSignedGrowth(Number(revenueGrowth))}`,
        Number(partsGrowth) > 0 && `Parts ${formatSignedGrowth(Number(partsGrowth))}`,
        Number(vasGrowth) > 0 && `VAS ${formatSignedGrowth(Number(vasGrowth))}`,
      ], 'Workshop revenue mix is holding', 2),
      negative: topList([
        Number(labPerRoGrowth) < 0 && `Labour / RO ${formatSignedGrowth(Number(labPerRoGrowth))}`,
        addonPenetration < EXECUTIVE_TARGETS.workshop.addonPenetrationPct && `WA/WB penetration ${addonPenetration.toFixed(1)}%`,
        vasPenetration < EXECUTIVE_TARGETS.workshop.vasPenetrationPct && `VAS penetration ${vasPenetration.toFixed(1)}%`,
      ], 'No major workshop detractor', 2),
    },
    kpiStrip: [
      metricCard('Revenue', formatCurrency(revenue), `${formatSignedGrowth(revenueGrowth ?? 'N/A')} total`, Number(revenueGrowth) < 0 ? 'risk' : 'good'),
      metricCard('Revenue At Risk', formatCurrency(revenueAtRisk), 'Labour / RO target gap', revenueAtRisk > 0 ? 'risk' : 'good'),
      metricCard('Top Contributor', accidentRevenue > mechRevenue ? 'Accident' : 'MECH', formatCurrency(Math.max(accidentRevenue, mechRevenue)), 'neutral'),
      metricCard('Weakest Area', addonPenetration < vasPenetration ? 'WA / WB' : 'VAS', `${Math.min(addonPenetration, vasPenetration).toFixed(1)}%`, 'warning'),
      metricCard('Target Achievement', target.percent === null ? 'N/A' : `${target.percent.toFixed(1)}%`, target.status, target.percent !== null && target.percent < 75 ? 'risk' : 'good'),
    ],
    target,
    topDriver,
    biggestConcern,
    cards: {
      drivers: {
        title: 'Workshop Drivers',
        items: [
          metricCard('MECH Contribution', formatCurrency(mechRevenue), `${revenue > 0 ? ((mechRevenue / revenue) * 100).toFixed(1) : '0.0'}% share`, 'neutral'),
          metricCard('Accident Contribution', formatCurrency(accidentRevenue), `${revenue > 0 ? ((accidentRevenue / revenue) * 100).toFixed(1) : '0.0'}% share`, 'neutral'),
          metricCard('Parts / RO', formatCurrency(sparePerRo), `${formatSignedGrowth(partsGrowth ?? 'N/A')} parts`, 'neutral'),
        ],
      },
      risks: {
        title: 'Workshop Risks',
        tone: 'risk',
        items: itemCards([
          Number(labPerRoGrowth) < 0 && metricCard('Labour / RO Decline', formatSignedGrowth(Number(labPerRoGrowth)), formatCurrency(labPerRo), 'risk'),
          addonPenetration < EXECUTIVE_TARGETS.workshop.addonPenetrationPct && metricCard('WA/WB Gap', `${addonPenetration.toFixed(1)}%`, `${waCount + wbCount} add-ons from ${totalJc} JC`, 'risk'),
          vasPenetration < EXECUTIVE_TARGETS.workshop.vasPenetrationPct && metricCard('VAS Gap', `${vasPenetration.toFixed(1)}%`, formatCurrency(vas), 'warning'),
        ], metricCard('Operating Risk', 'Controlled', 'No major workshop risk signal', 'good')),
      },
      opportunities: {
        title: 'Workshop Opportunities',
        tone: 'good',
        items: [
          metricCard('Labour Efficiency Lift', formatCurrency(labour * 0.1), '10% upside', 'good'),
          metricCard('Parts Efficiency Lift', formatCurrency(parts * 0.1), '10% upside', 'good'),
          metricCard('Addon Conversion', `${Math.max(Math.round(totalJc * 0.35 - (waCount + wbCount)), 0)} jobs`, 'WA/WB target gap', 'good'),
        ],
      },
      focus: {
        title: 'Focus Areas',
        items: [
          metricCard('Improve WA Conversion', `${waCount} WA`, `${EXECUTIVE_TARGETS.workshop.addonPenetrationPct}% addon target`, 'warning'),
          metricCard('Increase VAS Penetration', `${vasPenetration.toFixed(1)}%`, `${EXECUTIVE_TARGETS.workshop.vasPenetrationPct}% target`, 'warning'),
          metricCard('Protect Labour / RO', formatCurrency(labPerRo), `${formatCurrency(EXECUTIVE_TARGETS.workshop.labourPerRo)} target`, 'neutral'),
        ],
      },
    },
    components: [
      { label: 'Revenue Mix', score: revenueScore, helper: `${formatSignedGrowth(revenueGrowth ?? 'N/A')} total revenue` },
      { label: 'Labour / RO', score: labourEfficiencyScore, helper: `${formatCurrency(labPerRo)} per RO` },
      { label: 'Parts / RO', score: partsScore, helper: `${formatCurrency(sparePerRo)} per RO` },
      { label: 'VAS / WA / WB', score: clampScore((vasScore + addonScore) / 2), helper: `${waCount} WA / ${wbCount} WB` },
    ],
  }
}

function buildOpenRoHealth(payload: unknown): ExecutiveHealthModel {
  const data = (payload ?? {}) as ExecutiveOpenRoData
  const kpis = data.kpis || {}
  const total = numberOrZero(kpis.totalOpenRo)
  const delayed = numberOrZero(kpis.delayedRo)
  const over15 = numberOrZero(kpis.over15Days)
  const avgAging = numberOrZero(kpis.avgAging)
  const score = clampScore(94 - avgAging * 3.2 - delayed * 4.5 - over15 * 2.8)
  const closureScore = scoreAgainstTarget(Math.max(20 - avgAging, 0), 20, 25)
  const agingScore = clampScore(100 - avgAging * 6)
  const delayScore = clampScore(100 - delayed * 8)
  const wipScore = clampScore(100 - total * 1.4)
  const topWip = [...(data.rows || [])].sort((a, b) => numberOrZero(b.totalWip) - numberOrZero(a.totalWip))[0]
  const target = targetCard('Open RO Control Target', EXECUTIVE_TARGETS.openRo.maxOpenRo, total, 'lower')
  const riskLoad = over15 + delayed
  const topDriver = avgAging <= EXECUTIVE_TARGETS.openRo.maxAvgAgingDays
    ? metricCard('Top Driver', 'Fast Closure Rate', `${avgAging.toFixed(1)}D avg`, 'good')
    : metricCard('Top Driver', 'WIP Visibility', `${total} open RO`, 'neutral')
  const biggestConcern = over15 > 0
    ? metricCard('Biggest Concern', '15+ Day Aging', `${over15} vehicles`, 'risk')
    : delayed > 0
      ? metricCard('Biggest Concern', 'Delayed RO', `${delayed} jobs`, 'risk')
      : metricCard('Biggest Concern', 'Average Aging', `${avgAging.toFixed(1)}D`, avgAging > EXECUTIVE_TARGETS.openRo.maxAvgAgingDays ? 'warning' : 'good')

  return {
    title: 'Open RO Health',
    score,
    previousScore: null,
    status: executiveStatus(score),
    confidence: 'Limited Confidence',
    scoreDrivers: {
      positive: topList([
        avgAging <= EXECUTIVE_TARGETS.openRo.maxAvgAgingDays && `Avg aging ${avgAging.toFixed(1)}D`,
        delayed === 0 && 'No delayed RO',
        over15 === 0 && 'No 15+ day vehicle',
      ], 'Open RO queue is visible for daily control', 2),
      negative: topList([
        avgAging > EXECUTIVE_TARGETS.openRo.maxAvgAgingDays && `Avg aging ${avgAging.toFixed(1)}D`,
        delayed > 0 && `${delayed} delayed RO`,
        over15 > 0 && `${over15} vehicles above 15D`,
      ], 'No major WIP detractor', 2),
    },
    kpiStrip: [
      metricCard('Open RO', total.toLocaleString('en-IN'), 'Current WIP load', total > EXECUTIVE_TARGETS.openRo.maxOpenRo ? 'warning' : 'good'),
      metricCard('Operational Risk', riskLoad.toLocaleString('en-IN'), 'Delayed + 15D vehicles', riskLoad > 0 ? 'risk' : 'good'),
      metricCard('Top WIP Bucket', topWip?.serviceType || 'No pressure', topWip ? `${numberOrZero(topWip.totalWip)} jobs` : 'Clean queue', 'neutral'),
      metricCard('Weakest Area', over15 > 0 ? '>15D Aging' : 'Closure Velocity', `${avgAging.toFixed(1)}D avg`, over15 > 0 || avgAging > 5 ? 'risk' : 'good'),
      metricCard('Target Achievement', target.percent === null ? 'N/A' : `${target.percent.toFixed(1)}%`, target.status, target.percent !== null && target.percent < 75 ? 'risk' : 'good'),
    ],
    target,
    topDriver,
    biggestConcern,
    cards: {
      drivers: {
        title: 'Operational Drivers',
        items: [
          metricCard('WIP Load', total.toLocaleString('en-IN'), 'Open repair orders', 'neutral'),
          metricCard('Average Aging', `${avgAging.toFixed(1)}D`, `${EXECUTIVE_TARGETS.openRo.maxAvgAgingDays}D target`, avgAging > 5 ? 'warning' : 'good'),
          metricCard('Top Bucket', topWip?.serviceType || 'No pressure', topWip ? `${numberOrZero(topWip.totalWip)} jobs` : 'No dominant bucket', 'neutral'),
        ],
      },
      risks: {
        title: 'Operational Risks',
        tone: 'risk',
        items: itemCards([
          over15 > 0 && metricCard('15+ Day Vehicles', over15.toLocaleString('en-IN'), 'Delayed billing conversion', 'risk'),
          delayed > 0 && metricCard('Delayed RO', delayed.toLocaleString('en-IN'), 'Promise/closure risk', 'risk'),
          avgAging > EXECUTIVE_TARGETS.openRo.maxAvgAgingDays && metricCard('Aging Pressure', `${avgAging.toFixed(1)}D`, 'Slower closure velocity', 'warning'),
        ], metricCard('WIP Risk', 'Controlled', 'No major operational aging signal', 'good')),
      },
      opportunities: {
        title: 'Operational Opportunities',
        tone: 'good',
        items: [
          metricCard('Close 20% WIP', Math.ceil(total * 0.2).toLocaleString('en-IN'), 'Fast queue reduction lever', 'good'),
          metricCard('Attack 15D First', over15.toLocaleString('en-IN'), 'Highest priority closure queue', over15 > 0 ? 'warning' : 'good'),
          metricCard('Clear Delays', delayed.toLocaleString('en-IN'), 'Recover closure velocity', delayed > 0 ? 'warning' : 'good'),
        ],
      },
      focus: {
        title: 'Focus Areas',
        items: [
          metricCard('Reduce >15D Vehicles', over15.toLocaleString('en-IN'), 'Daily escalation queue', 'risk'),
          metricCard('Improve Closure Velocity', `${avgAging.toFixed(1)}D`, 'Bring average aging down', 'warning'),
          metricCard('Close Delayed RO', delayed.toLocaleString('en-IN'), 'Protect billing conversion', 'warning'),
        ],
      },
    },
    components: [
      { label: 'WIP Health', score: wipScore, helper: `${total} open ROs` },
      { label: 'Aging', score: agingScore, helper: `${avgAging.toFixed(1)} avg days` },
      { label: 'Delayed RO', score: delayScore, helper: `${delayed} delayed` },
      { label: 'Closure Velocity', score: closureScore, helper: `${over15} above 15 days` },
    ],
  }
}

function buildComplaintHealth(payload: unknown): ExecutiveHealthModel {
  const data = (payload ?? {}) as ExecutiveComplaintsData
  const kpis = data.kpis || {}
  const total = numberOrZero(kpis.total)
  const open = numberOrZero(kpis.open)
  const closed = numberOrZero(kpis.closed)
  const over15 = numberOrZero(kpis.over15)
  const avgDays = numberOrZero(kpis.avgResolutionDays)
  const closureRate = total > 0 ? (closed / total) * 100 : 100
  const current = data.comparison?.currentPeriod
  const previous = data.comparison?.previousPeriod
  const currentScore = clampScore(closureRate - open * 4 - over15 * 5 - Math.max(avgDays - 3, 0) * 3)
  const previousTotal = numberOrZero(previous?.count)
  const previousOpen = numberOrZero(previous?.open)
  const previousAvgDays = numberOrZero(previous?.avgDays)
  const previousScore = previousTotal > 0 ? clampScore(90 - previousOpen * 4 - Math.max(previousAvgDays - 3, 0) * 3) : null
  const topArea = [...(data.charts?.areaBreakdown || [])].sort((a, b) => numberOrZero(b.total) - numberOrZero(a.total))[0]
  const complaintGrowth = metricGrowth(numberOrZero(current?.count), previousTotal)
  const target = targetCard('Complaint Closure Target', EXECUTIVE_TARGETS.complaints.closureRatePct, closureRate, 'higher', (value) => `${value.toFixed(0)}%`)
  const customerRisk = open + over15
  const topDriver = closureRate >= EXECUTIVE_TARGETS.complaints.closureRatePct
    ? metricCard('Top Driver', 'Closure Rate', `${closureRate.toFixed(1)}%`, 'good')
    : metricCard('Top Driver', 'Closed Complaints', closed.toLocaleString('en-IN'), 'neutral')
  const biggestConcern = over15 > 0
    ? metricCard('Biggest Concern', 'Complaint Aging', `${over15} over 15D`, 'risk')
    : open > EXECUTIVE_TARGETS.complaints.maxOpenComplaints
      ? metricCard('Biggest Concern', 'Open Complaints', open.toLocaleString('en-IN'), 'risk')
      : metricCard('Biggest Concern', 'Resolution Days', `${avgDays.toFixed(1)}D`, avgDays > EXECUTIVE_TARGETS.complaints.maxAvgResolutionDays ? 'warning' : 'good')

  return {
    title: 'Customer Health',
    score: currentScore,
    previousScore,
    status: executiveStatus(currentScore),
    confidence: previousTotal > 0 ? 'High Confidence' : 'Medium Confidence',
    scoreDrivers: {
      positive: topList([
        closureRate >= EXECUTIVE_TARGETS.complaints.closureRatePct && `Closure rate ${closureRate.toFixed(1)}%`,
        open === 0 && 'No open complaint backlog',
        complaintGrowth !== null && complaintGrowth < 0 && `Complaints down ${Math.abs(complaintGrowth).toFixed(1)}%`,
      ], 'Customer closure visibility is available', 2),
      negative: topList([
        open > 0 && `${open} open complaints`,
        over15 > 0 && `${over15} complaints above 15D`,
        complaintGrowth !== null && complaintGrowth > 0 && `Complaints up ${complaintGrowth.toFixed(1)}%`,
      ], 'No major customer detractor', 2),
    },
    kpiStrip: [
      metricCard('Complaints', total.toLocaleString('en-IN'), `${open} open`, open > 0 ? 'warning' : 'good'),
      metricCard('Customer Risk', customerRisk.toLocaleString('en-IN'), 'Open + aged complaints', customerRisk > 0 ? 'risk' : 'good'),
      metricCard('Top Complaint Area', topArea?.name || 'No concentration', topArea ? `${numberOrZero(topArea.total)} cases` : 'Clean', 'neutral'),
      metricCard('Weakest Area', over15 > 0 ? 'Aging' : 'Closure Rate', `${avgDays.toFixed(1)}D avg`, over15 > 0 || avgDays > 3 ? 'risk' : 'good'),
      metricCard('Target Achievement', target.percent === null ? 'N/A' : `${target.percent.toFixed(1)}%`, target.status, target.percent !== null && target.percent < 75 ? 'risk' : 'good'),
    ],
    target,
    topDriver,
    biggestConcern,
    cards: {
      drivers: {
        title: 'Complaint Drivers',
        items: [
          metricCard('Closure Rate', `${closureRate.toFixed(1)}%`, `${closed} closed / ${total} total`, closureRate >= 90 ? 'good' : 'warning'),
          metricCard('Open Backlog', open.toLocaleString('en-IN'), 'Current customer pressure', open > 0 ? 'warning' : 'good'),
          metricCard('Top Area', topArea?.name || 'No concentration', topArea ? `${numberOrZero(topArea.total)} complaints` : 'No dominant area', 'neutral'),
        ],
      },
      risks: {
        title: 'Customer Risks',
        tone: 'risk',
        items: itemCards([
          open > 0 && metricCard('Open Complaints', open.toLocaleString('en-IN'), 'Can affect repeat visits', 'risk'),
          over15 > 0 && metricCard('Aged Complaints', over15.toLocaleString('en-IN'), 'CSI risk', 'risk'),
          avgDays > EXECUTIVE_TARGETS.complaints.maxAvgResolutionDays && metricCard('Resolution Time', `${avgDays.toFixed(1)}D`, 'Above target', 'warning'),
        ], metricCard('Customer Risk', 'Controlled', 'No major complaint pressure', 'good')),
      },
      opportunities: {
        title: 'Customer Opportunities',
        tone: 'good',
        items: [
          metricCard('Close Open Cases', open.toLocaleString('en-IN'), 'Fastest CSI improvement', open > 0 ? 'warning' : 'good'),
          metricCard('Reduce Aging', `${avgDays.toFixed(1)}D`, `${EXECUTIVE_TARGETS.complaints.maxAvgResolutionDays}D target`, 'good'),
          metricCard('Root-Cause Area', topArea?.name || 'No concentration', topArea ? 'Use area action plan' : 'Monitor new cases', 'neutral'),
        ],
      },
      focus: {
        title: 'Focus Areas',
        items: [
          metricCard('Reduce Complaint Aging', `${avgDays.toFixed(1)}D`, 'Protect CSI', 'warning'),
          metricCard('Improve Closure Rate', `${closureRate.toFixed(1)}%`, `${EXECUTIVE_TARGETS.complaints.closureRatePct}% target`, 'warning'),
          metricCard('Clear Open Complaints', open.toLocaleString('en-IN'), 'Daily customer callback queue', 'risk'),
        ],
      },
    },
    components: [
      { label: 'Closure Rate', score: clampScore(closureRate), helper: `${closureRate.toFixed(1)}% closed` },
      { label: 'Open Complaints', score: clampScore(100 - open * 8), helper: `${open} open` },
      { label: 'Aging', score: clampScore(100 - avgDays * 6), helper: `${avgDays.toFixed(1)} avg days` },
      { label: 'Repeat Risk', score: clampScore(100 - over15 * 10), helper: `${over15} over 15 days` },
    ],
  }
}

function buildOverviewHealth(payload: unknown): ExecutiveHealthModel {
  const data = (payload ?? {}) as { comparison?: { revenue?: ExecutiveComparisonMetric; avgBilling?: ExecutiveComparisonMetric; openRo?: ExecutiveComparisonMetric; complaintsOpen?: ExecutiveComparisonMetric }, kpis?: { revenue?: number; labour?: number; parts?: number; openRo?: number; delayedRo?: number; complaintsOpen?: number } }
  const revenueGrowth = data.comparison?.revenue?.deltaPct
  const avgBillingGrowth = data.comparison?.avgBilling?.deltaPct
  const openRo = numberOrZero(data.kpis?.openRo)
  const delayed = numberOrZero(data.kpis?.delayedRo)
  const complaints = numberOrZero(data.kpis?.complaintsOpen)
  const revenue = numberOrZero(data.kpis?.revenue)
  const labour = numberOrZero(data.kpis?.labour)
  const parts = numberOrZero(data.kpis?.parts)
  const revenueScore = scoreFromGrowth(revenueGrowth)
  const efficiencyScore = scoreFromGrowth(avgBillingGrowth)
  const operationsScore = scoreFromPressure(openRo + delayed * 2, 25, 1.2)
  const customerScore = scoreFromPressure(complaints, 2, 9)
  const score = clampScore(revenueScore * 0.35 + efficiencyScore * 0.25 + operationsScore * 0.25 + customerScore * 0.15)
  const labourShare = revenue > 0 ? (labour / revenue) * 100 : 0
  const partsShare = revenue > 0 ? (parts / revenue) * 100 : 0
  const target = targetCard('Business Revenue Target', EXECUTIVE_TARGETS.overview.revenue, revenue, 'higher', formatCurrency)
  const topDriver = parts > labour
    ? metricCard('Top Driver', 'Parts Revenue', `${partsShare.toFixed(1)}% share`, 'good')
    : metricCard('Top Driver', 'Labour Revenue', `${labourShare.toFixed(1)}% share`, 'good')
  const biggestConcern = delayed > 0
    ? metricCard('Biggest Concern', 'Delayed RO', delayed.toLocaleString('en-IN'), 'risk')
    : complaints > 0
      ? metricCard('Biggest Concern', 'Open Complaints', complaints.toLocaleString('en-IN'), 'risk')
      : metricCard('Biggest Concern', 'Average Billing', formatSignedGrowth(avgBillingGrowth ?? 'N/A'), Number(avgBillingGrowth) < 0 ? 'warning' : 'good')
  return {
    title: 'Business Health',
    score,
    previousScore: data.comparison?.revenue ? 70 : null,
    status: executiveStatus(score),
    confidence: data.comparison?.revenue ? 'High Confidence' : 'Medium Confidence',
    scoreDrivers: {
      positive: topList([
        Number(revenueGrowth) > 0 && `Revenue ${formatSignedGrowth(Number(revenueGrowth))}`,
        Number(avgBillingGrowth) > 0 && `Avg billing ${formatSignedGrowth(Number(avgBillingGrowth))}`,
        delayed === 0 && 'No delayed RO pressure',
      ], 'Revenue mix is available', 2),
      negative: topList([
        Number(revenueGrowth) < 0 && `Revenue ${formatSignedGrowth(Number(revenueGrowth))}`,
        delayed > 0 && `${delayed} delayed RO`,
        complaints > 0 && `${complaints} open complaints`,
      ], 'No major business detractor', 2),
    },
    kpiStrip: [
      metricCard('Revenue', formatCurrency(revenue), `${formatSignedGrowth(revenueGrowth ?? 'N/A')} vs comparison`, Number(revenueGrowth) < 0 ? 'risk' : 'good'),
      metricCard('Revenue At Risk', formatCurrency(Math.max(delayed, 0) * (revenue / Math.max(openRo || 1, 1))), 'Delayed RO exposure estimate', delayed > 0 ? 'risk' : 'good'),
      metricCard('Top Contributor', parts > labour ? 'Parts' : 'Labour', `${Math.max(partsShare, labourShare).toFixed(1)}% share`, 'neutral'),
      metricCard('Weakest Area', delayed > 0 ? 'Delayed RO' : complaints > 0 ? 'Complaints' : 'Avg Billing', delayed > 0 ? `${delayed} delayed` : `${complaints} open`, delayed > 0 || complaints > 0 ? 'risk' : 'good'),
      metricCard('Target Achievement', target.percent === null ? 'N/A' : `${target.percent.toFixed(1)}%`, target.status, target.percent !== null && target.percent < 75 ? 'risk' : 'good'),
    ],
    target,
    topDriver,
    biggestConcern,
    cards: {
      drivers: {
        title: 'Business Drivers',
        items: [
          metricCard('Labour Revenue', formatCurrency(labour), `${labourShare.toFixed(1)}% share`, 'neutral'),
          metricCard('Parts Revenue', formatCurrency(parts), `${partsShare.toFixed(1)}% share`, 'neutral'),
          metricCard('Average Billing', formatSignedGrowth(avgBillingGrowth ?? 'N/A'), 'Efficiency movement', Number(avgBillingGrowth) < 0 ? 'warning' : 'good'),
        ],
      },
      risks: {
        title: 'Business Risks',
        tone: 'risk',
        items: itemCards([
          delayed > 0 && metricCard('Delayed RO', delayed.toLocaleString('en-IN'), 'Can push billing out', 'risk'),
          complaints > 0 && metricCard('Open Complaints', complaints.toLocaleString('en-IN'), 'Customer retention risk', 'risk'),
          Number(avgBillingGrowth) < 0 && metricCard('Avg Billing Drop', formatSignedGrowth(Number(avgBillingGrowth)), 'Efficiency risk', 'warning'),
        ], metricCard('Business Risk', 'Controlled', 'No major business pressure', 'good')),
      },
      opportunities: {
        title: 'Business Opportunities',
        tone: 'good',
        items: [
          metricCard('10% Billing Lift', formatCurrency(revenue * 0.1), 'Revenue upside', 'good'),
          metricCard('Close Delayed RO', delayed.toLocaleString('en-IN'), 'Recover billing conversion', delayed > 0 ? 'warning' : 'good'),
          metricCard('Protect Customer Experience', complaints.toLocaleString('en-IN'), 'Close open complaints', complaints > 0 ? 'warning' : 'good'),
        ],
      },
      focus: {
        title: 'Focus Areas',
        items: [
          metricCard('Protect Revenue Growth', formatCurrency(revenue), 'Primary management metric', 'neutral'),
          metricCard('Reduce Delayed RO', delayed.toLocaleString('en-IN'), 'Operations focus', delayed > 0 ? 'risk' : 'good'),
          metricCard('Close Open Complaints', complaints.toLocaleString('en-IN'), 'Customer focus', complaints > 0 ? 'warning' : 'good'),
        ],
      },
    },
    components: [
      { label: 'Revenue Score', score: revenueScore, helper: `${formatSignedGrowth(revenueGrowth ?? 'N/A')} revenue` },
      { label: 'Efficiency Score', score: efficiencyScore, helper: `${formatSignedGrowth(avgBillingGrowth ?? 'N/A')} avg billing` },
      { label: 'Operations Score', score: operationsScore, helper: `${openRo} open / ${delayed} delayed` },
      { label: 'Customer Score', score: customerScore, helper: `${complaints} open complaints` },
    ],
  }
}

function executiveStatusClass(status: string) {
  if (status === 'EXCELLENT' || status === 'GOOD') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'WATCH') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

function executiveToneClass(tone: ExecutiveTone = 'neutral') {
  if (tone === 'good') return 'border-emerald-100 bg-emerald-50/70 text-emerald-800'
  if (tone === 'warning') return 'border-amber-100 bg-amber-50/70 text-amber-800'
  if (tone === 'risk') return 'border-rose-100 bg-rose-50/70 text-rose-800'
  return 'border-slate-200 bg-slate-50/80 text-slate-800'
}

function BusinessExecutiveDecisionLayer({
  dateFilter,
  reportName,
  dealerCode,
}: {
  dateFilter: BusinessDateFilter
  reportName: string
  dealerCode?: string | null
}) {
  const request = useMemo(() => buildExecutiveRequest(reportName, dateFilter, dealerCode), [dateFilter, dealerCode, reportName])
  const { data, isLoading } = useQuery<unknown, Error>({
    queryKey: ['business-excellence', 'executive-decision-layer', reportName, request.endpoint],
    queryFn: async () => {
      const response = await fetch(request.endpoint)
      logApiTimings(response, request.timingLabel)
      return await readPlatinumJson<unknown>(response, 'Executive decision layer')
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  })

  const executiveRead = useMemo(() => {
    if (reportName.toLowerCase().includes('ro billing')) return buildRoBillingHealth(data)
    if (reportName === WORKSHOP_PERFORMANCE_REPORT) return buildWorkshopHealth(data)
    if (reportName === OPEN_RO_REPORT) return buildOpenRoHealth(data)
    if (reportName === PLATINUM_COMPLAINTS_REPORT) return buildComplaintHealth(data)
    return buildOverviewHealth(data)
  }, [data, reportName])

  if (isLoading) {
    return (
      <div className="border-b border-slate-100 bg-slate-50/60 p-4">
        <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
          <div className="h-56 animate-pulse rounded-[1.5rem] bg-white" />
          <div className="h-56 animate-pulse rounded-[1.5rem] bg-white" />
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-slate-100 bg-gradient-to-br from-white via-slate-50 to-[var(--dashboard-primary-soft)] p-4">
      <div className="rounded-[1.5rem] border border-[var(--dashboard-primary-border)] bg-white/94 p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/85 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-action-bg)]">{executiveRead.title}</p>
              <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest', executiveStatusClass(executiveRead.status))}>{executiveRead.status}</span>
            </div>
            <div className="mt-3 flex items-end gap-2">
              <p className="text-5xl font-black tracking-tight text-slate-950">{executiveRead.score}</p>
              <p className="pb-1 text-sm font-black uppercase tracking-widest text-slate-400">/ 100</p>
            </div>
            <p className="mt-2 text-xs font-black text-slate-600">{scoreTrendLabel(executiveRead.previousScore, executiveRead.score)}</p>
            <p className="mt-2 inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{executiveRead.confidence}</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">What Changed</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Positive</p>
                  <div className="mt-2 space-y-1.5">
                    {executiveRead.scoreDrivers.positive.slice(0, 2).map((item) => (
                      <p key={item} className="text-xs font-black text-slate-900">{item}</p>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Negative</p>
                  <div className="mt-2 space-y-1.5">
                    {executiveRead.scoreDrivers.negative.slice(0, 2).map((item) => (
                      <p key={item} className="text-xs font-black text-slate-900">{item}</p>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {[executiveRead.topDriver, executiveRead.biggestConcern].map((item) => (
                <div key={item.label} className={cn('rounded-2xl border p-3', executiveToneClass(item.tone))}>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{item.label}</p>
                  <p className="mt-1 text-base font-black leading-tight">{item.value}</p>
                  {item.helper && <p className="mt-1 text-[11px] font-bold opacity-75">{item.helper}</p>}
                </div>
              ))}
              {executiveRead.kpiStrip.slice(1, 3).map((item) => (
                <div key={item.label} className={cn('rounded-2xl border p-3', executiveToneClass(item.tone))}>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{item.label}</p>
                  <p className="mt-1 text-base font-black leading-tight">{item.value}</p>
                  {item.helper && <p className="mt-1 text-[11px] font-bold opacity-75">{item.helper}</p>}
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/85 p-4 text-slate-800">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{executiveRead.target.label}</p>
                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', executiveStatusClass(executiveRead.target.status))}>{executiveRead.target.status}</span>
              </div>
              <p className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                {executiveRead.target.percent === null ? 'N/A' : `${executiveRead.target.percent.toFixed(1)}%`}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-black">
                <div><p className="text-[10px] uppercase tracking-widest text-slate-400">Target</p><p>{executiveRead.target.target}</p></div>
                <div><p className="text-[10px] uppercase tracking-widest text-slate-400">Achieved</p><p>{executiveRead.target.achieved}</p></div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {[executiveRead.cards.drivers, executiveRead.cards.risks, executiveRead.cards.focus].map((card) => (
            <div key={card.title} className={cn('rounded-2xl border p-4', executiveToneClass(card.tone))}>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{card.title}</p>
              <div className="mt-3 space-y-3">
                {card.items.slice(0, 2).map((item) => (
                  <div key={`${card.title}-${item.label}`} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-wide">{item.label}</p>
                      {item.helper && <p className="mt-1 text-[11px] font-bold opacity-75">{item.helper}</p>}
                    </div>
                    <p className="shrink-0 text-sm font-black">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function getROTrendDateRange(dateFilter: BusinessDateFilter) {
  if (dateFilter?.startDate && dateFilter.endDate) {
    const start = parseBusinessDate(dateFilter.startDate)
    const end = parseBusinessDate(dateFilter.endDate)
    if (start && end && start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      return {
        startDate: getInputDate(new Date(end.getFullYear(), end.getMonth(), 1)),
        endDate: getInputDate(new Date(end.getFullYear(), end.getMonth() + 1, 0)),
      }
    }

    return { startDate: dateFilter.startDate, endDate: dateFilter.endDate }
  }

  const today = new Date()
  const year = dateFilter?.mode === 'month' ? dateFilter.year : today.getFullYear()
  const month = dateFilter?.mode === 'month' ? dateFilter.month : today.getMonth()

  return {
    startDate: getInputDate(new Date(year, month, 1)),
    endDate: getInputDate(new Date(year, month + 1, 0)),
  }
}

const EXECUTIVE_LOCATION_OPTIONS = [
  {
    label: 'All Locations',
    dealerCode: PLATINUM_ALL_LOCATIONS_CODE,
    helper: KIA_BRANCH_DEALERS.map((branch) => branch.dealerCode).join(' + '),
  },
  ...KIA_BRANCH_DEALERS.map((branch) => ({
    label: branch.label,
    dealerCode: branch.dealerCode,
    helper: `Dealer ${branch.dealerCode}`,
  })),
]

function executiveBatchQueryString(dateFilter: BusinessDateFilter, dealerCode?: string | null) {
  const tableRange = getDefaultRODateRange(dateFilter)
  const trendRange = getROTrendDateRange(dateFilter)
  const params = new URLSearchParams({
    brand: 'platinum',
    sheet: 'am_platinum_ro_billing_report',
    analysisType: 'load',
    views: 'all',
    groupBy: 'work_type',
    metrics: 'all',
    startDate: tableRange.startDate,
    endDate: tableRange.endDate,
    trendStartDate: trendRange.startDate,
    trendEndDate: trendRange.endDate,
  })
  appendBusinessComparisonParams(params, dateFilter)
  appendKiaDealerCodeParam(params, dealerCode)
  return params.toString()
}

function executiveQueryString(view: 'table' | 'trend' | 'fy', dateFilter: BusinessDateFilter, dealerCode?: string | null) {
  const range = view === 'trend' ? getROTrendDateRange(dateFilter) : getDefaultRODateRange(dateFilter)
  const params = new URLSearchParams({
    brand: 'platinum',
    sheet: 'am_platinum_ro_billing_report',
    analysisType: 'load',
    view,
    groupBy: 'work_type',
    metrics: 'all',
    startDate: range.startDate,
    endDate: range.endDate,
  })
  appendBusinessComparisonParams(params, dateFilter)
  appendKiaDealerCodeParam(params, dealerCode)
  return params.toString()
}

function getExecutiveMetricRows(response: ROAnalysisResponse | null | undefined, metric: ROAnalysisType) {
  return response?.byMetric?.[metric]?.rows || (metric === 'load' ? response?.rows : undefined) || []
}

function buildExecutiveSyntheticRow(name: string, sourceRows: ROAnalysisRow[]): ROAnalysisRow {
  const buildMetric = (period: PeriodKey): ROAnalysisMetric => {
    const cy = sourceRows.reduce((total, row) => total + Number(row.metrics?.[period]?.cy || 0), 0)
    let hasLy = false
    const lyTotal = sourceRows.reduce((total, row) => {
      const ly = row.metrics?.[period]?.ly
      if (ly === 'N/A' || ly === undefined || ly === null) return total
      hasLy = true
      return total + Number(ly || 0)
    }, 0)
    const ly: number | 'N/A' = hasLy ? lyTotal : 'N/A'
    const growth: number | 'N/A' = ly !== 'N/A' && ly > 0 ? ((cy - ly) / ly) * 100 : 'N/A'
    return { cy, ly, growth }
  }

  return {
    name,
    depth: 0,
    metrics: {
      td: buildMetric('td'),
      mtd: buildMetric('mtd'),
      qtd: buildMetric('qtd'),
      ytd: buildMetric('ytd'),
    },
    children: [],
  }
}

function getExecutiveDisplayBaseRows(response: ROAnalysisResponse | null | undefined, metric: 'load' | 'labour' | 'parts') {
  const topRows = getExecutiveMetricRows(response, metric).filter((row) => row.depth === 0)
  const { paidRows, freeRows, runningRows, accidentRows, otherRows } = partitionServiceTypeRows(
    topRows,
    (row) => row.name,
    'platinum',
  )

  const paid = buildExecutiveSyntheticRow('Paid Service', paidRows)
  const free = buildExecutiveSyntheticRow('Free Services', freeRows)
  const running = buildExecutiveSyntheticRow('Running Repairs', runningRows)
  const mech = buildExecutiveSyntheticRow('MECH', [paid, free, running])
  const others = buildExecutiveSyntheticRow('Others', otherRows)
  const mechTotal = buildExecutiveSyntheticRow('MECH TOTAL', [mech, others])
  const accident = buildExecutiveSyntheticRow('Accident', accidentRows)
  const grandTotal = buildExecutiveSyntheticRow('Grand Total', [mechTotal, accident])

  return [paid, free, running, mech, others, mechTotal, accident, grandTotal]
}

function deriveExecutivePerVehicleRows(amountRows: ROAnalysisRow[], loadRows: ROAnalysisRow[]) {
  const amountByName = new Map(amountRows.map((row) => [row.name, row]))
  const deriveMetric = (amount: ROAnalysisMetric | undefined, load: ROAnalysisMetric | undefined): ROAnalysisMetric => {
    const cyLoad = Number(load?.cy || 0)
    const cy = cyLoad > 0 ? Number(amount?.cy || 0) / cyLoad : 0
    const amountLy = amount?.ly
    const loadLy = load?.ly
    const ly = amountLy !== 'N/A' && loadLy !== 'N/A' && Number(loadLy || 0) > 0
      ? Number(amountLy || 0) / Number(loadLy || 0)
      : 'N/A'
    const growth = ly !== 'N/A' && ly > 0 ? ((cy - ly) / ly) * 100 : 'N/A'
    return { cy, ly, growth }
  }

  return loadRows.map((loadRow) => {
    const amountRow = amountByName.get(loadRow.name)
    return {
      name: loadRow.name,
      depth: 0,
      metrics: {
        td: deriveMetric(amountRow?.metrics.td, loadRow.metrics.td),
        mtd: deriveMetric(amountRow?.metrics.mtd, loadRow.metrics.mtd),
        qtd: deriveMetric(amountRow?.metrics.qtd, loadRow.metrics.qtd),
        ytd: deriveMetric(amountRow?.metrics.ytd, loadRow.metrics.ytd),
      },
      children: [],
    } satisfies ROAnalysisRow
  })
}

function getExecutiveDisplayMetricRows(response: ROAnalysisResponse | null | undefined, metric: ROAnalysisType) {
  if (metric === 'lab_per_veh') {
    return deriveExecutivePerVehicleRows(
      getExecutiveDisplayBaseRows(response, 'labour'),
      getExecutiveDisplayBaseRows(response, 'load')
    )
  }
  if (metric === 'part_per_veh') {
    return deriveExecutivePerVehicleRows(
      getExecutiveDisplayBaseRows(response, 'parts'),
      getExecutiveDisplayBaseRows(response, 'load')
    )
  }
  return getExecutiveDisplayBaseRows(response, metric)
}

function findExecutiveRow(rows: ROAnalysisRow[], names: string[]) {
  const normalizedNames = names.map((name) => name.toLowerCase())
  const stack = [...rows]
  while (stack.length > 0) {
    const row = stack.shift()
    if (!row) continue
    if (normalizedNames.includes(String(row.name || '').trim().toLowerCase())) return row
    if (row.children?.length) stack.push(...row.children)
  }
  return null
}

function getExecutiveTotalRow(response: ROAnalysisResponse | null | undefined, metric: ROAnalysisType) {
  const rows = getExecutiveDisplayMetricRows(response, metric)
  return findExecutiveRow(rows, ['Grand Total', 'Total']) || null
}

function executivePeriod(row: ROAnalysisRow | null | undefined, period: PeriodKey) {
  return row?.metrics?.[period] || { cy: 0, ly: 0, growth: 'N/A' as const }
}

function combineExecutiveMetricValues(primary: ROAnalysisMetric, secondary: ROAnalysisMetric) {
  const cy = Number(primary.cy || 0) + Number(secondary.cy || 0)
  if (primary.ly === 'N/A' || secondary.ly === 'N/A') {
    return { cy, ly: 'N/A' as const, growth: 'N/A' as const }
  }
  const ly = Number(primary.ly || 0) + Number(secondary.ly || 0)
  const growth = ly > 0 ? ((cy - ly) / ly) * 100 : 'N/A'
  return { cy, ly, growth }
}

function ExecutiveGrowthBadge({ value }: { value: number | string | 'N/A' }) {
  const numericValue = value === 'N/A' ? Number.NaN : Number(value)
  const isNeutral = value === 'N/A' || !Number.isFinite(numericValue)
  const isPositive = !isNeutral && numericValue >= 0

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-[10px] font-black tracking-tight transition-colors',
        isNeutral
          ? 'border-slate-200/80 bg-slate-100/80 text-slate-600'
          : isPositive
            ? 'border-emerald-200/70 bg-emerald-50 text-emerald-700'
            : 'border-rose-200/70 bg-rose-50 text-rose-700'
      )}
    >
      {formatSignedGrowth(value)}
    </span>
  )
}

function ExecutiveMetricCard({
  label,
  value,
  previous,
  growth,
  helper,
  icon: Icon,
}: {
  label: string
  value: string
  previous: string
  growth: number | string | 'N/A'
  helper: string
  tone?: string
  icon?: typeof Wrench
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all hover:border-slate-300 hover:shadow-md">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200/60 bg-slate-100/80 text-slate-700 shadow-2xs">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
        </div>
        <ExecutiveGrowthBadge value={growth} />
      </div>
      <p className="mt-3.5 text-3xl font-black tracking-tight text-slate-900">{value}</p>
      <div className="mt-3.5 flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50/70 px-3.5 py-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Previous</span>
        <span className="text-xs font-black text-slate-700">{previous}</span>
      </div>
      <p className="mt-2.5 text-[11px] font-bold text-slate-400">{helper}</p>
    </div>
  )
}

type ExecutiveRevenueRow = { key: string; label: string; row: ROAnalysisRow }

const EXECUTIVE_REVENUE_CATEGORY_MAP = [
  ['MECH', 'Mechanical'],
  ['Accident', 'Accidental'],
  ['Paid Service', 'Paid Service'],
  ['Free Services', 'Free Service'],
  ['Running Repairs', 'Running Repair'],
  ['Others', 'Others'],
] as const

function executiveRevenueRows(response: ROAnalysisResponse | null | undefined, metric: 'labour' | 'parts', totalLabel: string) {
  const rows = getExecutiveDisplayMetricRows(response, metric)
  const items = EXECUTIVE_REVENUE_CATEGORY_MAP.reduce<ExecutiveRevenueRow[]>((acc, [name, label]) => {
    const row = findExecutiveRow(rows, [name])
    if (row) acc.push({ key: name, label, row })
    return acc
  }, [])
  const total = getExecutiveTotalRow(response, metric)
  if (total) items.push({ key: `${metric}-total`, label: totalLabel, row: total })
  return items
}

function formatExecutiveRevenueMoney(value: number | string | 'N/A' | undefined | null) {
  if (value === 'N/A' || value === undefined || value === null) return 'N/A'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'N/A'
  return formatCurrency(numeric)
}

const EXECUTIVE_TABLE_METRICS: Array<{ id: ROAnalysisType; label: string }> = [
  { id: 'load', label: 'Load' },
  { id: 'labour', label: 'Labour' },
  { id: 'parts', label: 'Parts' },
  { id: 'lab_per_veh', label: 'Lab / Veh' },
  { id: 'part_per_veh', label: 'Part / Veh' },
]

function formatExecutiveTableMetricValue(metric: ROAnalysisType, value: number | string | 'N/A' | undefined | null) {
  if (value === 'N/A' || value === undefined || value === null) return 'N/A'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'N/A'
  if (metric === 'load') return Math.round(numeric).toLocaleString('en-IN')
  return formatCurrency(numeric)
}

function ExecutiveRevenuePerformance({
  response,
  dateFilter,
  selectedLocationLabel,
  expandedTable,
  onToggleTable,
}: {
  response: ROAnalysisResponse | null | undefined
  dateFilter: BusinessDateFilter
  selectedLocationLabel: string
  expandedTable: ExecutiveDashboardTableId | null
  onToggleTable: (tableId: ExecutiveDashboardTableId) => void
}) {
  const labourRows = useMemo(() => executiveRevenueRows(response, 'labour', 'Total Labour'), [response])
  const partsRows = useMemo(() => executiveRevenueRows(response, 'parts', 'Total Parts'), [response])
  const labourTotal = getExecutiveTotalRow(response, 'labour')
  const partsTotal = getExecutiveTotalRow(response, 'parts')
  const loadTotal = getExecutiveTotalRow(response, 'load')
  const paidLoad = findExecutiveRow(getExecutiveDisplayMetricRows(response, 'load'), ['Paid Service'])
  const selectedRange = getSelectedBusinessDateRange(dateFilter)
  const comparisonStart = dateFilter?.comparison?.previousStartDate
    ? parseBusinessDate(dateFilter.comparison.previousStartDate)
    : null
  const comparisonEnd = dateFilter?.comparison?.previousEndDate
    ? parseBusinessDate(dateFilter.comparison.previousEndDate)
    : null
  const fallbackLyStart = new Date(selectedRange.start)
  fallbackLyStart.setFullYear(fallbackLyStart.getFullYear() - 1)
  const fallbackLyEnd = new Date(selectedRange.end)
  fallbackLyEnd.setFullYear(fallbackLyEnd.getFullYear() - 1)
  const rangeFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const rangeLabel = (start: Date, end: Date) => getInputDate(start) === getInputDate(end)
    ? rangeFormatter.format(start)
    : `${rangeFormatter.format(start)} to ${rangeFormatter.format(end)}`
  const currentRangeLabel = rangeLabel(selectedRange.start, selectedRange.end)
  const comparisonRangeLabel = rangeLabel(comparisonStart || fallbackLyStart, comparisonEnd || fallbackLyEnd)
  const currentRevenue = Number(labourTotal?.metrics?.mtd?.cy || 0) + Number(partsTotal?.metrics?.mtd?.cy || 0)
  const previousRevenue = Number(labourTotal?.metrics?.mtd?.ly === 'N/A' ? 0 : labourTotal?.metrics?.mtd?.ly || 0)
    + Number(partsTotal?.metrics?.mtd?.ly === 'N/A' ? 0 : partsTotal?.metrics?.mtd?.ly || 0)
  const revenueGrowth = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 'N/A'
  const paidContribution = Number(loadTotal?.metrics?.mtd?.cy || 0) > 0
    ? (Number(paidLoad?.metrics?.mtd?.cy || 0) / Number(loadTotal?.metrics?.mtd?.cy || 0)) * 100
    : 0
  const partsContribution = currentRevenue > 0 ? (Number(partsTotal?.metrics?.mtd?.cy || 0) / currentRevenue) * 100 : 0
  const labourContribution = currentRevenue > 0 ? (Number(labourTotal?.metrics?.mtd?.cy || 0) / currentRevenue) * 100 : 0

  const renderPeriodCells = (row: ROAnalysisRow, period: PeriodKey) => {
    const metric = executivePeriod(row, period)
    return (
      <React.Fragment key={`${row.name}-${period}`}>
        <td className="min-w-[78px] whitespace-nowrap border border-slate-200/70 px-2.5 py-2 text-right font-mono font-black text-slate-900">{formatExecutiveRevenueMoney(metric.cy)}</td>
        <td className="min-w-[78px] whitespace-nowrap border border-slate-200/70 px-2.5 py-2 text-right font-mono font-bold text-slate-400">{formatExecutiveRevenueMoney(metric.ly)}</td>
        <td className="min-w-[82px] whitespace-nowrap border border-slate-200/70 px-2.5 py-2 text-center">
          <ExecutiveGrowthBadge value={metric.growth} />
        </td>
      </React.Fragment>
    )
  }

  const renderRevenueTable = (
    tableId: Extract<ExecutiveDashboardTableId, 'labour-revenue' | 'parts-revenue'>,
    title: string,
    rows: ExecutiveRevenueRow[]
  ) => (
    <ExecutiveTableShell
      title={title}
      icon={<IndianRupee className="h-3.5 w-3.5 text-slate-300" />}
      headerClassName="px-3.5 py-2.5 bg-slate-900 text-white"
      titleClassName="text-[11px]"
      className={cn('rounded-2xl border-slate-200/80', expandedTable === tableId && 'xl:col-span-3')}
      isExpanded={expandedTable === tableId}
      onToggleExpanded={() => onToggleTable(tableId)}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[11px] leading-tight">
          <thead className="bg-slate-900 text-slate-200">
            <tr>
              <th className="min-w-[130px] border border-slate-800 px-3 py-2 text-left font-bold text-slate-300">Category</th>
              {(['MTD', 'QTD', 'YTD'] as const).map((label) => (
                <th key={label} colSpan={3} className="border border-slate-800 px-3 py-2 text-center font-bold text-slate-300">{label}</th>
              ))}
            </tr>
            <tr>
              <th className="border border-slate-800 px-3 py-1.5"></th>
              {Array.from({ length: 3 }).flatMap((_, groupIndex) => ['CY', 'LY', '%'].map((label) => (
                <th key={`${groupIndex}-${label}`} className="border border-slate-800 px-3 py-1.5 text-center font-bold text-slate-400">{label}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, row }) => (
              <tr key={key} className={cn(getManagementTotalRowClass(row.name) || 'bg-white hover:bg-slate-50/80 transition-colors')}>
                <td className="whitespace-nowrap border border-slate-200/70 px-3 py-2 font-black leading-tight">{label}</td>
                {(['mtd', 'qtd', 'ytd'] as PeriodKey[]).map((period) => renderPeriodCells(row, period))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="border border-slate-200/70 bg-white px-3 py-6 text-center text-xs font-bold text-slate-400">
                  Data not available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ExecutiveTableShell>
  )

  return (
    <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4 shadow-xs">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50/80">
            <TrendingUp className="h-4 w-4 text-slate-700" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">Revenue Performance</p>
            <h3 className="text-lg font-black text-slate-900 tracking-tight">{selectedLocationLabel}</h3>
          </div>
        </div>
        <p className="rounded-full border border-slate-200/70 bg-slate-50/70 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-600">
          CY {currentRangeLabel} vs LY {comparisonRangeLabel}
        </p>
      </div>

      <div className="mt-4 grid gap-3.5 xl:grid-cols-3">
        {renderRevenueTable('labour-revenue', 'Labour Revenue', labourRows)}
        {renderRevenueTable('parts-revenue', 'Part Revenue', partsRows)}
        <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
          <div className="bg-slate-900 px-3.5 py-2.5 text-white">
            <h4 className="flex items-center gap-2 text-[11px] font-black tracking-tight">
              <TrendingUp className="h-3.5 w-3.5 text-slate-300" />
              Growth Contribution
            </h4>
          </div>
          <div className="grid gap-2.5 p-3.5">
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Revenue Growth</p>
              <p className={cn('mt-1.5 text-2xl font-black tracking-tight', revenueGrowth !== 'N/A' && revenueGrowth < 0 ? 'text-rose-600' : 'text-emerald-700')}>
                {formatSignedGrowth(revenueGrowth)}
              </p>
              <p className="mt-1 text-[9px] font-bold uppercase leading-4 text-slate-400">
                CY {currentRangeLabel} vs LY {comparisonRangeLabel}
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-xl border border-slate-200/70 bg-white p-2.5 text-[10px] font-black">
                <div><p className="text-[9px] uppercase tracking-widest text-slate-400">CY Revenue</p><p className="text-slate-900">{formatCurrency(currentRevenue)}</p></div>
                <div><p className="text-[9px] uppercase tracking-widest text-slate-400">LY Revenue</p><p className="text-slate-700">{formatCurrency(previousRevenue)}</p></div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Paid Service Contribution</p>
              <p className="mt-1.5 text-2xl font-black text-slate-900 tracking-tight">{paidContribution.toFixed(1)}%</p>
              <p className="mt-1 text-[9px] font-bold uppercase leading-4 text-slate-400">Paid Service load share in CY selected period.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Labour Share</p>
                <p className="mt-1.5 text-xl font-black text-slate-900">{labourContribution.toFixed(1)}%</p>
              </div>
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Parts Share</p>
                <p className="mt-1.5 text-xl font-black text-slate-900">{partsContribution.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BusinessExecutiveDashboard({
  dateFilter,
  dealerCode,
  onDealerChange,
}: {
  dateFilter: BusinessDateFilter
  dealerCode: string | null
  onDealerChange: (dealerCode: string | null) => void
}) {
  const [activeExecutiveMetric, setActiveExecutiveMetric] = useState<ROAnalysisType>('load')
  const [activeExecutiveTableMetric, setActiveExecutiveTableMetric] = useState<ROAnalysisType>('load')
  const [expandedExecutiveTable, setExpandedExecutiveTable] = useState<ExecutiveDashboardTableId | null>(null)
  const selectedDealer = normalizeKiaDealerCode(dealerCode)
  const selectedLocation = selectedDealer || 'all'
  const queryClient = useQueryClient()

  const toggleExecutiveTable = useCallback((tableId: ExecutiveDashboardTableId) => {
    setExpandedExecutiveTable((current) => current === tableId ? null : tableId)
  }, [])

  const fetchExecutiveSummary = useCallback(async (view: 'table' | 'trend' | 'fy', nextDealerCode?: string | null) => {
    const queryString = executiveQueryString(view, dateFilter, nextDealerCode)
    return queryClient.fetchQuery({
      queryKey: ['business-excellence', 'executive-dashboard', view, queryString],
      queryFn: async () => {
        const response = await fetch(`/api/brands/platinum/business-excellence/ro-billing-analysis?${queryString}`)
        logApiTimings(response, `executive-dashboard-${view}`)
        return await readPlatinumJson<ROAnalysisResponse>(response, `Executive dashboard ${view}`)
      },
      staleTime: DASHBOARD_STALE_TIME_MS,
    })
  }, [dateFilter, queryClient])

  const executiveBatchQuery = useQuery({
    queryKey: ['business-excellence', 'executive-dashboard', 'batch', selectedLocation, dateFilter],
    queryFn: async () => {
      const queryString = executiveBatchQueryString(dateFilter, selectedDealer)
      const response = await fetch(`/api/brands/platinum/business-excellence/ro-billing-analysis?${queryString}`)
      logApiTimings(response, 'executive-dashboard-batch')
      const data = await readPlatinumJson<{
        byView?: {
          table?: ROAnalysisResponse
          trend?: ROAnalysisResponse
          fy?: ROAnalysisResponse
        }
      }>(response, 'Executive dashboard batch')
      return {
        table: data.byView?.table,
        trend: data.byView?.trend,
        fy: data.byView?.fy,
      }
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  })

  const tableQuery = {
    data: executiveBatchQuery.data?.table,
    isLoading: executiveBatchQuery.isLoading,
    isError: executiveBatchQuery.isError,
  }
  const trendQuery = {
    data: executiveBatchQuery.data?.trend,
    isLoading: executiveBatchQuery.isLoading,
    isError: executiveBatchQuery.isError,
  }
  const fyQuery = {
    data: executiveBatchQuery.data?.fy,
    isLoading: executiveBatchQuery.isLoading,
    isError: executiveBatchQuery.isError,
  }

  const branchTableQuery = useQuery({
    queryKey: ['business-excellence', 'executive-dashboard', 'branch-table', dateFilter],
    queryFn: async () => {
      const [all, ...branches] = await Promise.all([
        fetchExecutiveSummary('table', null),
        ...KIA_BRANCH_DEALERS.map((branch) => fetchExecutiveSummary('table', branch.dealerCode)),
      ])
      return {
        all,
        branches: KIA_BRANCH_DEALERS.map((branch, index) => ({
          label: branch.label,
          response: branches[index],
        })),
      }
    },
    enabled: true,
    staleTime: DASHBOARD_STALE_TIME_MS,
  })

  const selectedTable = tableQuery.data
  const labourTotal = getExecutiveTotalRow(selectedTable, 'labour')
  const partsTotal = getExecutiveTotalRow(selectedTable, 'parts')
  const labourMtd = executivePeriod(labourTotal, 'mtd')
  const partsMtd = executivePeriod(partsTotal, 'mtd')
  const revenueMtd = combineExecutiveMetricValues(labourMtd, partsMtd)

  const selectedLocationLabel = EXECUTIVE_LOCATION_OPTIONS.find((item) => item.dealerCode === selectedDealer || (item.dealerCode === PLATINUM_ALL_LOCATIONS_CODE && selectedLocation === 'all'))?.label || 'All Locations'

  const locationRows = useMemo(() => {
    const buildRow = (label: string, response?: ROAnalysisResponse) => {
      const row = getExecutiveTotalRow(response, 'load')
      return {
        label,
        td: executivePeriod(row, 'td'),
        mtd: executivePeriod(row, 'mtd'),
        qtd: executivePeriod(row, 'qtd'),
        ytd: executivePeriod(row, 'ytd'),
      }
    }
    if (branchTableQuery.data) {
      return [
        ...branchTableQuery.data.branches.map((branch) => buildRow(branch.label, branch.response)),
        buildRow('Total', branchTableQuery.data.all),
      ]
    }
    return [
      buildRow(selectedLocationLabel, selectedTable),
    ]
  }, [branchTableQuery.data, selectedLocationLabel, selectedTable])

  const serviceTypeRows = useMemo(() => {
    return getExecutiveDisplayMetricRows(selectedTable, activeExecutiveTableMetric)
      .map((row) => ({
        name: row.name,
        td: executivePeriod(row, 'td'),
        mtd: executivePeriod(row, 'mtd'),
        qtd: executivePeriod(row, 'qtd'),
        ytd: executivePeriod(row, 'ytd'),
      }))
  }, [activeExecutiveTableMetric, selectedTable])

  const trendData = useMemo(() => {
    const labourTrend = trendQuery.data?.byMetric?.labour?.trend || []
    const partsTrend = trendQuery.data?.byMetric?.parts?.trend || []
    const loadTrend = trendQuery.data?.byMetric?.load?.trend || []
    const byDate = new Map<string, {
      label: string
      cyRevenue: number
      lyRevenue: number
      cyLabour: number
      lyLabour: number
      cyParts: number
      lyParts: number
      cyLoad: number
      lyLoad: number
    }>()

    loadTrend.forEach((item) => {
      byDate.set(item.date, {
        label: item.label,
        cyRevenue: 0,
        lyRevenue: 0,
        cyLabour: 0,
        lyLabour: 0,
        cyParts: 0,
        lyParts: 0,
        cyLoad: Number(item.cy || 0),
        lyLoad: Number(item.ly || 0),
      })
    })
    labourTrend.forEach((item) => {
      const existing = byDate.get(item.date) || { label: item.label, cyRevenue: 0, lyRevenue: 0, cyLabour: 0, lyLabour: 0, cyParts: 0, lyParts: 0, cyLoad: 0, lyLoad: 0 }
      existing.cyRevenue += Number(item.cy || 0)
      existing.lyRevenue += Number(item.ly || 0)
      existing.cyLabour += Number(item.cy || 0)
      existing.lyLabour += Number(item.ly || 0)
      byDate.set(item.date, existing)
    })
    partsTrend.forEach((item) => {
      const existing = byDate.get(item.date) || { label: item.label, cyRevenue: 0, lyRevenue: 0, cyLabour: 0, lyLabour: 0, cyParts: 0, lyParts: 0, cyLoad: 0, lyLoad: 0 }
      existing.cyRevenue += Number(item.cy || 0)
      existing.lyRevenue += Number(item.ly || 0)
      existing.cyParts += Number(item.cy || 0)
      existing.lyParts += Number(item.ly || 0)
      byDate.set(item.date, existing)
    })

    return Array.from(byDate.values())
  }, [trendQuery.data])

  const activeTrendMeta = useMemo(() => {
    if (activeExecutiveMetric === 'labour') {
      return {
        label: 'Labour',
        title: 'Labour trend',
        cyKey: 'cyLabour' as const,
        lyKey: 'lyLabour' as const,
        currentName: 'Current Labour',
        previousName: 'Previous Labour',
        formatter: formatCurrency,
      }
    }
    if (activeExecutiveMetric === 'parts') {
      return {
        label: 'Parts',
        title: 'Parts trend',
        cyKey: 'cyParts' as const,
        lyKey: 'lyParts' as const,
        currentName: 'Current Parts',
        previousName: 'Previous Parts',
        formatter: formatCurrency,
      }
    }
    return {
      label: 'Load',
      title: 'Load trend',
      cyKey: 'cyLoad' as const,
      lyKey: 'lyLoad' as const,
      currentName: 'Current Load',
      previousName: 'Previous Load',
      formatter: (value: number) => Math.round(value).toLocaleString('en-IN'),
    }
  }, [activeExecutiveMetric])

  const executiveTrendStats = useMemo(() => {
    const selectedRange = getSelectedBusinessDateRange(dateFilter)
    const endDate = selectedRange.end
    const daysInMonth = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate()
    const throughDay = Math.min(Math.max(endDate.getDate(), 1), daysInMonth)
    const remainingDays = Math.max(daysInMonth - throughDay, 0)
    const metricRows = trendData.map((point) => {
      const dayNumber = Number(String(point.label || '').slice(0, 2))
      return {
        day: Number.isFinite(dayNumber) ? dayNumber : 0,
        cy: Number(point[activeTrendMeta.cyKey] || 0),
        ly: Number(point[activeTrendMeta.lyKey] || 0),
      }
    })
    const monthTarget = metricRows.reduce((total, point) => total + point.ly, 0) * 1.1
    const dailyTarget = daysInMonth > 0 ? monthTarget / daysInMonth : 0
    const mtdTarget = dailyTarget * throughDay
    const mtdAchieved = metricRows
      .filter((point) => point.day > 0 && point.day <= throughDay)
      .reduce((total, point) => total + point.cy, 0)
    const shortfallTd = Math.max(mtdTarget - mtdAchieved, 0)
    const avgPerDay = throughDay > 0 ? mtdAchieved / throughDay : 0
    const projectedClosing = avgPerDay * daysInMonth
    const monthlyShortfall = Math.max(monthTarget - projectedClosing, 0)
    const askingRate = remainingDays > 0 ? Math.max(monthTarget - mtdAchieved, 0) / remainingDays : 0
    const formatStat = activeTrendMeta.formatter

    return {
      dailyTarget,
      cards: [
        { label: 'Month Target', value: formatStat(monthTarget) },
        { label: 'MTD Target', value: formatStat(mtdTarget) },
        { label: 'MTD Achieved', value: formatStat(mtdAchieved) },
        { label: 'Shortfall T.D', value: formatStat(shortfallTd), color: shortfallTd > 0 ? 'text-[lab(53_89.72_88.48)]' : 'text-emerald-700' },
        { label: 'Monthly Shortfall', value: formatStat(monthlyShortfall), color: monthlyShortfall > 0 ? 'text-[lab(53_89.72_88.48)]' : 'text-emerald-700' },
        { label: 'Projected Closing', value: formatStat(projectedClosing) },
        { label: 'Asking Rate', value: formatStat(askingRate), color: askingRate > 0 ? 'text-slate-950' : 'text-emerald-700' },
      ],
    }
  }, [activeTrendMeta, dateFilter, trendData])

  const fyRows = useMemo(() => {
    const byFy = new Map<string, { fy: string; load: number; labour: number; parts: number; revenue: number }>()
    const applyMetric = (metric: ROAnalysisType, assign: (row: { fy: string; load: number; labour: number; parts: number; revenue: number }, value: number) => void) => {
      ;(fyQuery.data?.byMetric?.[metric]?.fyTrends || []).forEach((item) => {
        const existing = byFy.get(item.fy) || { fy: item.fy, load: 0, labour: 0, parts: 0, revenue: 0 }
        assign(existing, Number(item.value || 0))
        existing.revenue = existing.labour + existing.parts
        byFy.set(item.fy, existing)
      })
    }
    applyMetric('load', (row, value) => { row.load = value })
    applyMetric('labour', (row, value) => { row.labour = value })
    applyMetric('parts', (row, value) => { row.parts = value })
    return Array.from(byFy.values()).sort((a, b) => b.fy.localeCompare(a.fy)).slice(0, 4)
  }, [fyQuery.data])

  const isLoading = tableQuery.isLoading
    || trendQuery.isLoading
    || fyQuery.isLoading
    || (Boolean(expandedExecutiveTable) && branchTableQuery.isLoading)
  return (
    <div className="space-y-4">

      {isLoading ? (
        <SheetContentSkeleton />
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            <ExecutiveMetricCard
              label="Total Revenue"
              tone="emerald"
              icon={IndianRupee}
              value={formatCurrency(revenueMtd.cy)}
              previous={revenueMtd.ly === 'N/A' ? 'N/A' : formatCurrency(revenueMtd.ly)}
              growth={revenueMtd.growth}
              helper="Labour + Parts revenue in selected MTD window"
            />
            <ExecutiveMetricCard
              label="Parts Revenue"
              tone="amber"
              icon={Wrench}
              value={formatCurrency(Number(partsMtd.cy || 0))}
              previous={formatCurrency(Number(partsMtd.ly === 'N/A' ? 0 : partsMtd.ly || 0))}
              growth={partsMtd.growth}
              helper="Parts contribution using RO Billing Report calculations"
            />
            <ExecutiveMetricCard
              label="Labour Revenue"
              tone="blue"
              icon={Activity}
              value={formatCurrency(Number(labourMtd.cy || 0))}
              previous={formatCurrency(Number(labourMtd.ly === 'N/A' ? 0 : labourMtd.ly || 0))}
              growth={labourMtd.growth}
              helper="Labour contribution using RO Billing Report calculations"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <ExecutiveTableShell
              title="Overall Load"
              subtitle="Location performance"
              className={cn(expandedExecutiveTable === 'overall-load' && 'xl:col-span-2')}
              isExpanded={expandedExecutiveTable === 'overall-load'}
              onToggleExpanded={() => toggleExecutiveTable('overall-load')}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-[11px] leading-tight">
                  <thead className="bg-slate-900 text-slate-100">
                    <tr>
                      <th rowSpan={2} className="border border-slate-800 px-3 py-3 text-left font-bold text-slate-300">Location</th>
                      <th rowSpan={2} className="border border-slate-800 px-3 py-3 text-center font-bold text-slate-300">TD</th>
                      {(['MTD', 'QTD', 'YTD'] as const).map((label) => (
                        <th key={label} colSpan={3} className="border border-slate-800 px-3 py-2 text-center font-bold text-slate-300">{label}</th>
                      ))}
                    </tr>
                    <tr>
                      {Array.from({ length: 3 }).flatMap((_, groupIndex) => ['CY', 'LY', 'Growth'].map((label) => (
                        <th key={`${groupIndex}-${label}`} className="border border-slate-800 px-3 py-2 text-center font-bold text-slate-400">{label}</th>
                      )))}
                    </tr>
                  </thead>
                  <tbody>
                    {locationRows.map((row) => (
                      <tr key={row.label} className={row.label === 'Total' ? 'bg-slate-100/90 font-black' : 'bg-white hover:bg-slate-50/80 transition-colors'}>
                        <td className="border border-slate-200/70 px-3 py-3 font-black text-slate-900">{row.label}</td>
                        <td className="whitespace-nowrap border border-slate-200/70 px-3 py-3 text-center font-mono font-black text-slate-900">{formatExecutiveTableMetricValue('load', row.td.cy)}</td>
                        {(['mtd', 'qtd', 'ytd'] as PeriodKey[]).map((period) => {
                          const metric = row[period]
                          return (
                            <React.Fragment key={`${row.label}-${period}`}>
                              <td className="whitespace-nowrap border border-slate-200/70 px-3 py-3 text-center font-mono font-black text-slate-900">{formatExecutiveTableMetricValue('load', metric.cy)}</td>
                              <td className="whitespace-nowrap border border-slate-200/70 px-3 py-3 text-center font-mono text-slate-400">{formatExecutiveTableMetricValue('load', metric.ly)}</td>
                              <td className="border border-slate-200/70 px-3 py-3 text-center"><ExecutiveGrowthBadge value={metric.growth} /></td>
                            </React.Fragment>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ExecutiveTableShell>

            <ExecutiveTableShell
              title="Service Type Performance"
              subtitle={selectedLocationLabel}
              headerContentClassName="flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between"
              actions={(
                <div className="flex flex-wrap items-center gap-1.5">
                  {EXECUTIVE_TABLE_METRICS.map((metric) => (
                    <button
                      key={metric.id}
                      type="button"
                      onClick={() => setActiveExecutiveTableMetric(metric.id)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-all',
                        activeExecutiveTableMetric === metric.id
                          ? 'border-white bg-white text-slate-900 shadow-sm'
                          : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white'
                      )}
                    >
                      {metric.label}
                    </button>
                  ))}
                </div>
              )}
              className={cn(expandedExecutiveTable === 'service-type-performance' && 'xl:col-span-2')}
              isExpanded={expandedExecutiveTable === 'service-type-performance'}
              onToggleExpanded={() => toggleExecutiveTable('service-type-performance')}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] border-collapse text-[11px] leading-tight">
                  <thead className="bg-slate-900 text-slate-100">
                    <tr>
                      <th rowSpan={2} className="border border-slate-800 px-3 py-3 text-left font-bold text-slate-300">Service Type</th>
                      <th rowSpan={2} className="border border-slate-800 px-3 py-3 text-center font-bold text-slate-300">TD</th>
                      {(['MTD', 'QTD', 'YTD'] as const).map((label) => (
                        <th key={label} colSpan={3} className="border border-slate-800 px-3 py-2 text-center font-bold text-slate-300">{label}</th>
                      ))}
                    </tr>
                    <tr>
                      {Array.from({ length: 3 }).flatMap((_, groupIndex) => ['CY', 'LY', 'Growth'].map((label) => (
                        <th key={`${groupIndex}-${label}`} className="border border-slate-800 px-3 py-2 text-center font-bold text-slate-400">{label}</th>
                      )))}
                    </tr>
                  </thead>
                  <tbody>
                    {serviceTypeRows.map((row) => (
                      <tr key={row.name} className={cn(getManagementTotalRowClass(row.name) || 'bg-white hover:bg-slate-50/80 transition-colors')}>
                        <td className="border border-slate-200/70 px-3 py-3 font-black">{row.name}</td>
                        <td className="whitespace-nowrap border border-slate-200/70 px-3 py-3 text-center font-mono font-black">{formatExecutiveTableMetricValue(activeExecutiveTableMetric, row.td.cy)}</td>
                        {(['mtd', 'qtd', 'ytd'] as PeriodKey[]).map((period) => {
                          const metric = row[period]
                          return (
                            <React.Fragment key={`${row.name}-${period}`}>
                              <td className="whitespace-nowrap border border-slate-200/70 px-3 py-3 text-center font-mono font-black">{formatExecutiveTableMetricValue(activeExecutiveTableMetric, metric.cy)}</td>
                              <td className="whitespace-nowrap border border-slate-200/70 px-3 py-3 text-center font-mono text-slate-400">{formatExecutiveTableMetricValue(activeExecutiveTableMetric, metric.ly)}</td>
                              <td className="border border-slate-200/70 px-3 py-3 text-center"><ExecutiveGrowthBadge value={metric.growth} /></td>
                            </React.Fragment>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ExecutiveTableShell>
          </div>

          <ExecutiveRevenuePerformance
            response={selectedTable}
            dateFilter={dateFilter}
            selectedLocationLabel={selectedLocationLabel}
            expandedTable={expandedExecutiveTable}
            onToggleTable={toggleExecutiveTable}
          />

          <div className="space-y-4">
            <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Trend Graph</p>
                  <h3 className="mt-1 text-lg font-black text-slate-900 tracking-tight">{activeTrendMeta.title}</h3>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {([
                    { id: 'load', label: 'Load' },
                    { id: 'labour', label: 'Labour' },
                    { id: 'parts', label: 'Parts' },
                  ] as Array<{ id: ROAnalysisType; label: string }>).map((metric) => (
                    <button
                      key={metric.id}
                      type="button"
                      onClick={() => setActiveExecutiveMetric(metric.id)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider transition-all',
                        activeExecutiveMetric === metric.id
                          ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      )}
                    >
                      {metric.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 20, right: 20, bottom: 10, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={(value) => activeExecutiveMetric === 'load' ? Number(value || 0).toLocaleString('en-IN') : formatChartLabel(Number(value || 0))} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} width={58} />
                    <Tooltip
                      formatter={(value, name) => [activeExecutiveMetric === 'load' ? Number(value || 0).toLocaleString('en-IN') : formatCurrency(Number(value || 0)), String(name)]}
                      contentStyle={{ borderRadius: 14, border: '1px solid #cbd5e1', background: '#fff' }}
                    />
                    <Legend />
                    <ReferenceLine
                      y={executiveTrendStats.dailyTarget}
                      stroke="#f43f5e"
                      strokeDasharray="5 5"
                      label={{ position: 'right', value: 'Target', fill: '#f43f5e', fontSize: 11, fontWeight: 900 }}
                    />
                    <Line
                      type="monotone"
                      dataKey={activeTrendMeta.cyKey}
                      name={activeTrendMeta.currentName}
                      stroke="#0f172a"
                      strokeWidth={3}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey={activeTrendMeta.lyKey}
                      name={activeTrendMeta.previousName}
                      stroke="#d97706"
                      strokeWidth={3}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                {executiveTrendStats.cards.map((card) => (
                  <div key={card.label} className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-center shadow-2xs">
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">{card.label}</p>
                    <p className={cn('mt-1.5 text-xl font-black text-slate-900', card.color?.includes('text-[lab') ? 'text-rose-600' : card.color)}>{card.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <ExecutiveTableShell
              title="FY Trends"
              subtitle="Revenue, parts, labour, load"
              isExpanded={expandedExecutiveTable === 'fy-trends'}
              onToggleExpanded={() => toggleExecutiveTable('fy-trends')}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-[11px] leading-tight">
                  <thead className="bg-slate-900 text-slate-100">
                    <tr>
                      <th className="border border-slate-800 px-3 py-3 text-left font-bold text-slate-300">Financial Year</th>
                      <th className="border border-slate-800 px-3 py-3 text-right font-bold text-slate-300">Load</th>
                      <th className="border border-slate-800 px-3 py-3 text-right font-bold text-slate-300">Labour</th>
                      <th className="border border-slate-800 px-3 py-3 text-right font-bold text-slate-300">Parts</th>
                      <th className="border border-slate-800 px-3 py-3 text-right font-bold text-slate-300">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fyRows.map((row) => (
                      <tr key={row.fy} className="bg-white hover:bg-slate-50/80 transition-colors">
                        <td className="border border-slate-200/70 px-3 py-3 font-black text-slate-900">{row.fy}</td>
                        <td className="border border-slate-200/70 px-3 py-3 text-right font-mono font-black text-slate-900">{row.load.toLocaleString('en-IN')}</td>
                        <td className="border border-slate-200/70 px-3 py-3 text-right font-mono font-black text-slate-900">{formatCurrency(row.labour)}</td>
                        <td className="border border-slate-200/70 px-3 py-3 text-right font-mono font-black text-slate-900">{formatCurrency(row.parts)}</td>
                        <td className="border border-slate-200/70 px-3 py-3 text-right font-mono font-black text-slate-900">{formatCurrency(row.revenue)}</td>
                      </tr>
                    ))}
                    {fyRows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="border border-slate-200 px-3 py-8 text-center text-sm font-bold text-slate-500">
                          No FY trend data available for this selection.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </ExecutiveTableShell>
          </div>
        </>
      )}
    </div>
  )
}

type WorkshopMetric = {
  value: number
  ly?: number
  growth?: number | null
  amount?: number
  comparisonStatus?: 'available' | 'exact_zero' | 'not_comparable' | 'source_missing' | 'period_mismatch'
  comparisonLabel?: string | null
}

type WorkshopPerformanceRow = {
  serviceType: string
  groupType?: string
  totalJc: number
  totalJcPercent: number
  labourAmount: number
  labourPercent: number
  labourPerRo: number
  lessVas: number
  vasPercent: number
  labPerRoMinusVas: number
  labMinusVas: number
  spareSale: number
  sparePerRo: number
  discount: number
  waCount: number
  waAmount: number
  waPerRoPercent: number
  wbCount: number
  wbAmount: number
  wbPerRoPercent: number
  ewCount: number
  rsaCount: number
  subRows?: WorkshopPerformanceRow[]
}

type WorkshopPerformanceResponse = {
  dateRange: { startDate: string; endDate: string; lyStartDate: string; lyEndDate: string }
  kpis: Record<string, WorkshopMetric>
  rows: WorkshopPerformanceRow[]
  coreRows?: WorkshopPerformanceRow[]
  dailyTrend: Array<{
    date: string
    totalJc: number
    labourAmount: number
    partAmount: number
    totalRevenue: number
  }>
  advisors: Array<{
    advisor: string
    totalJc: number
    labourAmount: number
    partAmount: number
    totalRevenue: number
    avgBilling: number
  }>
  meta: {
    jcDefinition: string
    rowCount: number
    cacheTtlSeconds: number
    advisor?: string | null
    dealerCoverage?: {
      dealerCode: string | null
      isAllLocations: boolean
      primary?: DealerCoverage
      roBilling?: DealerCoverage
    }
    vas?: {
      available?: boolean
      unavailableReason?: string | null
      source?: string | null
      sourceTable?: string | null
      periodStart?: string | null
      periodEnd?: string | null
      sourceRows?: number
      dedupeMode?: string | null
      lyAvailable?: boolean
      comparisonStatus?: 'available' | 'exact_zero' | 'not_comparable' | 'source_missing' | 'period_mismatch'
      comparisonLabel?: string | null
      lyUnavailableReason?: string | null
      lySource?: string | null
      lySourceTable?: string | null
      lyPeriodStart?: string | null
      lyPeriodEnd?: string | null
      lySourceRows?: number
    }
  }
}

function formatWorkshopTableMoney(value: number) {
  const safeValue = Number(value || 0)
  const absValue = Math.abs(safeValue)
  const sign = safeValue < 0 ? '-' : ''
  const currencyPrefix = '\u20b9'

  if (absValue >= 10000000) {
    return `${sign}${currencyPrefix}${(absValue / 10000000).toFixed(2)}Cr`
  }

  if (absValue >= 100000) {
    return `${sign}${currencyPrefix}${(absValue / 100000).toFixed(2)}L`
  }

  return `${sign}${currencyPrefix}${Math.round(absValue).toLocaleString('en-IN')}`
}

function zeroWorkshopRow(serviceType: string): WorkshopPerformanceRow {
  return {
    serviceType,
    totalJc: 0,
    totalJcPercent: 0,
    labourAmount: 0,
    labourPercent: 0,
    labourPerRo: 0,
    lessVas: 0,
    vasPercent: 0,
    labPerRoMinusVas: 0,
    labMinusVas: 0,
    spareSale: 0,
    sparePerRo: 0,
    discount: 0,
    waCount: 0,
    waAmount: 0,
    waPerRoPercent: 0,
    wbCount: 0,
    wbAmount: 0,
    wbPerRoPercent: 0,
    ewCount: 0,
    rsaCount: 0,
  }
}

function aggregateWorkshopRows(serviceType: string, sourceRows: WorkshopPerformanceRow[], totals: { jc: number; labour: number }): WorkshopPerformanceRow {
  const base = sourceRows.reduce((acc, row) => {
    acc.totalJc += Number(row.totalJc || 0)
    acc.labourAmount += Number(row.labourAmount || 0)
    acc.lessVas += Number(row.lessVas || 0)
    acc.labMinusVas += Number(row.labMinusVas || 0)
    acc.spareSale += Number(row.spareSale || 0)
    acc.discount += Number(row.discount || 0)
    acc.waCount += Number(row.waCount || 0)
    acc.waAmount += Number(row.waAmount || 0)
    acc.wbCount += Number(row.wbCount || 0)
    acc.wbAmount += Number(row.wbAmount || 0)
    acc.ewCount += Number(row.ewCount || 0)
    acc.rsaCount += Number(row.rsaCount || 0)
    return acc
  }, zeroWorkshopRow(serviceType))

  base.totalJcPercent = totals.jc > 0 ? (base.totalJc / totals.jc) * 100 : 0
  base.labourPercent = totals.labour > 0 ? (base.labourAmount / totals.labour) * 100 : 0
  base.labourPerRo = base.totalJc > 0 ? base.labourAmount / base.totalJc : 0
  base.vasPercent = base.labourAmount > 0 ? (base.lessVas / base.labourAmount) * 100 : 0
  base.labPerRoMinusVas = base.totalJc > 0 ? base.labMinusVas / base.totalJc : 0
  base.sparePerRo = base.totalJc > 0 ? base.spareSale / base.totalJc : 0
  base.waPerRoPercent = base.totalJc > 0 ? (base.waCount / base.totalJc) * 100 : 0
  base.wbPerRoPercent = base.totalJc > 0 ? (base.wbCount / base.totalJc) * 100 : 0

  return base
}

function buildWorkshopDisplayRows(rawRows: WorkshopPerformanceRow[]) {
  const serverGrandTotal = rawRows.find((row) => row.serviceType === 'Grand Total')
  const rows = rawRows.filter((row) => row.serviceType !== 'Grand Total')
  const managementRows = rows.filter((row) => row.serviceType === 'MECH' || row.serviceType === 'Accident')

  if (managementRows.length > 0 && managementRows.length === rows.length) {
    const sortedManagementRows = managementRows.sort((a, b) => (a.serviceType === 'MECH' ? 0 : 1) - (b.serviceType === 'MECH' ? 0 : 1))
    return serverGrandTotal ? [...sortedManagementRows, serverGrandTotal] : sortedManagementRows
  }

  const categoryLabel = (row: WorkshopPerformanceRow) => row.groupType || row.serviceType
  const comparable = (value: string) => normalizeServiceTypeName(value).replace(/\bservices\b/g, 'service').replace(/\brepairs\b/g, 'repair')
  const distinctChildren = (parentName: string, sourceRows: WorkshopPerformanceRow[]) => {
    const parentKey = comparable(parentName)
    const seen = new Set<string>()

    return sourceRows.filter((row) => {
      const childKey = comparable(row.serviceType)
      if (!childKey || childKey === parentKey || seen.has(childKey)) return false
      seen.add(childKey)
      return true
    })
  }

  const { paidRows, freeRows, runningRows, accidentRows, otherRows } = partitionServiceTypeRows(rows, categoryLabel, 'platinum')

  const totalJc = Number(serverGrandTotal?.totalJc || 0) || rows.reduce((sum, row) => sum + Number(row.totalJc || 0), 0)
  const totalLabour = Number(serverGrandTotal?.labourAmount || 0) || rows.reduce((sum, row) => sum + Number(row.labourAmount || 0), 0)
  const totals = { jc: totalJc, labour: totalLabour }
  const paid = aggregateWorkshopRows('Paid Service', paidRows, totals)
  paid.subRows = distinctChildren(paid.serviceType, paidRows).filter((row) => !isMileageServiceTypeLabel(row.serviceType))
  const free = aggregateWorkshopRows('Free Services', freeRows, totals)
  free.subRows = distinctChildren(free.serviceType, freeRows)
  const running = aggregateWorkshopRows('Running Repairs', runningRows, totals)
  running.subRows = distinctChildren(running.serviceType, runningRows)
  const mech = aggregateWorkshopRows('MECH', [paid, free, running], totals)
  const others = aggregateWorkshopRows('Others', otherRows, totals)
  others.subRows = distinctChildren(others.serviceType, otherRows)
  const mechTotal = aggregateWorkshopRows('MECH TOTAL', [mech, others], totals)
  const accident = aggregateWorkshopRows('Accident', accidentRows, totals)
  accident.subRows = []
  const grandTotal = aggregateWorkshopRows('Grand Total', [mechTotal, accident], totals)

  if (serverGrandTotal) {
    grandTotal.lessVas = Number(serverGrandTotal.lessVas || 0)
    grandTotal.vasPercent = grandTotal.labourAmount > 0 ? (grandTotal.lessVas / grandTotal.labourAmount) * 100 : 0
    grandTotal.labPerRoMinusVas = grandTotal.totalJc > 0 ? grandTotal.labMinusVas / grandTotal.totalJc : 0
    grandTotal.waCount = Number(serverGrandTotal.waCount || 0)
    grandTotal.waAmount = Number(serverGrandTotal.waAmount || 0)
    grandTotal.waPerRoPercent = grandTotal.totalJc > 0 ? (grandTotal.waCount / grandTotal.totalJc) * 100 : 0
    grandTotal.wbCount = Number(serverGrandTotal.wbCount || 0)
    grandTotal.wbAmount = Number(serverGrandTotal.wbAmount || 0)
    grandTotal.wbPerRoPercent = grandTotal.totalJc > 0 ? (grandTotal.wbCount / grandTotal.totalJc) * 100 : 0
    grandTotal.ewCount = Number(serverGrandTotal.ewCount || 0)
    grandTotal.rsaCount = Number(serverGrandTotal.rsaCount || 0)
  }

  return [paid, free, running, mech, others, mechTotal, accident, grandTotal]
}

function WorkshopPerformanceSection({
  dateFilter,
  dealerCode,
}: {
  dateFilter: BusinessDateFilter
  dealerCode?: string | null
}) {
  const queryClient = useQueryClient()
  const [data, setData] = useState<WorkshopPerformanceResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedWorkshopAdvisor, setSelectedWorkshopAdvisor] = useState('all')
  const [expandedWorkshopRows, setExpandedWorkshopRows] = useState<Set<string>>(() => new Set())
  const [expandedWorkshopChart, setExpandedWorkshopChart] = useState<{ id: string; title: string } | null>(null)

  useEffect(() => {
    let isActive = true

    async function fetchWorkshopPerformance() {
      try {
        setIsLoading(true)
        if (isActive) setData(null)
        const range = getDefaultRODateRange(dateFilter)
        const params = new URLSearchParams({
          startDate: range.startDate,
          endDate: range.endDate,
        })
        appendBusinessComparisonParams(params, dateFilter)
        appendKiaDealerCodeParam(params, dealerCode)
        if (selectedWorkshopAdvisor !== 'all') {
          params.set('advisor', selectedWorkshopAdvisor)
        }
        params.set('version', 'v19')
        const queryString = params.toString()
        const result = await queryClient.fetchQuery({
          queryKey: ['business-excellence', 'workshop-performance', queryString],
          queryFn: async () => {
            const response = await fetch(`/api/brands/platinum/business-excellence/workshop-performance?${queryString}`)
            logApiTimings(response, 'workshop-performance')
            return await readPlatinumJson<WorkshopPerformanceResponse>(response, 'Workshop Performance')
          },
          staleTime: DASHBOARD_STALE_TIME_MS,
        })
        if (isActive) setData(result)
      } catch (error) {
        if (isActive) console.error('Failed to load Workshop Performance:', error)
      } finally {
        if (isActive) setIsLoading(false)
      }
    }

    fetchWorkshopPerformance()
    return () => {
      isActive = false
    }
  }, [dateFilter, dealerCode, queryClient, selectedWorkshopAdvisor])

  const rows = useMemo(() => buildWorkshopDisplayRows(data?.rows || []), [data?.rows])
  const coreRows = useMemo(() => buildWorkshopDisplayRows(data?.coreRows || data?.rows || []), [data?.coreRows, data?.rows])
  const workshopAdvisorOptions = useMemo(() => {
    const options = (data?.advisors || [])
      .map((advisor) => advisor.advisor)
      .filter((advisor): advisor is string => Boolean(advisor && advisor.trim()))
    return Array.from(new Set(options)).sort((first, second) => first.localeCompare(second))
  }, [data?.advisors])
  const chartRows = rows.filter((row) => !['Grand Total', 'MECH TOTAL'].includes(row.serviceType)).slice(0, 8)
  const trendRows = data?.dailyTrend.map((point) => {
    const date = parseBusinessDate(point.date)
    return {
      ...point,
      day: date ? `${String(date.getDate()).padStart(2, '0')} ${date.toLocaleDateString('en-US', { weekday: 'short' })}` : point.date,
    }
  }) || []

  const vasUnavailable = data?.meta.vas?.available === false
  const vasSnapshotMeta = vasUnavailable
    ? data?.meta.vas?.unavailableReason || 'VAS source unavailable'
    : data?.meta.vas?.comparisonLabel
      || (data?.meta.vas?.periodEnd
        ? `Source ${new Date(`${data.meta.vas.periodEnd}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
        : undefined)

  const kpiCards = data ? [
    { label: 'Total JC', metric: data.kpis.totalJc, formatter: (value: number) => Math.round(value).toLocaleString('en-IN'), tone: 'teal' },
    { label: 'Labour Amount', metric: data.kpis.labourAmount, formatter: formatCurrency, tone: 'blue' },
    { label: 'Spare Sale', metric: data.kpis.spareSale, formatter: formatCurrency, tone: 'amber' },
    { label: 'Total Revenue', metric: data.kpis.totalRevenue, formatter: formatCurrency, tone: 'indigo' },
    { label: 'VAS Revenue', metric: data.kpis.vasAmount, formatter: vasUnavailable ? () => 'Unavailable' : formatCurrency, tone: 'emerald', helper: vasSnapshotMeta },
    { label: 'Labour / RO', metric: data.kpis.labourPerRo, formatter: formatCurrency, tone: 'slate' },
    { label: 'EW Count', metric: data.kpis.ewCount, formatter: (value: number) => Math.round(value).toLocaleString('en-IN'), tone: 'cyan' },
    { label: 'RSA Count', metric: data.kpis.rsaCount, formatter: (value: number) => Math.round(value).toLocaleString('en-IN'), tone: 'rose' },
  ] : []

  const formatPercent = (value: number) => `${value.toFixed(1)}%`
  const formatCompactMoney = (value: number) => formatChartLabel(value)
  const getPercentToneClass = (value: number) => {
    if (value > 0) return 'be-tone-positive text-emerald-700'
    if (value < 0) return 'be-tone-negative text-rose-600'
    return 'be-tone-neutral text-slate-500'
  }

  const toggleWorkshopRow = (serviceType: string) => {
    setExpandedWorkshopRows((current) => {
      const next = new Set(current)
      if (next.has(serviceType)) {
        next.delete(serviceType)
      } else {
        next.add(serviceType)
      }
      return next
    })
  }
  const renderWorkshopExpandButton = (id: string, title: string) => (
    <button
      type="button"
      onClick={() => setExpandedWorkshopChart({ id, title })}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-teal-100 bg-white text-teal-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50"
      aria-label={`Expand ${title}`}
    >
      <Maximize2 className="h-4 w-4" />
    </button>
  )
  const renderWorkshopChart = (chartId: string) => {
    if (chartId === 'service-mix') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} margin={{ top: 22, right: 22, bottom: 16, left: 0 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="serviceType" tick={{ fontSize: 11, fontWeight: 800, fill: '#475569' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={formatCompactMoney} />
            <Tooltip formatter={(value) => formatCurrency(Number(value || 0))} contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0' }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 900 }} />
            <Bar dataKey="labourAmount" name="Labour" stackId="revenue" fill="#023468" radius={[0, 0, 8, 8]} />
            <Bar dataKey="spareSale" name="Spare Sale" stackId="revenue" fill="#D97706" />
            <Bar dataKey="lessVas" name="VAS" stackId="revenue" fill="#2563EB" radius={[8, 8, 0, 0]}>
              <LabelList dataKey="lessVas" position="top" formatter={formatChartLabel} fill="#0f172a" fontSize={10} fontWeight={900} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={trendRows} margin={{ top: 36, right: 28, bottom: 14, left: 0 }}>
          <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="day" interval={0} minTickGap={0} tick={<TrendAxisTick />} tickMargin={12} height={58} />
          <YAxis yAxisId="amount" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={formatCompactMoney} />
          <YAxis yAxisId="jc" orientation="right" tick={{ fontSize: 11, fill: '#023468' }} />
          <Tooltip contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0' }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 900 }} />
          <Line yAxisId="amount" type="monotone" dataKey="totalRevenue" name="Revenue" stroke="#2563EB" strokeWidth={3} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} isAnimationActive={false}>
            <LabelList dataKey="totalRevenue" content={<WorkshopTrendValueLabel series="revenue" />} />
          </Line>
          <Line yAxisId="jc" type="monotone" dataKey="totalJc" name="JC" stroke="#023468" strokeWidth={3} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} isAnimationActive={false}>
            <LabelList dataKey="totalJc" content={<WorkshopTrendValueLabel series="jc" />} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-5 bg-slate-50 p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-[1.5rem] bg-white shadow-lg shadow-slate-200/50" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="h-[360px] animate-pulse rounded-[2rem] bg-white shadow-lg shadow-slate-200/50" />
          <div className="h-[360px] animate-pulse rounded-[2rem] bg-white shadow-lg shadow-slate-200/50" />
        </div>
        <div className="h-[420px] animate-pulse rounded-[2rem] bg-white shadow-lg shadow-slate-200/50" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-slate-50 p-8">
        <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-xl shadow-slate-200/50">
          <Wrench className="mx-auto mb-4 h-10 w-10 text-slate-300" />
          <p className="text-sm font-black uppercase tracking-widest text-slate-400">Workshop Performance data is unavailable.</p>
        </div>
      </div>
    )
  }

  const renderWorkshopTable = (variant: 'full' | 'core' = 'full') => {
    const isCore = variant === 'core'
    const tableRows = isCore ? coreRows : rows
    const headings = isCore
      ? [
          'Service Type',
          'Total JC',
          'JC %',
          'Labour Amt',
          'Labour %',
          'Labour/RO',
          'LAB/RO(-VAS)',
          'Spare Sale',
          'Spare/RO',
          'Discount',
        ]
      : [
          'Service Type',
          'Total JC',
          'JC %',
          'Labour Amt',
          'Labour %',
          'Labour/RO',
          'VAS %',
          'LAB/RO(-VAS)',
          'Spare Sale',
          'Spare/RO',
          'Discount',
          'WA Count',
          'WA Amt',
          'WA/RO %',
          'WB Count',
          'WB Amt',
          'WB/RO %',
          'Less VAS',
          'EW Count',
          'RSA Count',
        ]

    return (
    <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/50">
      <div className="border-b border-slate-100 p-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Workshop Matrix</p>
        <h3 className="text-2xl font-black tracking-tight text-slate-950">
          {isCore ? 'Service type core performance table' : 'Service type performance table'}
        </h3>
        <p className="mt-2 text-xs font-bold text-slate-500">
          {isCore
            ? 'Core RO, labour, spare, and discount view without addon and auxiliary columns.'
            : 'WA = Wheel Alignment, WB = Wheel Balancing, VAS = Value Added Services.'}
        </p>
      </div>
      <div className="overflow-auto">
        <table className={cn('w-full border-collapse text-left', isCore ? 'min-w-[980px]' : 'min-w-[1480px]')}>
          <thead className="bg-teal-800 text-white">
            <tr>
              {headings.map((heading) => (
                <th key={heading} className="border border-teal-700/80 px-3 py-3 text-[8px] font-black uppercase tracking-widest">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tableRows.flatMap((row) => {
              const isTotal = row.serviceType === 'Grand Total'
              const subRows = row.subRows || []
              const hasSubRows = subRows.length > 0 && !isTotal
              const isExpanded = expandedWorkshopRows.has(row.serviceType)
              const renderRow = (item: WorkshopPerformanceRow, options?: { child?: boolean; parentTotal?: boolean }) => {
                const isGrandTotal = item.serviceType === 'Grand Total'
                const isContributionSubtotal = Boolean(options?.parentTotal)

                return (
                <tr
                  key={`${options?.child ? `${row.serviceType}-child-` : ''}${item.serviceType}`}
                  className={cn(
                    isGrandTotal ? 'bg-slate-100/90 text-slate-950 shadow-[inset_4px_0_0_#023468]' : options?.child ? 'bg-slate-50/70 text-slate-700' : 'bg-white hover:bg-slate-50',
                    options?.parentTotal && 'bg-slate-100/90',
                    getManagementTotalRowClass(item.serviceType)
                  )}
                >
                  <td className={cn('border border-slate-200 px-3 py-2 text-[11px] font-black leading-tight', options?.child && 'pl-9 font-bold')}>
                    <div className="flex items-center gap-2">
                      {!options?.child && hasSubRows ? (
                        <button
                          type="button"
                          onClick={() => toggleWorkshopRow(row.serviceType)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-teal-200 hover:text-teal-700"
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.serviceType}`}
                        >
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !isExpanded && '-rotate-90')} />
                        </button>
                      ) : options?.child ? (
                        <span className="h-px w-4 bg-slate-300" />
                      ) : (
                        <span className="h-6 w-6" />
                      )}
                      <span>{item.serviceType}</span>
                    </div>
                  </td>
                  <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-black">{item.totalJc.toLocaleString('en-IN')}</td>
                  <td className={cn('border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold', isContributionSubtotal ? 'text-slate-400' : getPercentToneClass(item.totalJcPercent))}>
                    {isContributionSubtotal ? '-' : formatPercent(item.totalJcPercent)}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-black">{formatWorkshopTableMoney(item.labourAmount)}</td>
                  <td className={cn('border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold', isContributionSubtotal ? 'text-slate-400' : getPercentToneClass(item.labourPercent))}>
                    {isContributionSubtotal ? '-' : formatPercent(item.labourPercent)}
                  </td>
                  <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold">{formatWorkshopTableMoney(item.labourPerRo)}</td>
                  {!isCore && (
                    <td className={cn('border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold', getPercentToneClass(item.vasPercent))}>{formatPercent(item.vasPercent)}</td>
                  )}
                  <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold">{formatWorkshopTableMoney(item.labPerRoMinusVas)}</td>
                  <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-black">{formatWorkshopTableMoney(item.spareSale)}</td>
                  <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold">{formatWorkshopTableMoney(item.sparePerRo)}</td>
                  <td className={cn('border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold', item.discount > 0 && 'text-rose-600')}>{formatWorkshopTableMoney(item.discount)}</td>
                  {!isCore && (
                    <>
                      <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold">{item.waCount.toLocaleString('en-IN')}</td>
                      <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold">{formatWorkshopTableMoney(item.waAmount)}</td>
                      <td className={cn('border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold', getPercentToneClass(item.waPerRoPercent))}>{formatPercent(item.waPerRoPercent)}</td>
                      <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold">{item.wbCount.toLocaleString('en-IN')}</td>
                      <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold">{formatWorkshopTableMoney(item.wbAmount)}</td>
                      <td className={cn('border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold', getPercentToneClass(item.wbPerRoPercent))}>{formatPercent(item.wbPerRoPercent)}</td>
                      <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-bold">{formatWorkshopTableMoney(item.lessVas)}</td>
                      <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-black">
                        {isGrandTotal ? item.ewCount.toLocaleString('en-IN') : '-'}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 font-mono text-[11px] font-black">
                        {isGrandTotal ? item.rsaCount.toLocaleString('en-IN') : '-'}
                      </td>
                    </>
                  )}
                </tr>
                )
              }

              return [
                renderRow(row, { parentTotal: isCore ? row.serviceType === 'MECH' || row.serviceType === 'MECH TOTAL' : row.serviceType === 'MECH TOTAL' }),
                ...(isExpanded ? subRows.map((subRow) => renderRow(subRow, { child: true })) : []),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
  }

  return (
    <div className="space-y-6 bg-slate-50 p-6 lg:p-8">
      {expandedWorkshopChart && (
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
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Expanded Workshop Chart</p>
                <h3 className="text-lg font-black tracking-tight text-slate-950">{expandedWorkshopChart.title}</h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setExpandedWorkshopChart(null)}
                className="h-9 w-9 rounded-xl p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close expanded chart"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="expanded-chart-body min-h-0 flex-1 bg-white p-5" style={{ backgroundColor: '#ffffff' }}>
              <div className="expanded-chart-surface h-full rounded-2xl bg-white" style={{ backgroundColor: '#ffffff' }}>
                {renderWorkshopChart(expandedWorkshopChart.id)}
              </div>
            </div>
          </div>
        </div>
      )}

      <DealerCoverageNotice coverage={data?.meta.dealerCoverage?.primary} />

      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/50">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Advisor Filter</p>
            <h3 className="text-lg font-black tracking-tight text-slate-950">Service type performance by advisor</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">
              Filter the Workshop Performance tables using service advisor from the selected date range.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selectedWorkshopAdvisor}
              onChange={(event) => setSelectedWorkshopAdvisor(event.target.value)}
              className="h-11 min-w-[240px] rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-950 shadow-sm outline-none transition focus:border-[var(--dashboard-primary)] focus:ring-2 focus:ring-[rgba(var(--dashboard-primary-rgb),0.18)]"
            >
              <option value="all">All advisors</option>
              {workshopAdvisorOptions.map((advisor) => (
                <option key={advisor} value={advisor}>{advisor}</option>
              ))}
            </select>
            {selectedWorkshopAdvisor !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedWorkshopAdvisor('all')}
                className="app-outline-action inline-flex h-11 items-center justify-center rounded-2xl px-4 text-sm font-black"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {renderWorkshopTable()}
      {renderWorkshopTable('core')}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => {
          const growthValue = card.metric.growth
          const hasGrowth = typeof growthValue === 'number'
          return (
            <div key={card.label} className="rounded-[1.5rem] border border-white/70 bg-white/90 p-5 shadow-xl shadow-slate-200/50">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-950">
                  <Wrench className="h-5 w-5 text-slate-950" />
                </div>
                <span className={cn(
                  'rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                  getGrowthBadgeClass(hasGrowth ? growthValue : 'N/A')
                )}>
                  {hasGrowth ? formatSignedGrowth(growthValue) : 'N/A'}
                </span>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{card.label}</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{card.formatter(card.metric.value)}</p>
              {card.metric.ly !== undefined && (
                <p className="mt-3 text-xs font-bold text-slate-400">LY {card.formatter(card.metric.ly)}</p>
              )}
              {'helper' in card && card.helper && (
                <p className="mt-3 text-xs font-bold text-slate-400">{card.helper}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="space-y-6">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Service Mix</p>
              <h3 className="text-2xl font-black tracking-tight text-slate-950">Labour, spares, and VAS by service type</h3>
            </div>
            {renderWorkshopExpandButton('service-mix', 'Service Mix')}
          </div>
          <div className="h-[460px]">
            {renderWorkshopChart('service-mix')}
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Daily Trend</p>
              <h3 className="text-2xl font-black tracking-tight text-slate-950">JC load and revenue movement</h3>
            </div>
            {renderWorkshopExpandButton('daily-trend', 'Daily Trend')}
          </div>
          <div className="h-[460px]">
            {renderWorkshopChart('daily-trend')}
          </div>
        </div>
      </div>
    </div>
  )
}

function ROBillingAnalytics({
  sheetId,
  sheetName,
  activeSheet,
  prefetchedData,
  isPrefetching,
  dateFilter,
  dealerCode,
}: {
  sheetId: string
  sheetName: string
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: BusinessDateFilter
  dealerCode?: string | null
}) {
  return (
    <LegacyROBillingAnalytics
      sheetId={sheetId}
      sheetName={sheetName}
      activeSheet={activeSheet}
      prefetchedData={prefetchedData}
      isPrefetching={isPrefetching}
      dateFilter={dateFilter}
      dealerCode={dealerCode}
    />
  )
}

function LegacyROBillingAnalytics({
  sheetId,
  sheetName,
  activeSheet,
  prefetchedData,
  isPrefetching,
  dateFilter,
  dealerCode,
}: {
  sheetId: string
  sheetName: string
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: BusinessDateFilter
  dealerCode?: string | null
}) {
  const initialData = prefetchedData && prefetchedData.length > 0 ? prefetchedData : []

  return (
    <div className="space-y-8 mt-8">
      <ServiceTypePerformance
        data={initialData}
        sheetId={sheetId}
        sheetName={sheetName}
        activeSheet={activeSheet}
        prefetchedData={prefetchedData}
        isPrefetching={isPrefetching}
        dateFilter={dateFilter}
        dealerCode={dealerCode}
      />
    </div>
  )
}

function ROBillingRevenueSummarySection({
  rowsByMetric,
  isLoading,
  dateFilter,
}: {
  rowsByMetric: Partial<Record<ROAnalysisType, StatRow[]>>
  isLoading: boolean
  dateFilter: BusinessDateFilter
}) {
  const [activeRevenueTab, setActiveRevenueTab] = useState<'labour' | 'parts' | 'growth'>('labour')
  const labourRows = rowsByMetric.labour || []
  const partsRows = rowsByMetric.parts || []
  const loadRows = rowsByMetric.load || []
  const getGrandTotal = (rows: StatRow[]) => rows.find((row) => row.name === 'Grand Total') || rows[rows.length - 1]
  const labourTotal = getGrandTotal(labourRows)
  const partsTotal = getGrandTotal(partsRows)
  const loadTotal = getGrandTotal(loadRows)
  type RevenuePerformanceRow = { key: string; label: string; row: StatRow }
  const revenueCategoryMap = [
    ['MECH', 'Mechanical'],
    ['Accident', 'Accidental'],
    ['Paid Service', 'Paid Service'],
    ['Free Services', 'Free Service'],
    ['Running Repairs', 'Running Repair'],
    ['Others', 'Others'],
  ] as const
  const buildRevenueRows = (rows: StatRow[], totalLabel: string) => {
    const categoryRows = revenueCategoryMap.reduce<RevenuePerformanceRow[]>((items, [name, label]) => {
      const row = rows.find((item) => item.name === name)
      if (row) items.push({ key: name, label, row })
      return items
    }, [])
    const grandTotal = getGrandTotal(rows)
    if (grandTotal) categoryRows.push({ key: 'Grand Total', label: totalLabel, row: grandTotal })
    return categoryRows
  }
  const labourRevenueRows = buildRevenueRows(labourRows, 'Total Labour')
  const partsRevenueRows = buildRevenueRows(partsRows, 'Total Parts')
  const activeRevenueRows = activeRevenueTab === 'labour' ? labourRevenueRows : partsRevenueRows
  const paidLoad = loadRows.find((row) => row.name === 'Paid Service')
  const paidServiceContribution = loadTotal && Number(loadTotal.cy || 0) > 0
    ? (Number(paidLoad?.cy || 0) / Number(loadTotal.cy || 0)) * 100
    : 0
  const renderMoney = (value: number | string | 'N/A' | undefined | null) => {
    if (value === 'N/A' || value === undefined || value === null || Number.isNaN(Number(value))) return 'N/A'
    return formatCurrency(Number(value))
  }
  const moneyTextClass = (value: number | string | 'N/A' | undefined | null, fallback = 'text-slate-900') => {
    if (value === 'N/A' || value === undefined || value === null || Number.isNaN(Number(value))) return 'text-slate-400'
    return Number(value) < 0 ? 'text-rose-600' : fallback
  }
  const formatGrowth = (value: string | number | 'N/A') => {
    if (value === 'N/A') return 'N/A'
    const numeric = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(numeric)) return 'N/A'
    return `${numeric >= 0 ? '+' : '-'}${Math.abs(numeric).toFixed(1)}%`
  }
  const growthBadgeClass = (value: string | number | 'N/A') => {
    if (value === 'N/A' || Number.isNaN(Number(value))) {
      return 'border-slate-200 bg-white text-slate-400'
    }
    return Number(value) >= 0
      ? 'border-[lab(80_-85.05_36.36)] bg-white text-[lab(80_-85.05_36.36)]'
      : 'border-[lab(53_89.72_88.48)] bg-white text-[lab(53_89.72_88.48)]'
  }
  const selectedRange = getSelectedBusinessDateRange(dateFilter)
  const comparisonStart = dateFilter?.comparison?.previousStartDate
    ? parseBusinessDate(dateFilter.comparison.previousStartDate)
    : null
  const comparisonEnd = dateFilter?.comparison?.previousEndDate
    ? parseBusinessDate(dateFilter.comparison.previousEndDate)
    : null
  const fallbackLyStart = new Date(selectedRange.start)
  fallbackLyStart.setFullYear(fallbackLyStart.getFullYear() - 1)
  const fallbackLyEnd = new Date(selectedRange.end)
  fallbackLyEnd.setFullYear(fallbackLyEnd.getFullYear() - 1)
  const revenueDateFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const formatRevenueRange = (start: Date, end: Date) => {
    const sameDay = getInputDate(start) === getInputDate(end)
    return sameDay
      ? revenueDateFormatter.format(start)
      : `${revenueDateFormatter.format(start)} to ${revenueDateFormatter.format(end)}`
  }
  const currentRevenueRangeLabel = formatRevenueRange(selectedRange.start, selectedRange.end)
  const comparisonRevenueRangeLabel = formatRevenueRange(comparisonStart || fallbackLyStart, comparisonEnd || fallbackLyEnd)
  const currentRevenue = Number(labourTotal?.cy || 0) + Number(partsTotal?.cy || 0)
  const comparisonRevenue = Number(labourTotal?.ly === 'N/A' ? 0 : labourTotal?.ly || 0)
    + Number(partsTotal?.ly === 'N/A' ? 0 : partsTotal?.ly || 0)
  const revenueGrowth = (() => {
    return comparisonRevenue > 0 ? ((currentRevenue - comparisonRevenue) / comparisonRevenue) * 100 : 'N/A'
  })()

  if (isLoading && labourRows.length === 0 && partsRows.length === 0) {
    return <SheetContentSkeleton />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
          <TrendingUp className="h-5 w-5 text-slate-700" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-800">Revenue Performance</h2>
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-widest text-slate-400">
            Real-time analysis from: RO Billing Report
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          { id: 'labour' as const, label: 'Labour Revenue' },
          { id: 'parts' as const, label: 'Parts Revenue' },
          { id: 'growth' as const, label: 'Growth Revenue' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveRevenueTab(tab.id)}
            className={cn(
              'rounded-xl px-6 py-3 text-sm font-black transition',
              activeRevenueTab === tab.id
                ? 'bg-slate-950 text-white shadow-lg shadow-slate-300'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(activeRevenueTab === 'labour' || activeRevenueTab === 'parts') && (
        <Card className="overflow-hidden rounded-2xl border-none shadow-xl shadow-slate-200/50">
          <CardHeader className={cn('p-5 text-white', activeRevenueTab === 'labour' ? 'bg-blue-600' : 'bg-purple-600')}>
            <CardTitle className="flex items-center gap-2 text-lg font-black">
              <IndianRupee className="h-5 w-5" />
              {activeRevenueTab === 'labour' ? 'Labour' : 'Part'} Revenue Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-6 py-4 text-left text-[10px] font-black uppercase text-slate-400">Category</th>
                  <th colSpan={3} className="border-x border-slate-100 px-4 py-4 text-center text-[10px] font-black uppercase text-slate-400">MTD</th>
                  <th colSpan={3} className="border-r border-slate-100 px-4 py-4 text-center text-[10px] font-black uppercase text-slate-400">QTD</th>
                  <th colSpan={3} className="px-4 py-4 text-center text-[10px] font-black uppercase text-slate-400">YTD</th>
                </tr>
                <tr className="border-b border-slate-100 bg-white">
                  <th className="px-6 py-2"></th>
                  {(['MTD', 'QTD', 'YTD'] as const).map((period) => (
                    <React.Fragment key={period}>
                      <th className="px-2 py-2 text-[9px] font-bold text-slate-400">CY</th>
                      <th className="px-2 py-2 text-[9px] font-bold text-slate-400">LY</th>
                      <th className="border-r border-slate-50 px-2 py-2 text-[9px] font-bold text-slate-400 last:border-r-0">%</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRevenueRows.length > 0 ? (
                  activeRevenueRows.map(({ key, label, row }) => (
                  <tr key={key} className={cn('hover:bg-slate-50/50', getManagementTotalRowClass(row.name))}>
                    <td className="px-6 py-5 text-sm font-black">{label}</td>
                    {([
                      { key: 'mtd', cy: row.cy, ly: row.ly, growth: row.growth },
                      { key: 'qtd', cy: row.qtdCY, ly: row.qtdLY, growth: row.qtdGrowth },
                      { key: 'ytd', cy: row.ytdCY, ly: row.ytdLY, growth: row.ytdGrowth },
                    ] as const).map((period) => (
                      <React.Fragment key={period.key}>
                        <td className={cn('px-4 py-5 text-center text-sm font-bold', moneyTextClass(period.cy))}>{renderMoney(period.cy)}</td>
                        <td className={cn('px-4 py-5 text-center text-sm font-medium', moneyTextClass(period.ly, 'text-slate-400'))}>{renderMoney(period.ly)}</td>
                        <td className="border-r border-slate-50 px-4 py-5 text-center last:border-r-0">
                          <span className={cn(
                            'inline-flex min-w-[76px] justify-center rounded-full border px-3 py-1 text-xs font-black',
                            growthBadgeClass(period.growth)
                          )}>
                            {formatGrowth(period.growth)}
                          </span>
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="px-6 py-10 text-center text-sm font-bold text-slate-500">
                      Revenue summary is loading.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </CardContent>
        </Card>
      )}

      {activeRevenueTab === 'growth' && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card className="rounded-3xl border-none shadow-xl shadow-slate-200/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-500">Total Revenue Growth</CardTitle>
              <BarChart3 className={cn('h-4 w-4', revenueGrowth !== 'N/A' && revenueGrowth < 0 ? 'text-[lab(53_89.72_88.48)]' : 'text-[lab(80_-85.05_36.36)]')} />
            </CardHeader>
            <CardContent>
              <div className={cn(
                'text-3xl font-black',
                revenueGrowth === 'N/A'
                  ? 'text-slate-800'
                  : revenueGrowth < 0
                    ? 'text-[lab(53_89.72_88.48)]'
                    : 'text-[lab(80_-85.05_36.36)]'
              )}>
                {formatGrowth(revenueGrowth)}
              </div>
              <p className="mt-1 text-[10px] font-bold uppercase text-slate-400">
                CY {currentRevenueRangeLabel} vs LY {comparisonRevenueRangeLabel}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CY Revenue</p>
                  <p className="mt-1 text-sm font-black text-slate-950">{formatCurrency(currentRevenue)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">LY Revenue</p>
                  <p className="mt-1 text-sm font-black text-slate-950">{formatCurrency(comparisonRevenue)}</p>
                </div>
              </div>
              <p className="mt-3 text-[10px] font-bold uppercase leading-4 text-slate-500">
                Growth = (CY Revenue - LY Revenue) / LY Revenue x 100
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-none shadow-xl shadow-slate-200/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-500">Paid Service Contribution</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black text-slate-800">{paidServiceContribution.toFixed(1)}%</div>
              <p className="mt-1 text-[10px] font-bold uppercase text-slate-400">
                Paid Service load share in CY selected period
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
function ServiceTypePerformance({
  data: initialData,
  dateFilter,
  dealerCode,
}: {
  data: Record<string, unknown>[]
  sheetId: string
  sheetName: string
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: BusinessDateFilter
  dealerCode?: string | null
}) {
  const queryClient = useQueryClient()
  const [serverTableRowsByMetric, setServerTableRowsByMetric] = useState<Partial<Record<ROAnalysisType, StatRow[]>>>({})
  const [serverTrendByMetric, setServerTrendByMetric] = useState<Partial<Record<ROAnalysisType, ROAnalysisResponse>>>({})
  const [serverFyByMetric, setServerFyByMetric] = useState<Partial<Record<ROAnalysisType, ROAnalysisResponse>>>({})
  const [serverAnalyticsSummary, setServerAnalyticsSummary] = useState<ROAnalysisResponse['analyticsSummary'] | null>(null)
  const [serverLeaderboard, setServerLeaderboard] = useState<SalesLeaderboardRow[]>([])
  const [cancelledSummary, setCancelledSummary] = useState<CancelledBillingSummary | null>(null)
  const [roBillingDealerCoverage, setRoBillingDealerCoverage] = useState<DealerCoverage | null>(null)
  const [isServerViewLoading, setIsServerViewLoading] = useState(false)
  const [isServerTableLoading, setIsServerTableLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<string[]>([])
  const [activeTrend, setActiveTrend] = useState("Load Trend")
  const [activeDailyMetric, setActiveDailyMetric] = useState<DailyProgressMetric>('all')
  const [selectedRoCalendarDate, setSelectedRoCalendarDate] = useState('')
  const [showRoCalendarDialog, setShowRoCalendarDialog] = useState(false)
  const [viewMode, setViewMode] = useState<ROAnalysisView>('table')
  const [fySearchQuery, setFySearchQuery] = useState('')
  const [expandedChart, setExpandedChart] = useState<{ title: string; chartId: string } | null>(null)
  const data = initialData

  const activeAnalysisType: ROAnalysisType = useMemo(() => {
    if (activeTrend === 'Labour Trend') return 'labour'
    if (activeTrend === 'Parts Trend') return 'parts'
    if (activeTrend === 'Labour Per Vehicle Trend') return 'lab_per_veh'
    if (activeTrend === 'Parts Per Vehicle Trend') return 'part_per_veh'
    return 'load'
  }, [activeTrend])
  const roAnalysisTypes: ROAnalysisType[] = useMemo(() => ['load', 'labour', 'parts', 'lab_per_veh', 'part_per_veh'], [])
  const dailyProgressMetrics: Array<{ id: DailyProgressMetric; label: string; color: string }> = useMemo(() => [
    { id: 'all', label: 'All', color: '#64748B' },
    { id: 'revenue', label: 'Total Revenue', color: '#1D4ED8' },
    { id: 'labour', label: 'Labour', color: '#023468' },
    { id: 'parts', label: 'Parts', color: '#D97706' },
    { id: 'load', label: 'Load', color: '#BE123C' },
  ], [])
  const showDailySeries = useCallback((series: Exclude<DailyProgressMetric, 'all'>) => {
    return activeDailyMetric === 'all' || activeDailyMetric === series
  }, [activeDailyMetric])

  const convertServerTableRows = useCallback((rows: ROAnalysisRow[] = []): StatRow[] => {
    const topRows = rows.filter((row) => row.depth === 0)
    const toStatRow = (name: string, sourceRows: ROAnalysisRow[], isParent = false): StatRow => {
      const sumMetric = (period: PeriodKey, key: 'cy' | 'ly'): number | 'N/A' => {
        let total = 0
        let hasNumericValue = false
        for (const row of sourceRows) {
          const value = row.metrics[period]?.[key]
          if (value === 'N/A') continue
          hasNumericValue = true
          total += Number(value || 0)
        }
        return key === 'cy' || hasNumericValue ? total : 'N/A'
      }

      const cy = sumMetric('mtd', 'cy') as number
      const ly = sumMetric('mtd', 'ly')
      const qtdCY = sumMetric('qtd', 'cy') as number
      const qtdLY = sumMetric('qtd', 'ly')
      const ytdCY = sumMetric('ytd', 'cy') as number
      const ytdLY = sumMetric('ytd', 'ly')
      const calcGrowthString = (current: number, previous: number | 'N/A') => {
        if (previous === 'N/A' || previous <= 0) return 'N/A'
        return (((current - previous) / previous) * 100).toFixed(1)
      }

      return {
        name,
        isParent,
        td: Number(sumMetric('td', 'cy') || 0),
        cy,
        ly,
        growth: calcGrowthString(cy, ly),
        qtdCY,
        qtdLY,
        qtdGrowth: calcGrowthString(qtdCY, qtdLY),
        ytdCY,
        ytdLY,
        ytdGrowth: calcGrowthString(ytdCY, ytdLY),
        subRows: [],
      }
    }

    const { paidRows, freeRows, runningRows, accidentRows, otherRows } = partitionServiceTypeRows(
      topRows,
      (row) => row.name,
      'platinum',
    )

    const normalizeComparableName = (name: string) => name
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/s$/, '')

    const isCleanServiceName = (name: string, parentName = '') => {
      const trimmed = name.trim()
      if (!trimmed) return false
      const normalized = normalizeComparableName(trimmed)
      if (!normalized || normalized === 'unspecified' || normalized === 'other') return false
      if (/^\d+\s*k$/i.test(trimmed)) return false

      const parent = normalizeComparableName(parentName)
      if (parent && normalized === parent) return false

      const workTypeLabels = [
        'paid service',
        'free service',
        'free services',
        'running repair',
        'running repairs',
        'accident',
        'accidental repair',
        'others',
        'mech',
      ].map(normalizeComparableName)
      return !workTypeLabels.includes(normalized)
    }

    const buildSubRows = (rowsForCategory: ROAnalysisRow[], parentName = '') => {
      const childRows = rowsForCategory.flatMap((row) => row.children?.length ? row.children : [])
      const cleanChildRows = childRows.filter((row) => isCleanServiceName(row.name, parentName))
      const childByName = new Map<string, ROAnalysisRow[]>()
      cleanChildRows.forEach((row) => {
        const key = normalizeComparableName(row.name)
        const existing = childByName.get(key)
        if (existing) {
          existing.push(row)
        } else {
          childByName.set(key, [row])
        }
      })

      return Array.from(childByName.values())
        .map((matchingRows) => toStatRow(matchingRows[0]?.name || 'Service', matchingRows))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    const paid = toStatRow('Paid Service', paidRows, paidRows.length > 0)
    paid.subRows = buildSubRows(paidRows, paid.name)
    paid.isParent = paid.subRows.length > 0
    const free = toStatRow('Free Services', freeRows, freeRows.length > 0)
    free.subRows = buildSubRows(freeRows, free.name)
    free.isParent = free.subRows.length > 0
    const running = toStatRow('Running Repairs', runningRows, runningRows.length > 0)
    running.subRows = buildSubRows(runningRows, running.name)
    running.isParent = running.subRows.length > 0
    const others = toStatRow('Others', otherRows, otherRows.length > 0)
    others.subRows = otherRows
      .filter((row) => isCleanServiceName(row.name, others.name))
      .map((row) => toStatRow(row.name, [row]))
      .sort((a, b) => a.name.localeCompare(b.name))
    others.isParent = others.subRows.length > 0
    const accident = toStatRow('Accident', accidentRows, accidentRows.length > 0)
    accident.subRows = buildSubRows(accidentRows, accident.name)
    accident.isParent = accident.subRows.length > 0
    const mech = toStatRow('MECH', [paid, free, running].map((row) => ({
      name: row.name,
      depth: 0,
      metrics: {
        td: { cy: row.td, ly: 'N/A', growth: 'N/A' },
        mtd: { cy: row.cy, ly: row.ly, growth: 'N/A' },
        qtd: { cy: row.qtdCY, ly: row.qtdLY, growth: 'N/A' },
        ytd: { cy: row.ytdCY, ly: row.ytdLY, growth: 'N/A' },
      },
      children: [],
    })))
    const mechTotal = toStatRow('MECH TOTAL', [mech, others].map((row) => ({
      name: row.name,
      depth: 0,
      metrics: {
        td: { cy: row.td, ly: 'N/A', growth: 'N/A' },
        mtd: { cy: row.cy, ly: row.ly, growth: 'N/A' },
        qtd: { cy: row.qtdCY, ly: row.qtdLY, growth: 'N/A' },
        ytd: { cy: row.ytdCY, ly: row.ytdLY, growth: 'N/A' },
      },
      children: [],
    })))
    const grandTotal = toStatRow('Grand Total', [mechTotal, accident].map((row) => ({
      name: row.name,
      depth: 0,
      metrics: {
        td: { cy: row.td, ly: 'N/A', growth: 'N/A' },
        mtd: { cy: row.cy, ly: row.ly, growth: 'N/A' },
        qtd: { cy: row.qtdCY, ly: row.qtdLY, growth: 'N/A' },
        ytd: { cy: row.ytdCY, ly: row.ytdLY, growth: 'N/A' },
      },
      children: [],
    })))

    return [paid, free, running, mech, others, mechTotal, accident, grandTotal]
  }, [])

  const derivePerVehicleRows = useCallback((amountRows: StatRow[] = [], loadRows: StatRow[] = []): StatRow[] => {
    const amountByName = new Map(amountRows.map((row) => [row.name, row]))
    const ratio = (amount: number | 'N/A' | undefined, load: number | 'N/A' | undefined): number | 'N/A' => {
      if (amount === 'N/A' || load === 'N/A') return 'N/A'
      const safeAmount = Number(amount || 0)
      const safeLoad = Number(load || 0)
      return safeLoad > 0 ? safeAmount / safeLoad : 0
    }
    const growthString = (current: number, previous: number | 'N/A') => {
      if (previous === 'N/A' || previous <= 0) return 'N/A'
      return (((current - previous) / previous) * 100).toFixed(1)
    }
    const deriveRow = (loadRow: StatRow, amountRow?: StatRow): StatRow => {
      const childAmountByName = new Map((amountRow?.subRows || []).map((row) => [row.name, row]))
      const subRows = (loadRow.subRows || []).map((loadSubRow) => deriveRow(loadSubRow, childAmountByName.get(loadSubRow.name)))
      const cy = ratio(amountRow?.cy, loadRow.cy) as number
      const ly = ratio(amountRow?.ly, loadRow.ly)
      const qtdCY = ratio(amountRow?.qtdCY, loadRow.qtdCY) as number
      const qtdLY = ratio(amountRow?.qtdLY, loadRow.qtdLY)
      const ytdCY = ratio(amountRow?.ytdCY, loadRow.ytdCY) as number
      const ytdLY = ratio(amountRow?.ytdLY, loadRow.ytdLY)

      return {
        name: loadRow.name,
        isParent: subRows.length > 0,
        td: ratio(amountRow?.td, loadRow.td) as number,
        cy,
        ly,
        growth: growthString(cy, ly),
        qtdCY,
        qtdLY,
        qtdGrowth: growthString(qtdCY, qtdLY),
        ytdCY,
        ytdLY,
        ytdGrowth: growthString(ytdCY, ytdLY),
        subRows,
      }
    }

    return loadRows.map((loadRow) => deriveRow(loadRow, amountByName.get(loadRow.name)))
  }, [])

  useEffect(() => {
    let isActive = true
    async function fetchTableSummary() {
      try {
        setIsServerTableLoading(true)
        const range = getDefaultRODateRange(dateFilter)
        const params = new URLSearchParams({
          brand: 'platinum',
          sheet: 'am_platinum_ro_billing_report',
          analysisType: 'load',
          view: 'table',
          groupBy: 'work_type',
          metrics: 'all',
          startDate: range.startDate,
          endDate: range.endDate,
        })
        appendBusinessComparisonParams(params, dateFilter)
        appendKiaDealerCodeParam(params, dealerCode)
        const queryString = params.toString()
        const result = await queryClient.fetchQuery({
          queryKey: ['business-excellence', 'ro-billing-analysis', queryString],
          queryFn: async () => {
            const response = await fetch(`/api/brands/platinum/business-excellence/ro-billing-analysis?${queryString}`)
            logApiTimings(response, 'ro-billing-table-summary')
            return await readPlatinumJson<ROAnalysisResponse>(response, 'RO Billing table summary bundle')
          },
          staleTime: DASHBOARD_STALE_TIME_MS,
        })
        const convertedRowsByMetric: Partial<Record<ROAnalysisType, StatRow[]>> = {}
        for (const analysisType of roAnalysisTypes) {
          if (analysisType === 'lab_per_veh' || analysisType === 'part_per_veh') continue
          const metricResult = result.byMetric?.[analysisType] || result
          convertedRowsByMetric[analysisType] = convertServerTableRows(metricResult.rows || [])
        }
        convertedRowsByMetric.lab_per_veh = derivePerVehicleRows(convertedRowsByMetric.labour, convertedRowsByMetric.load)
        convertedRowsByMetric.part_per_veh = derivePerVehicleRows(convertedRowsByMetric.parts, convertedRowsByMetric.load)
        if (isActive) {
          setServerTableRowsByMetric(convertedRowsByMetric)
          setCancelledSummary(result.cancelledSummary || null)
          setRoBillingDealerCoverage(result.meta?.dealerCoverage?.primary || null)
        }
      } catch (error) {
        if (isActive) {
          console.error('Failed to fetch RO Billing table summary:', error)
          setRoBillingDealerCoverage(null)
        }
      } finally {
        if (isActive) setIsServerTableLoading(false)
      }
    }

    fetchTableSummary()
    return () => {
      isActive = false
    }
  }, [convertServerTableRows, dateFilter, dealerCode, derivePerVehicleRows, queryClient, roAnalysisTypes])

  const fetchAnalysisSummary = useCallback(async (analysisType: ROAnalysisType, view: 'trend' | 'fy' | 'analytics' | 'leaderboard') => {
    const range = view === 'trend' ? getROTrendDateRange(dateFilter) : getDefaultRODateRange(dateFilter)
    const params = new URLSearchParams({
      brand: 'platinum',
      sheet: 'am_platinum_ro_billing_report',
      analysisType,
      view,
      groupBy: 'work_type',
      startDate: range.startDate,
      endDate: range.endDate,
    })
    appendBusinessComparisonParams(params, dateFilter)
    appendKiaDealerCodeParam(params, dealerCode)
    const queryString = params.toString()
    return queryClient.fetchQuery({
      queryKey: ['business-excellence', 'ro-billing-analysis', queryString],
      queryFn: async () => {
        const response = await fetch(`/api/brands/platinum/business-excellence/ro-billing-analysis?${queryString}`)
        logApiTimings(response, `ro-billing-${analysisType}-${view}`)
        return await readPlatinumJson<ROAnalysisResponse>(response, `RO Billing ${analysisType} ${view} summary`)
      },
      staleTime: DASHBOARD_STALE_TIME_MS,
    })
  }, [dateFilter, dealerCode, queryClient])

  const fetchAnalysisBundle = useCallback(async (view: 'trend' | 'fy', calendarMode = false) => {
    const selectedRange = getSelectedBusinessDateRange(dateFilter)
    const calendarStart = new Date(selectedRange.end.getFullYear(), selectedRange.end.getMonth(), 1)
    const calendarEnd = new Date(selectedRange.end.getFullYear(), selectedRange.end.getMonth() + 1, 0)
    const range = calendarMode
      ? { startDate: getInputDate(calendarStart), endDate: getInputDate(calendarEnd) }
      : view === 'trend'
        ? getROTrendDateRange(dateFilter)
        : getDefaultRODateRange(dateFilter)
    const params = new URLSearchParams({
      brand: 'platinum',
      sheet: 'am_platinum_ro_billing_report',
      analysisType: 'load',
      view,
      groupBy: 'work_type',
      metrics: 'all',
      startDate: range.startDate,
      endDate: range.endDate,
    })
    appendBusinessComparisonParams(params, dateFilter)
    if (calendarMode) {
      params.set('comparisonMode', 'custom')
      params.set('comparisonStartDate', getInputDate(new Date(calendarStart.getFullYear() - 1, calendarStart.getMonth(), 1)))
      params.set('comparisonEndDate', getInputDate(new Date(calendarEnd.getFullYear() - 1, calendarEnd.getMonth() + 1, 0)))
    }
    appendKiaDealerCodeParam(params, dealerCode)
    const queryString = params.toString()
    return queryClient.fetchQuery({
      queryKey: ['business-excellence', 'ro-billing-analysis', queryString],
      queryFn: async () => {
        const response = await fetch(`/api/brands/platinum/business-excellence/ro-billing-analysis?${queryString}`)
        logApiTimings(response, `ro-billing-${view}-bundle`)
        return await readPlatinumJson<ROAnalysisResponse>(response, `RO Billing ${view} bundle`)
      },
      staleTime: DASHBOARD_STALE_TIME_MS,
    })
  }, [dateFilter, dealerCode, queryClient])

  useEffect(() => {
    let isActive = true
    async function fetchActiveSummaryView() {
      if (viewMode !== 'trend' && !showRoCalendarDialog && viewMode !== 'fy' && viewMode !== 'analytics' && viewMode !== 'leaderboard') return
      try {
        setIsServerViewLoading(true)
        if (viewMode === 'trend' || showRoCalendarDialog) {
          const result = await fetchAnalysisBundle('trend', showRoCalendarDialog)
          if (isActive) {
            setServerTrendByMetric((prev) => ({
              ...prev,
              ...(result.byMetric || {}),
            }))
          }
          return
        }

        if (viewMode === 'analytics') {
          const [trendBundle, analyticsResult] = await Promise.all([
            fetchAnalysisBundle('trend'),
            fetchAnalysisSummary('load', 'analytics'),
          ])
          if (isActive) {
            setServerTrendByMetric((prev) => ({
              ...prev,
              ...(trendBundle.byMetric || {}),
            }))
            setServerAnalyticsSummary(analyticsResult.analyticsSummary || null)
          }
          return
        }

        if (viewMode === 'leaderboard') {
          const result = await fetchAnalysisSummary('load', 'leaderboard')
          if (isActive) {
            setServerLeaderboard(result.advisorLeaderboard || [])
          }
          return
        }

        const result = await fetchAnalysisBundle('fy')
        if (isActive) {
          setServerFyByMetric(result.byMetric || {})
        }
      } catch (error) {
        if (isActive) console.error('Failed to fetch RO Billing summary view:', error)
      } finally {
        if (isActive) setIsServerViewLoading(false)
      }
    }

    fetchActiveSummaryView()
    return () => {
      isActive = false
    }
  }, [fetchAnalysisBundle, fetchAnalysisSummary, showRoCalendarDialog, viewMode])

  const formatValue = (val: number | string | 'N/A' | undefined | null) => {
    if (val === 'N/A' || val === undefined || val === null) return 'N/A'
    const num = typeof val === 'string' ? parseFloat(val) : val
    if (isNaN(num)) return 'N/A'
    return Math.round(num).toLocaleString('en-IN')
  }

  const getUniqueBillKey = (row: Record<string, unknown>, fallbackIndex: number) => {
    const billNo = getRecordValue(row, 'bill_no', 'Bill No')
    const roNo = getRecordValue(row, 'ro_no', 'RO No')
    const primary = billNo !== null && billNo !== undefined && String(billNo).trim() !== ''
      ? String(billNo).trim()
      : roNo !== null && roNo !== undefined && String(roNo).trim() !== ''
        ? String(roNo).trim()
        : null

    return primary || `row-${fallbackIndex}`
  }

  const getUniqueRoKey = (row: Record<string, unknown>, fallbackIndex: number) => {
    const roNo = getRecordValue(row, 'ro_no', 'RO No')
    const billNo = getRecordValue(row, 'bill_no', 'Bill No')
    const primary = roNo !== null && roNo !== undefined && String(roNo).trim() !== ''
      ? String(roNo).trim()
      : billNo !== null && billNo !== undefined && String(billNo).trim() !== ''
        ? String(billNo).trim()
        : null

    return primary || `row-${fallbackIndex}`
  }

  const parseAmount = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (value === null || value === undefined) return 0
    const parsed = parseFloat(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }

  const addBillAmount = (bucket: Map<string, number>, billKey: string, amount: number) => {
    const existing = bucket.get(billKey)
    if (existing === undefined || Math.abs(amount) > Math.abs(existing)) {
      bucket.set(billKey, amount)
    }
  }

  const sumBillAmounts = (bucket: Map<string, number>) => {
    return Array.from(bucket.values()).reduce((total, amount) => total + amount, 0)
  }

  const toggleRow = (name: string) => {
    setExpandedRows(prev =>
      prev.includes(name) ? prev.filter(r => r !== name) : [...prev, name]
    )
  }

  const openExpandedChart = (title: string, chartId: string) => {
    setExpandedChart({ title, chartId })
  }

  const renderExpandButton = (title: string, elementId: string) => (
    <button
      type="button"
      onClick={() => openExpandedChart(title, elementId)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:text-slate-950"
      aria-label={`Expand ${title}`}
      title={`Expand ${title}`}
    >
      <Maximize2 className="h-4 w-4" />
    </button>
  )

  const renderExpandedChartContent = () => {
    if (!expandedChart) return null

    const tooltipStyle = { borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }

    if (expandedChart.chartId === 'analysis-day-wise-trend-chart') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendData} margin={{ top: 36, right: 42, bottom: 34, left: 28 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={<TrendAxisTick />} interval={0} minTickGap={0} tickMargin={14} height={54} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 800, fill: '#64748b' }} width={64} />
            <Tooltip
              formatter={(value, name) => [
                String(name).toLowerCase().includes('revenue') ? formatCurrencyFull(Number(value || 0)) : formatChartNumber(value),
                String(name),
              ]}
              contentStyle={tooltipStyle}
            />
            <ReferenceLine y={dailyTarget} stroke="#f43f5e" strokeDasharray="5 5" label={{ position: 'right', value: 'Target', fill: '#f43f5e', fontSize: 12, fontWeight: 900 }} />
            <Line type="monotone" dataKey="cy" name="This Year" stroke="#0B5D7A" strokeWidth={4} dot={{ r: 5, strokeWidth: 2, fill: '#fff' }}>
              <LabelList dataKey="cy" content={<SmartTrendValueLabel total={trendData.length} series="cy" />} />
            </Line>
            <Line type="monotone" dataKey="ly" name="Last Year" stroke="#D97706" strokeWidth={4} dot={{ r: 5, strokeWidth: 2, fill: '#fff' }}>
              <LabelList dataKey="ly" content={<SmartTrendValueLabel total={trendData.length} series="ly" />} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      )
    }

    if (!executiveAnalytics) return null

    if (expandedChart.chartId === 'analysis-daily-billing-trend-chart') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={executiveAnalytics.dailyRevenue} margin={{ top: 42, right: 46, bottom: 28, left: 26 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="day" interval={0} minTickGap={0} tick={<TrendAxisTick />} tickMargin={12} height={58} />
            <YAxis yAxisId="amount" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 12, fill: '#BE123C' }} />
            <Tooltip formatter={(value, name) => [formatChartNumber(value), String(name)]} contentStyle={tooltipStyle} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 900 }} />
            {showDailySeries('labour') && (
              <Line yAxisId="amount" type="monotone" dataKey="labour" name="Labour" stroke="#023468" strokeWidth={4} dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#023468' }}>
                <LabelList dataKey="labour" position="bottom" formatter={formatChartLabel} fill="#023468" fontSize={activeDailyMetric === 'all' ? 8 : 10} fontWeight={900} />
              </Line>
            )}
            {showDailySeries('parts') && (
              <Line yAxisId="amount" type="monotone" dataKey="parts" name="Parts" stroke="#D97706" strokeWidth={4} dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#D97706' }}>
                <LabelList dataKey="parts" position="bottom" offset={18} formatter={formatChartLabel} fill="#D97706" fontSize={activeDailyMetric === 'all' ? 8 : 10} fontWeight={900} />
              </Line>
            )}
            {showDailySeries('revenue') && (
              <Line yAxisId="amount" type="monotone" dataKey="revenue" name="Total Revenue" stroke="#1D4ED8" strokeWidth={4.5} dot={{ r: 4.5, strokeWidth: 2.5, fill: '#fff', stroke: '#1D4ED8' }} activeDot={{ r: 7, strokeWidth: 3, fill: '#fff', stroke: '#1D4ED8' }}>
                <LabelList dataKey="revenue" position="top" formatter={formatChartLabel} fill="#1D4ED8" fontSize={activeDailyMetric === 'all' ? 8 : 10} fontWeight={900} />
              </Line>
            )}
            {showDailySeries('load') && (
              <Line yAxisId="load" type="monotone" dataKey="load" name="Load" stroke="#BE123C" strokeWidth={4} dot={{ r: 4.5, strokeWidth: 2, fill: '#fff', stroke: '#BE123C' }}>
                <LabelList dataKey="load" position="top" offset={14} formatter={formatChartLabel} fill="#BE123C" fontSize={activeDailyMetric === 'all' ? 8 : 10} fontWeight={900} />
              </Line>
            )}
          </LineChart>
        </ResponsiveContainer>
      )
    }

    if (expandedChart.chartId === 'analysis-service-type-chart') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={executiveAnalytics.services} margin={{ top: 34, right: 46, bottom: 28, left: 26 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 13, fontWeight: 900, fill: '#475569' }} />
            <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
            <Tooltip
              formatter={(value, name) => [
                formatCurrencyFull(Number(value || 0)),
                String(name),
              ]}
              contentStyle={tooltipStyle}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 900 }} />
            <Bar dataKey="labour" name="Labour" stackId="revenue" fill="#023468" radius={[0, 0, 8, 8]}>
              <LabelList dataKey="labour" position="insideTop" formatter={formatChartLabel} fill="#fff" fontSize={11} fontWeight={900} />
            </Bar>
            <Bar dataKey="parts" name="Parts" stackId="revenue" fill="#D97706" radius={[8, 8, 0, 0]}>
              <LabelList dataKey="parts" position="top" formatter={formatChartLabel} fill="#334155" fontSize={11} fontWeight={900} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (expandedChart.chartId === 'analysis-revenue-mix-chart') {
      return (
        <div className="relative h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={executiveAnalytics.revenueMix} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="78%" paddingAngle={5} stroke="#fff" strokeWidth={6}>
                {executiveAnalytics.revenueMix.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
                <LabelList dataKey="value" position="outside" formatter={(value) => formatChartLabel(Number(value || 0))} fill="#0f172a" fontSize={13} fontWeight={900} />
              </Pie>
              <Tooltip formatter={(value, name) => [formatCurrency(Number(value || 0)), String(name)]} contentStyle={tooltipStyle} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 900 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-3xl bg-white/90 px-8 py-5 text-center shadow-xl shadow-slate-200/60">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total</p>
              <p className="text-3xl font-black text-slate-950">{formatCurrency(executiveAnalytics.cySummary.labour + executiveAnalytics.cySummary.parts)}</p>
            </div>
          </div>
        </div>
      )
    }

    if (expandedChart.chartId === 'analysis-efficiency-bars-chart') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={executiveAnalytics.operatingMix} layout="vertical" margin={{ top: 34, right: 86, bottom: 28, left: 90 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 13, fontWeight: 900, fill: '#334155' }} width={110} />
            <Tooltip formatter={(value) => formatCurrency(Number(value || 0))} contentStyle={tooltipStyle} />
            <Bar dataKey="value" radius={[0, 16, 16, 0]}>
              {executiveAnalytics.operatingMix.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
              <LabelList dataKey="value" position="right" formatter={(value) => formatCurrency(Number(value || 0))} fill="#0f172a" fontSize={12} fontWeight={900} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (expandedChart.chartId === 'analysis-work-type-deep-dive-chart') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={executiveAnalytics.services} margin={{ top: 34, right: 46, bottom: 28, left: 26 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 13, fontWeight: 900, fill: '#475569' }} />
            <YAxis yAxisId="amount" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 12, fill: '#BE123C' }} />
            <Tooltip
              formatter={(value, name) => [
                String(name).toLowerCase().includes('revenue') ? formatCurrencyFull(Number(value || 0)) : formatChartNumber(value),
                String(name),
              ]}
              contentStyle={tooltipStyle}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 900 }} />
            <Bar yAxisId="amount" dataKey="revenue" name="Revenue" fill="#1D4ED8" radius={[12, 12, 0, 0]}>
              <LabelList dataKey="revenue" position="top" formatter={formatChartLabel} fill="#1D4ED8" fontSize={11} fontWeight={900} />
            </Bar>
            <Bar yAxisId="load" dataKey="load" name="Load" fill="#BE123C" radius={[12, 12, 0, 0]}>
              <LabelList dataKey="load" position="top" formatter={formatChartLabel} fill="#BE123C" fontSize={11} fontWeight={900} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )
    }

    return null
  }

  const statsData = useMemo(() => {
    if (viewMode !== 'table' && viewMode !== 'analytics') return []
    if (!data || data.length === 0) return []

    // Helper to parse dates from DD/MM/YYYY or YYYY-MM-DD formats
    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '\u2014' || dateStr === '-' || dateStr === '') return null
      const trimmed = String(dateStr).trim()
      // Check YYYY-MM-DD
      if (trimmed.includes('-')) {
        const parts = trimmed.split('-')
        if (parts.length === 3) {
          const year = parseInt(parts[0], 10)
          const month = parseInt(parts[1], 10) - 1
          const day = parseInt(parts[2], 10)
          if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
            return new Date(year, month, day)
          }
        }
      }
      // Check DD/MM/YYYY
      const parts = trimmed.split('/')
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10)
        let month = parseInt(parts[1], 10) - 1
        const year = parseInt(parts[2], 10)

        if (month > 11) {
          const temp = day
          day = month + 1
          month = temp - 1
        }

        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
          return new Date(year, month, day)
        }
      }
      return null
    }

    // Parse all dates to find default max year and month in dataset
    let maxDate = new Date(2025, 2, 31) // default fallback
    let foundAny = false
    data.forEach(row => {
      const dateStr = String(getRecordValue(row, 'bill_date', 'Bill Date') || '')
      const date = parseDate(dateStr)
      if (date) {
        if (!foundAny || date > maxDate) {
          maxDate = date
          foundAny = true
        }
      }
    })

    const selectedRange = getSelectedBusinessDateRange(dateFilter)
    const cyYear = selectedRange.end.getFullYear()
    const cyMonth = selectedRange.end.getMonth()
    const cyDay = selectedRange.end.getDate()
    const isRangeMode = Boolean(dateFilter?.startDate && dateFilter.endDate)
    const rangeStart = selectedRange.start
    const rangeEnd = selectedRange.end

    let cyMtdStart: Date, cyMtdEnd: Date, lyMtdStart: Date, lyMtdEnd: Date

    if (isRangeMode) {
      cyMtdStart = new Date(rangeStart)
      cyMtdStart.setHours(0, 0, 0, 0)
      cyMtdEnd = new Date(rangeEnd)
      cyMtdEnd.setHours(23, 59, 59, 999)

      lyMtdStart = new Date(rangeStart)
      lyMtdStart.setFullYear(lyMtdStart.getFullYear() - 1)
      lyMtdStart.setHours(0, 0, 0, 0)
      lyMtdEnd = new Date(rangeEnd)
      lyMtdEnd.setFullYear(lyMtdEnd.getFullYear() - 1)
      lyMtdEnd.setHours(23, 59, 59, 999)
    } else {
      cyMtdStart = new Date(cyYear, cyMonth, 1, 0, 0, 0, 0)
      cyMtdEnd = new Date(cyYear, cyMonth, cyDay, 23, 59, 59, 999)

      lyMtdStart = new Date(cyYear - 1, cyMonth, 1, 0, 0, 0, 0)
      lyMtdEnd = new Date(cyYear - 1, cyMonth, cyDay, 23, 59, 59, 999)
    }

    const lyEquivalentDayEnd = isRangeMode
      ? (() => {
          const shiftedEnd = new Date(rangeEnd)
          shiftedEnd.setFullYear(shiftedEnd.getFullYear() - 1)
          shiftedEnd.setHours(23, 59, 59, 999)
          return shiftedEnd
        })()
      : new Date(cyYear - 1, cyMonth, cyDay, 23, 59, 59, 999)
    const quarterStartMonth = Math.floor(cyMonth / 3) * 3
    const cyQtdStart = new Date(cyYear, quarterStartMonth, 1, 0, 0, 0, 0)
    const cyQtdEnd = new Date(cyMtdEnd)

    const lyQtdStart = new Date(cyYear - 1, quarterStartMonth, 1, 0, 0, 0, 0)
    const lyQtdEnd = isRangeMode
      ? new Date(lyMtdEnd)
      : new Date(cyYear - 1, cyMonth, cyDay, 23, 59, 59, 999)

    const cyYtdStart = new Date(cyYear, 0, 1, 0, 0, 0, 0)
    const cyYtdEnd = new Date(cyMtdEnd)

    const lyYtdStart = new Date(cyYear - 1, 0, 1, 0, 0, 0, 0)
    const lyYtdEnd = isRangeMode
      ? new Date(lyMtdEnd)
      : new Date(cyYear - 1, cyMonth, cyDay, 23, 59, 59, 999)
    const cyTdStart = new Date(cyMtdEnd)
    cyTdStart.setHours(0, 0, 0, 0)
    const cyTdEnd = new Date(cyMtdEnd)
    cyTdEnd.setHours(23, 59, 59, 999)
    const lyTdStart = new Date(lyEquivalentDayEnd)
    lyTdStart.setHours(0, 0, 0, 0)
    const lyTdEnd = new Date(lyEquivalentDayEnd)
    lyTdEnd.setHours(23, 59, 59, 999)

    console.log('statsData boundaries derived:', {
      cyMtd: `[${cyMtdStart.toISOString()} -> ${cyMtdEnd.toISOString()}]`,
      lyMtd: `[${lyMtdStart.toISOString()} -> ${lyMtdEnd.toISOString()}]`,
      cyQtd: `[${cyQtdStart.toISOString()} -> ${cyQtdEnd.toISOString()}]`,
      lyQtd: `[${lyQtdStart.toISOString()} -> ${lyQtdEnd.toISOString()}]`,
      cyYtd: `[${cyYtdStart.toISOString()} -> ${cyYtdEnd.toISOString()}]`,
      lyYtd: `[${lyYtdStart.toISOString()} -> ${lyYtdEnd.toISOString()}]`,
      cyTd: `[${cyTdStart.toISOString()} -> ${cyTdEnd.toISOString()}]`,
      lyTd: `[${lyTdStart.toISOString()} -> ${lyTdEnd.toISOString()}]`
    })

    const calcGrowth = (cyVal: number, lyVal: number | 'N/A'): string => {
      if (lyVal === 'N/A' || lyVal <= 0) return 'N/A'
      return (((cyVal - lyVal) / lyVal) * 100).toFixed(1)
    }

    const getWorkType = (row: Record<string, unknown>) => String(getRecordValue(row, 'work_type', 'Work Type') || getRecordValue(row, 'category', 'Category') || '').trim()
    const matchesTypes = (row: Record<string, unknown>, types: string[]) => {
      const type = getWorkType(row).toLowerCase()
      return types.some(t => type.includes(t.toLowerCase()))
    }

    const calculateForRows = (name: string, catData: Record<string, unknown>[], isParent = false): StatRow => {

      const isLabourAmount = activeTrend === 'Labour Trend'
      const isPartsAmount = activeTrend === 'Parts Trend'
      const isLabPerVehicle = activeTrend === 'Labour Per Vehicle Trend'
      const isPartPerVehicle = activeTrend === 'Parts Per Vehicle Trend'
      const isLabourMetric = isLabourAmount || isLabPerVehicle
      const isPartsMetric = isPartsAmount || isPartPerVehicle

      const cyMtdKeys = new Set<string>()
      const lyMtdKeys = new Set<string>()
      const cyQtdKeys = new Set<string>()
      const lyQtdKeys = new Set<string>()
      const cyYtdKeys = new Set<string>()
      const lyYtdKeys = new Set<string>()
      const cyTdKeys = new Set<string>()
      const lyTdKeys = new Set<string>()
      const cyMtdAmounts = new Map<string, number>()
      const lyMtdAmounts = new Map<string, number>()
      const cyQtdAmounts = new Map<string, number>()
      const lyQtdAmounts = new Map<string, number>()
      const cyYtdAmounts = new Map<string, number>()
      const lyYtdAmounts = new Map<string, number>()
      const cyTdAmounts = new Map<string, number>()
      const lyTdAmounts = new Map<string, number>()

      const getMetricAmount = (row: Record<string, unknown>) => {
        if (isLabourMetric) return parseAmount(getRecordValue(row, 'labour_amt', 'Labour Amt'))
        if (isPartsMetric) return parseAmount(getRecordValue(row, 'part_amt', 'Part Amt'))
        return 1
      }

      catData.forEach((d, index) => {
        const dateStr = String(getRecordValue(d, 'bill_date', 'Bill Date') || '')
        const date = parseDate(dateStr)

        if (date) {
          const metricAmount = getMetricAmount(d)
          const shouldCount = isLabourAmount || isPartsAmount ? metricAmount !== 0 : true

          if (shouldCount) {
            const billKey = getUniqueBillKey(d, index)
            const roKey = getUniqueRoKey(d, index)
            // MTD checks
            if (date >= cyMtdStart && date <= cyMtdEnd) {
              cyMtdKeys.add(roKey)
              addBillAmount(cyMtdAmounts, billKey, metricAmount)
            }
            if (date >= lyMtdStart && date <= lyMtdEnd) {
              lyMtdKeys.add(roKey)
              addBillAmount(lyMtdAmounts, billKey, metricAmount)
            }

            // QTD checks
            if (date >= cyQtdStart && date <= cyQtdEnd) {
              cyQtdKeys.add(roKey)
              addBillAmount(cyQtdAmounts, billKey, metricAmount)
            }
            if (date >= lyQtdStart && date <= lyQtdEnd) {
              lyQtdKeys.add(roKey)
              addBillAmount(lyQtdAmounts, billKey, metricAmount)
            }

            // YTD checks
            if (date >= cyYtdStart && date <= cyYtdEnd) {
              cyYtdKeys.add(roKey)
              addBillAmount(cyYtdAmounts, billKey, metricAmount)
            }
            if (date >= lyYtdStart && date <= lyYtdEnd) {
              lyYtdKeys.add(roKey)
              addBillAmount(lyYtdAmounts, billKey, metricAmount)
            }

            // TD checks the selected/current Bill Date only.
            if (date >= cyTdStart && date <= cyTdEnd) {
              cyTdKeys.add(roKey)
              addBillAmount(cyTdAmounts, billKey, metricAmount)
            }
            if (date >= lyTdStart && date <= lyTdEnd) {
              lyTdKeys.add(roKey)
              addBillAmount(lyTdAmounts, billKey, metricAmount)
            }
          }
        }
      })

      const getPeriodValue = (keys: Set<string>, amounts: Map<string, number>) => {
        if (isLabourAmount || isPartsAmount) return sumBillAmounts(amounts)
        if (isLabPerVehicle || isPartPerVehicle) {
          return keys.size > 0 ? sumBillAmounts(amounts) / keys.size : 0
        }
        return keys.size
      }

      const cyMtd = getPeriodValue(cyMtdKeys, cyMtdAmounts)
      const lyMtd = getPeriodValue(lyMtdKeys, lyMtdAmounts)
      const cyQtd = getPeriodValue(cyQtdKeys, cyQtdAmounts)
      const lyQtd = getPeriodValue(lyQtdKeys, lyQtdAmounts)
      const cyYtd = getPeriodValue(cyYtdKeys, cyYtdAmounts)
      const lyYtd = getPeriodValue(lyYtdKeys, lyYtdAmounts)
      const cyTd = getPeriodValue(cyTdKeys, cyTdAmounts)

      const displayLy = lyMtd
      const displayQtdLy = lyQtd
      const displayYtdLy = lyYtd

      return {
        name,
        isParent,
        td: cyTd,
        cy: cyMtd,
        ly: displayLy,
        growth: calcGrowth(cyMtd, displayLy),
        qtdCY: cyQtd,
        qtdLY: displayQtdLy,
        qtdGrowth: calcGrowth(cyQtd, displayQtdLy),
        ytdCY: cyYtd,
        ytdLY: displayYtdLy,
        ytdGrowth: calcGrowth(cyYtd, displayYtdLy),
        subRows: []
      }
    }

    const calculateForTypes = (name: string, types: string[], isParent = false): StatRow => {
      return calculateForRows(name, data.filter(d => matchesTypes(d, types)), isParent)
    }

    const paidServiceTypes = ['Paid Service']
    const freeServiceTypes = ['Free Service', 'First Free Service', 'Second Free Service', 'Third Free Service', 'TMA-First Free Service', 'TMA-Second Free Service', 'TMA-Third Free Service', 'Sixth Free Service']
    const runningRepairTypes = ['Running Repair']
    const accidentTypes = ['Accident', 'Bodyshop']
    const classifiedTypes = [...paidServiceTypes, ...freeServiceTypes, ...runningRepairTypes, ...accidentTypes]
    const othersData = data.filter(d => !matchesTypes(d, classifiedTypes))
    const otherWorkTypes = Array.from(
      new Set(
        othersData
          .map(getWorkType)
          .map(type => type || 'Unspecified')
      )
    ).sort((a, b) => a.localeCompare(b))
    const getCategoryWorkTypes = (types: string[]) => Array.from(
      new Set(
        data
          .filter((row) => matchesTypes(row, types))
          .map(getWorkType)
          .map((type) => type || 'Unspecified')
      )
    ).sort((a, b) => a.localeCompare(b))

    const hierarchy = [
      {
        name: 'Paid Service',
        types: paidServiceTypes,
        sub: getCategoryWorkTypes(paidServiceTypes)
      },
      {
        name: 'Free Services',
        types: freeServiceTypes,
        sub: getCategoryWorkTypes(freeServiceTypes)
      },
      { name: 'Running Repairs', types: runningRepairTypes, sub: getCategoryWorkTypes(runningRepairTypes) },
      { name: 'Accident', types: accidentTypes, sub: getCategoryWorkTypes(accidentTypes) },
      {
        name: 'Others',
        types: [],
        sub: otherWorkTypes
      }
    ]

    const result: StatRow[] = []
    hierarchy.forEach(item => {
      const parent = item.name === 'Others'
        ? calculateForRows(item.name, othersData, item.sub.length > 0)
        : calculateForTypes(item.name, item.types, item.sub.length > 0)
      result.push({
        ...parent,
        subRows: item.name === 'Others'
          ? item.sub.map(s => calculateForRows(s, othersData.filter(row => (getWorkType(row) || 'Unspecified') === s)))
          : item.sub.map(s => calculateForTypes(s, [s]))
      })
    })

    const paidRow = result.find(r => r.name === 'Paid Service')!
    const freeRow = result.find(r => r.name === 'Free Services')!
    const runningRow = result.find(r => r.name === 'Running Repairs')!
    const others = result.find(r => r.name === 'Others')!
    const accident = result.find(r => r.name === 'Accident')!

    const calcTotal = (name: string, rows: StatRow[]): StatRow => {
      const cy = rows.reduce((acc, r) => acc + r.cy, 0)

      const sumLyField = (field: 'ly' | 'qtdLY' | 'ytdLY'): number | 'N/A' => {
        let sum = 0
        let hasNumericValue = false
        for (const r of rows) {
          const val = r[field]
          if (val === 'N/A') continue
          hasNumericValue = true
          sum += val
        }
        return hasNumericValue ? sum : 'N/A'
      }

      const ly = sumLyField('ly')
      const qtdCY = rows.reduce((acc, r) => acc + r.qtdCY, 0)
      const qtdLY = sumLyField('qtdLY')
      const ytdCY = rows.reduce((acc, r) => acc + r.ytdCY, 0)
      const ytdLY = sumLyField('ytdLY')

      return {
        name,
        isParent: false,
        td: rows.reduce((acc, r) => acc + r.td, 0),
        cy,
        ly,
        growth: calcGrowth(cy, ly),
        qtdCY,
        qtdLY,
        qtdGrowth: calcGrowth(qtdCY, qtdLY),
        ytdCY,
        ytdLY,
        ytdGrowth: calcGrowth(ytdCY, ytdLY),
        subRows: []
      }
    }

    const mechSubTotal = calcTotal('MECH', [paidRow, freeRow, runningRow])
    const mechTotal = calcTotal('MECH TOTAL', [mechSubTotal, others])
    const grandTotal = calcTotal('Grand Total', [mechTotal, accident])

    return [
      paidRow,
      freeRow,
      runningRow,
      mechSubTotal,
      others,
      mechTotal,
      accident,
      grandTotal
    ]
  }, [data, activeTrend, dateFilter, viewMode])

  const activeServerTableRows = serverTableRowsByMetric[activeAnalysisType] || null
  const effectiveStatsData = viewMode === 'table' && activeServerTableRows ? activeServerTableRows : statsData
  const hasCustomComparison = false
  const hasRawRows = data.length > 0
  const isTrendSummaryPending = viewMode === 'trend' && !hasRawRows && !serverTrendByMetric[activeAnalysisType]
  const isCalendarSummaryPending = showRoCalendarDialog && !hasRawRows && !serverTrendByMetric[activeAnalysisType]
  const isFySummaryPending = viewMode === 'fy' && !hasRawRows && roAnalysisTypes.some((analysisType) => !serverFyByMetric[analysisType])
  const isAnalyticsSummaryPending = viewMode === 'analytics' && !hasRawRows && (
    roAnalysisTypes.some((analysisType) => !serverTrendByMetric[analysisType])
    || roAnalysisTypes.some((analysisType) => !serverTableRowsByMetric[analysisType])
    || !serverAnalyticsSummary
  )

  const renderChartSkeleton = (heightClass = 'h-[420px]') => (
    <div className="space-y-5 p-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-3 w-28 animate-pulse rounded-full bg-slate-200" />
          <div className="h-6 w-56 animate-pulse rounded-xl bg-slate-200" />
        </div>
        <div className="h-9 w-28 animate-pulse rounded-xl bg-slate-100" />
      </div>
      <div className={cn(heightClass, 'animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-lg shadow-slate-200/50')}>
        <div className="grid h-full grid-cols-12 items-end gap-3 p-8">
          {Array.from({ length: 12 }).map((_, index) => (
            <div
              key={`chart-skeleton-bar-${index}`}
              className="rounded-t-xl bg-slate-100"
              style={{ height: `${28 + ((index * 17) % 58)}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  )

  const renderAnalyticsSkeleton = () => (
    <div className="space-y-6 bg-slate-50 p-6 lg:p-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={`analytics-kpi-skeleton-${index}`} className="h-36 animate-pulse rounded-[1.5rem] bg-white shadow-lg shadow-slate-200/50" />
        ))}
      </div>
      <div className="h-[460px] animate-pulse rounded-[2rem] bg-white shadow-lg shadow-slate-200/50" />
      <div className="h-[430px] animate-pulse rounded-[2rem] bg-white shadow-lg shadow-slate-200/50" />
    </div>
  )

  const applyRollingCalendarTargets = useCallback(<T extends { cy: number; ly: number; target?: number }>(rows: T[]) => {
    const monthTarget = rows.reduce((acc, point) => acc + Number(point.ly || 0), 0) * 1.1
    let achievedTillPreviousDay = 0

    return rows.map((point, index) => {
      const remainingDaysIncludingToday = rows.length - index
      const remainingTarget = Math.max(monthTarget - achievedTillPreviousDay, 0)
      const target = remainingDaysIncludingToday > 0 ? remainingTarget / remainingDaysIncludingToday : 0
      achievedTillPreviousDay += Number(point.cy || 0)

      return {
        ...point,
        target,
      }
    })
  }, [])

  const trendData = useMemo(() => {
    if (viewMode !== 'trend' && !showRoCalendarDialog && viewMode !== 'analytics') return []
    const serverTrend = serverTrendByMetric[activeAnalysisType]?.trend
    if (serverTrend && serverTrend.length > 0) {
      const baseRows = serverTrend.map((point) => ({
        day: point.label,
        cy: Number(point.cy || 0),
        ly: Number(point.ly || 0),
      }))
      return applyRollingCalendarTargets(baseRows)
    }
    if (!data || data.length === 0) return []

    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '\u2014' || dateStr === '-' || dateStr === '') return null
      const trimmed = String(dateStr).trim()
      if (trimmed.includes('-')) {
        const parts = trimmed.split('-')
        if (parts.length === 3) {
          const year = parseInt(parts[0], 10)
          const month = parseInt(parts[1], 10) - 1
          const day = parseInt(parts[2], 10)
          if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
            return new Date(year, month, day)
          }
        }
      }
      const parts = trimmed.split('/')
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10)
        let month = parseInt(parts[1], 10) - 1
        const year = parseInt(parts[2], 10)
        if (month > 11) {
          const temp = day
          day = month + 1
          month = temp - 1
        }
        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
          return new Date(year, month, day)
        }
      }
      return null
    }

    const selectedRange = getSelectedBusinessDateRange(dateFilter)
    const targetYear = selectedRange.end.getFullYear()
    const targetMonth = selectedRange.end.getMonth()

    const isLabourAmount = activeTrend === 'Labour Trend'
    const isPartsAmount = activeTrend === 'Parts Trend'
    const isLabPerVehicle = activeTrend === 'Labour Per Vehicle Trend'
    const isPartPerVehicle = activeTrend === 'Parts Per Vehicle Trend'
    const isLabourMetric = isLabourAmount || isLabPerVehicle
    const isPartsMetric = isPartsAmount || isPartPerVehicle
    const shouldUseMetricAmount = isLabourAmount || isPartsAmount || isLabPerVehicle || isPartPerVehicle

    const dayData: { [day: number]: { cy: Set<string>; ly: Set<string>; cyAmounts: Map<string, number>; lyAmounts: Map<string, number> } } = {}

    data.forEach((row, index) => {
      const dateStr = String(getRecordValue(row, 'bill_date', 'Bill Date') || '')
      const date = parseDate(dateStr)

      if (date) {
        const year = date.getFullYear()
        const month = date.getMonth()
        const day = date.getDate()

        if (month === targetMonth) {
          if (!dayData[day]) {
            dayData[day] = { cy: new Set<string>(), ly: new Set<string>(), cyAmounts: new Map<string, number>(), lyAmounts: new Map<string, number>() }
          }

          const metricAmount = isLabourMetric
            ? parseAmount(getRecordValue(row, 'labour_amt', 'Labour Amt'))
            : isPartsMetric
              ? parseAmount(getRecordValue(row, 'part_amt', 'Part Amt'))
              : 1
          const shouldCount = isLabourAmount || isPartsAmount ? metricAmount !== 0 : true

          if (shouldCount) {
            const billKey = getUniqueBillKey(row, index)
            const roKey = getUniqueRoKey(row, index)
            if (year === targetYear) {
              dayData[day].cy.add(roKey)
              addBillAmount(dayData[day].cyAmounts, billKey, metricAmount)
            } else if (year === targetYear - 1) {
              dayData[day].ly.add(roKey)
              addBillAmount(dayData[day].lyAmounts, billKey, metricAmount)
            }
          }
        }
      }
    })

    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

    const rows = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1
      const date = new Date(targetYear, targetMonth, day)
      const dayName = dayNames[date.getDay()]
      const counts = dayData[day]
      const cyLoad = counts?.cy.size || 0
      const lyLoad = counts?.ly.size || 0
      const cyAmount = sumBillAmounts(counts?.cyAmounts || new Map<string, number>())
      const lyAmount = sumBillAmounts(counts?.lyAmounts || new Map<string, number>())
      const cy = isLabPerVehicle || isPartPerVehicle
        ? cyLoad > 0 ? cyAmount / cyLoad : 0
        : shouldUseMetricAmount ? cyAmount : cyLoad
      const ly = isLabPerVehicle || isPartPerVehicle
        ? lyLoad > 0 ? lyAmount / lyLoad : 0
        : shouldUseMetricAmount ? lyAmount : lyLoad

      return {
        day: `${String(day).padStart(2, '0')} ${dayName}`,
        cy,
        ly,
        target: 0,
      }
    })
    return applyRollingCalendarTargets(rows)
  }, [activeAnalysisType, applyRollingCalendarTargets, data, activeTrend, dateFilter, serverTrendByMetric, showRoCalendarDialog, viewMode])

  const kpiStats = useMemo(() => {
    if (trendData.length === 0) {
      return [
        { label: 'Month Target', value: 'N/A' },
        { label: 'MTD Target', value: 'N/A' },
        { label: 'MTD Achieved', value: 'N/A' },
        { label: 'Shortfall T.D', value: 'N/A', color: 'text-rose-600' },
        { label: 'Monthly Shortfall', value: 'N/A', color: 'text-rose-600' },
        { label: 'Projected Closing', value: 'N/A' },
        { label: 'Asking Rate', value: 'N/A' }
      ]
    }

    if (!data || data.length === 0) {
      const today = new Date()
      const selectedRange = getSelectedBusinessDateRange(dateFilter)
      const rangeEnd = selectedRange.end
      const targetYear = rangeEnd.getFullYear()
      const targetMonth = rangeEnd.getMonth()
      const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
      const selectedThroughDay = rangeEnd && rangeEnd.getFullYear() === targetYear && rangeEnd.getMonth() === targetMonth
        ? rangeEnd.getDate()
        : targetYear === today.getFullYear() && targetMonth === today.getMonth()
          ? today.getDate()
          : daysInMonth
      const elapsedDays = Math.min(Math.max(selectedThroughDay, 1), daysInMonth)
      const monthTarget = trendData.reduce((acc, day) => acc + Number(day.ly || 0), 0) * 1.1
      const mtdTarget = monthTarget * (elapsedDays / daysInMonth)
      const mtdAchieved = trendData.slice(0, elapsedDays).reduce((acc, day) => acc + Number(day.cy || 0), 0)
      const shortfall = Math.max(mtdTarget - mtdAchieved, 0)
      const projectedClosing = elapsedDays > 0 ? (mtdAchieved / elapsedDays) * daysInMonth : 0
      const monthlyShortfall = Math.max(monthTarget - projectedClosing, 0)
      const remainingDays = daysInMonth - elapsedDays
      const askingRate = remainingDays > 0 ? Math.max(monthTarget - mtdAchieved, 0) / remainingDays : 0

      return [
        { label: 'Month Target', value: formatValue(monthTarget) },
        { label: 'MTD Target', value: formatValue(mtdTarget) },
        { label: 'MTD Achieved', value: formatValue(mtdAchieved) },
        { label: 'Shortfall T.D', value: formatValue(shortfall), color: shortfall > 0 ? 'text-rose-600' : 'text-emerald-600' },
        { label: 'Monthly Shortfall', value: formatValue(monthlyShortfall), color: monthlyShortfall > 0 ? 'text-rose-600' : 'text-emerald-600' },
        { label: 'Projected Closing', value: formatValue(projectedClosing), color: projectedClosing < 0 ? 'text-rose-600' : undefined },
        { label: 'Asking Rate', value: formatValue(askingRate), color: askingRate < 0 ? 'text-rose-600' : askingRate > 0 ? 'text-teal-700' : undefined },
      ]
    }

    const today = new Date()
    const selectedRange = getSelectedBusinessDateRange(dateFilter)
    const targetYear = selectedRange.end.getFullYear()
    const targetMonth = selectedRange.end.getMonth()

    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
    const selectedRangeEnd = selectedRange.end
    const currentDay = selectedRangeEnd && selectedRangeEnd.getFullYear() === targetYear && selectedRangeEnd.getMonth() === targetMonth
      ? Math.min(Math.max(selectedRangeEnd.getDate(), 1), daysInMonth)
      : targetYear === today.getFullYear() && targetMonth === today.getMonth()
        ? Math.min(today.getDate(), daysInMonth)
        : daysInMonth

    const measureMonth = (year: number, throughDay = daysInMonth) => {
      const isLabourAmount = activeTrend === 'Labour Trend'
      const isPartsAmount = activeTrend === 'Parts Trend'
      const isLabPerVehicle = activeTrend === 'Labour Per Vehicle Trend'
      const isPartPerVehicle = activeTrend === 'Parts Per Vehicle Trend'
      const roKeys = new Set<string>()
      const amountBucket = new Map<string, number>()

      data.forEach((row, index) => {
        const date = parseBusinessDate(getRecordValue(row, 'bill_date', 'Bill Date'))
        if (!date || date.getFullYear() !== year || date.getMonth() !== targetMonth || date.getDate() > throughDay) return

        const amount = isLabourAmount || isLabPerVehicle
          ? parseAmount(getRecordValue(row, 'labour_amt', 'Labour Amt'))
          : isPartsAmount || isPartPerVehicle
            ? parseAmount(getRecordValue(row, 'part_amt', 'Part Amt'))
            : 1
        const shouldCount = isLabourAmount || isPartsAmount ? amount !== 0 : true
        if (!shouldCount) return

        const billKey = getUniqueBillKey(row, index)
        roKeys.add(getUniqueRoKey(row, index))
        addBillAmount(amountBucket, billKey, amount)
      })

      const amount = sumBillAmounts(amountBucket)
      if (isLabourAmount || isPartsAmount) return amount
      if (isLabPerVehicle || isPartPerVehicle) return roKeys.size > 0 ? amount / roKeys.size : 0
      return roKeys.size
    }

    const achTillDate = measureMonth(targetYear, currentDay)
    const lyTotal = measureMonth(targetYear - 1)
    const monthTarget = lyTotal * 1.1
    const mtdAchieved = achTillDate
    const mtdTarget = monthTarget * (currentDay / daysInMonth)
    const shortfall = Math.max(mtdTarget - mtdAchieved, 0)
    const avgPerDay = currentDay > 0 ? mtdAchieved / currentDay : 0
    const projectedClosing = avgPerDay * daysInMonth
    const monthlyShortfall = Math.max(monthTarget - projectedClosing, 0)
    const remainingDays = daysInMonth - currentDay
    const askingRate = remainingDays > 0 ? Math.max(monthTarget - mtdAchieved, 0) / remainingDays : 0

    return [
      { label: 'Month Target', value: formatValue(monthTarget) },
      { label: 'MTD Target', value: formatValue(mtdTarget) },
      { label: 'MTD Achieved', value: formatValue(mtdAchieved) },
      {
        label: 'Shortfall T.D',
        value: formatValue(shortfall),
        color: shortfall > 0 ? 'text-rose-600' : 'text-emerald-600'
      },
      {
        label: 'Monthly Shortfall',
        value: formatValue(monthlyShortfall),
        color: monthlyShortfall > 0 ? 'text-rose-600' : 'text-emerald-600'
      },
      { label: 'Projected Closing', value: formatValue(projectedClosing), color: projectedClosing < 0 ? 'text-rose-600' : undefined },
      { label: 'Asking Rate', value: formatValue(askingRate), color: askingRate < 0 ? 'text-rose-600' : askingRate > 0 ? 'text-teal-700' : undefined },
    ]
  }, [trendData, activeTrend, dateFilter, data])
  // Calculate daily target for the trend chart reference line
  const dailyTarget = trendData.length > 0
    ? (trendData.reduce((acc, day) => acc + day.ly, 0) * 1.1) / trendData.length
    : 0
  const roBillingCalendar = useMemo(() => {
    const selectedRange = getSelectedBusinessDateRange(dateFilter)
    const anchorDate = selectedRange.end
    const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
    const gridStart = new Date(monthStart)
    gridStart.setDate(monthStart.getDate() - monthStart.getDay())
    const trendByDay = new Map<string, { day: string; cy: number; ly: number; target: number }>()

    trendData.forEach((point) => {
      const dayNumber = String(point.day || '').slice(0, 2)
      if (/^\d{2}$/.test(dayNumber)) trendByDay.set(dayNumber, point)
    })

    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + index)
      const key = getInputDate(date)
      const dayNumber = String(date.getDate()).padStart(2, '0')
      const point = trendByDay.get(dayNumber)
      const cy = Number(point?.cy || 0)
      const ly = Number(point?.ly || 0)
      const growthValue = ly > 0 ? ((cy - ly) / ly) * 100 : 'N/A'
      return {
        key,
        date,
        inMonth: date.getMonth() === anchorDate.getMonth(),
        point,
        cy,
        ly,
        target: Number(point?.target || 0),
        growth: growthValue,
      }
    })

    return {
      monthLabel: anchorDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      days,
      rowsByDate: new Map(days.map((day) => [day.key, day])),
    }
  }, [dateFilter, trendData])
  const activeRoCalendarDate = selectedRoCalendarDate || getInputDate(getSelectedBusinessDateRange(dateFilter).end)
  // Historical FY Trends Data
  const fyTrendsData = useMemo(() => {
    if (viewMode !== 'fy' && viewMode !== 'analytics') return []
    const serverFyEntries = Object.entries(serverFyByMetric) as Array<[ROAnalysisType, ROAnalysisResponse]>
    if (serverFyEntries.some(([, response]) => (response.fyTrends || []).length > 0)) {
      const byFy = new Map<string, {
        fy: string
        load: number
        labour: number
        parts: number
        labPerVehicle: number
        partPerVehicle: number
      }>()

      serverFyEntries.forEach(([analysisType, response]) => {
        ;(response.fyTrends || []).forEach((item) => {
          const existing = byFy.get(item.fy) || {
            fy: item.fy,
            load: 0,
            labour: 0,
            parts: 0,
            labPerVehicle: 0,
            partPerVehicle: 0,
          }
          if (analysisType === 'load') existing.load = Number(item.value || 0)
          if (analysisType === 'labour') existing.labour = Number(item.value || 0)
          if (analysisType === 'parts') existing.parts = Number(item.value || 0)
          if (analysisType === 'lab_per_veh') existing.labPerVehicle = Number(item.value || 0)
          if (analysisType === 'part_per_veh') existing.partPerVehicle = Number(item.value || 0)
          byFy.set(item.fy, existing)
        })
      })

      return Array.from(byFy.values())
        .sort((a, b) => b.fy.localeCompare(a.fy))
        .slice(0, 3)
    }
    if (!data || data.length === 0) return []

    const fyData: { [fy: string]: { load: Set<string>; labour: Map<string, number>; parts: Map<string, number> } } = {}

    data.forEach((row, index) => {
      const date = parseBusinessDate(getRecordValue(row, 'bill_date', 'Bill Date'))
      if (!date) return

      const year = date.getFullYear()
      const month = date.getMonth()
      const fyYear = month >= 3 ? year : year - 1
      const fy = `FY ${fyYear}-${String(fyYear + 1).slice(-2)}`

      if (!fyData[fy]) {
        fyData[fy] = { load: new Set<string>(), labour: new Map<string, number>(), parts: new Map<string, number>() }
      }

      const billKey = getUniqueBillKey(row, index)
      fyData[fy].load.add(getUniqueRoKey(row, index))
      addBillAmount(fyData[fy].labour, billKey, parseAmount(getRecordValue(row, 'labour_amt', 'Labour Amt')))
      addBillAmount(fyData[fy].parts, billKey, parseAmount(getRecordValue(row, 'part_amt', 'Part Amt')))
    })

    return Object.entries(fyData)
      .map(([fy, values]) => ({
        fy,
        load: values.load.size,
        labour: sumBillAmounts(values.labour),
        parts: sumBillAmounts(values.parts),
        labPerVehicle: values.load.size > 0 ? sumBillAmounts(values.labour) / values.load.size : 0,
        partPerVehicle: values.load.size > 0 ? sumBillAmounts(values.parts) / values.load.size : 0,
      }))
      .sort((a, b) => b.fy.localeCompare(a.fy))
      .slice(0, 3)
  }, [data, serverFyByMetric, viewMode])
  const executiveAnalytics = useMemo(() => {
    if (viewMode !== 'analytics') {
      return null
    }

    if (!data || data.length === 0) {
      const getGrandTotal = (metric: ROAnalysisType) => {
        const rows = serverTableRowsByMetric[metric] || []
        return rows.find((row) => row.name === 'Grand Total') || rows[rows.length - 1]
      }
      const loadTotal = getGrandTotal('load')
      const labourTotal = getGrandTotal('labour')
      const partsTotal = getGrandTotal('parts')
      const labVehTotal = getGrandTotal('lab_per_veh')
      const partVehTotal = getGrandTotal('part_per_veh')
      const value = (row: StatRow | undefined, key: 'cy' | 'ly' | 'qtdCY' | 'qtdLY' | 'ytdCY' | 'ytdLY') => {
        if (!row) return 0
        const raw = row[key]
        return raw === 'N/A' ? 0 : Number(raw || 0)
      }
      const growth = (current: number, previous: number) => previous > 0 ? ((current - previous) / previous) * 100 : null
      const loadTrend = serverTrendByMetric.load?.trend || []
      const labourTrend = serverTrendByMetric.labour?.trend || []
      const partsTrend = serverTrendByMetric.parts?.trend || []
      const todayKey = getInputDate(new Date())
      const dailyRevenue = loadTrend.map((point, index) => {
        const labour = Number(labourTrend[index]?.cy || 0)
        const parts = Number(partsTrend[index]?.cy || 0)
        return {
          date: point.date,
          day: point.label,
          load: Number(point.cy || 0),
          labour,
          parts,
          revenue: labour + parts,
        }
      }).filter((point) => {
        const isFutureEmptyPoint = point.date > todayKey
          && point.load === 0
          && point.labour === 0
          && point.parts === 0
          && point.revenue === 0
        return !isFutureEmptyPoint
      })
      const services = (serverTableRowsByMetric.load || [])
        .filter((row) => !['Grand Total', 'MECH TOTAL', 'MECH'].includes(row.name))
        .map((row) => {
          const labourRow = (serverTableRowsByMetric.labour || []).find((item) => item.name === row.name)
          const partsRow = (serverTableRowsByMetric.parts || []).find((item) => item.name === row.name)
          const labour = Number(labourRow?.cy || 0)
          const parts = Number(partsRow?.cy || 0)
          return {
            name: row.name,
            load: Number(row.cy || 0),
            labour,
            parts,
            revenue: labour + parts,
            labPerVehicle: Number(row.cy || 0) > 0 ? labour / Number(row.cy || 0) : 0,
            partPerVehicle: Number(row.cy || 0) > 0 ? parts / Number(row.cy || 0) : 0,
            averageBilling: Number(row.cy || 0) > 0 ? (labour + parts) / Number(row.cy || 0) : 0,
            avgRating: serverAnalyticsSummary?.avgRating || 0,
            pickDropRate: serverAnalyticsSummary?.pickDropRate || 0,
          }
        })
        .sort((a, b) => b.revenue - a.revenue)
      const cySummary = {
        load: value(loadTotal, 'cy'),
        labour: value(labourTotal, 'cy'),
        parts: value(partsTotal, 'cy'),
        revenue: value(labourTotal, 'cy') + value(partsTotal, 'cy'),
        labPerVehicle: value(labVehTotal, 'cy'),
        partPerVehicle: value(partVehTotal, 'cy'),
        averageBilling: value(loadTotal, 'cy') > 0 ? (value(labourTotal, 'cy') + value(partsTotal, 'cy')) / value(loadTotal, 'cy') : 0,
        avgRating: serverAnalyticsSummary?.avgRating || 0,
        pickDropRate: serverAnalyticsSummary?.pickDropRate || 0,
      }
      const lySummary = {
        load: value(loadTotal, 'ly'),
        labour: value(labourTotal, 'ly'),
        parts: value(partsTotal, 'ly'),
        revenue: value(labourTotal, 'ly') + value(partsTotal, 'ly'),
        labPerVehicle: value(labVehTotal, 'ly'),
        partPerVehicle: value(partVehTotal, 'ly'),
        averageBilling: value(loadTotal, 'ly') > 0 ? (value(labourTotal, 'ly') + value(partsTotal, 'ly')) / value(loadTotal, 'ly') : 0,
        avgRating: serverAnalyticsSummary?.avgRatingLy || 0,
        pickDropRate: serverAnalyticsSummary?.pickDropRateLy || 0,
      }
      const kpis = [
        { label: 'Total RO Load', value: cySummary.load, ly: lySummary.load, growth: growth(cySummary.load, lySummary.load), icon: Activity, accent: 'teal', formatter: (n: number) => Math.round(n).toLocaleString('en-IN') },
        { label: 'Labour Revenue', value: cySummary.labour, ly: lySummary.labour, growth: growth(cySummary.labour, lySummary.labour), icon: IndianRupee, accent: 'blue', formatter: formatCurrency },
        { label: 'Parts Revenue', value: cySummary.parts, ly: lySummary.parts, growth: growth(cySummary.parts, lySummary.parts), icon: BarChart3, accent: 'violet', formatter: formatCurrency },
        { label: 'Labour / Vehicle', value: cySummary.labPerVehicle, ly: lySummary.labPerVehicle, growth: growth(cySummary.labPerVehicle, lySummary.labPerVehicle), icon: TrendingUp, accent: 'emerald', formatter: formatCurrency },
        { label: 'Parts / Vehicle', value: cySummary.partPerVehicle, ly: lySummary.partPerVehicle, growth: growth(cySummary.partPerVehicle, lySummary.partPerVehicle), icon: TrendingUp, accent: 'amber', formatter: formatCurrency },
        { label: 'Average Billing', value: cySummary.averageBilling, ly: lySummary.averageBilling, growth: growth(cySummary.averageBilling, lySummary.averageBilling), icon: Award, accent: 'cyan', formatter: formatCurrency },
        { label: 'Avg Rating', value: cySummary.avgRating, ly: lySummary.avgRating, growth: growth(cySummary.avgRating, lySummary.avgRating), icon: Sparkles, accent: 'rose', formatter: (n: number) => n.toFixed(1) },
        { label: 'Pick & Drop %', value: cySummary.pickDropRate, ly: lySummary.pickDropRate, growth: growth(cySummary.pickDropRate, lySummary.pickDropRate), icon: Users, accent: 'slate', formatter: (n: number) => `${n.toFixed(1)}%` },
      ]
      const topService = services[0]

      return {
        cySummary,
        lySummary,
        kpis,
        dailyRevenue,
        services,
        insights: [
          {
            title: 'Revenue Momentum',
            body: cySummary.revenue > lySummary.revenue
              ? `Total billing is up ${Math.abs(growth(cySummary.revenue, lySummary.revenue) || 0).toFixed(1)}% versus LY.`
              : `Total billing is ${Math.abs(growth(cySummary.revenue, lySummary.revenue) || 0).toFixed(1)}% below LY.`,
          },
          {
            title: 'Service Mix',
            body: topService
              ? `${topService.name} contributes ${cySummary.revenue > 0 ? ((topService.revenue / cySummary.revenue) * 100).toFixed(1) : '0.0'}% of current revenue.`
              : 'Service contribution will appear once summary data is available.',
          },
          {
            title: 'Workshop Load',
            body: `${cySummary.load.toLocaleString('en-IN')} ROs contributed to ${formatCurrency(cySummary.revenue)} current-period billing.`,
          },
          {
            title: 'Billing Quality',
            body: `Average billing per vehicle is ${formatCurrency(cySummary.averageBilling)} for the selected Bill Date window.`,
          },
        ],
        revenueMix: [
          { name: 'Labour', value: cySummary.labour, color: '#023468' },
          { name: 'Parts', value: cySummary.parts, color: '#D97706' },
        ].filter((item) => item.value > 0),
        operatingMix: [
          { name: 'Avg Billing', value: cySummary.averageBilling, color: '#1D4ED8' },
          { name: 'Lab / Veh', value: cySummary.labPerVehicle, color: '#023468' },
          { name: 'Part / Veh', value: cySummary.partPerVehicle, color: '#D97706' },
        ],
        advisorLeaderboard: [],
      }
    }

    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '-' || dateStr === '') return null
      const trimmed = String(dateStr).trim()
      if (trimmed.includes('-')) {
        const parts = trimmed.split('-')
        if (parts.length === 3) {
          const year = parseInt(parts[0], 10)
          const month = parseInt(parts[1], 10) - 1
          const day = parseInt(parts[2], 10)
          if (!isNaN(day) && !isNaN(month) && !isNaN(year)) return new Date(year, month, day)
        }
      }
      const parts = trimmed.split('/')
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10)
        let month = parseInt(parts[1], 10) - 1
        const year = parseInt(parts[2], 10)
        if (month > 11) {
          const temp = day
          day = month + 1
          month = temp - 1
        }
        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && month >= 0 && month <= 11) {
          return new Date(year, month, day)
        }
      }
      return null
    }

    const selectedRange = getSelectedBusinessDateRange(dateFilter)
    const cyStart = new Date(selectedRange.start.getFullYear(), selectedRange.start.getMonth(), selectedRange.start.getDate(), 0, 0, 0, 0)
    const cyEnd = new Date(selectedRange.end.getFullYear(), selectedRange.end.getMonth(), selectedRange.end.getDate(), 23, 59, 59, 999)

    const lyStart = new Date(cyStart)
    lyStart.setFullYear(lyStart.getFullYear() - 1)
    const lyEnd = new Date(cyEnd)
    lyEnd.setFullYear(lyEnd.getFullYear() - 1)

    type AggregateBucket = {
      load: Set<string>
      labour: Map<string, number>
      parts: Map<string, number>
      ratingTotal: number
      ratingCount: number
      pickDropCount: number
      rows: Record<string, unknown>[]
    }

    const createBucket = (): AggregateBucket => ({
      load: new Set<string>(),
      labour: new Map<string, number>(),
      parts: new Map<string, number>(),
      ratingTotal: 0,
      ratingCount: 0,
      pickDropCount: 0,
      rows: [],
    })

    const cy = createBucket()
    const ly = createBucket()
    const dailyBuckets = new Map<string, AggregateBucket>()
    const serviceBuckets = new Map<string, AggregateBucket>()
    const advisorBuckets = new Map<string, AggregateBucket>()

    const classifyWorkType = (value: unknown) => {
      const workType = String(value || '').toLowerCase()
      if (workType.includes('paid service')) return 'Paid Service'
      if (workType.includes('free service')) return 'Free Service'
      if (workType.includes('running repair')) return 'Running Repair'
      if (workType.includes('accident') || workType.includes('bodyshop')) return 'Accidental Repair'
      return 'Others'
    }

    const addToBucket = (bucket: AggregateBucket, row: Record<string, unknown>, index: number) => {
      const billKey = getUniqueBillKey(row, index)
      bucket.load.add(getUniqueRoKey(row, index))
      addBillAmount(bucket.labour, billKey, parseAmount(getRecordValue(row, 'labour_amt', 'Labour Amt')))
      addBillAmount(bucket.parts, billKey, parseAmount(getRecordValue(row, 'part_amt', 'Part Amt')))
      const rating = parseAmount(getRecordValue(row, 'avg_rating', 'Avg Rating'))
      if (rating > 0) {
        bucket.ratingTotal += rating
        bucket.ratingCount += 1
      }
      const pickDrop = String(getRecordValue(row, 'pick_drop', 'Pick & Drop') || '').trim().toLowerCase()
      if (pickDrop && pickDrop !== 'none' && pickDrop !== 'no') bucket.pickDropCount += 1
      bucket.rows.push(row)
    }

    data.forEach((row, index) => {
      const date = parseDate(String(getRecordValue(row, 'bill_date', 'Bill Date') || ''))
      if (!date) return

      const isCurrent = date >= cyStart && date <= cyEnd
      const isLastYear = date >= lyStart && date <= lyEnd
      if (!isCurrent && !isLastYear) return

      const targetBucket = isCurrent ? cy : ly
      addToBucket(targetBucket, row, index)

      if (isCurrent) {
        const dayKey = `${String(date.getDate()).padStart(2, '0')} ${date.toLocaleDateString('en-US', { weekday: 'short' })}`
        if (!dailyBuckets.has(dayKey)) dailyBuckets.set(dayKey, createBucket())
        addToBucket(dailyBuckets.get(dayKey)!, row, index)

        const service = classifyWorkType(getRecordValue(row, 'work_type', 'Work Type'))
        if (!serviceBuckets.has(service)) serviceBuckets.set(service, createBucket())
        addToBucket(serviceBuckets.get(service)!, row, index)

        const advisor = String(getRecordValue(row, 'service_advisor', 'Service Advisor') || 'Unspecified').trim() || 'Unspecified'
        if (!advisorBuckets.has(advisor)) advisorBuckets.set(advisor, createBucket())
        addToBucket(advisorBuckets.get(advisor)!, row, index)
      }
    })

    const summarize = (bucket: AggregateBucket) => {
      const load = bucket.load.size
      const labour = sumBillAmounts(bucket.labour)
      const parts = sumBillAmounts(bucket.parts)
      const revenue = labour + parts
      return {
        load,
        labour,
        parts,
        revenue,
        labPerVehicle: load > 0 ? labour / load : 0,
        partPerVehicle: load > 0 ? parts / load : 0,
        averageBilling: load > 0 ? revenue / load : 0,
        avgRating: bucket.ratingCount > 0 ? bucket.ratingTotal / bucket.ratingCount : 0,
        pickDropRate: bucket.rows.length > 0 ? (bucket.pickDropCount / bucket.rows.length) * 100 : 0,
      }
    }

    const cySummary = summarize(cy)
    const lySummary = summarize(ly)
    const growth = (current: number, previous: number) => previous > 0 ? ((current - previous) / previous) * 100 : null

    const kpis = [
      { label: 'Total RO Load', value: cySummary.load, ly: lySummary.load, growth: growth(cySummary.load, lySummary.load), icon: Activity, accent: 'teal', formatter: (n: number) => Math.round(n).toLocaleString('en-IN') },
      { label: 'Labour Revenue', value: cySummary.labour, ly: lySummary.labour, growth: growth(cySummary.labour, lySummary.labour), icon: IndianRupee, accent: 'blue', formatter: formatCurrency },
      { label: 'Parts Revenue', value: cySummary.parts, ly: lySummary.parts, growth: growth(cySummary.parts, lySummary.parts), icon: BarChart3, accent: 'violet', formatter: formatCurrency },
      { label: 'Labour / Vehicle', value: cySummary.labPerVehicle, ly: lySummary.labPerVehicle, growth: growth(cySummary.labPerVehicle, lySummary.labPerVehicle), icon: TrendingUp, accent: 'emerald', formatter: formatCurrency },
      { label: 'Parts / Vehicle', value: cySummary.partPerVehicle, ly: lySummary.partPerVehicle, growth: growth(cySummary.partPerVehicle, lySummary.partPerVehicle), icon: TrendingUp, accent: 'amber', formatter: formatCurrency },
      { label: 'Average Billing', value: cySummary.averageBilling, ly: lySummary.averageBilling, growth: growth(cySummary.averageBilling, lySummary.averageBilling), icon: Award, accent: 'cyan', formatter: formatCurrency },
      { label: 'Avg Rating', value: cySummary.avgRating, ly: lySummary.avgRating, growth: growth(cySummary.avgRating, lySummary.avgRating), icon: Sparkles, accent: 'rose', formatter: (n: number) => n.toFixed(1) },
      { label: 'Pick & Drop %', value: cySummary.pickDropRate, ly: lySummary.pickDropRate, growth: growth(cySummary.pickDropRate, lySummary.pickDropRate), icon: Users, accent: 'slate', formatter: (n: number) => `${n.toFixed(1)}%` },
    ]

    const dailyRevenue = Array.from(dailyBuckets.entries()).map(([day, bucket]) => {
      const summary = summarize(bucket)
      return {
        day,
        load: summary.load,
        labour: summary.labour,
        parts: summary.parts,
        revenue: summary.revenue,
      }
    })

    const services = Array.from(serviceBuckets.entries())
      .map(([name, bucket]) => ({ name, ...summarize(bucket) }))
      .sort((a, b) => b.revenue - a.revenue)

    const advisorLeaderboard = Array.from(advisorBuckets.entries())
      .map(([name, bucket]) => {
        const summary = summarize(bucket)
        return {
          name,
          ...summary,
          contribution: cySummary.revenue > 0 ? (summary.revenue / cySummary.revenue) * 100 : 0,
        }
      })
      .sort((a, b) => b.revenue - a.revenue || b.load - a.load || a.name.localeCompare(b.name))

    const topService = services[0]
    const insights = [
      {
        title: 'Revenue Momentum',
        body: cySummary.revenue > lySummary.revenue
          ? `Total billing is up ${Math.abs(growth(cySummary.revenue, lySummary.revenue) || 0).toFixed(1)}% versus LY.`
          : `Total billing is ${Math.abs(growth(cySummary.revenue, lySummary.revenue) || 0).toFixed(1)}% below LY.`,
      },
      {
        title: 'Service Mix',
        body: topService
          ? `${topService.name} contributes ${cySummary.revenue > 0 ? ((topService.revenue / cySummary.revenue) * 100).toFixed(1) : '0.0'}% of current revenue.`
          : 'Service contribution will appear once matching Bill Date data is available.',
      },
      {
        title: 'Workshop Load',
        body: `${cySummary.load.toLocaleString('en-IN')} ROs contributed to ${formatCurrency(cySummary.revenue)} current-period billing.`,
      },
      {
        title: 'Billing Quality',
        body: `Average billing per vehicle is ${formatCurrency(cySummary.averageBilling)} with ${cySummary.avgRating.toFixed(1)} average rating.`,
      },
    ]

    return {
      cySummary,
      lySummary,
      kpis,
      dailyRevenue,
      services,
      insights,
      revenueMix: [
        { name: 'Labour', value: cySummary.labour, color: '#023468' },
        { name: 'Parts', value: cySummary.parts, color: '#D97706' },
      ].filter((item) => item.value > 0),
      operatingMix: [
        { name: 'Avg Billing', value: cySummary.averageBilling, color: '#1D4ED8' },
        { name: 'Lab / Veh', value: cySummary.labPerVehicle, color: '#023468' },
        { name: 'Part / Veh', value: cySummary.partPerVehicle, color: '#D97706' },
      ],
      advisorLeaderboard,
    }
  }, [data, dateFilter, serverAnalyticsSummary, serverTableRowsByMetric, serverTrendByMetric, viewMode])

  return (
    <>
      {showRoCalendarDialog && (
        <div className="solid-calendar-surface fixed inset-0 z-[9999] bg-white p-3" style={{ backgroundColor: '#ffffff' }}>
          <div className="solid-calendar-surface flex h-full w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl" style={{ backgroundColor: '#ffffff' }}>
            <div className="solid-calendar-surface flex flex-col gap-3 border-b border-slate-100 bg-white p-5 lg:flex-row lg:items-center lg:justify-between" style={{ backgroundColor: '#ffffff' }}>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#b9ccde] bg-[#edf4fb] text-[#023468]">
                  <CalendarDays className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#023468]">RO Billing Calendar</p>
                  <h3 className="text-xl font-black tracking-tight text-slate-950">{roBillingCalendar.monthLabel}</h3>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { id: "Load Trend", label: "Load", icon: Activity },
                  { id: "Labour Trend", label: "Labour", icon: RefreshCw },
                  { id: "Parts Trend", label: "Parts", icon: FileSpreadsheet },
                  { id: "Labour Per Vehicle Trend", label: "Lab/Veh", icon: TrendingUp },
                  { id: "Parts Per Vehicle Trend", label: "Part/Veh", icon: TrendingUp }
                ].map((trend) => (
                  <button
                    key={trend.id}
                    type="button"
                    onClick={() => setActiveTrend(trend.id)}
                    className={cn(
                      "flex min-w-[98px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-all",
                      trend.id === activeTrend
                        ? "app-primary-action"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <trend.icon className="h-3.5 w-3.5" />
                    {trend.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowRoCalendarDialog(false)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                  Close
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
              {isCalendarSummaryPending || (isServerViewLoading && trendData.length === 0) ? (
                renderChartSkeleton('h-[420px]')
              ) : trendData.length === 0 ? (
                <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-lg shadow-slate-200/40">
                  <p className="text-sm font-black uppercase tracking-widest text-slate-400">No calendar data available</p>
                </div>
              ) : (
                <div className="min-h-full">
                  <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {activeTrend.replace(' Trend', '')} daily CY / LY
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#b9ccde] bg-white px-3 py-1.5 text-[#023468]">
                          <span className="h-2 w-2 rounded-full bg-[#023468]" /> CY
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-amber-700">
                          <span className="h-2 w-2 rounded-full bg-amber-500" /> LY
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-blue-700">
                          <span className="h-2 w-2 rounded-full bg-blue-500" /> Target
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-900 text-white">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                        <div key={day} className="border-r border-slate-700 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest last:border-r-0">
                          {day}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 bg-white">
                      {roBillingCalendar.days.map((day) => {
                        const isSelected = day.key === activeRoCalendarDate
                        const isAhead = day.growth !== 'N/A' && Number(day.growth) >= 0
                        return (
                          <button
                            key={day.key}
                            type="button"
                            onClick={() => setSelectedRoCalendarDate(day.key)}
                            className={cn(
                              'min-h-[118px] border-r border-b border-slate-200 p-2 text-left transition last:border-r-0 hover:bg-[#edf4fb]',
                              !day.inMonth && 'bg-slate-50 text-slate-300',
                              isSelected && 'bg-[#edf4fb] ring-2 ring-inset ring-[#023468]'
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className={cn('text-xs font-black', day.inMonth ? 'text-slate-900' : 'text-slate-300')}>
                                {day.date.getDate().toString().padStart(2, '0')}
                              </span>
                              {day.point && (
                                <span className={cn(
                                  'rounded-full border bg-white px-2 py-0.5 text-[9px] font-black',
                                  day.growth === 'N/A' ? 'border-slate-200 text-slate-400' : isAhead ? 'border-emerald-200 text-emerald-700' : 'border-rose-200 text-rose-700'
                                )}>
                                  {formatSignedGrowth(day.growth)}
                                </span>
                              )}
                            </div>
                            <div className="mt-3 space-y-1">
                              <div className="flex items-center justify-between rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700">
                                <span>CY</span>
                                <span>{formatValue(day.cy)}</span>
                              </div>
                              <div className="flex items-center justify-between rounded-md bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
                                <span>LY</span>
                                <span>{formatValue(day.ly)}</span>
                              </div>
                              <div className="flex items-center justify-between rounded-md bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">
                                <span>Target</span>
                                <span>{formatValue(day.target)}</span>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <Card className="mb-6 mt-3 overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-white p-2">
          <div className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-8">
              <button
                onClick={() => setViewMode('table')}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'table'
                    ? "app-primary-action"
                    : "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <TableIcon className="h-3.5 w-3.5" /> Table
              </button>
              <button
                onClick={() => setViewMode('trend')}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'trend'
                    ? "app-primary-action"
                    : "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" /> Trend
              </button>
              <button
                onClick={() => setShowRoCalendarDialog(true)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  showRoCalendarDialog
                    ? "app-primary-action"
                    : "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <CalendarDays className="h-3.5 w-3.5" /> Calendar
              </button>
              <button
                onClick={() => setViewMode('fy')}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'fy'
                    ? "app-primary-action"
                    : "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <BarChart3 className="h-3.5 w-3.5" /> FY Trends
              </button>
              <button
                onClick={() => setViewMode('analytics')}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'analytics'
                    ? "app-primary-action"
                    : "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <Activity className="h-3.5 w-3.5" /> Analytics
              </button>
              <button
                onClick={() => setViewMode('revenue')}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'revenue'
                    ? "app-primary-action"
                    : "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" /> Revenue
              </button>
              <button
                onClick={() => setViewMode('leaderboard')}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'leaderboard'
                    ? "app-primary-action"
                    : "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <Users className="h-3.5 w-3.5" /> Leaderboard
              </button>
              <button
                onClick={() => setViewMode('intelligence')}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'intelligence'
                    ? "app-primary-action"
                    : "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <Sparkles className="h-3.5 w-3.5" /> Intelligence
              </button>
          </div>

          {(viewMode === 'table' || viewMode === 'trend') && (
            <div className="mt-2 flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center justify-between gap-3 lg:w-auto">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Metric</p>
                <p className="text-[10px] font-bold text-slate-500">{activeTrend.replace(' Trend', '')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: "Load Trend", label: "Load", icon: Activity },
                { id: "Labour Trend", label: "Labour", icon: RefreshCw },
                { id: "Parts Trend", label: "Parts", icon: FileSpreadsheet },
                { id: "Labour Per Vehicle Trend", label: "Lab/Veh", icon: TrendingUp },
                { id: "Parts Per Vehicle Trend", label: "Part/Veh", icon: TrendingUp }
              ].map((trend) => (
                <button
                  key={trend.id}
                  onClick={() => setActiveTrend(trend.id)}
                  className={cn(
                    "flex min-w-[98px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-all duration-300",
                    trend.id === activeTrend
                      ? "border-teal-700 bg-teal-700 text-white shadow-md shadow-teal-100"
                      : "border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200 hover:bg-white hover:text-slate-700"
                  )}
                >
                  <trend.icon className={cn("h-3.5 w-3.5", trend.id === activeTrend ? "text-white" : "text-slate-300")} />
                  {trend.label}
                </button>
              ))}
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <>
            <div className="px-4 pt-4">
              <DealerCoverageNotice coverage={roBillingDealerCoverage} />
            </div>
            {viewMode === 'table' ? (
              <div className="p-6 pb-0">
                <div className="overflow-x-auto">
                  <table className="ro-analysis-table w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-teal-700 text-white">
                        <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 min-w-[220px]">Work Type</th>
                        <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center">TD</th>
                        <th colSpan={3} className="px-4 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center bg-teal-600">MTD</th>
                        <th colSpan={3} className="px-4 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center bg-teal-700">QTD</th>
                        <th colSpan={3} className="px-4 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center bg-teal-600">YTD</th>
                      </tr>
                      <tr className="bg-teal-700 text-white/90">
                        <th className="px-6 py-3 border-b border-white/5"></th>
                        <th className="px-6 py-3 border-b border-white/5"></th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-teal-600">CY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-teal-600">LY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-teal-600">Growth</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-teal-700">CY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-teal-700">LY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-teal-700">Growth</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-teal-600">CY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-teal-600">LY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-teal-600">Growth</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {isServerTableLoading && !activeServerTableRows ? (
                        Array.from({ length: 8 }).map((_, index) => (
                          <tr key={`ro-table-skeleton-${index}`} className="border-b border-slate-100">
                            {Array.from({ length: hasCustomComparison ? 4 : 11 }).map((__, cellIndex) => (
                              <td key={cellIndex} className="px-4 py-4">
                                <div className="mx-auto h-3 w-16 animate-pulse rounded-full bg-slate-200" />
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : effectiveStatsData
                        .map((row, idx) => {
                          const isTotal = row.name.includes('TOTAL') || row.name.includes('Total') || row.name === 'MECH'
                          const isGrandTotal = row.name === 'Grand Total'
                          const isExpanded = expandedRows.includes(row.name)

                          return (
                            <React.Fragment key={idx}>
                              <tr className={cn(
                                "group transition-all duration-300",
                                isGrandTotal
                                  ? "bg-slate-100 text-slate-950 shadow-[inset_4px_0_0_#023468]"
                                  : isTotal
                                    ? "bg-slate-100 text-slate-950 shadow-[inset_4px_0_0_#034b82]"
                                    : "hover:bg-slate-50/80 bg-white",
                                getManagementTotalRowClass(row.name)
                              )}>
                                <td className="px-6 py-4 text-[13px] font-bold">
                                  <div className="flex items-center gap-3">
                                    {row.isParent ? (
                                      <button
                                        onClick={() => toggleRow(row.name)}
                                        className="h-6 w-6 flex items-center justify-center hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white shadow-sm"
                                      >
                                        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-600 transition-transform duration-300", isExpanded && "rotate-180")} />
                                      </button>
                                    ) : (
                                      <div className="w-6 h-6 flex items-center justify-center">
                                        {!isTotal && <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />}
                                      </div>
                                    )}
                                    {row.name}
                                  </div>
                                </td>
                                {!hasCustomComparison && (
                                  <td className={cn("px-6 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-900" : "text-slate-600")}>{formatValue(row.td)}</td>
                                )}
                                <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-black", isTotal ? "text-slate-900" : "text-slate-900")}>{formatValue(row.cy)}</td>
                                <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-800" : "text-slate-400")}>{formatValue(row.ly)}</td>
                                <td className="px-4 py-4 text-center">
                                  <span className={cn(
                                    "px-2.5 py-1 rounded-full text-[10px] font-black border shadow-sm",
                                    getGrowthBadgeClass(row.growth)
                                  )}>
                                    {formatSignedGrowth(row.growth)}
                                  </span>
                                </td>
                                {!hasCustomComparison && (
                                  <>
                                    <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-900" : "text-slate-600")}>{formatValue(row.qtdCY)}</td>
                                    <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-800" : "text-slate-400")}>{formatValue(row.qtdLY)}</td>
                                    <td className="px-4 py-4 text-center">
                                      <span className={cn(
                                        "text-[10px] font-black px-2 py-0.5 rounded-full border",
                                        getGrowthBadgeClass(row.qtdGrowth)
                                      )}>
                                        {formatSignedGrowth(row.qtdGrowth)}
                                      </span>
                                    </td>
                                    <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-900" : "text-slate-600")}>{formatValue(row.ytdCY)}</td>
                                    <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isTotal ? "text-slate-800" : "text-slate-400")}>{formatValue(row.ytdLY)}</td>
                                    <td className="px-4 py-4 text-center">
                                      <span className={cn(
                                        "text-[10px] font-black px-2 py-0.5 rounded-full border",
                                        getGrowthBadgeClass(row.ytdGrowth)
                                      )}>
                                        {formatSignedGrowth(row.ytdGrowth)}
                                      </span>
                                    </td>
                                  </>
                                )}
                              </tr>

                              {isExpanded && row.subRows.map((sub: StatRow, subIdx: number) => (
                                <tr key={`${idx}-${subIdx}`} className="bg-slate-50/20 hover:bg-slate-50 transition-colors animate-in fade-in slide-in-from-top-1 duration-200">
                                  <td className="border border-slate-200 px-16 py-3.5 text-[12px] font-bold text-slate-500">
                                    <div className="flex items-center gap-2">
                                      <div className="w-1.5 h-[1px] bg-slate-200" />
                                      {sub.name}
                                    </div>
                                  </td>
                                  {!hasCustomComparison && (
                                    <td className="border border-slate-200 px-6 py-3.5 text-center font-mono text-[12px] font-bold text-slate-400">{formatValue(sub.td)}</td>
                                  )}
                                  <td className="border border-slate-200 px-4 py-3.5 text-center font-mono text-[12px] font-black text-slate-700">{formatValue(sub.cy)}</td>
                                  <td className="border border-slate-200 px-4 py-3.5 text-center font-mono text-[12px] font-bold text-slate-400">{formatValue(sub.ly)}</td>
                                  <td className="border border-slate-200 px-4 py-3.5 text-center">
                                    <span className={cn(
                                      "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                      sub.growth === 'N/A' ? "text-slate-400 bg-white border-slate-200" : getGrowthBadgeClass(sub.growth)
                                    )}>
                                      {formatSignedGrowth(sub.growth)}
                                    </span>
                                  </td>
                                  {!hasCustomComparison && (
                                    <>
                                      <td className="border border-slate-200 px-4 py-3.5 text-center font-mono text-[12px] font-bold text-slate-400">{formatValue(sub.qtdCY)}</td>
                                      <td className="border border-slate-200 px-4 py-3.5 text-center font-mono text-[12px] font-bold text-slate-400">{formatValue(sub.qtdLY)}</td>
                                      <td className="border border-slate-200 px-4 py-3.5 text-center">
                                        <span className={cn(
                                          "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                          sub.qtdGrowth === 'N/A' ? "text-slate-400 bg-white border-slate-200" : getGrowthBadgeClass(sub.qtdGrowth)
                                        )}>
                                          {formatSignedGrowth(sub.qtdGrowth)}
                                        </span>
                                      </td>
                                      <td className="border border-slate-200 px-4 py-3.5 text-center font-mono text-[12px] font-bold text-slate-400">{formatValue(sub.ytdCY)}</td>
                                      <td className="border border-slate-200 px-4 py-3.5 text-center font-mono text-[12px] font-bold text-slate-400">{formatValue(sub.ytdLY)}</td>
                                      <td className="border border-slate-200 px-4 py-3.5 text-center">
                                        <span className={cn(
                                          "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                          sub.ytdGrowth === 'N/A' ? "text-slate-400 bg-white border-slate-200" : getGrowthBadgeClass(sub.ytdGrowth)
                                        )}>
                                          {formatSignedGrowth(sub.ytdGrowth)}
                                        </span>
                                      </td>
                                    </>
                                  )}
                                </tr>
                              ))}
                            </React.Fragment>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-5 overflow-hidden rounded-[1.25rem] border border-rose-200 bg-rose-50/60 shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-rose-200 bg-white/75 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Cancelled Billing</p>
                      <h3 className="text-lg font-black tracking-tight text-slate-950">Cancelled bills excluded from main RO Billing metrics</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest text-rose-500">Bills</p>
                        <p className="mt-1 font-mono text-sm font-black text-slate-950">{formatValue(cancelledSummary?.count || 0)}</p>
                      </div>
                      <div className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest text-rose-500">Labour</p>
                        <p className="mt-1 font-mono text-sm font-black text-slate-950">{formatCurrency(cancelledSummary?.labour || 0)}</p>
                      </div>
                      <div className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest text-rose-500">Parts</p>
                        <p className="mt-1 font-mono text-sm font-black text-slate-950">{formatCurrency(cancelledSummary?.parts || 0)}</p>
                      </div>
                      <div className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest text-rose-500">Total</p>
                        <p className="mt-1 font-mono text-sm font-black text-slate-950">{formatCurrency(cancelledSummary?.total || 0)}</p>
                      </div>
                    </div>
                  </div>
                  {cancelledSummary?.rows?.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[980px] border-collapse text-left">
                        <thead>
                          <tr className="bg-rose-700 text-white">
                            <th className="border border-rose-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Bill / RO</th>
                            <th className="border border-rose-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Bill Date</th>
                            <th className="border border-rose-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Work Type</th>
                            <th className="border border-rose-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Service Type</th>
                            <th className="border border-rose-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Advisor</th>
                            <th className="border border-rose-600 px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Total</th>
                            <th className="border border-rose-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cancelledSummary.rows.map((row) => (
                            <tr key={row.billKey} className="bg-white hover:bg-rose-50">
                              <td className="border border-rose-100 px-4 py-3 text-xs font-black text-slate-900">
                                <span className="block">{row.billNo || '-'}</span>
                                <span className="mt-1 block font-bold text-slate-500">RO {row.roNo || '-'}</span>
                              </td>
                              <td className="border border-rose-100 px-4 py-3 font-mono text-xs font-bold text-slate-700">{row.billDate ? row.billDate.slice(0, 10) : '-'}</td>
                              <td className="border border-rose-100 px-4 py-3 text-xs font-bold text-slate-700">{row.workType}</td>
                              <td className="border border-rose-100 px-4 py-3 text-xs font-bold text-slate-700">{row.serviceType}</td>
                              <td className="border border-rose-100 px-4 py-3 text-xs font-bold text-slate-700">{row.advisor}</td>
                              <td className="border border-rose-100 px-4 py-3 text-right font-mono text-xs font-black text-slate-950">{formatCurrency(row.total)}</td>
                              <td className="border border-rose-100 px-4 py-3">
                                <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-rose-700">{row.billStatus}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="bg-white/70 p-5 text-center text-xs font-black uppercase tracking-widest text-slate-500">
                      No cancelled bills in the selected Bill Date range.
                    </div>
                  )}
                </div>
              </div>
            ) : viewMode === 'trend' ? (
              isTrendSummaryPending || (isServerViewLoading && trendData.length === 0) ? (
                renderChartSkeleton('h-[420px]')
              ) : trendData.length === 0 ? (
                <div className="p-8">
                  <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-lg shadow-slate-200/40">
                    <p className="text-sm font-black uppercase tracking-widest text-slate-400">No trend data available</p>
                  </div>
                </div>
              ) : (
              <div className="p-8">
                <div className="mb-8 flex items-center justify-between gap-4 pr-10">
                  <div />
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full border-2 border-[#0B5D7A] bg-white" />
                      <span className="text-[10px] font-bold text-slate-600">This Year</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full border-2 border-amber-600 bg-white" />
                      <span className="text-[10px] font-bold text-slate-600">Last Year</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-0.5 w-6 bg-rose-400 border-t border-dashed border-rose-600" />
                      <span className="text-[10px] font-bold text-slate-600">Target</span>
                    </div>
                    {renderExpandButton('Day Wise Trend', 'analysis-day-wise-trend-chart')}
                  </div>
                </div>

                <div id="analysis-day-wise-trend-chart" className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 28, right: 28, bottom: 10, left: 18 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="day"
                        axisLine={false}
                        tickLine={false}
                        tick={<TrendAxisTick />}
                        tickMargin={12}
                        interval={0}
                        minTickGap={0}
                        height={44}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                        width={54}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                      />
                      <ReferenceLine y={dailyTarget} stroke="#f43f5e" strokeDasharray="5 5" label={{ position: 'right', value: 'Target', fill: '#f43f5e', fontSize: 10, fontWeight: 900 }} />
                      <Line
                        type="monotone"
                        dataKey="cy"
                        stroke="#0B5D7A"
                        strokeWidth={3}
                        dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      >
                        <LabelList dataKey="cy" content={<SmartTrendValueLabel total={trendData.length} series="cy" />} />
                      </Line>
                      <Line
                        type="monotone"
                        dataKey="ly"
                        stroke="#D97706"
                        strokeWidth={3}
                        dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      >
                        <LabelList dataKey="ly" content={<SmartTrendValueLabel total={trendData.length} series="ly" />} />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-7 gap-3 mt-10">
                  {kpiStats.map((kpi, kIdx) => (
                    <div key={kIdx} className="bg-slate-50/50 border border-slate-100 rounded-2xl p-4 text-center shadow-sm">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">{kpi.label}</p>
                      <p className={cn("text-lg font-black tracking-tight", kpi.color || "text-slate-800")}>{kpi.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              )
            ) : false ? (
              isCalendarSummaryPending || (isServerViewLoading && trendData.length === 0) ? (
                renderChartSkeleton('h-[420px]')
              ) : trendData.length === 0 ? (
                <div className="p-8">
                  <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-lg shadow-slate-200/40">
                    <p className="text-sm font-black uppercase tracking-widest text-slate-400">No calendar data available</p>
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-[#023468]">RO Billing Calendar</p>
                        <h3 className="text-lg font-black tracking-tight text-slate-950">{roBillingCalendar.monthLabel}</h3>
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {activeTrend.replace(' Trend', '')} daily CY / LY
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
                      {roBillingCalendar.days.map((day) => {
                        const isSelected = day.key === activeRoCalendarDate
                        const isAhead = day.growth !== 'N/A' && Number(day.growth) >= 0
                        return (
                          <button
                            key={day.key}
                            type="button"
                            onClick={() => setSelectedRoCalendarDate(day.key)}
                            className={cn(
                              'min-h-[112px] border-r border-b border-slate-200 p-2 text-left transition last:border-r-0 hover:bg-[#edf4fb]',
                              !day.inMonth && 'bg-slate-50 text-slate-300',
                              isSelected && 'bg-[#edf4fb] ring-2 ring-inset ring-[#023468]'
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className={cn('text-xs font-black', day.inMonth ? 'text-slate-900' : 'text-slate-300')}>
                                {day.date.getDate().toString().padStart(2, '0')}
                              </span>
                              {day.point && (
                                <span className={cn(
                                  'rounded-full border bg-white px-2 py-0.5 text-[9px] font-black',
                                  day.growth === 'N/A' ? 'border-slate-200 text-slate-400' : isAhead ? 'border-emerald-200 text-emerald-700' : 'border-rose-200 text-rose-700'
                                )}>
                                  {formatSignedGrowth(day.growth)}
                                </span>
                              )}
                            </div>
                            <div className="mt-3 space-y-1">
                              <div className="flex items-center justify-between rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700">
                                <span>CY</span>
                                <span>{formatValue(day.cy)}</span>
                              </div>
                              <div className="flex items-center justify-between rounded-md bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
                                <span>LY</span>
                                <span>{formatValue(day.ly)}</span>
                              </div>
                              <div className="flex items-center justify-between rounded-md bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">
                                <span>Target</span>
                                <span>{formatValue(day.target)}</span>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            ) : viewMode === 'fy' ? (
              isFySummaryPending || (isServerViewLoading && fyTrendsData.length === 0) ? (
                renderChartSkeleton('h-[320px]')
              ) : fyTrendsData.length === 0 ? (
                <div className="p-8">
                  <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-lg shadow-slate-200/40">
                    <p className="text-sm font-black uppercase tracking-widest text-slate-400">No FY trend data available</p>
                  </div>
                </div>
              ) : (
              <div className="p-8">
                {/* Search Bar */}
                <div className="mb-6">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search metrics (Load, Labour, Parts, etc.)..."
                      value={fySearchQuery}
                      onChange={(e) => setFySearchQuery(e.target.value)}
                      className="w-full px-4 py-3 pl-11 text-sm font-medium text-slate-700 placeholder-slate-400 bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                    />
                    <svg
                      className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-700 text-white">
                        <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest border-b border-white/10">Trends</th>
                        {fyTrendsData.map((fy) => (
                          <th key={fy.fy} className="px-6 py-4 text-center text-xs font-black uppercase tracking-widest border-b border-white/10">
                            {fy.fy}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100">
                        <td className="px-6 py-4 text-sm font-bold text-slate-700">Load</td>
                        {fyTrendsData.map((fy) => (
                          <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                            {fy.load.toLocaleString()}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100 bg-blue-50/30">
                        <td className="px-6 py-4 text-sm font-bold text-slate-700">Labour</td>
                        {fyTrendsData.map((fy) => (
                          <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                            {fy.labour.toLocaleString()}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100 bg-purple-50/30">
                        <td className="px-6 py-4 text-sm font-bold text-slate-700">Part</td>
                        {fyTrendsData.map((fy) => (
                          <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                            {fy.parts.toLocaleString()}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100 bg-teal-50/30">
                        <td className="px-6 py-4 text-sm font-bold text-slate-700">Lab / Veh</td>
                        {fyTrendsData.map((fy) => (
                          <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                            {Math.round(fy.labPerVehicle).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-slate-50 transition-colors border-b border-slate-100 bg-amber-50/30">
                        <td className="px-6 py-4 text-sm font-bold text-slate-700">Part / Veh</td>
                        {fyTrendsData.map((fy) => (
                          <td key={fy.fy} className="px-6 py-4 text-center text-sm font-mono font-bold text-slate-900">
                            {Math.round(fy.partPerVehicle).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              )
            ) : viewMode === 'leaderboard' ? (
              <div className="bg-slate-50 p-6 lg:p-8">
                <div className="mb-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Sales Team Leaderboard</p>
                      <h3 className="text-2xl font-black tracking-tight text-slate-950">Service advisor performance by revenue and RO load</h3>
                      <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
                        Ranked by selected Bill Date window, using service advisor revenue, labour, parts, and vehicle load.
                      </p>
                    </div>
                    <span className="rounded-full bg-blue-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-blue-700">
                      {serverLeaderboard.length.toLocaleString('en-IN')} services advisors
                    </span>
                  </div>
                </div>

                {isServerViewLoading && serverLeaderboard.length === 0 ? (
                  <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
                    <div className="mb-5 h-7 w-72 animate-pulse rounded-full bg-slate-100" />
                    <div className="space-y-3">
                      {Array.from({ length: 8 }).map((_, index) => (
                        <div key={index} className="grid grid-cols-[72px_1.5fr_repeat(6,1fr)] gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                          {Array.from({ length: 8 }).map((__, cellIndex) => (
                            <div key={cellIndex} className="h-5 animate-pulse rounded-full bg-slate-200/80" />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : serverLeaderboard.length === 0 ? (
                  <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-12 text-center shadow-xl shadow-slate-200/50">
                    <Users className="mx-auto mb-4 h-10 w-10 text-slate-300" />
                    <p className="text-sm font-black uppercase tracking-widest text-slate-400">No salesperson data available for this date window.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/50">
                    <div className="max-h-[680px] overflow-auto">
                      <table className="w-full min-w-[1040px] border-collapse text-left">
                        <thead className="sticky top-0 z-10 bg-slate-950 text-white">
                          <tr>
                            {['Rank', 'Service Advisor', 'RO Load', 'Total Revenue', 'Labour', 'Parts', 'Avg Billing', 'Contribution'].map((heading) => (
                              <th key={heading} className="px-5 py-4 text-[10px] font-black uppercase tracking-widest">
                                {heading}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {serverLeaderboard.map((advisor, index) => {
                            const topRank = index < 3
                            const rankStyles = [
                              {
                                badge: 'border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-200 text-amber-800 shadow-amber-100',
                                row: 'bg-amber-50/45',
                                crown: 'text-amber-500',
                                label: 'Gold',
                              },
                              {
                                badge: 'border-slate-200 bg-gradient-to-br from-white to-slate-200 text-slate-700 shadow-slate-100',
                                row: 'bg-slate-50/55',
                                crown: 'text-slate-500',
                                label: 'Silver',
                              },
                              {
                                badge: 'border-orange-200 bg-gradient-to-br from-orange-50 to-orange-200 text-orange-800 shadow-orange-100',
                                row: 'bg-orange-50/40',
                                crown: 'text-orange-600',
                                label: 'Bronze',
                              },
                            ][index]
                            return (
                            <tr key={advisor.name} className={cn('transition hover:bg-slate-50', rankStyles?.row)}>
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    'relative inline-flex h-10 w-10 items-center justify-center rounded-2xl border text-xs font-black shadow-lg',
                                    topRank ? rankStyles?.badge : 'border-slate-100 bg-slate-100 text-slate-500 shadow-slate-100'
                                  )}>
                                    {topRank && (
                                      <Crown className={cn('absolute -top-3 h-4 w-4 drop-shadow-sm', rankStyles?.crown)} />
                                    )}
                                    {index + 1}
                                  </span>
                                  {topRank && (
                                    <span className={cn('hidden rounded-full border bg-white/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest lg:inline-flex', rankStyles?.crown)}>
                                      {rankStyles?.label}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-700 to-blue-700 text-xs font-black text-white shadow-lg shadow-blue-100">
                                    {advisor.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'SP'}
                                  </div>
                                  <div>
                                    <p className="text-sm font-black text-slate-950">{advisor.name}</p>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Service advisor</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-4 font-mono text-sm font-black text-slate-800">{advisor.load.toLocaleString('en-IN')}</td>
                              <td className="px-5 py-4 font-mono text-sm font-black text-slate-950">{formatCurrency(advisor.revenue)}</td>
                              <td className="px-5 py-4 font-mono text-sm font-bold text-teal-700">{formatCurrency(advisor.labour)}</td>
                              <td className="px-5 py-4 font-mono text-sm font-bold text-amber-700">{formatCurrency(advisor.parts)}</td>
                              <td className="px-5 py-4 font-mono text-sm font-bold text-slate-700">{formatCurrency(advisor.averageBilling)}</td>
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="h-2.5 w-28 overflow-hidden rounded-full bg-slate-100">
                                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(advisor.contribution, 100)}%` }} />
                                  </div>
                                  <span className="font-mono text-xs font-black text-slate-700">{advisor.contribution.toFixed(1)}%</span>
                                </div>
                              </td>
                            </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : viewMode === 'analytics' ? (
              isAnalyticsSummaryPending || (isServerViewLoading && !executiveAnalytics) ? (
                renderAnalyticsSkeleton()
              ) : executiveAnalytics ? (
                <div className="bg-slate-50 p-6 lg:p-8">
                  <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {executiveAnalytics.kpis.map((kpi) => {
                      const Icon = kpi.icon
                      const isPositive = kpi.growth === null || kpi.growth >= 0
                      const accentClasses: Record<string, string> = {
                        teal: 'from-teal-500/15 text-teal-700 ring-teal-100',
                        blue: 'from-blue-500/15 text-blue-700 ring-blue-100',
                        violet: 'from-violet-500/15 text-violet-700 ring-violet-100',
                        emerald: 'from-emerald-500/15 text-emerald-700 ring-emerald-100',
                        amber: 'from-amber-500/15 text-amber-700 ring-amber-100',
                        cyan: 'from-cyan-500/15 text-cyan-700 ring-cyan-100',
                        rose: 'from-rose-500/15 text-rose-700 ring-rose-100',
                        slate: 'from-slate-500/15 text-slate-700 ring-slate-100',
                      }

                      return (
                        <div key={kpi.label} className="group rounded-[1.5rem] border border-white bg-white p-5 shadow-xl shadow-slate-200/60 transition duration-300 hover:-translate-y-1 hover:shadow-2xl">
                          <div className="mb-5 flex items-start justify-between">
                            <div className={cn('rounded-2xl bg-gradient-to-br to-white p-3 ring-1', accentClasses[kpi.accent])}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className={cn('rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest', isPositive ? 'bg-teal-50 text-teal-700' : 'bg-rose-50 text-rose-700')}>
                              {kpi.growth === null ? 'N/A' : formatSignedGrowth(kpi.growth)}
                            </div>
                          </div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{kpi.label}</p>
                          <AnimatedMetric value={kpi.value} formatter={kpi.formatter} className="mt-2 block text-2xl font-black tracking-tight text-slate-950" />
                          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-bold">
                            <span className="text-slate-400">LY</span>
                            <span className="text-slate-700">{kpi.formatter(kpi.ly)}</span>
                          </div>
                          <ResponsiveContainer width="100%" height={34}>
                            <AreaChart data={trendData.slice(0, 12)}>
                              <Area type="monotone" dataKey="cy" stroke="#023468" fill="#edf4fb" strokeWidth={2} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )
                    })}
                  </div>

                  <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-4">
                    {executiveAnalytics.insights.map((insight, index) => (
                      <div key={insight.title} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50">
                        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white">
                          {String(index + 1).padStart(2, '0')}
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">{insight.title}</p>
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{insight.body}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mb-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
                    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Daily Billing Trend</p>
                        <h3 className="text-2xl font-black tracking-tight text-slate-950">Revenue, labour, parts, and load progression</h3>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
                          {dailyProgressMetrics.map((metric) => (
                            <button
                              key={metric.id}
                              type="button"
                              onClick={() => setActiveDailyMetric(metric.id)}
                              className={cn(
                                "rounded-xl px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition",
                                activeDailyMetric === metric.id
                                  ? "bg-white text-slate-950 shadow-sm"
                                  : "text-slate-500 hover:text-slate-900"
                              )}
                            >
                              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: metric.color }} />
                              {metric.label}
                            </button>
                          ))}
                        </div>
                        <span className="rounded-full bg-slate-100 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">CY period</span>
                        {renderExpandButton('Daily Billing Trend', 'analysis-daily-billing-trend-chart')}
                      </div>
                    </div>
                    <div id="analysis-daily-billing-trend-chart" className="h-[460px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={executiveAnalytics.dailyRevenue} margin={{ top: 30, right: 20, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="day" interval={0} minTickGap={0} tick={<TrendAxisTick />} tickMargin={12} height={58} />
                        <YAxis yAxisId="amount" tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 11, fill: '#BE123C' }} />
                        <Tooltip formatter={(value, name) => [formatChartNumber(value), String(name)]} contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
                        {showDailySeries('labour') && (
                          <Line yAxisId="amount" type="monotone" dataKey="labour" name="Labour" stroke="#023468" strokeWidth={4} dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#023468' }}>
                            <LabelList dataKey="labour" position="bottom" formatter={formatChartLabel} fill="#023468" fontSize={activeDailyMetric === 'all' ? 8 : 9} fontWeight={900} />
                          </Line>
                        )}
                        {showDailySeries('parts') && (
                          <Line yAxisId="amount" type="monotone" dataKey="parts" name="Parts" stroke="#D97706" strokeWidth={4} dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#D97706' }}>
                            <LabelList dataKey="parts" position="bottom" offset={18} formatter={formatChartLabel} fill="#D97706" fontSize={activeDailyMetric === 'all' ? 8 : 9} fontWeight={900} />
                          </Line>
                        )}
                        {showDailySeries('revenue') && (
                          <Line yAxisId="amount" type="monotone" dataKey="revenue" name="Total Revenue" stroke="#1D4ED8" strokeWidth={4.5} dot={{ r: 4.5, strokeWidth: 2.5, fill: '#fff', stroke: '#1D4ED8' }} activeDot={{ r: 7, strokeWidth: 3, fill: '#fff', stroke: '#1D4ED8' }}>
                            <LabelList dataKey="revenue" position="top" formatter={formatChartLabel} fill="#1D4ED8" fontSize={activeDailyMetric === 'all' ? 8 : 9} fontWeight={900} />
                          </Line>
                        )}
                        {showDailySeries('load') && (
                          <Line yAxisId="load" type="monotone" dataKey="load" name="Load" stroke="#BE123C" strokeWidth={4} dot={{ r: 4.5, strokeWidth: 2, fill: '#fff', stroke: '#BE123C' }}>
                            <LabelList dataKey="load" position="top" offset={14} formatter={formatChartLabel} fill="#BE123C" fontSize={activeDailyMetric === 'all' ? 8 : 9} fontWeight={900} />
                          </Line>
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.55fr]">
                    <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
                      <div className="mb-6 flex items-start justify-between gap-4">
                        <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">Service Type Analytics</p>
                        <h3 className="text-2xl font-black tracking-tight text-slate-950">Revenue split by work type bucket</h3>
                        </div>
                        {renderExpandButton('Service Type Analytics', 'analysis-service-type-chart')}
                      </div>
                      <div id="analysis-service-type-chart" className="h-[430px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={executiveAnalytics.services}>
                          <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 800, fill: '#475569' }} />
                          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                          <Tooltip
                            formatter={(value, name) => [
                              formatCurrencyFull(Number(value || 0)),
                              String(name),
                            ]}
                            contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }}
                          />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
                          <Bar dataKey="labour" name="Labour" stackId="revenue" fill="#023468" radius={[0, 0, 8, 8]}>
                            <LabelList dataKey="labour" position="insideTop" formatter={formatChartLabel} fill="#fff" fontSize={10} fontWeight={900} />
                          </Bar>
                          <Bar dataKey="parts" name="Parts" stackId="revenue" fill="#D97706" radius={[8, 8, 0, 0]}>
                            <LabelList dataKey="parts" position="top" formatter={formatChartLabel} fill="#334155" fontSize={10} fontWeight={900} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="space-y-4">
                      {executiveAnalytics.services.slice(0, 4).map((service, index) => (
                        <div key={service.name} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-black text-slate-900">{service.name}</p>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-500">#{index + 1}</span>
                          </div>
                          <p className="mt-3 text-2xl font-black text-slate-950">{formatCurrency(service.revenue)}</p>
                          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-teal-600" style={{ width: `${executiveAnalytics.cySummary.revenue > 0 ? Math.min((service.revenue / executiveAnalytics.cySummary.revenue) * 100, 100) : 0}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
                      <div className="mb-6 flex items-start justify-between gap-4">
                        <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Revenue Mix</p>
                        <h3 className="text-2xl font-black tracking-tight text-slate-950">Labour and parts contribution</h3>
                        </div>
                        {renderExpandButton('Revenue Mix', 'analysis-revenue-mix-chart')}
                      </div>
                      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_0.8fr]">
                        <div id="analysis-revenue-mix-chart" className="relative h-[340px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={executiveAnalytics.revenueMix}
                                dataKey="value"
                                nameKey="name"
                                innerRadius="58%"
                                outerRadius="84%"
                                paddingAngle={4}
                                stroke="#fff"
                                strokeWidth={5}
                              >
                                {executiveAnalytics.revenueMix.map((entry) => (
                                  <Cell key={entry.name} fill={entry.color} />
                                ))}
                                <LabelList
                                  dataKey="value"
                                  position="outside"
                                  formatter={(value) => formatChartLabel(Number(value || 0))}
                                  fill="#0f172a"
                                  fontSize={11}
                                  fontWeight={900}
                                />
                              </Pie>
                              <Tooltip
                                formatter={(value, name) => [formatCurrency(Number(value || 0)), String(name)]}
                                contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <div className="text-center">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total</p>
                              <p className="text-xl font-black text-slate-950">{formatCurrency(executiveAnalytics.cySummary.labour + executiveAnalytics.cySummary.parts)}</p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-3 self-center">
                          {executiveAnalytics.revenueMix.map((item) => {
                            const total = executiveAnalytics.cySummary.labour + executiveAnalytics.cySummary.parts
                            const share = total > 0 ? (item.value / total) * 100 : 0
                            return (
                              <div key={item.name} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                                    <span className="text-sm font-black text-slate-800">{item.name}</span>
                                  </div>
                                  <span className="text-sm font-black text-slate-950">{share.toFixed(1)}%</span>
                                </div>
                                <p className="mt-2 font-mono text-lg font-black text-slate-950">{formatCurrency(item.value)}</p>
                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                                  <div className="h-full rounded-full" style={{ width: `${Math.min(share, 100)}%`, backgroundColor: item.color }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
                      <div className="mb-6 flex items-start justify-between gap-4">
                        <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Efficiency Bars</p>
                        <h3 className="text-2xl font-black tracking-tight text-slate-950">Average billing, labour/vehicle, and parts/vehicle</h3>
                        </div>
                        {renderExpandButton('Efficiency Bars', 'analysis-efficiency-bars-chart')}
                      </div>
                      <div id="analysis-efficiency-bars-chart" className="h-[340px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={executiveAnalytics.operatingMix} layout="vertical" margin={{ top: 8, right: 42, bottom: 8, left: 28 }}>
                          <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fontWeight: 900, fill: '#334155' }} width={92} />
                          <Tooltip formatter={(value) => formatCurrency(Number(value || 0))} contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }} />
                          <Bar dataKey="value" radius={[0, 14, 14, 0]}>
                            {executiveAnalytics.operatingMix.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                            <LabelList dataKey="value" position="right" formatter={(value) => formatCurrency(Number(value || 0))} fill="#0f172a" fontSize={11} fontWeight={900} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
                    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Work Type Deep Dive</p>
                        <h3 className="text-2xl font-black tracking-tight text-slate-950">Load and revenue concentration by bucket</h3>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-slate-100 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Top service buckets</span>
                        {renderExpandButton('Work Type Deep Dive', 'analysis-work-type-deep-dive-chart')}
                      </div>
                    </div>
                    <div id="analysis-work-type-deep-dive-chart" className="h-[430px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={executiveAnalytics.services} margin={{ top: 18, right: 26, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 800, fill: '#475569' }} />
                        <YAxis yAxisId="amount" tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 11, fill: '#BE123C' }} />
                        <Tooltip
                          formatter={(value, name) => [
                            String(name).toLowerCase().includes('revenue') ? formatCurrencyFull(Number(value || 0)) : formatChartNumber(value),
                            String(name),
                          ]}
                          contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }}
                        />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
                        <Bar yAxisId="amount" dataKey="revenue" name="Revenue" fill="#1D4ED8" radius={[12, 12, 0, 0]}>
                          <LabelList dataKey="revenue" position="top" formatter={formatChartLabel} fill="#1D4ED8" fontSize={10} fontWeight={900} />
                        </Bar>
                        <Bar yAxisId="load" dataKey="load" name="Load" fill="#BE123C" radius={[12, 12, 0, 0]}>
                          <LabelList dataKey="load" position="top" formatter={formatChartLabel} fill="#BE123C" fontSize={10} fontWeight={900} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6 bg-slate-50 p-8">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <div key={index} className="h-36 animate-pulse rounded-[1.5rem] bg-white shadow-lg shadow-slate-200/50" />
                    ))}
                  </div>
                  <div className="h-[440px] animate-pulse rounded-[2rem] bg-white shadow-lg shadow-slate-200/50" />
                  <div className="h-[440px] animate-pulse rounded-[2rem] bg-white shadow-lg shadow-slate-200/50" />
                </div>
              )) : viewMode === 'revenue' ? (
                <div className="p-8">
                  <ROBillingRevenueSummarySection
                    rowsByMetric={serverTableRowsByMetric}
                    isLoading={isServerTableLoading}
                    dateFilter={dateFilter}
                  />
                </div>
              ) : viewMode === 'intelligence' ? (
                <PerformanceIntelligenceReport dateFilter={dateFilter} dealerCode={dealerCode} />
              ) : null}
          </>
        </CardContent>
      </Card>
      {expandedChart && (
        <div className="fixed inset-0 z-[240] bg-slate-950/80 p-[10px] backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="expanded-chart-shell flex h-full w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 shadow-2xl"
            style={{ backgroundColor: '#ffffff' }}
          >
            <div
              className="expanded-chart-header flex items-center justify-between border-b border-slate-200 px-5 py-3"
              style={{ backgroundColor: '#ffffff' }}
            >
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Expanded Analysis</p>
                <h3 className="text-xl font-black text-slate-950">{expandedChart.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setExpandedChart(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-slate-800"
                aria-label="Close expanded chart"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="expanded-chart-body min-h-0 flex-1 p-4" style={{ backgroundColor: '#ffffff' }}>
              {renderExpandedChartContent()}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
