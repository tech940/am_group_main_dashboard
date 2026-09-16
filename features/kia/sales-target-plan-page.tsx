'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2,
  Save,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Target,
  BarChart3,
  CalendarDays,
  Users,
  Clock,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/hooks/use-toast'
import { formatIndiaDateTime } from '@/lib/date-time'

/**
 * Sales Target Plan — the month's plan against what actually happened.
 *
 * ── The one rule this screen is built on ─────────────────────────────────────────────────────────
 * YOU RECORD A COMMITMENT FOR A DAY. WHAT WAS ACHIEVED IS READ, NEVER TYPED — it comes from the same
 * DMS report feeds the Sales Report section reads, so the two cannot disagree.
 *
 * It replaces a 36-sheet workbook in which ~95% of the cells were actuals being re-keyed by hand, and
 * in which 864 cells currently evaluate to an error — 64 of them #REF! that killed every weekly total
 * on the CURRENT month's sheet.
 *
 * So there is no Plan/Act/%Diff grid here. The workbook needed 24 of those triplets to answer "are we
 * on track"; the committed line against the achieved line answers it at a glance and cannot go stale.
 *
 * ⚠️ "BEHIND" MEANS BEHIND WHAT WAS COMMITTED FOR THE DAYS THAT HAVE HAPPENED — a number somebody
 * wrote down, not a straight-line share of a monthly figure. That is the whole reason commitments are
 * daily, and it is why Sundays need no special case: nobody commits to one.
 *
 * ── Three things this screen refuses to do ───────────────────────────────────────────────────────
 * 1. ⚠️ It never shows 0% for "no target set". A consultant nobody has given a number to is not
 *    failing, and colouring them red is how a screen teaches people to ignore its colours.
 * 2. ⚠️ It never hides the as-of time. These are the DMS feed's numbers, uploaded once a morning; a
 *    figure presented without its age invites a decision it cannot support.
 * 3. ⚠️ A day committed as ZERO is not the same as a day nobody filled in. "No retail today, the
 *    stock is not here" is a decision; silence is not. Only the first is scored.
 */

type Cell = { actual: number; target: number; committedToDate: number; achievement: number | null; gap: number | null }
type ConsultantRow = {
  consultant: string
  teamLeader: string | null
  enquiries: Cell
  testDrives: Cell
  bookings: Cell
  retails: Cell
  worstGap: number | null
  hasAnyTarget: boolean
  committedDays: number
  commitmentBasis: 'month' | 'days' | 'none'
  monthCommitted: number | null
  daysPlanned: number | null
  isTeamLeader: boolean
  employeeId: string | null
}

type Scope = 'day' | 'month'
type TeamRow = { teamLeader: string; consultants: number; enquiries: Cell; testDrives: Cell; bookings: Cell; retails: Cell }
type Day = {
  date: string; day: number; isSunday: boolean; isFuture: boolean
  enquiries: number; testDrives: number; bookings: number; retails: number
  committed: { enquiries: number; testDrives: number; bookings: number; retails: number }
  hasCommitment: boolean
}
type Payload = {
  context: {
    year: number; month: number; label: string; outlet: string; outletLabel: string
    monthDays: number; daysElapsed: number; workingDays: number; workingDaysElapsed: number
    elapsedShare: number; isCurrentMonth: boolean
  }
  totals: { enquiries: Cell; testDrives: Cell; bookings: Cell; retails: Cell }
  consultants: ConsultantRow[]
  teams: TeamRow[]
  daily: Day[]
  availableMonths: { year: number; month: number; label: string }[]
  dataAsOf: string | null
}

type MetricKey = 'enquiries' | 'testDrives' | 'bookings' | 'retails'

type MetricTheme = {
  key: MetricKey
  label: string
  icon: typeof Layers
  accentHex: string
  borderStyle: string
  badgeBg: string
  badgeText: string
  iconColor: string
}

const METRICS: MetricTheme[] = [
  {
    key: 'enquiries',
    label: 'Enquiries',
    icon: Users,
    accentHex: '#0284c7', // Sky Blue
    borderStyle: 'border-slate-200/80 hover:border-sky-300 dark:border-slate-800 dark:hover:border-sky-800',
    badgeBg: 'bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800',
    badgeText: 'text-sky-700 dark:text-sky-300',
    iconColor: '#0284c7',
  },
  {
    key: 'testDrives',
    label: 'Test Drives',
    icon: Sparkles,
    accentHex: '#7c3aed', // Purple
    borderStyle: 'border-slate-200/80 hover:border-purple-300 dark:border-slate-800 dark:hover:border-purple-800',
    badgeBg: 'bg-purple-50 dark:bg-purple-950/40 border border-purple-200/80 dark:border-purple-800',
    badgeText: 'text-purple-700 dark:text-purple-300',
    iconColor: '#7c3aed',
  },
  {
    key: 'bookings',
    label: 'Bookings',
    icon: Target,
    accentHex: '#0d9488', // Teal
    borderStyle: 'border-slate-200/80 hover:border-teal-300 dark:border-slate-800 dark:hover:border-teal-800',
    badgeBg: 'bg-teal-50 dark:bg-teal-950/40 border border-teal-200/80 dark:border-teal-800',
    badgeText: 'text-teal-700 dark:text-teal-300',
    iconColor: '#0d9488',
  },
  {
    key: 'retails',
    label: 'Retails',
    icon: TrendingUp,
    accentHex: '#047857', // Emerald
    borderStyle: 'border-slate-200/80 hover:border-emerald-300 dark:border-slate-800 dark:hover:border-emerald-800',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800',
    badgeText: 'text-slate-800 dark:text-slate-200',
    iconColor: '#047857',
  },
]

const OUTLETS = [
  { code: 'ALL', label: 'All Outlets (Both Dealers)' },
  { code: 'JK402', label: 'Jammu (JK402)' },
  { code: 'JK501', label: 'Udhampur (JK501)' },
]
type TabKey = 'month' | 'targets' | 'daily'

/*
 * ⚠️ Inline hex, not utility classes, for every state colour. app/globals.css retints emerald, amber
 * and rose with `!important`, so `text-emerald-600` does not render the colour it names here.
 */
const INK = { ahead: '#047857', behind: '#b45309', bad: '#be123c', none: '#94a3b8', teal: '#055B65' }

function ModernMonthPicker({
  value,
  onChange,
  availableMonths = [],
}: {
  value: string
  onChange: (value: string) => void
  availableMonths?: { year: number; month: number; label: string }[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const today = new Date()
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth() + 1 // 1-indexed

  // Parse active year/month from value (e.g. "2026-09" or "" for current)
  const [selectedYear, selectedMonth] = value
    ? value.split('-').map(Number)
    : [currentYear, currentMonth]

  const [viewYear, setViewYear] = useState(selectedYear || currentYear)

  useEffect(() => {
    if (selectedYear) {
      setViewYear(selectedYear)
    }
  }, [selectedYear])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const MONTHS = [
    { num: 1, short: 'Jan', full: 'January' },
    { num: 2, short: 'Feb', full: 'February' },
    { num: 3, short: 'Mar', full: 'March' },
    { num: 4, short: 'Apr', full: 'April' },
    { num: 5, short: 'May', full: 'May' },
    { num: 6, short: 'Jun', full: 'June' },
    { num: 7, short: 'Jul', full: 'July' },
    { num: 8, short: 'Aug', full: 'August' },
    { num: 9, short: 'Sep', full: 'September' },
    { num: 10, short: 'Oct', full: 'October' },
    { num: 11, short: 'Nov', full: 'November' },
    { num: 12, short: 'Dec', full: 'December' },
  ]

  const availableSet = useMemo(() => {
    return new Set(availableMonths.map((m) => `${m.year}-${m.month}`))
  }, [availableMonths])

  const activeLabel = useMemo(() => {
    if (!value) {
      const curMonthObj = MONTHS.find((m) => m.num === currentMonth)
      return `Current (${curMonthObj?.short} ${currentYear})`
    }
    const [y, m] = value.split('-').map(Number)
    const mObj = MONTHS.find((item) => item.num === m)
    return `${mObj?.full || ''} ${y}`
  }, [value, currentMonth, currentYear])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Month picker"
        className="h-10 px-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 flex items-center gap-2 cursor-pointer transition-all active:scale-98"
      >
        <CalendarDays className="h-4 w-4" style={{ color: INK.teal }} />
        <span className="font-bold">{activeLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl animate-in fade-in-0 zoom-in-95">
          {/* Year Navigation */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
              title="Previous Year"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black text-slate-900 dark:text-white font-mono">{viewYear}</span>
              {viewYear === currentYear && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  This Year
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition-colors"
              title="Next Year"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* 12 Months Grid */}
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((m) => {
              const monthKeyFormatted = `${viewYear}-${String(m.num).padStart(2, '0')}`
              const isSelected = value
                ? value === monthKeyFormatted
                : viewYear === currentYear && m.num === currentMonth
              const isCurrent = viewYear === currentYear && m.num === currentMonth
              const hasData = availableSet.has(`${viewYear}-${m.num}`)

              return (
                <button
                  key={m.num}
                  type="button"
                  onClick={() => {
                    if (isCurrent && !value) {
                      onChange('')
                    } else {
                      onChange(monthKeyFormatted)
                    }
                    setIsOpen(false)
                  }}
                  className={`relative h-10 rounded-xl text-xs font-bold transition-all cursor-pointer flex flex-col items-center justify-center ${
                    isSelected
                      ? 'bg-[var(--dashboard-action-bg,#055B65)] text-white shadow-xs font-black'
                      : isCurrent
                        ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-bold hover:bg-teal-100'
                        : hasData
                          ? 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-850'
                  }`}
                >
                  <span>{m.short}</span>
                  {isCurrent && !isSelected && (
                    <span className="absolute bottom-1 w-1 h-1 rounded-full bg-teal-600" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Quick Preset Actions */}
          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
            <button
              type="button"
              onClick={() => {
                onChange('')
                setViewYear(currentYear)
                setIsOpen(false)
              }}
              className="font-bold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Current Month
            </button>
            <button
              type="button"
              onClick={() => {
                const prevDate = new Date(currentYear, currentMonth - 2, 1)
                const pYear = prevDate.getFullYear()
                const pMonth = prevDate.getMonth() + 1
                onChange(`${pYear}-${String(pMonth).padStart(2, '0')}`)
                setViewYear(pYear)
                setIsOpen(false)
              }}
              className="font-bold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Last Month
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function paceInk(gap: number | null) {
  if (gap === null) return INK.none
  if (gap >= 0) return INK.ahead
  return gap <= -3 ? INK.bad : INK.behind
}

/** "+3" / "−2" / "—". The minus is a real minus sign, which lines up under a digit; a hyphen does not. */
function paceText(gap: number | null) {
  if (gap === null) return '—'
  const rounded = Math.round(gap * 10) / 10
  if (rounded === 0) return 'on pace'
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`
}

function MetricTile({ theme, cell }: { theme: MetricTheme; cell: Cell }) {
  const Icon = theme.icon
  const hasCommitment = cell.target > 0 || cell.committedToDate > 0 || cell.gap !== null
  const fill = cell.target > 0 ? Math.min(1, cell.actual / cell.target) : 0
  const marker = cell.target > 0 ? Math.min(1, cell.committedToDate / cell.target) : 0
  const ink = hasCommitment ? paceInk(cell.gap) : INK.none

  return (
    <div
      className={`p-5 rounded-2xl bg-white dark:bg-slate-900 border ${theme.borderStyle} shadow-xs flex flex-col justify-between transition-all hover:shadow-sm`}
    >
      <div>
        <div className="flex items-center justify-between">
          <span
            className="text-[10px] font-black uppercase tracking-wider"
            style={{ color: theme.accentHex }}
          >
            {theme.label}
          </span>
          <div
            className={`h-8 w-8 rounded-xl flex items-center justify-center ${theme.badgeBg}`}
            style={{ color: theme.iconColor }}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-black text-slate-900 dark:text-white font-mono tabular-nums tracking-tight">
            {cell.actual}
          </span>
          <span className="text-xs font-bold text-slate-400 dark:text-slate-500 tabular-nums">
            {cell.target > 0 ? `/ ${cell.target} committed` : hasCommitment ? 'committed nil' : 'no target set'}
          </span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
        {/* Dual-marker progress meter */}
        <div className="relative h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-visible">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
            style={{ width: `${fill * 100}%`, backgroundColor: theme.accentHex }}
          />
          {cell.target > 0 && (
            <div
              className="absolute -top-1 h-4 w-1 rounded-full shadow-xs transition-all duration-500"
              style={{ left: `calc(${marker * 100}% - 2px)`, backgroundColor: '#334155' }}
              title={`${cell.committedToDate} committed for elapsed days`}
            />
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] font-bold">
          <span
            className="tabular-nums"
            style={{ color: ink }}
          >
            {hasCommitment
              ? cell.gap === null || cell.gap === 0
                ? `On plan · ${cell.committedToDate} so far`
                : cell.gap > 0
                  ? `Ahead by ${Math.round(cell.gap * 10) / 10} (${cell.committedToDate} so far)`
                  : `Behind by ${Math.abs(Math.round(cell.gap * 10) / 10)} (${cell.committedToDate} so far)`
              : 'No commitment recorded'}
          </span>
          {cell.target > 0 && cell.achievement !== null && (
            <span
              className="font-mono text-[10px] font-bold text-slate-500 dark:text-slate-400"
            >
              {Math.round(cell.achievement * 100)}%
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function ActualCell({ cell, metricKey }: { cell: Cell; metricKey?: MetricKey }) {
  const theme = metricKey ? METRICS.find((m) => m.key === metricKey) : null
  const accentHex = theme?.accentHex || '#334155'

  return (
    <td className="py-2.5 px-3.5 whitespace-nowrap tabular-nums">
      <div
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border text-xs font-mono font-bold transition-all shadow-2xs"
        style={{
          backgroundColor: `${accentHex}0e`,
          borderColor: `${accentHex}30`,
        }}
      >
        <span style={{ color: accentHex }} className="font-extrabold">{cell.actual}</span>
        {cell.target > 0 && (
          <span className="text-slate-400 dark:text-slate-500 font-semibold text-[10.5px]">
            / {cell.target}
          </span>
        )}
      </div>
    </td>
  )
}

export function KiaSalesTargetPlanPage({ canSetTargets }: { canSetTargets: boolean }) {
  const [tab, setTab] = useState<TabKey>('month')
  const [outlet, setOutlet] = useState('JK402')
  const [monthKey, setMonthKey] = useState('')
  const [metric, setMetric] = useState<MetricKey>('retails')

  /*
   * ⚠️ THE COMMITMENTS FORM'S STATE LIVES HERE, not inside the tab.
   *
   * The tab unmounts the instant somebody clicks "This Month", so state held inside it was discarded
   * without warning — type a morning's commitments, glance at the plan, come back to empty boxes and
   * a database that never heard about any of it. Anything a person has typed has to outlive the
   * component showing it.
   */
  const [commitDate, setCommitDate] = useState('')
  const [commitScope, setCommitScope] = useState<Scope>('day')
  const [commitDrafts, setCommitDrafts] = useState<Record<string, Draft>>({})

  const [year, month] = monthKey ? monthKey.split('-').map(Number) : [null, null]

  const query = useQuery<Payload>({
    queryKey: ['kia-sales-target-plan', monthKey, outlet],
    queryFn: async () => {
      const params = new URLSearchParams({ outlet })
      if (year && month) { params.set('year', String(year)); params.set('month', String(month)) }
      /* no-store: the session fetch cache would hold this for 30 minutes — see query-provider.tsx. */
      const res = await fetch(`/api/brands/kia/sales-performance/plan?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load the plan')
      return res.json()
    },
    staleTime: 0,
  })

  const data = query.data
  const ctx = data?.context

  const content = (
    <div className="space-y-6 max-w-full pb-16">
      {/* ── 1. Top Executive Masthead ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border"
              style={{
                backgroundColor: `${INK.teal}10`,
                borderColor: `${INK.teal}30`,
                color: INK.teal,
              }}
            >
              <Building2 className="h-3 w-3" />
              AM KIA
            </span>
            <span className="text-slate-300 dark:text-slate-700 font-bold">/</span>
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Sales Command</span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1 flex items-center gap-2">
            Sales Target Plan
          </h1>

          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            {data?.dataAsOf
              ? `DMS feed as of ${formatIndiaDateTime(data.dataAsOf)}`
              : 'Targets are typed; everything else is read from the DMS feed.'}
          </p>
        </div>

        {/* Action Controls & Filter Selectors */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Outlet Selector */}
          <div className="relative">
            <select
              value={outlet}
              onChange={(e) => setOutlet(e.target.value)}
              className="h-10 pl-3.5 pr-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-white shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer appearance-none outline-hidden focus:ring-2 focus:ring-[var(--dashboard-action-bg,#055B65)]"
              aria-label="Outlet"
            >
              {OUTLETS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label} ({o.code})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>

          {/* Month Selector */}
          <ModernMonthPicker
            value={monthKey}
            onChange={setMonthKey}
            availableMonths={data?.availableMonths}
          />

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            className="h-10 px-3 rounded-xl border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-bold shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer active:scale-95"
            title="Refresh Feed"
          >
            <RefreshCw
              className={query.isFetching ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'}
              style={{ color: query.isFetching ? INK.teal : '#64748b' }}
            />
          </Button>
        </div>
      </div>

      {/* ── 2. Executive Pace & Status Command Banner ───────────────────────────────────────── */}
      {ctx && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
                {ctx.outletLabel}
              </span>
              <span className="text-slate-300 dark:text-slate-700 font-bold">·</span>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {ctx.label}
              </span>
              {ctx.isCurrentMonth && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Month
                </span>
              )}
            </div>

            {ctx.isCurrentMonth && (
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Elapsed: <strong className="font-bold text-slate-900 dark:text-white">{ctx.workingDaysElapsed}</strong> of{' '}
                <strong className="font-bold text-slate-900 dark:text-white">{ctx.workingDays} working days</strong>{' '}
                <span className="text-teal-700 dark:text-teal-400 font-bold">({Math.round(ctx.elapsedShare * 100)}% of month completed)</span>
              </p>
            )}
          </div>

          {data && (
            <div
              className="px-4 py-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850 flex items-center gap-3 shrink-0"
            >
              <div
                className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: `${paceInk(data.totals.retails.gap)}12`,
                  borderColor: `${paceInk(data.totals.retails.gap)}30`,
                  color: paceInk(data.totals.retails.gap),
                }}
              >
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider block text-slate-400 dark:text-slate-500">
                  Retail Pace Status
                </span>
                <p className="text-xs font-black font-mono tabular-nums text-slate-900 dark:text-white">
                  {data.totals.retails.gap !== null ? (
                    <>
                      <span>{data.totals.retails.actual} retails</span> against{' '}
                      <span className="text-slate-600 dark:text-slate-300">{data.totals.retails.committedToDate} committed so far</span> —{' '}
                      <span style={{ color: paceInk(data.totals.retails.gap) }} className="font-black">
                        {data.totals.retails.gap >= 0
                          ? `ahead by ${Math.round(data.totals.retails.gap * 10) / 10}`
                          : `behind by ${Math.abs(Math.round(data.totals.retails.gap * 10) / 10)}`}
                      </span>
                      {data.totals.retails.target > 0 && (
                        <span className="text-slate-400 dark:text-slate-500 font-normal"> · {data.totals.retails.target} total month target</span>
                      )}
                    </>
                  ) : (
                    `${data.totals.retails.actual} retails so far — nobody has recorded a commitment for this month yet.`
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 3. Funnel Executive KPI Cards ─────────────────────────────────────────────────── */}
      {data && ctx && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {METRICS.map((m) => (
            <MetricTile key={m.key} theme={m} cell={data.totals[m.key]} />
          ))}
        </div>
      )}

      {/* ── 4. Segmented Modern Tabs ──────────────────────────────────────────────────────── */}
      <div className="bg-slate-100 dark:bg-slate-900 p-1 rounded-2xl inline-flex gap-1 border border-slate-200/80 dark:border-slate-800">
        {([
          { key: 'month', label: 'This Month', icon: BarChart3 },
          { key: 'targets', label: 'Commitments Entry', icon: Target },
          { key: 'daily', label: 'Day by Day Trajectory', icon: CalendarDays },
        ] as { key: TabKey; label: string; icon: any }[]).map((t) => {
          const Icon = t.icon
          const isActive = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={isActive ? 'page' : undefined}
              className={`h-9 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                isActive
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-black border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: isActive ? INK.teal : 'currentColor' }} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Loading State */}
      {query.isLoading && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin" style={{ color: INK.teal }} />
          <p className="mt-3 text-xs font-bold text-slate-600 dark:text-slate-400">Loading sales target plan data…</p>
        </div>
      )}

      {/* Error State */}
      {query.isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 dark:bg-red-950/20 p-6 text-center">
          <AlertCircle className="mx-auto h-6 w-6" style={{ color: INK.bad }} />
          <p className="mt-2 text-xs font-bold" style={{ color: INK.bad }}>{(query.error as Error).message}</p>
        </div>
      )}

      {/* Tab Panels */}
      {data && ctx && tab === 'month' && <MonthTab data={data} />}
      {data && ctx && tab === 'targets' && (
        <CommitmentsTab
          data={data}
          canSetTargets={canSetTargets}
          onSaved={() => query.refetch()}
          date={commitDate}
          setDate={setCommitDate}
          scope={commitScope}
          setScope={setCommitScope}
          drafts={commitDrafts}
          setDrafts={setCommitDrafts}
        />
      )}
      {data && ctx && tab === 'daily' && <DailyTab data={data} metric={metric} onMetric={setMetric} />}
    </div>
  )

  return <MainLayout>{content}</MainLayout>
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

function MonthTab({ data }: { data: Payload }) {
  return (
    <div className="space-y-6">
      {/* 1. Team Breakdown */}
      {data.teams.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
            <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
              Team Performance Breakdown
            </h3>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {data.teams.length} Team{data.teams.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                <tr className="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th scope="col" className="py-3 px-4">Team Leader</th>
                  <th scope="col" className="py-3 px-4">Headcount</th>
                  {METRICS.map((m) => (
                    <th scope="col" key={m.key} className="py-3 px-3.5">
                      {m.label}
                    </th>
                  ))}
                  <th scope="col" className="py-3 px-4 text-right">Retail Pace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {data.teams.map((t) => (
                  <tr key={t.teamLeader} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60 transition-colors">
                    <td className="py-3 px-4 font-black text-slate-900 dark:text-white whitespace-nowrap">
                      {t.teamLeader}
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono font-bold">{t.consultants}</td>
                    {METRICS.map((m) => (
                      <ActualCell key={m.key} cell={t[m.key]} metricKey={m.key} />
                    ))}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black font-mono tabular-nums border shadow-2xs"
                        style={{
                          backgroundColor: `${paceInk(t.retails.gap)}12`,
                          borderColor: `${paceInk(t.retails.gap)}30`,
                          color: paceInk(t.retails.gap),
                        }}
                      >
                        {paceText(t.retails.gap)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Consultant Leaderboard */}
      <div className="overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
          <div>
            <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <Target className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
              Consultant Performance Leaderboard
            </h3>
          </div>
          <span className="text-[10.5px] text-slate-600 dark:text-slate-400 font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            Sorted by gap (priority focus first)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
              <tr className="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <th scope="col" className="py-3 px-4">Consultant</th>
                <th scope="col" className="py-3 px-4">Team Leader</th>
                {METRICS.map((m) => (
                  <th scope="col" key={m.key} className="py-3 px-3.5">
                    {m.label}
                  </th>
                ))}
                <th scope="col" className="py-3 px-4 text-right">Pace Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {data.consultants.map((row) => (
                <tr key={row.consultant} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60 transition-colors">
                  <td className="py-3 px-4 font-black text-slate-900 dark:text-white whitespace-nowrap">
                    {row.consultant}
                    {row.isTeamLeader && (
                      <span
                        className="ml-2 align-middle px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide border shadow-2xs"
                        style={{ backgroundColor: '#e0e7ff', color: '#3730a3', borderColor: '#a5b4fc' }}
                        title="Team leader — their own enquiries, test drives, bookings and retails, read from the DMS feed like anyone else"
                      >
                        Lead
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-500 font-semibold whitespace-nowrap">
                    {row.teamLeader || '—'}
                  </td>
                  {METRICS.map((m) => (
                    <ActualCell key={m.key} cell={row[m.key]} metricKey={m.key} />
                  ))}
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black font-mono tabular-nums border shadow-2xs"
                      style={{
                        backgroundColor: `${paceInk(row.worstGap)}15`,
                        borderColor: `${paceInk(row.worstGap)}40`,
                        color: paceInk(row.worstGap),
                      }}
                      title={row.hasAnyTarget ? 'Against the retail target, then bookings' : 'No target set for this consultant'}
                    >
                      {paceText(row.worstGap)}
                    </span>
                  </td>
                </tr>
              ))}
              {data.consultants.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400 font-medium">
                    No consultant activity or targets recorded for this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

type Draft = {
  enquiries: string; testDrives: string; bookings: string; retails: string; note: string
  /** A commitment exists for this person on this day (possibly all zeros). */
  present: boolean
  /** ⚠️ This exact content is what the database holds. False the moment somebody types. */
  saved: boolean
}
type TeamDraft = Record<string, string>

const EMPTY_DRAFT: Draft = { enquiries: '', testDrives: '', bookings: '', retails: '', note: '', present: false, saved: false }

/** Today in IST as 'YYYY-MM-DD'. en-CA formats as ISO, which is why it is used rather than toISOString. */
function istTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/**
 * Recording what each consultant commits to for ONE DAY.
 *
 * ⚠️ THERE IS NO "ACHIEVED" BOX ANYWHERE ON THIS FORM, and there must never be one. What happened is
 * read from the DMS feeds; the moment somebody can type it, this screen starts disagreeing with Sales
 * Report and becomes the workbook it replaced.
 *
 * ⚠️ A ROW SAVED AS ALL ZEROS IS A REAL COMMITMENT — "no retail today, the stock is not here". A row
 * never filled in is not. That is why Clear is a separate action from typing zeros: the two are
 * different statements and the screen has to be able to make both.
 */
function CommitmentsTab({
  data, canSetTargets, onSaved, date, setDate, scope, setScope, drafts, setDrafts,
}: {
  data: Payload
  canSetTargets: boolean
  onSaved: () => void
  /*
   * ⚠️ `date` AND `drafts` LIVE IN THE PAGE, NOT HERE. This component unmounts the moment somebody
   * clicks another tab, so holding half-typed commitments in its own state meant a glance at "This
   * Month" threw the morning's entry away without a word. State that a person has typed into must
   * outlive the thing displaying it.
   */
  date: string
  setDate: (value: string) => void
  scope: Scope
  setScope: (value: Scope) => void
  drafts: Record<string, Draft>
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, Draft>>>
}) {
  const monthPrefix = `${data.context.year}-${String(data.context.month).padStart(2, '0')}`
  const today = istTodayIso()
  const outlet = data.context.outlet
  const [teams, setTeams] = useState<TeamDraft>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  /*
   * Changing the month on the toolbar must move the day too, or the form edits a day that is not on
   * screen. An empty date means the page has not chosen one yet — the first render settles it.
   */
  useEffect(() => {
    if (date && date.startsWith(monthPrefix)) return
    setDate(today.startsWith(monthPrefix) ? today : `${monthPrefix}-01`)
  }, [monthPrefix, today, date, setDate])

  /*
   * ⚠️ SEEDED FROM A STABLE SIGNATURE, NOT FROM `data.consultants`.
   *
   * That array is parsed fresh out of JSON on every refetch, so its identity changes even when the
   * people are identical — and depending on it meant every refresh of the plan threw away whatever
   * was half-typed in this form. Only a change in the actual roster should reseed it.
   */
  const rosterKey = useMemo(
    () => data.consultants.map((r) => `${r.consultant}:${r.teamLeader ?? ''}`).join('|'),
    [data.consultants],
  )

  useEffect(() => {
    const next: TeamDraft = {}
    for (const row of data.consultants) next[row.consultant] = row.teamLeader || ''
    setTeams(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey])

  /*
   * What is already committed for the chosen day.
   *
   * ⚠️ DEPENDS ON THE DAY AND THE OUTLET ONLY. Re-reading on anything else wipes the form under the
   * person typing into it — which is exactly how a morning's commitments were entered and then
   * silently lost.
   */
  useEffect(() => {
    if (!date) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ outlet, date, scope })
        const res = await fetch(`/api/brands/kia/sales-performance/targets?${params}`, { cache: 'no-store' })
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        const next: Record<string, Draft> = {}
        for (const e of (body.entries || [])) {
          next[String(e.consultantName).trim()] = {
            enquiries: String(e.enquiries ?? ''),
            testDrives: String(e.testDrives ?? ''),
            bookings: String(e.bookings ?? ''),
            retails: String(e.retails ?? ''),
            note: e.note || '',
            present: true,
            saved: true,
          }
        }
        /* Keyed by the stored name; rendering falls back to EMPTY_DRAFT for anyone absent, so the
         * roster can change without this having to know about it. */
        setDrafts(next)
      } catch {
        if (!cancelled) setDrafts({})
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [date, outlet, scope])

  const DEFAULT_TEAM_LEADERS = [
    'MICHAEL DEEP SINGH',
    'NAVAL PREET SINGH',
    'SHUBHAM',
    'AKASH BHAT',
    'ARSHAD KHAN',
  ]

  const knownLeaders = useMemo(() => {
    const set = new Set<string>(DEFAULT_TEAM_LEADERS)
    for (const v of Object.values(teams)) if (v.trim()) set.add(v.trim())
    return [...set].sort()
  }, [teams])

  const set = (name: string, field: keyof Draft, value: string) =>
    setDrafts((prev) => ({
      ...prev,
      [name]: { ...(prev[name] || EMPTY_DRAFT), [field]: value, present: true, saved: false },
    }))

  /* Rows the person actually touched. An untouched row must NOT be written as a row of zeros. */
  const touched = (d: Draft) =>
    d.present && (d.enquiries !== '' || d.testDrives !== '' || d.bookings !== '' || d.retails !== '' || d.note.trim() !== '')

  const committedCount = Object.values(drafts).filter(touched).length
  /* Rows the person has typed into that are not yet in the database. */
  const unsavedCount = data.consultants.filter((row) => {
    const d = drafts[row.consultant]
    return d && touched(d) && !d.saved
  }).length

  async function save() {
    const pending = data.consultants.filter((row) => touched(drafts[row.consultant] || EMPTY_DRAFT))
    /*
     * ⚠️ AN EMPTY SAVE IS NOT A SUCCESS. It used to POST zero entries, write nothing, and toast
     * "0 consultants saved" in the same green as a real save — so a day that never reached the
     * database looked exactly like one that did.
     */
    if (pending.length === 0) {
      toast({
        title: 'Nothing to save yet',
        description: 'Type a number against at least one consultant first. An empty box means nobody has committed.',
        variant: 'error',
      })
      return
    }

    setSaving(true)
    try {
      const entries = pending
        .map((row) => {
          const d = drafts[row.consultant]
          return {
            consultantName: row.consultant,
            enquiries: Number(d.enquiries) || 0,
            testDrives: Number(d.testDrives) || 0,
            bookings: Number(d.bookings) || 0,
            retails: Number(d.retails) || 0,
            note: d.note.trim() || null,
          }
        })

      const res = await fetch('/api/brands/kia/sales-performance/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outlet,
          date,
          scope,
          entries,
          year: data.context.year,
          month: data.context.month,
          teams: data.consultants.map((row) => ({
            consultantName: row.consultant,
            teamLeader: (teams[row.consultant] || '').trim() || null,
          })),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save the commitments')
      toast({
        title: scope === 'month' ? 'Month commitments saved' : 'Day commitments saved',
        description: `${body.saved ?? entries.length} consultant${(body.saved ?? entries.length) === 1 ? '' : 's'} for ${
          scope === 'month' ? data.context.label : date
        }.`,
        variant: 'success',
      })
      setDrafts((prev) => {
        const next = { ...prev }
        for (const e of entries) {
          const d = next[e.consultantName]
          if (d) next[e.consultantName] = { ...d, saved: true }
        }
        return next
      })
      onSaved()
    } catch (error) {
      toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function clearOne(consultant: string) {
    try {
      const params = new URLSearchParams({ outlet, date, consultant, scope })
      const res = await fetch(`/api/brands/kia/sales-performance/targets?${params}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not clear it')
      setDrafts((prev) => ({ ...prev, [consultant]: { ...EMPTY_DRAFT } }))
      toast({
        title: 'Commitment cleared',
        description: `${consultant} has no ${scope === 'month' ? 'month' : 'day'} commitment recorded for ${
          scope === 'month' ? data.context.label : date
        }.`,
        variant: 'success',
      })
      onSaved()
    } catch (error) {
      toast({ title: 'Could not clear', description: error instanceof Error ? error.message : 'Unknown error', variant: 'error' })
    }
  }

  if (!canSetTargets) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-900 p-6 text-center">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
          Commitments are recorded by the General Manager, Sales Manager, Sales Head or MD. You can view
          the plan and the day-by-day on the other two tabs.
        </p>
      </div>
    )
  }

  const dayName = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })
  const isSunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0

  return (
    <div className="overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-[0_4px_20px_rgba(15,23,42,0.02)] space-y-0">
      {/* Matrix Controls Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-950/40">
        <div>
          <h3 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
            Commitments Matrix — {data.context.outletLabel}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {scope === 'month'
              ? `What each consultant signs up to for the whole of ${data.context.label}.`
              : 'What each consultant commits to for this one day.'}{' '}
            Achievement is read from the DMS feed and is never typed here.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Scope Toggle */}
          <div role="group" aria-label="Commitment scope" className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 shadow-2xs">
            {([
              { key: 'day', label: 'For a day' },
              { key: 'month', label: 'For the month' },
            ] as { key: Scope; label: string }[]).map((option) => {
              const isSelected = scope === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setScope(option.key)}
                  aria-pressed={isSelected}
                  className={`h-8 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--dashboard-action-bg,#055B65)] text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          {scope === 'day' ? (
            <Input
              type="date"
              value={date}
              min={`${monthPrefix}-01`}
              max={`${monthPrefix}-${String(data.context.monthDays).padStart(2, '0')}`}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-36 text-xs font-bold rounded-xl border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              aria-label="Commitment date"
            />
          ) : (
            <span className="h-9 px-3 inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-300">
              {data.context.label}
            </span>
          )}

          <Button
            onClick={save}
            disabled={saving || loading}
            style={{ backgroundColor: INK.teal, color: '#ffffff' }}
            className="h-9 px-4 rounded-xl text-xs font-bold border-none cursor-pointer hover:opacity-90 shadow-2xs active:scale-95 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
            {scope === 'month' ? 'Save Month Targets' : 'Save Day Commitments'}
          </Button>
        </div>
      </div>

      {/* Info & Status Strip */}
      <div className="px-5 py-2.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] bg-white dark:bg-slate-900">
        {scope === 'day' && <span className="font-bold text-slate-700 dark:text-slate-300">{dayName}</span>}
        {scope === 'day' && isSunday && (
          <span className="font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${INK.behind}15`, color: INK.behind }}>
            Sunday — showroom normally closed
          </span>
        )}
        {scope === 'month' && (
          <span className="font-bold" style={{ color: INK.teal }}>
            A month commitment overrides the day-by-day sum when both exist
          </span>
        )}
        <span className="text-slate-500 font-medium">
          {loading
            ? 'Reading commitments…'
            : `${committedCount} of ${data.consultants.length} committed for this ${scope === 'month' ? 'month' : 'day'}`}
        </span>
        {unsavedCount > 0 && (
          <span className="font-black px-2 py-0.5 rounded-md border" style={{ backgroundColor: `${INK.behind}15`, borderColor: `${INK.behind}30`, color: INK.behind }}>
            {unsavedCount} row{unsavedCount === 1 ? '' : 's'} not saved yet
          </span>
        )}
        <span className="ml-auto text-slate-400 font-medium">
          Empty = nobody has committed. A saved 0 = committed to none.
        </span>
      </div>

      <datalist id="kia-team-leaders">
        {knownLeaders.map((l) => <option key={l} value={l} />)}
      </datalist>

      {/* Table Data Entry Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
            <tr className="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
              <th scope="col" className="py-3 px-4">Consultant</th>
              <th scope="col" className="py-3 px-3.5">Team Leader</th>
              {METRICS.map((m) => (
                <th scope="col" key={m.key} className="py-3 px-2.5 text-center">
                  {m.label}
                </th>
              ))}
              <th scope="col" className="py-3 px-3.5">Note</th>
              <th scope="col" className="py-3 px-4 text-right">Clear</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {data.consultants.map((row) => {
              const d = drafts[row.consultant] || EMPTY_DRAFT
              return (
                <tr key={row.consultant} className="hover:bg-slate-50/70 dark:hover:bg-slate-850/50 transition-colors">
                  <td className="py-2.5 px-4 font-black text-slate-900 dark:text-white whitespace-nowrap">
                    {row.consultant}
                    {row.isTeamLeader && (
                      <span
                        className="ml-1.5 align-middle px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide border shadow-2xs"
                        style={{ backgroundColor: '#e0e7ff', color: '#3730a3', borderColor: '#a5b4fc' }}
                      >
                        Lead
                      </span>
                    )}
                    <span className="block text-[10px] font-medium text-slate-400">
                      {row.commitmentBasis === 'month'
                        ? `Month commitment set · ${row.committedDays} day${row.committedDays === 1 ? '' : 's'} planned`
                        : `${row.committedDays} day${row.committedDays === 1 ? '' : 's'} committed this month`}
                    </span>
                  </td>
                  <td className="py-2.5 px-3.5">
                    <Input
                      list="kia-team-leaders"
                      value={teams[row.consultant] ?? ''}
                      onChange={(e) => setTeams((prev) => ({ ...prev, [row.consultant]: e.target.value }))}
                      placeholder="Unassigned"
                      className="h-8 w-32 text-xs font-semibold rounded-lg border-slate-200 dark:border-slate-800"
                      aria-label={`Team leader for ${row.consultant}`}
                    />
                  </td>
                  {METRICS.map((m) => {
                    const hasVal = d[m.key as keyof Draft] !== '' && d[m.key as keyof Draft] !== undefined
                    return (
                      <td key={m.key} className="py-2.5 px-2.5 text-center">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={d[m.key as keyof Draft] as string}
                          onChange={(e) => set(row.consultant, m.key as keyof Draft, e.target.value)}
                          placeholder="—"
                          style={{
                            borderColor: hasVal ? `${m.accentHex}45` : undefined,
                            backgroundColor: hasVal ? `${m.accentHex}0a` : undefined,
                            color: hasVal ? m.accentHex : undefined,
                          }}
                          className="h-8 w-16 mx-auto text-xs font-mono font-black rounded-lg tabular-nums border-slate-200 dark:border-slate-800 text-center transition-all"
                          aria-label={`${m.label} committed by ${row.consultant} for ${scope === 'month' ? data.context.label : date}`}
                        />
                      </td>
                    )
                  })}
                  <td className="py-2.5 px-3.5">
                    <Input
                      value={d.note}
                      onChange={(e) => set(row.consultant, 'note', e.target.value)}
                      placeholder="half day, stock held…"
                      className="h-8 w-44 text-xs font-medium rounded-lg border-slate-200 dark:border-slate-800"
                      aria-label={`Note for ${row.consultant} on ${date}`}
                    />
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => clearOne(row.consultant)}
                      disabled={!d.present}
                      className="h-7 px-2.5 rounded-lg text-[10px] font-extrabold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-30 disabled:cursor-default transition-all"
                      title={d.present
                        ? 'Remove this commitment entirely — different from committing to zero'
                        : 'Nothing is committed for this day'}
                    >
                      Clear
                    </button>
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

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

function DailyTab({ data, metric, onMetric }: { data: Payload; metric: MetricKey; onMetric: (m: MetricKey) => void }) {
  const target = data.totals[metric].target
  const days = data.daily
  const activeTheme = METRICS.find((m) => m.key === metric) || METRICS[3]

  const { cumulative, cumulativeCommitted, peak } = useMemo(() => {
    let running = 0
    let promised = 0
    const cum: number[] = []
    const promisedCum: number[] = []
    let max = 0
    for (const d of days) {
      if (!d.isFuture) running += d[metric]
      /* ⚠️ The committed line runs across the WHOLE month, including days still to come — that is the
       * plan, and seeing where it ends is the point. The achieved line stops at today. */
      promised += d.committed[metric]
      cum.push(running)
      promisedCum.push(promised)
      if (d[metric] > max) max = d[metric]
      if (d.committed[metric] > max) max = d.committed[metric]
    }
    return { cumulative: cum, cumulativeCommitted: promisedCum, peak: Math.max(max, 1) }
  }, [days, metric])

  const W = 720
  const H = 220
  const PAD = { l: 38, r: 30, t: 16, b: 30 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const colW = innerW / days.length
  const ceiling = Math.max(
    target,
    cumulative[cumulative.length - 1] || 0,
    cumulativeCommitted[cumulativeCommitted.length - 1] || 0,
    1,
  )
  const anyCommitted = days.some((d) => d.hasCommitment)

  // Calculate polygon points for area fill under running total line
  const activePoints = days
    .map((d, i) => {
      if (d.isFuture) return null
      const x = PAD.l + i * colW + colW / 2
      const y = PAD.t + innerH - (cumulative[i] / ceiling) * innerH
      return { x, y }
    })
    .filter((pt): pt is { x: number; y: number } => pt !== null)

  const areaPolygonPoints =
    activePoints.length > 0
      ? `${activePoints[0].x},${PAD.t + innerH} ${activePoints.map((p) => `${p.x},${p.y}`).join(' ')} ${activePoints[activePoints.length - 1].x},${PAD.t + innerH}`
      : ''

  return (
    <div className="space-y-4">
      {/* Metric Switcher Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {METRICS.map((m) => {
          const isSelected = metric === m.key
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onMetric(m.key)}
              style={
                isSelected
                  ? { backgroundColor: m.accentHex, borderColor: m.accentHex, color: '#ffffff' }
                  : undefined
              }
              className={`h-9 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-2xs active:scale-95 flex items-center gap-2 ${
                isSelected
                  ? 'shadow-xs font-black'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <m.icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          )
        })}
      </div>

      {/* Trajectory Visualizer */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-[0_4px_20px_rgba(15,23,42,0.03)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <CalendarDays className="h-4 w-4" style={{ color: activeTheme.accentHex }} />
              {activeTheme.label} — Trajectory & Daily Volume
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {anyCommitted
                ? `${target} committed across the month. The dashed line is the commitments added up day by day — where the running total was promised to be.`
                : 'Nothing committed for this metric yet, so only what actually happened is drawn.'}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto mt-4">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ minWidth: 540 }}
            role="img"
            aria-label={`${metric} per day for ${data.context.label}`}
          >
            <defs>
              <linearGradient id="actualAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={activeTheme.accentHex} stopOpacity="0.25" />
                <stop offset="100%" stopColor={activeTheme.accentHex} stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {/* Gridlines */}
            <line x1={PAD.l} y1={PAD.t} x2={W - PAD.r} y2={PAD.t} stroke="#e2e8f0" strokeDasharray="3 3" opacity={0.7} />
            <line x1={PAD.l} y1={PAD.t + innerH / 2} x2={W - PAD.r} y2={PAD.t + innerH / 2} stroke="#e2e8f0" strokeDasharray="3 3" opacity={0.7} />

            {/* Sundays Axis Strip */}
            {days.map((d, i) => d.isSunday && (
              <rect
                key={`s${d.day}`}
                x={PAD.l + i * colW}
                y={PAD.t + innerH}
                width={colW}
                height={5}
                fill="#cbd5e1"
                rx={1}
              >
                <title>{`${d.date}: Sunday — closed`}</title>
              </rect>
            ))}

            {/* Daily Volume Bars */}
            {days.map((d, i) => {
              const h = (d[metric] / peak) * (innerH * 0.55)
              return (
                <rect
                  key={`b${d.day}`}
                  x={PAD.l + i * colW + colW * 0.15}
                  y={PAD.t + innerH - h}
                  width={Math.max(2, colW * 0.7)}
                  height={h}
                  fill={d.isFuture ? '#e2e8f0' : `${activeTheme.accentHex}40`}
                  stroke={d.isFuture ? 'none' : `${activeTheme.accentHex}80`}
                  strokeWidth="0.5"
                  rx={2}
                >
                  <title>{`${d.date}: ${d[metric]}`}</title>
                </rect>
              )
            })}

            {/* Area Fill Under Running Total Line */}
            {areaPolygonPoints && (
              <polygon points={areaPolygonPoints} fill="url(#actualAreaGrad)" />
            )}

            {/* Dashed Cumulative Commitment Line */}
            {anyCommitted && (
              <polyline
                fill="none"
                stroke="#475569"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                points={days.map((d, i) => {
                  const y = PAD.t + innerH - (cumulativeCommitted[i] / ceiling) * innerH
                  return `${PAD.l + i * colW + colW / 2},${y}`
                }).join(' ')}
              />
            )}

            {/* Solid Running Cumulative Actuals Line */}
            <polyline
              fill="none"
              stroke={activeTheme.accentHex}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={days.map((d, i) => {
                if (d.isFuture) return null
                const y = PAD.t + innerH - (cumulative[i] / ceiling) * innerH
                return `${PAD.l + i * colW + colW / 2},${y}`
              }).filter(Boolean).join(' ')}
            />

            {/* Axes */}
            <line x1={PAD.l} y1={PAD.t + innerH} x2={W - PAD.r} y2={PAD.t + innerH} stroke="#cbd5e1" strokeWidth="1" />
            <text x={4} y={PAD.t + 8} fontSize="9" fontWeight="bold" fill={activeTheme.accentHex}>{ceiling}</text>
            <text x={4} y={PAD.t + innerH} fontSize="9" fontWeight="bold" fill={activeTheme.accentHex}>0</text>
            <text x={W - PAD.r + 4} y={PAD.t + innerH - innerH * 0.55 + 3} fontSize="9" fontWeight="bold" fill="#94a3b8" textAnchor="start">{peak}</text>
            <text x={W - PAD.r + 4} y={PAD.t + innerH} fontSize="9" fontWeight="bold" fill="#94a3b8" textAnchor="start">0</text>
            {days.map((d, i) => (d.day === 1 || d.day % 5 === 0) && (
              <text
                key={`t${d.day}`}
                x={PAD.l + i * colW + colW / 2}
                y={H - 8}
                fontSize="9"
                fontWeight="bold"
                fill="#94a3b8"
                textAnchor="middle"
              >
                {d.day}
              </text>
            ))}
          </svg>
        </div>

        {/* Legend Strip */}
        <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
            <span className="inline-block w-4 h-1 rounded-full" style={{ backgroundColor: activeTheme.accentHex }} /> Running total
          </span>
          <span className="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
            <span className="inline-block w-4 h-0.5" style={{ background: 'repeating-linear-gradient(90deg,#475569 0 4px,transparent 4px 7px)' }} /> Committed, added up
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="inline-block w-3 h-3 rounded-xs" style={{ backgroundColor: `${activeTheme.accentHex}40`, border: `1px solid ${activeTheme.accentHex}80` }} /> That day alone
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="inline-block w-4 h-1 rounded-sm" style={{ backgroundColor: '#cbd5e1' }} /> Sunday — closed
          </span>
          <span className="ml-auto text-slate-400 font-semibold">
            Left scale: running total · right scale: that day alone
          </span>
        </div>
      </div>
    </div>
  )
}
