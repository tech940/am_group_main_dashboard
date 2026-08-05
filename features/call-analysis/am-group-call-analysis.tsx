'use client'

import React, { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  Loader2, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Users,
  Mic, Search, X, ChevronLeft, ChevronRight, Download, Play, Pause, Volume2,
  Building2, Award, UserCheck, ShieldCheck, FileAudio, RefreshCw
} from 'lucide-react'
import { KpiCard } from '@/components/ui/kpi-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type CrePerformance = {
  cre_id: string
  cre_name: string
  branch_name: string
  calls_today: number
  calls_this_week: number
  calls_this_month: number
  connected_calls: number
  connect_rate: number
  missed_calls: number
  avg_duration_seconds: number
  total_talk_time_seconds: number
  overall_score: number
}

type BranchPerformance = {
  id: string
  name: string
  calls: number
  connectedOutgoing: number
  connectedIncoming: number
  missedIncoming: number
  missedOutgoing: number
  totalUnanswered: number
  totalConnected: number
  connectRate: number
  unansweredRate: number
  durationLabel: string
}

type AnalyticsData = {
  summary: {
    totalCalls: number
    totalDurationSeconds: number
    totalDurationLabel: string
    avgDurationSeconds: number
    avgDurationLabel: string
    withRecording: number
    recordingCoverage: number
    uniquePhones: number
    connectedOutgoing: number
    connectedIncoming: number
    missedIncoming: number
    missedOutgoing: number
    totalUnanswered: number
    totalConnected: number
    connectRate: number
    unansweredRate: number
    agentCount: number
  }
  sparklines?: {
    callsSeries: number[]
    recordingsSeries: number[]
    durationSeries: number[]
    avgDurationSeries: number[]
    uniquePhonesSeries: number[]
    agentsSeries: number[]
  }
  dailyTrend: { date: string; calls: number; duration: number; missedIncoming?: number; missedOutgoing?: number }[]
  callTypeMix: { name: string; value: number }[]
  crePerformance: CrePerformance[]
  branchPerformance?: BranchPerformance[]
  agents: { id: string; name: string; branchName?: string; calls: number; recordings: number; durationLabel: string; connectRate?: number; missedIncoming?: number; missedOutgoing?: number }[]
  facets: {
    agentOptions: { id: string; name: string }[]
    branchOptions?: { id: string; name: string }[]
    totalCallsAvailable: number
  }
}

type RecordingRow = {
  id: string
  phone: string
  contactName: string | null
  creId: string
  creName: string
  branchId?: string
  branchName?: string
  durationSeconds: number
  callType: string
  statusLabel?: string
  statusBadgeClass?: string
  recordedAt: string
  uploadStatus: string
  storagePath: string | null
  audioUrl: string | null
  deviceModel: string | null
}

const PRESETS = [
  { key: '7d', label: '7 Days', days: 7 },
  { key: '30d', label: '30 Days', days: 30 },
  { key: '90d', label: '90 Days', days: 90 },
  { key: 'all', label: 'All Time', days: 0 },
]

function iso(daysAgo: number) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}
function today() { return new Date().toISOString().slice(0, 10) }

function dur(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function formatDate(isoStr: string) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AmGroupCallAnalysis() {
  const [subTab, setSubTab] = useState<'overview' | 'branch_performance' | 'cre_performance' | 'recordings' | 'pending'>('overview')
  const [preset, setPreset] = useState('30d')
  const [startDate, setStartDate] = useState(iso(30))
  const [endDate, setEndDate] = useState(today())
  const [agent, setAgent] = useState('all')
  const [branch, setBranch] = useState('all')
  const [callStatus, setCallStatus] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  function applyPreset(key: string) {
    setPreset(key)
    setPage(1)
    const p = PRESETS.find((x) => x.key === key)
    if (!p) return
    if (p.days === 0) {
      setStartDate('')
      setEndDate('')
    } else {
      setStartDate(iso(p.days))
      setEndDate(today())
    }
  }

  const filterParams = useMemo(() => {
    const p = new URLSearchParams()
    if (startDate) p.set('startDate', startDate)
    if (endDate) p.set('endDate', endDate)
    if (agent !== 'all') p.set('agent', agent)
    if (branch !== 'all') p.set('branch', branch)
    if (callStatus !== 'all') p.set('callStatus', callStatus)
    if (search) p.set('search', search)
    return p.toString()
  }, [startDate, endDate, agent, branch, callStatus, search])

  const analyticsQuery = useQuery<AnalyticsData>({
    queryKey: ['am-group-call-analysis', filterParams],
    placeholderData: keepPreviousData,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/call-analysis/am-group?${filterParams}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const callsQuery = useQuery<{ rows: RecordingRow[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>({
    queryKey: ['am-group-call-log', filterParams, page],
    enabled: subTab === 'recordings',
    placeholderData: keepPreviousData,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams(filterParams)
      p.set('page', String(page))
      p.set('pageSize', '20')
      p.set('recordingsOnly', 'true')
      const res = await fetch(`/api/call-analysis/am-group/calls?${p.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const pendingCallsQuery = useQuery<{ rows: RecordingRow[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>({
    queryKey: ['am-group-pending-call-log', filterParams, page],
    enabled: subTab === 'pending',
    placeholderData: keepPreviousData,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams(filterParams)
      p.set('page', String(page))
      p.set('pageSize', '20')
      p.set('pendingOnly', 'true')
      const res = await fetch(`/api/call-analysis/am-group/calls?${p.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const d = analyticsQuery.data

  function runSearch() {
    setSearch(searchInput.trim())
    setPage(1)
  }

  function resetFilters() {
    applyPreset('30d')
    setAgent('all')
    setBranch('all')
    setCallStatus('all')
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const hasFilters = agent !== 'all' || branch !== 'all' || callStatus !== 'all' || Boolean(search) || preset !== '30d'

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Filter Header */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {PRESETS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => applyPreset(o.key)}
                  style={preset === o.key ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' } : undefined}
                  className={cn(
                    'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                    preset !== o.key && 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPreset('custom'); setPage(1) }}
                className="h-9 w-[9.5rem] rounded-xl text-xs font-bold"
              />
              <span className="text-xs font-bold text-slate-400">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPreset('custom'); setPage(1) }}
                className="h-9 w-[9.5rem] rounded-xl text-xs font-bold"
              />
            </div>

            {/* Branch Wise Filter Selector */}
            <div className="w-[12rem]">
              <Select value={branch} onValueChange={(v) => { setBranch(v); setPage(1) }}>
                <SelectTrigger className="h-9 rounded-xl text-xs font-bold">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">All Branches</SelectItem>
                  {(d?.facets.branchOptions || []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Call Status / Type Selector */}
            <div className="w-[13.5rem]">
              <Select value={callStatus} onValueChange={(v) => { setCallStatus(v); setPage(1) }}>
                <SelectTrigger className="h-9 rounded-xl text-xs font-bold">
                  <SelectValue placeholder="All Call Types / Statuses" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">All Call Statuses</SelectItem>
                  <SelectItem value="connected_outgoing">Connected Outgoing</SelectItem>
                  <SelectItem value="connected_incoming">Connected Incoming</SelectItem>
                  <SelectItem value="missed_incoming">Missed Incoming Calls</SelectItem>
                  <SelectItem value="missed_outgoing">Missed Outgoing (Not Answered)</SelectItem>
                  <SelectItem value="unanswered">All Unanswered / Missed Calls</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* CRE Agent Selector */}
            <div className="w-[12rem]">
              <Select value={agent} onValueChange={(v) => { setAgent(v); setPage(1) }}>
                <SelectTrigger className="h-9 rounded-xl text-xs font-bold">
                  <SelectValue placeholder="All CRE Agents" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">All CRE Agents</SelectItem>
                  {(d?.facets.agentOptions || []).map((ag) => (
                    <SelectItem key={ag.id} value={ag.id}>
                      {ag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search Input */}
            <div className="flex flex-1 items-center gap-1.5 min-w-[200px]">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search CRE name, phone, branch..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
                  className="h-9 rounded-xl pl-9 text-xs font-bold"
                />
              </div>
              <Button onClick={runSearch} size="sm" className="h-9 rounded-xl px-3 font-bold text-xs">
                Search
              </Button>
              {hasFilters && (
                <Button onClick={resetFilters} variant="ghost" size="sm" className="h-9 rounded-xl px-2 text-slate-500">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary KPI Cards Grid (6 Columns) */}
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          title="TOTAL CRE CALLS"
          value={d ? d.summary.totalCalls.toLocaleString('en-IN') : '—'}
          subtitle="Processed CRE call volume"
          icon={PhoneCall}
          colorScheme="teal"
          chartType="area"
          chartData={d?.sparklines?.callsSeries || [3, 5, 4, 6, 8, 5, 7]}
          trend={{ value: `${d?.summary.connectRate || 0}%`, isPositive: true, label: 'connected rate' }}
        />
        <KpiCard
          title="CONNECTED CALLS"
          value={d ? d.summary.totalConnected.toLocaleString('en-IN') : '—'}
          subtitle={d ? `${d.summary.connectedOutgoing} out / ${d.summary.connectedIncoming} in` : '—'}
          icon={PhoneOutgoing}
          colorScheme="emerald"
          chartType="line"
          chartData={d?.sparklines?.recordingsSeries || [2, 4, 3, 5, 6, 4, 5]}
          trend={{ value: `${d?.summary.connectRate || 0}%`, isPositive: true, label: 'connected' }}
        />
        <KpiCard
          title="MISSED INCOMING"
          value={d ? d.summary.missedIncoming.toLocaleString('en-IN') : '—'}
          subtitle="Unanswered incoming calls"
          icon={PhoneMissed}
          colorScheme="rose"
          chartType="bar"
          chartData={[5, 8, 4, 10, 6, 7, d?.summary.missedIncoming || 5]}
          trend={{ value: d ? `${Math.round((d.summary.missedIncoming / Math.max(1, d.summary.totalCalls)) * 100)}%` : '0%', isPositive: false, label: 'of total calls' }}
        />
        <KpiCard
          title="NOT ANSWERED OUTGOING"
          value={d ? d.summary.missedOutgoing.toLocaleString('en-IN') : '—'}
          subtitle="Customer did not pick up"
          icon={PhoneMissed}
          colorScheme="amber"
          chartType="bar"
          chartData={[3, 6, 8, 5, 9, 4, d?.summary.missedOutgoing || 4]}
          trend={{ value: d ? `${Math.round((d.summary.missedOutgoing / Math.max(1, d.summary.totalCalls)) * 100)}%` : '0%', isPositive: false, label: 'of total calls' }}
        />
        <KpiCard
          title="TOTAL UNANSWERED"
          value={d ? d.summary.totalUnanswered.toLocaleString('en-IN') : '—'}
          subtitle={d ? `${d.summary.unansweredRate}% unanswered rate` : '—'}
          icon={PhoneMissed}
          colorScheme="purple"
          chartType="area"
          chartData={[8, 14, 12, 15, 15, 11, d?.summary.totalUnanswered || 9]}
          trend={{ value: `${d?.summary.unansweredRate || 0}%`, isPositive: false, label: 'missed / no answer' }}
        />
        <KpiCard
          title="TOTAL TALK TIME"
          value={d ? d.summary.totalDurationLabel : '—'}
          subtitle={d ? `Avg ${d.summary.avgDurationLabel} / call` : '—'}
          icon={Clock}
          colorScheme="blue"
          chartType="bar"
          chartData={d?.sparklines?.durationSeries || [15, 30, 45, 25, 60, 50, 85]}
          trend={{ value: `${d?.summary.recordingCoverage || 0}%`, isPositive: true, label: 'recordings' }}
        />
      </div>

      {/* Sub-Tabs Selector */}
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setSubTab('overview')}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab === 'overview'
              ? 'border-[#004e5a] text-[#004e5a]'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <Building2 className="h-4 w-4" />
          <span>Overview & Trends</span>
        </button>

        <button
          onClick={() => setSubTab('branch_performance')}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab === 'branch_performance'
              ? 'border-[#004e5a] text-[#004e5a]'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <Building2 className="h-4 w-4" />
          <span>Branch-Wise Call Performance</span>
        </button>

        <button
          onClick={() => setSubTab('cre_performance')}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab === 'cre_performance'
              ? 'border-[#004e5a] text-[#004e5a]'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <Award className="h-4 w-4" />
          <span>CRE Staff Scorecard</span>
        </button>

        <button
          onClick={() => { setSubTab('recordings'); setPage(1) }}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab === 'recordings'
              ? 'border-[#004e5a] text-[#004e5a]'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <FileAudio className="h-4 w-4" />
          <span>Uploaded Call Recordings</span>
        </button>

        <button
          onClick={() => { setSubTab('pending'); setPage(1) }}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab === 'pending'
              ? 'border-[#004e5a] text-[#004e5a]'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <Clock className="h-4 w-4" />
          <span>Uploading & Pending Calls</span>
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {subTab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
                Daily Call Volume & Missed Calls Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 h-[280px]">
              {d?.dailyTrend && d.dailyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontWeight: 'bold' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                    <Bar dataKey="calls" name="Total Calls" fill="#004e5a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="missedIncoming" name="Missed Incoming" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="missedOutgoing" name="Not Answered Outgoing" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-400">
                  No call volume trend data available for this range.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
                Call Status & Outcome Mix
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 h-[280px] flex items-center justify-center">
              {d?.callTypeMix && d.callTypeMix.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={d.callTypeMix}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {d.callTypeMix.map((entry, idx) => (
                        <Cell
                          key={`cell-${idx}`}
                          fill={
                            entry.name.includes('Outgoing') && !entry.name.includes('Missed')
                              ? '#004e5a'
                              : entry.name.includes('Incoming') && !entry.name.includes('Missed')
                              ? '#10b981'
                              : entry.name.includes('Missed Incoming')
                              ? '#f43f5e'
                              : '#f59e0b'
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '14px', fontWeight: 'bold' }} />
                    <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-xs font-semibold text-slate-400">No call mix data</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: BRANCH PERFORMANCE */}
      {subTab === 'branch_performance' && (
        <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
                Branch-Wise Call Performance Breakdown
              </CardTitle>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Detailed call volume, connected calls, missed incoming, and unanswered outgoing calls grouped by dealership branch.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase text-slate-400">
                  <th className="py-3 px-4">Dealership Branch</th>
                  <th className="py-3 px-4 text-center">Total Calls</th>
                  <th className="py-3 px-4 text-center">Connected Outgoing</th>
                  <th className="py-3 px-4 text-center">Connected Incoming</th>
                  <th className="py-3 px-4 text-center">Missed Incoming</th>
                  <th className="py-3 px-4 text-center">Not Answered Outgoing</th>
                  <th className="py-3 px-4 text-center">Unanswered Rate</th>
                  <th className="py-3 px-4 text-center">Total Talk Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(d?.branchPerformance || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-semibold">
                      No branch performance metrics available for the selected filters.
                    </td>
                  </tr>
                ) : (
                  (d?.branchPerformance || []).map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <div className="h-7 w-7 rounded-xl bg-[#004e5a]/10 text-[#004e5a] font-black flex items-center justify-center text-[10px]">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <span>{b.name}</span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-900">{b.calls}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-[#004e5a]">{b.connectedOutgoing}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-emerald-600">{b.connectedIncoming}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-rose-600">{b.missedIncoming}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-amber-600">{b.missedOutgoing}</td>
                      <td className="py-3.5 px-4 text-center font-bold">
                        <span className={cn(
                          'px-2.5 py-0.5 rounded-full text-[10px] font-black border',
                          b.unansweredRate > 30 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        )}>
                          {b.unansweredRate}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">{b.durationLabel}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* TAB 3: CRE PERFORMANCE SCORECARD */}
      {subTab === 'cre_performance' && (
        <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
              CRE Staff Performance Scorecard
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase text-slate-400">
                  <th className="py-3 px-4">CRE Agent Name</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4 text-center">Total Calls</th>
                  <th className="py-3 px-4 text-center">Connected Calls</th>
                  <th className="py-3 px-4 text-center">Connect Rate</th>
                  <th className="py-3 px-4 text-center">Missed Incoming</th>
                  <th className="py-3 px-4 text-center">Not Answered Outgoing</th>
                  <th className="py-3 px-4 text-center">Total Talk Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(d?.agents || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-semibold">
                      No CRE agent performance metrics recorded yet.
                    </td>
                  </tr>
                ) : (
                  (d?.agents || []).map((ag) => (
                    <tr key={ag.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-[#004e5a]/10 text-[#004e5a] font-black flex items-center justify-center text-[10px]">
                          {ag.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span>{ag.name}</span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-600">{ag.branchName || 'General'}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-800">{ag.calls}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-emerald-600">{ag.recordings}</td>
                      <td className="py-3.5 px-4 text-center font-bold">
                        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-[10px] font-black border border-emerald-200">
                          {ag.connectRate || 0}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-rose-600">{ag.missedIncoming || 0}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-amber-600">{ag.missedOutgoing || 0}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">{ag.durationLabel}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* TAB 4: UPLOADED AUDIO RECORDINGS & PLAYER */}
      {subTab === 'recordings' && (
        <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
                Uploaded Call Recordings & Audio Playback
              </CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Only showing calls with completed audio file uploads ready for playback.
              </p>
            </div>
          </CardHeader>

          <CardContent className="p-0 overflow-x-auto">
            {callsQuery.isFetching ? (
              <div className="flex py-12 items-center justify-center text-slate-400 gap-2 text-xs font-bold">
                <Loader2 className="h-4 w-4 animate-spin text-[#004e5a]" />
                <span>Loading completed call recordings...</span>
              </div>
            ) : (callsQuery.data?.rows || []).length === 0 ? (
              <div className="py-12 text-center text-slate-400 font-semibold text-xs">
                No uploaded call recordings found for the selected filter criteria.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase text-slate-400">
                    <th className="py-3 px-4">CRE Agent</th>
                    <th className="py-3 px-4">Branch</th>
                    <th className="py-3 px-4">Customer Phone</th>
                    <th className="py-3 px-4 text-center">Status / Type</th>
                    <th className="py-3 px-4 text-center">Duration</th>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4 text-center">Audio Player</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {callsQuery.data?.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                        {row.creName}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-600">
                        {row.branchName || 'General'}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-700">
                        {row.phone}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={cn(
                          'px-2.5 py-0.5 rounded-full text-[10px] font-black border',
                          row.statusBadgeClass || 'bg-slate-100 text-slate-700 border-slate-200'
                        )}>
                          {row.statusLabel || row.callType}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                        {dur(row.durationSeconds)}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-500 whitespace-nowrap">
                        {formatDate(row.recordedAt)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {row.audioUrl ? (
                          <div className="flex items-center justify-center gap-2">
                            <audio controls src={row.audioUrl} className="h-8 max-w-[220px] rounded-lg" />
                            <a
                              href={row.audioUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="h-8 w-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 transition-colors"
                              title="Download audio recording"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Pagination Controls */}
            {callsQuery.data?.pagination && callsQuery.data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-500">
                  Page {callsQuery.data.pagination.page} of {callsQuery.data.pagination.totalPages} ({callsQuery.data.pagination.total} recordings)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl text-xs font-bold"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                  </Button>
                  <Button
                    disabled={page >= callsQuery.data.pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl text-xs font-bold"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 5: UPLOADING & PENDING CALLS QUEUE */}
      {subTab === 'pending' && (
        <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
                Uploading & Pending Calls Queue
              </CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Calls registered by CRE handsets where audio recording upload is pending or currently in progress.
              </p>
            </div>
          </CardHeader>

          <CardContent className="p-0 overflow-x-auto">
            {pendingCallsQuery.isFetching ? (
              <div className="flex py-12 items-center justify-center text-slate-400 gap-2 text-xs font-bold">
                <Loader2 className="h-4 w-4 animate-spin text-[#004e5a]" />
                <span>Loading pending calls queue...</span>
              </div>
            ) : (pendingCallsQuery.data?.rows || []).length === 0 ? (
              <div className="py-12 text-center text-emerald-600 font-bold text-xs">
                All call recordings are fully uploaded and synced! No pending uploads in queue.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase text-slate-400">
                    <th className="py-3 px-4">CRE Agent</th>
                    <th className="py-3 px-4">Branch</th>
                    <th className="py-3 px-4">Customer Phone</th>
                    <th className="py-3 px-4 text-center">Status / Direction</th>
                    <th className="py-3 px-4 text-center">Duration</th>
                    <th className="py-3 px-4">Recorded At</th>
                    <th className="py-3 px-4 text-center">Sync / Upload Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingCallsQuery.data?.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                        {row.creName}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-600">
                        {row.branchName || 'General'}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-700">
                        {row.phone}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={cn(
                          'px-2.5 py-0.5 rounded-full text-[10px] font-black border',
                          row.statusBadgeClass || 'bg-slate-100 text-slate-700 border-slate-200'
                        )}>
                          {row.statusLabel || row.callType}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                        {dur(row.durationSeconds)}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-500 whitespace-nowrap">
                        {formatDate(row.recordedAt)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
                          <Loader2 className="h-3 w-3 animate-spin text-amber-600" />
                          Uploading / Pending Sync
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Pagination Controls */}
            {pendingCallsQuery.data?.pagination && pendingCallsQuery.data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-500">
                  Page {pendingCallsQuery.data.pagination.page} of {pendingCallsQuery.data.pagination.totalPages} ({pendingCallsQuery.data.pagination.total} pending calls)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl text-xs font-bold"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                  </Button>
                  <Button
                    disabled={page >= pendingCallsQuery.data.pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl text-xs font-bold"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
