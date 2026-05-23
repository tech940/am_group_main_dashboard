'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  FileSpreadsheet,
  Download,
  Table,
  Eye,
  RefreshCw,
  Loader2,
  Activity,
  TrendingUp,
  DollarSign,
  Users,
  Award,
  Sparkles,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  Pin,
  PinOff,
  ChevronDown,
  BarChart3,
  Search,
  FileText,
  ShieldAlert,
  X,
  Maximize2,
  CalendarDays,
  SlidersHorizontal,
} from 'lucide-react'
import { AccessControlOverlay } from '@/components/shared/access-control-overlay'
import { useUserRole } from '@/lib/hooks/use-user-role'
import ROBillingReportSection from '@/app/brands/kia/ro-billing/page'
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
  ResponsiveContainer,
  ReferenceLine,
  Legend,
  AreaChart,
  Area,
  LabelList
} from 'recharts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useQueryClient } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'

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

type BusinessDateFilter = {
  mode: 'month' | 'range'
  month: number
  year: number
  startDate: string
  endDate: string
} | null

const DEFAULT_BUSINESS_EXCELLENCE_SHEET = 'Open RO Yearly'
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

function normalizeSheetKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getDefaultBusinessExcellenceSheet(sheets: SavedSheetMetadata[]) {
  const defaultKey = normalizeSheetKey(DEFAULT_BUSINESS_EXCELLENCE_SHEET)
  return sheets.find((sheet) => normalizeSheetKey(sheet.sheetName) === defaultKey)
    || sheets.find((sheet) => normalizeSheetKey(sheet.sheetName).includes(defaultKey))
    || sheets[0]
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

function formatAchievementLabel(value: unknown) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 'N/A'
  return `${Math.round(num)}%`
}

function getGrowthBadgeClass(value: number | string | 'N/A') {
  if (value === 'N/A') return 'text-slate-400 bg-slate-50 border-slate-200'
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 'text-slate-400 bg-slate-50 border-slate-200'
  return num >= 0
    ? 'text-teal-700 bg-teal-50 border-teal-100'
    : 'text-rose-700 bg-rose-50 border-rose-100'
}

function formatSignedGrowth(value: number | string | 'N/A') {
  if (value === 'N/A') return 'N/A'
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 'N/A'
  return `${num >= 0 ? '+' : '-'}${Math.abs(num).toFixed(1)}%`
}

function formatCurrency(value: number) {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

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
  if (!trimmed || trimmed === '-' || trimmed === '—' || trimmed === 'â€”') return null

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
}

function formatPIAmount(value: number) {
  return `Rs. ${Math.round(value || 0).toLocaleString('en-IN')}`
}

function formatPIDate(value: string) {
  const date = parseBusinessDate(value)
  if (!date) return value || '-'
  return date.toLocaleDateString('en-CA')
}

function PerformanceIntelligenceReport({ dateFilter }: { dateFilter: BusinessDateFilter }) {
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

      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== 'all') params.set(key, value)
      })

      const queryString = params.toString()
      const report = await queryClient.fetchQuery({
        queryKey: ['business-excellence', 'performance-intelligence', queryString],
        queryFn: async () => {
          const response = await fetch(`/api/brands/kia/business-excellence/performance-intelligence?${queryString}`)
          if (!response.ok) throw new Error('Failed to load Performance Intelligence Report')
          return await response.json() as PerformanceIntelligenceResponse
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
  }, [filters, page, queryClient, range.endDate, range.startDate])

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

    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all') params.set(key, value)
    })

    const queryString = params.toString()
    const exportData = await queryClient.fetchQuery({
      queryKey: ['business-excellence', 'performance-intelligence-export', queryString],
      queryFn: async () => {
        const response = await fetch(`/api/brands/kia/business-excellence/performance-intelligence?${queryString}`)
        if (!response.ok) throw new Error('Failed to export Performance Intelligence Report')
        return await response.json() as PerformanceIntelligenceResponse
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
    <section className="flex flex-col gap-8 bg-slate-50 p-6 lg:p-8">
      <div className="order-0 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Forensic Audit Intelligence</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Performance Intelligence Report</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              Analysis Window: {data?.dateRange.startDate || range.startDate} to {data?.dateRange.endDate || range.endDate}
            </p>
          </div>
        </div>
      </div>

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
                          {advisor.transactions.toLocaleString('en-IN')} transactions · {advisor.alerts.toLocaleString('en-IN')} alerts
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
          <label className="space-y-2 xl:col-span-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Search Reg</span>
            <div className="flex h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-3">
              <Search className="mr-2 h-4 w-4 text-slate-400" />
              <input
                value={filters.searchReg}
                onChange={(event) => updateFilter('searchReg', event.target.value)}
                placeholder="Search Registration..."
                className="w-full bg-transparent text-sm font-semibold outline-none"
              />
            </div>
          </label>
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

export default function KiaBusinessExcellencePage() {
  const queryClient = useQueryClient()
  const [savedSheets, setSavedSheets] = useState<SavedSheetMetadata[]>([])
  const [loadedRows, setLoadedRows] = useState<LoadedRows>({})
  const [loading, setLoading] = useState(true)
  const [fetchingRows, setFetchingRows] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pinnedColumns, setPinnedColumns] = useState<string[]>([])
  const [dateFilterMode, setDateFilterMode] = useState<'month' | 'range'>('month')
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth())
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [appliedDateFilter, setAppliedDateFilter] = useState<{
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null>(null)
  const [isApplyingFilter, setIsApplyingFilter] = useState(false)
  const [showDateControls, setShowDateControls] = useState(false)
  const { isAdmin } = useUserRole()
  const itemsPerPage = 10

  const activeDateLabel = useMemo(() => {
    if (!appliedDateFilter) {
      const today = new Date()
      return `Current month · ${BUSINESS_MONTHS[today.getMonth()]} ${today.getFullYear()}`
    }

    if (appliedDateFilter.mode === 'month') {
      return `${BUSINESS_MONTHS[appliedDateFilter.month]} ${appliedDateFilter.year}`
    }

    return `${appliedDateFilter.startDate || 'Start'} → ${appliedDateFilter.endDate || 'End'}`
  }, [appliedDateFilter])

  const draftDateLabel = dateFilterMode === 'month'
    ? `${BUSINESS_MONTHS[selectedMonth]} ${selectedYear}`
    : `${startDate || 'Start date'} → ${endDate || 'End date'}`

  const applyDateFilter = useCallback(() => {
    const filter = {
      mode: dateFilterMode,
      month: selectedMonth,
      year: selectedYear,
      startDate,
      endDate
    }

    setIsApplyingFilter(true)
    setTimeout(() => {
      setAppliedDateFilter(filter)
      setShowDateControls(false)
      setTimeout(() => {
        setIsApplyingFilter(false)
      }, 300)
    }, 100)
  }, [dateFilterMode, endDate, selectedMonth, selectedYear, startDate])

  const clearDateFilter = useCallback(() => {
    setIsApplyingFilter(true)
    setTimeout(() => {
      setSelectedMonth(new Date().getMonth())
      setSelectedYear(new Date().getFullYear())
      setStartDate('')
      setEndDate('')
      setAppliedDateFilter(null)
      setShowDateControls(false)
      setTimeout(() => {
        setIsApplyingFilter(false)
      }, 300)
    }, 100)
  }, [])

  const fetchSheetRows = useCallback(async (sheet: SavedSheetMetadata, page: number = 1) => {
    const sheetId = sheet.id
    setFetchingRows(sheetId)
    try {
      const params = new URLSearchParams({
        brand: sheet.brand || 'kia',
        sheet: normalizeSheetKey(sheet.sheetName),
        page: String(page),
        limit: String(itemsPerPage),
      })
      const queryString = params.toString()
      const fullData = await queryClient.fetchQuery({
        queryKey: ['business-excellence', 'sheet-rows', queryString],
        queryFn: async () => {
          const response = await fetch(`/api/brands/kia/business-excellence?${queryString}`)
          if (!response.ok) throw new Error('Failed to fetch sheet rows')
          return await response.json()
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
  }, [queryClient]) // Removed loadedRows dependency

  const fetchSavedMetadata = useCallback(async (force = false) => {
    try {
      setLoading(true)
      const queryKey = ['business-excellence', 'metadata', 'kia']
      if (force) {
        await queryClient.invalidateQueries({ queryKey })
      }
      const data = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          const response = await fetch('/api/brands/kia/business-excellence?brand=kia')
          if (!response.ok) throw new Error('Failed to fetch Business Excellence metadata')
          return await response.json()
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
        setSavedSheets(data)
        if (data.length > 0) {
          const selectedSheet = activeTab
            ? data.find((sheet: SavedSheetMetadata) => sheet.sheetName === activeTab) || getDefaultBusinessExcellenceSheet(data)
            : getDefaultBusinessExcellenceSheet(data)
          if (selectedSheet) {
            setFetchingRows(selectedSheet.id)
          }
          setActiveTab(selectedSheet?.sheetName || null)
        }
    } catch (error) {
      console.error('Failed to fetch saved metadata:', error)
    } finally {
      setLoading(false)
    }
  }, [activeTab, queryClient])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetchSavedMetadata()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (activeTab && savedSheets.length > 0) {
      const sheet = savedSheets.find(s => s.sheetName === activeTab)
      if (sheet) {
        fetchSheetRows(sheet, currentPage)
      }
    }
  }, [activeTab, currentPage, fetchSheetRows, savedSheets])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleTabChange = (sheetName: string) => {
    setActiveTab(sheetName)
    setCurrentPage(1) // Reset pagination
    setPinnedColumns([]) // Clear pins when switching sheets
    const sheet = savedSheets.find(s => s.sheetName === sheetName)
    if (sheet && !loadedRows[sheet.id]) {
      setFetchingRows(sheet.id)
    }
  }

  return (
    <MainLayout title="Business Excellence" subtitle="AM Kia Performance Analytics">
      <div className="space-y-4 w-full animate-in fade-in duration-500">
        {loading && savedSheets.length === 0 && <BusinessExcellencePageSkeleton />}

        {/* Performance Analytics Section - Show for selected sheet */}
        {savedSheets.length > 0 && activeTab && (
          <div className="space-y-4">
            {(() => {
              const selectedSheet = savedSheets.find(s => s.sheetName === activeTab)

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
              const isROBillingSheet = selectedSheet.sheetName.toLowerCase().includes('ro billing')

              return (
                <div className="animate-in slide-in-from-bottom-4 duration-500">
                  <Card className="rounded-[1.5rem] border-none bg-white shadow-xl shadow-slate-200/50 overflow-hidden">
                    <CardHeader className="border-b border-slate-50 bg-slate-50/30 p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-600 border border-teal-100/50">
                            <Activity className="h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="text-xl font-semibold text-slate-800 tracking-tight">{selectedSheet.sheetName}</CardTitle>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">
                                {isROBillingSheet ? 'Performance Analytics Dashboard' : 'Sheet Data View'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Sheet Selector */}
                          <div className="flex items-center gap-2 pr-3 border-r border-slate-100">
                            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Sheet:</p>
                            <Select
                              value={selectedSheet.sheetName}
                              onValueChange={(value) => {
                                console.log('🔄 Sheet changed to:', value)
                                handleTabChange(value)
                              }}
                            >
                              <SelectTrigger className="w-[220px] h-9 rounded-xl border-slate-200 font-bold text-slate-700 text-xs">
                                <SelectValue placeholder="Choose a sheet" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-slate-100 bg-white shadow-2xl z-[100]">
                                {savedSheets.map((sheet) => (
                                  <SelectItem key={sheet.id} value={sheet.sheetName} className="font-bold rounded-lg m-1 text-xs">
                                    {sheet.sheetName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchSavedMetadata(true)}
                            className="rounded-xl border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm font-bold h-9 px-4"
                          >
                            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <>
                        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-slate-50 p-5">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-100 bg-teal-50 text-teal-700">
                                <CalendarDays className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">Analysis Window</p>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-black text-slate-950">{activeDateLabel}</span>
                                  <span className="rounded-full bg-teal-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-700">Bill Date</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowDateControls((value) => !value)}
                                className="h-10 rounded-2xl border-slate-200 bg-white px-4 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50"
                              >
                                <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
                                {showDateControls ? 'Hide Filters' : 'Change Date'}
                              </Button>
                              {appliedDateFilter && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={isApplyingFilter}
                                  onClick={clearDateFilter}
                                  className="h-10 rounded-2xl px-4 text-xs font-black text-slate-500 hover:bg-slate-100"
                                >
                                  Clear
                                </Button>
                              )}
                            </div>
                          </div>

                          {showDateControls && (
                            <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/50">
                              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                <div className="flex flex-wrap items-center gap-3">
                                  <div className="rounded-2xl bg-slate-100 p-1">
                                    <button
                                      type="button"
                                      onClick={() => setDateFilterMode('month')}
                                      className={cn(
                                        "rounded-xl px-4 py-2 text-[11px] font-black transition",
                                        dateFilterMode === 'month' ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
                                      )}
                                    >
                                      Month
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDateFilterMode('range')}
                                      className={cn(
                                        "rounded-xl px-4 py-2 text-[11px] font-black transition",
                                        dateFilterMode === 'range' ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
                                      )}
                                    >
                                      Date Range
                                    </button>
                                  </div>

                                  {dateFilterMode === 'month' ? (
                                    <>
                                      <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                                        <SelectTrigger className="h-10 w-[150px] rounded-2xl border-slate-200 text-xs font-black">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="z-[100] rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
                                          {BUSINESS_MONTHS.map((month, idx) => (
                                            <SelectItem key={idx} value={idx.toString()} className="text-xs">{month}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>

                                      <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                                        <SelectTrigger className="h-10 w-[110px] rounded-2xl border-slate-200 text-xs font-black">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="z-[100] rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
                                          {[2024, 2025, 2026, 2027].map((year) => (
                                            <SelectItem key={year} value={year.toString()} className="text-xs">{year}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </>
                                  ) : (
                                    <>
                                      <label className="flex items-center gap-2 text-xs font-black text-slate-500">
                                        From
                                        <input
                                          type="date"
                                          value={startDate}
                                          onChange={(e) => setStartDate(e.target.value)}
                                          className="h-10 rounded-2xl border border-slate-200 px-3 text-xs font-black text-slate-800"
                                        />
                                      </label>
                                      <label className="flex items-center gap-2 text-xs font-black text-slate-500">
                                        To
                                        <input
                                          type="date"
                                          value={endDate}
                                          onChange={(e) => setEndDate(e.target.value)}
                                          className="h-10 rounded-2xl border border-slate-200 px-3 text-xs font-black text-slate-800"
                                        />
                                      </label>
                                    </>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-3">
                                  <span className="rounded-full bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    Preview: {draftDateLabel}
                                  </span>
                                  <Button
                                    size="sm"
                                    className="h-10 rounded-2xl bg-teal-700 px-5 text-xs font-black text-white shadow-lg shadow-teal-100 hover:bg-teal-800"
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
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        {false && (
                        <div className="p-6 bg-slate-50/50 border-b border-slate-100">
                          <div className="flex items-center gap-4 flex-wrap">
                            {/* Filter Mode Toggle */}
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant={dateFilterMode === 'month' ? 'default' : 'outline'}
                                onClick={() => setDateFilterMode('month')}
                                className="rounded-lg h-8 text-xs font-bold"
                              >
                                Month
                              </Button>
                              <Button
                                size="sm"
                                variant={dateFilterMode === 'range' ? 'default' : 'outline'}
                                onClick={() => setDateFilterMode('range')}
                                className="rounded-lg h-8 text-xs font-bold"
                              >
                                Date Range
                              </Button>
                            </div>

                            {/* Month/Year Selectors */}
                            {dateFilterMode === 'month' && (
                              <>
                                <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                                  <SelectTrigger className="w-[140px] h-8 rounded-lg text-xs font-bold">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="z-[100] rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
                                    {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month, idx) => (
                                      <SelectItem key={idx} value={idx.toString()} className="text-xs">{month}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>

                                <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                                  <SelectTrigger className="w-[100px] h-8 rounded-lg text-xs font-bold">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="z-[100] rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
                                    {[2024, 2025, 2026, 2027].map((year) => (
                                      <SelectItem key={year} value={year.toString()} className="text-xs">{year}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </>
                            )}

                            {/* Date Range Inputs */}
                            {dateFilterMode === 'range' && (
                              <>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs font-bold text-slate-600">From:</label>
                                  <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-bold"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs font-bold text-slate-600">To:</label>
                                  <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-bold"
                                  />
                                </div>
                              </>
                            )}

                            {/* Apply Filter Button */}
                            <Button
                              size="sm"
                              className="rounded-lg h-8 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs px-4"
                              disabled={isApplyingFilter}
                              onClick={() => {
                                const filter = {
                                  mode: dateFilterMode,
                                  month: selectedMonth,
                                  year: selectedYear,
                                  startDate,
                                  endDate
                                }
                                setIsApplyingFilter(true)
                                console.log('📅 Filter Applied:', filter)

                                // Use setTimeout to show loading state before heavy computation
                                setTimeout(() => {
                                  setAppliedDateFilter(filter)
                                  // Keep loading state for a moment to ensure user sees the feedback
                                  setTimeout(() => {
                                    setIsApplyingFilter(false)
                                  }, 300)
                                }, 100)
                              }}
                            >
                              {isApplyingFilter ? (
                                <>
                                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                  Applying...
                                </>
                              ) : (
                                'Apply Filter'
                              )}
                            </Button>

                            {/* Clear Filter Button */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg h-8 text-xs font-bold"
                              disabled={isApplyingFilter}
                              onClick={() => {
                                setIsApplyingFilter(true)
                                console.log('🔄 Filter Cleared')

                                setTimeout(() => {
                                  setSelectedMonth(new Date().getMonth())
                                  setSelectedYear(new Date().getFullYear())
                                  setStartDate('')
                                  setEndDate('')
                                  setAppliedDateFilter(null)
                                  setTimeout(() => {
                                    setIsApplyingFilter(false)
                                  }, 300)
                                }, 100)
                              }}
                            >
                              {isApplyingFilter ? (
                                <>
                                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                  Clearing...
                                </>
                              ) : (
                                'Clear'
                              )}
                            </Button>
                          </div>
                        </div>

                        )}

                        {/* Performance Analytics Section - Only for RO Billing */}
                        {isROBillingSheet ? (
                          isApplyingFilter ? (
                            <SheetContentSkeleton />
                          ) : (
                            <>
                              <ROBillingAnalytics
                                sheetId={selectedSheet.id}
                                sheetName={selectedSheet.sheetName}
                                isAdmin={isAdmin}
                                activeSheet={selectedSheet.sheetName}
                                prefetchedData={null}
                                isPrefetching={false}
                                dateFilter={appliedDateFilter}
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
    </MainLayout>
  )
}

// Wrapper component that uses pre-fetched data or fetches if not available
type ROAnalysisType = 'load' | 'labour' | 'parts' | 'lab_per_veh' | 'part_per_veh'
type ROAnalysisView = 'table' | 'trend' | 'fy' | 'analytics' | 'revenue' | 'intelligence'
type PeriodKey = 'td' | 'mtd' | 'qtd' | 'ytd'

type ROAnalysisMetric = {
  cy: number
  ly: number | 'N/A'
  growth: number | 'N/A'
}

type ROAnalysisRow = {
  name: string
  depth: number
  metrics: Record<'td' | 'mtd' | 'qtd' | 'ytd', ROAnalysisMetric>
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
  rows: ROAnalysisRow[]
  trend: Array<{ date: string; label: string; cy: number; ly: number }>
  fyTrends: Array<{ fy: string; value: number }>
  distribution: Array<{ name: string; value: number }>
  filterOptions: Record<string, string[]>
  rowCounts: { totalRows: number; rowsWithBillDate: number; filteredRows: number }
}

const RO_KPI_TABS: Array<{ id: ROAnalysisType; label: string; description: string }> = [
  { id: 'load', label: 'LOAD', description: 'Bill count' },
  { id: 'labour', label: 'LABOUR', description: 'Labour Amt' },
  { id: 'parts', label: 'PARTS', description: 'Part Amt' },
  { id: 'lab_per_veh', label: 'LAB/VEH', description: 'Labour per bill' },
  { id: 'part_per_veh', label: 'PART/VEH', description: 'Parts per bill' },
]

const RO_VIEW_TABS: Array<{ id: ROAnalysisView; label: string }> = [
  { id: 'table', label: 'Trend' },
  { id: 'trend', label: 'Day Trend' },
  { id: 'fy', label: 'FY Trends' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'revenue', label: 'Revenue' },
]

const RO_FILTERS = [
  { key: 'workType', label: 'Work Type' },
  { key: 'serviceType', label: 'Service Type' },
  { key: 'advisor', label: 'Advisor' },
  { key: 'model', label: 'Model' },
  { key: 'technician', label: 'Technician' },
  { key: 'billType', label: 'Bill Type' },
  { key: 'billStatus', label: 'Bill Status' },
] as const

function getInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDefaultRODateRange(dateFilter: {
  mode: 'month' | 'range'
  month: number
  year: number
  startDate: string
  endDate: string
} | null) {
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

function getROAnalyticsFetchRange(dateFilter: {
  mode: 'month' | 'range'
  month: number
  year: number
  startDate: string
  endDate: string
} | null) {
  const range = getDefaultRODateRange(dateFilter)
  const end = new Date(range.endDate)
  const fiscalStartYear = end.getMonth() < 3 ? end.getFullYear() - 1 : end.getFullYear()
  const start = new Date(fiscalStartYear - 1, 3, 1)
  return {
    startDate: getInputDate(start),
    endDate: range.endDate,
  }
}

function formatROValue(value: number | 'N/A', analysisType: ROAnalysisType) {
  if (value === 'N/A') return 'N/A'
  if (analysisType === 'load') return Math.round(value).toLocaleString('en-IN')
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: analysisType.includes('veh') ? 0 : 0,
  }).format(value)
}

function formatGrowthValue(value: number | 'N/A') {
  if (value === 'N/A') return 'N/A'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function ROBillingAnalytics({
  sheetId,
  sheetName,
  isAdmin,
  activeSheet,
  prefetchedData,
  isPrefetching,
  dateFilter
}: {
  sheetId: string
  sheetName: string
  isAdmin: boolean
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: {
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null
}) {
  return (
    <LegacyROBillingAnalytics
      sheetId={sheetId}
      sheetName={sheetName}
      isAdmin={isAdmin}
      activeSheet={activeSheet}
      prefetchedData={prefetchedData}
      isPrefetching={isPrefetching}
      dateFilter={dateFilter}
    />
  )
}

function LegacyROBillingAnalytics({
  sheetId,
  sheetName,
  isAdmin,
  activeSheet,
  prefetchedData,
  isPrefetching,
  dateFilter
}: {
  sheetId: string
  sheetName: string
  isAdmin: boolean
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: {
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null
}) {
  const initialData = prefetchedData && prefetchedData.length > 0 ? prefetchedData : []

  return (
    <div className="space-y-8 mt-8">
      <ServiceTypePerformance
        data={initialData}
        isAdmin={isAdmin}
        sheetId={sheetId}
        sheetName={sheetName}
        activeSheet={activeSheet}
        prefetchedData={prefetchedData}
        isPrefetching={isPrefetching}
        dateFilter={dateFilter}
      />
    </div>
  )
}

// Revenue Performance Section Component
function ROBillingRevenueSection({
  sheetId,
  sheetName,
  isAdmin,
  activeSheet,
  prefetchedData,
  isPrefetching,
  dateFilter
}: {
  sheetId: string
  sheetName: string
  isAdmin: boolean
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: {
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null
}) {
  const queryClient = useQueryClient()
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  // Use pre-fetched data if available, otherwise fetch
  useEffect(() => {
    if (prefetchedData && prefetchedData.length > 0) {
      console.log('⚡ Using pre-fetched RO Billing data for Revenue section:', prefetchedData.length, 'records')
      const timer = setTimeout(() => {
        setData(prefetchedData)
        setLoading(false)
      }, 0)
      return () => clearTimeout(timer)
    } else if (!isPrefetching) {
      // Fallback: fetch if pre-fetch didn't happen or failed
      const fetchAllData = async () => {
        try {
          setLoading(true)
          console.log('🔍 Fetching RO Billing data for Revenue section...')
          const fetchRange = getROAnalyticsFetchRange(dateFilter)
          const params = new URLSearchParams({
            brand: 'kia',
            sheet: normalizeSheetKey(sheetName),
            fetchAll: 'true',
            startDate: fetchRange.startDate,
            endDate: fetchRange.endDate,
          })
          const queryString = params.toString()
          const result = await queryClient.fetchQuery({
            queryKey: ['business-excellence', 'ro-billing-rows', queryString],
            queryFn: async () => {
              const response = await fetch(`/api/brands/kia/business-excellence?${queryString}`)
              if (!response.ok) throw new Error('Failed to fetch RO Billing revenue rows')
              return await response.json()
            },
            staleTime: DASHBOARD_STALE_TIME_MS,
          })
          const allRows = result.rows || []
          console.log('Loaded complete dataset for Revenue:', allRows.length, 'records')
          setData(allRows)
        } catch (error) {
          console.error('❌ Error fetching RO Billing data:', error)
        } finally {
          setLoading(false)
        }
      }

      if (sheetId) {
        fetchAllData()
      }
    }
  }, [sheetId, sheetName, prefetchedData, isPrefetching, dateFilter, queryClient])

  if (loading) {
    return (
      <SheetContentSkeleton />
    )
  }

  return (
    <div className="space-y-6">
      <ROBillingReportSection activeSheet={activeSheet} sharedData={data} dateFilter={dateFilter} />
    </div>
  )
}

function ServiceTypePerformance({
  data: initialData,
  isAdmin,
  sheetId,
  sheetName,
  activeSheet,
  prefetchedData,
  isPrefetching,
  dateFilter
}: {
  data: Record<string, unknown>[]
  isAdmin: boolean
  sheetId: string
  sheetName: string
  activeSheet: string | null
  prefetchedData: Record<string, unknown>[] | null
  isPrefetching: boolean
  dateFilter: {
    mode: 'month' | 'range'
    month: number
    year: number
    startDate: string
    endDate: string
  } | null
}) {
  const queryClient = useQueryClient()
  const [backgroundRows, setBackgroundRows] = useState<Record<string, unknown>[]>(initialData)
  const [isBackgroundRowsLoading, setIsBackgroundRowsLoading] = useState(false)
  const [serverTableRowsByMetric, setServerTableRowsByMetric] = useState<Partial<Record<ROAnalysisType, StatRow[]>>>({})
  const [isServerTableLoading, setIsServerTableLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<string[]>([])
  const [activeTrend, setActiveTrend] = useState("Load Trend")
  const [viewMode, setViewMode] = useState<ROAnalysisView>('table')
  const [fySearchQuery, setFySearchQuery] = useState('')
  const [expandedChart, setExpandedChart] = useState<{ title: string; chartId: string } | null>(null)
  const data = backgroundRows.length > 0 ? backgroundRows : initialData

  const activeAnalysisType: ROAnalysisType = useMemo(() => {
    if (activeTrend === 'Labour Trend') return 'labour'
    if (activeTrend === 'Parts Trend') return 'parts'
    if (activeTrend === 'Labour Per Vehicle Trend') return 'lab_per_veh'
    if (activeTrend === 'Parts Per Vehicle Trend') return 'part_per_veh'
    return 'load'
  }, [activeTrend])
  const roAnalysisTypes: ROAnalysisType[] = useMemo(() => ['load', 'labour', 'parts', 'lab_per_veh', 'part_per_veh'], [])

  const convertServerTableRows = useCallback((rows: ROAnalysisRow[] = []): StatRow[] => {
    const topRows = rows.filter((row) => row.depth === 0)
    const toStatRow = (name: string, sourceRows: ROAnalysisRow[], isParent = false): StatRow => {
      const sumMetric = (period: PeriodKey, key: 'cy' | 'ly'): number | 'N/A' => {
        let total = 0
        for (const row of sourceRows) {
          const value = row.metrics[period]?.[key]
          if (value === 'N/A') return 'N/A'
          total += Number(value || 0)
        }
        return total
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

    const nameMatches = (row: ROAnalysisRow, names: string[]) => names.some((name) => row.name.toLowerCase() === name.toLowerCase())
    const paidNames = ['Paid Service']
    const freeNames = ['Free Service', 'First Free Service', 'Second Free Service', 'Third Free Service', 'TMA-First Free Service', 'TMA-Second Free Service', 'TMA-Third Free Service', 'Sixth Free Service']
    const runningNames = ['Running Repair', 'Running Repairs']
    const accidentNames = ['Accident', 'Accidental Repair', 'Bodyshop']
    const classifiedNames = [...paidNames, ...freeNames, ...runningNames, ...accidentNames]
    const paidRows = topRows.filter((row) => nameMatches(row, paidNames))
    const freeRows = topRows.filter((row) => nameMatches(row, freeNames))
    const runningRows = topRows.filter((row) => nameMatches(row, runningNames))
    const accidentRows = topRows.filter((row) => nameMatches(row, accidentNames))
    const otherRows = topRows.filter((row) => !nameMatches(row, classifiedNames))

    const paid = toStatRow('Paid Service', paidRows, false)
    const free = toStatRow('Free Services', freeRows, false)
    const running = toStatRow('Running Repairs', runningRows, false)
    const others = toStatRow('Others', otherRows, otherRows.length > 0)
    others.subRows = otherRows.map((row) => toStatRow(row.name, [row]))
    const accident = toStatRow('Accident', accidentRows, false)
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

  useEffect(() => {
    let isActive = true
    async function fetchTableSummary() {
      try {
        setIsServerTableLoading(true)
        const range = getDefaultRODateRange(dateFilter)
        const tableResults = await Promise.all(roAnalysisTypes.map(async (analysisType) => {
          const params = new URLSearchParams({
            brand: 'kia',
            sheet: 'ro_billing_report',
            analysisType,
            view: 'table',
            groupBy: 'work_type',
            startDate: range.startDate,
            endDate: range.endDate,
          })
          const queryString = params.toString()
          const result = await queryClient.fetchQuery({
            queryKey: ['business-excellence', 'ro-billing-analysis', queryString],
            queryFn: async () => {
              const response = await fetch(`/api/brands/kia/business-excellence/ro-billing-analysis?${queryString}`)
              if (!response.ok) throw new Error(`Failed to fetch RO Billing ${analysisType} table summary`)
              return await response.json() as ROAnalysisResponse
            },
            staleTime: DASHBOARD_STALE_TIME_MS,
          })
          return [analysisType, convertServerTableRows(result.rows || [])] as const
        }))
        if (isActive) {
          setServerTableRowsByMetric(Object.fromEntries(tableResults) as Partial<Record<ROAnalysisType, StatRow[]>>)
        }
      } catch (error) {
        if (isActive) console.error('Failed to fetch RO Billing table summary:', error)
      } finally {
        if (isActive) setIsServerTableLoading(false)
      }
    }

    fetchTableSummary()
    return () => {
      isActive = false
    }
  }, [convertServerTableRows, dateFilter, queryClient, roAnalysisTypes])

  useEffect(() => {
    const range = getDefaultRODateRange(dateFilter)
    const backgroundViews: ROAnalysisView[] = ['trend', 'fy', 'analytics', 'revenue']
    const timer = window.setTimeout(() => {
      backgroundViews.forEach((view) => {
        const params = new URLSearchParams({
          brand: 'kia',
          sheet: 'ro_billing_report',
          analysisType: 'load',
          view,
          groupBy: 'work_type',
          startDate: range.startDate,
          endDate: range.endDate,
        })
        const queryString = params.toString()
        void queryClient.prefetchQuery({
          queryKey: ['business-excellence', 'ro-billing-analysis', queryString],
          queryFn: async () => {
            const response = await fetch(`/api/brands/kia/business-excellence/ro-billing-analysis?${queryString}`)
            if (!response.ok) throw new Error(`Failed to prefetch ${view}`)
            return await response.json()
          },
          staleTime: DASHBOARD_STALE_TIME_MS,
        })
      })
    }, 600)

    return () => window.clearTimeout(timer)
  }, [dateFilter, queryClient])

  useEffect(() => {
    if (backgroundRows.length > 0 || isBackgroundRowsLoading) return
    const timer = window.setTimeout(async () => {
      try {
        setIsBackgroundRowsLoading(true)
        const fetchRange = getROAnalyticsFetchRange(dateFilter)
        const params = new URLSearchParams({
          brand: 'kia',
          sheet: normalizeSheetKey(sheetName),
          fetchAll: 'true',
          startDate: fetchRange.startDate,
          endDate: fetchRange.endDate,
        })
        const queryString = params.toString()
        const result = await queryClient.fetchQuery({
          queryKey: ['business-excellence', 'ro-billing-rows', queryString],
          queryFn: async () => {
            const response = await fetch(`/api/brands/kia/business-excellence?${queryString}`)
            if (!response.ok) throw new Error('Failed to fetch RO Billing background rows')
            return await response.json()
          },
          staleTime: DASHBOARD_STALE_TIME_MS,
        })
        setBackgroundRows(result.rows || [])
      } catch (error) {
        console.error('Failed to fetch RO Billing rows in background:', error)
      } finally {
        setIsBackgroundRowsLoading(false)
      }
    }, 1500)

    return () => window.clearTimeout(timer)
  }, [backgroundRows.length, dateFilter, isBackgroundRowsLoading, queryClient, sheetName])

  const formatValue = (val: number | string | 'N/A' | undefined | null, trend: string) => {
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
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={<TrendAxisTick />} tickMargin={14} height={54} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 800, fill: '#64748b' }} width={64} />
            <Tooltip contentStyle={tooltipStyle} />
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
          <AreaChart data={executiveAnalytics.dailyRevenue} margin={{ top: 34, right: 46, bottom: 28, left: 26 }}>
            <defs>
              <linearGradient id="expandedExecRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1D4ED8" stopOpacity={0.32} />
                <stop offset="100%" stopColor="#1D4ED8" stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id="expandedExecLabour" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0F766E" stopOpacity={0.24} />
                <stop offset="100%" stopColor="#0F766E" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 12, fontWeight: 800, fill: '#475569' }} />
            <YAxis yAxisId="amount" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 12, fill: '#BE123C' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 900 }} />
            <Area yAxisId="amount" type="monotone" dataKey="revenue" name="Total Revenue" stroke="#1D4ED8" strokeWidth={4} fill="url(#expandedExecRevenue)">
              <LabelList dataKey="revenue" position="top" formatter={formatChartLabel} fill="#1D4ED8" fontSize={11} fontWeight={900} />
            </Area>
            <Area yAxisId="amount" type="monotone" dataKey="labour" name="Labour" stroke="#0F766E" strokeWidth={3} fill="url(#expandedExecLabour)" />
            <Line yAxisId="amount" type="monotone" dataKey="parts" name="Parts" stroke="#D97706" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}>
              <LabelList dataKey="parts" position="bottom" formatter={formatChartLabel} fill="#D97706" fontSize={10} fontWeight={900} />
            </Line>
            <Line yAxisId="load" type="monotone" dataKey="load" name="Load" stroke="#BE123C" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}>
              <LabelList dataKey="load" position="top" formatter={formatChartLabel} fill="#BE123C" fontSize={10} fontWeight={900} />
            </Line>
          </AreaChart>
        </ResponsiveContainer>
      )
    }

    if (expandedChart.chartId === 'analysis-cy-ly-comparison-chart') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={executiveAnalytics.comparison} barGap={14} margin={{ top: 34, right: 46, bottom: 28, left: 26 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 13, fontWeight: 900, fill: '#475569' }} />
            <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 900 }} />
            <Bar dataKey="cy" name="CY" fill="#1D4ED8" radius={[12, 12, 0, 0]}>
              <LabelList dataKey="cy" position="top" formatter={formatChartLabel} fill="#0f172a" fontSize={12} fontWeight={900} />
            </Bar>
            <Bar dataKey="ly" name="LY" fill="#94a3b8" radius={[12, 12, 0, 0]}>
              <LabelList dataKey="ly" position="top" formatter={formatChartLabel} fill="#64748b" fontSize={12} fontWeight={900} />
            </Bar>
          </BarChart>
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
            <Tooltip contentStyle={tooltipStyle} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 900 }} />
            <Bar dataKey="labour" name="Labour" stackId="revenue" fill="#0F766E" radius={[0, 0, 8, 8]}>
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
            <Tooltip contentStyle={tooltipStyle} />
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
      if (!dateStr || dateStr === '—' || dateStr === '-' || dateStr === '') return null
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

    const today = new Date()
    const todayYear = today.getFullYear()
    const todayMonth = today.getMonth()
    const todayDay = today.getDate()

    const defaultYear = todayYear
    const defaultMonth = todayMonth

    let cyYear = defaultYear
    let cyMonth = defaultMonth
    let cyDay = 31

    let isRangeMode = false
    let rangeStart = new Date()
    let rangeEnd = new Date()

    if (dateFilter) {
      if (dateFilter.mode === 'month') {
        cyYear = dateFilter.year
        cyMonth = dateFilter.month
        if (cyYear === todayYear && cyMonth === todayMonth) {
          cyDay = todayDay
        } else {
          cyDay = new Date(cyYear, cyMonth + 1, 0).getDate()
        }
      } else if (dateFilter.mode === 'range' && dateFilter.startDate && dateFilter.endDate) {
        isRangeMode = true
        rangeStart = parseDate(dateFilter.startDate) || new Date()
        rangeEnd = parseDate(dateFilter.endDate) || new Date()
        cyYear = rangeEnd.getFullYear()
        cyMonth = rangeEnd.getMonth()
        cyDay = rangeEnd.getDate()
      }
    } else {
      if (cyYear === todayYear && cyMonth === todayMonth) {
        cyDay = todayDay
      } else {
        cyDay = new Date(cyYear, cyMonth + 1, 0).getDate()
      }
    }

    const daysInMonth = new Date(cyYear, cyMonth + 1, 0).getDate()

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

    const quarterStartMonth = Math.floor(cyMonth / 3) * 3
    const cyQtdStart = new Date(cyYear, quarterStartMonth, 1, 0, 0, 0, 0)
    const cyQtdEnd = new Date(cyMtdEnd)

    const lyQtdStart = new Date(cyYear - 1, quarterStartMonth, 1, 0, 0, 0, 0)
    const lyQtdEnd = new Date(lyMtdEnd)

    let fiscalYearStartCY = cyYear
    if (cyMonth < 3) {
      fiscalYearStartCY = cyYear - 1
    }
    const cyYtdStart = new Date(fiscalYearStartCY, 3, 1, 0, 0, 0, 0)
    const cyYtdEnd = new Date(cyMtdEnd)

    const lyYtdStart = new Date(fiscalYearStartCY - 1, 3, 1, 0, 0, 0, 0)
    const lyYtdEnd = new Date(lyMtdEnd)
    const cyTdStart = new Date(cyMtdEnd)
    cyTdStart.setHours(0, 0, 0, 0)
    const cyTdEnd = new Date(cyMtdEnd)
    cyTdEnd.setHours(23, 59, 59, 999)
    const lyTdStart = new Date(lyMtdEnd)
    lyTdStart.setHours(0, 0, 0, 0)
    const lyTdEnd = new Date(lyMtdEnd)
    lyTdEnd.setHours(23, 59, 59, 999)

    console.log('📅 statsData Boundaries Derived:', {
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

    // Detect if we actually have previous year data in this dataset
    let hasLyData = false
    data.forEach(row => {
      const dateStr = String(getRecordValue(row, 'bill_date', 'Bill Date') || '')
      const date = parseDate(dateStr)
      if (date && date.getFullYear() === cyYear - 1) {
        hasLyData = true
      }
    })

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
            // MTD checks
            if (date >= cyMtdStart && date <= cyMtdEnd) {
              cyMtdKeys.add(billKey)
              addBillAmount(cyMtdAmounts, billKey, metricAmount)
            }
            if (date >= lyMtdStart && date <= lyMtdEnd) {
              lyMtdKeys.add(billKey)
              addBillAmount(lyMtdAmounts, billKey, metricAmount)
            }

            // QTD checks
            if (date >= cyQtdStart && date <= cyQtdEnd) {
              cyQtdKeys.add(billKey)
              addBillAmount(cyQtdAmounts, billKey, metricAmount)
            }
            if (date >= lyQtdStart && date <= lyQtdEnd) {
              lyQtdKeys.add(billKey)
              addBillAmount(lyQtdAmounts, billKey, metricAmount)
            }

            // YTD checks
            if (date >= cyYtdStart && date <= cyYtdEnd) {
              cyYtdKeys.add(billKey)
              addBillAmount(cyYtdAmounts, billKey, metricAmount)
            }
            if (date >= lyYtdStart && date <= lyYtdEnd) {
              lyYtdKeys.add(billKey)
              addBillAmount(lyYtdAmounts, billKey, metricAmount)
            }

            // TD checks the selected/current Bill Date only.
            if (date >= cyTdStart && date <= cyTdEnd) {
              cyTdKeys.add(billKey)
              addBillAmount(cyTdAmounts, billKey, metricAmount)
            }
            if (date >= lyTdStart && date <= lyTdEnd) {
              lyTdKeys.add(billKey)
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

    const hierarchy = [
      {
        name: 'Paid Service',
        types: paidServiceTypes,
        sub: ['General Paid Service', 'Service Package']
      },
      {
        name: 'Free Services',
        types: freeServiceTypes,
        sub: ['First Free Service', 'Second Free Service', 'Third Free Service', 'TMA-First Free Service', 'TMA-Third Free Service', 'Sixth Free Service', 'TMA-Second Free Service']
      },
      { name: 'Running Repairs', types: runningRepairTypes, sub: [] },
      { name: 'Accident', types: accidentTypes, sub: [] },
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
        for (const r of rows) {
          const val = r[field]
          if (val === 'N/A') return 'N/A'
          sum += val
        }
        return sum
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

  const trendData = useMemo(() => {
    if (viewMode !== 'trend' && viewMode !== 'analytics') return []
    if (!data || data.length === 0) return []

    const parseDate = (dateStr: string): Date | null => {
      if (!dateStr || dateStr === '—' || dateStr === '-' || dateStr === '') return null
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

    const today = new Date()
    let targetYear = today.getFullYear()
    let targetMonth = today.getMonth()

    if (dateFilter?.mode === 'month') {
      targetYear = dateFilter.year
      targetMonth = dateFilter.month
    } else if (dateFilter?.mode === 'range' && dateFilter.endDate) {
      const rangeEndDate = parseDate(dateFilter.endDate)
      if (rangeEndDate) {
        targetYear = rangeEndDate.getFullYear()
        targetMonth = rangeEndDate.getMonth()
      }
    }

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
            if (year === targetYear) {
              dayData[day].cy.add(billKey)
              addBillAmount(dayData[day].cyAmounts, billKey, metricAmount)
            } else if (year === targetYear - 1) {
              dayData[day].ly.add(billKey)
              addBillAmount(dayData[day].lyAmounts, billKey, metricAmount)
            }
          }
        }
      }
    })

    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

    return Array.from({ length: daysInMonth }, (_, i) => {
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
        target: ly * 1.1
      }
    })
  }, [data, activeTrend, dateFilter, viewMode])

  const kpiStats = useMemo(() => {
    if (!data || data.length === 0 || trendData.length === 0) {
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

    const today = new Date()
    let targetYear = today.getFullYear()
    let targetMonth = today.getMonth()

    if (dateFilter?.mode === 'month') {
      targetYear = dateFilter.year
      targetMonth = dateFilter.month
    } else if (dateFilter?.mode === 'range' && dateFilter.endDate) {
      const end = parseBusinessDate(dateFilter.endDate)
      if (end) {
        targetYear = end.getFullYear()
        targetMonth = end.getMonth()
      }
    }

    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
    const currentDay = targetYear === today.getFullYear() && targetMonth === today.getMonth()
      ? Math.min(today.getDate(), daysInMonth)
      : daysInMonth

    const measureMonth = (year: number, throughDay = daysInMonth) => {
      const isLabourAmount = activeTrend === 'Labour Trend'
      const isPartsAmount = activeTrend === 'Parts Trend'
      const isLabPerVehicle = activeTrend === 'Labour Per Vehicle Trend'
      const isPartPerVehicle = activeTrend === 'Parts Per Vehicle Trend'
      const billKeys = new Set<string>()
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
        billKeys.add(billKey)
        addBillAmount(amountBucket, billKey, amount)
      })

      const amount = sumBillAmounts(amountBucket)
      if (isLabourAmount || isPartsAmount) return amount
      if (isLabPerVehicle || isPartPerVehicle) return billKeys.size > 0 ? amount / billKeys.size : 0
      return billKeys.size
    }

    const achTillDate = measureMonth(targetYear, currentDay)
    const lyTotal = measureMonth(targetYear - 1)
    const monthTarget = lyTotal * 1.1
    const mtdAchieved = achTillDate
    const mtdTarget = monthTarget * (currentDay / daysInMonth)
    const shortfall = mtdTarget - mtdAchieved
    const totalAch = measureMonth(targetYear)
    const monthlyShortfall = monthTarget - totalAch
    const avgPerDay = currentDay > 0 ? mtdAchieved / currentDay : 0
    const projectedClosing = avgPerDay * daysInMonth
    const remainingDays = daysInMonth - currentDay
    const askingRate = remainingDays > 0 ? monthlyShortfall / remainingDays : 0
    const shortfallDisplay = Math.abs(shortfall)
    const monthlyShortfallDisplay = Math.abs(monthlyShortfall)
    const isShortfallSurplus = shortfall < 0
    const isMonthlyShortfallSurplus = monthlyShortfall < 0

    return [
      { label: 'Month Target', value: formatValue(monthTarget, activeTrend) },
            { label: 'MTD Target', value: formatValue(mtdTarget, activeTrend) },
      { label: 'MTD Achieved', value: formatValue(mtdAchieved, activeTrend) },
      {
        label: 'Shortfall T.D',
        value: formatValue(shortfallDisplay, activeTrend),
        color: isShortfallSurplus ? 'text-emerald-600' : 'text-rose-600'
      },
      {
        label: 'Monthly Shortfall',
        value: formatValue(monthlyShortfallDisplay, activeTrend),
        color: isMonthlyShortfallSurplus ? 'text-emerald-600' : 'text-rose-600'
      },
      { label: 'Projected Closing', value: formatValue(projectedClosing, activeTrend), color: projectedClosing < 0 ? 'text-rose-600' : undefined },
      { label: 'Asking Rate', value: formatValue(askingRate, activeTrend), color: askingRate < 0 ? 'text-rose-600' : askingRate > 0 ? 'text-teal-700' : undefined },
    ]
  }, [trendData, activeTrend, dateFilter, data])
  // Calculate daily target for the trend chart reference line
  const dailyTarget = trendData.length > 0
    ? (trendData.reduce((acc, day) => acc + day.ly, 0) * 1.1) / trendData.length
    : 0
  // Historical FY Trends Data
  const fyTrendsData = useMemo(() => {
    if (viewMode !== 'fy' && viewMode !== 'analytics') return []
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
      fyData[fy].load.add(billKey)
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
  }, [data, viewMode])
  const executiveAnalytics = useMemo(() => {
    if (viewMode !== 'analytics' || !data || data.length === 0) {
      return null
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

    const today = new Date()
    let cyStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0)
    let cyEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)

    if (dateFilter?.mode === 'month') {
      cyStart = new Date(dateFilter.year, dateFilter.month, 1, 0, 0, 0, 0)
      const endDay = dateFilter.year === today.getFullYear() && dateFilter.month === today.getMonth()
        ? today.getDate()
        : new Date(dateFilter.year, dateFilter.month + 1, 0).getDate()
      cyEnd = new Date(dateFilter.year, dateFilter.month, endDay, 23, 59, 59, 999)
    } else if (dateFilter?.mode === 'range' && dateFilter.startDate && dateFilter.endDate) {
      const start = parseDate(dateFilter.startDate)
      const end = parseDate(dateFilter.endDate)
      if (start && end) {
        cyStart = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0)
        cyEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)
      }
    }

    const lyStart = new Date(cyStart)
    lyStart.setFullYear(lyStart.getFullYear() - 1)
    const lyEnd = new Date(cyEnd)
    lyEnd.setFullYear(lyEnd.getFullYear() - 1)

    type AggregateBucket = {
      load: Set<string>
      labour: Map<string, number>
      parts: Map<string, number>
      total: Map<string, number>
      ratingTotal: number
      ratingCount: number
      pickDropCount: number
      rows: Record<string, unknown>[]
    }

    const createBucket = (): AggregateBucket => ({
      load: new Set<string>(),
      labour: new Map<string, number>(),
      parts: new Map<string, number>(),
      total: new Map<string, number>(),
      ratingTotal: 0,
      ratingCount: 0,
      pickDropCount: 0,
      rows: [],
    })

    const cy = createBucket()
    const ly = createBucket()
    const dailyBuckets = new Map<string, AggregateBucket>()
    const serviceBuckets = new Map<string, AggregateBucket>()

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
      bucket.load.add(billKey)
      addBillAmount(bucket.labour, billKey, parseAmount(getRecordValue(row, 'labour_amt', 'Labour Amt')))
      addBillAmount(bucket.parts, billKey, parseAmount(getRecordValue(row, 'part_amt', 'Part Amt')))
      addBillAmount(bucket.total, billKey, parseAmount(getRecordValue(row, 'total_amt', 'Total Amt')))
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
      }
    })

    const summarize = (bucket: AggregateBucket) => {
      const load = bucket.load.size
      const labour = sumBillAmounts(bucket.labour)
      const parts = sumBillAmounts(bucket.parts)
      const total = sumBillAmounts(bucket.total)
      const revenue = total > 0 ? total : labour + parts
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
      { label: 'Labour Revenue', value: cySummary.labour, ly: lySummary.labour, growth: growth(cySummary.labour, lySummary.labour), icon: DollarSign, accent: 'blue', formatter: formatCurrency },
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
        { name: 'Labour', value: cySummary.labour, color: '#0F766E' },
        { name: 'Parts', value: cySummary.parts, color: '#D97706' },
      ].filter((item) => item.value > 0),
      operatingMix: [
        { name: 'Avg Billing', value: cySummary.averageBilling, color: '#1D4ED8' },
        { name: 'Lab / Veh', value: cySummary.labPerVehicle, color: '#0F766E' },
        { name: 'Part / Veh', value: cySummary.partPerVehicle, color: '#D97706' },
      ],
      comparison: [
        { name: 'Load', cy: cySummary.load, ly: lySummary.load },
        { name: 'Labour', cy: cySummary.labour, ly: lySummary.labour },
        { name: 'Parts', cy: cySummary.parts, ly: lySummary.parts },
        { name: 'Avg Billing', cy: cySummary.averageBilling, ly: lySummary.averageBilling },
      ],
    }
  }, [data, dateFilter, viewMode])

  return (
    <>
      <Card className="rounded-3xl border border-slate-100 bg-white shadow-xl shadow-slate-200/40 mb-10 mt-10">
        <CardHeader className="sticky top-20 z-20 border-b border-slate-100 bg-slate-50/95 p-5 shadow-lg shadow-slate-200/40 backdrop-blur-md">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <CardTitle className="flex items-center gap-3 text-lg font-bold tracking-tight text-slate-800">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm">
                <Activity className="h-4 w-4" />
              </div>
              <div>
                <span>{viewMode === 'table' ? 'Performance Analysis' : viewMode === 'trend' ? 'Day Wise Trendwise' : viewMode === 'fy' ? 'Historical FY Trends' : viewMode === 'analytics' ? 'Visual Analytics' : viewMode === 'revenue' ? 'Revenue Performance' : 'Performance Intelligence Report'}</span>
                <p className="mt-1 text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">Choose a view, then choose a metric where needed</p>
              </div>
            </CardTitle>
            <div className="flex w-full flex-wrap items-center gap-1 rounded-[1.25rem] border border-slate-200 bg-white p-1 shadow-sm xl:w-auto">
              <button
                onClick={() => setViewMode('table')}
                className={cn(
                  "flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'table'
                    ? "bg-teal-700 text-white shadow-lg shadow-teal-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <TableIcon className="h-3.5 w-3.5" /> Table
              </button>
              <button
                onClick={() => setViewMode('trend')}
                className={cn(
                  "flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'trend'
                    ? "bg-teal-700 text-white shadow-lg shadow-teal-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" /> Trend
              </button>
              <button
                onClick={() => setViewMode('fy')}
                className={cn(
                  "flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'fy'
                    ? "bg-teal-700 text-white shadow-lg shadow-teal-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <BarChart3 className="h-3.5 w-3.5" /> FY Trends
              </button>
              <button
                onClick={() => setViewMode('analytics')}
                className={cn(
                  "flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'analytics'
                    ? "bg-teal-700 text-white shadow-lg shadow-teal-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <Activity className="h-3.5 w-3.5" /> Analytics
              </button>
              <button
                onClick={() => setViewMode('revenue')}
                className={cn(
                  "flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'revenue'
                    ? "bg-teal-700 text-white shadow-lg shadow-teal-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" /> Revenue
              </button>
              <button
                onClick={() => setViewMode('intelligence')}
                className={cn(
                  "flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === 'intelligence'
                    ? "bg-teal-700 text-white shadow-lg shadow-teal-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <ShieldAlert className="h-3.5 w-3.5" /> Intelligence
              </button>
            </div>
          </div>

          {(viewMode === 'table' || viewMode === 'trend') && (
            <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[9px] font-black uppercase tracking-[0.24em] text-slate-400">Metric</p>
                <p className="text-[10px] font-bold text-slate-500">{activeTrend.replace(' Trend', '')}</p>
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
                  onClick={() => setActiveTrend(trend.id)}
                  className={cn(
                    "flex min-w-[112px] items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all duration-300",
                    trend.id === activeTrend
                      ? "border-teal-700 bg-teal-700 text-white shadow-lg shadow-teal-100"
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
          <AccessControlOverlay isLocked={!isAdmin}>
            {viewMode === 'table' ? (
              <div className="p-6 pb-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-teal-600 text-white">
                        <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 min-w-[220px]">Work Type</th>
                        <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center">TD</th>
                        <th colSpan={3} className="px-4 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center bg-white/5">MTD</th>
                        <th colSpan={3} className="px-4 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center bg-white/10">QTD</th>
                        <th colSpan={3} className="px-4 py-5 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center bg-white/5">YTD</th>
                      </tr>
                      <tr className="bg-teal-600/90 text-white/80">
                        <th className="px-6 py-3 border-b border-white/5"></th>
                        <th className="px-6 py-3 border-b border-white/5"></th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">CY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">LY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">Growth</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/10">CY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/10">LY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/10">Growth</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">CY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">LY</th>
                        <th className="px-4 py-3 text-[9px] font-bold text-center border-b border-white/5 bg-white/5">Growth</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {isServerTableLoading && !activeServerTableRows ? (
                        Array.from({ length: 8 }).map((_, index) => (
                          <tr key={`ro-table-skeleton-${index}`} className="border-b border-slate-100">
                            {Array.from({ length: 11 }).map((__, cellIndex) => (
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
                                  ? "bg-gradient-to-r from-teal-700 via-teal-600 to-emerald-600 text-white shadow-[inset_4px_0_0_#0f766e]"
                                  : isTotal
                                    ? "bg-slate-100 text-slate-950 shadow-[inset_4px_0_0_#2f8f83]"
                                    : "hover:bg-slate-50/80 bg-white"
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
                                <td className={cn("px-6 py-4 text-[13px] text-center font-mono font-bold", isGrandTotal ? "text-white" : isTotal ? "text-slate-900" : "text-slate-600")}>{formatValue(row.td, activeTrend)}</td>
                                <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-black", isGrandTotal ? "bg-white/10 text-white" : isTotal ? "bg-slate-200/50 text-slate-900" : "bg-slate-50/50 text-slate-900")}>{formatValue(row.cy, activeTrend)}</td>
                                <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isGrandTotal ? "bg-white/10 text-white" : isTotal ? "bg-slate-200/50 text-slate-800" : "bg-slate-50/50 text-slate-400")}>{formatValue(row.ly, activeTrend)}</td>
                                <td className={cn("px-4 py-4 text-center", isGrandTotal ? "bg-white/10" : isTotal ? "bg-slate-200/50" : "bg-slate-50/50")}>
                                  <span className={cn(
                                    "px-2.5 py-1 rounded-full text-[10px] font-black border shadow-sm",
                                    getGrowthBadgeClass(row.growth)
                                  )}>
                                    {formatSignedGrowth(row.growth)}
                                  </span>
                                </td>
                                <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isGrandTotal ? "text-white" : isTotal ? "text-slate-900" : "text-slate-600")}>{formatValue(row.qtdCY, activeTrend)}</td>
                                <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isGrandTotal ? "text-white" : isTotal ? "text-slate-800" : "text-slate-400")}>{formatValue(row.qtdLY, activeTrend)}</td>
                                <td className="px-4 py-4 text-center">
                                  <span className={cn(
                                    "text-[10px] font-black px-2 py-0.5 rounded-full border",
                                    getGrowthBadgeClass(row.qtdGrowth)
                                  )}>
                                    {formatSignedGrowth(row.qtdGrowth)}
                                  </span>
                                </td>
                                <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isGrandTotal ? "text-white" : isTotal ? "text-slate-900" : "text-slate-600")}>{formatValue(row.ytdCY, activeTrend)}</td>
                                <td className={cn("px-4 py-4 text-[13px] text-center font-mono font-bold", isGrandTotal ? "text-white" : isTotal ? "text-slate-800" : "text-slate-400")}>{formatValue(row.ytdLY, activeTrend)}</td>
                                <td className="px-4 py-4 text-center">
                                  <span className={cn(
                                    "text-[10px] font-black px-2 py-0.5 rounded-full border",
                                    getGrowthBadgeClass(row.ytdGrowth)
                                  )}>
                                    {formatSignedGrowth(row.ytdGrowth)}
                                  </span>
                                </td>
                              </tr>

                              {isExpanded && row.subRows.map((sub: StatRow, subIdx: number) => (
                                <tr key={`${idx}-${subIdx}`} className="bg-slate-50/20 hover:bg-slate-50 transition-colors animate-in fade-in slide-in-from-top-1 duration-200">
                                  <td className="px-16 py-3.5 text-[12px] font-bold text-slate-500">
                                    <div className="flex items-center gap-2">
                                      <div className="w-1.5 h-[1px] bg-slate-200" />
                                      {sub.name}
                                    </div>
                                  </td>
                                  <td className="px-6 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold">{formatValue(sub.td, activeTrend)}</td>
                                  <td className="px-4 py-3.5 text-[12px] text-slate-700 text-center font-mono font-black border-l border-slate-100/50">{formatValue(sub.cy, activeTrend)}</td>
                                  <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold">{formatValue(sub.ly, activeTrend)}</td>
                                  <td className="px-4 py-3.5 text-center">
                                    <span className={cn(
                                      "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                      sub.growth === 'N/A' ? "text-slate-400 bg-white border-slate-200" : getGrowthBadgeClass(sub.growth)
                                    )}>
                                      {formatSignedGrowth(sub.growth)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold border-l border-slate-100/50">{formatValue(sub.qtdCY, activeTrend)}</td>
                                  <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold">{formatValue(sub.qtdLY, activeTrend)}</td>
                                  <td className="px-4 py-3.5 text-center">
                                    <span className={cn(
                                      "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                      sub.qtdGrowth === 'N/A' ? "text-slate-400 bg-white border-slate-200" : getGrowthBadgeClass(sub.qtdGrowth)
                                    )}>
                                      {formatSignedGrowth(sub.qtdGrowth)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold border-l border-slate-100/50">{formatValue(sub.ytdCY, activeTrend)}</td>
                                  <td className="px-4 py-3.5 text-[12px] text-slate-400 text-center font-mono font-bold">{formatValue(sub.ytdLY, activeTrend)}</td>
                                  <td className="px-4 py-3.5 text-center">
                                    <span className={cn(
                                      "px-2 py-0.5 rounded-full text-[9px] font-bold border",
                                      sub.ytdGrowth === 'N/A' ? "text-slate-400 bg-white border-slate-200" : getGrowthBadgeClass(sub.ytdGrowth)
                                    )}>
                                      {formatSignedGrowth(sub.ytdGrowth)}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </React.Fragment>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : viewMode === 'trend' ? (
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
            ) : viewMode === 'fy' ? (
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
            ) : viewMode === 'analytics' ? (
              executiveAnalytics ? (
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
                              <Area type="monotone" dataKey="cy" stroke="#0f766e" fill="#ccfbf1" strokeWidth={2} dot={false} />
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
                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-slate-100 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">CY period</span>
                        {renderExpandButton('Daily Billing Trend', 'analysis-daily-billing-trend-chart')}
                      </div>
                    </div>
                    <div id="analysis-daily-billing-trend-chart" className="h-[460px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={executiveAnalytics.dailyRevenue}>
                        <defs>
                          <linearGradient id="execRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#1D4ED8" stopOpacity={0.32} />
                            <stop offset="100%" stopColor="#1D4ED8" stopOpacity={0.03} />
                          </linearGradient>
                          <linearGradient id="execLabour" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0F766E" stopOpacity={0.24} />
                            <stop offset="100%" stopColor="#0F766E" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} />
                        <YAxis yAxisId="amount" tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 11, fill: '#BE123C' }} />
                        <Tooltip contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
                        <Area yAxisId="amount" type="monotone" dataKey="revenue" name="Total Revenue" stroke="#1D4ED8" strokeWidth={4} fill="url(#execRevenue)" activeDot={{ r: 7 }}>
                          <LabelList dataKey="revenue" position="top" formatter={formatChartLabel} fill="#1D4ED8" fontSize={10} fontWeight={900} />
                        </Area>
                        <Area yAxisId="amount" type="monotone" dataKey="labour" name="Labour" stroke="#0F766E" strokeWidth={3} fill="url(#execLabour)" />
                        <Line yAxisId="amount" type="monotone" dataKey="parts" name="Parts" stroke="#D97706" strokeWidth={3} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }}>
                          <LabelList dataKey="parts" position="bottom" formatter={formatChartLabel} fill="#D97706" fontSize={9} fontWeight={900} />
                        </Line>
                        <Line yAxisId="load" type="monotone" dataKey="load" name="Load" stroke="#BE123C" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}>
                          <LabelList dataKey="load" position="top" formatter={formatChartLabel} fill="#BE123C" fontSize={9} fontWeight={900} />
                        </Line>
                      </AreaChart>
                    </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="mb-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
                    <div className="mb-6 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">CY vs LY Comparison</p>
                        <h3 className="text-2xl font-black tracking-tight text-slate-950">Executive comparison across load and revenue metrics</h3>
                      </div>
                      {renderExpandButton('CY vs LY Comparison', 'analysis-cy-ly-comparison-chart')}
                    </div>
                    <div id="analysis-cy-ly-comparison-chart" className="h-[430px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={executiveAnalytics.comparison} barGap={10}>
                        <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fontWeight: 800, fill: '#475569' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                        <Tooltip contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
                        <Bar dataKey="cy" name="CY" fill="#1D4ED8" radius={[12, 12, 0, 0]}>
                          <LabelList dataKey="cy" position="top" formatter={formatChartLabel} fill="#0f172a" fontSize={11} fontWeight={900} />
                        </Bar>
                        <Bar dataKey="ly" name="LY" fill="#94a3b8" radius={[12, 12, 0, 0]}>
                          <LabelList dataKey="ly" position="top" formatter={formatChartLabel} fill="#64748b" fontSize={11} fontWeight={900} />
                        </Bar>
                      </BarChart>
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
                          <Tooltip contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
                          <Bar dataKey="labour" name="Labour" stackId="revenue" fill="#0F766E" radius={[0, 0, 8, 8]}>
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
                        <Tooltip contentStyle={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)' }} />
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
                  <ROBillingRevenueSection
                    sheetId={sheetId}
                    sheetName={sheetName}
                    isAdmin={isAdmin}
                    activeSheet={activeSheet}
                    prefetchedData={data}
                    isPrefetching={false}
                    dateFilter={dateFilter}
                  />
                </div>
              ) : viewMode === 'intelligence' ? (
                <PerformanceIntelligenceReport dateFilter={dateFilter} />
              ) : null}
          </AccessControlOverlay>
        </CardContent>
      </Card>
      {expandedChart && (
        <div className="fixed inset-0 z-[240] bg-slate-950/80 p-[10px] backdrop-blur-md animate-in fade-in duration-200">
          <div className="flex h-full w-full flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
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
            <div className="min-h-0 flex-1 p-4">
              {renderExpandedChartContent()}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
