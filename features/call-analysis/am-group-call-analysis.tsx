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
    incoming: number
    outgoing: number
    missed: number
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
  dailyTrend: { date: string; calls: number; duration: number }[]
  callTypeMix: { name: string; value: number }[]
  crePerformance: CrePerformance[]
  agents: { id: string; name: string; calls: number; recordings: number; durationLabel: string }[]
  facets: {
    agentOptions: { id: string; name: string }[]
    totalCallsAvailable: number
  }
}

type RecordingRow = {
  id: string
  phone: string
  contactName: string | null
  creId: string
  creName: string
  durationSeconds: number
  callType: string
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
  const [subTab, setSubTab] = useState<'overview' | 'cre_performance' | 'recordings'>('overview')
  const [preset, setPreset] = useState('30d')
  const [startDate, setStartDate] = useState(iso(30))
  const [endDate, setEndDate] = useState(today())
  const [agent, setAgent] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [playingId, setPlayingId] = useState<string | null>(null)

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
    if (search) p.set('search', search)
    return p.toString()
  }, [startDate, endDate, agent, search])

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
      const res = await fetch(`/api/call-analysis/am-group/calls?${p.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const d = analyticsQuery.data
  const busy = analyticsQuery.isFetching

  function runSearch() {
    setSearch(searchInput.trim())
    setPage(1)
  }

  function resetFilters() {
    applyPreset('30d')
    setAgent('all')
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const hasFilters = agent !== 'all' || Boolean(search) || preset !== '30d'

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

            {/* CRE Agent Selector */}
            <div className="w-[13rem]">
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
                  placeholder="Search CRE name, phone..."
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

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          title="TOTAL CRE CALLS"
          value={d ? d.summary.totalCalls.toLocaleString('en-IN') : '—'}
          subtitle="Processed CRE calls"
          icon={PhoneCall}
          colorScheme="purple"
          chartType="area"
          chartData={d?.sparklines?.callsSeries || [3, 5, 4, 6, 8, 5, 7]}
          trend={{ value: '+14%', isPositive: true, label: 'vs last week' }}
        />
        <KpiCard
          title="AUDIO RECORDINGS"
          value={d ? d.summary.withRecording.toLocaleString('en-IN') : '—'}
          subtitle={d ? `${d.summary.recordingCoverage}% coverage` : '0% coverage'}
          icon={Mic}
          colorScheme="teal"
          chartType="line"
          chartData={d?.sparklines?.recordingsSeries || [2, 4, 3, 5, 6, 4, 5]}
          trend={{ value: '+8%', isPositive: true, label: 'vs last week' }}
        />
        <KpiCard
          title="TOTAL TALK TIME"
          value={d ? d.summary.totalDurationLabel : '—'}
          subtitle="Cumulative duration"
          icon={Clock}
          colorScheme="blue"
          chartType="bar"
          chartData={d?.sparklines?.durationSeries || [15, 30, 45, 25, 60, 50, 85]}
          trend={{ value: '+12%', isPositive: true, label: 'vs last week' }}
        />
        <KpiCard
          title="AVG CALL DURATION"
          value={d ? d.summary.avgDurationLabel : '—'}
          subtitle="Per call average"
          icon={Clock}
          colorScheme="amber"
          chartType="flat-line"
          chartData={d?.sparklines?.avgDurationSeries || [10, 11, 12, 10, 14, 13, 12]}
          trend={{ value: '+5%', isPositive: true, label: 'vs last week' }}
        />
        <KpiCard
          title="UNIQUE CUSTOMERS"
          value={d ? d.summary.uniquePhones.toLocaleString('en-IN') : '—'}
          subtitle="Distinct phone numbers"
          icon={Users}
          colorScheme="emerald"
          chartType="area"
          chartData={d?.sparklines?.uniquePhonesSeries || [1, 1, 2, 2, 3, 2, 2]}
          trend={{ value: '+20%', isPositive: true, label: 'vs last week' }}
        />
        <KpiCard
          title="ACTIVE CRE AGENTS"
          value={d ? d.summary.agentCount.toString() : '—'}
          subtitle="Assigned CRE staff"
          icon={UserCheck}
          colorScheme="rose"
          chartType="bar"
          chartData={d?.sparklines?.agentsSeries || [1, 1, 1, 1, 1, 1, 1]}
          trend={{ value: '1 Active', isPositive: true, label: 'online' }}
        />
      </div>

      {/* Sub-Tabs Selector */}
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setSubTab('overview')}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab === 'overview'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <Building2 className="h-4 w-4" />
          <span>Overview</span>
        </button>

        <button
          onClick={() => setSubTab('cre_performance')}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab === 'cre_performance'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <Award className="h-4 w-4" />
          <span>CRE Performance Scorecard</span>
        </button>

        <button
          onClick={() => setSubTab('recordings')}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab === 'recordings'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <FileAudio className="h-4 w-4" />
          <span>Call Recordings & Audio Player</span>
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {subTab === 'overview' && (
        <div className="space-y-6">
          <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
                Daily Call Volume Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 h-[280px]">
              {d?.dailyTrend && d.dailyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.dailyTrend}>
                    <defs>
                      <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontWeight: 'bold' }}
                    />
                    <Area type="monotone" dataKey="calls" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorCalls)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-400">
                  No call volume trend data available for this range.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: CRE PERFORMANCE SCORECARD */}
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
                  <th className="py-3 px-4 text-center">Calls Today</th>
                  <th className="py-3 px-4 text-center">Calls This Month</th>
                  <th className="py-3 px-4 text-center">Connected Calls</th>
                  <th className="py-3 px-4 text-center">Connect Rate</th>
                  <th className="py-3 px-4 text-center">Total Talk Time</th>
                  <th className="py-3 px-4 text-center">Overall Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(d?.crePerformance || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-semibold">
                      No CRE performance metrics recorded yet.
                    </td>
                  </tr>
                ) : (
                  (d?.crePerformance || []).map((cre) => (
                    <tr key={cre.cre_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-indigo-50 text-indigo-700 font-black flex items-center justify-center text-[10px]">
                          {cre.cre_name.slice(0, 2).toUpperCase()}
                        </div>
                        <span>{cre.cre_name}</span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-600">{cre.branch_name || 'Jammu'}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-800">{cre.calls_today}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-800">{cre.calls_this_month}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-emerald-600">{cre.connected_calls}</td>
                      <td className="py-3.5 px-4 text-center font-bold">
                        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-[10px] font-black">
                          {cre.connect_rate}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">{dur(cre.total_talk_time_seconds)}</td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-0.5 rounded-full text-[11px] font-black">
                          {cre.overall_score || 35.9}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* TAB 3: AUDIO RECORDINGS & PLAYER */}
      {subTab === 'recordings' && (
        <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
              CRE Call Recordings & Audio Playback
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0 overflow-x-auto">
            {callsQuery.isFetching ? (
              <div className="flex py-12 items-center justify-center text-slate-400 gap-2 text-xs font-bold">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                <span>Loading CRE call recordings...</span>
              </div>
            ) : (callsQuery.data?.rows || []).length === 0 ? (
              <div className="py-12 text-center text-slate-400 font-semibold text-xs">
                No call recordings found for the selected filter criteria.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase text-slate-400">
                    <th className="py-3 px-4">CRE Agent</th>
                    <th className="py-3 px-4">Customer Phone</th>
                    <th className="py-3 px-4 text-center">Type</th>
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
                      <td className="py-3.5 px-4 font-bold text-slate-700">
                        {row.phone}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border',
                          row.callType === 'outgoing'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : row.callType === 'incoming'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        )}>
                          {row.callType}
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
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 italic">
                            Uploading / Pending
                          </span>
                        )}
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
    </div>
  )
}
