'use client'

import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import {
  Activity,
  Calendar,
  Car,
  CheckCircle2,
  Clock,
  Download,
  Filter,
  Fuel,
  Gauge,
  Layers,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import { formatDuration } from '@/lib/gate-pass/metrics'
import type { GatePassAnalyticsResult } from '@/lib/gate-pass/analytics'
import { cn } from '@/lib/utils'

type PresetRange = '7d' | '30d' | 'this_month' | 'last_month' | '90d' | 'all' | 'custom'

const PRESETS: Array<{ key: PresetRange; label: string }> = [
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: '90d', label: 'Last 90 Days' },
  { key: 'all', label: 'All Time' },
]

const PALETTE = [
  '#0d9488', // Teal
  '#4f46e5', // Indigo
  '#0284c7', // Sky Blue
  '#d97706', // Amber
  '#e11d48', // Rose
  '#8b5cf6', // Violet
  '#059669', // Emerald/Deep Green
  '#ea580c', // Orange
  '#64748b', // Slate
]

function getPresetDates(preset: PresetRange): { startDate?: string; endDate?: string } {
  const now = new Date()
  const format = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)

  if (preset === '7d') {
    const s = new Date(now)
    s.setDate(s.getDate() - 7)
    return { startDate: format(s), endDate: format(now) }
  }
  if (preset === '30d') {
    const s = new Date(now)
    s.setDate(s.getDate() - 30)
    return { startDate: format(s), endDate: format(now) }
  }
  if (preset === 'this_month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1)
    return { startDate: format(s), endDate: format(now) }
  }
  if (preset === 'last_month') {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const e = new Date(now.getFullYear(), now.getMonth(), 0)
    return { startDate: format(s), endDate: format(e) }
  }
  if (preset === '90d') {
    const s = new Date(now)
    s.setDate(s.getDate() - 90)
    return { startDate: format(s), endDate: format(now) }
  }
  return {}
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xl text-xs space-y-1 z-50">
        <p className="font-bold text-slate-900 border-b border-slate-100 pb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={`item-${index}`} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color || entry.stroke || entry.fill }}
              />
              {entry.name}:
            </span>
            <span className="font-bold font-mono text-slate-900">
              {typeof entry.value === 'number' ? entry.value.toLocaleString('en-IN') : entry.value}
            </span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export function GatePassAnalysisPanel({
  onViewPassesForFilter,
}: {
  onViewPassesForFilter?: (filters: { purpose?: string; dealerCode?: string }) => void
}) {
  const [preset, setPreset] = useState<PresetRange>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [selectedDealer, setSelectedDealer] = useState('all')
  const [selectedPurpose, setSelectedPurpose] = useState('all')
  const [search, setSearch] = useState('')
  const [analysisTab, setAnalysisTab] = useState<'overview' | 'models' | 'branches' | 'drivers' | 'fuel'>('overview')

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    if (preset === 'custom') {
      if (customStart) params.set('startDate', customStart)
      if (customEnd) params.set('endDate', customEnd)
    } else {
      const dates = getPresetDates(preset)
      if (dates.startDate) params.set('startDate', dates.startDate)
      if (dates.endDate) params.set('endDate', dates.endDate)
    }
    if (selectedDealer !== 'all') params.set('dealerCode', selectedDealer)
    if (selectedPurpose !== 'all') params.set('purpose', selectedPurpose)
    if (search.trim()) params.set('search', search.trim())
    return params.toString()
  }, [preset, customStart, customEnd, selectedDealer, selectedPurpose, search])

  const { data, isLoading, isError, refetch, isFetching } = useQuery<GatePassAnalyticsResult>({
    queryKey: ['gate-pass-analytics', queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/gate-pass/analytics?${queryParams}`)
      if (!res.ok) {
        throw new Error('Failed to fetch gate pass analysis data')
      }
      return res.json()
    },
    staleTime: 30_000,
  })

  const exportCSV = () => {
    if (!data) return
    const rows = [
      ['Demo Gate Pass Analysis Export'],
      ['Generated At', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
      [''],
      ['-- Executive Summary --'],
      ['Total Passes', data.kpis.totalPasses],
      ['Completed Trips', data.kpis.completedTrips],
      ['Active on Road', data.kpis.activeOut],
      ['Total Distance (Km)', data.kpis.totalDistanceKm],
      ['Avg Distance per Trip (Km)', data.kpis.avgDistancePerTrip],
      ['On-Time Return Rate', `${data.kpis.onTimeRate ?? 'N/A'}%`],
      ['Total Fuel Spend (INR)', data.kpis.totalFuelAmount],
      ['Total Fuel Litres', data.kpis.totalFuelLitres],
      [''],
      ['-- Purpose Breakdown --'],
      ['Purpose', 'Passes Count', 'Percentage (%)', 'Total Km', 'Avg Km/Trip'],
      ...data.purposes.map((p) => [p.purpose, p.count, `${p.percentage}%`, p.totalDistanceKm, p.avgDistanceKm]),
      [''],
      ['-- Model Utilization --'],
      ['Model', 'Trip Count', 'Percentage (%)', 'Total Km', 'Avg Km/Trip'],
      ...data.models.map((m) => [m.model, m.tripCount, `${m.percentage}%`, m.totalDistanceKm, m.avgDistanceKm]),
      [''],
      ['-- Branch Comparison --'],
      ['Branch', 'Total Passes', 'Completed Trips', 'Total Km', 'On-Time Rate', 'Fuel Spend (INR)'],
      ...data.branches.map((b) => [b.branchName, b.totalPasses, b.completedTrips, b.totalDistanceKm, `${b.onTimeRate ?? 'N/A'}%`, b.fuelSpend]),
      [''],
      ['-- Driver / Requester Activity --'],
      ['Name', 'Email', 'Role/Kind', 'Total Trips', 'Completed Trips', 'Total Km', 'Test Drives', 'On-Time Rate'],
      ...data.drivers.map((d) => [d.name, d.email, d.kind, d.totalTrips, d.completedTrips, d.totalDistanceKm, d.testDrivesCount, `${d.onTimeRate ?? 'N/A'}%`]),
    ]

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `demo_gate_pass_analysis_${preset}_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      {/* ── Top Header & Filter Controls Bar ───────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0 shadow-2xs">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
                Demo Gate Pass Analytics &amp; Deep Insights
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Fleet movement, test drive volume, turnaround metrics, model utilization, and fuel economy analytics.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-center flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8.5 px-3 text-xs font-semibold rounded-xl border-slate-200 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer shadow-2xs"
            >
              <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', isFetching && 'animate-spin text-teal-700')} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCSV}
              disabled={!data || isLoading}
              className="h-8.5 px-3 text-xs font-semibold rounded-xl border-slate-200 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Filter Pills & Selectors */}
        <div className="pt-3 border-t border-slate-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 flex-wrap">
          {/* Preset range pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0">
            {PRESETS.map((p) => {
              const active = preset === p.key
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPreset(p.key)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all shrink-0 cursor-pointer',
                    active
                      ? 'bg-teal-700 text-white border-teal-700 shadow-2xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                  )}
                >
                  {p.label}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setPreset('custom')}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all shrink-0 cursor-pointer',
                preset === 'custom'
                  ? 'bg-teal-700 text-white border-teal-700 shadow-2xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              Custom Range
            </button>
          </div>

          {/* Secondary Dropdown Filters */}
          <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
            {/* Dealer Branch Select */}
            <Select value={selectedDealer} onValueChange={setSelectedDealer}>
              <SelectTrigger className="h-8.5 w-[160px] text-xs bg-slate-50 border-slate-200 rounded-xl">
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {KIA_BRANCH_DEALERS.map((d) => (
                  <SelectItem key={d.dealerCode} value={d.dealerCode}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Purpose Select */}
            <Select value={selectedPurpose} onValueChange={setSelectedPurpose}>
              <SelectTrigger className="h-8.5 w-[160px] text-xs bg-slate-50 border-slate-200 rounded-xl">
                <SelectValue placeholder="All Purposes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Purposes</SelectItem>
                <SelectItem value="Customer test drive">Customer test drive</SelectItem>
                <SelectItem value="Customer home demo">Customer home demo</SelectItem>
                <SelectItem value="Fuel filling">Fuel filling</SelectItem>
                <SelectItem value="Showroom visit">Showroom visit</SelectItem>
                <SelectItem value="Stockyard visit">Stockyard visit</SelectItem>
                <SelectItem value="Workshop visit">Workshop visit</SelectItem>
                <SelectItem value="Inter-branch movement">Inter-branch movement</SelectItem>
                <SelectItem value="Service/Maintenance">Service/Maintenance</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Custom Date Inputs if custom is selected */}
        {preset === 'custom' && (
          <div className="flex items-center gap-3 pt-2 border-t border-slate-100 flex-wrap text-xs">
            <span className="font-semibold text-slate-600">From Date:</span>
            <Input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-8 w-36 bg-slate-50 border-slate-200 text-xs rounded-lg"
            />
            <span className="font-semibold text-slate-600">To Date:</span>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-8 w-36 bg-slate-50 border-slate-200 text-xs rounded-lg"
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-16 text-center shadow-xs">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-teal-700 mb-3" />
          <p className="text-base font-bold text-slate-800">Calculating Demo Gate Pass Analytics...</p>
          <p className="text-xs text-slate-500 mt-1">Aggregating trips, mileage logs, turnaround times, and fuel metrics.</p>
        </div>
      ) : isError || !data ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-10 text-center shadow-xs">
          <p className="text-base font-bold text-rose-900">Unable to load gate pass analysis</p>
          <p className="text-xs text-rose-700 mt-1">Please try adjusting your filters or verify your branch access.</p>
          <Button onClick={() => refetch()} variant="outline" size="sm" className="mt-4 border-rose-300 bg-white text-rose-800">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try Again
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── 6 Deep Executive KPI Scorecards ────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* KPI 1: Total Passes */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
                <span>Total Passes</span>
                <Layers className="h-4 w-4 text-indigo-600" />
              </div>
              <p className="text-2xl font-black tabular-nums text-slate-900">
                {data.kpis.totalPasses.toLocaleString('en-IN')}
              </p>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-800">
                <span>{data.kpis.completedTrips} completed</span>
                <span className="text-slate-300">·</span>
                <span className="text-blue-600">{data.kpis.activeOut} out</span>
              </div>
            </div>

            {/* KPI 2: Total Km Driven */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
                <span>Total Mileage Logged</span>
                <Gauge className="h-4 w-4 text-teal-700" />
              </div>
              <p className="text-2xl font-black tabular-nums text-teal-800">
                {data.kpis.totalDistanceKm.toLocaleString('en-IN')} <span className="text-sm font-semibold">km</span>
              </p>
              <p className="text-[11px] text-slate-500 font-medium">
                Avg <strong>{data.kpis.avgDistancePerTrip} km</strong> / completed trip
              </p>
            </div>

            {/* KPI 3: On-Time Return Rate */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
                <span>On-Time Compliance</span>
                <CheckCircle2 className="h-4 w-4 text-teal-700" />
              </div>
              <p className="text-2xl font-black tabular-nums text-slate-900">
                {data.kpis.onTimeRate !== null ? `${data.kpis.onTimeRate}%` : '—'}
              </p>
              <p className="text-[11px] text-slate-500 font-medium">
                <span className="text-teal-800 font-semibold">{data.kpis.onTimeCount} on time</span>
                {' · '}
                <span className="text-rose-600 font-semibold">{data.kpis.lateCount} late</span>
              </p>
            </div>

            {/* KPI 4: Turnaround Times */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
                <span>Median Trip Time</span>
                <Clock className="h-4 w-4 text-amber-600" />
              </div>
              <p className="text-2xl font-black tabular-nums text-slate-900">
                {data.kpis.medianTripMinutes !== null ? formatDuration(data.kpis.medianTripMinutes) : '—'}
              </p>
              <p className="text-[11px] text-slate-500 font-medium">
                Approval wait: <strong>{formatDuration(data.kpis.medianApprovalMinutes)}</strong>
              </p>
            </div>

            {/* KPI 5: Fuel Expense Logged */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
                <span>Fuel Filling Spend</span>
                <Fuel className="h-4 w-4 text-rose-600" />
              </div>
              <p className="text-2xl font-black tabular-nums text-slate-900">
                ₹{data.kpis.totalFuelAmount.toLocaleString('en-IN')}
              </p>
              <p className="text-[11px] text-slate-500 font-medium">
                <strong>{data.kpis.totalFuelLitres} Litres</strong> filled ({data.kpis.fuelPassesCount} passes)
              </p>
            </div>

            {/* KPI 6: Evidence Verification Rate */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[11px] font-semibold">
                <span>Photo Evidence Audit</span>
                <ShieldCheck className="h-4 w-4 text-blue-600" />
              </div>
              <p className="text-2xl font-black tabular-nums text-slate-900">
                {data.kpis.evidenceComplianceRate !== null ? `${data.kpis.evidenceComplianceRate}%` : '—'}
              </p>
              <p className="text-[11px] text-slate-500 font-medium">
                4-angle + Odo photo verified
              </p>
            </div>
          </div>

          {/* ── Navigation Tabs within Analysis ────────────────────────────── */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
            {[
              { key: 'overview', label: 'Overview & Trends', icon: TrendingUp },
              { key: 'models', label: 'Models & Fleet Utilization', icon: Car },
              { key: 'branches', label: 'Branch Comparison', icon: MapPin },
              { key: 'drivers', label: 'Driver Leaderboard', icon: Users },
              { key: 'fuel', label: 'Fuel Spend & Verification', icon: Fuel },
            ].map((t) => {
              const Icon = t.icon
              const active = analysisTab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setAnalysisTab(t.key as any)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer',
                    active
                      ? 'bg-teal-50 text-teal-900 border border-teal-200 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5', active ? 'text-teal-700' : 'text-slate-400')} />
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* ── TAB 1: OVERVIEW & TRENDS ──────────────────────────────────── */}
          {analysisTab === 'overview' && (
            <div className="space-y-6">
              {/* Daily Volume Trend Area Chart */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-teal-700" />
                      Daily Gate Pass Activity &amp; Movement Trend
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Daily count of gate passes created, completed trips, and customer test drives.
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-semibold">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full bg-teal-700" /> Total Passes
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" /> Customer Test Drives
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Fuel Filling
                    </span>
                  </div>
                </div>

                <div className="h-[280px] w-full">
                  {data.trend.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                      No gate pass activity recorded in this date range.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="tealGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0d9488" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="indigoGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" />
                        <Tooltip content={<CustomTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="total"
                          name="Total Passes"
                          stroke="#0d9488"
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill="url(#tealGrad)"
                        />
                        <Area
                          type="monotone"
                          dataKey="testDrives"
                          name="Test Drives"
                          stroke="#4f46e5"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#indigoGrad)"
                        />
                        <Area
                          type="monotone"
                          dataKey="fuelFilling"
                          name="Fuel Filling"
                          stroke="#d97706"
                          strokeWidth={1.5}
                          fillOpacity={0}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* 2-Column Grid: Purpose Distribution & Peak Hours */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Purpose Breakdown Donut & List */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Layers className="h-4 w-4 text-indigo-600" />
                      Trip Purpose Breakdown
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Distribution of reasons vehicles left the showroom.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                    <div className="h-[220px] flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data.purposes}
                            dataKey="count"
                            nameKey="purpose"
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={3}
                          >
                            {data.purposes.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {data.purposes.map((p, idx) => (
                        <div key={p.purpose} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                          <div className="flex items-center gap-2 truncate pr-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                            />
                            <span className="font-semibold text-slate-800 truncate" title={p.purpose}>
                              {p.purpose}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-slate-900 font-mono">{p.count}</span>
                            <span className="text-[11px] text-slate-500 ml-1">({p.percentage}%)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Peak Hours Histogram */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-600" />
                      Peak Checkout &amp; Dispatch Hours
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Hour-by-hour distribution of when demo cars exit the gates.
                    </p>
                  </div>

                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.hourly} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} stroke="#cbd5e1" />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="count" name="Dispatches" fill="#0d9488" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 2: MODELS & FLEET UTILIZATION ─────────────────────────── */}
          {analysisTab === 'models' && (
            <div className="space-y-6">
              {/* Models Bar Chart */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Car className="h-4 w-4 text-indigo-600" />
                      Car Model Utilization &amp; Trip Volume
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Total passes and distance logged per vehicle model.
                    </p>
                  </div>
                </div>

                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.models} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="model" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="tripCount" name="Trips Count" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Individual Vehicle Fleet Table */}
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-teal-700" />
                    Individual Demo Car Utilization Ledger
                  </h3>
                  <span className="text-xs font-semibold text-slate-500">
                    {data.vehicles.length} Vehicles Monitored
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-indigo-100/60 bg-gradient-to-r from-slate-50 via-indigo-50/30 to-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                        <th className="px-5 py-3.5">Registration / Model</th>
                        <th className="px-4 py-3.5">Color &amp; Variant</th>
                        <th className="px-4 py-3.5 text-center">Total Trips</th>
                        <th className="px-4 py-3.5 text-right">Total Mileage</th>
                        <th className="px-4 py-3.5 text-right">Avg Km / Trip</th>
                        <th className="px-5 py-3.5 text-right">Fuel Spend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.vehicles.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                            No vehicle trip logs found in this period.
                          </td>
                        </tr>
                      ) : (
                        data.vehicles.map((v) => (
                          <tr key={v.vin} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-5 py-3.5">
                              <div className="font-bold text-slate-900 flex items-center gap-1.5 font-mono">
                                <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded text-xs">
                                  {v.regNo}
                                </span>
                              </div>
                              <p className="text-[11px] font-semibold text-slate-700 mt-0.5">{v.model}</p>
                            </td>
                            <td className="px-4 py-3.5 text-slate-600">
                              <div className="text-xs">{v.variant || '—'}</div>
                              <div className="text-[11px] text-slate-400">{v.color || 'Standard'}</div>
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <span className="inline-flex items-center justify-center font-bold font-mono text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-full text-xs">
                                {v.trips}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right font-bold text-teal-800 font-mono text-xs">
                              {v.totalDistanceKm.toLocaleString('en-IN')} km
                            </td>
                            <td className="px-4 py-3.5 text-right text-slate-700 font-mono text-xs">
                              {v.avgDistanceKm} km
                            </td>
                            <td className="px-5 py-3.5 text-right font-mono text-slate-900 font-semibold text-xs">
                              {v.fuelSpend > 0 ? `₹${v.fuelSpend.toLocaleString('en-IN')}` : '—'}
                              {v.fuelLitres > 0 && <span className="text-[11px] text-slate-400 block font-normal">{v.fuelLitres}L</span>}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 3: BRANCH COMPARISON ─────────────────────────────────── */}
          {analysisTab === 'branches' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-indigo-600" />
                    Branch-Wise Pass Volume &amp; Distance Comparison
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Compare activity, test drive volume, and mileage across KIA showrooms.
                  </p>
                </div>

                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.branches} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="branchName" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="totalPasses" name="Total Passes" fill="#0d9488" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="completedTrips" name="Completed Trips" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Branch Table */}
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900">Branch Performance Summary</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-indigo-100/60 bg-gradient-to-r from-slate-50 via-indigo-50/30 to-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                        <th className="px-5 py-3.5">Branch Name</th>
                        <th className="px-4 py-3.5 text-center">Dealer Code</th>
                        <th className="px-4 py-3.5 text-center">Total Passes</th>
                        <th className="px-4 py-3.5 text-center">Completed</th>
                        <th className="px-4 py-3.5 text-right">Total Mileage</th>
                        <th className="px-4 py-3.5 text-center">On-Time %</th>
                        <th className="px-5 py-3.5 text-right">Fuel Spend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.branches.map((b) => (
                        <tr key={b.dealerCode} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-5 py-3.5 font-bold text-slate-900">{b.branchName}</td>
                          <td className="px-4 py-3.5 text-center font-mono text-slate-600">{b.dealerCode}</td>
                          <td className="px-4 py-3.5 text-center font-bold text-slate-900 font-mono">{b.totalPasses}</td>
                          <td className="px-4 py-3.5 text-center text-teal-800 font-bold font-mono">{b.completedTrips}</td>
                          <td className="px-4 py-3.5 text-right font-bold text-teal-800 font-mono">
                            {b.totalDistanceKm.toLocaleString('en-IN')} km
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            {b.onTimeRate !== null ? (
                              <span
                                className={cn(
                                  'inline-block px-2 py-0.5 rounded-full text-xs font-bold font-mono',
                                  b.onTimeRate >= 80 ? 'bg-teal-50 text-teal-800 border border-teal-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                                )}
                              >
                                {b.onTimeRate}%
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right font-mono font-semibold text-slate-900">
                            {b.fuelSpend > 0 ? `₹${b.fuelSpend.toLocaleString('en-IN')}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 4: DRIVER & CONSULTANT LEADERBOARD ─────────────────────── */}
          {analysisTab === 'drivers' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Users className="h-4 w-4 text-teal-700" />
                      Sales Consultants &amp; Driver Activity Leaderboard
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Ranked by total vehicle dispatches, customer test drives, and return punctuality.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    Top {data.drivers.length} Drivers
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-indigo-100/60 bg-gradient-to-r from-slate-50 via-indigo-50/30 to-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                        <th className="px-5 py-3.5">#</th>
                        <th className="px-5 py-3.5">Driver / Staff Name</th>
                        <th className="px-4 py-3.5">Type</th>
                        <th className="px-4 py-3.5 text-center">Total Trips</th>
                        <th className="px-4 py-3.5 text-center">Customer Test Drives</th>
                        <th className="px-4 py-3.5 text-right">Total Mileage (Km)</th>
                        <th className="px-5 py-3.5 text-center">On-Time Return %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.drivers.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                            No driver activity recorded in this period.
                          </td>
                        </tr>
                      ) : (
                        data.drivers.map((d, index) => (
                          <tr key={`${d.name}-${index}`} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-5 py-3.5 font-bold font-mono text-slate-400">{index + 1}</td>
                            <td className="px-5 py-3.5">
                              <p className="font-bold text-slate-900 text-xs">{d.name}</p>
                              {d.email && <p className="text-[11px] text-slate-500 truncate max-w-[200px]">{d.email}</p>}
                            </td>
                            <td className="px-4 py-3.5">
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border',
                                  d.kind === 'customer'
                                    ? 'bg-purple-50 text-purple-800 border-purple-200'
                                    : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                )}
                              >
                                {d.kind}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-center font-bold font-mono text-slate-900 text-xs">
                              {d.totalTrips}
                            </td>
                            <td className="px-4 py-3.5 text-center font-bold font-mono text-teal-800 text-xs">
                              {d.testDrivesCount}
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono font-bold text-slate-900 text-xs">
                              {d.totalDistanceKm.toLocaleString('en-IN')} km
                            </td>
                            <td className="px-5 py-3.5 text-center">
                              {d.onTimeRate !== null ? (
                                <span
                                  className={cn(
                                    'inline-block px-2 py-0.5 rounded-full text-xs font-bold font-mono',
                                    d.onTimeRate >= 80 ? 'bg-teal-50 text-teal-800 border border-teal-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                                  )}
                                >
                                  {d.onTimeRate}%
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 5: FUEL SPEND & VERIFICATION ─────────────────────────── */}
          {analysisTab === 'fuel' && (
            <div className="space-y-6">
              {/* Fuel Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
                  <p className="text-xs font-semibold text-slate-500">Total Fuel Spend</p>
                  <p className="text-2xl font-black tabular-nums text-slate-900">
                    ₹{data.fuelSummary.totalSpend.toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
                  <p className="text-xs font-semibold text-slate-500">Total Litres Dispensed</p>
                  <p className="text-2xl font-black tabular-nums text-teal-800">
                    {data.fuelSummary.totalLitres} <span className="text-sm font-semibold">Litres</span>
                  </p>
                </div>
                <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
                  <p className="text-xs font-semibold text-slate-500">Verified Proofs Attached</p>
                  <p className="text-2xl font-black tabular-nums text-teal-800">
                    {data.fuelSummary.proofsAttachedCount}
                  </p>
                  <p className="text-[11px] text-teal-800 font-semibold">Slip + Pump photos complete</p>
                </div>
                <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-1">
                  <p className="text-xs font-semibold text-slate-500">Proofs Pending Upload</p>
                  <p className="text-2xl font-black tabular-nums text-amber-600">
                    {data.fuelSummary.proofsPendingCount}
                  </p>
                  <p className="text-[11px] text-amber-700 font-semibold">Missing slip or pump pics</p>
                </div>
              </div>

              {/* Fuel by Vehicle Table */}
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Fuel className="h-4 w-4 text-rose-600" />
                    Vehicle-Wise Fuel Consumption Ledger
                  </h3>
                  <span className="text-xs font-semibold text-slate-500">
                    {data.fuelSummary.byVehicle.length} Fuel Logged Vehicles
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-indigo-100/60 bg-gradient-to-r from-slate-50 via-indigo-50/30 to-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                        <th className="px-5 py-3.5">Vehicle Registration</th>
                        <th className="px-4 py-3.5">Model</th>
                        <th className="px-4 py-3.5 text-center">Refueling Passes</th>
                        <th className="px-4 py-3.5 text-right">Total Litres</th>
                        <th className="px-5 py-3.5 text-right">Total Expense</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.fuelSummary.byVehicle.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                            No fuel passes recorded in this period.
                          </td>
                        </tr>
                      ) : (
                        data.fuelSummary.byVehicle.map((f) => (
                          <tr key={f.regNo} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-5 py-3.5 font-bold font-mono text-slate-900 text-xs">
                              <span className="bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded">
                                {f.regNo}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 font-semibold text-slate-700 text-xs">{f.model}</td>
                            <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-900 text-xs">{f.passesCount}</td>
                            <td className="px-4 py-3.5 text-right font-mono font-bold text-teal-800 text-xs">{f.litres} L</td>
                            <td className="px-5 py-3.5 text-right font-mono font-bold text-slate-900 text-xs">
                              ₹{f.amount.toLocaleString('en-IN')}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
