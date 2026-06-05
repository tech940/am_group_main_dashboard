'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileText,
  LineChart,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react'
import {
  BusinessExcellenceDatePanel,
  BusinessExcellenceHeader,
  BusinessGrowthBadge,
  BusinessMetricButtons,
  BusinessTabButtons,
} from '@/features/business-excellence/shared-ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MainLayout } from '@/components/layout/main-layout'
import { cn } from '@/lib/utils'
import { logApiTimings } from '@/lib/api/client-timing'

export type HyundaiBusinessReport =
  | 'overview'
  | 'executive-dashboard'
  | 'ro-billing-report'
  | 'open-ro'
  | 'workshop-performance'
  | 'hyundai-complaints'

type HyundaiMetric = 'load' | 'labour' | 'parts' | 'lab_per_veh' | 'part_per_veh'
type HyundaiTab = 'table' | 'trend' | 'calendar' | 'fy' | 'analytics' | 'revenue' | 'leaderboard' | 'intelligence'
type HyundaiBranch = 'all' | 'jammu' | 'udhampur'
type SourceStatus = 'live' | 'sample'

type MetricWindow = { cy: number; ly: number; growth: number | null }
type ServiceMetricRow = {
  serviceType: string
  isTotal: boolean
  td: number
  mtd: MetricWindow
  qtd: MetricWindow
  ytd: MetricWindow
}

type BillingAnalysisPayload = {
  meta: {
    source: string
    generatedAt: string
    sourceUpdatedAt: string | null
    filters: {
      startDate: string
      endDate: string
      compareStartDate: string
      compareEndDate: string
      branch: HyundaiBranch
    }
    warning?: string
  }
  summary: {
    load: number
    labour: number
    parts: number
    revenue: number
    averageBilling: number
    labourPerVehicle: number
    partsPerVehicle: number
    discount: number
  }
  comparisonSummary: {
    load: number
    labour: number
    parts: number
    revenue: number
    averageBilling: number
    labourPerVehicle: number
    partsPerVehicle: number
    discount: number
  }
  byMetric: Record<HyundaiMetric, ServiceMetricRow[]>
  trend: {
    metric: HyundaiMetric
    points: Array<{ date: string; label: string; cy: number; ly: number; target: number }>
    stats: {
      monthTarget: number
      mtdTarget: number
      mtdAchieved: number
      shortfallTd: number
      monthlyShortfall: number
      projectedClosing: number
      askingRate: number
    }
  }
  fyTrend: Array<{
    financialYear: string
    load: number
    labour: number
    parts: number
    revenue: number
    labPerVeh: number
    partPerVeh: number
  }>
  leaderboard: Array<{
    advisor: string
    load: number
    labour: number
    parts: number
    revenue: number
  }>
}

type OpenRoPayload = {
  meta: {
    source: string
    generatedAt: string
    sourceUpdatedAt: string | null
    warning?: string
  }
  summary: {
    totalOpenRo: number
    averageAging: number
    delayedRo: number
    over15Days: number
    accidentJobs: number
    runningRepairs: number
  }
  agingRows: Array<{
    serviceType: string
    totalWip: number
    bucket0to4: number
    bucket5to7: number
    bucket8to15: number
    bucketOver15: number
    avgDays: number
    vehicles: Array<{
      roNo: string
      regNo: string
      vin: string
      model: string
      advisor: string
      technician: string
      status: string
      reason: string
      agingDays: number
      agingCategory: string
    }>
  }>
  delaySummary: Array<{
    status: string
    reason: string
    count: number
    mechCount: number
    accidentCount: number
    avgDays: number
  }>
}

type WorkshopPayload = {
  sourceStatus: SourceStatus
  sourceLabel: string
  meta: {
    source: string
    generatedAt: string
    sourceUpdatedAt: string | null
    sourceStatus: SourceStatus
    warning?: string
  }
  kpis: Record<string, { value: number; previous: number; growth: number | null; sourceStatus?: SourceStatus; note?: string }>
  serviceTypeRows: ServiceMetricRow[]
  coreRows: ServiceMetricRow[]
  metricTables: Record<HyundaiMetric, ServiceMetricRow[]>
  dailyTrend: Array<{ date: string; label: string; cy: number; ly: number; target: number }>
  revenue: {
    labourRows: ServiceMetricRow[]
    partsRows: ServiceMetricRow[]
    contribution: { labour: number; parts: number }
  }
  sourceUpdatedAt: string | null
}

type ComplaintsPayload = {
  sourceStatus: SourceStatus
  sourceLabel: string
  meta: {
    generatedAt: string
    sourceUpdatedAt: string | null
    warning?: string
  }
  kpis: {
    total: number
    lyTotal: number
    open: number
    closed: number
    closureRate: number
    averageAging: number
    over7Days: number
    repeatComplaints: number
  }
  movement: Array<{ label: string; cy: number; ly: number }>
  breakdowns: {
    areas: Array<{ name: string; total: number; open: number; avgDays: number }>
    statuses: Array<{ name: string; value: number }>
    models: Array<{ name: string; total: number }>
    sources: Array<{ name: string; total: number }>
  }
  rows: Array<{
    complaintNo: string
    customerName: string
    vehicle: string
    model: string
    area: string
    status: string
    days: number
  }>
}

type IntelligencePayload = {
  sourceStatus: SourceStatus
  sourceLabel: string
  metrics: {
    revenueGrowth: number | null
    labourPerVehicleGrowth: number | null
    partsPerVehicleGrowth: number | null
    load: number
    revenue: number
    alertCounts: { high: number; medium: number; low: number }
  }
  advisorScores: Array<{ advisor: string; score: number; transactions: number; alerts: number; revenue: number }>
  rows: Array<{ type: string; signal: string; value: number | null; severity: string }>
  rules: Array<{ key: string; label: string; description: string }>
}

type AiSummaryPayload = {
  sourceStatus: SourceStatus
  sourceLabel: string
  structuredSummary: {
    title: string
    goodNews: string[]
    badNews: string[]
    immediateActions: string[]
  }
  metrics: Record<string, number>
}

type FreshnessPayload = {
  generatedAt: string
  sources: Array<{ source: string; updatedAt: string | null; configured: boolean }>
}

const REPORTS: Array<{ value: HyundaiBusinessReport; label: string; path: string; supported: boolean }> = [
  { value: 'overview', label: 'Business Excellence Overview', path: '/brands/hyundai/business-excellence/overview', supported: true },
  { value: 'executive-dashboard', label: 'Executive Dashboard', path: '/brands/hyundai/business-excellence/executive-dashboard', supported: true },
  { value: 'ro-billing-report', label: 'RO Billing Report', path: '/brands/hyundai/business-excellence/ro-billing-report', supported: true },
  { value: 'open-ro', label: 'Open RO (Repair Orders)', path: '/brands/hyundai/business-excellence/open-ro', supported: true },
  { value: 'workshop-performance', label: 'Workshop Performance', path: '/brands/hyundai/business-excellence/workshop-performance', supported: true },
  { value: 'hyundai-complaints', label: 'Hyundai Complaints', path: '/brands/hyundai/business-excellence/hyundai-complaints', supported: true },
]

const METRICS: Array<{ value: HyundaiMetric; label: string; icon: ReactNode }> = [
  { value: 'load', label: 'Load', icon: <Activity className="h-3.5 w-3.5" /> },
  { value: 'labour', label: 'Labour', icon: <RefreshCw className="h-3.5 w-3.5" /> },
  { value: 'parts', label: 'Parts', icon: <FileText className="h-3.5 w-3.5" /> },
  { value: 'lab_per_veh', label: 'Lab/Veh', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { value: 'part_per_veh', label: 'Part/Veh', icon: <TrendingUp className="h-3.5 w-3.5" /> },
]

const TABS: Array<{ value: HyundaiTab; label: string; icon: ReactNode }> = [
  { value: 'table', label: 'Table', icon: <FileText className="h-3.5 w-3.5" /> },
  { value: 'trend', label: 'Trend', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { value: 'calendar', label: 'Calendar', icon: <CalendarDays className="h-3.5 w-3.5" /> },
  { value: 'fy', label: 'FY Trends', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { value: 'analytics', label: 'Analytics', icon: <Activity className="h-3.5 w-3.5" /> },
  { value: 'revenue', label: 'Revenue', icon: <LineChart className="h-3.5 w-3.5" /> },
  { value: 'leaderboard', label: 'Leaderboard', icon: <Users className="h-3.5 w-3.5" /> },
  { value: 'intelligence', label: 'Intelligence', icon: <Sparkles className="h-3.5 w-3.5" /> },
]

const BRANCHES: Array<{ value: HyundaiBranch; label: string; helper: string }> = [
  { value: 'all', label: 'All Locations', helper: 'N5216 + N6846 + N6847 + future Udhampur' },
  { value: 'jammu', label: 'Jammu', helper: 'N5216 / N6846 / N6847' },
  { value: 'udhampur', label: 'Udhampur', helper: 'N5217 / N6848 / N6849' },
]

function todayInput() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function monthStart(value: string) {
  return `${value.slice(0, 8)}01`
}

function addYears(value: string, years: number) {
  const [year, month, day] = value.split('-').map(Number)
  const targetYear = year + years
  const daysInMonth = new Date(targetYear, month, 0).getDate()
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, daysInMonth)).padStart(2, '0')}`
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function growth(cy: number, ly: number) {
  return ly ? ((cy - ly) / ly) * 100 : null
}

function formatNumber(value: unknown, decimals = 0) {
  return numberValue(value).toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

function formatCurrency(value: unknown) {
  const amount = numberValue(value)
  const abs = Math.abs(amount)
  if (abs >= 10000000) return `Rs ${(amount / 10000000).toFixed(2)}Cr`
  if (abs >= 100000) return `Rs ${(amount / 100000).toFixed(2)}L`
  return `Rs ${Math.round(amount).toLocaleString('en-IN')}`
}

function formatMetricValue(value: number, metric: HyundaiMetric) {
  if (metric === 'load') return formatNumber(value)
  if (metric === 'labour' || metric === 'parts') return formatCurrency(value)
  return `Rs ${Math.round(value).toLocaleString('en-IN')}`
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'N/A'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatDateTimeIst(value: string | null | undefined) {
  if (!value) return 'Checking...'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Checking...'
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  })
}

function reportPath(report: HyundaiBusinessReport) {
  return REPORTS.find((item) => item.value === report)?.path || '/brands/hyundai/business-excellence/overview'
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-[18px] bg-slate-200/70', className)} />
}

function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-32" />)}
      </div>
      <SkeletonBlock className="h-80" />
    </div>
  )
}

function GrowthBadge({ value }: { value: number | null }) {
  return <BusinessGrowthBadge value={value} label={formatPercent(value)} />
}

function KpiCard({
  title,
  value,
  subtitle,
  previous,
  growthValue,
  icon,
}: {
  title: string
  value: string
  subtitle: string
  previous?: string
  growthValue?: number | null
  icon: ReactNode
}) {
  return (
    <div className="rounded-[18px] border border-slate-300 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
          <p className="mt-1 text-xs font-bold text-slate-600">{subtitle}</p>
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-slate-300 bg-white text-[#031430]">
          {icon}
        </div>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2">
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">{previous || 'LY not configured'}</span>
        {growthValue !== undefined ? <GrowthBadge value={growthValue} /> : <span className="text-[10px] font-black text-slate-500">N/A</span>}
      </div>
    </div>
  )
}

function SourceStatusBadge({ status, label }: { status?: SourceStatus; label?: string }) {
  if (!status) return null
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em]',
        status === 'live' ? 'border-emerald-200 text-emerald-700' : 'border-amber-200 text-amber-700'
      )}
    >
      {status === 'live' ? 'Live Data' : label || 'Sample Data / Source Pending'}
    </span>
  )
}

function MetricButtons({ metric, onMetricChange }: { metric: HyundaiMetric; onMetricChange: (metric: HyundaiMetric) => void }) {
  return <BusinessMetricButtons options={METRICS} active={metric} onChange={onMetricChange} />
}

function ReportHeader({
  report,
  branch,
  activeDateLabel,
  activeComparisonText,
  datePanelMode,
  hasDateFilters,
  onReportChange,
  onBranchChange,
  onOpenDate,
  onOpenCompare,
  onClearDates,
  freshness,
}: {
  report: HyundaiBusinessReport
  branch: HyundaiBranch
  activeDateLabel: string
  activeComparisonText?: string
  datePanelMode: 'current' | 'compare' | null
  hasDateFilters: boolean
  onReportChange: (report: HyundaiBusinessReport) => void
  onBranchChange: (branch: HyundaiBranch) => void
  onOpenDate: () => void
  onOpenCompare: () => void
  onClearDates: () => void
  freshness?: FreshnessPayload
}) {
  const active = REPORTS.find((item) => item.value === report) || REPORTS[0]
  const source = report === 'open-ro'
    ? freshness?.sources.find((item) => item.source === 'hyundai_repair_order_list')
    : freshness?.sources.find((item) => item.source === 'hyundai_ro_billing_report')

  return (
    <BusinessExcellenceHeader
      eyebrow="AM Hyundai"
      title={active.label}
      subtitle="AM Hyundai Performance Analytics"
      icon={<Activity className="h-4 w-4" />}
      report={report}
      reports={REPORTS.map((item) => ({ value: item.value, label: item.label }))}
      branch={branch}
      branches={BRANCHES}
      activeDateLabel={activeDateLabel}
      activeComparisonText={activeComparisonText}
      freshnessText={`Updated: ${formatDateTimeIst(source?.updatedAt)}`}
      datePanelMode={datePanelMode}
      hasDateFilters={hasDateFilters}
      supportsComparison
      onReportChange={onReportChange}
      onBranchChange={onBranchChange}
      onOpenDate={onOpenDate}
      onOpenCompare={onOpenCompare}
      onClearDates={onClearDates}
    />
  )
}

function SummaryCards({ analysis, openRo }: { analysis?: BillingAnalysisPayload; openRo?: OpenRoPayload }) {
  const summary = analysis?.summary
  const previous = analysis?.comparisonSummary
  const revenueGrowth = growth(numberValue(summary?.revenue), numberValue(previous?.revenue))

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-[18px] border border-slate-400 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Business Health</p>
          <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[10px] font-black uppercase text-slate-950">{(revenueGrowth || 0) >= 10 ? 'Good' : (revenueGrowth || 0) >= 0 ? 'Watch' : 'Critical'}</span>
        </div>
        <p className="text-4xl font-black text-slate-950">{Math.max(35, Math.min(95, Math.round(70 + (revenueGrowth || 0) / 2)))}<span className="text-sm text-slate-500"> /100</span></p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-slate-300 bg-white p-2">
            <p className="text-[10px] font-black text-slate-500">CY</p>
            <p className="text-xs font-black text-slate-950">{formatCurrency(summary?.revenue)}</p>
          </div>
          <div className="rounded-xl border border-slate-300 bg-white p-2">
            <p className="text-[10px] font-black text-slate-500">LY</p>
            <p className="text-xs font-black text-slate-950">{formatCurrency(previous?.revenue)}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2">
          <span className="text-[10px] font-black uppercase text-slate-500">Overall Growth</span>
          <GrowthBadge value={revenueGrowth} />
        </div>
      </div>

      <KpiCard title="Revenue" value={formatCurrency(summary?.revenue)} subtitle="Labour + parts revenue" previous={`LY ${formatCurrency(previous?.revenue)}`} growthValue={revenueGrowth} icon={<TrendingUp className="h-5 w-5" />} />
      <KpiCard title="Labour Revenue" value={formatCurrency(summary?.labour)} subtitle={`${formatPercent(summary?.revenue ? (summary.labour / summary.revenue) * 100 : null)} of revenue`} previous={`LY ${formatCurrency(previous?.labour)}`} growthValue={growth(numberValue(summary?.labour), numberValue(previous?.labour))} icon={<ShieldCheck className="h-5 w-5" />} />
      <KpiCard title="Parts Revenue" value={formatCurrency(summary?.parts)} subtitle={`${formatPercent(summary?.revenue ? (summary.parts / summary.revenue) * 100 : null)} of revenue`} previous={`LY ${formatCurrency(previous?.parts)}`} growthValue={growth(numberValue(summary?.parts), numberValue(previous?.parts))} icon={<Wrench className="h-5 w-5" />} />
      <KpiCard title="Load / JC" value={formatNumber(summary?.load)} subtitle="Closed repair orders" previous={`LY ${formatNumber(previous?.load)}`} growthValue={growth(numberValue(summary?.load), numberValue(previous?.load))} icon={<Activity className="h-5 w-5" />} />
      <KpiCard title="Average Billing" value={formatCurrency(summary?.averageBilling)} subtitle="Revenue per closed RO" previous={`LY ${formatCurrency(previous?.averageBilling)}`} growthValue={growth(numberValue(summary?.averageBilling), numberValue(previous?.averageBilling))} icon={<ShieldCheck className="h-5 w-5" />} />
      <KpiCard title="Labour / Vehicle" value={formatCurrency(summary?.labourPerVehicle)} subtitle="Labour earned per RO" previous={`LY ${formatCurrency(previous?.labourPerVehicle)}`} growthValue={growth(numberValue(summary?.labourPerVehicle), numberValue(previous?.labourPerVehicle))} icon={<Wrench className="h-5 w-5" />} />
      <KpiCard title="Parts / Vehicle" value={formatCurrency(summary?.partsPerVehicle)} subtitle="Parts earned per RO" previous={`LY ${formatCurrency(previous?.partsPerVehicle)}`} growthValue={growth(numberValue(summary?.partsPerVehicle), numberValue(previous?.partsPerVehicle))} icon={<Wrench className="h-5 w-5" />} />
      <KpiCard title="Open RO" value={formatNumber(openRo?.summary.totalOpenRo)} subtitle={`${formatNumber(openRo?.summary.delayedRo)} delayed / ${formatNumber(openRo?.summary.over15Days)} over 15D`} previous="WIP from repair orders" icon={<ClipboardList className="h-5 w-5" />} />
    </div>
  )
}

function PerformanceSummaryTable({ analysis }: { analysis?: BillingAnalysisPayload }) {
  const rows = [
    { metric: 'Revenue', cy: analysis?.summary.revenue || 0, ly: analysis?.comparisonSummary.revenue || 0, type: 'currency' },
    { metric: 'Load / JC', cy: analysis?.summary.load || 0, ly: analysis?.comparisonSummary.load || 0, type: 'number' },
    { metric: 'Labour Revenue', cy: analysis?.summary.labour || 0, ly: analysis?.comparisonSummary.labour || 0, type: 'currency' },
    { metric: 'Parts Revenue', cy: analysis?.summary.parts || 0, ly: analysis?.comparisonSummary.parts || 0, type: 'currency' },
    { metric: 'Average Billing', cy: analysis?.summary.averageBilling || 0, ly: analysis?.comparisonSummary.averageBilling || 0, type: 'currency' },
    { metric: 'Labour / Vehicle', cy: analysis?.summary.labourPerVehicle || 0, ly: analysis?.comparisonSummary.labourPerVehicle || 0, type: 'currency' },
    { metric: 'Parts / Vehicle', cy: analysis?.summary.partsPerVehicle || 0, ly: analysis?.comparisonSummary.partsPerVehicle || 0, type: 'currency' },
  ]

  return (
    <div className="overflow-hidden rounded-[18px] border border-slate-300 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">RO Billing Data</p>
          <h3 className="text-lg font-black text-slate-950">RO Billing Performance</h3>
        </div>
        <p className="text-xs font-black text-slate-600">Metric | CY | LY | Growth</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-slate-950 text-white">
            <tr>
              <th className="px-4 py-3 font-black uppercase tracking-[0.18em]">Metric</th>
              <th className="px-4 py-3 font-black uppercase tracking-[0.18em]">CY</th>
              <th className="px-4 py-3 font-black uppercase tracking-[0.18em]">LY</th>
              <th className="px-4 py-3 font-black uppercase tracking-[0.18em]">Growth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metric} className="border-b border-slate-200">
                <td className="px-4 py-3 font-black text-slate-950">{row.metric}</td>
                <td className="px-4 py-3 font-bold text-slate-950">{row.type === 'currency' ? formatCurrency(row.cy) : formatNumber(row.cy)}</td>
                <td className="px-4 py-3 font-bold text-slate-500">{row.type === 'currency' ? formatCurrency(row.ly) : formatNumber(row.ly)}</td>
                <td className="px-4 py-3"><GrowthBadge value={growth(row.cy, row.ly)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MetricTable({ rows, metric, title = 'TD / MTD / QTD / YTD performance' }: { rows: ServiceMetricRow[]; metric: HyundaiMetric; title?: string }) {
  return (
    <div className="w-full overflow-hidden rounded-[18px] border border-slate-300 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">RO Billing Matrix</p>
          <h3 className="text-lg font-black text-slate-950">{title}</h3>
        </div>
        <p className="text-xs font-black text-slate-600">Load, Labour, Parts, Labour/Vehicle, Parts/Vehicle</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] text-center text-xs">
          <thead className="bg-slate-950 text-white">
            <tr>
              <th rowSpan={2} className="px-4 py-3 text-left font-black uppercase tracking-[0.16em]">Work Type</th>
              <th rowSpan={2} className="px-4 py-3 font-black uppercase tracking-[0.16em]">TD</th>
              <th colSpan={3} className="border-l border-white/20 px-4 py-3 font-black uppercase tracking-[0.16em]">MTD</th>
              <th colSpan={3} className="border-l border-white/20 px-4 py-3 font-black uppercase tracking-[0.16em]">QTD</th>
              <th colSpan={3} className="border-l border-white/20 px-4 py-3 font-black uppercase tracking-[0.16em]">YTD</th>
            </tr>
            <tr>
              {Array.from({ length: 3 }).map((_, index) => (
                <td key={index} className="border-l border-white/20 px-3 py-2 font-black uppercase tracking-[0.16em]" colSpan={3}>
                  <div className="grid grid-cols-3 gap-2">
                    <span>CY</span>
                    <span>LY</span>
                    <span>Growth</span>
                  </div>
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.serviceType} className={cn('border-b border-slate-200', row.isTotal && 'be-management-total-row bg-slate-950 text-white')}>
                <td className="px-4 py-3 text-left font-black">{row.serviceType}</td>
                <td className="px-4 py-3 font-bold">{formatMetricValue(row.td, metric)}</td>
                {[row.mtd, row.qtd, row.ytd].map((window, index) => (
                  <td key={index} className="border-l border-slate-300 px-0 py-3" colSpan={3}>
                    <div className="grid grid-cols-3 items-center gap-2">
                      <span className="font-bold">{formatMetricValue(window.cy, metric)}</span>
                      <span className={cn('font-bold', row.isTotal ? 'text-white' : 'text-slate-500')}>{formatMetricValue(window.ly, metric)}</span>
                      <span><GrowthBadge value={window.growth} /></span>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TrendChart({ analysis, metric }: { analysis?: BillingAnalysisPayload; metric: HyundaiMetric }) {
  const points = analysis?.trend.points || []
  const max = Math.max(1, ...points.flatMap((point) => [point.cy, point.ly, point.target]))
  const width = 920
  const height = 260
  const pad = 42

  const toPoint = (value: number, index: number) => {
    const x = pad + (points.length <= 1 ? 0 : (index / (points.length - 1)) * (width - pad * 2))
    const y = height - pad - (value / max) * (height - pad * 2)
    return `${x},${y}`
  }

  const cyLine = points.map((point, index) => toPoint(point.cy, index)).join(' ')
  const lyLine = points.map((point, index) => toPoint(point.ly, index)).join(' ')
  const targetLine = points.map((point, index) => toPoint(point.target, index)).join(' ')

  return (
    <div className="rounded-[18px] border border-slate-300 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Trend</p>
          <h3 className="text-lg font-black text-slate-950">RO Billing Daily Trend</h3>
        </div>
        <p className="text-xs font-black text-slate-600">{METRICS.find((item) => item.value === metric)?.label}</p>
      </div>
      {points.length ? (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[920px]">
            {Array.from({ length: 5 }).map((_, index) => {
              const y = pad + index * ((height - pad * 2) / 4)
              return <line key={index} x1={pad} x2={width - pad} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 5" />
            })}
            <polyline fill="none" stroke="#075985" strokeWidth="3" points={cyLine} />
            <polyline fill="none" stroke="#ea580c" strokeWidth="3" points={lyLine} />
            <polyline fill="none" stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="5 6" points={targetLine} />
            {points.map((point, index) => {
              const [x, y] = toPoint(point.cy, index).split(',').map(Number)
              const [lx, ly] = toPoint(point.ly, index).split(',').map(Number)
              return (
                <g key={point.date}>
                  <circle cx={x} cy={y} r="4" fill="#fff" stroke="#075985" strokeWidth="2" />
                  <circle cx={lx} cy={ly} r="4" fill="#fff" stroke="#ea580c" strokeWidth="2" />
                  {index % Math.max(1, Math.ceil(points.length / 12)) === 0 ? <text x={x} y={height - 12} textAnchor="middle" className="fill-slate-500 text-[10px] font-black">{point.date.slice(8)}</text> : null}
                </g>
              )
            })}
          </svg>
          <div className="mt-2 flex justify-center gap-5 text-xs font-bold">
            <span className="text-[#075985]">Current Year</span>
            <span className="text-[#ea580c]">Last Year</span>
            <span className="text-rose-600">Target</span>
          </div>
        </div>
      ) : (
        <div className="grid h-64 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white text-sm font-bold text-slate-500">No trend data available.</div>
      )}
    </div>
  )
}

function TrendStats({ analysis }: { analysis?: BillingAnalysisPayload }) {
  const stats = analysis?.trend.stats
  const cards = [
    ['Month Target', stats?.monthTarget],
    ['MTD Target', stats?.mtdTarget],
    ['MTD Achieved', stats?.mtdAchieved],
    ['Shortfall T.D', stats?.shortfallTd],
    ['Monthly Shortfall', stats?.monthlyShortfall],
    ['Projected Closing', stats?.projectedClosing],
    ['Asking Rate', stats?.askingRate],
  ] as const
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-[18px] border border-slate-300 bg-white p-4 text-center shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-2 text-xl font-black text-slate-950">{formatNumber(value)}</p>
        </div>
      ))}
    </div>
  )
}

function CalendarView({ analysis }: { analysis?: BillingAnalysisPayload }) {
  const points = analysis?.trend.points || []
  return (
    <div className="rounded-[18px] border border-slate-300 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Calendar</p>
          <h3 className="text-lg font-black text-slate-950">Load daily CY / LY / Target</h3>
        </div>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-slate-300 text-xs">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="bg-slate-950 px-2 py-2 text-center font-black uppercase text-white">{day}</div>)}
        {points.map((point) => (
          <div key={point.date} className="min-h-[96px] border border-slate-200 bg-white p-2">
            <div className="mx-auto mb-2 grid h-7 w-9 place-items-center rounded-full border border-slate-300 bg-white text-xs font-black text-slate-950">{Number(point.date.slice(8))}</div>
            <div className="grid grid-cols-2 gap-1">
              <span className="rounded border border-slate-200 bg-white px-1 py-1 text-[10px] font-black text-slate-950">CY {formatNumber(point.cy)}</span>
              <span className="rounded border border-amber-200 bg-white px-1 py-1 text-[10px] font-black text-amber-700">LY {formatNumber(point.ly)}</span>
              <span className="col-span-2 rounded border border-blue-200 bg-white px-1 py-1 text-[10px] font-black text-blue-700">Target {formatNumber(point.target)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FyTable({ analysis }: { analysis?: BillingAnalysisPayload }) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-slate-300 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">FY Trends</p>
        <h3 className="text-lg font-black text-slate-950">Financial year performance</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="bg-slate-950 text-white">
            <tr>
              {['Financial Year', 'Load', 'Labour', 'Parts', 'Revenue', 'Lab / Veh', 'Part / Veh'].map((head) => <th key={head} className="px-4 py-3 font-black uppercase tracking-[0.16em]">{head}</th>)}
            </tr>
          </thead>
          <tbody>
            {(analysis?.fyTrend || []).map((row) => (
              <tr key={row.financialYear} className="border-b border-slate-200">
                <td className="px-4 py-3 font-black text-slate-950">{row.financialYear}</td>
                <td className="px-4 py-3 font-bold">{formatNumber(row.load)}</td>
                <td className="px-4 py-3 font-bold">{formatCurrency(row.labour)}</td>
                <td className="px-4 py-3 font-bold">{formatCurrency(row.parts)}</td>
                <td className="px-4 py-3 font-bold">{formatCurrency(row.revenue)}</td>
                <td className="px-4 py-3 font-bold">{formatCurrency(row.labPerVeh)}</td>
                <td className="px-4 py-3 font-bold">{formatCurrency(row.partPerVeh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RevenueTables({ analysis }: { analysis?: BillingAnalysisPayload }) {
  const labourRows = analysis?.byMetric.labour || []
  const partRows = analysis?.byMetric.parts || []
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-[18px] border border-slate-300 bg-white p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Total Revenue Growth</p>
          <p className="mt-3 text-3xl font-black text-slate-950">{formatPercent(growth(numberValue(analysis?.summary.revenue), numberValue(analysis?.comparisonSummary.revenue)))}</p>
          <p className="mt-2 text-xs font-black uppercase text-slate-500">CY {formatCurrency(analysis?.summary.revenue)} vs LY {formatCurrency(analysis?.comparisonSummary.revenue)}</p>
        </div>
        <div className="rounded-[18px] border border-slate-300 bg-white p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Labour Contribution</p>
          <p className="mt-3 text-3xl font-black text-slate-950">{formatPercent(analysis?.summary.revenue ? (analysis.summary.labour / analysis.summary.revenue) * 100 : null)}</p>
          <p className="mt-2 text-xs font-black uppercase text-slate-500">Selected period share</p>
        </div>
        <div className="rounded-[18px] border border-slate-300 bg-white p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Parts Contribution</p>
          <p className="mt-3 text-3xl font-black text-slate-950">{formatPercent(analysis?.summary.revenue ? (analysis.summary.parts / analysis.summary.revenue) * 100 : null)}</p>
          <p className="mt-2 text-xs font-black uppercase text-slate-500">Selected period share</p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <MetricTable title="Labour Revenue Performance" rows={labourRows} metric="labour" />
        <MetricTable title="Part Revenue Performance" rows={partRows} metric="parts" />
      </div>
    </div>
  )
}

function WorkshopSection({ payload, metric, onMetricChange }: { payload?: WorkshopPayload; metric: HyundaiMetric; onMetricChange: (metric: HyundaiMetric) => void }) {
  const kpis = payload?.kpis
  const rows = payload?.metricTables?.[metric] || payload?.serviceTypeRows || []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Workshop Matrix</p>
          <h2 className="text-2xl font-black text-slate-950">Workshop Performance</h2>
        </div>
        <SourceStatusBadge status={payload?.sourceStatus} label={payload?.sourceLabel} />
      </div>
      {payload?.meta.warning && (
        <div className="rounded-2xl border border-amber-200 bg-white p-3 text-xs font-bold text-amber-700">{payload.meta.warning}</div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Workshop JC" value={formatNumber(kpis?.totalJc?.value)} subtitle="Closed workshop jobs" previous={`LY ${formatNumber(kpis?.totalJc?.previous)}`} growthValue={kpis?.totalJc?.growth} icon={<Wrench className="h-5 w-5" />} />
        <KpiCard title="Workshop Revenue" value={formatCurrency(kpis?.totalRevenue?.value)} subtitle="Labour + parts" previous={`LY ${formatCurrency(kpis?.totalRevenue?.previous)}`} growthValue={kpis?.totalRevenue?.growth} icon={<TrendingUp className="h-5 w-5" />} />
        <KpiCard title="Labour / RO" value={formatCurrency(kpis?.labourPerRo?.value)} subtitle="Labour efficiency" previous={`LY ${formatCurrency(kpis?.labourPerRo?.previous)}`} growthValue={kpis?.labourPerRo?.growth} icon={<ShieldCheck className="h-5 w-5" />} />
        <KpiCard title="VAS Revenue" value={formatCurrency(kpis?.vasAmount?.value)} subtitle={kpis?.vasAmount?.note || 'Value added services'} previous={`LY ${formatCurrency(kpis?.vasAmount?.previous)}`} growthValue={kpis?.vasAmount?.growth} icon={<Sparkles className="h-5 w-5" />} />
      </div>
      <MetricButtons metric={metric} onMetricChange={onMetricChange} />
      <MetricTable rows={rows} metric={metric} title="Service Type Performance" />
      <div className="grid gap-4 xl:grid-cols-2">
        <MetricTable rows={payload?.coreRows || []} metric="load" title="Service Type Core Performance" />
        <div className="overflow-hidden rounded-[18px] border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Add-on Source Status</p>
            <h3 className="text-lg font-black text-slate-950">VAS / WA / WB availability</h3>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <KpiCard title="VAS" value={formatCurrency(kpis?.vasAmount?.value)} subtitle={kpis?.vasAmount?.sourceStatus === 'sample' ? 'Sample until source table arrives' : 'Live'} previous={`LY ${formatCurrency(kpis?.vasAmount?.previous)}`} growthValue={kpis?.vasAmount?.growth} icon={<Sparkles className="h-5 w-5" />} />
            <KpiCard title="WA Count" value={formatNumber(kpis?.waCount?.value)} subtitle={kpis?.waCount?.sourceStatus === 'sample' ? 'Sample until source table arrives' : 'Live'} previous={`LY ${formatNumber(kpis?.waCount?.previous)}`} growthValue={kpis?.waCount?.growth} icon={<Activity className="h-5 w-5" />} />
            <KpiCard title="WB Count" value={formatNumber(kpis?.wbCount?.value)} subtitle={kpis?.wbCount?.sourceStatus === 'sample' ? 'Sample until source table arrives' : 'Live'} previous={`LY ${formatNumber(kpis?.wbCount?.previous)}`} growthValue={kpis?.wbCount?.growth} icon={<Activity className="h-5 w-5" />} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ComplaintsSection({ payload }: { payload?: ComplaintsPayload }) {
  const kpis = payload?.kpis
  const complaintGrowth = growth(numberValue(kpis?.total), numberValue(kpis?.lyTotal))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Customer Voice</p>
          <h2 className="text-2xl font-black text-slate-950">Hyundai Complaints</h2>
        </div>
        <SourceStatusBadge status={payload?.sourceStatus} label={payload?.sourceLabel} />
      </div>
      {payload?.meta.warning && (
        <div className="rounded-2xl border border-amber-200 bg-white p-3 text-xs font-bold text-amber-700">{payload.meta.warning}</div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Total Complaints" value={formatNumber(kpis?.total)} subtitle="Selected period" previous={`LY ${formatNumber(kpis?.lyTotal)}`} growthValue={complaintGrowth} icon={<AlertTriangle className="h-5 w-5" />} />
        <KpiCard title="Open Complaints" value={formatNumber(kpis?.open)} subtitle="Currently pending" icon={<ClipboardList className="h-5 w-5" />} />
        <KpiCard title="Closure Rate" value={`${formatNumber(kpis?.closureRate, 1)}%`} subtitle={`${formatNumber(kpis?.closed)} closed / ${formatNumber(kpis?.total)} total`} icon={<ShieldCheck className="h-5 w-5" />} />
        <KpiCard title="Avg Aging" value={`${formatNumber(kpis?.averageAging, 1)}D`} subtitle={`${formatNumber(kpis?.over7Days)} over 7D`} icon={<Activity className="h-5 w-5" />} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-[18px] border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Movement</p>
            <h3 className="text-lg font-black text-slate-950">Complaint movement</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-center text-xs">
              <thead className="bg-slate-950 text-white">
                <tr>{['Period', 'CY', 'LY', 'Growth'].map((head) => <th key={head} className="px-4 py-3 font-black uppercase tracking-[0.16em]">{head}</th>)}</tr>
              </thead>
              <tbody>
                {(payload?.movement || []).map((row) => (
                  <tr key={row.label} className="border-b border-slate-200">
                    <td className="px-4 py-3 text-left font-black">{row.label}</td>
                    <td className="px-4 py-3 font-bold">{row.cy}</td>
                    <td className="px-4 py-3 font-bold text-slate-500">{row.ly}</td>
                    <td className="px-4 py-3"><GrowthBadge value={growth(row.cy, row.ly)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="overflow-hidden rounded-[18px] border border-slate-300 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Complaint Register</p>
            <h3 className="text-lg font-black text-slate-950">Customer complaint details</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-950 text-white">
                <tr>{['Complaint', 'Customer', 'Vehicle', 'Model', 'Area', 'Days', 'Status'].map((head) => <th key={head} className="px-4 py-3 font-black uppercase tracking-[0.16em]">{head}</th>)}</tr>
              </thead>
              <tbody>
                {(payload?.rows || []).map((row) => (
                  <tr key={row.complaintNo} className="border-b border-slate-200">
                    <td className="px-4 py-3 font-black">{row.complaintNo}</td>
                    <td className="px-4 py-3 font-bold">{row.customerName}</td>
                    <td className="px-4 py-3 font-bold text-slate-500">{row.vehicle}</td>
                    <td className="px-4 py-3 font-bold">{row.model}</td>
                    <td className="px-4 py-3 font-bold">{row.area}</td>
                    <td className="px-4 py-3 font-bold">{row.days}D</td>
                    <td className="px-4 py-3 font-black">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function Leaderboard({ analysis }: { analysis?: BillingAnalysisPayload }) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-slate-300 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Advisor Performance</p>
        <h3 className="text-lg font-black text-slate-950">Revenue leaderboard</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-950 text-white">
            <tr>{['Advisor', 'Load', 'Labour', 'Parts', 'Revenue'].map((head) => <th key={head} className="px-4 py-3 font-black uppercase tracking-[0.16em]">{head}</th>)}</tr>
          </thead>
          <tbody>
            {(analysis?.leaderboard || []).map((row) => (
              <tr key={row.advisor} className="border-b border-slate-200">
                <td className="px-4 py-3 font-black">{row.advisor}</td>
                <td className="px-4 py-3 font-bold">{formatNumber(row.load)}</td>
                <td className="px-4 py-3 font-bold">{formatCurrency(row.labour)}</td>
                <td className="px-4 py-3 font-bold">{formatCurrency(row.parts)}</td>
                <td className="px-4 py-3 font-bold">{formatCurrency(row.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function IntelligenceSection({ payload, analysis }: { payload?: IntelligencePayload; analysis?: BillingAnalysisPayload }) {
  const rows = payload?.rows || []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Performance Intelligence</p>
          <h2 className="text-2xl font-black text-slate-950">Hyundai exception signals</h2>
        </div>
        <SourceStatusBadge status={payload?.sourceStatus || (analysis?.meta.warning ? 'sample' : 'live')} label={payload?.sourceLabel} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard title="Revenue Signal" value={formatPercent(payload?.metrics.revenueGrowth ?? growth(numberValue(analysis?.summary.revenue), numberValue(analysis?.comparisonSummary.revenue)))} subtitle="Movement vs comparison period" icon={<Sparkles className="h-5 w-5" />} />
        <KpiCard title="Labour Efficiency" value={formatPercent(payload?.metrics.labourPerVehicleGrowth ?? growth(numberValue(analysis?.summary.labourPerVehicle), numberValue(analysis?.comparisonSummary.labourPerVehicle)))} subtitle="Labour per vehicle movement" icon={<ShieldCheck className="h-5 w-5" />} />
        <KpiCard title="Parts Opportunity" value={formatPercent(payload?.metrics.partsPerVehicleGrowth ?? growth(numberValue(analysis?.summary.partsPerVehicle), numberValue(analysis?.comparisonSummary.partsPerVehicle)))} subtitle="Parts per vehicle movement" icon={<Wrench className="h-5 w-5" />} />
      </div>
      <div className="overflow-hidden rounded-[18px] border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Rules</p>
          <h3 className="text-lg font-black text-slate-950">What needs attention?</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead className="bg-slate-950 text-white">
              <tr>{['Signal', 'What happened', 'Value', 'Severity'].map((head) => <th key={head} className="px-4 py-3 font-black uppercase tracking-[0.16em]">{head}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.type} className="border-b border-slate-200">
                  <td className="px-4 py-3 font-black">{row.type}</td>
                  <td className="px-4 py-3 font-bold text-slate-600">{row.signal}</td>
                  <td className="px-4 py-3"><GrowthBadge value={row.value} /></td>
                  <td className="px-4 py-3 font-black">{row.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function OpenRoSection({ payload }: { payload?: OpenRoPayload }) {
  const summary = payload?.summary
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="Total Open RO" value={formatNumber(summary?.totalOpenRo)} subtitle="Current WIP load" icon={<ClipboardList className="h-5 w-5" />} />
        <KpiCard title="Avg Aging" value={`${formatNumber(summary?.averageAging, 1)}D`} subtitle="Open days" icon={<Activity className="h-5 w-5" />} />
        <KpiCard title="Delayed RO" value={formatNumber(summary?.delayedRo)} subtitle="Promise risk" icon={<AlertTriangle className="h-5 w-5" />} />
        <KpiCard title=">15 Days" value={formatNumber(summary?.over15Days)} subtitle="Aging pressure" icon={<AlertTriangle className="h-5 w-5" />} />
        <KpiCard title="Accident Jobs" value={formatNumber(summary?.accidentJobs)} subtitle="Bodyshop queue" icon={<Wrench className="h-5 w-5" />} />
        <KpiCard title="Running Repairs" value={formatNumber(summary?.runningRepairs)} subtitle="Mechanical queue" icon={<RefreshCw className="h-5 w-5" />} />
      </div>

      <div className="overflow-hidden rounded-[18px] border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Open RO Matrix</p>
          <h3 className="text-lg font-black text-slate-950">Service type aging table</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-center text-xs">
            <thead className="bg-slate-950 text-white">
              <tr>{['Service Type', 'Total WIP', '0-4D', '5-7D', '8-15D', '>15D', 'Avg Days'].map((head) => <th key={head} className="px-4 py-3 font-black uppercase tracking-[0.16em]">{head}</th>)}</tr>
            </thead>
            <tbody>
              {(payload?.agingRows || []).map((row) => (
                <tr key={row.serviceType} className="border-b border-slate-200">
                  <td className="px-4 py-3 text-left font-black">{row.serviceType}</td>
                  <td className="px-4 py-3 font-bold">{row.totalWip}</td>
                  <td className="px-4 py-3 font-bold">{row.bucket0to4}</td>
                  <td className="px-4 py-3 font-bold text-amber-600">{row.bucket5to7}</td>
                  <td className="px-4 py-3 font-bold text-orange-600">{row.bucket8to15}</td>
                  <td className="px-4 py-3 font-bold text-[lab(53_89.72_88.48)]">{row.bucketOver15}</td>
                  <td className="px-4 py-3 font-bold">{formatNumber(row.avgDays, 1)}D</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-[18px] border border-slate-300 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Delay Reason Control</p>
          <h3 className="text-lg font-black text-slate-950">Job Card Delay Reason Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-slate-950 text-white">
              <tr>{['Status', 'Reason', 'Mech Count', 'Acc Count', 'Total', 'Avg Days'].map((head) => <th key={head} className="px-4 py-3 font-black uppercase tracking-[0.16em]">{head}</th>)}</tr>
            </thead>
            <tbody>
              {(payload?.delaySummary || []).map((row) => (
                <tr key={`${row.status}-${row.reason}`} className="border-b border-slate-200">
                  <td className="px-4 py-3 font-black">{row.status}</td>
                  <td className="px-4 py-3 font-bold text-blue-700">{row.reason}</td>
                  <td className="px-4 py-3 font-bold">{row.mechCount}</td>
                  <td className="px-4 py-3 font-bold">{row.accidentCount}</td>
                  <td className="px-4 py-3 font-black">{row.count}</td>
                  <td className="px-4 py-3 font-bold">{formatNumber(row.avgDays, 1)}D</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SourceNotConfigured({ title }: { title: string }) {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-[24px] border border-dashed border-slate-300 bg-white p-8 text-center">
      <div>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-slate-300 bg-white text-[#031430]">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-black text-slate-950">{title}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm font-bold text-slate-600">
          Hyundai source table is not configured for this section yet. The page shell is ready and will render live data once the matching Hyundai dataset is provided.
        </p>
      </div>
    </div>
  )
}

function AiSummaryDialog({ open, onOpenChange, payload, loading }: { open: boolean; onOpenChange: (open: boolean) => void; payload?: AiSummaryPayload; loading: boolean }) {
  const summary = payload?.structuredSummary
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-[24px] bg-white">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div>
              <DialogTitle className="text-2xl font-black text-slate-950">AI Executive Summary</DialogTitle>
              <DialogDescription className="text-sm font-bold text-slate-600">
                Hyundai Business Excellence summary for the active date, comparison, and branch filters.
              </DialogDescription>
            </div>
            <SourceStatusBadge status={payload?.sourceStatus} label={payload?.sourceLabel} />
          </div>
        </DialogHeader>
        {loading ? (
          <div className="grid gap-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ['Good News', summary?.goodNews || []],
              ['Bad News', summary?.badNews || []],
              ['Immediate Actions', summary?.immediateActions || []],
            ].map(([title, items]) => (
              <div key={String(title)} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{String(title)}</p>
                <ul className="mt-3 space-y-2 text-xs font-bold text-slate-700">
                  {(items as string[]).map((item) => <li key={item}>- {item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function HyundaiBusinessExcellencePage({ report }: { report: HyundaiBusinessReport }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [dateModal, setDateModal] = useState<'current' | 'compare' | null>(null)
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false)

  const endDate = searchParams.get('endDate') || todayInput()
  const startDate = searchParams.get('startDate') || monthStart(endDate)
  const compareStartDate = searchParams.get('compareStartDate') || addYears(startDate, -1)
  const compareEndDate = searchParams.get('compareEndDate') || addYears(endDate, -1)
  const branch = (searchParams.get('branch') === 'jammu' || searchParams.get('branch') === 'udhampur' ? searchParams.get('branch') : 'all') as HyundaiBranch
  const metric = (searchParams.get('metric') === 'labour' || searchParams.get('metric') === 'parts' || searchParams.get('metric') === 'lab_per_veh' || searchParams.get('metric') === 'part_per_veh' ? searchParams.get('metric') : 'load') as HyundaiMetric
  const tab = (TABS.some((item) => item.value === searchParams.get('view')) ? searchParams.get('view') : 'table') as HyundaiTab
  const reportMeta = REPORTS.find((item) => item.value === report) || REPORTS[0]

  const baseParams = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('startDate', startDate)
    params.set('endDate', endDate)
    params.set('compareStartDate', compareStartDate)
    params.set('compareEndDate', compareEndDate)
    params.set('branch', branch)
    return params
  }, [branch, compareEndDate, compareStartDate, endDate, searchParams, startDate])

  const updateParams = (values: Record<string, string | null>, targetReport = report) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(values)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    router.push(`${reportPath(targetReport)}?${params.toString()}`)
  }

  const analysisQuery = useQuery({
    queryKey: ['hyundai-be-analysis', baseParams.toString(), metric],
    queryFn: async () => {
      const params = new URLSearchParams(baseParams.toString())
      params.set('metric', metric)
      const response = await fetch(`/api/brands/hyundai/business-excellence/ro-billing-analysis?${params.toString()}`)
      logApiTimings(response, 'hyundai-ro-billing-analysis')
      if (!response.ok) throw new Error('Failed to fetch Hyundai RO billing analysis')
      return await response.json() as BillingAnalysisPayload
    },
    enabled: report === 'overview' || report === 'executive-dashboard' || report === 'ro-billing-report',
    staleTime: 40 * 60 * 1000,
  })

  const openRoQuery = useQuery({
    queryKey: ['hyundai-be-open-ro', baseParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/brands/hyundai/business-excellence/open-ro?${baseParams.toString()}`)
      logApiTimings(response, 'hyundai-open-ro')
      if (!response.ok) throw new Error('Failed to fetch Hyundai Open RO')
      return await response.json() as OpenRoPayload
    },
    enabled: report === 'overview' || report === 'executive-dashboard' || report === 'open-ro',
    staleTime: 40 * 60 * 1000,
  })

  const freshnessQuery = useQuery({
    queryKey: ['hyundai-be-freshness', baseParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/brands/hyundai/business-excellence/freshness?${baseParams.toString()}`)
      logApiTimings(response, 'hyundai-freshness')
      if (!response.ok) throw new Error('Failed to fetch Hyundai freshness')
      return await response.json() as FreshnessPayload
    },
    staleTime: 40 * 60 * 1000,
  })

  const workshopQuery = useQuery({
    queryKey: ['hyundai-be-workshop', baseParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/brands/hyundai/business-excellence/workshop-performance?${baseParams.toString()}`)
      logApiTimings(response, 'hyundai-workshop-performance')
      if (!response.ok) throw new Error('Failed to fetch Hyundai workshop performance')
      return await response.json() as WorkshopPayload
    },
    enabled: report === 'workshop-performance',
    staleTime: 40 * 60 * 1000,
  })

  const complaintsQuery = useQuery({
    queryKey: ['hyundai-be-complaints', baseParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/brands/hyundai/business-excellence/complaints?${baseParams.toString()}`)
      logApiTimings(response, 'hyundai-complaints')
      if (!response.ok) throw new Error('Failed to fetch Hyundai complaints')
      return await response.json() as ComplaintsPayload
    },
    enabled: report === 'hyundai-complaints',
    staleTime: 40 * 60 * 1000,
  })

  const intelligenceQuery = useQuery({
    queryKey: ['hyundai-be-intelligence', baseParams.toString(), report],
    queryFn: async () => {
      const response = await fetch(`/api/brands/hyundai/business-excellence/performance-intelligence?${baseParams.toString()}`)
      logApiTimings(response, 'hyundai-performance-intelligence')
      if (!response.ok) throw new Error('Failed to fetch Hyundai performance intelligence')
      return await response.json() as IntelligencePayload
    },
    enabled: report === 'ro-billing-report' && tab === 'intelligence',
    staleTime: 40 * 60 * 1000,
  })

  const aiSummaryQuery = useQuery({
    queryKey: ['hyundai-be-ai-summary', baseParams.toString(), reportMeta.label],
    queryFn: async () => {
      const response = await fetch(`/api/brands/hyundai/business-excellence/ai-summary?${baseParams.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: reportMeta.label }),
      })
      logApiTimings(response, 'hyundai-ai-summary')
      if (!response.ok) throw new Error('Failed to fetch Hyundai AI summary')
      return await response.json() as AiSummaryPayload
    },
    enabled: aiSummaryOpen,
    staleTime: 40 * 60 * 1000,
  })

  const analysis = analysisQuery.data
  const openRo = openRoQuery.data
  const metricRows = analysis?.byMetric?.[metric] || []
  const loading = analysisQuery.isLoading
    || freshnessQuery.isLoading
    || (report === 'open-ro' && openRoQuery.isLoading)
    || (report === 'workshop-performance' && workshopQuery.isLoading)
    || (report === 'hyundai-complaints' && complaintsQuery.isLoading)
    || (tab === 'intelligence' && intelligenceQuery.isLoading)
  const hasDateFilters = Boolean(
    searchParams.get('startDate') ||
    searchParams.get('endDate') ||
    searchParams.get('compareStartDate') ||
    searchParams.get('compareEndDate') ||
    searchParams.get('comparisonStartDate') ||
    searchParams.get('comparisonEndDate')
  )
  const activeDateLabel = `${startDate} to ${endDate}`
  const activeComparisonText = searchParams.get('compareStartDate') || searchParams.get('compareEndDate') || searchParams.get('comparisonStartDate') || searchParams.get('comparisonEndDate')
    ? `Compare ${compareStartDate} - ${compareEndDate}`
    : ''
  const activeSourceStatus = report === 'workshop-performance'
    ? workshopQuery.data?.sourceStatus
    : report === 'hyundai-complaints'
      ? complaintsQuery.data?.sourceStatus
      : report === 'open-ro'
        ? (openRo?.meta.warning ? 'sample' : 'live')
        : (analysis?.meta.warning ? 'sample' : 'live')
  const activeSourceLabel = report === 'workshop-performance'
    ? workshopQuery.data?.sourceLabel
    : report === 'hyundai-complaints'
      ? complaintsQuery.data?.sourceLabel
      : activeSourceStatus === 'sample'
        ? 'Sample Data / Source Pending'
        : 'Live Data'

  const content = () => {
    if (!reportMeta.supported) return <SourceNotConfigured title={reportMeta.label} />
    if (loading) return <SectionSkeleton />
    if (analysisQuery.error) return <SourceNotConfigured title="Hyundai data could not be loaded" />

    if (report === 'open-ro') return <OpenRoSection payload={openRo} />
    if (report === 'workshop-performance') {
      if (workshopQuery.error) return <SourceNotConfigured title="Hyundai workshop performance could not be loaded" />
      return <WorkshopSection payload={workshopQuery.data} metric={metric} onMetricChange={(nextMetric) => updateParams({ metric: nextMetric })} />
    }
    if (report === 'hyundai-complaints') {
      if (complaintsQuery.error) return <SourceNotConfigured title="Hyundai complaints could not be loaded" />
      return <ComplaintsSection payload={complaintsQuery.data} />
    }

    if (report === 'overview') {
      return (
        <div className="space-y-4">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">MD View</p>
                <h2 className="text-3xl font-black text-slate-950">Business Snapshot</h2>
              </div>
              <div className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-950">
                CY {startDate} to {endDate}
              </div>
            </div>
            <SummaryCards analysis={analysis} openRo={openRo} />
          </section>
          <PerformanceSummaryTable analysis={analysis} />
          <div>
            <MetricButtons metric={metric} onMetricChange={(nextMetric) => updateParams({ metric: nextMetric })} />
          </div>
          <MetricTable rows={metricRows} metric={metric} />
          <TrendChart analysis={analysis} metric={metric} />
        </div>
      )
    }

    if (report === 'executive-dashboard') {
      return (
        <div className="space-y-4">
          <div className="rounded-[24px] border border-slate-300 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Executive Dashboard</p>
            <h2 className="text-2xl font-black text-slate-950">{BRANCHES.find((item) => item.value === branch)?.label} business performance</h2>
            <p className="text-sm font-bold text-slate-600">High-level RO Billing view; source logic matches the Hyundai RO Billing Report.</p>
          </div>
          <SummaryCards analysis={analysis} openRo={openRo} />
          <div className="grid gap-4 xl:grid-cols-2">
            <MetricTable rows={analysis?.byMetric.load || []} metric="load" title="Overall Load" />
            <MetricTable rows={metricRows} metric={metric} title="Service Type Performance" />
          </div>
          <TrendChart analysis={analysis} metric={metric} />
          <TrendStats analysis={analysis} />
          <RevenueTables analysis={analysis} />
          <FyTable analysis={analysis} />
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <BusinessTabButtons options={TABS} active={tab} onChange={(nextTab) => updateParams({ view: nextTab })} />
        </div>
        <MetricButtons metric={metric} onMetricChange={(nextMetric) => updateParams({ metric: nextMetric })} />
        {tab === 'table' ? <MetricTable rows={metricRows} metric={metric} /> : null}
        {tab === 'trend' ? <><TrendChart analysis={analysis} metric={metric} /><TrendStats analysis={analysis} /></> : null}
        {tab === 'calendar' ? <CalendarView analysis={analysis} /> : null}
        {tab === 'fy' ? <FyTable analysis={analysis} /> : null}
        {tab === 'analytics' ? <SummaryCards analysis={analysis} openRo={openRo} /> : null}
        {tab === 'revenue' ? <RevenueTables analysis={analysis} /> : null}
        {tab === 'leaderboard' ? <Leaderboard analysis={analysis} /> : null}
        {tab === 'intelligence' ? <IntelligenceSection payload={intelligenceQuery.data} analysis={analysis} /> : null}
      </div>
    )
  }

  return (
    <MainLayout title="Business Excellence" subtitle="AM Hyundai Performance Analytics">
      <div className="business-excellence-boundaries space-y-4">
        <ReportHeader
          report={report}
          branch={branch}
          activeDateLabel={activeDateLabel}
          activeComparisonText={activeComparisonText}
          datePanelMode={dateModal}
          hasDateFilters={hasDateFilters}
          onReportChange={(nextReport) => updateParams({ view: null }, nextReport)}
          onBranchChange={(nextBranch) => updateParams({ branch: nextBranch })}
          onOpenDate={() => setDateModal((current) => current === 'current' ? null : 'current')}
          onOpenCompare={() => setDateModal((current) => current === 'compare' ? null : 'compare')}
          onClearDates={() => updateParams({ startDate: null, endDate: null, compareStartDate: null, compareEndDate: null, comparisonStartDate: null, comparisonEndDate: null })}
          freshness={freshnessQuery.data}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SourceStatusBadge status={activeSourceStatus} label={activeSourceLabel} />
          <button
            type="button"
            onClick={() => setAiSummaryOpen(true)}
            className="app-primary-action inline-flex h-9 items-center gap-2 rounded-xl px-4 text-xs font-black shadow-sm"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI Summary
          </button>
        </div>

        {dateModal && (
          <BusinessExcellenceDatePanel
            mode={dateModal}
            startDate={startDate}
            endDate={endDate}
            compareStartDate={compareStartDate}
            compareEndDate={compareEndDate}
            onApply={(values) => {
              const nextValues: Record<string, string | null> = {
                startDate: values.startDate,
                endDate: values.endDate,
              }
              if (dateModal === 'compare' || activeComparisonText) {
                nextValues.compareStartDate = values.compareStartDate
                nextValues.compareEndDate = values.compareEndDate
                nextValues.comparisonStartDate = values.compareStartDate
                nextValues.comparisonEndDate = values.compareEndDate
              }
              updateParams(nextValues)
              setDateModal(null)
            }}
            onClear={() => {
              updateParams({ startDate: null, endDate: null, compareStartDate: null, compareEndDate: null, comparisonStartDate: null, comparisonEndDate: null })
              setDateModal(null)
            }}
          />
        )}

        {content()}

        <AiSummaryDialog
          open={aiSummaryOpen}
          onOpenChange={setAiSummaryOpen}
          payload={aiSummaryQuery.data}
          loading={aiSummaryQuery.isLoading}
        />
      </div>
    </MainLayout>
  )
}
