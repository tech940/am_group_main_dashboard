'use client'

import React, { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  Loader2, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Users,
  Mic, Search, X, ChevronLeft, ChevronRight, Download, AlertTriangle, TrendingUp,
  Filter,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Completeness, HandsetHealth } from '@/lib/callyzer/health'

type Facets = {
  agents: { number: string; name: string; tags: string[] }[]
  callTypes: string[]
  minDate: string | null
  maxDate: string | null
  totalCallsAvailable: number
}
type ClientRow = {
  number: string; name: string; calls: number; incoming: number; outgoing: number
  missed: number; connected: number; duration: number; durationLabel: string
  lastDate: string; lastTime: string; agents: string[]
  matchedName: string | null; matchedBooking: string | null; matchedModel: string | null
  matchedStatus: string | null; matchedConsultant: string | null; matchedSource: string | null
}
type Analytics = {
  summary: {
    totalCalls: number; incoming: number; outgoing: number; missed: number; rejected: number
    connected: number; notConnected: number; connectRate: number
    totalDuration: number; totalDurationLabel: string; avgCallDuration: number
    uniqueClients: number; activeDays: number; avgCallsPerDay: number
    withRecording: number; recordingCoverage: number; neverConnectedClients: number; agentCount: number
    excludedCalls: number; excludedNumbers: number
  }
  callTypeMix: { name: string; value: number }[]
  dailyTrend: { date: string; calls: number; connected: number; duration: number; missed: number }[]
  hourly: { hour: number; label: string; calls: number; connected: number; duration: number; connectRate: number; reliable: boolean }[]
  weekday: { day: string; short: string; calls: number; connected: number; duration: number; connectRate: number }[]
  agents: {
    empNumber: string; empName: string; tags: string[]; calls: number; incoming: number
    outgoing: number; missed: number; rejected: number; connected: number; duration: number
    durationLabel: string; uniqueClients: number; recordings: number; connectRate: number; avgDuration: number
  }[]
  topClients: ClientRow[]
  topClientsTotal: number
  neverConnectedTotal: number
  channels: {
    number: string; label: string; reason: string; calls: number; incoming: number
    outgoing: number; missed: number; connected: number; duration: number
    durationLabel: string; missedRate: number
  }[]
  neverConnected: (Pick<ClientRow, 'number' | 'name' | 'calls' | 'missed' | 'lastDate' | 'lastTime' | 'agents'
    | 'matchedName' | 'matchedBooking' | 'matchedModel' | 'matchedSource'>)[]
  syncState?: {
    lastSyncedAt: string | null; lastRunStatus: string | null; totalCalls: number
    handsets: HandsetHealth[] | null; handsetsCheckedAt: string | null
    completeness: Completeness | null; completenessCheckedAt: string | null
  }
  facets: Facets
}
type CallRow = {
  id: string; clientNumber: string; clientName: string; duration: number; callType: string
  callDate: string; callTime: string; note: string; empName: string; empTags: string[]
  hasRecording: boolean; matchedName: string | null; matchedBooking: string | null
  matchedModel: string | null; matchedSource: string | null
}

/**
 * Feed health. This page reads a synced table, so a dead handset and a quiet week look identical —
 * the numbers simply stop growing. These are the only two signals that tell them apart, and neither
 * can be derived from the call rows themselves.
 */
function FeedHealthStrip({ sync }: { sync: Analytics['syncState'] }) {
  if (!sync) return null
  const handsets = sync.handsets || []
  const comp = sync.completeness
  const problem = handsets.filter((h) => h.status !== 'ok')

  const TONE: Record<HandsetHealth['status'], { cls: string; label: (h: HandsetHealth) => string }> = {
    ok: { cls: 'text-emerald-600', label: (h) => `checked in ${h.hoursSinceSync}h ago` },
    stale: { cls: 'text-amber-600', label: (h) => `silent ${h.hoursSinceSync}h` },
    offline: { cls: 'text-rose-600', label: (h) => (h.hoursSinceSync === null ? 'never checked in' : `SILENT ${h.hoursSinceSync}h`) },
    uninstalled: { cls: 'text-rose-600', label: () => 'APP UNINSTALLED' },
    recording_off: { cls: 'text-rose-600', label: () => 'RECORDING OFF' },
  }

  return (
    <div className={cn(
      'rounded-2xl border p-3',
      problem.length || (comp && !comp.inSync)
        ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20'
        : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
    )}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Feed health</span>

        {handsets.length === 0 ? (
          <span className="text-[11px] font-semibold text-slate-400">
            Handsets not checked yet — runs on the next sync.
          </span>
        ) : handsets.map((h) => {
          const tone = TONE[h.status] || TONE.ok
          return (
            <span key={h.empNumber || h.empName} className="flex items-center gap-1.5 text-[11px]">
              <span className={cn('text-[13px] leading-none', tone.cls)}>●</span>
              <span className="font-bold text-slate-700 dark:text-slate-200">{h.empName}</span>
              <span className={cn('font-semibold', tone.cls)}>{tone.label(h)}</span>
              <span className="text-[10px] font-medium text-slate-400" title={`${h.deviceModel} · Android ${h.androidVersion} · app ${h.appVersion}`}>
                {h.tags[0] || ''}
              </span>
            </span>
          )
        })}

        {comp && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px]" title={
            comp.byType.map((b) => `${b.type}: ours ${b.ours} / Callyzer ${b.theirs}`).join('\n')
          }>
            <span className={cn('text-[13px] leading-none', comp.inSync ? 'text-emerald-600' : 'text-rose-600')}>●</span>
            <span className="font-semibold text-slate-500">
              {comp.inSync
                ? `Complete for ${shortDate(comp.windowFrom)}–${shortDate(comp.windowTo)} (${nfmt(comp.ours)} calls, matches Callyzer)`
                : `${Math.abs(comp.delta)} call${Math.abs(comp.delta) === 1 ? '' : 's'} ${comp.delta < 0 ? 'MISSING vs' : 'more than'} Callyzer for ${shortDate(comp.windowFrom)}–${shortDate(comp.windowTo)}`}
            </span>
          </span>
        )}
      </div>

      {problem.length > 0 && (
        <p className="mt-2 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
          {problem.map((h) => h.empName).join(', ')} {problem.length === 1 ? 'is' : 'are'} not reporting normally —
          calls made on {problem.length === 1 ? 'that phone' : 'those phones'} are not reaching this page.
        </p>
      )}
    </div>
  )
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'agents', label: 'Agents' },
  { key: 'timing', label: 'Timing' },
  { key: 'customers', label: 'Customers' },
  { key: 'gaps', label: 'Missed Opportunities' },
  { key: 'log', label: 'Call Log & Recordings' },
] as const
type TabKey = (typeof TABS)[number]['key']

const PRESETS = [
  { key: '7d', label: '7 Days', days: 7 },
  { key: '30d', label: '30 Days', days: 30 },
  { key: '90d', label: '90 Days', days: 90 },
  { key: 'all', label: 'All Time', days: 0 },
]

const CHART_COLORS = ['var(--dashboard-primary)', 'var(--dashboard-support-1)', 'var(--dashboard-support-2)', 'var(--dashboard-support-3)']

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
function nfmt(n: number) { return Math.round(n || 0).toLocaleString('en-IN') }
function shortDate(d: string) {
  if (!d) return ''
  const dt = new Date(`${d}T00:00:00`)
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export function CallAnalysisPage() {
  const [tab, setTab] = useState<TabKey>('overview')
  const [preset, setPreset] = useState('30d')
  const [startDate, setStartDate] = useState(iso(30))
  const [endDate, setEndDate] = useState(today())
  const [agent, setAgent] = useState('all')
  const [callType, setCallType] = useState('all')
  const [minDuration, setMinDuration] = useState('0')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [recordingsOnly, setRecordingsOnly] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)

  function applyPreset(key: string) {
    setPreset(key); setPage(1)
    const p = PRESETS.find((x) => x.key === key)
    if (!p) return
    if (p.days === 0) { setStartDate(''); setEndDate('') }
    else { setStartDate(iso(p.days)); setEndDate(today()) }
  }

  const filterParams = useMemo(() => {
    const p = new URLSearchParams()
    if (startDate) p.set('startDate', startDate)
    if (endDate) p.set('endDate', endDate)
    if (agent !== 'all') p.set('agent', agent)
    if (callType !== 'all') p.set('callType', callType)
    if (Number(minDuration) > 0) p.set('minDuration', minDuration)
    if (search) p.set('search', search)
    return p.toString()
  }, [startDate, endDate, agent, callType, minDuration, search])

  const analyticsQuery = useQuery<Analytics>({
    queryKey: ['call-analysis', filterParams],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/call-analysis?${filterParams}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const callsQuery = useQuery<{ rows: CallRow[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>({
    queryKey: ['call-analysis-log', filterParams, page, recordingsOnly],
    enabled: tab === 'log',
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams(filterParams)
      p.set('page', String(page)); p.set('pageSize', '25')
      if (recordingsOnly) p.set('recordingsOnly', 'true')
      const res = await fetch(`/api/call-analysis/calls?${p.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const d = analyticsQuery.data
  const busy = analyticsQuery.isFetching

  function runSearch() { setSearch(searchInput.trim()); setPage(1) }
  function resetFilters() {
    applyPreset('30d'); setAgent('all'); setCallType('all'); setMinDuration('0')
    setSearchInput(''); setSearch(''); setPage(1)
  }
  const hasFilters = agent !== 'all' || callType !== 'all' || Number(minDuration) > 0 || Boolean(search) || preset !== '30d'

  return (
    <MainLayout title="Call Analysis" subtitle="Call volume, agent performance, customer matching & recordings">
      <div className="space-y-5">
        {/* ── Filters ─────────────────────────────────────────────── */}
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {PRESETS.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => applyPreset(o.key)}
                    style={preset === o.key ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' } : undefined}
                    className={cn('cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                      preset !== o.key && 'text-slate-600 hover:text-slate-900 dark:text-slate-300')}
                  >{o.label}</button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <Input type="date" value={startDate} aria-label="Start date"
                  onChange={(e) => { setStartDate(e.target.value); setPreset('custom'); setPage(1) }}
                  className="h-9 w-[9.5rem] rounded-xl text-xs font-bold" />
                <span className="text-xs font-black text-slate-400">→</span>
                <Input type="date" value={endDate} aria-label="End date"
                  onChange={(e) => { setEndDate(e.target.value); setPreset('custom'); setPage(1) }}
                  className="h-9 w-[9.5rem] rounded-xl text-xs font-bold" />
              </div>

              <Select value={agent} onValueChange={(v) => { setAgent(v); setPage(1) }}>
                <SelectTrigger className="h-9 w-48 rounded-xl text-xs font-bold"><SelectValue placeholder="All agents" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {(d?.facets.agents || []).map((a) => (
                    <SelectItem key={a.number} value={a.number}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={callType} onValueChange={(v) => { setCallType(v); setPage(1) }}>
                <SelectTrigger className="h-9 w-40 rounded-xl text-xs font-bold"><SelectValue placeholder="All types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All call types</SelectItem>
                  {(d?.facets.callTypes || []).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={minDuration} onValueChange={(v) => { setMinDuration(v); setPage(1) }}>
                <SelectTrigger className="h-9 w-44 rounded-xl text-xs font-bold"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Any duration</SelectItem>
                  <SelectItem value="3">Connected (&gt;2s)</SelectItem>
                  <SelectItem value="30">30s or longer</SelectItem>
                  <SelectItem value="60">1 min or longer</SelectItem>
                  <SelectItem value="300">5 min or longer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="relative min-w-[16rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
                  placeholder="Search phone number, customer, agent or note…"
                  className="h-9 rounded-xl pl-9 text-xs font-semibold" />
              </div>
              <Button onClick={runSearch} className="h-9 rounded-xl px-5 text-xs font-black uppercase tracking-wider"
                style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}>Search</Button>
              {hasFilters && (
                <Button onClick={resetFilters} variant="outline" className="h-9 rounded-xl px-3 text-xs font-bold">
                  <X className="mr-1 h-3.5 w-3.5" /> Reset
                </Button>
              )}
              {d?.facets && (
                <span className="ml-auto text-[11px] font-bold text-slate-400">
                  {nfmt(d.facets.totalCallsAvailable)} calls in range
                  {d.facets.minDate ? ` · ${shortDate(d.facets.minDate)} – ${shortDate(d.facets.maxDate || '')}` : ''}
                  {/* Synced data, not live — say so, so nobody reads a stale figure as current. */}
                  {d.syncState?.lastSyncedAt ? ` · synced ${new Date(d.syncState.lastSyncedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={tab === t.key ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' } : undefined}
              className={cn('cursor-pointer rounded-xl border px-4 py-2 text-xs font-black transition-colors',
                tab === t.key ? 'border-transparent shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300')}
            >{t.label}</button>
          ))}
        </div>

        {analyticsQuery.isLoading ? (
          <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <Loader2 className="h-7 w-7 animate-spin" style={{ color: 'var(--dashboard-primary)' }} />
            <p className="text-xs font-bold text-slate-500">Loading call data…</p>
            {/* The old copy here claimed the first load fetches from Callyzer. It does not — the whole
                architecture exists so the UI never calls them — and it taught the reader to accept
                slow loads as normal. */}
            <p className="text-[11px] text-slate-400">Reading synced call records.</p>
          </div>
        ) : analyticsQuery.isError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">
            {(analyticsQuery.error as Error)?.message || 'Failed to load call analysis.'}
          </div>
        ) : d ? (
          <div className={cn('space-y-5 transition-opacity', busy && 'opacity-60')}>
            {/* Above the KPIs on purpose: if the feed is broken, every number below it is suspect. */}
            <FeedHealthStrip sync={d.syncState} />

            {/* KPI strip — always visible, every tab */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <Kpi icon={<PhoneCall className="h-4 w-4" />} label="Total calls" value={nfmt(d.summary.totalCalls)} sub={`${d.summary.avgCallsPerDay}/day avg`} />
              <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Connect rate" value={`${d.summary.connectRate}%`} sub={`${nfmt(d.summary.connected)} connected`} tone="ok" />
              <Kpi icon={<Clock className="h-4 w-4" />} label="Talk time" value={d.summary.totalDurationLabel} sub={`avg ${dur(d.summary.avgCallDuration)}`} />
              <Kpi icon={<PhoneMissed className="h-4 w-4" />} label="Missed" value={nfmt(d.summary.missed)} sub={`${nfmt(d.summary.rejected)} rejected`} tone="bad" />
              <Kpi icon={<Users className="h-4 w-4" />} label="Unique customers" value={nfmt(d.summary.uniqueClients)} sub={`${d.summary.agentCount} agents`} />
              <Kpi icon={<Mic className="h-4 w-4" />} label="Recorded" value={`${d.summary.recordingCoverage}%`} sub={`${nfmt(d.summary.withRecording)} calls`} />
            </div>

            {tab === 'overview' && <OverviewTab d={d} />}
            {tab === 'agents' && <AgentsTab d={d} />}
            {tab === 'timing' && <TimingTab d={d} />}
            {tab === 'customers' && <CustomersTab d={d} />}
            {tab === 'gaps' && <GapsTab d={d} />}
            {tab === 'log' && (
              <LogTab
                query={callsQuery} page={page} setPage={setPage}
                recordingsOnly={recordingsOnly}
                setRecordingsOnly={(v) => { setRecordingsOnly(v); setPage(1) }}
                playing={playing} setPlaying={setPlaying}
              />
            )}
          </div>
        ) : null}
      </div>
    </MainLayout>
  )
}

/* ── shared bits ─────────────────────────────────────────────── */

function Kpi({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; tone?: 'ok' | 'bad'
}) {
  const color = tone === 'ok' ? 'var(--dashboard-success-text)' : tone === 'bad' ? '#e11d48' : 'var(--dashboard-primary)'
  return (
    <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5" style={{ color }}>
          {icon}<span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span>
        </div>
        <p className="mt-1 text-2xl font-black" style={{ color }}>{value}</p>
        {sub && <p className="text-[10px] font-bold text-slate-400">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function Panel({ title, subtitle, children, className, action }: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string; action?: React.ReactNode
}) {
  return (
    <Card className={cn('rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900', className)}>
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-black uppercase tracking-wider text-slate-500">{title}</p>
            {subtitle && <p className="text-[11px] font-medium text-slate-400">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/**
 * Phone numbers are the one thing on this page someone wants to ACT on, and the primary reader is
 * the MD, often on a phone. Rendering them as inert monospace text meant the obvious gesture — tap
 * to ring back — did nothing.
 */
function PhoneCell({ number }: { number: string }) {
  if (!number) return <span className="text-[12px] font-semibold text-slate-400">—</span>
  return (
    <a href={`tel:${number.replace(/[^\d+]/g, '')}`}
      className="font-mono text-[12px] font-bold text-slate-900 underline-offset-2 hover:underline dark:text-slate-100"
      title={`Call ${number}`}>
      {number}
    </a>
  )
}

function CsvButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}
      className="h-8 rounded-lg border-slate-200 text-[11px] font-bold dark:border-slate-700">
      <Download className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> {label}
    </Button>
  )
}

const csvEscape = (v: string | number) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  if (typeof document === 'undefined' || rows.length === 0) return
  const lines = [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportCustomersCsv(rows: ClientRow[]) {
  downloadCsv(`call-analysis-customers-${today()}.csv`,
    ['Number', 'Matched customer', 'Source', 'Booking', 'Model', 'Calls', 'In', 'Out', 'Missed', 'Talk time', 'Last call', 'Handled by'],
    rows.map((c) => [
      c.number, c.matchedName || '', c.matchedSource || '', c.matchedBooking || '', c.matchedModel || '',
      c.calls, c.incoming, c.outgoing, c.missed, c.durationLabel,
      `${c.lastDate} ${c.lastTime}`.trim(), c.agents.join(' / '),
    ]))
}

/**
 * The callback list leaving the page and reaching a human. Until there is a real queue with owners,
 * this is how the never-connected list actually gets worked.
 */
function exportNeverConnectedCsv(rows: Analytics['neverConnected']) {
  downloadCsv(`call-analysis-never-connected-${today()}.csv`,
    ['Number', 'Matched customer', 'Source', 'Booking', 'Model', 'Attempts', 'Missed', 'Last attempt', 'Agent'],
    rows.map((c) => [
      c.number, c.matchedName || '', c.matchedSource || '', c.matchedBooking || '', c.matchedModel || '',
      c.calls, c.missed, `${c.lastDate} ${c.lastTime}`.trim(), c.agents.join(' / '),
    ]))
}

const tooltipStyle = {
  borderRadius: 12, border: '1px solid var(--kia-hairline, #e2e8f0)',
  background: 'var(--kia-surface, #fff)', fontSize: 12, fontWeight: 700,
}

function MatchBadge({ booking, model, source, name }: {
  booking: string | null; model: string | null; source: string | null; name: string | null
}) {
  if (!name && !booking) return <span className="text-[11px] font-semibold text-slate-400">Unknown</span>
  // Name the brand the record came from: most matches resolve against the Hyundai enquiry feed, and
  // a bare name with no origin leaves the reader unable to tell which system to go look in.
  const origin = booking ? booking : source === 'hyundai' ? 'Hyundai enquiry' : source === 'enquiry' ? 'KIA enquiry' : ''
  return (
    <div className="flex flex-col">
      <span className="text-[12px] font-bold text-slate-800 dark:text-slate-200">{name || '—'}</span>
      <span className="text-[10px] font-semibold text-slate-400">
        {origin}{model ? ` · ${model}` : ''}
      </span>
    </div>
  )
}

/* ── tabs ────────────────────────────────────────────────────── */

function OverviewTab({ d }: { d: Analytics }) {
  return (
    <div className="space-y-4">
      <Panel title="Daily call volume" subtitle="Total vs connected calls per day">
        <div className="h-72 w-full">
          {d.dailyTrend.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.dailyTrend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="cCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--dashboard-primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--dashboard-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#94a3b8' }}
                  interval={Math.max(0, Math.floor(d.dailyTrend.length / 12))} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(v) => shortDate(String(v))} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                <Area type="monotone" dataKey="calls" name="Total" stroke="var(--dashboard-primary)" strokeWidth={2} fill="url(#cCalls)" />
                <Area type="monotone" dataKey="connected" name="Connected" stroke="var(--dashboard-support-1)" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Call type mix" subtitle="Share of inbound, outbound and unanswered">
          <div className="h-64 w-full">
            {d.callTypeMix.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d.callTypeMix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {d.callTypeMix.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel title="Inbound vs outbound effort" subtitle="Where the talk time actually goes">
          <div className="space-y-3 pt-2">
            <Meter label="Incoming" value={d.summary.incoming} total={d.summary.totalCalls} color="var(--dashboard-primary)" />
            <Meter label="Outgoing" value={d.summary.outgoing} total={d.summary.totalCalls} color="var(--dashboard-support-1)" />
            <Meter label="Missed" value={d.summary.missed} total={d.summary.totalCalls} color="#f43f5e" />
            <Meter label="Rejected" value={d.summary.rejected} total={d.summary.totalCalls} color="#94a3b8" />
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Stat label="Connected" value={nfmt(d.summary.connected)} />
              <Stat label="Never connected" value={nfmt(d.summary.notConnected)} />
              <Stat label="Active days" value={nfmt(d.summary.activeDays)} />
              <Stat label="Avg call length" value={dur(d.summary.avgCallDuration)} />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function AgentsTab({ d }: { d: Analytics }) {
  return (
    <Panel title="Agent performance" subtitle="Every agent connected to Callyzer, ranked by volume">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40">
              {['Agent', 'Calls', 'In', 'Out', 'Missed', 'Connected', 'Connect %', 'Talk time', 'Avg call', 'Customers', 'Recorded'].map((h, i) => (
                <th key={h} className={cn('whitespace-nowrap px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-400', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.agents.length === 0 ? (
              <tr><td colSpan={11} className="p-10 text-center text-xs font-bold text-slate-400">No calls in this range.</td></tr>
            ) : d.agents.map((a) => (
              <tr key={a.empNumber || a.empName} className="border-b border-slate-50 last:border-0 dark:border-slate-800/60">
                <td className="px-3 py-3">
                  <div className="font-bold text-slate-900 dark:text-slate-100">{a.empName}</div>
                  <div className="text-[10px] font-semibold text-slate-400">
                    {a.empNumber}{a.tags.length ? ` · ${a.tags.join(', ')}` : ''}
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-black">{nfmt(a.calls)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{nfmt(a.incoming)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{nfmt(a.outgoing)}</td>
                <td className="px-3 py-3 text-right font-semibold" style={{ color: a.missed ? '#e11d48' : undefined }}>{nfmt(a.missed)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{nfmt(a.connected)}</td>
                <td className="px-3 py-3 text-right font-black" style={{ color: a.connectRate >= 60 ? 'var(--dashboard-success-text)' : a.connectRate >= 40 ? '#d97706' : '#e11d48' }}>{a.connectRate}%</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{a.durationLabel}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{dur(a.avgDuration)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{nfmt(a.uniqueClients)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{nfmt(a.recordings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function TimingTab({ d }: { d: Analytics }) {
  const peak = d.hourly.reduce((m, h) => (h.calls > m.calls ? h : m), d.hourly[0])
  return (
    <div className="space-y-4">
      <Panel title="When customers call" subtitle={peak && peak.calls > 0 ? `Busiest hour: ${peak.label} with ${nfmt(peak.calls)} calls` : 'Hour-of-day distribution'}>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.hourly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={1} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
              <Bar dataKey="calls" name="Calls" fill="var(--dashboard-primary)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="connected" name="Connected" fill="var(--dashboard-support-1)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Day of week" subtitle="Volume and connect rate by weekday">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.weekday} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="short" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="calls" name="Calls" fill="var(--dashboard-primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Ranked on RELIABLE hours only. Previously an hour holding a single 5-second call scored
            100% and sat at the top of a panel whose subtitle tells a manager to plan staffing around
            it. Thin hours are still shown — greyed and unranked — so the day is not silently cropped. */}
        <Panel title="Connect rate by hour" subtitle="Best hours to reach customers — hours with too few calls to rank are greyed">
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {[...d.hourly.filter((h) => h.calls > 0)]
              .sort((a, b) => Number(b.reliable) - Number(a.reliable) || b.connectRate - a.connectRate)
              .map((h) => (
                <div key={h.hour} className={`flex items-center gap-2 ${h.reliable ? '' : 'opacity-40'}`}>
                  <span className="w-12 shrink-0 text-[11px] font-bold text-slate-500">{h.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full" style={{
                      width: `${h.connectRate}%`,
                      backgroundColor: h.reliable ? 'var(--dashboard-primary)' : 'var(--dashboard-primary-light)',
                    }} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[11px] font-black text-slate-600">{h.connectRate}%</span>
                  <span className="w-14 shrink-0 text-right text-[10px] font-semibold text-slate-400">
                    {nfmt(h.calls)} call{h.calls === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
          </div>
          {d.hourly.some((h) => h.calls > 0 && !h.reliable) && (
            <p className="mt-2 text-[10px] font-semibold text-slate-400">
              Greyed hours have fewer than 10 calls — too thin for the percentage to mean anything.
            </p>
          )}
        </Panel>
      </div>
    </div>
  )
}

function CustomersTab({ d }: { d: Analytics }) {
  const matched = d.topClients.filter((c) => c.matchedName || c.matchedBooking).length
  return (
    <div className="space-y-4">
    {d.channels.length > 0 && <ChannelPanel d={d} />}
    <Panel title="Most-contacted customers"
      subtitle={`Showing ${d.topClients.length} of ${nfmt(d.topClientsTotal)} by call volume · ${matched} matched to a KIA booking or a KIA/Hyundai enquiry`}
      action={<CsvButton label={`Export ${d.topClients.length}`} onClick={() => exportCustomersCsv(d.topClients)} />}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40">
              {['Number', 'Matched customer', 'Calls', 'In', 'Out', 'Missed', 'Talk time', 'Last call', 'Handled by'].map((h, i) => (
                <th key={h} className={cn('whitespace-nowrap px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-400', i > 1 && i < 7 ? 'text-right' : 'text-left')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.topClients.length === 0 ? (
              <tr><td colSpan={9} className="p-10 text-center text-xs font-bold text-slate-400">No customers in this range.</td></tr>
            ) : d.topClients.map((c) => (
              <tr key={c.number} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 dark:border-slate-800/60">
                <td className="whitespace-nowrap px-3 py-3"><PhoneCell number={c.number} /></td>
                <td className="px-3 py-3"><MatchBadge name={c.matchedName} booking={c.matchedBooking} model={c.matchedModel} source={c.matchedSource} /></td>
                <td className="px-3 py-3 text-right font-black">{nfmt(c.calls)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{nfmt(c.incoming)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{nfmt(c.outgoing)}</td>
                <td className="px-3 py-3 text-right font-semibold" style={{ color: c.missed ? '#e11d48' : undefined }}>{nfmt(c.missed)}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-600">{c.durationLabel}</td>
                <td className="whitespace-nowrap px-3 py-3 text-[11px] font-semibold text-slate-500">{shortDate(c.lastDate)} {c.lastTime?.slice(0, 5)}</td>
                <td className="px-3 py-3 text-[11px] font-semibold text-slate-500">{c.agents.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
    </div>
  )
}

/**
 * The lead-routing trunk, reported as what it actually is. It is 27% of all call volume and is not a
 * person, so it does not belong in the customer table — but hiding it entirely would lose the one
 * number a dealer principal reacts to: how many paid-channel calls go unanswered.
 */
function ChannelPanel({ d }: { d: Analytics }) {
  return (
    <Panel title="Routing lines & internal numbers"
      subtitle={`${nfmt(d.summary.excludedCalls)} calls on ${nfmt(d.summary.excludedNumbers)} non-customer numbers — counted in the totals above, kept out of the customer lists`}>
      <div className="space-y-2">
        {d.channels.slice(0, 6).map((ch) => (
          <div key={ch.number} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-slate-800">
            <span className="font-mono text-[12px] font-bold text-slate-900 dark:text-slate-100">{ch.number}</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-800">{ch.label}</span>
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{nfmt(ch.calls)} calls</span>
            <span className="text-[11px] font-semibold text-slate-500">{ch.durationLabel} talk time</span>
            <span className="ml-auto text-[11px] font-black" style={{ color: ch.missedRate >= 10 ? '#e11d48' : 'var(--dashboard-success-text)' }}>
              {nfmt(ch.missed)} missed ({ch.missedRate}%)
            </span>
          </div>
        ))}
        {d.channels.length > 6 && (
          <p className="text-[10px] font-semibold text-slate-400">+{d.channels.length - 6} more non-customer numbers.</p>
        )}
      </div>
    </Panel>
  )
}

function GapsTab({ d }: { d: Analytics }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-black text-amber-900 dark:text-amber-200">
            {nfmt(d.summary.neverConnectedClients)} customers were never actually spoken to
          </p>
          <p className="mt-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
            Every number below rang — inbound or outbound — but no call ever connected in this period.
            Where we recognise the number, the booking or enquiry is shown so it can be picked up.
          </p>
        </div>
      </div>

      <Panel title="Never connected"
        subtitle={`Showing ${d.neverConnected.length} of ${nfmt(d.neverConnectedTotal)}, ranked by how many times contact was attempted`}
        action={<CsvButton label={`Export ${d.neverConnected.length}`} onClick={() => exportNeverConnectedCsv(d.neverConnected)} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40">
                {['Number', 'Matched customer', 'Attempts', 'Missed', 'Last attempt', 'Agent'].map((h, i) => (
                  <th key={h} className={cn('whitespace-nowrap px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-400', i === 2 || i === 3 ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.neverConnected.length === 0 ? (
                <tr><td colSpan={6} className="p-10 text-center text-xs font-bold text-slate-400">Every customer was reached in this range.</td></tr>
              ) : d.neverConnected.map((c) => (
                <tr key={c.number} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 dark:border-slate-800/60">
                  <td className="whitespace-nowrap px-3 py-3"><PhoneCell number={c.number} /></td>
                  <td className="px-3 py-3"><MatchBadge name={c.matchedName} booking={c.matchedBooking} model={c.matchedModel} source={c.matchedSource} /></td>
                  <td className="px-3 py-3 text-right font-black">{nfmt(c.calls)}</td>
                  <td className="px-3 py-3 text-right font-semibold" style={{ color: '#e11d48' }}>{nfmt(c.missed)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-[11px] font-semibold text-slate-500">{shortDate(c.lastDate)} {c.lastTime?.slice(0, 5)}</td>
                  <td className="px-3 py-3 text-[11px] font-semibold text-slate-500">{c.agents.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function LogTab({ query, page, setPage, recordingsOnly, setRecordingsOnly, playing, setPlaying }: {
  query: { data?: { rows: CallRow[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }; isLoading: boolean; isFetching: boolean; isError: boolean; error: unknown }
  page: number; setPage: (fn: (p: number) => number) => void
  recordingsOnly: boolean; setRecordingsOnly: (v: boolean) => void
  playing: string | null; setPlaying: (v: string | null) => void
}) {
  const data = query.data
  return (
    <Panel title="Call log & recordings"
      subtitle={data ? `${nfmt(data.pagination.total)} calls · click play to stream the recording` : 'Loading…'}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          onClick={() => setRecordingsOnly(!recordingsOnly)}
          variant={recordingsOnly ? 'default' : 'outline'}
          className="h-8 rounded-xl px-3 text-[11px] font-bold"
          style={recordingsOnly ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' } : undefined}
        >
          <Filter className="mr-1 h-3.5 w-3.5" /> {recordingsOnly ? 'Showing recorded only' : 'Recorded calls only'}
        </Button>
      </div>

      {query.isLoading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm font-bold text-rose-600">{(query.error as Error)?.message || 'Failed to load.'}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40">
                  {['Date & time', 'Number', 'Matched customer', 'Type', 'Duration', 'Agent', 'Recording'].map((h, i) => (
                    <th key={h} className={cn('whitespace-nowrap px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-400', i === 4 ? 'text-right' : 'text-left')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).length === 0 ? (
                  <tr><td colSpan={7} className="p-10 text-center text-xs font-bold text-slate-400">No calls match these filters.</td></tr>
                ) : (data?.rows || []).map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 dark:border-slate-800/60">
                    <td className="whitespace-nowrap px-3 py-3 text-[11px] font-bold text-slate-600">{shortDate(c.callDate)} {c.callTime?.slice(0, 5)}</td>
                    <td className="whitespace-nowrap px-3 py-3"><PhoneCell number={c.clientNumber} /></td>
                    <td className="px-3 py-3"><MatchBadge name={c.matchedName} booking={c.matchedBooking} model={c.matchedModel} source={c.matchedSource} /></td>
                    <td className="px-3 py-3"><TypeBadge type={c.callType} /></td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-600">{c.duration ? dur(c.duration) : '—'}</td>
                    <td className="px-3 py-3 text-[11px] font-semibold text-slate-500">{c.empName}</td>
                    <td className="px-3 py-3">
                      {!c.hasRecording ? <span className="text-[11px] font-semibold text-slate-300">—</span>
                        : playing === c.id ? (
                          <audio controls autoPlay src={`/api/call-analysis/recording/${encodeURIComponent(c.id)}`} className="h-8 w-56" onEnded={() => setPlaying(null)} />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Button onClick={() => setPlaying(c.id)} variant="outline" className="h-7 rounded-lg px-2 text-[11px] font-bold">
                              <Mic className="mr-1 h-3 w-3" /> Play
                            </Button>
                            <a href={`/api/call-analysis/recording/${encodeURIComponent(c.id)}`} download
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-slate-800 dark:border-slate-700" title="Download">
                              <Download className="h-3 w-3" />
                            </a>
                          </div>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="text-[11px] font-bold text-slate-400">Page {data.pagination.page} of {data.pagination.totalPages}</p>
              <div className="flex gap-1.5">
                <Button variant="outline" className="h-8 w-8 rounded-lg p-0" disabled={page <= 1 || query.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" className="h-8 w-8 rounded-lg p-0" disabled={page >= data.pagination.totalPages || query.isFetching}
                  onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

function TypeBadge({ type }: { type: string }) {
  const t = type.toLowerCase()
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    incoming: { cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300', icon: <PhoneIncoming className="h-3 w-3" /> },
    outgoing: { cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300', icon: <PhoneOutgoing className="h-3 w-3" /> },
    missed: { cls: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300', icon: <PhoneMissed className="h-3 w-3" /> },
    rejected: { cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', icon: <X className="h-3 w-3" /> },
  }
  const v = map[t] || map.rejected
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide', v.cls)}>
      {v.icon}{type}
    </span>
  )
}

function Meter({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-bold">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <span className="text-slate-500">{nfmt(value)} <span className="text-slate-400">· {pct}%</span></span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-sm font-black text-slate-800 dark:text-slate-200">{value}</p>
    </div>
  )
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-400">No data in this range.</div>
}
