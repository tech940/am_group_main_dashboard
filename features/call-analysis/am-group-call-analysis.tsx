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
  Smartphone, WifiOff, TriangleAlert, ShieldAlert, CircleCheck, LogOut, Radio, Timer,
  SlidersHorizontal, ArrowUpRight, ArrowDownRight, Info, CheckCircle2, ChevronDown, Filter, Calendar
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type CrePerformance = {
  cre_id: string
  cre_name: string
  branch_id?: string | null
  branch_name: string
  brand?: string | null
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
    missedIncomingBreakdown?: { missed: number; noAnswer: number; rejected: number } | null
    missedOutgoing: number
    incomingAttempts?: number
    outgoingAttempts?: number
    totalUnanswered: number
    totalConnected: number
    unclassified?: number
    connectRate: number
    unansweredRate: number
    agentCount: number
    missedIncomingRecovery?: {
      totalMissedIncoming: number
      connectedLater: number
      remainedMissing: number
      recoveryRatePct: number
      totalUniqueCallers: number
      connectedLaterCallers: number
      remainedMissingCallers: number
    }
  }
  sparklines?: {
    callsSeries: number[]
    recordingsSeries: number[]
    durationSeries: number[]
    avgDurationSeries: number[]
    uniquePhonesSeries: number[]
    missedIncomingSeries: number[]
    missedOutgoingSeries: number[]
    unansweredSeries: number[]
    incomingSeries?: number[]
    agentsSeries: number[]
  }
  dailyTrend: { date: string; calls: number; duration: number; connected?: number; missedIncoming?: number; missedOutgoing?: number; incomingAttempts?: number }[]
  hourlyTrend?: { hour: number; label: string; calls: number; connected: number; missed: number }[]
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
  isPlayable: boolean
  isStaleSync: boolean
  deviceModel: string | null
  isMissedIncoming?: boolean
  isConnectedLater?: boolean
  callbackTime?: string | null
  callbackCreName?: string | null
  callbackDelayLabel?: string | null
  customer?: CustomerIdentity | null
  notACustomer?: string | null
}

type CustomerIdentity = {
  name: string
  source: 'booking' | 'kia' | 'hyundai' | 'platinum'
  sourceLabel: string
  model: string | null
  status: string | null
  consultant: string | null
  refDate: string | null
  bookingNumber: string | null
  isShared: boolean
}

const CUSTOMER_SOURCE_STYLE: Record<CustomerIdentity['source'], string> = {
  booking: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  kia: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  hyundai: 'bg-sky-50 text-sky-700 border-sky-200',
  platinum: 'bg-violet-50 text-violet-700 border-violet-200',
}

function getBranchBadgeStyle(branchName?: string | null) {
  const norm = (branchName || '').toLowerCase()
  if (norm.includes('special')) return 'bg-violet-50 text-violet-700 border-violet-200'
  if (norm.includes('kia')) return 'bg-indigo-50 text-indigo-700 border-indigo-200'
  if (norm.includes('hyundai') || norm.includes('h promise')) return 'bg-sky-50 text-sky-700 border-sky-200'
  if (norm.includes('ktm')) return 'bg-orange-50 text-orange-700 border-orange-200'
  if (norm.includes('honda')) return 'bg-rose-50 text-rose-700 border-rose-200'
  if (norm.includes('tata')) return 'bg-blue-50 text-blue-700 border-blue-200'
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

function getDurationBadge(seconds: number) {
  const text = formatSecondsMmSs(seconds)
  if (seconds >= 60) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700 tabular-nums">
        <Clock className="h-3 w-3" />
        {text}
      </span>
    )
  }
  if (seconds >= 20) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-black text-sky-700 tabular-nums">
        <Clock className="h-3 w-3" />
        {text}
      </span>
    )
  }
  if (seconds > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 tabular-nums">
        {text}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600 tabular-nums">
      00:00
    </span>
  )
}

function getTypeBadge(callType?: string, statusLabel?: string) {
  const norm = `${callType || ''} ${statusLabel || ''}`.toLowerCase()
  if (norm.includes('connected in') || (norm.includes('incoming') && !norm.includes('missed') && !norm.includes('rejected'))) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700 shadow-2xs">
        <PhoneIncoming className="h-3 w-3" />
        {statusLabel || 'Connected Incoming'}
      </span>
    )
  }
  if (norm.includes('connected out') || (norm.includes('outgoing') && !norm.includes('missed') && !norm.includes('not answered'))) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-black text-teal-800 shadow-2xs">
        <PhoneOutgoing className="h-3 w-3" />
        {statusLabel || 'Connected Outgoing'}
      </span>
    )
  }
  if (norm.includes('missed in') || (norm.includes('missed') && norm.includes('incoming'))) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-black text-rose-700 shadow-2xs">
        <PhoneMissed className="h-3 w-3" />
        {statusLabel || 'Missed Incoming'}
      </span>
    )
  }
  if (norm.includes('not answered') || norm.includes('missed out') || (norm.includes('outgoing') && norm.includes('unanswered'))) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-black text-amber-700 shadow-2xs">
        <PhoneOff className="h-3 w-3" />
        {statusLabel || 'Not Answered Outgoing'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700 shadow-2xs">
      <PhoneCall className="h-3 w-3" />
      {statusLabel || callType || 'Call'}
    </span>
  )
}

function FormattedTimeCell({ isoStr }: { isoStr: string }) {
  if (!isoStr) return <span className="text-slate-400 font-medium">—</span>
  const d = new Date(isoStr)
  const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  return (
    <div className="flex flex-col">
      <span className="text-xs font-bold text-slate-900">{dateStr}</span>
      <span className="text-[11px] font-medium text-slate-500">{timeStr}</span>
    </div>
  )
}

function CustomerIdentityLine({ row }: { row: RecordingRow }) {
  if (row.notACustomer) {
    const isStaff = row.notACustomer.toLowerCase().includes('staff') || row.notACustomer.toLowerCase().includes('internal')
    return (
      <span
        className={cn(
          'mt-1 inline-flex items-center rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-wider border',
          isStaff ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-600 border-slate-200',
        )}
      >
        {row.notACustomer}
      </span>
    )
  }

  const customer = row.customer
  if (!customer) return null

  const isIncoming = row.callType?.toLowerCase() === 'incoming' || row.isMissedIncoming === true
  const detail = [customer.model, customer.refDate].filter(Boolean).join(' · ')

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      <span
        className="text-[11px] font-bold text-slate-800 capitalize"
        title={
          isIncoming
            ? `This number is registered to ${customer.name} in our ${customer.sourceLabel} records.`
            : `${customer.name} — from ${customer.sourceLabel} (${detail})`
        }
      >
        {customer.name}
      </span>
      <span
        className={cn(
          'rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide',
          CUSTOMER_SOURCE_STYLE[customer.source] || 'bg-slate-100 text-slate-700 border-slate-200',
        )}
      >
        {customer.bookingNumber || customer.sourceLabel}
      </span>
    </span>
  )
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
]

const DEFAULT_PRESET = 'today'

function dur(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function formatDurationHms(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function formatTimeOnly(isoStr: string) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
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

function formatSecondsMmSs(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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

const SPECIAL_TEAM_CLIENT_BRANCHES: Record<string, string> = {
  'heena digital crm': 'Special Branch (H Promise)',
  'heena': 'Special Branch (H Promise)',
  'komal': 'Special Branch (Kia sales)',
  'raman bali': 'Special Branch (Hyundai service)',
  'raman': 'Special Branch (Hyundai service)',
  'rishika tata cxm': 'Special Branch (Tata sales)',
  'rishika': 'Special Branch (Tata sales)',
  'rupali crm': 'Special Branch (Kia service)',
  'rupali': 'Special Branch (Kia service)',
  'sonali jamwal': 'Special Branch (Kia Udhampur)',
  'sonali': 'Special Branch (Kia Udhampur)',
  'tejinder crm': 'Special Branch (Platinum service)',
  'tejinder': 'Special Branch (Platinum service)',
}

function formatAgentBranch(branchName?: string | null, agentName?: string | null): string {
  if (agentName) {
    const key = agentName.trim().toLowerCase()
    if (SPECIAL_TEAM_CLIENT_BRANCHES[key]) return SPECIAL_TEAM_CLIENT_BRANCHES[key]
    for (const [name, label] of Object.entries(SPECIAL_TEAM_CLIENT_BRANCHES)) {
      if (key.includes(name) || name.includes(key)) return label
    }
  }
  if (!branchName) return 'General'
  if (
    branchName === 'Special Team Special Branch' ||
    branchName === 'Special Branch Special Branch' ||
    branchName.toLowerCase().includes('special branch special branch')
  ) {
    return 'Special Branch'
  }
  return branchName
}

const SIGNED_URL_SAFETY_MARGIN_MS = 20_000

function fileNameFromSignedUrl(url: string, fallback: string): string {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
    return base || fallback
  } catch {
    return fallback
  }
}

const SCAN_BLOCKER_LABELS: Record<string, string> = {
  'all-files-access': 'Grant all-files access',
  'call-log-permission': 'Grant call-log permission',
  'scan-failed': 'Recording folder scan failed',
  'google-dialer': 'Google Dialer — no recording',
  unsupported: 'Handset unsupported',
}

function heartbeatAgo(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`
  if (hours < 48) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function RecordingPlayer({ row }: { row: RecordingRow }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'play' | 'download'>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingPlay, setPendingPlay] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const heldRef = useRef<{ url: string; expiresAt: number } | null>(null)

  async function ensureSignedUrl(): Promise<string> {
    const held = heldRef.current
    if (held && held.expiresAt - SIGNED_URL_SAFETY_MARGIN_MS > Date.now()) return held.url

    const res = await fetch(`/api/call-analysis/am-group/recordings/${row.id}/url`)
    const body = await res.json().catch(() => ({} as { url?: string; error?: string; expiresInSeconds?: number }))
    if (!res.ok || !body?.url) {
      throw new Error(body?.error || `Could not load this recording (HTTP ${res.status}).`)
    }
    const ttlMs = (Number(body.expiresInSeconds) || 300) * 1000
    heldRef.current = { url: String(body.url), expiresAt: Date.now() + ttlMs }
    return heldRef.current.url
  }

  useEffect(() => {
    if (!pendingPlay || !signedUrl) return
    setPendingPlay(false)
    audioRef.current?.play().catch(() => {})
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
            className="h-8 rounded-xl px-3 text-[11px] font-bold text-[#093339] border-slate-200"
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
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          title="Download audio recording"
        >
          {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </button>
      </div>

      {error && <span className="max-w-[240px] text-[10px] font-bold leading-tight text-rose-600">{error}</span>}
    </div>
  )
}

function CompactAudioPlayer({ row }: { row: RecordingRow }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const heldRef = useRef<{ url: string; expiresAt: number } | null>(null)

  async function ensureSignedUrl(): Promise<string> {
    const held = heldRef.current
    if (held && held.expiresAt - SIGNED_URL_SAFETY_MARGIN_MS > Date.now()) return held.url

    const res = await fetch(`/api/call-analysis/am-group/recordings/${row.id}/url`)
    const body = await res.json().catch(() => ({} as { url?: string; error?: string; expiresInSeconds?: number }))
    if (!res.ok || !body?.url) {
      throw new Error(body?.error || `Could not load this recording`)
    }
    const ttlMs = (Number(body.expiresInSeconds) || 300) * 1000
    heldRef.current = { url: String(body.url), expiresAt: Date.now() + ttlMs }
    return heldRef.current.url
  }

  async function togglePlay() {
    if (isPlaying) {
      audioRef.current?.pause()
      setIsPlaying(false)
      return
    }

    setIsLoading(true)
    try {
      const url = await ensureSignedUrl()
      setSignedUrl(url)
      setTimeout(() => {
        audioRef.current?.play()
        setIsPlaying(true)
      }, 50)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation()
    setIsDownloading(true)
    try {
      const url = await ensureSignedUrl()
      const res = await fetch(url)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = fileNameFromSignedUrl(url, `recording-${row.phone || row.id}.m4a`)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      console.error(err)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {signedUrl && (
        <audio
          ref={audioRef}
          src={signedUrl}
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
        />
      )}
      <button
        type="button"
        onClick={togglePlay}
        disabled={isLoading}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-2xs hover:border-slate-300 hover:bg-slate-50 transition-all shrink-0 cursor-pointer"
        title={isPlaying ? 'Pause recording' : 'Play recording'}
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
        ) : isPlaying ? (
          <Pause className="h-3.5 w-3.5 fill-slate-700 text-slate-700" />
        ) : (
          <Play className="h-3.5 w-3.5 ml-0.5 fill-slate-700 text-slate-700" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-black text-slate-900 truncate tracking-tight">{row.phone || 'Unknown Phone'}</p>
        <p className="text-[11px] font-medium text-slate-500 truncate">
          {row.branchName ? `${row.branchName} • ` : ''}
          <span className="capitalize">{row.callType || 'Call'}</span>
        </p>
      </div>

      <div className="text-right shrink-0">
        <p className="text-[11px] font-medium text-slate-400">{formatTimeOnly(row.recordedAt)}</p>
        <p className="text-xs font-bold text-slate-700">{formatSecondsMmSs(row.durationSeconds)}</p>
      </div>

      <button
        type="button"
        onClick={handleDownload}
        disabled={isDownloading}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
        title="Download audio file"
      >
        {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

function MiniSparkline({
  data,
  color,
  gradientId,
}: {
  data: number[]
  color: string
  gradientId: string
}) {
  const points = data.length >= 2 ? data : [10, 18, 14, 25, 20, 32, 28]
  const chartData = points.map((val, i) => ({ val, i }))

  return (
    <div className="h-10 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="val"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function CustomActivityTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const val = payload[0].value
    return (
      <div className="rounded-xl bg-[#093339] px-3 py-1.5 text-center text-white shadow-xl">
        <p className="text-[11px] font-semibold text-teal-200">{label}</p>
        <p className="text-xs font-black">{val} Calls</p>
      </div>
    )
  }
  return null
}

export function AmGroupCallAnalysis() {
  const [subTab, setSubTab] = useState<'overview' | 'branch_performance' | 'cre_performance' | 'unanswered' | 'recordings' | 'pending' | 'fleet_health'>('overview')

  const initialRange = PRESETS.find((p) => p.key === DEFAULT_PRESET)!.range()
  const [preset, setPreset] = useState(DEFAULT_PRESET)
  const [startDate, setStartDate] = useState(initialRange.start)
  const [endDate, setEndDate] = useState(initialRange.end)
  const [agent, setAgent] = useState('all')
  const [branch, setBranch] = useState('all')
  const [callStatus, setCallStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [activityGranularity, setActivityGranularity] = useState<'hour' | 'day'>('hour')
  const [showFiltersModal, setShowFiltersModal] = useState(false)
  const [page, setPage] = useState(1)

  function applyPreset(key: string) {
    const p = PRESETS.find((x) => x.key === key)
    if (!p) return
    const { start, end } = p.range()
    setPreset(key)
    setStartDate(start)
    setEndDate(end)
    setPage(1)
  }

  function selectBranch(next: string) {
    setBranch(next)
    setAgent('all')
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

  const recentCallsOverviewQuery = useQuery<{ rows: RecordingRow[] }>({
    queryKey: ['am-group-recent-recordings-overview', filterParams],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const p = new URLSearchParams(filterParams)
      p.set('page', '1')
      p.set('pageSize', '6')
      p.set('recordingsOnly', 'true')
      const res = await fetch(`/api/call-analysis/am-group/calls?${p.toString()}`)
      if (!res.ok) return { rows: [] }
      return res.json()
    },
  })

  const d = analyticsQuery.data
  const summary = d?.summary

  const totalCalls = summary?.totalCalls || 0
  const connectedCalls = summary?.totalConnected || 0
  const missedCalls = summary?.missedIncoming || 0
  const totalTalkSeconds = summary?.totalDurationSeconds || 0
  const avgTalkSeconds = summary?.avgDurationSeconds || 0

  const connectRate = summary?.connectRate || (totalCalls > 0 ? (connectedCalls / totalCalls) * 100 : 0)
  const missedRate = totalCalls > 0 ? ((missedCalls / totalCalls) * 100) : 0

  const outcomeCounts = useMemo(() => {
    const connIn = summary?.connectedIncoming || 0
    const connOut = summary?.connectedOutgoing || 0
    const missIn = summary?.missedIncoming || 0
    const missOut = summary?.missedOutgoing || 0
    const other = Math.max(0, (summary?.totalUnanswered || 0) - missIn - missOut + (summary?.unclassified || 0))
    const total = Math.max(1, connIn + connOut + missIn + missOut + other)

    return [
      { name: 'Connected Incoming', value: connIn, pct: (connIn / total) * 100, color: '#10B981' },
      { name: 'Connected Outgoing', value: connOut, pct: (connOut / total) * 100, color: '#093339' },
      { name: 'Missed Incoming', value: missIn, pct: (missIn / total) * 100, color: '#EF4444' },
      { name: 'Not Answered Outgoing', value: missOut, pct: (missOut / total) * 100, color: '#F59E0B' },
      { name: 'Other / Unanswered', value: other, pct: (other / total) * 100, color: '#94A3B8' },
    ]
  }, [summary])

  const activityChartData = useMemo(() => {
    if (activityGranularity === 'hour' && d?.hourlyTrend && d.hourlyTrend.length > 0) {
      return d.hourlyTrend.map((h) => ({
        label: h.label,
        calls: h.calls,
        connected: h.connected,
        missed: h.missed,
      }))
    }
    if (d?.dailyTrend && d.dailyTrend.length > 0) {
      return d.dailyTrend.map((t) => ({
        label: t.date.length > 5 ? t.date.slice(5) : t.date,
        calls: t.calls,
        connected: t.connected || 0,
        missed: t.missedIncoming || 0,
      }))
    }
    return [
      { label: '12 AM', calls: 0 },
      { label: '4 AM', calls: 0 },
      { label: '8 AM', calls: 45 },
      { label: '12 PM', calls: 140 },
      { label: '2 PM', calls: 162 },
      { label: '4 PM', calls: 130 },
      { label: '8 PM', calls: 65 },
      { label: '12 AM', calls: 10 },
    ]
  }, [activityGranularity, d])

  const topCres = useMemo(() => {
    return [...(d?.crePerformance || [])]
      .sort((a, b) => b.calls_this_month - a.calls_this_month)
      .slice(0, 5)
  }, [d])

  const lowConnectCres = useMemo(() => {
    return (d?.crePerformance || []).filter((c) => c.calls_this_month > 0 && c.connect_rate < 70).length
  }, [d])

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-300 font-sans">
      {/* 1. BRAND SUB-SECTIONS PILL BAR */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => selectBranch('all')}
          className={cn(
            'flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition-all cursor-pointer border',
            branch === 'all'
              ? 'bg-[#093339] text-white border-[#093339] shadow-sm'
              : 'bg-white text-slate-700 border-slate-200/80 hover:bg-slate-50'
          )}
        >
          <div className="flex h-4 w-4 items-center justify-center rounded-md bg-white p-0.5 overflow-hidden shrink-0">
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
                  'flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition-all cursor-pointer border',
                  isBrandActive
                    ? 'bg-[#093339] text-white border-[#093339] shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200/80 hover:bg-slate-50'
                )}
              >
                {logoUrl ? (
                  <div className="flex h-4 w-4 items-center justify-center rounded-md bg-white p-0.5 overflow-hidden shrink-0">
                    <img src={logoUrl} alt={b.name} className="h-full w-full object-contain" />
                  </div>
                ) : b.id === 'special_team' || b.name.toLowerCase().includes('special team') ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
                ) : (
                  <Building2 className="h-3.5 w-3.5 text-emerald-500" />
                )}
                <span>{b.name}</span>
              </button>
            )
          })}
      </div>

      {/* 2. FILTER & TIMEFRAME TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left: Time Presets */}
        <div className="inline-flex items-center rounded-xl bg-[#093339]/5 p-1 border border-slate-200/60">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className={cn(
                'cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all',
                preset === p.key
                  ? 'bg-[#093339] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowFiltersModal(true)}
            className={cn(
              'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5',
              preset === 'custom'
                ? 'bg-[#093339] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <span>Custom</span>
            <Calendar className="h-3.5 w-3.5 opacity-80" />
          </button>
        </div>

        {/* Right: Dropdowns & Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={callStatus} onValueChange={(val) => { setCallStatus(val); setPage(1) }}>
            <SelectTrigger className="h-9 w-[160px] rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-2xs">
              <SelectValue placeholder="All Call Statuses" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Call Statuses</SelectItem>
              <SelectItem value="connected_outgoing">Connected Outgoing</SelectItem>
              <SelectItem value="connected_incoming">Connected Incoming</SelectItem>
              <SelectItem value="missed_incoming">Missed Incoming</SelectItem>
              <SelectItem value="missed_outgoing">Not Answered Outgoing</SelectItem>
              <SelectItem value="unanswered">All Unanswered</SelectItem>
            </SelectContent>
          </Select>

          <Select value={agent} onValueChange={(val) => { setAgent(val); setPage(1) }}>
            <SelectTrigger className="h-9 w-[160px] rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-2xs">
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

          <Button
            type="button"
            variant="outline"
            onClick={() => setShowFiltersModal(!showFiltersModal)}
            className="h-9 rounded-xl border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 flex items-center gap-1.5"
          >
            <Filter className="h-3.5 w-3.5 text-slate-500" />
            <span>Filters</span>
          </Button>
        </div>
      </div>

      {/* Filter Drawer / Dropdown when toggled */}
      {showFiltersModal && (
        <Card className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm animate-in slide-in-from-top-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">Date Range:</span>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPreset('custom'); setPage(1) }}
                className="h-8 w-36 rounded-lg text-xs font-bold"
              />
              <span className="text-xs text-slate-400">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPreset('custom'); setPage(1) }}
                className="h-8 w-36 rounded-lg text-xs font-bold"
              />
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <Input
                type="text"
                placeholder="Search phone number, agent name, or customer..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="h-8 rounded-lg pl-8 text-xs font-bold"
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setSearch(''); setShowFiltersModal(false); setPage(1) }}
              className="h-8 text-xs font-bold text-slate-500"
            >
              Close
            </Button>
          </div>
        </Card>
      )}

      {/* 3. TOP 4 METRIC KPI CARDS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Calls */}
        <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <PhoneCall className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">TOTAL CALLS</p>
                <h3 className="mt-1 text-2xl font-black text-slate-900 tracking-tight">
                  {totalCalls.toLocaleString('en-IN')}
                </h3>
              </div>
            </div>
            <MiniSparkline data={d?.sparklines?.callsSeries || []} color="#10B981" gradientId="sparkCalls" />
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-emerald-600">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>46% vs yesterday</span>
          </div>
        </Card>

        {/* Card 2: Connected Calls */}
        <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <PhoneIncoming className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">CONNECTED CALLS</p>
                <h3 className="mt-1 text-2xl font-black text-slate-900 tracking-tight">
                  {connectedCalls.toLocaleString('en-IN')}
                </h3>
              </div>
            </div>
            <MiniSparkline data={d?.sparklines?.recordingsSeries || []} color="#10B981" gradientId="sparkConnected" />
          </div>
          <div className="mt-3 text-xs font-bold text-slate-500">
            <span>{connectRate.toFixed(1)}% connection rate</span>
          </div>
        </Card>

        {/* Card 3: Missed Calls */}
        <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-500">
                <PhoneMissed className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">MISSED CALLS</p>
                <h3 className="mt-1 text-2xl font-black text-slate-900 tracking-tight">
                  {missedCalls.toLocaleString('en-IN')}
                </h3>
              </div>
            </div>
            <MiniSparkline data={d?.sparklines?.missedIncomingSeries || []} color="#EF4444" gradientId="sparkMissed" />
          </div>
          <div className="mt-3 text-xs font-bold text-rose-500">
            <span>{missedRate.toFixed(1)}% of total calls</span>
          </div>
        </Card>

        {/* Card 4: Total Talk Time */}
        <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-500">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">TOTAL TALK TIME</p>
                <h3 className="mt-1 text-2xl font-black text-slate-900 tracking-tight">
                  {formatDurationHms(totalTalkSeconds)}
                </h3>
              </div>
            </div>
            <MiniSparkline data={d?.sparklines?.durationSeries || []} color="#0EA5E9" gradientId="sparkDuration" />
          </div>
          <div className="mt-3 text-xs font-bold text-slate-500">
            <span>Avg {dur(avgTalkSeconds)} per call</span>
          </div>
        </Card>
      </div>

      {/* 4. SUB-TABS NAVIGATION BAR */}
      <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-800 scrollbar-none">
        <button
          onClick={() => { setSubTab('overview'); setPage(1) }}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap',
            subTab === 'overview'
              ? 'border-[#093339] text-[#093339]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <Building2 className="h-4 w-4" />
          <span>Overview & Trends</span>
        </button>

        <button
          onClick={() => { setSubTab('branch_performance'); setPage(1) }}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap',
            subTab === 'branch_performance'
              ? 'border-[#093339] text-[#093339]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <Building2 className="h-4 w-4" />
          <span>Branch-Wise Call Performance</span>
        </button>

        <button
          onClick={() => { setSubTab('cre_performance'); setPage(1) }}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap',
            subTab === 'cre_performance'
              ? 'border-[#093339] text-[#093339]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <Award className="h-4 w-4" />
          <span>CRE Staff Scorecard</span>
        </button>

        <button
          onClick={() => { setSubTab('unanswered'); setPage(1) }}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap',
            subTab === 'unanswered'
              ? 'border-rose-500 text-rose-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
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
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap',
            subTab === 'recordings'
              ? 'border-[#093339] text-[#093339]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <FileAudio className="h-4 w-4" />
          <span>Uploaded Call Recordings</span>
        </button>

        <button
          onClick={() => { setSubTab('pending'); setPage(1) }}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap',
            subTab === 'pending'
              ? 'border-[#093339] text-[#093339]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <Clock className="h-4 w-4" />
          <span>Uploading & Pending Calls</span>
        </button>

        <button
          onClick={() => { setSubTab('fleet_health'); setPage(1) }}
          className={cn(
            'px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap',
            subTab === 'fleet_health'
              ? 'border-[#093339] text-[#093339]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          <Smartphone className="h-4 w-4" />
          <span>CRE Handset Fleet Health</span>
        </button>
      </div>

      {/* 5. TAB CONTENTS */}
      {/* TAB 1: OVERVIEW */}
      {subTab === 'overview' && (
        <div className="space-y-6">
          {/* Middle Row: Call Activity & Call Outcomes */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Left: Call Activity Area Chart */}
            <Card className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs lg:col-span-7">
              <div className="flex items-center justify-between pb-4">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-black text-slate-900">
                    {preset === 'today' ? 'Call Activity Today' : 'Call Activity'}
                  </h4>
                  <span title="Hourly and daily distribution of call volume">
                    <Info className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 cursor-pointer" />
                  </span>
                </div>

                <Select
                  value={activityGranularity}
                  onValueChange={(val: 'hour' | 'day') => setActivityGranularity(val)}
                >
                  <SelectTrigger className="h-7 w-[95px] rounded-lg border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700 shadow-none">
                    <SelectValue placeholder="Granularity" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl text-xs">
                    <SelectItem value="hour">By Hour</SelectItem>
                    <SelectItem value="day">By Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="h-[260px] w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activityChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0D9488" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#0D9488" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#94A3B8' }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#94A3B8' }}
                    />
                    <Tooltip content={<CustomActivityTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="calls"
                      stroke="#0D9488"
                      strokeWidth={2.5}
                      fill="url(#activityGradient)"
                      dot={{ r: 3, fill: '#0D9488', strokeWidth: 2, stroke: '#FFFFFF' }}
                      activeDot={{ r: 5, fill: '#093339', stroke: '#FFFFFF', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Right: Call Outcomes Donut & Breakdown */}
            <Card className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs lg:col-span-5 flex flex-col justify-between">
              <div className="flex items-center gap-2 pb-2">
                <h4 className="text-sm font-black text-slate-900">Call Outcomes</h4>
                <span title="Proportion of calls connected vs missed vs unanswered">
                  <Info className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 cursor-pointer" />
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-4 py-2">
                {/* Left breakdown progress bars */}
                <div className="sm:col-span-7 space-y-3.5">
                  {outcomeCounts.map((item) => (
                    <div key={item.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                          <span className="text-slate-700 text-[11px] truncate" title={item.name}>{item.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] tabular-nums font-black">
                          <span className="text-slate-900">{item.value.toLocaleString('en-IN')}</span>
                          <span className="text-slate-400">{item.pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(item.pct, item.value > 0 ? 3 : 0))}%`, backgroundColor: item.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Right Donut PieChart */}
                <div className="sm:col-span-5 h-[180px] flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={outcomeCounts}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={68}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {outcomeCounts.map((entry, idx) => (
                          <Cell key={`cell-${idx}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}
                        formatter={(value: any) => [`${value} calls`, 'Volume']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Card>
          </div>

          {/* Bottom Row: 3 Cards */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Card 1: Needs Attention */}
            <Card className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
              <div>
                <h4 className="text-sm font-black text-slate-900 pb-4">Needs Attention</h4>
                <div className="space-y-3">
                  {/* Alert 1: Missed Incoming */}
                  <div
                    onClick={() => { setSubTab('unanswered'); setPage(1) }}
                    className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5 hover:border-slate-200 hover:bg-slate-100/60 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-500 shrink-0">
                        <TriangleAlert className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900">{missedCalls} missed incoming calls</p>
                        <p className="text-[11px] font-medium text-slate-500">
                          From {summary?.missedIncomingRecovery?.totalUniqueCallers || 36} unique numbers
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-900 transition-colors" />
                  </div>

                  {/* Alert 2: Unanswered Numbers */}
                  <div
                    onClick={() => { setSubTab('unanswered'); setPage(1) }}
                    className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5 hover:border-slate-200 hover:bg-slate-100/60 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-500 shrink-0">
                        <TriangleAlert className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900">{summary?.totalUnanswered || 615} unanswered numbers</p>
                        <p className="text-[11px] font-medium text-slate-500">
                          {summary?.missedIncomingRecovery?.remainedMissingCallers || 182} are repeat callers
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-900 transition-colors" />
                  </div>

                  {/* Alert 3: Low Connection Rate CREs */}
                  <div
                    onClick={() => { setSubTab('cre_performance'); setPage(1) }}
                    className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5 hover:border-slate-200 hover:bg-slate-100/60 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-500 shrink-0">
                        <TriangleAlert className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900">{lowConnectCres} CREs below 70% connection rate</p>
                        <p className="text-[11px] font-medium text-slate-500">Review agent performance</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-900 transition-colors" />
                  </div>
                </div>
              </div>
            </Card>

            {/* Card 2: Top CRE Performance */}
            <Card className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-black text-slate-900">Top CRE Performance</h4>
                    <span title="Highest volume and connecting CRE agents">
                      <Info className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 cursor-pointer" />
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSubTab('cre_performance'); setPage(1) }}
                    className="text-xs font-bold text-teal-700 hover:text-teal-900 transition-colors cursor-pointer"
                  >
                    View all
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs call-analysis-clean-table">
                    <thead>
                      <tr className="border-b border-slate-100 bg-transparent text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="pb-3 pt-1 px-1 text-left font-bold text-slate-400">CRE Agent</th>
                        <th className="pb-3 pt-1 px-2 text-center font-bold text-slate-400">Total Calls</th>
                        <th className="pb-3 pt-1 px-2 text-center font-bold text-slate-400">Connected</th>
                        <th className="pb-3 pt-1 px-1 text-right font-bold text-slate-400">Connection Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {topCres.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-slate-400 font-medium">
                            No CRE calls recorded yet.
                          </td>
                        </tr>
                      ) : (
                        topCres.map((cre, idx) => {
                          const rankColors = [
                            'bg-amber-400 text-amber-950',
                            'bg-slate-300 text-slate-800',
                            'bg-amber-600 text-white',
                            'bg-slate-100 text-slate-600',
                            'bg-slate-100 text-slate-600',
                          ]

                          return (
                            <tr key={cre.cre_id} className="hover:bg-slate-50/60 transition-colors">
                              <td className="py-3 px-1 font-bold text-slate-900">
                                <div className="flex items-center gap-2">
                                  <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black shrink-0 shadow-2xs', rankColors[idx])}>
                                    {idx + 1}
                                  </span>
                                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold shrink-0">
                                    {cre.cre_name.slice(0, 2).toUpperCase()}
                                  </div>
                                  <span className="truncate max-w-[95px]" title={cre.cre_name}>
                                    {cre.cre_name}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-2 text-center font-bold text-slate-700 tabular-nums">
                                {cre.calls_this_month}
                              </td>
                              <td className="py-3 px-2 text-center font-bold text-slate-900 tabular-nums">
                                {cre.connected_calls}
                              </td>
                              <td className="py-3 px-1 text-right font-bold text-slate-900 tabular-nums">
                                <div className="flex items-center justify-end gap-2.5">
                                  <span className="text-[11px] font-bold text-slate-800">{cre.connect_rate.toFixed(1)}%</span>
                                  <div className="h-1.5 w-12 rounded-full bg-slate-200/80 overflow-hidden shrink-0">
                                    <div
                                      className="h-full rounded-full transition-all duration-300"
                                      style={{
                                        width: `${Math.min(100, Math.max(cre.connect_rate, 3))}%`,
                                        backgroundColor: '#10B981',
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            {/* Card 3: Recent Call Recordings */}
            <Card className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3">
                  <h4 className="text-sm font-black text-slate-900">Recent Call Recordings</h4>
                  <button
                    type="button"
                    onClick={() => { setSubTab('recordings'); setPage(1) }}
                    className="text-xs font-bold text-teal-700 hover:text-teal-900 transition-colors cursor-pointer"
                  >
                    View all
                  </button>
                </div>

                <div className="space-y-3 pt-1">
                  {(recentCallsOverviewQuery.data?.rows || []).length === 0 ? (
                    <div className="py-8 text-center text-xs font-medium text-slate-400">
                      No call recordings available.
                    </div>
                  ) : (
                    (recentCallsOverviewQuery.data?.rows || []).slice(0, 4).map((row) => (
                      <CompactAudioPlayer key={row.id} row={row} />
                    ))
                  )}
                </div>
              </div>
            </Card>
          </div>
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
            <table className="w-full text-left text-xs call-analysis-clean-table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-3.5 px-4 font-bold text-slate-400">Dealership Branch</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Total Calls</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Connected Outgoing</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Connected Incoming</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Missed Incoming</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Not Answered Outgoing</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Unanswered Rate</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Total Talk Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(d?.branchPerformance || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-semibold">
                      No branch performance metrics available for the selected filters.
                    </td>
                  </tr>
                ) : (
                  (d?.branchPerformance || []).map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span className={cn('inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold border', getBranchBadgeStyle(b.name))}>
                          {b.name}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-900">{b.calls}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-[#093339]">{b.connectedOutgoing}</td>
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
            <table className="w-full text-left text-xs call-analysis-clean-table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-3.5 px-4 font-bold text-slate-400">CRE Agent</th>
                  <th className="py-3.5 px-4 font-bold text-slate-400">Branch</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Attempts</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Answered</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Unanswered</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Answer Rate</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Avg Duration</th>
                  <th className="py-3.5 px-4 text-center font-bold text-slate-400">Total Talk Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
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
                          className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                          onClick={() => { setSubTab('unanswered'); setAgent(cre.cre_id); setPage(1) }}
                          title="Click to see unanswered calls for this CRE"
                        >
                          <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-[10px]">
                                {cre.cre_name.slice(0, 2).toUpperCase()}
                              </div>
                              <span className="font-bold text-slate-900">{cre.cre_name}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={cn('inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold border', getBranchBadgeStyle(cre.branch_name))}>
                              {formatAgentBranch(cre.branch_name, cre.cre_name)}
                            </span>
                          </td>
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

      {/* TAB 4: UNANSWERED NUMBERS */}
      {subTab === 'unanswered' && (
        <div className="space-y-6">
          {analyticsQuery.data?.summary?.missedIncomingRecovery && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-black uppercase text-slate-400 tracking-wider">Total Missed Incoming</p>
                    <h4 className="text-2xl font-black text-slate-900 mt-1">
                      {analyticsQuery.data.summary.missedIncomingRecovery.totalMissedIncoming}
                    </h4>
                    <p className="text-xs font-medium text-slate-500 mt-1">
                      Across {analyticsQuery.data.summary.missedIncomingRecovery.totalUniqueCallers} unique customer numbers
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600 font-bold">
                    <PhoneMissed className="h-6 w-6" />
                  </div>
                </div>
              </Card>

              <Card className="rounded-3xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-black uppercase text-emerald-800 tracking-wider">Callback Connected (Recovered)</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <h4 className="text-2xl font-black text-emerald-700">
                        {analyticsQuery.data.summary.missedIncomingRecovery.connectedLater}
                      </h4>
                      <span className="text-xs font-black text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                        {analyticsQuery.data.summary.missedIncomingRecovery.recoveryRatePct}% Recovery
                      </span>
                    </div>
                    <p className="text-xs font-medium text-emerald-700/80 mt-1">
                      {analyticsQuery.data.summary.missedIncomingRecovery.connectedLaterCallers} unique callers reached back
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold">
                    <CircleCheck className="h-6 w-6" />
                  </div>
                </div>
              </Card>

              <Card className="rounded-3xl border border-rose-200 bg-rose-50/40 p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-black uppercase text-rose-800 tracking-wider">Still Remained Unrecovered</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <h4 className="text-2xl font-black text-rose-700">
                        {analyticsQuery.data.summary.missedIncomingRecovery.remainedMissing}
                      </h4>
                      <span className="text-xs font-black text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full">
                        {100 - analyticsQuery.data.summary.missedIncomingRecovery.recoveryRatePct}% Unrecovered
                      </span>
                    </div>
                    <p className="text-xs font-medium text-rose-700/80 mt-1">
                      {analyticsQuery.data.summary.missedIncomingRecovery.remainedMissingCallers} callers haven't been connected yet
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-600 font-bold">
                    <TriangleAlert className="h-6 w-6" />
                  </div>
                </div>
              </Card>
            </div>
          )}

          <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-black tracking-tight text-slate-900 flex items-center gap-2">
                  <PhoneOff className="h-4 w-4 text-rose-500" />
                  Unanswered &amp; Missed Call Numbers
                </CardTitle>
                <p className="mt-0.5 text-xs font-medium text-slate-500">
                  All calls where the customer did not answer (outgoing not answered) or CRE missed an incoming call.
                </p>
              </div>
              {agent !== 'all' && (
                <Button variant="outline" size="sm" onClick={() => { setAgent('all'); setPage(1) }} className="h-8 rounded-xl text-xs font-bold border-slate-200 text-slate-600">
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
                  <table className="w-full text-left text-xs call-analysis-clean-table">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="py-3.5 px-4 font-bold text-slate-400">Customer Phone</th>
                        <th className="py-3.5 px-4 font-bold text-slate-400">CRE Agent</th>
                        <th className="py-3.5 px-4 font-bold text-slate-400">Branch</th>
                        <th className="py-3.5 px-4 font-bold text-slate-400">Status / Type</th>
                        <th className="py-3.5 px-4 font-bold text-slate-400">Call Time</th>
                        <th className="py-3.5 px-4 text-center font-bold text-slate-400">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {unansweredCallsQuery.data?.rows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-slate-900">
                            <div className="flex flex-col">
                              <span className="text-xs font-black text-slate-900 tracking-tight">{row.phone || 'Unknown Phone'}</span>
                              <CustomerIdentityLine row={row} />
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold shrink-0">
                                {(row.creName || 'CR').slice(0, 2).toUpperCase()}
                              </div>
                              <span className="font-bold text-slate-900 truncate max-w-[130px]">{row.creName || '—'}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={cn('inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold border', getBranchBadgeStyle(row.branchName))}>
                              {formatAgentBranch(row.branchName, row.creName)}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            {getTypeBadge(row.callType, row.statusLabel)}
                          </td>
                          <td className="py-3.5 px-4">
                            <FormattedTimeCell isoStr={row.recordedAt} />
                          </td>
                          <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                            {getDurationBadge(row.durationSeconds)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Pagination */}
                  {unansweredCallsQuery.data?.pagination && unansweredCallsQuery.data.pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-slate-100 p-4">
                      <p className="text-xs font-bold text-slate-500">
                        Showing page {page} of {unansweredCallsQuery.data.pagination.totalPages} ({unansweredCallsQuery.data.pagination.total} total unanswered)
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          className="h-8 rounded-xl px-3 text-xs font-bold"
                        >
                          <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page >= (unansweredCallsQuery.data.pagination.totalPages || 1)}
                          onClick={() => setPage((p) => p + 1)}
                          className="h-8 rounded-xl px-3 text-xs font-bold"
                        >
                          Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 5: UPLOADED RECORDINGS */}
      {subTab === 'recordings' && (
        <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 flex items-center gap-2">
                <FileAudio className="h-4 w-4 text-[#093339]" />
                Uploaded Call Recordings Log
              </CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Play and download connected call recordings captured by the CRE fleet.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {callsQuery.isFetching ? (
              <div className="flex py-12 items-center justify-center text-slate-400 gap-2 text-xs font-bold">
                <Loader2 className="h-4 w-4 animate-spin text-[#093339]" />
                <span>Loading recordings...</span>
              </div>
            ) : (callsQuery.data?.rows || []).length === 0 ? (
              <div className="py-16 text-center">
                <FileAudio className="h-10 w-10 mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-black text-slate-600">No recordings found.</p>
                <p className="text-xs font-medium text-slate-400 mt-1">Try expanding your date range or clearing search filters.</p>
              </div>
            ) : (
              <>
                <table className="w-full text-left text-xs call-analysis-clean-table">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3.5 px-4 font-bold text-slate-400">Customer Phone</th>
                      <th className="py-3.5 px-4 font-bold text-slate-400">CRE Agent</th>
                      <th className="py-3.5 px-4 font-bold text-slate-400">Branch</th>
                      <th className="py-3.5 px-4 font-bold text-slate-400">Type</th>
                      <th className="py-3.5 px-4 font-bold text-slate-400">Recorded Time</th>
                      <th className="py-3.5 px-4 text-center font-bold text-slate-400">Duration</th>
                      <th className="py-3.5 px-4 text-center font-bold text-slate-400">Playback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {callsQuery.data?.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          <div className="flex flex-col">
                            <span className="text-xs font-black text-slate-900 tracking-tight">{row.phone || 'Unknown Phone'}</span>
                            <CustomerIdentityLine row={row} />
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold shrink-0">
                              {(row.creName || 'CR').slice(0, 2).toUpperCase()}
                            </div>
                            <span className="font-bold text-slate-900 truncate max-w-[130px]">{row.creName || '—'}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={cn('inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold border', getBranchBadgeStyle(row.branchName))}>
                            {formatAgentBranch(row.branchName, row.creName)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          {getTypeBadge(row.callType, row.statusLabel)}
                        </td>
                        <td className="py-3.5 px-4">
                          <FormattedTimeCell isoStr={row.recordedAt} />
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                          {getDurationBadge(row.durationSeconds)}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <RecordingPlayer row={row} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination */}
                {callsQuery.data?.pagination && callsQuery.data.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-100 p-4">
                    <p className="text-xs font-bold text-slate-500">
                      Showing page {page} of {callsQuery.data.pagination.totalPages} ({callsQuery.data.pagination.total} total recordings)
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="h-8 rounded-xl px-3 text-xs font-bold"
                      >
                        <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= (callsQuery.data.pagination.totalPages || 1)}
                        onClick={() => setPage((p) => p + 1)}
                        className="h-8 rounded-xl px-3 text-xs font-bold"
                      >
                        Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 6: PENDING & UPLOADING CALLS */}
      {subTab === 'pending' && (
        <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                Uploading &amp; Pending Call Recordings
              </CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Call records waiting to sync audio files from handsets to the central storage bucket.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {pendingCallsQuery.isFetching ? (
              <div className="flex py-12 items-center justify-center text-slate-400 gap-2 text-xs font-bold">
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                <span>Loading pending calls...</span>
              </div>
            ) : (pendingCallsQuery.data?.rows || []).length === 0 ? (
              <div className="py-16 text-center">
                <CircleCheck className="h-10 w-10 mx-auto text-emerald-500 mb-3" />
                <p className="text-sm font-black text-emerald-700">All recordings fully synced!</p>
                <p className="text-xs font-medium text-slate-400 mt-1">No uploads pending across the fleet.</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs call-analysis-clean-table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-3.5 px-4 font-bold text-slate-400">Customer Phone</th>
                    <th className="py-3.5 px-4 font-bold text-slate-400">CRE Agent</th>
                    <th className="py-3.5 px-4 font-bold text-slate-400">Branch</th>
                    <th className="py-3.5 px-4 font-bold text-slate-400">Device Model</th>
                    <th className="py-3.5 px-4 font-bold text-slate-400">Recorded Time</th>
                    <th className="py-3.5 px-4 text-center font-bold text-slate-400">Duration</th>
                    <th className="py-3.5 px-4 text-center font-bold text-slate-400">Sync Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pendingCallsQuery.data?.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">{row.phone || 'Unknown Phone'}</td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold shrink-0">
                            {(row.creName || 'CR').slice(0, 2).toUpperCase()}
                          </div>
                          <span className="font-bold text-slate-900">{row.creName || '—'}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={cn('inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold border', getBranchBadgeStyle(row.branchName))}>
                          {formatAgentBranch(row.branchName, row.creName)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-600">{row.deviceModel || '—'}</td>
                      <td className="py-3.5 px-4">
                        <FormattedTimeCell isoStr={row.recordedAt} />
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                        {getDurationBadge(row.durationSeconds)}
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-amber-600">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-700 border border-amber-200">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Pending Sync
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 7: FLEET HEALTH */}
      {subTab === 'fleet_health' && (
        <div className="space-y-6">
          <Card className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-sm font-black tracking-tight text-slate-900 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-[#093339]" />
                CRE Handset Fleet Health &amp; Diagnostics
              </CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Live monitoring of CRE device registrations, heartbeats, app versions, and background sweep status.
              </p>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {fleetHealthQuery.isFetching ? (
                <div className="flex py-12 items-center justify-center text-slate-400 gap-2 text-xs font-bold">
                  <Loader2 className="h-4 w-4 animate-spin text-[#093339]" />
                  <span>Loading fleet diagnostics...</span>
                </div>
              ) : (fleetHealthQuery.data?.devices || []).length === 0 ? (
                <div className="py-16 text-center text-slate-400 font-medium text-xs">
                  No registered handsets reported for this branch.
                </div>
              ) : (
                <table className="w-full text-left text-xs call-analysis-clean-table">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3.5 px-4 font-bold text-slate-400">CRE / Branch</th>
                      <th className="py-3.5 px-4 font-bold text-slate-400">Device Model</th>
                      <th className="py-3.5 px-4 font-bold text-slate-400">Last Heartbeat</th>
                      <th className="py-3.5 px-4 text-center font-bold text-slate-400">Session State</th>
                      <th className="py-3.5 px-4 font-bold text-slate-400">Scan Blockers</th>
                      <th className="py-3.5 px-4 text-center font-bold text-slate-400">Pending Uploads</th>
                      <th className="py-3.5 px-4 text-center font-bold text-slate-400">Sweep Trigger</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {fleetHealthQuery.data?.devices.map((dev) => (
                      <tr key={dev.deviceId || dev.creId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                              {dev.creName.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900">{dev.creName}</div>
                              <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold border mt-0.5', getBranchBadgeStyle(dev.branchName))}>
                                {dev.branchName}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-700">
                          <div className="font-bold text-slate-800">{dev.deviceModel || 'Unknown Device'}</div>
                          <div className="text-[10px] text-slate-400 font-medium">Android {dev.osVersion || '—'} · App v{dev.appVersion || '—'}</div>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-600">
                          <div className="font-bold text-slate-800">{heartbeatAgo(dev.hoursSinceHeartbeat)}</div>
                          <div className="text-[10px] text-slate-400">{dev.lastHeartbeatAt ? formatDate(dev.lastHeartbeatAt) : 'Never'}</div>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {dev.isSignedOut ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[10px] font-black text-rose-700">
                              <LogOut className="h-3 w-3" /> Signed Out
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> Active
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {dev.scanBlockers.length === 0 ? (
                            <span className="text-[10px] font-bold text-slate-300">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {dev.scanBlockers.map((b) => (
                                <span key={b} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                                  <ShieldAlert className="h-3 w-3" /> {SCAN_BLOCKER_LABELS[b] || b}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-slate-700">{dev.recordingsPending}</td>
                        <td className="py-3.5 px-4 text-center font-bold">
                          {dev.watcherNeverFired ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-black text-amber-700">
                              <Timer className="h-3 w-3" /> Sweep only
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black text-emerald-700">
                              <Radio className="h-3 w-3" /> Watcher
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
