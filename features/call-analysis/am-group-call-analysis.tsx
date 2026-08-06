'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  Loader2, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Users,
  Mic, Search, X, ChevronLeft, ChevronRight, Download, Play, Pause, Volume2,
  Building2, Award, UserCheck, ShieldCheck, FileAudio, RefreshCw, PhoneOff,
  Smartphone, WifiOff, TriangleAlert, ShieldAlert, CircleCheck, LogOut, Radio, Timer
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
  branch_id?: string | null
  branch_name: string
  brand?: string | null
  /** Calls in the SELECTED DATE RANGE, not a calendar month. Key kept for backwards compatibility. */
  calls_this_month: number
  connected_calls: number
  connect_rate: number
  missed_calls: number
  avg_duration_seconds: number
  total_talk_time_seconds: number
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
  /** Real per-day series for the last 7 days in range. Empty when the range spans under 2 days. */
  sparklines?: {
    callsSeries: number[]
    recordingsSeries: number[]
    durationSeries: number[]
    avgDurationSeries: number[]
    uniquePhonesSeries: number[]
    missedIncomingSeries: number[]
    missedOutgoingSeries: number[]
    unansweredSeries: number[]
    agentsSeries: number[]
  }
  dailyTrend: { date: string; calls: number; duration: number; connected?: number; missedIncoming?: number; missedOutgoing?: number }[]
  callTypeMix: { name: string; value: number }[]
  crePerformance: CrePerformance[]
  branchPerformance?: BranchPerformance[]
  agents: { id: string; name: string; branchName?: string; calls: number; recordings: number; durationLabel: string; connectRate?: number; missedIncoming?: number; missedOutgoing?: number }[]
  facets: {
    agentOptions: { id: string; name: string }[]
    branchOptions?: { id: string; name: string; subBranches?: { id: string; name: string }[] }[]
    totalCallsAvailable: number
  }
}

/**
 * A row of `/api/call-analysis/am-group/calls`.
 *
 * ⚠️ There is deliberately NO `audioUrl` and no `storagePath` here. Recordings live in a PRIVATE
 * storage bucket, so a public URL 404s and publishing one would leak customer call audio. The row
 * carries only `isPlayable`; the browser asks
 * `/api/call-analysis/am-group/recordings/[id]/url` for a short-lived signed URL at the moment the
 * user presses play. Both fields existed on this type after the server stopped returning them,
 * which is why the player silently rendered nothing — `row.audioUrl` was always `undefined`.
 */
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
  /** `uploaded` | `pending` | `uploading` | `failed` | `no_recording`. */
  uploadStatus: string
  /** An `uploaded` row with an object behind it — the only kind that can be signed. */
  isPlayable: boolean
  /** Still `pending`/`uploading` hours after the call. Normal sync is ~10 minutes. */
  isStaleSync: boolean
  deviceModel: string | null
}

type FleetDevice = {
  creId: string
  creName: string
  branchId: string | null
  branchName: string
  deviceId: string
  deviceModel: string | null
  osVersion: string | null
  appVersion: string | null
  lastHeartbeatAt: string | null
  hoursSinceHeartbeat: number | null
  lastSweepAt: string | null
  lastSweepSource: string | null
  lastSuccessfulUploadAt: string | null
  sessionState: string | null
  isSignedOut: boolean
  scanBlockers: string[]
  recordingsPending: number
  recordingsParked: number
  lastError: string | null
  /** Pre-computed by `v_stale_devices`. Rendered as-is — never re-derived in the client. */
  reason: string | null
  watcherNeverFired: boolean
}

type FleetHealthData = {
  devices: FleetDevice[]
  missingDevices: { creId: string; creName: string; branchId: string | null; branchName: string }[]
  summary: {
    deviceCount: number
    creWithDeviceCount: number
    rosterSize: number
    missingDeviceCount: number
    signedOutCount: number
    scanBlockedCount: number
    staleCount: number
    watcherNeverFiredCount: number
    pendingUploads: number
    parkedUploads: number
  }
}

/**
 * Local calendar date as `YYYY-MM-DD`. These are IST users: `toISOString()` converts to UTC first
 * and rolls the date back a day for anything before 05:30 IST, so it must not be used here.
 */
function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function today() { return localDate(new Date()) }
function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDate(d)
}

type DateRange = { start: string; end: string }

const PRESETS: { key: string; label: string; range: () => DateRange }[] = [
  { key: 'today', label: 'Today', range: () => ({ start: today(), end: today() }) },
  { key: '7d', label: '7 Days', range: () => ({ start: daysAgo(7), end: today() }) },
  { key: '30d', label: '30 Days', range: () => ({ start: daysAgo(30), end: today() }) },
  { key: '90d', label: '90 Days', range: () => ({ start: daysAgo(90), end: today() }) },
  { key: 'all', label: 'All Time', range: () => ({ start: '', end: '' }) },
]

/** The section opens on today's calls, not all time. */
const DEFAULT_PRESET = 'today'

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

function getBrandIconUrl(brandName: string, brandId?: string): string | null {
  const norm = `${brandName || ''} ${brandId || ''}`.toLowerCase().trim()
  if (norm.includes('kia')) {
    return 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_kia.svg'
  }
  if (norm.includes('hyundai')) {
    return 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_hyundai.svg'
  }
  if (norm.includes('ktm')) {
    return 'https://wallpapercat.com/w/full/0/0/3/880987-3840x2160-desktop-4k-ktm-logo-wallpaper-image.jpg'
  }
  if (norm.includes('honda')) {
    return 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRjNN9PyTICXYqFfZwgJSTd_ftng4BTSqxJBFPlBwq19A&s=10'
  }
  if (norm.includes('group') || norm.includes('all')) {
    return 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg'
  }
  return null
}

function CallAnalysisSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 6 KPI Summary Cards Skeleton */}
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3 shadow-xs">
            <div className="flex justify-between items-center">
              <div className="h-3 w-16 bg-slate-200 rounded dark:bg-slate-800" />
              <div className="h-7 w-7 rounded-xl bg-slate-200 dark:bg-slate-800" />
            </div>
            <div className="h-7 w-20 bg-slate-200 rounded dark:bg-slate-800" />
            <div className="h-3 w-28 bg-slate-200 rounded dark:bg-slate-800" />
          </div>
        ))}
      </div>

      {/* Main Section Content Skeleton */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-6">
        <div className="flex items-center gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="h-8 w-36 bg-slate-200 rounded-xl animate-pulse dark:bg-slate-800" />
          <div className="h-8 w-48 bg-slate-200 rounded-xl animate-pulse dark:bg-slate-800" />
          <div className="h-8 w-40 bg-slate-200 rounded-xl animate-pulse dark:bg-slate-800" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
          <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
        </div>

        <div className="space-y-3 pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/50" />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Re-sign this long before the URL actually dies, so a click never races the expiry.
 * The signing route mints a 300-second URL (see its `SIGNED_URL_TTL_SECONDS`).
 */
const SIGNED_URL_SAFETY_MARGIN_MS = 20_000

/** Best-effort file name for a download, taken from the signed URL's own path. */
function fileNameFromSignedUrl(url: string, fallback: string): string {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
    return base || fallback
  } catch {
    return fallback
  }
}

/**
 * Audio player for one recording, signed LAZILY.
 *
 * The recordings bucket is private, so there is no URL to render until one is minted — and minting
 * one is a storage round trip with a 300-second life. Two things follow, and both are the reason
 * this is a per-row component rather than a field on the row:
 *
 *  - a page of 20 rows must not fire 20 signing requests. Almost every one would be wasted, and by
 *    the time the user scrolled to row 15 the URL would already have expired;
 *  - the URL is therefore fetched on the FIRST play (or download) and cached in a ref for the rest
 *    of its life, so scrubbing and replaying cost nothing extra.
 *
 * Every failure mode is visible: signing shows a spinner on the button that caused it, a refusal
 * from the route (a `pending` recording, a `failed` upload) is shown inline in the row rather than
 * swallowed, and an expired link is offered a reload instead of silently playing nothing.
 */
function RecordingPlayer({ row }: { row: RecordingRow }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'play' | 'download'>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingPlay, setPendingPlay] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /** The live URL and when it dies. A ref, so re-renders never re-sign. */
  const heldRef = useRef<{ url: string; expiresAt: number } | null>(null)

  /** Return a URL that is still alive, minting a new one only when there isn't one. */
  async function ensureSignedUrl(): Promise<string> {
    const held = heldRef.current
    if (held && held.expiresAt - SIGNED_URL_SAFETY_MARGIN_MS > Date.now()) return held.url

    const res = await fetch(`/api/call-analysis/am-group/recordings/${row.id}/url`)
    const body = await res.json().catch(() => ({} as { url?: string; error?: string; expiresInSeconds?: number }))
    if (!res.ok || !body?.url) {
      // The route explains itself for the cases it refuses (still syncing / upload failed); use its
      // wording rather than inventing a generic one.
      throw new Error(body?.error || `Could not load this recording (HTTP ${res.status}).`)
    }
    const ttlMs = (Number(body.expiresInSeconds) || 300) * 1000
    heldRef.current = { url: String(body.url), expiresAt: Date.now() + ttlMs }
    return heldRef.current.url
  }

  // Playback starts only once the <audio> element exists with the fresh src on it.
  useEffect(() => {
    if (!pendingPlay || !signedUrl) return
    setPendingPlay(false)
    audioRef.current?.play().catch(() => {
      // Autoplay refused: the element is already on screen with native controls, so the user can
      // simply press it. Nothing is broken and nothing needs saying.
    })
  }, [pendingPlay, signedUrl])

  async function handlePlay() {
    setError(null)
    setBusy('play')
    try {
      const url = await ensureSignedUrl()
      setSignedUrl(url)
      setPendingPlay(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this recording.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Download through the SAME signed URL.
   *
   * The bytes are pulled into a blob rather than the link being opened directly: the URL points at
   * another origin, where the `download` attribute is ignored and the browser would navigate to the
   * audio instead of saving it — and a window opened after an `await` is what pop-up blockers exist
   * to stop.
   */
  async function handleDownload() {
    setError(null)
    setBusy('download')
    try {
      const url = await ensureSignedUrl()
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Storage returned HTTP ${res.status} for this recording.`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = fileNameFromSignedUrl(url, `recording-${row.id}.m4a`)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download this recording.')
    } finally {
      setBusy(null)
    }
  }

  // `isPlayable` is the server's word for "an `uploaded` row with an object behind it". Anything
  // else has no audio to sign, so it gets an explanation instead of a dead button.
  if (!row.isPlayable) {
    return (
      <span className="text-[10px] font-bold text-slate-400">
        {row.uploadStatus === 'failed' ? 'Upload failed' : 'Not uploaded yet'}
      </span>
    )
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center justify-center gap-2">
        {signedUrl ? (
          <audio
            ref={audioRef}
            controls
            src={signedUrl}
            className="h-8 max-w-[220px] rounded-lg"
            onError={() => {
              // A signed URL that dies mid-page reads as "the dashboard is broken" unless it is
              // named. Drop the stale one so the next press mints a fresh one.
              heldRef.current = null
              setSignedUrl(null)
              setError('This playback link expired. Press play to load it again.')
            }}
          />
        ) : (
          <Button
            type="button"
            onClick={handlePlay}
            disabled={busy !== null}
            size="sm"
            variant="outline"
            style={{ color: 'var(--dashboard-primary)', borderColor: 'var(--dashboard-primary-border)' }}
            className="h-8 rounded-xl px-3 text-[11px] font-bold"
            title="Load and play this recording"
          >
            {busy === 'play' ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Loading
              </>
            ) : (
              <>
                <Play className="mr-1 h-3.5 w-3.5" />
                Play
              </>
            )}
          </Button>
        )}

        <button
          type="button"
          onClick={handleDownload}
          disabled={busy !== null}
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
          title="Download audio recording"
        >
          {busy === 'download' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>
      </div>

      {error && (
        <span className="max-w-[240px] text-[10px] font-bold leading-tight text-rose-600">{error}</span>
      )}
    </div>
  )
}

/**
 * Upload state of one recording, told honestly.
 *
 * ⚠️ `pending` is NORMAL and TRANSIENT. The handset sweeps on a ~15-minute cycle and the median
 * recording lands within ~10 minutes, so a queue of pending rows is a fleet working exactly as
 * designed. It is labelled "Syncing" in neutral colours — never amber, never an error. Only two
 * things here are actually wrong and only those two are coloured as such: an upload the handset gave
 * up on (`failed`), and a row still syncing HOURS after the call (`isStaleSync`, computed
 * server-side against `STALE_PENDING_HOURS`).
 */
function SyncStatusBadge({ row }: { row: RecordingRow }) {
  if (row.uploadStatus === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[10px] font-black text-rose-700 shadow-2xs">
        <TriangleAlert className="h-3 w-3" />
        Upload failed
      </span>
    )
  }
  if (row.isStaleSync) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-black text-amber-700 shadow-2xs">
        <Timer className="h-3 w-3" />
        Syncing — overdue
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black shadow-2xs"
      style={{
        backgroundColor: 'var(--dashboard-primary-soft)',
        borderColor: 'var(--dashboard-primary-border)',
        color: 'var(--dashboard-primary)',
      }}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      Syncing
    </span>
  )
}

/**
 * What each `scan_blockers` value means to whoever has to fix it.
 *
 * Every one of these is a job for a person holding the phone — none can be cleared from the
 * dashboard. Unknown values fall through to the raw token rather than to a placeholder, so a blocker
 * the handset app adds later is still visible (and obviously new) instead of silently swallowed.
 */
const SCAN_BLOCKER_LABELS: Record<string, string> = {
  'all-files-access': 'Grant all-files access',
  'call-log-permission': 'Grant call-log permission',
  'scan-failed': 'Recording folder scan failed',
  'google-dialer': 'Google Dialer — no recording',
  unsupported: 'Handset unsupported',
}

/** "25h ago" for a heartbeat age in hours. Null means the handset has never checked in. */
function heartbeatAgo(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`
  if (hours < 48) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** One number in the fleet summary strip. */
function FleetStat({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string
  value: number
  hint: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const toneClass =
    tone === 'bad'
      ? 'text-rose-600'
      : tone === 'warn'
      ? 'text-amber-600'
      : tone === 'good'
      ? 'text-emerald-600'
      : 'text-slate-900 dark:text-white'

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span>
        <Icon className={cn('h-4 w-4', toneClass)} />
      </div>
      <div className={cn('mt-2 text-2xl font-black', toneClass)}>{value.toLocaleString('en-IN')}</div>
      <div className="mt-0.5 text-[10px] font-bold text-slate-400">{hint}</div>
    </div>
  )
}

export function AmGroupCallAnalysis() {
  const [subTab, setSubTab] = useState<'overview' | 'branch_performance' | 'cre_performance' | 'unanswered' | 'recordings' | 'pending' | 'fleet_health'>('overview')

  // Two layers of filter state. `draft*` is what the user is editing; the committed values below
  // are what the queries actually run with. Only "Apply" (or a quick preset / brand pill, which are
  // single-click intents) moves a draft value across.
  const initialRange = PRESETS.find((p) => p.key === DEFAULT_PRESET)!.range()
  const [preset, setPreset] = useState(DEFAULT_PRESET)
  const [startDate, setStartDate] = useState(initialRange.start)
  const [endDate, setEndDate] = useState(initialRange.end)
  const [agent, setAgent] = useState('all')
  const [branch, setBranch] = useState('all')
  const [callStatus, setCallStatus] = useState('all')
  const [search, setSearch] = useState('')

  const [draftStartDate, setDraftStartDate] = useState(initialRange.start)
  const [draftEndDate, setDraftEndDate] = useState(initialRange.end)
  const [draftAgent, setDraftAgent] = useState('all')
  const [draftCallStatus, setDraftCallStatus] = useState('all')
  const [draftSearch, setDraftSearch] = useState('')

  const [page, setPage] = useState(1)

  const isDirty =
    draftStartDate !== startDate ||
    draftEndDate !== endDate ||
    draftAgent !== agent ||
    draftCallStatus !== callStatus ||
    draftSearch.trim() !== search

  function applyFilters() {
    setStartDate(draftStartDate)
    setEndDate(draftEndDate)
    setAgent(draftAgent)
    setCallStatus(draftCallStatus)
    setSearch(draftSearch.trim())
    setPage(1)
  }

  /** Quick presets stay immediate — they are a one-click date intent, not a pending edit. */
  function applyPreset(key: string) {
    const p = PRESETS.find((x) => x.key === key)
    if (!p) return
    const { start, end } = p.range()
    setPreset(key)
    setPage(1)
    setDraftStartDate(start)
    setDraftEndDate(end)
    setStartDate(start)
    setEndDate(end)
  }

  /** Brand pills are navigation-like: apply at once and clear the CRE selection with them. */
  function selectBranch(next: string) {
    setBranch(next)
    setAgent('all')
    setDraftAgent('all')
    setPage(1)
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

  const unansweredCallsQuery = useQuery<{ rows: RecordingRow[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>({
    queryKey: ['am-group-unanswered-calls', filterParams, page],
    enabled: subTab === 'unanswered',
    placeholderData: keepPreviousData,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams(filterParams)
      p.set('page', String(page))
      p.set('pageSize', '50')
      p.set('unansweredOnly', 'true')
      const res = await fetch(`/api/call-analysis/am-group/calls?${p.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  /**
   * Fleet health is CURRENT STATE, so it is keyed on the BRANCH ALONE — deliberately not on
   * `filterParams`. Feeding it the section's date range (which defaults to "Today") would hide every
   * handset that last checked in yesterday, i.e. precisely the ones worth looking at.
   */
  const fleetHealthQuery = useQuery<FleetHealthData>({
    queryKey: ['am-group-fleet-health', branch],
    enabled: subTab === 'fleet_health',
    staleTime: 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams()
      if (branch !== 'all') p.set('branch', branch)
      const res = await fetch(`/api/call-analysis/fleet-health?${p.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const d = analyticsQuery.data

  function resetFilters() {
    const { start, end } = PRESETS.find((p) => p.key === DEFAULT_PRESET)!.range()
    setPreset(DEFAULT_PRESET)
    setDraftStartDate(start)
    setDraftEndDate(end)
    setStartDate(start)
    setEndDate(end)
    setDraftAgent('all')
    setAgent('all')
    setBranch('all')
    setDraftCallStatus('all')
    setCallStatus('all')
    setDraftSearch('')
    setSearch('')
    setPage(1)
  }

  const activeBrandObj = useMemo(() => {
    const opts = d?.facets.branchOptions || []
    return opts.find((b) => b.id === branch || b.subBranches?.some((sb: any) => sb.id === branch))
  }, [d, branch])

  /**
   * The server already scopes `crePerformance` — and therefore `agentOptions` — to the selected
   * brand, so no client-side branch matching is needed. The previous version re-derived the list
   * by substring-matching branch names and, when that matched nothing, fell back to showing every
   * agent — which made a brand with no calls look like it had the whole roster.
   */
  const availableAgents = d?.facets.agentOptions || []

  /** A sparkline needs at least two real days; below that the cards show the number only. */
  const hasTrendSeries = (d?.sparklines?.callsSeries?.length ?? 0) >= 2

  const hasFilters =
    agent !== 'all' || branch !== 'all' || callStatus !== 'all' || Boolean(search) || preset !== DEFAULT_PRESET || isDirty

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Brand Sub-Sections Bar */}
      <div className="space-y-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black text-slate-400 uppercase tracking-wider mr-1">Brand Sub-Sections:</span>
          <button
            type="button"
            onClick={() => selectBranch('all')}
            className={cn(
              "px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 border",
              branch === 'all'
                ? "bg-slate-900 text-white border-slate-900 shadow-sm dark:bg-slate-100 dark:text-slate-900"
                : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            )}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-white p-0.5 shadow-2xs shrink-0 overflow-hidden">
              <img
                src="https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg"
                alt="All Brands"
                className="h-full w-full object-contain"
              />
            </div>
            <span>All Brands</span>
          </button>

          {(d?.facets.branchOptions || [])
            .filter((b) => b.id !== 'am_group' && !b.name.toLowerCase().includes('am group'))
            .map((b) => {
            const isBrandActive = branch === b.id || b.subBranches?.some((sb: any) => sb.id === branch)
            const logoUrl = getBrandIconUrl(b.name, b.id)

            return (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBranch(b.id)}
                className={cn(
                  "px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 border",
                  isBrandActive
                    ? "bg-[#004e5a] text-white border-[#004e5a] shadow-sm"
                    : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                )}
              >
                {logoUrl ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-white p-0.5 shadow-2xs shrink-0 overflow-hidden">
                    <img src={logoUrl} alt={b.name} className="h-full w-full object-contain" />
                  </div>
                ) : (
                  <Building2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                )}
                <span>{b.name}</span>
              </button>
            )
          })}
        </div>

        {/* Sub-Branch Pill Selectors when a specific Brand with multiple branches is active (e.g. Kia) */}
        {activeBrandObj?.subBranches && activeBrandObj.subBranches.length > 1 && (
          <div className="flex items-center gap-2 pl-4 pt-1">
            <span className="text-[11px] font-bold text-slate-400">Locations:</span>
            <button
              type="button"
              onClick={() => selectBranch(activeBrandObj.id)}
              className={cn(
                "px-3 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer border",
                branch === activeBrandObj.id
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300"
              )}
            >
              All {activeBrandObj.name}
            </button>
            {activeBrandObj.subBranches.map((sb: any) => (
              <button
                key={sb.id}
                type="button"
                onClick={() => selectBranch(sb.id)}
                className={cn(
                  "px-3 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer border",
                  branch === sb.id
                    ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300"
                )}
              >
                {sb.name}
              </button>
            ))}
          </div>
        )}
      </div>

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
                value={draftStartDate}
                onChange={(e) => { setDraftStartDate(e.target.value); setPreset('custom') }}
                className="h-9 w-[9.5rem] rounded-xl text-xs font-bold"
              />
              <span className="text-xs font-bold text-slate-400">to</span>
              <Input
                type="date"
                value={draftEndDate}
                onChange={(e) => { setDraftEndDate(e.target.value); setPreset('custom') }}
                className="h-9 w-[9.5rem] rounded-xl text-xs font-bold"
              />
            </div>

            {/* Call Status / Type Selector */}
            <div className="w-[13.5rem]">
              <Select value={draftCallStatus} onValueChange={setDraftCallStatus}>
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

            {/* CRE Agent Selector — Shows only CREs for active Branch */}
            <div className="w-[13rem]">
              <Select value={draftAgent} onValueChange={setDraftAgent}>
                <SelectTrigger className="h-9 rounded-xl text-xs font-bold">
                  <SelectValue placeholder="CRE Agents" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">
                    {branch === 'all' ? 'All CRE Agents' : 'All Branch CREs'}
                  </SelectItem>
                  {availableAgents.map((ag) => (
                    <SelectItem key={ag.id} value={ag.id}>
                      {ag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search Input — committed by the same Apply button as every other filter */}
            <div className="flex flex-1 items-center gap-1.5 min-w-[200px]">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search CRE name, phone, branch..."
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyFilters() }}
                  className="h-9 rounded-xl pl-9 text-xs font-bold"
                />
              </div>
              <Button
                onClick={applyFilters}
                disabled={!isDirty}
                size="sm"
                style={isDirty ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' } : undefined}
                className={cn(
                  'h-9 rounded-xl px-4 font-bold text-xs transition-all',
                  isDirty
                    ? 'shadow-sm ring-2 ring-offset-1 ring-[var(--dashboard-primary-border)]'
                    : 'bg-slate-100 text-slate-400 shadow-none hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-500'
                )}
              >
                Apply
              </Button>
              {hasFilters && (
                <Button onClick={resetFilters} variant="ghost" size="sm" className="h-9 rounded-xl px-2 text-slate-500" title="Reset all filters">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {isDirty && (
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              Filter changes are not applied yet — click <span style={{ color: 'var(--dashboard-primary)' }}>Apply</span> to update the dashboard.
            </p>
          )}
        </CardContent>
      </Card>

      {analyticsQuery.isLoading || analyticsQuery.isFetching ? (
        <CallAnalysisSkeleton />
      ) : (
        <>
          {/* Summary KPI Cards Grid (6 Columns) */}
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard
          title="TOTAL CRE CALLS"
          value={d ? d.summary.totalCalls.toLocaleString('en-IN') : '—'}
          subtitle="Calls logged in the selected range"
          icon={PhoneCall}
          colorScheme="teal"
          chartType="area"
          chartData={d?.sparklines?.callsSeries ?? []}
          showChart={hasTrendSeries}
          trend={{ value: `${d?.summary.connectRate ?? 0}%`, isPositive: true, label: 'connected rate' }}
        />
        <KpiCard
          title="CONNECTED CALLS"
          value={d ? d.summary.totalConnected.toLocaleString('en-IN') : '—'}
          subtitle={d ? `${d.summary.connectedOutgoing} out / ${d.summary.connectedIncoming} in` : '—'}
          icon={PhoneOutgoing}
          colorScheme="emerald"
          chartType="line"
          chartData={d?.sparklines?.recordingsSeries ?? []}
          showChart={hasTrendSeries}
          trend={{ value: `${d?.summary.connectRate ?? 0}%`, isPositive: true, label: 'connected' }}
        />
        <KpiCard
          title="MISSED INCOMING"
          value={d ? d.summary.missedIncoming.toLocaleString('en-IN') : '—'}
          subtitle="Incoming calls the CRE did not pick up"
          icon={PhoneMissed}
          colorScheme="rose"
          chartType="bar"
          chartData={d?.sparklines?.missedIncomingSeries ?? []}
          showChart={hasTrendSeries}
          trend={{ value: d ? `${Math.round((d.summary.missedIncoming / Math.max(1, d.summary.totalCalls)) * 100)}%` : '0%', isPositive: false, label: 'of total calls' }}
        />
        <KpiCard
          title="NOT ANSWERED OUTGOING"
          value={d ? d.summary.missedOutgoing.toLocaleString('en-IN') : '—'}
          subtitle="Customer did not pick up"
          icon={PhoneMissed}
          colorScheme="amber"
          chartType="bar"
          chartData={d?.sparklines?.missedOutgoingSeries ?? []}
          showChart={hasTrendSeries}
          trend={{ value: d ? `${Math.round((d.summary.missedOutgoing / Math.max(1, d.summary.totalCalls)) * 100)}%` : '0%', isPositive: false, label: 'of total calls' }}
        />
        <KpiCard
          title="TOTAL UNANSWERED"
          value={d ? d.summary.totalUnanswered.toLocaleString('en-IN') : '—'}
          subtitle={d ? `${d.summary.unansweredRate}% unanswered rate` : '—'}
          icon={PhoneMissed}
          colorScheme="purple"
          chartType="area"
          chartData={d?.sparklines?.unansweredSeries ?? []}
          showChart={hasTrendSeries}
          trend={{ value: `${d?.summary.unansweredRate ?? 0}%`, isPositive: false, label: 'missed / no answer' }}
        />
        <KpiCard
          title="TOTAL TALK TIME"
          value={d ? d.summary.totalDurationLabel : '—'}
          subtitle={d ? `Avg ${d.summary.avgDurationLabel} / connected call` : '—'}
          icon={Clock}
          colorScheme="blue"
          chartType="bar"
          chartData={d?.sparklines?.durationSeries ?? []}
          showChart={hasTrendSeries}
          trend={{ value: `${d?.summary.recordingCoverage ?? 0}%`, isPositive: true, label: 'with recording' }}
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
          onClick={() => { setSubTab('unanswered'); setPage(1) }}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab === 'unanswered'
              ? 'border-rose-500 text-rose-600'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <PhoneOff className="h-4 w-4" />
          <span>Unanswered Numbers</span>
          {d && d.summary.totalUnanswered > 0 && (
            <span className="ml-1 bg-rose-100 text-rose-700 text-[9px] font-black px-1.5 py-0.5 rounded-full border border-rose-200">
              {d.summary.totalUnanswered}
            </span>
          )}
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

        <button
          onClick={() => setSubTab('fleet_health')}
          style={subTab === 'fleet_health' ? { borderColor: 'var(--dashboard-primary)', color: 'var(--dashboard-primary)' } : undefined}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2',
            subTab !== 'fleet_health' && 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
          )}
        >
          <Smartphone className="h-4 w-4" />
          <span>CRE Handset Fleet Health</span>
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

      {/* TAB 3: CRE PERFORMANCE SCORECARD — uses v_cre_performance view for accurate data */}
      {subTab === 'cre_performance' && (
        <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white">
                CRE Staff Performance Scorecard
              </CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Attempts = all outgoing calls made. Answered = calls where customer picked up.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase text-slate-400">
                  <th className="py-3 px-4">CRE</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4 text-center">Attempts</th>
                  <th className="py-3 px-4 text-center">Answered</th>
                  <th className="py-3 px-4 text-center">Unanswered</th>
                  <th className="py-3 px-4 text-center">Answer Rate</th>
                  <th className="py-3 px-4 text-center">Avg Duration</th>
                  <th className="py-3 px-4 text-center">Total Talk Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(d?.crePerformance || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-semibold">
                      No CRE performance data available for the selected period.
                    </td>
                  </tr>
                ) : (
                  [...(d?.crePerformance || [])]
                    .sort((a, b) => b.calls_this_month - a.calls_this_month)
                    .map((cre) => {
                      const unanswered = (cre.calls_this_month || 0) - (cre.connected_calls || 0)
                      const answerRate = cre.connect_rate || 0
                      return (
                        <tr
                          key={cre.cre_id}
                          className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                          onClick={() => { setSubTab('unanswered'); setAgent(cre.cre_id); setDraftAgent(cre.cre_id); setPage(1) }}
                          title="Click to see unanswered calls for this CRE"
                        >
                          <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-[#004e5a]/10 text-[#004e5a] font-black flex items-center justify-center text-[10px]">
                                {cre.cre_name.slice(0, 2).toUpperCase()}
                              </div>
                              <span>{cre.cre_name}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-600">{cre.branch_name || 'General'}</td>
                          <td className="py-3.5 px-4 text-center font-bold text-slate-800">{cre.calls_this_month || 0}</td>
                          <td className="py-3.5 px-4 text-center font-bold text-emerald-600">{cre.connected_calls || 0}</td>
                          <td className="py-3.5 px-4 text-center font-bold text-rose-600">
                            {unanswered > 0 ? (
                              <span className="inline-flex items-center gap-1">
                                {unanswered}
                                <PhoneOff className="h-3 w-3" />
                              </span>
                            ) : 0}
                          </td>
                          <td className="py-3.5 px-4 text-center font-bold">
                            <span className={cn(
                              'px-2.5 py-0.5 rounded-full text-[10px] font-black border',
                              answerRate >= 70 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : answerRate >= 50 ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            )}>
                              {answerRate}%
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center font-bold text-slate-600">{dur(cre.avg_duration_seconds || 0)}</td>
                          <td className="py-3.5 px-4 text-center font-bold text-slate-700">{dur(cre.total_talk_time_seconds || 0)}</td>
                        </tr>
                      )
                    })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* TAB 4 NEW: UNANSWERED NUMBERS DETAIL */}
      {subTab === 'unanswered' && (
        <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <PhoneOff className="h-4 w-4 text-rose-500" />
                Unanswered &amp; Missed Call Numbers
              </CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                All calls where the customer did not answer (outgoing not answered) or CRE missed an incoming call. Click a CRE row in the scorecard to filter here.
              </p>
            </div>
            {agent !== 'all' && (
              <Button variant="outline" size="sm" onClick={() => { setAgent('all'); setDraftAgent('all'); setPage(1) }} className="h-8 rounded-xl text-xs font-bold border-slate-200 text-slate-600">
                <X className="h-3.5 w-3.5 mr-1" /> Clear CRE Filter
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {unansweredCallsQuery.isFetching ? (
              <div className="flex py-12 items-center justify-center text-slate-400 gap-2 text-xs font-bold">
                <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
                <span>Loading unanswered calls...</span>
              </div>
            ) : (unansweredCallsQuery.data?.rows || []).length === 0 ? (
              <div className="py-16 text-center">
                <PhoneOff className="h-10 w-10 mx-auto text-emerald-400 mb-3" />
                <p className="text-sm font-black text-emerald-600">No unanswered calls found!</p>
                <p className="text-xs font-medium text-slate-400 mt-1">All calls were answered in this date range.</p>
              </div>
            ) : (
              <>
                <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 flex items-center gap-2">
                  <PhoneOff className="h-3.5 w-3.5 text-rose-500" />
                  <span className="text-[11px] font-black text-rose-700">
                    {unansweredCallsQuery.data?.pagination.total} unanswered calls
                    {agent !== 'all' && ` for selected CRE`}
                    {startDate && ` from ${startDate}`}{endDate && ` to ${endDate}`}
                  </span>
                </div>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase text-slate-400">
                      <th className="py-3 px-4">#</th>
                      <th className="py-3 px-4">CRE</th>
                      <th className="py-3 px-4">Branch</th>
                      <th className="py-3 px-4">Phone Number</th>
                      <th className="py-3 px-4">Contact Name</th>
                      <th className="py-3 px-4 text-center">Call Type</th>
                      <th className="py-3 px-4 whitespace-nowrap">Date &amp; Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {unansweredCallsQuery.data?.rows.map((row, idx) => (
                      <tr key={row.id} className="hover:bg-rose-50/30 transition-colors">
                        <td className="py-3 px-4 text-[10px] font-black text-slate-400">
                          {(page - 1) * 50 + idx + 1}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-rose-100 text-rose-700 font-black flex items-center justify-center text-[9px] flex-shrink-0">
                              {row.creName.slice(0, 2).toUpperCase()}
                            </div>
                            {row.creName}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-500">{row.branchName || 'General'}</td>
                        <td className="py-3 px-4">
                          <span className="font-black text-slate-900 tracking-wide">{row.phone}</span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-600">
                          {row.contactName || <span className="text-slate-300 font-medium">—</span>}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={cn(
                            'px-2.5 py-0.5 rounded-full text-[10px] font-black border',
                            row.statusBadgeClass || 'bg-amber-50 text-amber-700 border-amber-200'
                          )}>
                            {row.statusLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-500 whitespace-nowrap">{formatDate(row.recordedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination */}
                {unansweredCallsQuery.data?.pagination && unansweredCallsQuery.data.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between p-4 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-500">
                      Page {unansweredCallsQuery.data.pagination.page} of {unansweredCallsQuery.data.pagination.totalPages} ({unansweredCallsQuery.data.pagination.total} records)
                    </span>
                    <div className="flex items-center gap-2">
                      <Button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} variant="outline" size="sm" className="h-8 rounded-xl text-xs font-bold">
                        <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                      </Button>
                      <Button disabled={page >= unansweredCallsQuery.data.pagination.totalPages} onClick={() => setPage((p) => p + 1)} variant="outline" size="sm" className="h-8 rounded-xl text-xs font-bold">
                        Next <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 5: UPLOADED AUDIO RECORDINGS & PLAYER */}
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
                No uploaded call recordings for these filters. Calls whose audio has not finished
                uploading appear under &ldquo;Uploading &amp; Pending Calls&rdquo;.
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
                  {/* No client-side filtering here on purpose: "playable" (storage_path present AND
                      duration > 0) is enforced by the server via `recordingsOnly`, so the footer
                      count, the page count and these rows are all derived from one predicate. */}
                  {(callsQuery.data?.rows ?? []).map((row) => (
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
                        {/* Signed on demand — see RecordingPlayer. The row carries no URL. */}
                        <RecordingPlayer row={row} />
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
                Recordings still on their way up from a CRE handset. This queue is normal — phones
                sweep on a ~15-minute cycle and most audio lands within ~10 minutes. Only
                &ldquo;overdue&rdquo; and &ldquo;upload failed&rdquo; rows need attention.
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
                        <SyncStatusBadge row={row} />
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

      {/* TAB 7: CRE HANDSET FLEET HEALTH */}
      {subTab === 'fleet_health' && (
        <div className="space-y-6">
          {fleetHealthQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs font-bold text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--dashboard-primary)' }} />
              <span>Reading handset check-ins...</span>
            </div>
          ) : fleetHealthQuery.isError ? (
            <Card className="rounded-3xl border border-rose-200 bg-rose-50/60 p-6 shadow-sm">
              <p className="text-xs font-bold text-rose-700">
                {(fleetHealthQuery.error as Error)?.message || 'Failed to load fleet health.'}
              </p>
            </Card>
          ) : (
            <>
              {/* Fleet summary. Every number is a count of real rows — nothing is estimated. */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <FleetStat
                  label="Handsets Reporting"
                  value={fleetHealthQuery.data?.summary.deviceCount ?? 0}
                  hint={`${fleetHealthQuery.data?.summary.creWithDeviceCount ?? 0} of ${fleetHealthQuery.data?.summary.rosterSize ?? 0} CREs`}
                  icon={Smartphone}
                />
                <FleetStat
                  label="App Never Deployed"
                  value={fleetHealthQuery.data?.summary.missingDeviceCount ?? 0}
                  hint="CREs with no handset at all"
                  icon={WifiOff}
                  tone={(fleetHealthQuery.data?.summary.missingDeviceCount ?? 0) > 0 ? 'bad' : 'good'}
                />
                <FleetStat
                  label="Signed Out"
                  value={fleetHealthQuery.data?.summary.signedOutCount ?? 0}
                  hint="Stopped uploading"
                  icon={LogOut}
                  tone={(fleetHealthQuery.data?.summary.signedOutCount ?? 0) > 0 ? 'bad' : 'good'}
                />
                <FleetStat
                  label="Needs A Human"
                  value={fleetHealthQuery.data?.summary.scanBlockedCount ?? 0}
                  hint="Permission / OEM blockers"
                  icon={ShieldAlert}
                  tone={(fleetHealthQuery.data?.summary.scanBlockedCount ?? 0) > 0 ? 'warn' : 'good'}
                />
                <FleetStat
                  label="Flagged Stale"
                  value={fleetHealthQuery.data?.summary.staleCount ?? 0}
                  hint="By v_stale_devices"
                  icon={Timer}
                  tone={(fleetHealthQuery.data?.summary.staleCount ?? 0) > 0 ? 'warn' : 'good'}
                />
                <FleetStat
                  label="Queued Uploads"
                  value={fleetHealthQuery.data?.summary.pendingUploads ?? 0}
                  hint={`${fleetHealthQuery.data?.summary.parkedUploads ?? 0} parked`}
                  icon={RefreshCw}
                  tone={(fleetHealthQuery.data?.summary.parkedUploads ?? 0) > 0 ? 'warn' : 'neutral'}
                />
              </div>

              {/*
                The highest-value panel on this tab, and the reason it exists.
                A CRE with no `device_sync_health` row has never had the app report from a phone.
                That — not idleness — is why they show no calls, and nothing in the call log says so.
              */}
              <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="flex flex-row items-center justify-between p-0 pb-4">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm font-black tracking-tight text-slate-900 dark:text-white">
                      <WifiOff className="h-4 w-4 text-rose-500" />
                      CREs With No Handset Reporting
                    </CardTitle>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      These active CREs have never sent a single check-in, which means the recorder
                      app was never deployed to their phone. They will show zero calls no matter what
                      they actually dial — this is the reason, and it needs an install, not a chase.
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {(fleetHealthQuery.data?.missingDevices || []).length === 0 ? (
                    <div className="flex items-center gap-2 py-6 text-xs font-bold text-emerald-600">
                      <CircleCheck className="h-4 w-4" />
                      Every active CRE in scope has the app reporting from a handset.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {fleetHealthQuery.data?.missingDevices.map((m) => (
                        <span
                          key={m.creId}
                          className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-black text-rose-700"
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-200 text-[9px] text-rose-800">
                            {m.creName.slice(0, 2).toUpperCase()}
                          </span>
                          {m.creName}
                          <span className="font-bold text-rose-400">{m.branchName}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Per-handset detail. */}
              <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <CardHeader className="p-0 pb-4">
                  <CardTitle className="flex items-center gap-2 text-sm font-black tracking-tight text-slate-900 dark:text-white">
                    <Smartphone className="h-4 w-4" style={{ color: 'var(--dashboard-primary)' }} />
                    Handset Check-Ins
                  </CardTitle>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    Current state per handset — the most recent check-in each device has sent, not its
                    history. A CRE can appear more than once: reinstalling the app registers the phone
                    again under a new device id.
                  </p>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  {(fleetHealthQuery.data?.devices || []).length === 0 ? (
                    <div className="py-12 text-center text-xs font-semibold text-slate-400">
                      No handsets have reported for this brand.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase text-slate-400">
                          <th className="px-4 py-3">CRE</th>
                          <th className="px-4 py-3">Handset</th>
                          <th className="px-4 py-3 whitespace-nowrap">Last Heartbeat</th>
                          <th className="px-4 py-3 text-center">Session</th>
                          <th className="px-4 py-3">Needs Attention On The Phone</th>
                          <th className="px-4 py-3 text-center">Queued</th>
                          <th className="px-4 py-3 text-center">Trigger</th>
                          <th className="px-4 py-3 text-center">Flagged</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {fleetHealthQuery.data?.devices.map((dev) => (
                          <tr
                            key={`${dev.creId}-${dev.deviceId}`}
                            className={cn(
                              'transition-colors hover:bg-slate-50/80',
                              dev.isSignedOut && 'bg-rose-50/40'
                            )}
                          >
                            <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">
                              <div className="flex items-center gap-2">
                                <div
                                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-black"
                                  style={{
                                    backgroundColor: 'var(--dashboard-primary-soft)',
                                    color: 'var(--dashboard-primary)',
                                  }}
                                >
                                  {dev.creName.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="leading-tight">
                                  <div>{dev.creName}</div>
                                  <div className="text-[10px] font-bold text-slate-400">{dev.branchName}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 leading-tight">
                              <div className="font-bold text-slate-700">{dev.deviceModel || '—'}</div>
                              <div className="text-[10px] font-bold text-slate-400">
                                {dev.osVersion ? `Android ${dev.osVersion}` : 'OS unknown'}
                                {dev.appVersion ? ` · app ${dev.appVersion}` : ''}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5 leading-tight">
                              <div className="font-bold text-slate-700">{heartbeatAgo(dev.hoursSinceHeartbeat)}</div>
                              <div className="text-[10px] font-bold text-slate-400">
                                {dev.lastHeartbeatAt ? formatDate(dev.lastHeartbeatAt) : 'never checked in'}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              {/* signed_out = this handset has STOPPED uploading. Flagged hard. */}
                              {dev.isSignedOut ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[10px] font-black text-rose-700">
                                  <LogOut className="h-3 w-3" />
                                  Signed out
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black text-emerald-700">
                                  {dev.sessionState || 'unknown'}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3.5">
                              {dev.scanBlockers.length === 0 ? (
                                <span className="text-[10px] font-bold text-slate-300">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {dev.scanBlockers.map((b) => (
                                    <span
                                      key={b}
                                      title={b}
                                      className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700"
                                    >
                                      <ShieldAlert className="h-3 w-3" />
                                      {SCAN_BLOCKER_LABELS[b] || b}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              {/* Queued uploads are normal traffic, so they are never coloured as a
                                  fault. Parked uploads have given up, and those are. */}
                              <div className="font-bold text-slate-700">{dev.recordingsPending}</div>
                              {dev.recordingsParked > 0 && (
                                <div className="text-[10px] font-black text-rose-600">
                                  {dev.recordingsParked} parked
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              {/* `watcher` fires the instant a call ends; `sweep` is the ~15-min
                                  fallback. A device that has never produced a watcher sweep has an OS
                                  restriction blocking the background trigger. */}
                              {dev.watcherNeverFired ? (
                                <span
                                  title="No watcher sweep has ever been reported by this handset — an OS restriction is blocking the instant-on-call-end trigger, so recordings only arrive via the ~15-minute fallback poll."
                                  className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-black text-amber-700"
                                >
                                  <Timer className="h-3 w-3" />
                                  Sweep only
                                </span>
                              ) : (
                                <span
                                  title={`Last sweep source: ${dev.lastSweepSource || 'unknown'}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black text-emerald-700"
                                >
                                  <Radio className="h-3 w-3" />
                                  Watcher
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              {/*
                                `reason` comes pre-computed from `v_stale_devices`. It is rendered as
                                given (underscores swapped for spaces, nothing else) and there is
                                deliberately NO lookup table: a new reason the backend starts
                                emitting must show up here, not fall through a map to "Unknown".
                              */}
                              {dev.reason ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[10px] font-black text-slate-700">
                                  <TriangleAlert className="h-3 w-3" />
                                  {dev.reason.replace(/_/g, ' ')}
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
        </>
      )}
    </div>
  )
}
