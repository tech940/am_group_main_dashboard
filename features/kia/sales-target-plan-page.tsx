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

type PlanModelItem = {
  model: string
  target: number
  bookings: number
  retails: number
  achievement: number | null
  gap: number | null
}

type PlanWeek = {
  weekNumber: number
  scope: 'week_1' | 'week_2' | 'week_3' | 'week_4'
  label: string
  dateRange: string
  startDate: string
  endDate: string
  startDay: number
  endDay: number
  daysCount: number
  workingDays: number
  workingDaysElapsed: number
  isCurrent: boolean
  isPast: boolean
  isFuture: boolean
  enquiries: Cell
  testDrives: Cell
  bookings: Cell
  retails: Cell
}

type ConsultantRow = {
  consultant: string
  teamLeader: string | null
  enquiries: Cell
  testDrives: Cell
  bookings: Cell
  retails: Cell
  weeks?: PlanWeek[]
  models?: PlanModelItem[]
  modelTargets?: Record<string, number>
  worstGap: number | null
  hasAnyTarget: boolean
  committedDays: number
  commitmentBasis: 'month' | 'weeks' | 'days' | 'none'
  monthCommitted: number | null
  daysPlanned: number | null
  isTeamLeader: boolean
  employeeId: string | null
}

type TeamRow = {
  teamLeader: string
  consultants: number
  enquiries: Cell
  testDrives: Cell
  bookings: Cell
  retails: Cell
  models?: PlanModelItem[]
}

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
  weeks: PlanWeek[]
  models: PlanModelItem[]
  allModels: string[]
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

        {cell.target > 0 && (
          <div className="pt-1 text-[10px] flex items-center justify-between font-medium">
            <span className="text-slate-500 dark:text-slate-400">Target status:</span>
            {cell.actual >= cell.target ? (
              <span className="font-bold text-emerald-600 dark:text-emerald-400">Target Achieved! ✓</span>
            ) : (
              <span className="font-bold text-amber-700 dark:text-amber-400">
                Need {cell.target - cell.actual} more to hit target
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PlanMetricCell({ cell, metricKey }: { cell: Cell; metricKey?: MetricKey }) {
  const hasTgt = cell.target > 0
  const need = hasTgt ? Math.max(0, cell.target - cell.actual) : 0
  const isMet = hasTgt && cell.actual >= cell.target
  const gap = cell.gap

  return (
    <td className="py-2.5 px-3 text-center whitespace-nowrap">
      <div className="font-mono font-black text-xs text-slate-900 dark:text-white flex items-center justify-center gap-1">
        <span>{cell.actual}</span>
        <span className="text-[10px] text-slate-400 font-semibold">
          / {hasTgt ? cell.target : '—'}
        </span>
      </div>

      <div className="mt-1 flex flex-col items-center gap-0.5">
        {gap !== null ? (
          <span
            className="text-[9.5px] font-extrabold tabular-nums"
            style={{ color: paceInk(gap) }}
          >
            {paceText(gap)}
          </span>
        ) : (
          <span className="text-[9.5px] text-slate-400 font-medium">—</span>
        )}

        {hasTgt && (
          <span
            className={`text-[8.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded border shadow-2xs ${
              isMet
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
            }`}
          >
            {isMet ? 'Met ✓' : `Need ${need}`}
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
   */
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
          { key: 'month', label: 'This Month & Milestones', icon: BarChart3 },
          { key: 'targets', label: 'Monthly Commitments & Models', icon: Target },
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
  const [consultantView, setConsultantView] = useState<'weeks' | 'models' | 'funnel'>('weeks')

  return (
    <div className="space-y-6">
      {/* ── 1. Dealership Model Performance Strip ── */}
      {data.models && data.models.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <Layers className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
              Dealership Model-Wise Performance
            </h3>
            <span className="text-[11px] font-bold text-slate-500">
              {data.models.length} Models Tracked
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6 gap-3">
            {data.models.map((m) => {
              const hasTgt = m.target > 0
              const pct = hasTgt ? Math.min(100, Math.round((m.retails / m.target) * 100)) : 0
              const need = hasTgt ? Math.max(0, m.target - m.retails) : 0
              return (
                <div
                  key={m.model}
                  className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-xs font-black text-slate-900 dark:text-white truncate">
                        {m.model}
                      </span>
                      {hasTgt && (
                        <span className="text-[10px] font-mono font-bold text-slate-400">
                          {pct}%
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-black font-mono text-slate-900 dark:text-white tabular-nums">
                        {m.retails}
                      </span>
                      <span className="text-xs text-slate-400 font-bold tabular-nums">
                        / {hasTgt ? m.target : '—'} retails
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                    <div className="relative h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-emerald-600 rounded-full transition-all duration-500"
                        style={{ width: `${hasTgt ? pct : m.retails > 0 ? 100 : 0}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-bold">
                      <span className="text-teal-700 dark:text-teal-400">
                        {m.bookings} bkg
                      </span>
                      <span style={{ color: paceInk(m.gap) }}>
                        {paceText(m.gap)}
                      </span>
                    </div>
                    {hasTgt && (
                      <div className="text-[9.5px] font-bold flex items-center justify-between pt-0.5 border-t border-slate-100/60 dark:border-slate-800/60">
                        <span className="text-slate-400 font-normal">Remaining:</span>
                        {m.retails >= m.target ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">Met ✓</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 font-extrabold">Need {need}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 2. Weekly Performance Milestone Breakdown (Weeks 1 to 4) ── */}
      {data.weeks && data.weeks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
              Weekly Target vs. Actuals Milestone Breakdown (4 Weeks)
            </h3>
            <span className="text-[11px] font-bold text-slate-500">
              Monthly targets divided across W1–W4
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {data.weeks.map((w) => {
              const statusBg = w.isCurrent
                ? 'bg-teal-50 border-teal-200 text-teal-800 dark:bg-teal-950/40 dark:border-teal-800 dark:text-teal-300'
                : w.isPast
                  ? 'bg-slate-100 border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                  : 'bg-slate-50 border-slate-200/60 text-slate-500 dark:bg-slate-900/50 dark:border-slate-800 dark:text-slate-500'
              const statusLabel = w.isCurrent ? 'In Progress' : w.isPast ? 'Completed' : 'Upcoming'

              const retailTgt = w.retails.target
              const retailAct = w.retails.actual
              const retailPct = retailTgt > 0 ? Math.min(100, Math.round((retailAct / retailTgt) * 100)) : 0
              const retailGap = w.retails.gap
              const retailNeed = retailTgt > 0 ? Math.max(0, retailTgt - retailAct) : 0

              return (
                <div
                  key={w.scope}
                  className={`p-4 rounded-2xl bg-white dark:bg-slate-900 border transition-all ${
                    w.isCurrent
                      ? 'border-teal-400 dark:border-teal-600 shadow-md ring-1 ring-teal-400/30'
                      : 'border-slate-200/80 dark:border-slate-800 shadow-xs'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        Week {w.weekNumber}
                      </span>
                      <span className="block text-[10px] font-bold text-slate-400">
                        Day {w.startDay}–{w.endDay}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${statusBg}`}>
                      {statusLabel}
                    </span>
                  </div>

                  {/* Primary Retail Highlight */}
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850/60 border border-slate-100 dark:border-slate-800 mb-2.5">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-emerald-600" />
                        Retails
                      </span>
                      <span className="font-black font-mono tabular-nums text-slate-900 dark:text-white">
                        {retailAct} <span className="text-slate-400 font-bold">/ {retailTgt > 0 ? retailTgt : '—'}</span>
                      </span>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden mb-1">
                      <div
                        className="absolute inset-y-0 left-0 bg-emerald-600 rounded-full transition-all duration-500"
                        style={{ width: `${retailPct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-bold">
                      <span style={{ color: paceInk(retailGap) }}>
                        {paceText(retailGap)}
                      </span>
                      {retailTgt > 0 && (
                        <span className={retailAct >= retailTgt ? 'text-emerald-600 font-black' : 'text-amber-600 font-bold'}>
                          {retailAct >= retailTgt ? 'Week Met ✓' : `Need ${retailNeed}`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Mini Secondary Metrics Grid */}
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <div className="p-1.5 rounded-lg bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/30">
                      <span className="block text-[8.5px] font-black uppercase text-sky-700 dark:text-sky-300">Enq</span>
                      <span className="text-[11px] font-black font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                        {w.enquiries.actual}
                        <span className="text-[9px] text-slate-400 font-normal">/{w.enquiries.target || '—'}</span>
                      </span>
                      {w.enquiries.target > 0 && (
                        <span className="block text-[8px] font-bold text-slate-500 mt-0.5">
                          {w.enquiries.actual >= w.enquiries.target ? 'Met ✓' : `Need ${w.enquiries.target - w.enquiries.actual}`}
                        </span>
                      )}
                    </div>
                    <div className="p-1.5 rounded-lg bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30">
                      <span className="block text-[8.5px] font-black uppercase text-purple-700 dark:text-purple-300">TD</span>
                      <span className="text-[11px] font-black font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                        {w.testDrives.actual}
                        <span className="text-[9px] text-slate-400 font-normal">/{w.testDrives.target || '—'}</span>
                      </span>
                      {w.testDrives.target > 0 && (
                        <span className="block text-[8px] font-bold text-slate-500 mt-0.5">
                          {w.testDrives.actual >= w.testDrives.target ? 'Met ✓' : `Need ${w.testDrives.target - w.testDrives.actual}`}
                        </span>
                      )}
                    </div>
                    <div className="p-1.5 rounded-lg bg-teal-50/50 dark:bg-teal-950/20 border border-teal-100 dark:border-teal-900/30">
                      <span className="block text-[8.5px] font-black uppercase text-teal-700 dark:text-teal-300">Bkg</span>
                      <span className="text-[11px] font-black font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                        {w.bookings.actual}
                        <span className="text-[9px] text-slate-400 font-normal">/{w.bookings.target || '—'}</span>
                      </span>
                      {w.bookings.target > 0 && (
                        <span className="block text-[8px] font-bold text-slate-500 mt-0.5">
                          {w.bookings.actual >= w.bookings.target ? 'Met ✓' : `Need ${w.bookings.target - w.bookings.actual}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[9.5px] text-slate-400 font-semibold">
                    <span>{w.workingDays} work days</span>
                    <span>{w.workingDaysElapsed} elapsed</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 3. Team Breakdown ── */}
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
            <table className="w-full text-left text-xs kia-plan-table">
              <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                <tr className="text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                  <th scope="col" className="py-3 px-4">Team Leader</th>
                  <th scope="col" className="py-3 px-4">Headcount</th>
                  {METRICS.map((m) => (
                    <th scope="col" key={m.key} className="py-3 px-3 text-center">
                      <span className="block font-black" style={{ color: m.accentHex }}>{m.label}</span>
                      <span className="block text-[9px] text-slate-400 font-normal">Act / Tgt · Gap</span>
                    </th>
                  ))}
                  <th scope="col" className="py-3 px-4 text-right">Retail Pace & Deficit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {data.teams.map((t) => {
                  const hasRetTgt = t.retails.target > 0
                  const retNeed = hasRetTgt ? Math.max(0, t.retails.target - t.retails.actual) : 0
                  return (
                    <tr key={t.teamLeader} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60 transition-colors">
                      <td className="py-3 px-4 font-black text-slate-900 dark:text-white whitespace-nowrap">
                        {t.teamLeader}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono font-bold">{t.consultants}</td>
                      {METRICS.map((m) => (
                        <PlanMetricCell key={m.key} cell={t[m.key]} metricKey={m.key} />
                      ))}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1">
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
                          {hasRetTgt && (
                            <span className="text-[9.5px] font-bold text-slate-500">
                              {t.retails.actual >= t.retails.target
                                ? 'Team Goal Met ✓'
                                : `Need ${retNeed} more`}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 4. Consultant Leaderboard Table with 3 Switchable Views ── */}
      <div className="overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900">
          <div>
            <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <Target className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
              Consultant Performance Leaderboard
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {/* View Switcher: Weekly Breakdown vs Model Wise Targets vs Full Funnel */}
            <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setConsultantView('weeks')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  consultantView === 'weeks'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-black'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Weekly Breakdown (W1–W4)
              </button>
              <button
                type="button"
                onClick={() => setConsultantView('models')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  consultantView === 'models'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-black'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Model-Wise Targets
              </button>
              <button
                type="button"
                onClick={() => setConsultantView('funnel')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  consultantView === 'funnel'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-black'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Full Funnel
              </button>
            </div>
            <span className="text-[10.5px] text-slate-600 dark:text-slate-400 font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hidden md:inline-block">
              Sorted by gap
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          {/* VIEW 1: WEEKLY BREAKDOWN (W1 to W4) */}
          {consultantView === 'weeks' && (
            <table className="w-full text-left text-xs kia-plan-table">
              <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                <tr className="text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                  <th scope="col" className="py-3 px-4">Consultant</th>
                  <th scope="col" className="py-3 px-4">Team Leader</th>
                  {data.weeks.map((w) => (
                    <th scope="col" key={w.scope} className="py-3 px-3 text-center">
                      <span className="block font-black text-slate-800 dark:text-slate-200">W{w.weekNumber} Retail</span>
                      <span className="block text-[9px] text-slate-400 font-normal">Day {w.startDay}–{w.endDay}</span>
                    </th>
                  ))}
                  <th scope="col" className="py-3 px-3.5 text-center font-black">
                    <span className="block text-slate-800 dark:text-slate-200">Month Retail</span>
                    <span className="block text-[9px] text-slate-400 font-normal">Act / Target</span>
                  </th>
                  <th scope="col" className="py-3 px-4 text-right">Retail Gap & Deficit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {data.consultants.map((row) => {
                  const hasRetTgt = row.retails.target > 0
                  const retNeed = hasRetTgt ? Math.max(0, row.retails.target - row.retails.actual) : 0
                  const isRetMet = hasRetTgt && row.retails.actual >= row.retails.target

                  return (
                    <tr key={row.consultant} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60 transition-colors">
                      <td className="py-3 px-4 font-black text-slate-900 dark:text-white whitespace-nowrap">
                        {row.consultant}
                        {row.isTeamLeader && (
                          <span
                            className="ml-2 align-middle px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide border shadow-2xs"
                            style={{ backgroundColor: '#e0e7ff', color: '#3730a3', borderColor: '#a5b4fc' }}
                          >
                            Lead
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-semibold whitespace-nowrap">
                        {row.teamLeader || '—'}
                      </td>
                      {(row.weeks || []).map((cw) => {
                        const tgt = cw.retails.target
                        const act = cw.retails.actual
                        const gap = cw.retails.gap
                        const hasTgt = tgt > 0
                        const need = hasTgt ? Math.max(0, tgt - act) : 0
                        const isMet = hasTgt && act >= tgt

                        return (
                          <td key={cw.scope} className="py-3 px-3 text-center whitespace-nowrap">
                            <div className="font-mono font-black text-xs text-slate-900 dark:text-white">
                              {act}{' '}
                              <span className="text-[10px] text-slate-400 font-semibold">
                                / {hasTgt ? tgt : '—'}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-col items-center gap-0.5">
                              {gap !== null && (
                                <span
                                  className="inline-block text-[9.5px] font-bold tabular-nums"
                                  style={{ color: paceInk(gap) }}
                                >
                                  {paceText(gap)}
                                </span>
                              )}
                              {hasTgt && (
                                <span
                                  className={`text-[8.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded border shadow-2xs ${
                                    isMet
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                      : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                  }`}
                                >
                                  {isMet ? 'Met ✓' : `Need ${need}`}
                                </span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                      <td className="py-3 px-3.5 text-center whitespace-nowrap font-mono">
                        <div className="font-black text-xs text-slate-900 dark:text-white">
                          {row.retails.actual}
                          <span className="text-[10px] text-slate-400 font-semibold"> / {row.retails.target > 0 ? row.retails.target : '—'}</span>
                        </div>
                        {hasRetTgt && (
                          <div className="mt-1">
                            <span
                              className={`text-[8.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded border shadow-2xs ${
                                isRetMet
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                  : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                              }`}
                            >
                              {isRetMet ? 'Goal Met ✓' : `Need ${retNeed}`}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black font-mono tabular-nums border shadow-2xs"
                            style={{
                              backgroundColor: `${paceInk(row.retails.gap)}15`,
                              borderColor: `${paceInk(row.retails.gap)}40`,
                              color: paceInk(row.retails.gap),
                            }}
                          >
                            {paceText(row.retails.gap)}
                          </span>
                          {hasRetTgt && (
                            <span className="text-[9.5px] font-bold text-slate-500">
                              {isRetMet
                                ? 'Target Met ✓'
                                : `Need ${retNeed} to hit`}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* VIEW 2: MODEL-WISE TARGETS & ACHIEVED */}
          {consultantView === 'models' && (
            <table className="w-full text-left text-xs kia-plan-table">
              <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                <tr className="text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                  <th scope="col" className="py-3 px-4">Consultant</th>
                  <th scope="col" className="py-3 px-4">Team Leader</th>
                  {data.allModels.map((m) => (
                    <th scope="col" key={m} className="py-3 px-3 text-center">
                      <span className="block font-black text-slate-800 dark:text-slate-200">{m}</span>
                      <span className="block text-[9px] text-slate-400 font-normal">Act / Tgt · Gap</span>
                    </th>
                  ))}
                  <th scope="col" className="py-3 px-3.5 text-center font-black">
                    <span className="block text-slate-800 dark:text-slate-200">Total Retail</span>
                    <span className="block text-[9px] text-slate-400 font-normal">Act / Target</span>
                  </th>
                  <th scope="col" className="py-3 px-4 text-right">Retail Gap & Deficit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {data.consultants.map((row) => {
                  const hasRetTgt = row.retails.target > 0
                  const retNeed = hasRetTgt ? Math.max(0, row.retails.target - row.retails.actual) : 0
                  const isRetMet = hasRetTgt && row.retails.actual >= row.retails.target

                  return (
                    <tr key={row.consultant} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60 transition-colors">
                      <td className="py-3 px-4 font-black text-slate-900 dark:text-white whitespace-nowrap">
                        {row.consultant}
                        {row.isTeamLeader && (
                          <span
                            className="ml-2 align-middle px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide border shadow-2xs"
                            style={{ backgroundColor: '#e0e7ff', color: '#3730a3', borderColor: '#a5b4fc' }}
                          >
                            Lead
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-semibold whitespace-nowrap">
                        {row.teamLeader || '—'}
                      </td>
                      {data.allModels.map((mName) => {
                        const mItem = (row.models || []).find((x) => x.model === mName)
                        const act = mItem?.retails || 0
                        const tgt = mItem?.target || 0
                        const hasTgt = tgt > 0
                        const need = hasTgt ? Math.max(0, tgt - act) : 0
                        const isMet = hasTgt && act >= tgt

                        return (
                          <td key={mName} className="py-3 px-3 text-center whitespace-nowrap">
                            <div className="font-mono font-black text-xs text-slate-900 dark:text-white">
                              {act}{' '}
                              <span className="text-[10px] text-slate-400 font-semibold">
                                / {hasTgt ? tgt : '—'}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-col items-center gap-0.5">
                              {hasTgt && mItem && mItem.gap !== null ? (
                                <span
                                  className="inline-block text-[9.5px] font-bold tabular-nums"
                                  style={{ color: paceInk(mItem.gap) }}
                                >
                                  {paceText(mItem.gap)}
                                </span>
                              ) : null}
                              {hasTgt && (
                                <span
                                  className={`text-[8.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded border shadow-2xs ${
                                    isMet
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                      : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                  }`}
                                >
                                  {isMet ? 'Met ✓' : `Need ${need}`}
                                </span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                      <td className="py-3 px-3.5 text-center whitespace-nowrap font-mono">
                        <div className="font-black text-xs text-slate-900 dark:text-white">
                          {row.retails.actual}
                          <span className="text-[10px] text-slate-400 font-semibold"> / {row.retails.target > 0 ? row.retails.target : '—'}</span>
                        </div>
                        {hasRetTgt && (
                          <div className="mt-1">
                            <span
                              className={`text-[8.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded border shadow-2xs ${
                                isRetMet
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                  : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                              }`}
                            >
                              {isRetMet ? 'Goal Met ✓' : `Need ${retNeed}`}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black font-mono tabular-nums border shadow-2xs"
                            style={{
                              backgroundColor: `${paceInk(row.retails.gap)}15`,
                              borderColor: `${paceInk(row.retails.gap)}40`,
                              color: paceInk(row.retails.gap),
                            }}
                          >
                            {paceText(row.retails.gap)}
                          </span>
                          {hasRetTgt && (
                            <span className="text-[9.5px] font-bold text-slate-500">
                              {isRetMet
                                ? 'Target Met ✓'
                                : `Need ${retNeed} to hit`}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* VIEW 3: FULL FUNNEL OVERVIEW */}
          {consultantView === 'funnel' && (
            <table className="w-full text-left text-xs kia-plan-table">
              <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                <tr className="text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                  <th scope="col" className="py-3 px-4">Consultant</th>
                  <th scope="col" className="py-3 px-4">Team Leader</th>
                  {METRICS.map((m) => (
                    <th scope="col" key={m.key} className="py-3 px-3 text-center">
                      <span className="block font-black" style={{ color: m.accentHex }}>{m.label}</span>
                      <span className="block text-[9px] text-slate-400 font-normal">Act / Tgt · Gap</span>
                    </th>
                  ))}
                  <th scope="col" className="py-3 px-4 text-right">Pace Gap & Deficit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {data.consultants.map((row) => {
                  const hasRetTgt = row.retails.target > 0
                  const retNeed = hasRetTgt ? Math.max(0, row.retails.target - row.retails.actual) : 0
                  const isRetMet = hasRetTgt && row.retails.actual >= row.retails.target

                  return (
                    <tr key={row.consultant} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60 transition-colors">
                      <td className="py-3 px-4 font-black text-slate-900 dark:text-white whitespace-nowrap">
                        {row.consultant}
                        {row.isTeamLeader && (
                          <span
                            className="ml-2 align-middle px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide border shadow-2xs"
                            style={{ backgroundColor: '#e0e7ff', color: '#3730a3', borderColor: '#a5b4fc' }}
                            title="Team leader"
                          >
                            Lead
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-semibold whitespace-nowrap">
                        {row.teamLeader || '—'}
                      </td>
                      {METRICS.map((m) => (
                        <PlanMetricCell key={m.key} cell={row[m.key]} metricKey={m.key} />
                      ))}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black font-mono tabular-nums border shadow-2xs"
                            style={{
                              backgroundColor: `${paceInk(row.worstGap)}15`,
                              borderColor: `${paceInk(row.worstGap)}40`,
                              color: paceInk(row.worstGap),
                            }}
                            title={row.hasAnyTarget ? 'Against retail target, then bookings' : 'No target set'}
                          >
                            {paceText(row.worstGap)}
                          </span>
                          {hasRetTgt && (
                            <span className="text-[9.5px] font-bold text-slate-500">
                              {isRetMet
                                ? 'Goal Met ✓'
                                : `Need ${retNeed} retails`}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

type Draft = {
  enquiries: string
  testDrives: string
  bookings: string
  retails: string
  modelTargets: Record<string, string>
  note: string
  present: boolean
  saved: boolean
}
type TeamDraft = Record<string, string>

const EMPTY_DRAFT: Draft = {
  enquiries: '',
  testDrives: '',
  bookings: '',
  retails: '',
  modelTargets: {},
  note: '',
  present: false,
  saved: false,
}

const DEFAULT_ENTRY_MODELS = ['SONET', 'NEW SELTOS', 'CARENS', 'SYROS', 'SORENTO']

function CommitmentsTab({
  data,
  canSetTargets,
  onSaved,
  drafts,
  setDrafts,
}: {
  data: Payload
  canSetTargets: boolean
  onSaved: () => void
  drafts: Record<string, Draft>
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, Draft>>>
}) {
  const monthPrefix = `${data.context.year}-${String(data.context.month).padStart(2, '0')}`
  const date = `${monthPrefix}-01`
  const outlet = data.context.outlet
  const [teams, setTeams] = useState<TeamDraft>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [customModels, setCustomModels] = useState<string[]>([])
  const [newModelName, setNewModelName] = useState('')
  const [showAddModel, setShowAddModel] = useState(false)

  // Combine default models, extra models from backend, and user-added custom models
  const activeModels = useMemo(() => {
    const list = [...DEFAULT_ENTRY_MODELS]
    for (const m of data.allModels || []) {
      if (!list.includes(m) && m !== 'OTHER') list.push(m)
    }
    for (const m of customModels) {
      const u = m.trim().toUpperCase()
      if (u && !list.includes(u)) list.push(u)
    }
    return list
  }, [data.allModels, customModels])

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
   * Read monthly commitments & model targets from database.
   */
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ outlet, date, scope: 'month' })
        const res = await fetch(`/api/brands/kia/sales-performance/targets?${params}`, { cache: 'no-store' })
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        const next: Record<string, Draft> = {}
        for (const e of (body.entries || [])) {
          const mTargetsRaw = (e.modelTargets && typeof e.modelTargets === 'object') ? e.modelTargets : {}
          const mTargetsStr: Record<string, string> = {}
          for (const [k, v] of Object.entries(mTargetsRaw)) {
            mTargetsStr[k] = v !== undefined && v !== null ? String(v) : ''
          }

          next[String(e.consultantName).trim()] = {
            enquiries: e.enquiries !== null && e.enquiries !== undefined ? String(e.enquiries) : '',
            testDrives: e.testDrives !== null && e.testDrives !== undefined ? String(e.testDrives) : '',
            bookings: e.bookings !== null && e.bookings !== undefined ? String(e.bookings) : '',
            retails: e.retails !== null && e.retails !== undefined ? String(e.retails) : '',
            modelTargets: mTargetsStr,
            note: e.note || '',
            present: true,
            saved: true,
          }
        }
        setDrafts(next)
      } catch {
        if (!cancelled) setDrafts({})
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [date, outlet, setDrafts])

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

  const setFunnel = (name: string, field: 'enquiries' | 'testDrives' | 'bookings' | 'retails' | 'note', value: string) =>
    setDrafts((prev) => ({
      ...prev,
      [name]: { ...(prev[name] || EMPTY_DRAFT), [field]: value, present: true, saved: false },
    }))

  const setModelTarget = (name: string, model: string, value: string) =>
    setDrafts((prev) => {
      const current = prev[name] || EMPTY_DRAFT
      const currentModels = { ...current.modelTargets, [model]: value }
      return {
        ...prev,
        [name]: {
          ...current,
          modelTargets: currentModels,
          present: true,
          saved: false,
        },
      }
    })

  const touched = (d: Draft) => {
    if (!d.present) return false
    if (d.enquiries !== '' || d.testDrives !== '' || d.bookings !== '' || d.retails !== '' || d.note.trim() !== '') return true
    return Object.values(d.modelTargets || {}).some((v) => v !== '' && v !== '0')
  }

  const committedCount = Object.values(drafts).filter(touched).length
  const unsavedCount = data.consultants.filter((row) => {
    const d = drafts[row.consultant]
    return d && touched(d) && !d.saved
  }).length

  // Calculate live sum totals across all consultant drafts
  const totals = useMemo(() => {
    let enq = 0
    let td = 0
    let bkg = 0
    let ret = 0
    const models: Record<string, number> = {}
    for (const m of activeModels) models[m] = 0

    for (const row of data.consultants) {
      const d = drafts[row.consultant]
      if (!d) continue
      enq += Number(d.enquiries) || 0
      td += Number(d.testDrives) || 0
      bkg += Number(d.bookings) || 0
      ret += Number(d.retails) || 0
      for (const m of activeModels) {
        models[m] += Number(d.modelTargets?.[m]) || 0
      }
    }

    const totalModelSum = Object.values(models).reduce((a, b) => a + b, 0)
    return { enq, td, bkg, ret, models, totalModelSum }
  }, [drafts, data.consultants, activeModels])

  const handleAddModel = () => {
    const u = newModelName.trim().toUpperCase()
    if (u && !activeModels.includes(u)) {
      setCustomModels((prev) => [...prev, u])
      setNewModelName('')
      setShowAddModel(false)
      toast({
        title: 'Model added',
        description: `Added ${u} column to commitments matrix.`,
        variant: 'success',
      })
    }
  }

  async function save() {
    const pending = data.consultants.filter((row) => touched(drafts[row.consultant] || EMPTY_DRAFT))
    if (pending.length === 0) {
      toast({
        title: 'Nothing to save yet',
        description: 'Type a target number against at least one consultant first.',
        variant: 'error',
      })
      return
    }

    setSaving(true)
    try {
      const entries = pending
        .map((row) => {
          const d = drafts[row.consultant]
          const mTargetsNum: Record<string, number> = {}
          for (const [k, v] of Object.entries(d.modelTargets || {})) {
            const val = Number(v) || 0
            if (val > 0) mTargetsNum[k] = val
          }

          return {
            consultantName: row.consultant,
            enquiries: Number(d.enquiries) || 0,
            testDrives: Number(d.testDrives) || 0,
            bookings: Number(d.bookings) || 0,
            retails: Number(d.retails) || 0,
            modelTargets: mTargetsNum,
            note: d.note.trim() || null,
          }
        })

      const res = await fetch('/api/brands/kia/sales-performance/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outlet,
          date,
          scope: 'month',
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
        title: 'Monthly Commitments Saved',
        description: `Saved targets for ${body.saved ?? entries.length} consultants for ${data.context.label}. Weekly targets divided automatically.`,
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
      const params = new URLSearchParams({ outlet, date, consultant, scope: 'month' })
      const res = await fetch(`/api/brands/kia/sales-performance/targets?${params}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not clear it')
      setDrafts((prev) => ({ ...prev, [consultant]: { ...EMPTY_DRAFT } }))

      toast({
        title: 'Commitment cleared',
        description: `${consultant} has no monthly commitment recorded for ${data.context.label}.`,
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
          the plan on the other tabs.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-[0_4px_20px_rgba(15,23,42,0.02)] space-y-0">
      {/* Matrix Controls Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-950/40">
        <div>
          <h3 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
            Monthly Targets & Model Matrix — {data.context.outletLabel}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Set monthly funnel targets and model-wise targets for {data.context.label}. Targets are automatically divided across Week 1 (1–7), Week 2 (8–14), Week 3 (15–21), and Week 4 (22–End).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Add Model Button & Popup */}
          <div className="relative">
            {showAddModel ? (
              <div className="flex items-center gap-1.5 p-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <Input
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  placeholder="e.g. CARNIVAL, EV6"
                  className="h-7 w-32 text-xs font-bold uppercase rounded-lg border-slate-200 dark:border-slate-700"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleAddModel}
                  className="h-7 px-2.5 rounded-lg text-xs font-black bg-teal-600 text-white cursor-pointer hover:bg-teal-700"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModel(false)}
                  className="h-7 px-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddModel(true)}
                className="h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-1.5 shadow-2xs transition-all"
              >
                <span>+</span>
                <span>Add Model Column</span>
              </button>
            )}
          </div>

          <span className="h-9 px-3.5 inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-300 font-mono">
            {data.context.label}
          </span>

          <Button
            onClick={save}
            disabled={saving || loading}
            style={{ backgroundColor: INK.teal, color: '#ffffff' }}
            className="h-9 px-4 rounded-xl text-xs font-bold border-none cursor-pointer hover:opacity-90 shadow-2xs active:scale-95 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
            Save Month Targets
          </Button>
        </div>
      </div>

      {/* Info & Status Strip with Totals Summary */}
      <div className="px-5 py-2.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] bg-white dark:bg-slate-900">
        <span className="font-bold" style={{ color: INK.teal }}>
          Monthly Target & Model Breakdown
        </span>
        <span className="text-slate-500 font-medium">
          {loading ? 'Reading commitments…' : `${committedCount} of ${data.consultants.length} consultants committed`}
        </span>
        {unsavedCount > 0 && (
          <span className="font-black px-2 py-0.5 rounded-md border" style={{ backgroundColor: `${INK.behind}15`, borderColor: `${INK.behind}30`, color: INK.behind }}>
            {unsavedCount} row{unsavedCount === 1 ? '' : 's'} not saved yet
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
            Total Retails: <strong className="text-emerald-600">{totals.ret}</strong> · Model Targets Sum: <strong className={totals.totalModelSum === totals.ret ? 'text-teal-600' : 'text-amber-600'}>{totals.totalModelSum}</strong>
          </span>
        </div>
      </div>

      <datalist id="kia-team-leaders">
        {knownLeaders.map((l) => <option key={l} value={l} />)}
      </datalist>

      {/* Table Data Entry Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs kia-plan-table">
          <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
            <tr className="text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider text-[10px]">
              <th scope="col" className="py-3 px-4">Consultant</th>
              <th scope="col" className="py-3 px-3">Team Leader</th>
              {/* Funnel Targets */}
              {METRICS.map((m) => (
                <th scope="col" key={m.key} className="py-3 px-2 text-center" style={{ color: m.accentHex }}>
                  {m.label}
                </th>
              ))}
              {/* Model Targets */}
              {activeModels.map((mName) => (
                <th scope="col" key={mName} className="py-3 px-2 text-center bg-slate-50/60 dark:bg-slate-900/40">
                  <span className="font-black text-slate-800 dark:text-slate-200">{mName}</span>
                </th>
              ))}
              <th scope="col" className="py-3 px-3">Note</th>
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
                  </td>
                  <td className="py-2.5 px-3">
                    <Input
                      list="kia-team-leaders"
                      value={teams[row.consultant] ?? ''}
                      onChange={(e) => setTeams((prev) => ({ ...prev, [row.consultant]: e.target.value }))}
                      placeholder="Unassigned"
                      className="h-8 w-28 text-xs font-semibold rounded-lg border-slate-200 dark:border-slate-800"
                      aria-label={`Team leader for ${row.consultant}`}
                    />
                  </td>
                  {/* Funnel Inputs */}
                  {METRICS.map((m) => {
                    const hasVal = d[m.key as 'enquiries' | 'testDrives' | 'bookings' | 'retails'] !== '' && d[m.key as 'enquiries' | 'testDrives' | 'bookings' | 'retails'] !== undefined
                    return (
                      <td key={m.key} className="py-2.5 px-1.5 text-center">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={d[m.key as 'enquiries' | 'testDrives' | 'bookings' | 'retails'] as string}
                          onChange={(e) => setFunnel(row.consultant, m.key as 'enquiries' | 'testDrives' | 'bookings' | 'retails', e.target.value)}
                          placeholder="—"
                          style={{
                            borderColor: hasVal ? `${m.accentHex}45` : undefined,
                            backgroundColor: hasVal ? `${m.accentHex}0a` : undefined,
                            color: hasVal ? m.accentHex : undefined,
                          }}
                          className="h-8 w-14 mx-auto text-xs font-mono font-black rounded-lg tabular-nums border-slate-200 dark:border-slate-800 text-center transition-all"
                          aria-label={`${m.label} target for ${row.consultant}`}
                        />
                      </td>
                    )
                  })}
                  {/* Model Target Inputs */}
                  {activeModels.map((mName) => {
                    const val = d.modelTargets?.[mName] ?? ''
                    const hasVal = val !== '' && val !== '0'
                    return (
                      <td key={mName} className="py-2.5 px-1.5 text-center bg-slate-50/40 dark:bg-slate-900/30">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={val}
                          onChange={(e) => setModelTarget(row.consultant, mName, e.target.value)}
                          placeholder="—"
                          style={{
                            borderColor: hasVal ? `${INK.teal}50` : undefined,
                            backgroundColor: hasVal ? `${INK.teal}0d` : undefined,
                            color: hasVal ? INK.teal : undefined,
                          }}
                          className="h-8 w-14 mx-auto text-xs font-mono font-black rounded-lg tabular-nums border-slate-200 dark:border-slate-800 text-center transition-all"
                          aria-label={`${mName} target for ${row.consultant}`}
                        />
                      </td>
                    )
                  })}
                  <td className="py-2.5 px-3">
                    <Input
                      value={d.note}
                      onChange={(e) => setFunnel(row.consultant, 'note', e.target.value)}
                      placeholder="special focus, notes…"
                      className="h-8 w-32 text-xs font-medium rounded-lg border-slate-200 dark:border-slate-800"
                      aria-label={`Note for ${row.consultant}`}
                    />
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => clearOne(row.consultant)}
                      disabled={!d.present}
                      className="h-7 px-2.5 rounded-lg text-[10px] font-extrabold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-30 disabled:cursor-default transition-all"
                      title={d.present ? 'Remove commitment' : 'Nothing committed'}
                    >
                      Clear
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {/* Totals Summary Footer */}
          <tfoot className="border-t-2 border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 font-black">
            <tr>
              <td className="py-3 px-4 font-black text-slate-900 dark:text-white uppercase text-[10px] tracking-wider">
                Total Month Targets
              </td>
              <td className="py-3 px-3 text-slate-400 font-mono text-[10px]">
                {data.consultants.length} Cons
              </td>
              {METRICS.map((m) => (
                <td key={m.key} className="py-3 px-1.5 text-center font-mono text-xs" style={{ color: m.accentHex }}>
                  {totals[m.key as 'enq' | 'td' | 'bkg' | 'ret']}
                </td>
              ))}
              {activeModels.map((mName) => (
                <td key={mName} className="py-3 px-1.5 text-center font-mono text-xs text-teal-700 dark:text-teal-300">
                  {totals.models[mName] || 0}
                </td>
              ))}
              <td colSpan={2} className="py-3 px-4 text-right text-[10px] text-slate-400">
                Sum: {totals.totalModelSum} models
              </td>
            </tr>
          </tfoot>
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

            {/* Week Boundary Milestones (Day 7, 14, 21, 28) */}
            {days.map((d, i) => {
              if (d.day === 7 || d.day === 14 || d.day === 21 || d.day === 28) {
                const x = PAD.l + i * colW + colW
                const wNo = Math.floor(d.day / 7)
                return (
                  <g key={`w_line_${d.day}`}>
                    <line
                      x1={x}
                      y1={PAD.t}
                      x2={x}
                      y2={PAD.t + innerH}
                      stroke="#94a3b8"
                      strokeDasharray="2 3"
                      strokeWidth="1"
                      opacity={0.6}
                    />
                    <rect
                      x={x - 12}
                      y={PAD.t - 14}
                      width={24}
                      height={12}
                      rx={3}
                      fill="#f1f5f9"
                      stroke="#cbd5e1"
                      strokeWidth="0.5"
                    />
                    <text
                      x={x}
                      y={PAD.t - 5}
                      fontSize="8"
                      fontWeight="bold"
                      fill="#475569"
                      textAnchor="middle"
                    >
                      W{wNo}
                    </text>
                  </g>
                )
              }
              return null
            })}

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

        {/* Weekly Milestone Summary for chosen metric */}
        {data.weeks && data.weeks.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-800">
            <h4 className="text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-2">
              Weekly {activeTheme.label} Milestone Pace
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {data.weeks.map((w) => {
                const mCell = w[metric]
                return (
                  <div
                    key={w.scope}
                    className={`p-2.5 rounded-xl border text-xs ${
                      w.isCurrent
                        ? 'bg-teal-50/60 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800'
                        : 'bg-slate-50 dark:bg-slate-850/50 border-slate-100 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 mb-1">
                      <span>Week {w.weekNumber}</span>
                      <span className="text-[9px]">{w.startDay}–{w.endDay}</span>
                    </div>
                    <div className="font-black font-mono tabular-nums text-slate-900 dark:text-white">
                      {mCell.actual}{' '}
                      <span className="text-[10px] text-slate-400 font-normal">
                        / {mCell.target > 0 ? mCell.target : '—'}
                      </span>
                    </div>
                    <div className="mt-1 text-[9.5px] font-bold" style={{ color: paceInk(mCell.gap) }}>
                      {paceText(mCell.gap)}
                    </div>
                    {mCell.target > 0 && (
                      <div className="mt-0.5 text-[8.5px] font-bold">
                        {mCell.actual >= mCell.target ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Met ✓</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">Need {mCell.target - mCell.actual}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
