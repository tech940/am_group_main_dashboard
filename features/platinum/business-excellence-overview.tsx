'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Maximize2,
  MessageSquareWarning,
  ShieldCheck,
  TrendingUp,
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
  ComposedChart,
  Legend,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer as RechartsResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'
import { logApiTimings } from '@/lib/api/client-timing'
import { readPlatinumJson } from '@/features/platinum/api-client'
import { BusinessDateFilterValue, appendBusinessComparisonParams } from '@/lib/business-excellence/comparison'
import {
  appendPlatinumDealerCodeParam as appendKiaDealerCodeParam,
  getPlatinumBranchLabel,
} from '@/lib/platinum/dealer-branch'
import { cn } from '@/lib/utils'

function ResponsiveContainer(props: React.ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

type BusinessDateFilter = {
  mode: 'month' | 'range' | 'preset' | 'custom' | 'year'
  preset?: BusinessDateFilterValue['preset']
  month: number
  year: number
  startDate: string
  endDate: string
  comparison?: BusinessDateFilterValue['comparison']
} | null

type WorkshopSnapshot = {
  totalJc: number
  labourAmount: number
  partsAmount: number
  totalRevenue: number
  vasAmount: number
  vasAvailable?: boolean
  vasUnavailableReason?: string | null
  vasSource?: string | null
  vasSourceTable?: string | null
  vasPeriodStart?: string | null
  vasPeriodEnd?: string | null
  vasSourceRows?: number
  vasDedupeMode?: string | null
  vasLatestSnapshotUploadedAt?: string | null
  labourPerRo: number
  minDate: string | null
  maxDate: string | null
  serviceMix: Array<{
    name: string
    totalJc: number
    labourAmount: number
    partsAmount: number
    totalRevenue: number
    vasAmount: number
  }>
}

type OverviewData = {
  asOfDate: string
  dateRange: { startDate: string; endDate: string }
  kpis: {
    revenue: number
    labour: number
    parts: number
    totalJc: number
    avgBilling: number
    openRo: number
    delayedRo: number
    openOver15: number
    avgOpenAging: number
    accidentOpenJobs: number
    complaintsTotal: number
    complaintsOpen: number
    complaintsClosed: number
    complaintsOver15: number
    avgComplaintDays: number
    ewCount: number
    rsaCount: number
    rsaAmount: number
    delayedRoPct: number
    agedRoPct: number
    complaintOpenPct: number
    addOnPerJc: number
  }
  comparison?: {
    lyRange: { startDate: string; endDate: string }
    revenue: ComparisonMetric
    labour: ComparisonMetric
    parts: ComparisonMetric
    totalJc: ComparisonMetric
    avgBilling: ComparisonMetric
    labourPerVehicle: ComparisonMetric
    partsPerVehicle: ComparisonMetric
    openRo: NullableComparisonMetric
    delayedRo: NullableComparisonMetric
    openOver15: NullableComparisonMetric
    complaintsTotal: ComparisonMetric
    complaintsOpen: ComparisonMetric
    complaintsOver15: ComparisonMetric
    addOnTotal: ComparisonMetric
    ewCount: ComparisonMetric
    rsaCount: ComparisonMetric
    workshopRevenue: ComparisonMetric
    workshopTotalJc: ComparisonMetric
    workshopLabourPerRo: ComparisonMetric
    workshopVasAmount: NullableComparisonMetric
  }
  workshopSnapshot: WorkshopSnapshot
  charts: {
    revenueTrend: Array<{ date: string | null; label: string; revenue: number; totalJc: number }>
    serviceMix: Array<{ name: string; totalJc: number; revenue: number }>
    advisorRevenue: Array<{ advisor: string; totalJc: number; revenue: number }>
    agingDistribution: Array<{ bucket: string; count: number }>
    openRoAdvisorLoad: Array<{ advisor: string; openRo: number; avgAging: number }>
    openRoWorkType: Array<{ name: string; value: number }>
    complaintAreas: Array<{ name: string; total: number; open: number; avgDays: number }>
    complaintStatus: Array<{ status: string; count: number }>
    complaintMonthlyComparison: Array<{ month: string; monthNo: number; cyCount: number; lyCount: number; growthPct: number }>
    addOnMix: Array<{ name: string; value: number }>
  }
  insights: Array<{
    label: string
    value: string
    context: string
    tone: 'good' | 'watch' | 'risk' | 'neutral'
  }>
  meta: {
    chunk?: string
    cacheTtlSeconds: number
    sourceCoverage?: {
      roBilling?: { minDate: string | null; maxDate: string | null }
      openRo?: { minDate: string | null; maxDate: string | null }
      complaints?: { minDate: string | null; maxDate: string | null }
      workshopPerformance?: { minDate: string | null; maxDate: string | null }
    }
    dealerCoverage?: {
      dealerCode: string | null
      isAllLocations: boolean
      primary?: DealerCoverage
      roBilling?: DealerCoverage
      openRo?: DealerCoverage
      complaints?: DealerCoverage
      workshopPerformance?: DealerCoverage
    }
    roBillingAudit?: PlatinumRoBillingAudit
  }
}

function withChunk(queryString: string, chunk: 'summary' | 'secondary') {
  const params = new URLSearchParams(queryString)
  params.set('chunk', chunk)
  return params.toString()
}

type ComparisonMetric = {
  cy: number
  ly: number
  deltaPct: number | null
  comparisonStatus?: ComparisonStatus
  comparisonLabel?: string | null
  unavailableReason?: string | null
}

type ComparisonStatus = 'available' | 'exact_zero' | 'not_comparable' | 'source_missing' | 'period_mismatch'

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

type PlatinumRoBillingAudit = {
  sourceAvailable: boolean
  rawRows: number
  activeRawRows: number
  cancelledRows: number
  dedupedJc: number
  duplicateRowsRemoved: number
  labour: number
  parts: number
  revenue: number
  latestUploadedAt: string | null
  ly?: {
    dedupedJc: number
    revenue: number
    jcGrowthPct: number | null
    revenueGrowthPct: number | null
  }
  previousPeriod?: {
    dedupedJc: number
    revenue: number
    jcGrowthPct: number | null
    revenueGrowthPct: number | null
  }
  dailySplit?: Array<{ date: string; rawRows: number; dedupedJc: number; revenue: number }>
  dealerSplit?: Array<{ dealerCode: string; rawRows: number; dedupedJc: number; revenue: number }>
  topInvoices?: Array<{
    billNo: string | null
    roNo: string | null
    billDate: string | null
    dealerCode: string
    workType: string | null
    revenue: number
  }>
  anomaly?: {
    level: 'none' | 'watch' | 'critical'
    reasons: string[]
    jcGrowthPct: number | null
    revenueGrowthPct: number | null
    previousJcGrowthPct: number | null
    previousRevenueGrowthPct: number | null
  }
}

type NullableComparisonMetric = {
  cy: number
  ly: number | null
  deltaPct: number | null
  available?: boolean
  comparisonStatus?: ComparisonStatus
  comparisonLabel?: string | null
  unavailableReason?: string | null
  rawLy?: number | null
  source?: string | null
  sourceTable?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  sourceRows?: number
  lySource?: string | null
  lySourceTable?: string | null
  lyPeriodStart?: string | null
  lyPeriodEnd?: string | null
  lySourceRows?: number
}

type ROAnalysisType = 'load' | 'labour' | 'parts' | 'lab_per_veh' | 'part_per_veh'
type PeriodKey = 'td' | 'mtd' | 'qtd' | 'ytd'
type ROAnalysisPeriodMetric = {
  cy: number
  ly: number | 'N/A'
  growth: number | 'N/A'
}
type ROAnalysisRow = {
  name: string
  depth: number
  metrics: Record<PeriodKey, ROAnalysisPeriodMetric>
  children?: ROAnalysisRow[]
}
type ROAnalysisTrendPoint = {
  date: string
  label: string
  cy: number
  ly: number
}
type ServiceTypeDisplayRow = {
  name: string
  values: Record<PeriodKey, ROAnalysisPeriodMetric>
  isTotal?: boolean
  isGrand?: boolean
}
type ROAnalysisResponse = {
  byMetric?: Partial<Record<ROAnalysisType, { rows?: ROAnalysisRow[]; trend?: ROAnalysisTrendPoint[] }>>
  rows?: ROAnalysisRow[]
  trend?: ROAnalysisTrendPoint[]
}

const CHART_COLORS = ['#023468', '#2563eb', '#f97316', '#e11d48', '#7c3aed', '#0891b2']
const RO_ANALYSIS_TYPES: ROAnalysisType[] = ['load', 'labour', 'parts', 'lab_per_veh', 'part_per_veh']
const RO_ANALYSIS_LABELS: Record<ROAnalysisType, string> = {
  load: 'Load',
  labour: 'Labour',
  parts: 'Parts',
  lab_per_veh: 'Lab / Veh',
  part_per_veh: 'Part / Veh',
}
const tooltipStyle = {
  borderRadius: 16,
  border: '1px solid #e2e8f0',
  boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
  fontWeight: 800,
} as const

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isInputDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function getDateRange(dateFilter: BusinessDateFilter) {
  const today = new Date()
  if (dateFilter?.startDate && dateFilter.endDate && isInputDate(dateFilter.startDate) && isInputDate(dateFilter.endDate)) {
    return { startDate: dateFilter.startDate, endDate: dateFilter.endDate }
  }

  if (
    dateFilter?.mode === 'month'
    && Number.isInteger(dateFilter.month)
    && dateFilter.month >= 0
    && dateFilter.month <= 11
    && Number.isInteger(dateFilter.year)
  ) {
    const monthStart = new Date(dateFilter.year, dateFilter.month, 1)
    const monthEnd = dateFilter.year === today.getFullYear() && dateFilter.month === today.getMonth()
      ? today
      : new Date(dateFilter.year, dateFilter.month + 1, 0)
    return { startDate: toInputDate(monthStart), endDate: toInputDate(monthEnd) }
  }

  return {
    startDate: toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: toInputDate(today),
  }
}

function formatCurrency(value: number) {
  const rounded = Math.round(Number.isFinite(value) ? value : 0)
  if (Math.abs(rounded) >= 10000000) return `Rs ${(rounded / 10000000).toFixed(2)}Cr`
  if (Math.abs(rounded) >= 100000) return `Rs ${(rounded / 100000).toFixed(2)}L`
  return `Rs ${rounded.toLocaleString('en-IN')}`
}

function formatNumber(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-IN')
}

function formatCompact(value: number) {
  const num = Number.isFinite(value) ? value : 0
  if (Math.abs(num) >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`
  if (Math.abs(num) >= 100000) return `${(num / 100000).toFixed(1)}L`
  if (Math.abs(num) >= 1000) return `${(num / 1000).toFixed(1)}K`
  return Math.round(num).toLocaleString('en-IN')
}

function formatDelta(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0
  const prefix = safeValue > 0 ? '+' : ''
  return `${prefix}${safeValue.toFixed(1)}%`
}

function formatDisplayDate(value?: string | null) {
  if (!value) return 'No data'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function formatCoverageDate(value?: string | null) {
  if (!value) return 'No data'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatAuditDateTime(value?: string | null) {
  if (!value) return 'No upload timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toneClass(tone: string) {
  if (tone === 'good') return 'border-emerald-200 bg-white text-emerald-800'
  if (tone === 'risk') return 'border-rose-200 bg-white text-rose-800'
  if (tone === 'watch') return 'border-amber-200 bg-white text-amber-800'
  return 'border-slate-300 bg-white text-slate-700'
}

function deltaClass(deltaPct: number, positiveIsGood = true) {
  const good = positiveIsGood ? deltaPct >= 0 : deltaPct <= 0
  return good ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
}

function isManagementTotalRowName(name: unknown) {
  const normalized = String(name || '').trim().toLowerCase()
  return normalized === 'mech' || normalized === 'mech total' || normalized === 'grand total'
}

function getManagementTotalRowClass(name: unknown) {
  return isManagementTotalRowName(name) ? 'be-management-total-row' : ''
}

function comparisonText(metric?: ComparisonMetric | NullableComparisonMetric, formatter: (value: number) => string = formatNumber) {
  if (!metric) return 'LY loading'
  if (metric.comparisonStatus === 'not_comparable') return metric.comparisonLabel || 'No comparable LY'
  if (metric.comparisonStatus === 'source_missing') return 'Source missing'
  if (metric.ly === null) return metric.comparisonLabel || 'No comparable LY'
  if ('available' in metric && metric.available === false) return metric.unavailableReason ? 'Source missing' : 'No comparable LY'
  if (metric.comparisonStatus === 'period_mismatch' && metric.ly !== null) {
    return `LY ${formatter(metric.ly)}`
  }
  return `LY ${formatter(metric.ly)}`
}

function deltaText(metric?: ComparisonMetric | NullableComparisonMetric) {
  if (!metric) return 'vs LY'
  if (metric.comparisonStatus === 'not_comparable') return metric.comparisonLabel || 'No comparable LY'
  if (metric.comparisonStatus === 'source_missing') return 'Source missing'
  if (metric.comparisonStatus === 'period_mismatch') return 'Period differs'
  if (metric.ly === null || metric.deltaPct === null || ('available' in metric && metric.available === false)) return metric.comparisonLabel || 'No comparable LY'
  if (metric.ly <= 0 && metric.cy > 0) return 'New vs LY'
  if (metric.ly <= 0 && metric.cy <= 0) return 'Flat vs LY'
  return `${formatDelta(metric.deltaPct)} vs LY`
}

function DealerCoverageNotice({ coverage }: { coverage?: DealerCoverage }) {
  if (!coverage || coverage.hasDataInRange || coverage.isAllLocations) return null

  const latest = coverage.latestAvailableDate ? formatCoverageDate(coverage.latestAvailableDate) : null
  const dealerLabel = getPlatinumBranchLabel(coverage.dealerCode)
  return (
    <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-900">
      No {dealerLabel} {coverage.sourceLabel} data for the selected range.
      {latest ? ` Latest ${coverage.sourceLabel} data is ${latest}.` : ` No ${dealerLabel} ${coverage.sourceLabel} history found.`}
    </div>
  )
}

function RoBillingAuditNotice({ audit }: { audit?: PlatinumRoBillingAudit }) {
  if (!audit?.sourceAvailable || !audit.anomaly || audit.anomaly.level === 'none') return null

  const topDay = [...(audit.dailySplit || [])].sort((a, b) => b.revenue - a.revenue)[0]
  const topDealer = [...(audit.dealerSplit || [])].sort((a, b) => b.revenue - a.revenue)[0]
  const topInvoice = audit.topInvoices?.[0]
  const toneClassName = audit.anomaly.level === 'critical'
    ? 'border-rose-200 bg-rose-50 text-rose-950'
    : 'border-amber-200 bg-amber-50 text-amber-950'

  return (
    <div className={cn('rounded-[1.25rem] border px-4 py-3 text-sm shadow-sm', toneClassName)}>
      <div className="mt-3 grid gap-2 text-[11px] font-black sm:grid-cols-2 xl:grid-cols-4">
        <span className="rounded-xl border border-current/15 bg-white/70 px-3 py-2">Raw rows {formatNumber(audit.rawRows)}</span>
        <span className="rounded-xl border border-current/15 bg-white/70 px-3 py-2">Deduped JC {formatNumber(audit.dedupedJc)}</span>
        <span className="rounded-xl border border-current/15 bg-white/70 px-3 py-2">Duplicates removed {formatNumber(audit.duplicateRowsRemoved)}</span>
        <span className="rounded-xl border border-current/15 bg-white/70 px-3 py-2">Latest upload {formatAuditDateTime(audit.latestUploadedAt)}</span>
      </div>
      <div className="mt-2 grid gap-2 text-[11px] font-bold sm:grid-cols-3">
        {topDay && (
          <span className="rounded-xl bg-white/60 px-3 py-2">
            Top day {formatDisplayDate(topDay.date)}: {formatNumber(topDay.dedupedJc)} JC, {formatCurrency(topDay.revenue)}
          </span>
        )}
        {topDealer && (
          <span className="rounded-xl bg-white/60 px-3 py-2">
            Top dealer {getPlatinumBranchLabel(topDealer.dealerCode)}: {formatNumber(topDealer.dedupedJc)} JC, {formatCurrency(topDealer.revenue)}
          </span>
        )}
        {topInvoice && (
          <span className="rounded-xl bg-white/60 px-3 py-2">
            Top invoice {topInvoice.billNo || topInvoice.roNo || 'Unmapped'}: {formatCurrency(topInvoice.revenue)}
          </span>
        )}
      </div>
    </div>
  )
}

function growthFromValues(cy: number, ly: number) {
  if (!Number.isFinite(ly) || ly <= 0) return null
  return ((cy - ly) / ly) * 100
}

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function scoreFromGrowth(growth: number | null, fallback = 62) {
  if (growth === null || !Number.isFinite(growth)) return fallback
  return clampScore(62 + growth * 1.15)
}

function scoreFromRiskPct(value: number, multiplier: number) {
  return clampScore(100 - Math.max(0, value) * multiplier)
}

function scoreFromInverseGrowth(growth: number | null, fallback = 74) {
  if (growth === null || !Number.isFinite(growth)) return fallback
  return clampScore(76 - growth * 0.22)
}

function healthStatus(score: number) {
  if (score >= 90) return 'EXCELLENT'
  if (score >= 75) return 'GOOD'
  if (score >= 60) return 'WATCH'
  return 'CRITICAL'
}

function buildBusinessSnapshotHealth(data: OverviewData) {
  const revenueGrowth = data.comparison?.revenue.deltaPct ?? null
  const labourGrowth = data.comparison?.labour.deltaPct ?? null
  const partsGrowth = data.comparison?.parts.deltaPct ?? null
  const loadGrowth = data.comparison?.totalJc.deltaPct ?? null
  const avgBillingGrowth = data.comparison?.avgBilling.deltaPct ?? null
  const vasMetric = data.comparison?.workshopVasAmount
  const vasGrowth = vasMetric?.available === false ? null : vasMetric?.deltaPct ?? null
  const complaintGrowth = data.comparison?.complaintsTotal.deltaPct ?? null
  const delayedRisk = scoreFromRiskPct(data.kpis.delayedRoPct, 2.2)
  const agedRisk = scoreFromRiskPct(data.kpis.agedRoPct, 2.6)
  const complaintRisk = Math.min(
    scoreFromRiskPct(data.kpis.complaintOpenPct, 1.8),
    scoreFromInverseGrowth(complaintGrowth)
  )

  const components = [
    { label: 'Revenue Growth', weight: 22, score: scoreFromGrowth(revenueGrowth), detail: revenueGrowth === null ? 'No LY comparison' : formatDelta(revenueGrowth) },
    { label: 'Labour Growth', weight: 12, score: scoreFromGrowth(labourGrowth), detail: labourGrowth === null ? 'No LY comparison' : formatDelta(labourGrowth) },
    { label: 'Parts Growth', weight: 12, score: scoreFromGrowth(partsGrowth), detail: partsGrowth === null ? 'No LY comparison' : formatDelta(partsGrowth) },
    { label: 'Load / JC Growth', weight: 12, score: scoreFromGrowth(loadGrowth), detail: loadGrowth === null ? 'No LY comparison' : formatDelta(loadGrowth) },
    { label: 'Average Billing Growth', weight: 12, score: scoreFromGrowth(avgBillingGrowth), detail: avgBillingGrowth === null ? 'No LY comparison' : formatDelta(avgBillingGrowth) },
    { label: 'Delayed RO Control', weight: 8, score: delayedRisk, detail: `${data.kpis.delayedRoPct.toFixed(1)}% delayed` },
    { label: '>15D RO Control', weight: 7, score: agedRisk, detail: `${data.kpis.agedRoPct.toFixed(1)}% over 15D` },
    { label: 'Complaint Control', weight: 5, score: complaintRisk, detail: complaintGrowth === null ? `${data.kpis.complaintOpenPct.toFixed(1)}% open` : `${formatDelta(complaintGrowth)} complaints` },
  ]

  if (vasGrowth !== null) {
    components.splice(5, 0, {
      label: 'VAS Revenue Growth',
      weight: 10,
      score: scoreFromGrowth(vasGrowth),
      detail: formatDelta(vasGrowth),
    })
  }

  const weightedScore = components.reduce((sum, item) => sum + item.score * item.weight, 0) / components.reduce((sum, item) => sum + item.weight, 0)
  const sortedPositive = [...components].sort((a, b) => b.score - a.score).slice(0, 3)
  const sortedNegative = [...components].sort((a, b) => a.score - b.score).slice(0, 3)

  return {
    score: clampScore(weightedScore),
    status: healthStatus(weightedScore),
    overallGrowth: revenueGrowth,
    components,
    positiveDrivers: sortedPositive,
    negativeDrivers: sortedNegative,
  }
}

function buildWeeklyBillingTrend(
  rows: OverviewData['charts']['revenueTrend'],
  startDate: string
) {
  const start = new Date(`${startDate}T00:00:00`)
  const groups = new Map<number, {
    index: number
    minDate: string
    maxDate: string
    revenue: number
    totalJc: number
  }>()

  rows.forEach((row) => {
    if (!row.date) return
    const date = new Date(`${row.date}T00:00:00`)
    if (Number.isNaN(date.getTime()) || Number.isNaN(start.getTime())) return

    const diffDays = Math.max(0, Math.floor((date.getTime() - start.getTime()) / 86400000))
    const index = Math.floor(diffDays / 7)
    const existing = groups.get(index)

    if (existing) {
      existing.minDate = row.date < existing.minDate ? row.date : existing.minDate
      existing.maxDate = row.date > existing.maxDate ? row.date : existing.maxDate
      existing.revenue += row.revenue
      existing.totalJc += row.totalJc
      return
    }

    groups.set(index, {
      index,
      minDate: row.date,
      maxDate: row.date,
      revenue: row.revenue,
      totalJc: row.totalJc,
    })
  })

  return Array.from(groups.values())
    .sort((a, b) => a.index - b.index)
    .map((group) => ({
      label: group.minDate === group.maxDate
        ? formatDisplayDate(group.minDate)
        : `${formatDisplayDate(group.minDate)} - ${formatDisplayDate(group.maxDate)}`,
      revenue: group.revenue,
      totalJc: group.totalJc,
    }))
}

function buildRoAnalysisQueryString(view: 'table' | 'trend', range: { startDate: string; endDate: string }, dateFilter: BusinessDateFilter, dealerCode?: string | null) {
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

function getMetricRows(response: ROAnalysisResponse | undefined, metric: ROAnalysisType) {
  return response?.byMetric?.[metric]?.rows || (metric === 'load' ? response?.rows : undefined) || []
}

function getMetricTrend(response: ROAnalysisResponse | undefined, metric: ROAnalysisType) {
  return response?.byMetric?.[metric]?.trend || (metric === 'load' ? response?.trend : undefined) || []
}

function sumPeriodRows(rows: ROAnalysisRow[], period: PeriodKey, key: 'cy' | 'ly') {
  let total = 0
  let hasNumericValue = false
  rows
    .filter((row) => row.depth === 0)
    .forEach((row) => {
      const value = row.metrics?.[period]?.[key]
      if (value === 'N/A') return
      total += Number(value || 0)
      hasNumericValue = true
    })
  return hasNumericValue ? total : 'N/A'
}

function growthValue(cy: number, ly: number | 'N/A') {
  if (ly === 'N/A' || ly <= 0) return 'N/A' as const
  return ((cy - ly) / ly) * 100
}

function divideMetricValue(numerator: number | 'N/A', denominator: number | 'N/A') {
  if (numerator === 'N/A' || denominator === 'N/A' || denominator <= 0) return 'N/A' as const
  return numerator / denominator
}

function totalMetricPeriods(response: ROAnalysisResponse | undefined, metric: Extract<ROAnalysisType, 'load' | 'labour' | 'parts'>) {
  const rows = getMetricRows(response, metric)
  const periods = {} as Record<PeriodKey, ROAnalysisPeriodMetric>
  ;(['td', 'mtd', 'qtd', 'ytd'] as PeriodKey[]).forEach((period) => {
    const cy = sumPeriodRows(rows, period, 'cy')
    const ly = sumPeriodRows(rows, period, 'ly')
    const safeCy = cy === 'N/A' ? 0 : cy
    periods[period] = {
      cy: safeCy,
      ly,
      growth: growthValue(safeCy, ly),
    }
  })
  return periods
}

function perVehiclePeriods(amount: Record<PeriodKey, ROAnalysisPeriodMetric>, load: Record<PeriodKey, ROAnalysisPeriodMetric>) {
  const periods = {} as Record<PeriodKey, ROAnalysisPeriodMetric>
  ;(['td', 'mtd', 'qtd', 'ytd'] as PeriodKey[]).forEach((period) => {
    const cy = divideMetricValue(amount[period].cy, load[period].cy)
    const ly = divideMetricValue(amount[period].ly, load[period].ly)
    const safeCy = cy === 'N/A' ? 0 : cy
    periods[period] = {
      cy: safeCy,
      ly,
      growth: growthValue(safeCy, ly),
    }
  })
  return periods
}

function buildDetailedRoRows(response: ROAnalysisResponse | undefined) {
  const load = totalMetricPeriods(response, 'load')
  const labour = totalMetricPeriods(response, 'labour')
  const parts = totalMetricPeriods(response, 'parts')
  const revenue = {} as Record<PeriodKey, ROAnalysisPeriodMetric>
  ;(['td', 'mtd', 'qtd', 'ytd'] as PeriodKey[]).forEach((period) => {
    const cy = Number(labour[period].cy || 0) + Number(parts[period].cy || 0)
    const labourLy = labour[period].ly
    const partsLy = parts[period].ly
    const hasLy = labourLy !== 'N/A' || partsLy !== 'N/A'
    const ly = hasLy
      ? Number(labourLy === 'N/A' ? 0 : labourLy || 0) + Number(partsLy === 'N/A' ? 0 : partsLy || 0)
      : 'N/A'
    revenue[period] = {
      cy,
      ly,
      growth: growthValue(cy, ly),
    }
  })
  const labPerVeh = perVehiclePeriods(labour, load)
  const partPerVeh = perVehiclePeriods(parts, load)
  return [
    { metric: 'Load', formatter: formatNumber, values: load },
    { metric: 'Revenue', formatter: formatCurrency, values: revenue },
    { metric: 'Labour', formatter: formatCurrency, values: labour },
    { metric: 'Parts', formatter: formatCurrency, values: parts },
    { metric: 'Labour / Vehicle', formatter: formatCurrency, values: labPerVeh },
    { metric: 'Parts / Vehicle', formatter: formatCurrency, values: partPerVeh },
  ]
}

function namesMatch(row: ROAnalysisRow, names: string[]) {
  const rowName = row.name.trim().toLowerCase()
  return names.some((name) => rowName === name.toLowerCase())
}

function combineAnalysisRows(rows: ROAnalysisRow[]) {
  const values = {} as Record<PeriodKey, ROAnalysisPeriodMetric>
  ;(['td', 'mtd', 'qtd', 'ytd'] as PeriodKey[]).forEach((period) => {
    let cy = 0
    let ly = 0
    let hasLy = false
    rows.forEach((row) => {
      cy += Number(row.metrics?.[period]?.cy || 0)
      const lyValue = row.metrics?.[period]?.ly
      if (lyValue !== 'N/A') {
        ly += Number(lyValue || 0)
        hasLy = true
      }
    })
    const lyResult = hasLy ? ly : 'N/A'
    values[period] = {
      cy,
      ly: lyResult,
      growth: growthValue(cy, lyResult),
    }
  })
  return values
}

function buildServiceTypeAmountRows(rows: ROAnalysisRow[] = []): ServiceTypeDisplayRow[] {
  const topRows = rows.filter((row) => row.depth === 0)
  const paidNames = ['Paid Service']
  const freeNames = ['Free Service', 'Free Services', 'First Free Service', 'Second Free Service', 'Third Free Service', 'TMA-First Free Service', 'TMA-Second Free Service', 'TMA-Third Free Service', 'Sixth Free Service']
  const runningNames = ['Running Repair', 'Running Repairs']
  const accidentNames = ['Accident', 'Accidental Repair', 'Bodyshop', 'Body Shop', 'Insurance', 'CRASH', 'Accident Repair', 'Body Repair', 'Paint & Body', 'Paint and Body']
  const classifiedNames = [...paidNames, ...freeNames, ...runningNames, ...accidentNames]

  const paidRows = topRows.filter((row) => namesMatch(row, paidNames))
  const freeRows = topRows.filter((row) => namesMatch(row, freeNames))
  const runningRows = topRows.filter((row) => namesMatch(row, runningNames))
  const accidentRows = topRows.filter((row) => namesMatch(row, accidentNames))
  const otherRows = topRows.filter((row) => !namesMatch(row, classifiedNames))

  const paid = { name: 'Paid Service', values: combineAnalysisRows(paidRows) }
  const free = { name: 'Free Services', values: combineAnalysisRows(freeRows) }
  const running = { name: 'Running Repairs', values: combineAnalysisRows(runningRows) }
  const mech = { name: 'MECH', values: combineAnalysisRows([...paidRows, ...freeRows, ...runningRows]), isTotal: true }
  const others = { name: 'Others', values: combineAnalysisRows(otherRows) }
  const mechTotal = { name: 'MECH TOTAL', values: combineAnalysisRows([...paidRows, ...freeRows, ...runningRows, ...otherRows]), isTotal: true }
  const accident = { name: 'Accident', values: combineAnalysisRows(accidentRows) }
  const grandTotal = { name: 'Grand Total', values: combineAnalysisRows([...paidRows, ...freeRows, ...runningRows, ...otherRows, ...accidentRows]), isGrand: true }

  return [paid, free, running, mech, others, mechTotal, accident, grandTotal]
}

function deriveServiceTypeRatioRows(amountRows: ServiceTypeDisplayRow[], loadRows: ServiceTypeDisplayRow[]) {
  const loadByName = new Map(loadRows.map((row) => [row.name, row]))
  return amountRows.map((amountRow) => {
    const loadRow = loadByName.get(amountRow.name)
    const values = {} as Record<PeriodKey, ROAnalysisPeriodMetric>
    ;(['td', 'mtd', 'qtd', 'ytd'] as PeriodKey[]).forEach((period) => {
      const cy = divideMetricValue(amountRow.values[period].cy, loadRow?.values[period].cy ?? 'N/A')
      const ly = divideMetricValue(amountRow.values[period].ly, loadRow?.values[period].ly ?? 'N/A')
      const safeCy = cy === 'N/A' ? 0 : cy
      values[period] = {
        cy: safeCy,
        ly,
        growth: growthValue(safeCy, ly),
      }
    })
    return {
      ...amountRow,
      values,
    }
  })
}

function buildServiceTypeRowsByMetric(response: ROAnalysisResponse | undefined) {
  const load = buildServiceTypeAmountRows(getMetricRows(response, 'load'))
  const labour = buildServiceTypeAmountRows(getMetricRows(response, 'labour'))
  const parts = buildServiceTypeAmountRows(getMetricRows(response, 'parts'))
  return {
    load,
    labour,
    parts,
    lab_per_veh: deriveServiceTypeRatioRows(labour, load),
    part_per_veh: deriveServiceTypeRatioRows(parts, load),
  } satisfies Record<ROAnalysisType, ServiceTypeDisplayRow[]>
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="h-40 animate-pulse rounded-[1.5rem] bg-slate-100" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded-[1.25rem] bg-slate-100" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-80 animate-pulse rounded-[1.5rem] bg-slate-100" />)}
      </div>
    </div>
  )
}

function SnapshotTile({
  icon: Icon,
  label,
  value,
  meta,
  comparison,
  positiveIsGood = true,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  meta: string
  comparison?: {
    lyText: string
    deltaText: string
    deltaPct: number | null
  }
  positiveIsGood?: boolean
  tone?: 'good' | 'watch' | 'risk' | 'neutral'
}) {
  return (
    <div className="min-h-[104px] rounded-xl border border-slate-300 bg-white p-4 text-slate-950 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
          <Icon className="h-4.5 w-4.5 text-slate-950" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
            <span className="text-slate-300">...</span>
          </div>
          <p className="mt-2 text-2xl font-black leading-none tracking-tight text-slate-950">{value}</p>
          <p className="mt-2 truncate text-[11px] font-black text-slate-600">{meta}</p>
        </div>
      </div>
      {comparison && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider shadow-sm">
          <span className="truncate text-slate-600">{comparison.lyText}</span>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5',
            comparison.deltaText === 'No LY data'
              || comparison.deltaText === 'Insufficient history'
              || comparison.deltaText === 'No comparable LY'
              || comparison.deltaText === 'Current WIP only'
              || comparison.deltaText === 'No LY WIP snapshot'
              || comparison.deltaText === 'No selected-range data'
              || comparison.deltaText === 'Source missing'
              || comparison.deltaText === 'No complaints'
              || comparison.deltaText === 'Period differs'
              ? 'bg-slate-100 text-slate-500'
              : deltaClass(comparison.deltaPct || 0, positiveIsGood)
          )}>
            {comparison.deltaText}
          </span>
        </div>
      )}
    </div>
  )
}

function BusinessHealthCard({
  health,
  cyRevenue,
  lyRevenue,
  onClick,
}: {
  health: ReturnType<typeof buildBusinessSnapshotHealth>
  cyRevenue: number
  lyRevenue: number
  onClick: () => void
}) {
  const statusTone = health.score >= 75 ? 'good' : health.score >= 60 ? 'watch' : 'risk'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-[104px] rounded-xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
        toneClass(statusTone)
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-65">Business Health</p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-4xl font-black leading-none tracking-tight">{health.score}</span>
            <span className="pb-1 text-sm font-black opacity-60">/100</span>
          </div>
        </div>
        <span className="rounded-full bg-white/75 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest shadow-sm">
          {health.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-black uppercase tracking-wider">
        <div className="rounded-lg bg-white/70 px-2.5 py-1.5 shadow-sm">
          <span className="block opacity-60">CY</span>
          <span>{formatCurrency(cyRevenue)}</span>
        </div>
        <div className="rounded-lg bg-white/70 px-2.5 py-1.5 shadow-sm">
          <span className="block opacity-60">LY</span>
          <span>{formatCurrency(lyRevenue)}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider shadow-sm">
        <span className="opacity-75">Overall growth</span>
        <span className={cn(
          'rounded-full px-2 py-0.5',
          health.overallGrowth === null ? 'bg-slate-100 text-slate-500' : deltaClass(health.overallGrowth)
        )}>
          {health.overallGrowth === null ? 'N/A' : formatDelta(health.overallGrowth)}
        </span>
      </div>
      <p className="mt-2 text-[10px] font-bold opacity-65">Click to view score calculation</p>
    </button>
  )
}

function BusinessHealthNoScoreCard({ reason }: { reason: string }) {
  return (
    <div className="min-h-[104px] rounded-xl border border-slate-300 bg-white p-4 text-left text-slate-950 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Business Health</p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-4xl font-black leading-none tracking-tight">N/A</span>
            <span className="pb-1 text-sm font-black text-slate-400">/100</span>
          </div>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 shadow-sm">
          No score
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-black uppercase tracking-wider">
        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
          <span className="block text-slate-400">CY</span>
          <span>No data</span>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
          <span className="block text-slate-400">LY</span>
          <span>No score</span>
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500 shadow-sm">
        Overall N/A
      </div>
      <p className="mt-2 text-[10px] font-bold text-slate-500">{reason}</p>
    </div>
  )
}

function MiniBusinessCard({
  title,
  cy,
  ly,
  growth,
  status,
  positiveIsGood = true,
}: {
  title: string
  cy: string
  ly: string
  growth: number | null
  status: string
  positiveIsGood?: boolean
}) {
  const isNeutral = growth === null
  const isGood = !isNeutral && (positiveIsGood ? growth >= 0 : growth <= 0)
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
        <span className={cn(
          'rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-widest',
          isNeutral ? 'text-slate-500' : 'text-slate-950'
        )}>
          {status}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CY</p>
          <p className="mt-1 text-xl font-black text-slate-950">{cy}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">LY</p>
          <p className="mt-1 text-xl font-black text-slate-600">{ly}</p>
        </div>
      </div>
      <p className={cn(
        'mt-4 inline-flex rounded-full px-3 py-1 text-xs font-black',
        isNeutral ? 'bg-slate-100 text-slate-500' : isGood ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
      )}>
        {growth === null ? 'No comparison' : formatDelta(growth)}
      </p>
    </div>
  )
}

function RoBillingPerformanceTable({
  rows,
}: {
  rows: Array<{
    metric: string
    cy: string
    ly: string
    growth: number | null
    positiveIsGood?: boolean
  }>
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">RO Billing Data</p>
          <h3 className="mt-1 text-xl font-black tracking-tight text-slate-950">RO Billing Performance</h3>
        </div>
        <p className="text-xs font-bold text-slate-500">Metric | CY | LY | Growth</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="bg-slate-950 text-white">
            <tr>
              {['Metric', 'CY', 'LY', 'Growth'].map((heading) => (
                <th key={heading} className="border border-slate-800 px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const growthValue = row.growth
              const isNeutral = growthValue === null
              const isGood = !isNeutral && (row.positiveIsGood === false ? growthValue <= 0 : growthValue >= 0)
              return (
                <tr key={row.metric} className="bg-white transition hover:bg-slate-50">
                  <td className="border border-slate-200 px-4 py-3 text-sm font-black text-slate-900">{row.metric}</td>
                  <td className="border border-slate-200 px-4 py-3 font-mono text-sm font-black text-slate-950">{row.cy}</td>
                  <td className="border border-slate-200 px-4 py-3 font-mono text-sm font-bold text-slate-500">{row.ly}</td>
                  <td className="border border-slate-200 px-4 py-3">
                    <span className={cn(
                      'inline-flex rounded-full px-3 py-1 text-[11px] font-black',
                      isNeutral ? 'bg-slate-100 text-slate-500' : isGood ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    )}>
                      {growthValue === null ? 'N/A' : formatDelta(growthValue)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DetailedRoBillingMatrix({
  rows,
}: {
  rows: Array<{
    metric: string
    formatter: (value: number) => string
    values: Record<PeriodKey, ROAnalysisPeriodMetric>
  }>
}) {
  const renderGrowth = (value: number | 'N/A') => {
    if (value === 'N/A') return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">N/A</span>
    return (
      <span className={cn(
        'rounded-full px-2.5 py-1 text-[10px] font-black',
        value >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
      )}>
        {formatDelta(value)}
      </span>
    )
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">RO Billing Matrix</p>
          <h3 className="mt-1 text-xl font-black tracking-tight text-slate-950">TD / MTD / QTD / YTD performance</h3>
        </div>
        <p className="text-xs font-bold text-slate-500">Load, Labour, Parts, Labour/Vehicle, Parts/Vehicle</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse">
          <thead className="bg-slate-950 text-white">
            <tr>
              <th rowSpan={2} className="border border-slate-800 px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Metric</th>
              <th rowSpan={2} className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">TD</th>
              {['MTD', 'QTD', 'YTD'].map((period) => (
                <th key={period} colSpan={3} className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">{period}</th>
              ))}
            </tr>
            <tr>
              {['MTD', 'QTD', 'YTD'].flatMap((period) => ['CY', 'LY', 'Growth'].map((label) => (
                <th key={`${period}-${label}`} className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">{label}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metric} className="bg-white transition hover:bg-slate-50">
                <td className="border border-slate-200 px-4 py-3 text-sm font-black text-slate-950">{row.metric}</td>
                <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-slate-950">{row.formatter(row.values.td.cy)}</td>
                {(['mtd', 'qtd', 'ytd'] as PeriodKey[]).map((period) => (
                  <React.Fragment key={`${row.metric}-${period}`}>
                    <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-slate-950">{row.formatter(row.values[period].cy)}</td>
                    <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-bold text-slate-500">{row.values[period].ly === 'N/A' ? 'N/A' : row.formatter(row.values[period].ly)}</td>
                    <td className="border border-slate-200 px-4 py-3 text-center">{renderGrowth(row.values[period].growth)}</td>
                  </React.Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ServiceTypeRoBillingTable({
  rows,
  metric,
  onMetricChange,
}: {
  rows: ServiceTypeDisplayRow[]
  metric: ROAnalysisType
  onMetricChange: (metric: ROAnalysisType) => void
}) {
  const formatter = metric === 'load' ? formatNumber : formatCurrency
  const renderGrowth = (value: number | 'N/A') => {
    if (value === 'N/A') return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">N/A</span>
    return (
      <span className={cn(
        'rounded-full px-2.5 py-1 text-[10px] font-black',
        value >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
      )}>
        {formatDelta(value)}
      </span>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Service Type</p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-slate-950">RO Billing service type table</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {RO_ANALYSIS_TYPES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onMetricChange(item)}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition',
                  metric === item ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                {item === 'load' ? <Activity className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                {RO_ANALYSIS_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Metric {RO_ANALYSIS_LABELS[metric]}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse">
          <thead className="bg-slate-950 text-white">
            <tr>
              <th rowSpan={2} className="border border-slate-800 px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">Work Type</th>
              <th rowSpan={2} className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">TD</th>
              {['MTD', 'QTD', 'YTD'].map((period) => (
                <th key={period} colSpan={3} className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">{period}</th>
              ))}
            </tr>
            <tr>
              {['MTD', 'QTD', 'YTD'].flatMap((period) => ['CY', 'LY', 'Growth'].map((label) => (
                <th key={`${period}-${label}`} className="border border-slate-800 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest">{label}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.name}
                className={cn(
                  'transition hover:bg-slate-50',
                  row.isGrand ? 'bg-slate-100' : row.isTotal ? 'bg-slate-50' : 'bg-white',
                  getManagementTotalRowClass(row.name)
                )}
              >
                <td className={cn('border border-slate-200 px-4 py-3 text-sm font-black text-slate-950', row.isGrand && 'text-[var(--dashboard-action-bg)]')}>{row.name}</td>
                <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-slate-950">{formatter(row.values.td.cy)}</td>
                {(['mtd', 'qtd', 'ytd'] as PeriodKey[]).map((period) => (
                  <React.Fragment key={`${row.name}-${period}`}>
                    <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-black text-slate-950">{formatter(row.values[period].cy)}</td>
                    <td className="border border-slate-200 px-4 py-3 text-center font-mono text-sm font-bold text-slate-500">{row.values[period].ly === 'N/A' ? 'N/A' : formatter(row.values[period].ly)}</td>
                    <td className="border border-slate-200 px-4 py-3 text-center">{renderGrowth(row.values[period].growth)}</td>
                  </React.Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RoBillingOverviewTrend({
  trend,
  metric,
  onMetricChange,
}: {
  trend: ROAnalysisTrendPoint[]
  metric: ROAnalysisType
  onMetricChange: (metric: ROAnalysisType) => void
}) {
  const isMoneyMetric = metric !== 'load'
  const dailyTarget = trend.length > 0 ? (trend.reduce((sum, item) => sum + Number(item.ly || 0), 0) * 1.1) / trend.length : 0
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Trend</p>
          <h3 className="mt-1 text-xl font-black tracking-tight text-slate-950">RO Billing Daily Trend</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {RO_ANALYSIS_TYPES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onMetricChange(item)}
              className={cn(
                'flex items-center gap-2 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition',
                metric === item ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              {item === 'load' ? <Activity className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
              {RO_ANALYSIS_LABELS[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {trend.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">
            No trend data available for the selected period.
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-end gap-5 text-[10px] font-bold text-slate-600">
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-[#0B5D7A] bg-white" />Current Year (CY)</span>
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-amber-600 bg-white" />Last Year (LY)</span>
              <span className="inline-flex items-center gap-2"><span className="h-0.5 w-6 border-t border-dashed border-rose-600" />Target</span>
            </div>
            <div className="h-[360px] rounded-2xl bg-slate-50 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 28, right: 28, bottom: 10, left: 18 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" interval={0} minTickGap={0} tick={{ fontSize: 9, fontWeight: 900, fill: '#64748b' }} tickMargin={12} height={48} />
                  <YAxis tickFormatter={(value) => isMoneyMetric ? formatCompact(Number(value || 0)) : formatNumber(Number(value || 0))} tick={{ fontSize: 10, fontWeight: 800, fill: '#94a3b8' }} width={60} />
                  <Tooltip
                    formatter={(value, name) => [
                      isMoneyMetric ? formatCurrency(Number(value || 0)) : formatNumber(Number(value || 0)),
                      String(name).toLowerCase() === 'cy' || String(name).includes('Current') ? 'Current Year (CY)' : 'Last Year (LY)'
                    ]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''}
                    contentStyle={tooltipStyle}
                  />
                  {dailyTarget > 0 && (
                    <ReferenceLine y={dailyTarget} stroke="#e11d48" strokeDasharray="5 5" label={{ position: 'right', value: 'Target', fill: '#e11d48', fontSize: 10, fontWeight: 900 }} />
                  )}
                  <Line type="monotone" dataKey="cy" name="Current Year (CY)" stroke="#0B5D7A" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false}>
                    <LabelList dataKey="cy" position="top" offset={10} formatter={(value) => isMoneyMetric ? formatCompact(Number(value || 0)) : formatNumber(Number(value || 0))} fill="#0B5D7A" fontSize={10} fontWeight={900} />
                  </Line>
                  <Line type="monotone" dataKey="ly" name="Last Year (LY)" stroke="#D97706" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false}>
                    <LabelList dataKey="ly" position="top" offset={10} formatter={(value) => isMoneyMetric ? formatCompact(Number(value || 0)) : formatNumber(Number(value || 0))} fill="#D97706" fontSize={10} fontWeight={900} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ChartShell({
  eyebrow,
  title,
  caption,
  children,
  onExpand,
}: {
  eyebrow: string
  title: string
  caption?: string
  children: React.ReactNode
  onExpand: () => void
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">{eyebrow}</p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{title}</h3>
          {caption && <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{caption}</p>}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onExpand}
          className="h-9 w-9 rounded-xl border border-teal-200 bg-white text-teal-700 shadow-sm hover:bg-teal-50"
          title={`Maximise ${title}`}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="h-72 min-h-0 rounded-2xl bg-slate-50 p-3">{children}</div>
    </div>
  )
}

function ChartNoData({ message = 'No Data Available' }: { message?: string }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 text-center">
      <div>
        <p className="text-sm font-black text-slate-700">{message}</p>
        <p className="mt-1 text-xs font-semibold text-slate-400">Try a wider date range or clear comparison dates.</p>
      </div>
    </div>
  )
}

function hasChartValues<T extends object>(rows: T[] | undefined, keys: string[]) {
  return Boolean(rows?.some((row) => {
    const record = row as Record<string, unknown>
    return keys.some((key) => Number(record[key] || 0) !== 0)
  }))
}

function preferChartRows<T>(secondaryRows: T[] | undefined, summaryRows: T[] | undefined) {
  return secondaryRows && secondaryRows.length > 0 ? secondaryRows : summaryRows || []
}

export function BusinessExcellenceOverview({ dateFilter, dealerCode }: { dateFilter: BusinessDateFilter; dealerCode?: string | null }) {
  const detailedAnalysisRef = useRef<HTMLDivElement | null>(null)
  const [loadDetailedAnalysis, setLoadDetailedAnalysis] = useState(false)
  const [expandedChart, setExpandedChart] = useState<{ id: string; title: string } | null>(null)
  const [billingTrendMetric, setBillingTrendMetric] = useState<ROAnalysisType>('load')
  const [serviceTypeMetric, setServiceTypeMetric] = useState<ROAnalysisType>('load')
  const [healthDialogOpen, setHealthDialogOpen] = useState(false)
  const range = useMemo(() => getDateRange(dateFilter), [dateFilter])
  const queryString = useMemo(() => {
    const params = new URLSearchParams(range)
    appendBusinessComparisonParams(params, dateFilter)
    appendKiaDealerCodeParam(params, dealerCode)
    return params.toString()
  }, [dateFilter, dealerCode, range])
  const summaryQueryString = useMemo(() => withChunk(queryString, 'summary'), [queryString])
  const secondaryQueryString = useMemo(() => withChunk(queryString, 'secondary'), [queryString])
  const roAnalysisTableQueryString = useMemo(() => buildRoAnalysisQueryString('table', range, dateFilter, dealerCode), [dateFilter, dealerCode, range])
  const roAnalysisTrendQueryString = useMemo(() => buildRoAnalysisQueryString('trend', range, dateFilter, dealerCode), [dateFilter, dealerCode, range])

  const { data: summaryData, isLoading, error } = useQuery<OverviewData, Error>({
    queryKey: ['business-excellence', 'overview', summaryQueryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/platinum/business-excellence/overview?${summaryQueryString}`)
      logApiTimings(response, 'business-excellence-overview')
      return await readPlatinumJson<OverviewData>(response, 'Business Excellence overview')
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  })

  const { data: secondaryData } = useQuery<OverviewData, Error>({
    queryKey: ['business-excellence', 'overview', secondaryQueryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/platinum/business-excellence/overview?${secondaryQueryString}`)
      logApiTimings(response, 'business-excellence-overview-secondary')
      return await readPlatinumJson<OverviewData>(response, 'Business Excellence overview details')
    },
    enabled: Boolean(summaryData) && loadDetailedAnalysis,
    staleTime: DASHBOARD_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  })

  const { data: roAnalysisTableData, isLoading: isRoAnalysisTableLoading } = useQuery<ROAnalysisResponse, Error>({
    queryKey: ['business-excellence', 'overview-ro-billing-analysis-table', roAnalysisTableQueryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/platinum/business-excellence/ro-billing-analysis?${roAnalysisTableQueryString}`)
      logApiTimings(response, 'overview-ro-billing-analysis-table')
      return await readPlatinumJson<ROAnalysisResponse>(response, 'Overview RO Billing matrix')
    },
    enabled: Boolean(summaryData) && loadDetailedAnalysis,
    staleTime: DASHBOARD_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  })

  const { data: roAnalysisTrendData, isLoading: isRoAnalysisTrendLoading } = useQuery<ROAnalysisResponse, Error>({
    queryKey: ['business-excellence', 'overview-ro-billing-analysis-trend', roAnalysisTrendQueryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/platinum/business-excellence/ro-billing-analysis?${roAnalysisTrendQueryString}`)
      logApiTimings(response, 'overview-ro-billing-analysis-trend')
      return await readPlatinumJson<ROAnalysisResponse>(response, 'Overview RO Billing trend')
    },
    enabled: Boolean(summaryData) && loadDetailedAnalysis,
    staleTime: DASHBOARD_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  })

  useEffect(() => {
    const target = detailedAnalysisRef.current
    if (!target || loadDetailedAnalysis) return

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      setLoadDetailedAnalysis(true)
      observer.disconnect()
    }, { rootMargin: '500px 0px' })

    observer.observe(target)
    return () => observer.disconnect()
  }, [loadDetailedAnalysis, summaryData])

  const data = useMemo<OverviewData | undefined>(() => {
    if (!summaryData) return undefined
    if (!secondaryData) return summaryData

    return {
      ...summaryData,
      kpis: secondaryData.kpis || summaryData.kpis,
      workshopSnapshot: secondaryData.workshopSnapshot || summaryData.workshopSnapshot,
      comparison: secondaryData.comparison || summaryData.comparison,
      charts: {
        ...summaryData.charts,
        revenueTrend: preferChartRows(secondaryData.charts.revenueTrend, summaryData.charts.revenueTrend),
        serviceMix: preferChartRows(secondaryData.charts.serviceMix, summaryData.charts.serviceMix),
        advisorRevenue: preferChartRows(secondaryData.charts.advisorRevenue, summaryData.charts.advisorRevenue),
        agingDistribution: preferChartRows(secondaryData.charts.agingDistribution, summaryData.charts.agingDistribution),
        openRoAdvisorLoad: preferChartRows(secondaryData.charts.openRoAdvisorLoad, summaryData.charts.openRoAdvisorLoad),
        openRoWorkType: preferChartRows(secondaryData.charts.openRoWorkType, summaryData.charts.openRoWorkType),
        complaintAreas: preferChartRows(secondaryData.charts.complaintAreas, summaryData.charts.complaintAreas),
        complaintStatus: preferChartRows(secondaryData.charts.complaintStatus, summaryData.charts.complaintStatus),
        complaintMonthlyComparison: preferChartRows(secondaryData.charts.complaintMonthlyComparison, summaryData.charts.complaintMonthlyComparison),
      },
      meta: {
        ...summaryData.meta,
        ...secondaryData.meta,
        sourceCoverage: {
          ...summaryData.meta.sourceCoverage,
          ...secondaryData.meta.sourceCoverage,
        },
      },
    }
  }, [summaryData, secondaryData])

  const renderChart = (chartId: string) => {
    if (!data) return null

    if (chartId === 'revenue') {
      const weeklyBillingTrend = buildWeeklyBillingTrend(data.charts.revenueTrend, range.startDate)
      if (!hasChartValues(weeklyBillingTrend, ['revenue', 'totalJc'])) {
        return <ChartNoData />
      }

      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={weeklyBillingTrend} margin={{ top: 26, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" interval={0} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis yAxisId="left" tickFormatter={formatCompact} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fontWeight: 800, fill: '#023468' }} />
            <Tooltip
              formatter={(value, name) => [
                name === 'Revenue'
                  ? formatCurrency(Number(value || 0))
                  : formatNumber(Number(value || 0)),
                String(name),
              ]}
              contentStyle={tooltipStyle}
            />
            <Legend />
            <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#2563eb" radius={[10, 10, 0, 0]} maxBarSize={62} isAnimationActive={false}>
              <LabelList dataKey="revenue" position="top" formatter={(value) => formatCompact(Number(value || 0))} fill="#2563eb" fontSize={10} fontWeight={900} />
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="totalJc" name="Closed RO" stroke="#023468" strokeWidth={3} dot={{ r: 4, fill: '#ffffff', strokeWidth: 2 }} isAnimationActive={false}>
              <LabelList dataKey="totalJc" position="top" offset={10} formatter={(value) => formatNumber(Number(value || 0))} fill="#023468" fontSize={10} fontWeight={900} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'serviceMix') {
      if (!hasChartValues(data.charts.serviceMix, ['totalJc', 'revenue'])) {
        return <ChartNoData />
      }

      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.charts.serviceMix} layout="vertical" margin={{ top: 5, right: 24, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tickFormatter={formatCompact} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fontWeight: 900, fill: '#0f172a' }} />
            <Tooltip formatter={(value, name) => [name === 'revenue' ? formatCurrency(Number(value || 0)) : formatNumber(Number(value || 0)), String(name)]} contentStyle={tooltipStyle} />
            <Legend />
            <Bar dataKey="totalJc" name="JC" fill="#023468" radius={[0, 8, 8, 0]} />
            <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[0, 8, 8, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'aging') {
      if (!hasChartValues(data.charts.agingDistribution, ['count'])) {
        return <ChartNoData />
      }

      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.charts.agingDistribution} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fontWeight: 900, fill: '#0f172a' }} />
            <YAxis tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" name="Open RO" radius={[10, 10, 0, 0]}>
              {data.charts.agingDistribution.map((_, index) => <Cell key={index} fill={['#00e97e', '#f59e0b', '#f97316', '#e11d48'][index] || '#023468'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'complaints') {
      if (!hasChartValues(data.charts.complaintAreas, ['total', 'open'])) {
        return <ChartNoData />
      }

      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.charts.complaintAreas} layout="vertical" margin={{ top: 5, right: 24, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis type="category" dataKey="name" width={122} tick={{ fontSize: 10, fontWeight: 900, fill: '#0f172a' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            <Bar dataKey="total" name="Total" fill="#2563eb" radius={[0, 8, 8, 0]} />
            <Bar dataKey="open" name="Open" fill="#e11d48" radius={[0, 8, 8, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )
    }

    if (chartId === 'complaintTrend') {
      if (!hasChartValues(data.charts.complaintMonthlyComparison, ['cyCount', 'lyCount'])) {
        return <ChartNoData />
      }

      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.charts.complaintMonthlyComparison} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            <Area type="monotone" dataKey="cyCount" name="Current Year" stroke="#2563eb" fill="#dbeafe" strokeWidth={3} />
            <Area type="monotone" dataKey="lyCount" name="Last Year" stroke="#f97316" fill="#ffedd5" strokeWidth={3} />
          </AreaChart>
        </ResponsiveContainer>
      )
    }

    if (!hasChartValues(data.charts.addOnMix, ['value'])) {
      return <ChartNoData />
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Pie data={data.charts.addOnMix} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={4}>
            {data.charts.addOnMix.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
          </Pie>
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  if (isLoading) return <OverviewSkeleton />

  if (error || !data) {
    return (
      <div className="p-4">
        <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          {error?.message || 'Business Excellence overview is not available right now.'}
        </div>
      </div>
    )
  }

  const latestBillingDate = formatDisplayDate(data.meta.sourceCoverage?.roBilling?.maxDate)
  const vasTileValue = data.workshopSnapshot.vasAvailable === false
    ? 'Unavailable'
    : formatCurrency(data.workshopSnapshot.vasAmount)
  const vasMetric = data.comparison?.workshopVasAmount
  const vasTileMeta = data.workshopSnapshot.vasAvailable === false
    ? 'No KIA-style period source'
    : [
      data.workshopSnapshot.vasPeriodEnd
        ? `Source through ${formatDisplayDate(data.workshopSnapshot.vasPeriodEnd)}`
        : 'Value added services',
      vasMetric?.comparisonStatus === 'period_mismatch' && vasMetric.lyPeriodStart && vasMetric.lyPeriodEnd
        ? `LY source: ${formatDisplayDate(vasMetric.lyPeriodStart)} – ${formatDisplayDate(vasMetric.lyPeriodEnd)}`
        : null,
    ].filter(Boolean).join(' · ')
  const periodLabel = `${formatDisplayDate(range.startDate)} - ${formatDisplayDate(range.endDate)}`
  const lyPeriodLabel = data.comparison
    ? `${formatDisplayDate(data.comparison.lyRange.startDate)} - ${formatDisplayDate(data.comparison.lyRange.endDate)}`
    : 'Loading LY'
  const labourPerVehicle = safeDivide(data.kpis.labour, data.kpis.totalJc)
  const partsPerVehicle = safeDivide(data.kpis.parts, data.kpis.totalJc)
  const lyJc = data.comparison?.totalJc.ly || 0
  const labourShare = data.kpis.revenue > 0 ? (data.kpis.labour / data.kpis.revenue) * 100 : 0
  const partsShare = data.kpis.revenue > 0 ? (data.kpis.parts / data.kpis.revenue) * 100 : 0
  const lyRevenue = data.comparison?.revenue.ly || 0
  const lyLabourShare = lyRevenue > 0 ? ((data.comparison?.labour.ly || 0) / lyRevenue) * 100 : 0
  const lyPartsShare = lyRevenue > 0 ? ((data.comparison?.parts.ly || 0) / lyRevenue) * 100 : 0
  const wipRiskCount = data.kpis.delayedRo + data.kpis.openOver15
  const wipRiskRate = data.kpis.openRo > 0 ? (wipRiskCount / data.kpis.openRo) * 100 : 0
  const lyWipRiskCount = (data.comparison?.delayedRo.ly || 0) + (data.comparison?.openOver15.ly || 0)
  const hasComplaintClosureData = data.kpis.complaintsTotal > 0
  const complaintClosureRate = hasComplaintClosureData ? (data.kpis.complaintsClosed / data.kpis.complaintsTotal) * 100 : null
  const lyComplaintClosed = Math.max(0, (data.comparison?.complaintsTotal.ly || 0) - (data.comparison?.complaintsOpen.ly || 0))
  const lyComplaintClosureRate = (data.comparison?.complaintsTotal.ly || 0) > 0 ? (lyComplaintClosed / (data.comparison?.complaintsTotal.ly || 1)) * 100 : 0
  const addOnTotal = data.kpis.ewCount + data.kpis.rsaCount
  const addOnPer100Jc = data.kpis.addOnPerJc * 100
  const lyAddOnTotal = data.comparison ? data.comparison.ewCount.ly + data.comparison.rsaCount.ly : 0
  const lyAddOnPer100Jc = safeDivide(lyAddOnTotal, lyJc) * 100
  const accidentOpenShare = data.kpis.openRo > 0 ? (data.kpis.accidentOpenJobs / data.kpis.openRo) * 100 : 0
  const roBillingRows = [
    { metric: 'Revenue', cy: formatCurrency(data.comparison?.revenue.cy ?? data.kpis.revenue), ly: data.comparison ? formatCurrency(data.comparison.revenue.ly) : 'Loading', growth: data.comparison ? data.comparison.revenue.deltaPct : null },
    { metric: 'Load / JC', cy: formatNumber(data.comparison?.totalJc.cy ?? data.kpis.totalJc), ly: data.comparison ? formatNumber(data.comparison.totalJc.ly) : 'Loading', growth: data.comparison ? data.comparison.totalJc.deltaPct : null },
    { metric: 'Labour Revenue', cy: formatCurrency(data.comparison?.labour.cy ?? data.kpis.labour), ly: data.comparison ? formatCurrency(data.comparison.labour.ly) : 'Loading', growth: data.comparison ? data.comparison.labour.deltaPct : null },
    { metric: 'Parts Revenue', cy: formatCurrency(data.comparison?.parts.cy ?? data.kpis.parts), ly: data.comparison ? formatCurrency(data.comparison.parts.ly) : 'Loading', growth: data.comparison ? data.comparison.parts.deltaPct : null },
    { metric: 'Average Billing', cy: formatCurrency(data.comparison?.avgBilling.cy ?? data.kpis.avgBilling), ly: data.comparison ? formatCurrency(data.comparison.avgBilling.ly) : 'Loading', growth: data.comparison ? data.comparison.avgBilling.deltaPct : null },
    { metric: 'Labour / Vehicle', cy: formatCurrency(data.comparison?.labourPerVehicle.cy ?? labourPerVehicle), ly: data.comparison ? formatCurrency(data.comparison.labourPerVehicle.ly) : 'Loading', growth: data.comparison ? data.comparison.labourPerVehicle.deltaPct : null },
    { metric: 'Parts / Vehicle', cy: formatCurrency(data.comparison?.partsPerVehicle.cy ?? partsPerVehicle), ly: data.comparison ? formatCurrency(data.comparison.partsPerVehicle.ly) : 'Loading', growth: data.comparison ? data.comparison.partsPerVehicle.deltaPct : null },
    { metric: 'Labour %', cy: `${labourShare.toFixed(1)}%`, ly: data.comparison ? `${lyLabourShare.toFixed(1)}%` : 'Loading', growth: data.comparison ? growthFromValues(labourShare, lyLabourShare) : null },
    { metric: 'Parts %', cy: `${partsShare.toFixed(1)}%`, ly: data.comparison ? `${lyPartsShare.toFixed(1)}%` : 'Loading', growth: data.comparison ? growthFromValues(partsShare, lyPartsShare) : null },
  ]
  const detailedRoRows = buildDetailedRoRows(roAnalysisTableData)
  const serviceRowsByMetric = buildServiceTypeRowsByMetric(roAnalysisTableData)
  const roBillingTrendRows = getMetricTrend(roAnalysisTrendData, billingTrendMetric)
  const snapshotHealth = buildBusinessSnapshotHealth(data)
  const primaryCoverage = data.meta.dealerCoverage?.primary
  const hasSelectedRoBillingData = primaryCoverage?.hasDataInRange !== false
  const noScoreReason = primaryCoverage && !primaryCoverage.hasDataInRange
    ? `No ${getPlatinumBranchLabel(primaryCoverage.dealerCode)} RO Billing rows in this date range.`
    : 'No selected-range RO Billing data.'
  const lySnapshotRevenue = data.comparison?.revenue.ly || 0
  const workshopGrowth = data.comparison?.workshopRevenue.deltaPct ?? null
  const executiveCards = [
    {
      title: 'Workshop Performance',
      cy: formatCurrency(data.workshopSnapshot.totalRevenue),
      ly: data.comparison ? formatCurrency(data.comparison.workshopRevenue.ly) : 'Loading',
      growth: workshopGrowth,
      status: workshopGrowth === null ? 'NO COMPARISON' : workshopGrowth >= 0 ? 'GOOD' : 'WATCH',
    },
    {
      title: 'Open RO',
      cy: formatNumber(data.kpis.openRo),
      ly: data.comparison ? comparisonText(data.comparison.openRo) : 'Loading',
      growth: null,
      status: data.kpis.openOver15 > 0 ? 'WATCH' : 'GOOD',
      positiveIsGood: false,
    },
    {
      title: 'Complaints',
      cy: formatNumber(data.kpis.complaintsTotal),
      ly: data.comparison ? formatNumber(data.comparison.complaintsTotal.ly) : 'Loading',
      growth: data.comparison ? data.comparison.complaintsTotal.deltaPct : null,
      status: (() => {
        const growthValue = data.comparison?.complaintsTotal.deltaPct ?? null
        if (data.kpis.complaintsOpen > 0 || (growthValue !== null && growthValue >= 200)) return 'CRITICAL'
        if (growthValue !== null && growthValue > 0) return 'WATCH'
        return 'GOOD'
      })(),
      positiveIsGood: false,
    },
    {
      title: 'Add-ons',
      cy: formatNumber(data.kpis.ewCount + data.kpis.rsaCount),
      ly: data.comparison ? formatNumber(data.comparison.ewCount.ly + data.comparison.rsaCount.ly) : 'Loading',
      growth: data.comparison ? growthFromValues(
        data.kpis.ewCount + data.kpis.rsaCount,
        data.comparison.ewCount.ly + data.comparison.rsaCount.ly
      ) : null,
      status: 'TRACK',
    },
  ]

  return (
    <div className="space-y-4 p-4">
      <section className="rounded-[1.5rem] border border-[#b9ccde] bg-white/85 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-teal-700 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">MD View</span>
              <span className="rounded-full border border-teal-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-700">CY {periodLabel}</span>
              <span className="rounded-full border border-blue-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-700">LY {lyPeriodLabel}</span>
              <span className={cn(
                'rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                !hasSelectedRoBillingData || snapshotHealth.overallGrowth === null
                  ? 'border-slate-200 bg-white text-slate-500'
                  : snapshotHealth.overallGrowth >= 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              )}>
                Overall {!hasSelectedRoBillingData || snapshotHealth.overallGrowth === null ? 'N/A' : formatDelta(snapshotHealth.overallGrowth)}
              </span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">Business Snapshot</h2>
          </div>
          <div className="grid gap-2 text-[9px] font-black uppercase tracking-widest sm:grid-cols-2">
            <span className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-blue-700">Billing {latestBillingDate}</span>
            <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-600">Executive KPI View</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {hasSelectedRoBillingData ? (
            <BusinessHealthCard
              health={snapshotHealth}
              cyRevenue={data.kpis.revenue}
              lyRevenue={lySnapshotRevenue}
              onClick={() => setHealthDialogOpen(true)}
            />
          ) : (
            <BusinessHealthNoScoreCard reason={noScoreReason} />
          )}
          <SnapshotTile
              icon={TrendingUp}
              label="Revenue"
              value={formatCurrency(data.kpis.revenue)}
              meta={`Through ${latestBillingDate}`}
              comparison={{
                lyText: comparisonText(data.comparison?.revenue, formatCurrency),
                deltaText: deltaText(data.comparison?.revenue),
                deltaPct: data.comparison?.revenue.deltaPct || 0,
              }}
              tone="good"
            />
          <SnapshotTile
              icon={ShieldCheck}
              label="Labour Revenue"
              value={formatCurrency(data.kpis.labour)}
              meta={`${labourShare.toFixed(1)}% of revenue`}
              comparison={{
                lyText: comparisonText(data.comparison?.labour, formatCurrency),
                deltaText: deltaText(data.comparison?.labour),
                deltaPct: data.comparison?.labour.deltaPct || 0,
              }}
              tone="neutral"
            />
          <SnapshotTile
              icon={Wrench}
              label="Parts Revenue"
              value={formatCurrency(data.kpis.parts)}
              meta={`${partsShare.toFixed(1)}% of revenue`}
              comparison={{
                lyText: comparisonText(data.comparison?.parts, formatCurrency),
                deltaText: deltaText(data.comparison?.parts),
                deltaPct: data.comparison?.parts.deltaPct || 0,
              }}
              tone="neutral"
            />
          <SnapshotTile
              icon={TrendingUp}
              label="Load / JC"
              value={formatNumber(data.kpis.totalJc)}
              meta="Closed repair orders"
              comparison={{
                lyText: comparisonText(data.comparison?.totalJc),
                deltaText: deltaText(data.comparison?.totalJc),
                deltaPct: data.comparison?.totalJc.deltaPct || 0,
              }}
              tone="neutral"
            />
          <SnapshotTile
              icon={ShieldCheck}
              label="Average Billing"
              value={formatCurrency(data.kpis.avgBilling)}
              meta="Revenue per closed RO"
              comparison={{
                lyText: comparisonText(data.comparison?.avgBilling, formatCurrency),
                deltaText: deltaText(data.comparison?.avgBilling),
                deltaPct: data.comparison?.avgBilling.deltaPct || 0,
              }}
              tone="neutral"
            />
          <SnapshotTile
              icon={Wrench}
              label="Labour / Vehicle"
              value={formatCurrency(labourPerVehicle)}
              meta="Labour earned per RO"
              comparison={{
                lyText: comparisonText(data.comparison?.labourPerVehicle, formatCurrency),
                deltaText: deltaText(data.comparison?.labourPerVehicle),
                deltaPct: data.comparison?.labourPerVehicle.deltaPct || 0,
              }}
              tone="neutral"
            />
          <SnapshotTile
              icon={Wrench}
              label="Parts / Vehicle"
              value={formatCurrency(partsPerVehicle)}
              meta="Parts earned per RO"
              comparison={{
                lyText: comparisonText(data.comparison?.partsPerVehicle, formatCurrency),
                deltaText: deltaText(data.comparison?.partsPerVehicle),
                deltaPct: data.comparison?.partsPerVehicle.deltaPct || 0,
              }}
              tone="neutral"
            />
          <SnapshotTile
              icon={Wrench}
              label="VAS Revenue"
              value={vasTileValue}
              meta={vasTileMeta}
              comparison={{
                lyText: comparisonText(data.comparison?.workshopVasAmount, formatCurrency),
                deltaText: deltaText(data.comparison?.workshopVasAmount),
                deltaPct: data.comparison?.workshopVasAmount.deltaPct ?? null,
              }}
              tone="watch"
            />
          <SnapshotTile
              icon={MessageSquareWarning}
              label="Open RO"
              value={formatNumber(data.kpis.openRo)}
              meta={`${formatNumber(data.kpis.delayedRo)} delayed / ${formatNumber(data.kpis.openOver15)} over 15D`}
              comparison={{
                lyText: comparisonText(data.comparison?.openRo),
                deltaText: deltaText(data.comparison?.openRo),
                deltaPct: data.comparison?.openRo.deltaPct ?? null,
              }}
              positiveIsGood={false}
              tone={data.kpis.openOver15 > 0 ? 'watch' : 'good'}
            />
          <SnapshotTile
              icon={MessageSquareWarning}
              label="WIP Risk"
              value={formatNumber(wipRiskCount)}
              meta={`${wipRiskRate.toFixed(1)}% of open RO needs attention`}
              comparison={{
                lyText: data.comparison?.openRo.comparisonStatus === 'not_comparable' ? 'Current WIP only' : `LY ${formatNumber(lyWipRiskCount)}`,
                deltaText: data.comparison?.openRo.comparisonStatus === 'not_comparable' ? 'No LY WIP snapshot' : (growthFromValues(wipRiskCount, lyWipRiskCount) === null ? (wipRiskCount > 0 ? 'New vs LY' : 'Flat vs LY') : `${formatDelta(growthFromValues(wipRiskCount, lyWipRiskCount) || 0)} vs LY`),
                deltaPct: data.comparison?.openRo.comparisonStatus === 'not_comparable' ? null : (growthFromValues(wipRiskCount, lyWipRiskCount) || 0),
              }}
              positiveIsGood={false}
              tone={wipRiskCount > 0 ? 'risk' : 'good'}
            />
          <SnapshotTile
              icon={ShieldCheck}
              label="Complaint Closure"
              value={hasComplaintClosureData ? `${complaintClosureRate!.toFixed(1)}%` : 'N/A'}
              meta={hasComplaintClosureData ? `${formatNumber(data.kpis.complaintsClosed)} closed / ${formatNumber(data.kpis.complaintsTotal)} total` : 'No complaints'}
              comparison={{
                lyText: !hasComplaintClosureData
                  ? 'No complaints'
                  : data.comparison && (data.comparison.complaintsTotal.ly || 0) > 0
                    ? `LY ${lyComplaintClosureRate.toFixed(1)}%`
                    : (data.comparison ? 'LY 0 total' : 'LY loading'),
                deltaText: !hasComplaintClosureData
                  ? 'No complaints'
                  : data.comparison && (data.comparison.complaintsTotal.ly || 0) > 0
                    ? `${formatDelta(growthFromValues(complaintClosureRate!, lyComplaintClosureRate) || 0)} vs LY`
                    : deltaText(data.comparison?.complaintsTotal),
                deltaPct: !hasComplaintClosureData
                  ? null
                  : data.comparison && (data.comparison.complaintsTotal.ly || 0) > 0
                    ? (growthFromValues(complaintClosureRate!, lyComplaintClosureRate) || 0)
                    : (data.comparison?.complaintsTotal.deltaPct ?? null),
              }}
              tone={!hasComplaintClosureData ? 'neutral' : data.kpis.complaintsOpen > 0 ? 'watch' : 'good'}
            />
          <SnapshotTile
              icon={Activity}
              label="Add-on Penetration"
              value={`${addOnPer100Jc.toFixed(1)}/100 JC`}
              meta={`${formatNumber(addOnTotal)} add-ons sold`}
              comparison={{
                lyText: data.comparison ? `LY ${lyAddOnPer100Jc.toFixed(1)}/100` : 'LY loading',
                deltaText: data.comparison ? (growthFromValues(addOnPer100Jc, lyAddOnPer100Jc) === null ? (addOnPer100Jc > 0 ? 'New vs LY' : 'Flat vs LY') : `${formatDelta(growthFromValues(addOnPer100Jc, lyAddOnPer100Jc) || 0)} vs LY`) : 'vs LY',
                deltaPct: data.comparison ? (growthFromValues(addOnPer100Jc, lyAddOnPer100Jc) ?? (addOnPer100Jc > 0 ? 100 : 0)) : null,
              }}
              tone={addOnTotal > 0 ? 'good' : 'watch'}
            />
          <SnapshotTile
              icon={Wrench}
              label="Accident WIP"
              value={formatNumber(data.kpis.accidentOpenJobs)}
              meta={`${accidentOpenShare.toFixed(1)}% of current open RO`}
              tone={data.kpis.accidentOpenJobs > 0 ? 'watch' : 'good'}
            />
        </div>

      </section>

      <Dialog open={healthDialogOpen} onOpenChange={setHealthDialogOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-2xl">
          <DialogHeader className="shrink-0 border-b border-slate-100 bg-slate-950 p-5 text-white">
            <DialogTitle className="text-2xl font-black tracking-tight text-white">Business Snapshot Health Score</DialogTitle>
            <DialogDescription className="text-sm font-semibold text-slate-300">
              Score is calculated from current snapshot performance, LY comparison growth, and operating risk signals.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Score</p>
                <p className="mt-2 text-4xl font-black text-slate-950">{snapshotHealth.score}<span className="text-sm text-slate-400"> / 100</span></p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</p>
                <p className="mt-2 text-xl font-black text-slate-950">{snapshotHealth.status}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">CY Revenue</p>
                <p className="mt-2 text-xl font-black text-slate-950">{formatCurrency(data.kpis.revenue)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">LY Revenue</p>
                <p className="mt-2 text-xl font-black text-slate-950">{formatCurrency(lySnapshotRevenue)}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Positive Drivers</p>
                <div className="mt-3 space-y-2">
                  {snapshotHealth.positiveDrivers.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl bg-white/75 px-3 py-2 text-xs font-black text-slate-800">
                      <span>{item.label}</span>
                      <span>{item.score}/100</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Negative Drivers</p>
                <div className="mt-3 space-y-2">
                  {snapshotHealth.negativeDrivers.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl bg-white/75 px-3 py-2 text-xs font-black text-slate-800">
                      <span>{item.label}</span>
                      <span>{item.score}/100</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[680px] border-collapse">
                <thead className="bg-slate-950 text-white">
                  <tr>
                    {['Factor', 'Weight', 'Score', 'Current Signal'].map((heading) => (
                      <th key={heading} className="border border-slate-800 px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshotHealth.components.map((item) => (
                    <tr key={item.label} className="bg-white">
                      <td className="border border-slate-200 px-4 py-3 text-sm font-black text-slate-950">{item.label}</td>
                      <td className="border border-slate-200 px-4 py-3 font-mono text-sm font-black text-slate-700">{item.weight}%</td>
                      <td className="border border-slate-200 px-4 py-3 font-mono text-sm font-black text-slate-950">{item.score}/100</td>
                      <td className="border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600">{item.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div ref={detailedAnalysisRef}>
        <RoBillingPerformanceTable rows={roBillingRows} />
      </div>

      {!loadDetailedAnalysis || isRoAnalysisTableLoading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
      ) : (
        <DetailedRoBillingMatrix rows={detailedRoRows} />
      )}

      {!loadDetailedAnalysis || isRoAnalysisTableLoading ? (
        <div className="h-80 animate-pulse rounded-2xl bg-slate-100" />
      ) : (
        <ServiceTypeRoBillingTable
          rows={serviceRowsByMetric[serviceTypeMetric]}
          metric={serviceTypeMetric}
          onMetricChange={setServiceTypeMetric}
        />
      )}

      {!loadDetailedAnalysis || isRoAnalysisTrendLoading ? (
        <div className="h-[460px] animate-pulse rounded-2xl bg-slate-100" />
      ) : (
        <RoBillingOverviewTrend
          trend={roBillingTrendRows}
          metric={billingTrendMetric}
          onMetricChange={setBillingTrendMetric}
        />
      )}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {executiveCards.map((card) => (
          <MiniBusinessCard key={card.title} {...card} />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartShell eyebrow="Trend" title="Revenue Trend" caption="Primary business movement across the selected period." onExpand={() => setExpandedChart({ id: 'revenue', title: 'Revenue Trend' })}>
          {renderChart('revenue')}
        </ChartShell>
        <ChartShell eyebrow="Growth" title="Revenue By Service Mix" caption="Major billing contributors only; no operational clutter." onExpand={() => setExpandedChart({ id: 'serviceMix', title: 'Revenue By Service Mix' })}>
          {renderChart('serviceMix')}
        </ChartShell>
        <ChartShell eyebrow="Customer" title="Complaint Movement" caption="High-level customer voice movement for management." onExpand={() => setExpandedChart({ id: 'complaintTrend', title: 'Complaint Movement' })}>
          {renderChart('complaintTrend')}
        </ChartShell>
      </div>

      {expandedChart && (
        <div className="fixed inset-0 z-[90] bg-slate-950/50 p-4 backdrop-blur-sm md:p-6">
          <div className="expanded-chart-shell flex h-full w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl" style={{ backgroundColor: '#ffffff' }}>
            <div className="expanded-chart-header flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3" style={{ backgroundColor: '#ffffff' }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Expanded Business Excellence Chart</p>
                <h3 className="text-xl font-black tracking-tight text-slate-950">{expandedChart.title}</h3>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={() => setExpandedChart(null)} className="h-10 w-10 rounded-xl bg-white">
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
    </div>
  )
}

