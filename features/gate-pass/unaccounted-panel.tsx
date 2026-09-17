'use client'

import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  MapPin,
  Car,
  Clock,
  Search,
  X,
  FilePlus2,
  Copy,
  Check,
  Loader2,
  Zap,
  RotateCcw,
  HelpCircle,
  Navigation,
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
import { formatIndiaDateTime } from '@/lib/date-time'
import { toast } from '@/hooks/use-toast'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import { cn } from '@/lib/utils'

export type UnaccountedConfidence = 'live' | 'recent' | 'stale'

export type UnaccountedVehicle = {
  vin: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  branchLabel: string
  dealerCode?: string | null
  distanceKm: number
  address: string | null
  positionAt: string | null
  ageMs: number | null
  speedKph: number | null
  ignition: string | null
  confidence: UnaccountedConfidence
  engineOn: boolean
}

export type UnknowableVehicle = {
  vin: string
  registrationNumber: string | null
  model: string | null
  branchLabel: string
  dealerCode?: string | null
  reason: string
}

export type UnaccountedReport = {
  offSite: UnaccountedVehicle[]
  unknowable: UnknowableVehicle[]
  accountedFor: number
  fences: Array<{ dealerCode: string; label: string; radiusKm: number }>
  unfencedBranches: string[]
}

function agePhrase(ageMs: number | null): string {
  if (ageMs === null) return 'Time unknown'
  const minutes = Math.round(ageMs / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Yesterday' : `${days} days ago`
}

function getCarColorDot(colorStr?: string | null): string {
  if (!colorStr) return '#94a3b8'
  const c = colorStr.toLowerCase()
  if (c.includes('red')) return '#ef4444'
  if (c.includes('blue')) return '#2563eb'
  if (c.includes('white') || c.includes('pearl')) return '#f8fafc'
  if (c.includes('black')) return '#0f172a'
  if (c.includes('grey') || c.includes('gray')) return '#64748b'
  if (c.includes('silver')) return '#cbd5e1'
  if (c.includes('green')) return '#10b981'
  if (c.includes('yellow') || c.includes('gold')) return '#eab308'
  if (c.includes('orange')) return '#f97316'
  if (c.includes('brown')) return '#92400e'
  return '#94a3b8'
}

type UnaccountedTab = 'all' | 'live' | 'stale' | 'untracked'

export function UnaccountedPanel({
  onIssueGatePass,
  onTrackOnMap,
}: {
  onIssueGatePass?: (vin: string) => void
  onTrackOnMap?: (vin: string) => void
}) {
  const [activeSubTab, setActiveSubTab] = useState<UnaccountedTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<string>('all')
  const [copiedVin, setCopiedVin] = useState<string | null>(null)

  const { data, isLoading, error, refetch, isFetching } = useQuery<UnaccountedReport>({
    queryKey: ['gate-pass-unaccounted'],
    queryFn: async () => {
      const res = await fetch('/api/gate-pass/unaccounted', { cache: 'no-store' })
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Access restricted. Only Gate Pass Approvers and Managers can access unauthorized vehicle telemetry.')
        }
        throw new Error('Could not check fleet telemetry at this moment.')
      }
      return res.json()
    },
    refetchInterval: 60_000,
  })

  const offSite = data?.offSite ?? []
  const unknowable = data?.unknowable ?? []
  const liveCount = offSite.filter((v) => v.confidence === 'live').length
  const recentCount = offSite.filter((v) => v.confidence === 'recent').length
  const staleCount = offSite.filter((v) => v.confidence === 'stale').length
  const activeBreachesCount = liveCount + recentCount

  const filteredOffSite = useMemo(() => {
    return offSite.filter((v) => {
      // Tab filter
      if (activeSubTab === 'live' && v.confidence === 'stale') return false
      if (activeSubTab === 'stale' && v.confidence !== 'stale') return false

      // Branch filter
      if (selectedBranch !== 'all') {
        const branchMatches =
          (v.dealerCode && v.dealerCode.toUpperCase() === selectedBranch.toUpperCase()) ||
          v.branchLabel.toLowerCase().includes(selectedBranch.toLowerCase())
        if (!branchMatches) return false
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim().replace(/[\s\-_]/g, '')
        const reg = (v.registrationNumber || '').toLowerCase().replace(/[\s\-_]/g, '')
        const vin = v.vin.toLowerCase().replace(/[\s\-_]/g, '')
        const model = (v.model || '').toLowerCase().replace(/[\s\-_]/g, '')
        const variant = (v.variant || '').toLowerCase().replace(/[\s\-_]/g, '')
        const color = (v.color || '').toLowerCase().replace(/[\s\-_]/g, '')
        const branch = (v.branchLabel || '').toLowerCase().replace(/[\s\-_]/g, '')
        const addr = (v.address || '').toLowerCase()
        return (
          reg.includes(q) ||
          vin.includes(q) ||
          model.includes(q) ||
          variant.includes(q) ||
          color.includes(q) ||
          branch.includes(q) ||
          addr.includes(q)
        )
      }

      return true
    })
  }, [offSite, activeSubTab, selectedBranch, searchQuery])

  const filteredUnknowable = useMemo(() => {
    return unknowable.filter((v) => {
      if (selectedBranch !== 'all') {
        const branchMatches =
          (v.dealerCode && v.dealerCode.toUpperCase() === selectedBranch.toUpperCase()) ||
          v.branchLabel.toLowerCase().includes(selectedBranch.toLowerCase())
        if (!branchMatches) return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim().replace(/[\s\-_]/g, '')
        const reg = (v.registrationNumber || '').toLowerCase().replace(/[\s\-_]/g, '')
        const vin = v.vin.toLowerCase().replace(/[\s\-_]/g, '')
        const model = (v.model || '').toLowerCase().replace(/[\s\-_]/g, '')
        const reason = (v.reason || '').toLowerCase()
        return reg.includes(q) || vin.includes(q) || model.includes(q) || reason.includes(q)
      }
      return true
    })
  }, [unknowable, selectedBranch, searchQuery])

  const copyAlertInfo = (v: UnaccountedVehicle) => {
    const text = `🚨 *GATE PASS ALERT - DEMO VEHICLE OUT WITHOUT PASS*\n` +
      `🚗 Vehicle: ${v.registrationNumber || 'No Plate'} (${v.model || 'Demo Car'}${v.color ? ` - ${v.color}` : ''})\n` +
      `📍 Location: ${v.address || 'Address unavailable'} (${v.distanceKm} km outside ${v.branchLabel})\n` +
      `⚡ Engine: ${v.engineOn ? `RUNNING (${v.speedKph ?? 0} km/h)` : 'OFF / Parked'}\n` +
      `🕒 Last Fix: ${agePhrase(v.ageMs)} (${v.positionAt ? formatIndiaDateTime(v.positionAt) : 'N/A'})\n` +
      `🔑 VIN: ${v.vin}`

    navigator.clipboard.writeText(text).then(() => {
      setCopiedVin(v.vin)
      toast({
        title: 'Alert Copied to Clipboard',
        description: `Details for ${v.registrationNumber || v.vin} ready to paste in WhatsApp/Call.`,
      })
      setTimeout(() => setCopiedVin(null), 2500)
    })
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center shadow-xs">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-indigo-600 mb-3" />
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Scanning Live Fleet Telemetry...</p>
        <p className="text-xs text-slate-500 mt-1">Cross-referencing branch geofences with active gate passes.</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 p-8 text-center shadow-xs">
        <ShieldAlert className="mx-auto h-8 w-8 text-rose-600 dark:text-rose-400 mb-2" />
        <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">
          {error instanceof Error ? error.message : 'Unable to check fleet telemetry'}
        </h3>
        <p className="text-xs text-rose-700/80 dark:text-rose-300/80 mt-1 max-w-md mx-auto">
          Please verify your connection or check with your showroom manager to ensure you have approver permissions.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="mt-4 h-8 px-3 text-xs font-semibold bg-white dark:bg-slate-900 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Try Again
        </Button>
      </div>
    )
  }

  const hasActiveFilters = searchQuery !== '' || selectedBranch !== 'all' || activeSubTab !== 'all'

  return (
    <div className="space-y-4">
      {/* ── Top Header / Alert Banner ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-2xs',
                activeBreachesCount > 0
                  ? 'bg-rose-100 text-rose-700 border border-rose-200'
                  : 'bg-teal-50 text-teal-800 border border-teal-200'
              )}
            >
              {activeBreachesCount > 0 ? (
                <ShieldAlert className="h-5 w-5 animate-pulse" />
              ) : (
                <ShieldCheck className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Unauthorized Movement Telemetry
                </h2>
                {activeBreachesCount > 0 ? (
                  <span className="inline-flex items-center gap-1 bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                    Action Required ({activeBreachesCount})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 bg-teal-50 text-teal-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-teal-200">
                    <Check className="w-3 h-3" /> All Clear
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Live GPS tracker detection for demo cars currently outside showroom geofence boundaries with{' '}
                <strong className="text-slate-700">no active or approved gate pass</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-center shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8.5 px-3 text-xs font-semibold rounded-xl border-slate-200 cursor-pointer shadow-2xs"
            >
              <RotateCcw className={cn('w-3.5 h-3.5 mr-1.5', isFetching && 'animate-spin text-indigo-600')} />
              Refresh GPS
            </Button>
          </div>
        </div>

        {/* ── KPI Stat Pills / Quick Toggles ─────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-4 border-t border-slate-100">
          {/* Card 1: Active Off-Site */}
          <button
            type="button"
            onClick={() => setActiveSubTab(activeSubTab === 'live' ? 'all' : 'live')}
            className={cn(
              'p-3 rounded-xl border text-left transition-all cursor-pointer shadow-2xs',
              activeSubTab === 'live'
                ? 'bg-rose-50/80 border-rose-300 ring-2 ring-rose-500/20'
                : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
            )}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
              <span>Outside Geofence</span>
              <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black tabular-nums text-rose-600">
                {activeBreachesCount}
              </span>
              <span className="text-[10px] font-medium text-slate-500">unauthorized</span>
            </div>
          </button>

          {/* Card 2: Stale GPS */}
          <button
            type="button"
            onClick={() => setActiveSubTab('stale')}
            className={cn(
              'p-3 rounded-xl border text-left transition-all cursor-pointer shadow-2xs',
              activeSubTab === 'stale'
                ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-500/20'
                : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
            )}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
              <span>Stale GPS Signals</span>
              <Clock className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black tabular-nums text-slate-700">
                {staleCount}
              </span>
              <span className="text-[10px] font-medium text-slate-500">&gt;24h old fix</span>
            </div>
          </button>

          {/* Card 3: Accounted For */}
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
              <span>Accounted For</span>
              <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black tabular-nums text-teal-700">
                {data.accountedFor}
              </span>
              <span className="text-[10px] font-medium text-slate-500">on yard / on pass</span>
            </div>
          </div>

          {/* Card 4: Untracked */}
          <button
            type="button"
            onClick={() => setActiveSubTab('untracked')}
            className={cn(
              'p-3 rounded-xl border text-left transition-all cursor-pointer shadow-2xs',
              activeSubTab === 'untracked'
                ? 'bg-slate-200 dark:bg-slate-800 border-slate-400 dark:border-slate-600 ring-2 ring-slate-400/20'
                : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-slate-300'
            )}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              <span>No GPS Hardware</span>
              <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black tabular-nums text-slate-600 dark:text-slate-400">
                {unknowable.length}
              </span>
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">manual check only</span>
            </div>
          </button>
        </div>
      </div>

      {/* ── Toolbar: Sub-tabs, Search & Branch Filter ──────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
        {/* Sub-tab pills */}
        <div className="w-full sm:w-auto overflow-x-auto no-scrollbar scrollbar-none pb-1 sm:pb-0">
          <div className="flex items-center gap-1.5 min-w-max">
            <button
              type="button"
              onClick={() => setActiveSubTab('all')}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5',
                activeSubTab === 'all'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
            >
              <span>All Flagged</span>
              <span
                className={cn(
                  'min-w-[18px] h-4.5 px-1 rounded-full text-[10px] font-bold inline-flex items-center justify-center',
                  activeSubTab === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                )}
              >
                {offSite.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('live')}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5',
                activeSubTab === 'live'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
            >
              <span>Active (Today)</span>
              <span
                className={cn(
                  'min-w-[18px] h-4.5 px-1 rounded-full text-[10px] font-bold inline-flex items-center justify-center',
                  activeSubTab === 'live'
                    ? 'bg-white/20 text-white'
                    : activeBreachesCount > 0
                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 font-bold'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                )}
              >
                {activeBreachesCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('stale')}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5',
                activeSubTab === 'stale'
                  ? 'bg-slate-800 text-white dark:bg-slate-700 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
            >
              <span>Stale Fixes</span>
              <span
                className={cn(
                  'min-w-[18px] h-4.5 px-1 rounded-full text-[10px] font-bold inline-flex items-center justify-center',
                  activeSubTab === 'stale' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                )}
              >
                {staleCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('untracked')}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5',
                activeSubTab === 'untracked'
                  ? 'bg-slate-800 text-white dark:bg-slate-700 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              )}
            >
              <span>No GPS</span>
              <span
                className={cn(
                  'min-w-[18px] h-4.5 px-1 rounded-full text-[10px] font-bold inline-flex items-center justify-center',
                  activeSubTab === 'untracked' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                )}
              >
                {unknowable.length}
              </span>
            </button>
          </div>
        </div>

        {/* Search & Branch Select */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64 min-w-[160px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Search vehicle, VIN, location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8.5 pl-8 pr-7 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 w-full"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="h-8.5 flex-1 sm:w-36 min-w-[120px] text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 rounded-xl">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Branches</SelectItem>
              {KIA_BRANCH_DEALERS.map((b) => (
                <SelectItem key={b.dealerCode} value={b.dealerCode} className="text-xs">
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('')
                setSelectedBranch('all')
                setActiveSubTab('all')
              }}
              className="h-8.5 px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl cursor-pointer"
              title="Reset filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* ── UNTRACKED VEHICLES VIEW ──────────────────────────────────────────── */}
      {activeSubTab === 'untracked' ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Demo Cars Without Active GPS Tracking ({filteredUnknowable.length})
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              These vehicles cannot be monitored via automated GPS telemetry because they do not have a registered tracker or their branch lacks a defined geofence perimeter. Physical log verification is required.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Vehicle</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Branch</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Reason / Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-[11px] uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredUnknowable.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-slate-400">
                      No untracked vehicles match your current filter.
                    </td>
                  </tr>
                ) : (
                  filteredUnknowable.map((v) => (
                    <tr key={v.vin} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="inline-flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/80 px-2 py-0.5 rounded-md font-mono font-bold text-xs tracking-wider shadow-2xs">
                          <Car className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span>{v.registrationNumber || `VIN …${v.vin.slice(-6)}`}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 font-medium">
                          {v.model || 'Model Not Specified'}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{v.branchLabel}</span>
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {v.reason}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        {onIssueGatePass ? (
                          <Button
                            size="sm"
                            onClick={() => onIssueGatePass(v.vin)}
                            className="h-7 px-2.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-2xs cursor-pointer gap-1"
                          >
                            <FilePlus2 className="w-3.5 h-3.5" /> Issue Pass
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ── ACTIVE & STALE OFF-SITE VEHICLES TABLE ───────────────────────────── */}
      {activeSubTab !== 'untracked' ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          {/* Stale fix explainer callout when viewing stale or all */}
          {activeSubTab === 'stale' && (
            <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/30 border-b border-amber-200/80 dark:border-amber-900/60 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold">Historical / Sleeping Fixes:</strong> These coordinates are older than 24 hours. The GPS tracker enters sleep mode when parked. Check physical yard presence before escalating.
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Vehicle Details</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Geofence Breach &amp; Location</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Live Telemetry</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Fix Freshness</th>
                  <th className="px-4 py-3 text-right font-semibold text-[11px] uppercase tracking-wider">Direct Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOffSite.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center">
                      <div className="max-w-sm mx-auto space-y-2">
                        <div className="h-12 w-12 mx-auto rounded-full bg-teal-50 flex items-center justify-center text-teal-700 border border-teal-200 shadow-2xs">
                          <ShieldCheck className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-bold text-slate-800">
                          {hasActiveFilters ? 'No vehicles match current search/filter' : 'All Demo Vehicles Accounted For'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {hasActiveFilters
                            ? 'Try clearing the search query or changing branch filters.'
                            : 'No unauthorized demo cars detected outside showroom perimeters.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredOffSite.map((v) => {
                    const isLive = v.confidence === 'live'
                    const isRecent = v.confidence === 'recent'

                    return (
                      <tr
                        key={v.vin}
                        className={cn(
                          'transition-colors',
                          isLive
                            ? 'bg-rose-50/40 hover:bg-rose-50/70'
                            : isRecent
                            ? 'bg-amber-50/30 hover:bg-amber-50/60'
                            : 'hover:bg-slate-50/70'
                        )}
                      >
                        {/* Vehicle Details */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <div className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-md font-mono font-bold text-xs tracking-wider shadow-2xs">
                              <Car className="w-3 h-3 text-amber-600 shrink-0" />
                              <span>{v.registrationNumber || `VIN …${v.vin.slice(-6)}`}</span>
                            </div>
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded border bg-slate-100 text-slate-700 border-slate-200">
                              {v.branchLabel}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-1.5 font-medium">
                            <span
                              className="w-2 h-2 rounded-full border border-slate-300 shrink-0 shadow-2xs"
                              style={{ backgroundColor: getCarColorDot(v.color) }}
                              title={`Color: ${v.color || 'Standard'}`}
                            />
                            <span>{[v.model, v.variant, v.color].filter(Boolean).join(' · ') || '—'}</span>
                          </div>

                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            VIN: {v.vin}
                          </div>
                        </td>

                        {/* Geofence Breach & Location */}
                        <td className="px-4 py-3.5 max-w-[280px]">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 font-bold text-xs px-2 py-0.5 rounded-md border shadow-2xs',
                                isLive
                                  ? 'bg-rose-100 text-rose-800 border-rose-200'
                                  : isRecent
                                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              )}
                            >
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span>{v.distanceKm} km off-site</span>
                            </span>
                          </div>

                          <div className="text-xs text-slate-700 font-medium mt-1 truncate" title={v.address || 'Address unavailable'}>
                            {v.address || <span className="text-slate-400 italic">Address unavailable</span>}
                          </div>

                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {v.positionAt ? formatIndiaDateTime(v.positionAt) : 'Timestamp missing'}
                          </div>
                        </td>

                        {/* Live Telemetry */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {v.engineOn ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-600 text-white shadow-2xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                                ENGINE RUNNING
                              </span>
                              <div className="text-[10px] text-slate-600 font-semibold font-mono">
                                Speed: {v.speedKph ? `${v.speedKph} km/h` : 'Moving'}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                <Zap className="w-3 h-3 text-slate-400" /> Ignition OFF
                              </span>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {v.speedKph && v.speedKph > 0 ? `${v.speedKph} km/h` : 'Parked / Idle'}
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Fix Freshness */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="space-y-1">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-2xs',
                                isLive
                                  ? 'bg-teal-50 text-teal-800 border-teal-200'
                                  : isRecent
                                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              )}
                            >
                              <span
                                className={cn(
                                  'w-1.5 h-1.5 rounded-full',
                                  isLive ? 'bg-teal-600 animate-pulse' : isRecent ? 'bg-amber-500' : 'bg-slate-400'
                                )}
                              />
                              {isLive ? 'Live Fix' : isRecent ? 'Reported Today' : 'Stale Fix'}
                            </span>
                            <div className="text-[11px] font-semibold text-slate-700">
                              {agePhrase(v.ageMs)}
                            </div>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* 1-Click Issue Pass */}
                            {onIssueGatePass ? (
                              <Button
                                size="sm"
                                onClick={() => onIssueGatePass(v.vin)}
                                className="h-7.5 px-2.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-2xs cursor-pointer gap-1"
                                title="Issue an authorized Gate Pass for this vehicle now"
                              >
                                <FilePlus2 className="w-3.5 h-3.5" /> Issue Pass
                              </Button>
                            ) : null}

                            {/* View on Live GPS Map */}
                            {onTrackOnMap ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onTrackOnMap(v.vin)}
                                className="h-7.5 px-2 text-xs font-semibold text-blue-700 bg-blue-50/60 border-blue-200 hover:bg-blue-100 rounded-lg cursor-pointer gap-1"
                                title="Locate vehicle on live satellite map"
                              >
                                <Navigation className="w-3.5 h-3.5 text-blue-600" /> Map
                              </Button>
                            ) : null}

                            {/* Copy Details */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyAlertInfo(v)}
                              className="h-7.5 px-2 text-xs font-semibold rounded-lg border-slate-200 text-slate-600 cursor-pointer gap-1"
                              title="Copy alert report for WhatsApp / phone"
                            >
                              {copiedVin === v.vin ? (
                                <Check className="w-3.5 h-3.5 text-teal-700" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </Button>
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
      ) : null}
    </div>
  )
}

