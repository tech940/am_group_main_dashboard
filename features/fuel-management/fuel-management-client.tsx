'use client'

import { useMemo, useState, type FC, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  Calendar,
  CalendarDays,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Download,
  Droplet,
  Droplets,
  ExternalLink,
  Eye,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  Flame,
  Fuel,
  Gauge,
  HelpCircle,
  Hourglass,
  IndianRupee,
  Info,
  Layers,
  LayoutGrid,
  ListFilter,
  LoaderCircle,
  MapPin,
  PieChart,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Truck,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { formatIndiaDate, formatIndiaDateTime, getIndiaYmd } from '@/lib/date-time'
import { getGatePassStatusInfo, type GatePassStatusInfo } from '@/lib/gate-pass/status'
import { cn } from '@/lib/utils'

/* -------------------------------------------------------------------------------------------------
 * API CONTRACT & TYPES (Mirrors lib/fuel-management/types.ts)
 * ----------------------------------------------------------------------------------------------- */

type Branch = 'ALL' | 'JK402' | 'JK501'

type CheckKind =
  | 'odometer_backwards'
  | 'gate_odometer_mismatch'
  | 'possible_duplicate'
  | 'unmatched_demo_fill'
  | 'missing_odometer'

type FuelEnergyTypeSummary = {
  energyType: string
  label: string
  approvedLitres: number
  totalLitres: number
  approvedRequests: number
  totalRequests: number
  avgFillSize: number
  percentage: number
}

type FuelBranchEnergySummary = {
  branch: string
  branchLabel: string
  petrolLitres: number
  dieselLitres: number
  cngLitres: number
  evKwh: number
  totalLitres: number
  petrolPct: number
  dieselPct: number
}

type FuelPurposeEnergyMatrixRow = {
  purpose: string
  purposeLabel: string
  petrolLitres: number
  dieselLitres: number
  cngLitres: number
  evKwh: number
  totalLitres: number
  requestsCount: number
}

type FuelManagementResponse = {
  period: { from: string; to: string; branch: Branch }
  kpis: {
    approvedLitres: number
    approvedRequests: number
    awaiting: { total: number; byStage: { stage: string; label: string; count: number }[] }
    demoDriveKm: number
    demoDrives: number
    gpsVerifiedKm: number
    gpsVerifiedDrives: number
    checksNeedingAttention: number
  }
  byPurpose: {
    purpose: string
    label: string
    approvedLitres: number
    approvedRequests: number
    awaitingRequests: number
  }[]
  byEnergyType?: FuelEnergyTypeSummary[]
  byBranchEnergy?: FuelBranchEnergySummary[]
  purposeEnergyMatrix?: FuelPurposeEnergyMatrixRow[]
  demoCars: {
    vin: string
    registrationNumber: string | null
    model: string | null
    branchLabel: string
    approvedLitres: number
    lastFillDate: string | null
    lastFillOdometerKm: number | null
    kmSinceLastFill: number | null
    kmPerLitre: { value: number; fillsUsed: number } | null
    kmPerLitreNote: string | null
    driveKm: number
    gpsKm: number
    fills: {
      requestNumber: string
      date: string
      litres: number
      energyType?: string
      odometerKm: number | null
      status: string
      statusLabel: string
    }[]
    drives: {
      passNo: string
      gateOutAt: string
      status: string
      odometerKm: number | null
      gpsKm: number | null
    }[]
  }[]
  otherFuel: {
    requestNumber: string
    date: string
    purpose: string
    purposeLabel: string
    energyType?: string
    vehicleLabel: string
    branchLabel: string
    litres: number
    status: string
    statusLabel: string
  }[]
  checks: {
    kind: CheckKind
    severity: 'warning' | 'info'
    requestNumber: string
    vin: string | null
    vehicleLabel: string
    message: string
  }[]
  generatedAt: string
}

type DemoCar = FuelManagementResponse['demoCars'][number]
type FuelCheck = FuelManagementResponse['checks'][number]
type OtherFuelRow = FuelManagementResponse['otherFuel'][number]

type TabId = 'overview' | 'requests' | 'mileage' | 'usage' | 'exceptions' | 'reports'

type PeriodPreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'month'
  | 'last_month'
  | 'last30'
  | 'last90'
  | 'this_year'
  | 'custom'

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: '7 Days' },
  { value: 'month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last30', label: 'Last 30D' },
  { value: 'last90', label: 'Last 90D' },
  { value: 'this_year', label: 'This FY' },
  { value: 'custom', label: 'Custom Range' },
]

const BRANCH_OPTIONS: { value: Branch; label: string }[] = [
  { value: 'ALL', label: 'All Branches' },
  { value: 'JK402', label: 'Jammu' },
  { value: 'JK501', label: 'Udhampur' },
]

const BRANCH_LABEL: Record<Branch, string> = {
  ALL: 'All Branches',
  JK402: 'Jammu (JK402)',
  JK501: 'Udhampur (JK501)',
}

const MAX_PERIOD_DAYS = 366
const ESTIMATED_FUEL_PRICE_INR = 95 // Standard reference rate for cost derivations

// ── Status Tokens & Formatters ───────────────────────────────────────────────────

const TONE = {
  warning: { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  info: { bg: '#eef2ff', fg: '#3730a3', border: '#c7d2fe' },
  success: { bg: '#d1fae5', fg: '#065f46', border: '#a7f3d0' },
  danger: { bg: '#ffe4e6', fg: '#9f1239', border: '#fecdd3' },
  muted: { bg: '#f1f5f9', fg: '#475569', border: '#e2e8f0' },
} as const

type Tone = keyof typeof TONE

const CHECK_TITLE: Record<CheckKind, string> = {
  odometer_backwards: 'Odometer reading went backwards',
  gate_odometer_mismatch: 'Fill odometer is below an earlier gate-in reading',
  possible_duplicate: 'Possible duplicate request',
  unmatched_demo_fill: 'Demo fill not linked to a demo car',
  missing_odometer: 'Demo fill has no odometer reading',
}

const CHECK_CATEGORY: Record<CheckKind, 'efficiency' | 'data_quality' | 'workflow'> = {
  odometer_backwards: 'data_quality',
  gate_odometer_mismatch: 'data_quality',
  possible_duplicate: 'data_quality',
  unmatched_demo_fill: 'data_quality',
  missing_odometer: 'data_quality',
}

const litresFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
const currencyFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const kmFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
const countFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

function formatLitres(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? litresFormat.format(value) : '0'
}

function formatCurrency(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `₹${currencyFormat.format(value)}` : '₹0'
}

function formatKm(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? kmFormat.format(value) : '0'
}

function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? countFormat.format(value) : '0'
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

function ymdToUtcMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`)
}

function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const ms = ymdToUtcMs(value)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
}

function shiftYmd(ymd: string, days: number): string {
  return new Date(ymdToUtcMs(ymd) + days * 86_400_000).toISOString().slice(0, 10)
}

function formatYmd(value: string | null | undefined, withYear = true): string {
  const ymd = String(value ?? '').slice(0, 10)
  if (!isValidYmd(ymd)) return '—'
  const istMidnight = `${ymd}T00:00:00+05:30`
  return withYear
    ? formatIndiaDate(istMidnight)
    : formatIndiaDateTime(istMidnight, { hour: undefined, minute: undefined, hour12: undefined }) ?? '—'
}

function formatRange(from: string, to: string): string {
  if (from === to) return formatYmd(from)
  if (from.slice(0, 4) === to.slice(0, 4)) return `${formatYmd(from, false)} – ${formatYmd(to)}`
  return `${formatYmd(from)} – ${formatYmd(to)}`
}

function getRangeDays(from: string, to: string): number {
  if (!isValidYmd(from) || !isValidYmd(to)) return 0
  return Math.max(1, Math.round((ymdToUtcMs(to) - ymdToUtcMs(from)) / 86_400_000) + 1)
}

function shiftRange(from: string, to: string, direction: 'prev' | 'next'): { from: string; to: string } {
  const days = getRangeDays(from, to)
  const offset = direction === 'next' ? days : -days
  return {
    from: shiftYmd(from, offset),
    to: shiftYmd(to, offset),
  }
}

function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today: string) {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const y = shiftYmd(today, -1)
      return { from: y, to: y }
    }
    case 'this_week':
      return { from: shiftYmd(today, -6), to: today }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today }
    case 'last_month': {
      const year = parseInt(today.slice(0, 4), 10)
      const month = parseInt(today.slice(5, 7), 10)
      const prevYear = month === 1 ? year - 1 : year
      const prevMonth = month === 1 ? 12 : month - 1
      const prevMonthStr = String(prevMonth).padStart(2, '0')
      const lastDay = new Date(year, month - 1, 0).getDate()
      return {
        from: `${prevYear}-${prevMonthStr}-01`,
        to: `${prevYear}-${prevMonthStr}-${String(lastDay).padStart(2, '0')}`,
      }
    }
    case 'last30':
      return { from: shiftYmd(today, -29), to: today }
    case 'last90':
      return { from: shiftYmd(today, -89), to: today }
    case 'this_year': {
      const year = parseInt(today.slice(0, 4), 10)
      const month = parseInt(today.slice(5, 7), 10)
      const fyStartYear = month >= 4 ? year : year - 1
      return { from: `${fyStartYear}-04-01`, to: today }
    }
    default:
      return { from: `${today.slice(0, 8)}01`, to: today }
  }
}

type RangeResult = { range: { from: string; to: string }; error: null } | { range: null; error: string }

function validateCustomRange(from: string, to: string): RangeResult {
  if (!from || !to) return { range: null, error: 'Pick both a start date and an end date.' }
  if (!isValidYmd(from) || !isValidYmd(to)) return { range: null, error: 'One of the dates is not a valid date.' }
  if (from > to) return { range: null, error: 'Start date must be before or equal to end date.' }
  const days = (ymdToUtcMs(to) - ymdToUtcMs(from)) / 86_400_000 + 1
  if (days > MAX_PERIOD_DAYS) return { range: null, error: 'Choose a period of one year or less.' }
  return { range: { from, to }, error: null }
}

function vinTail(vin: string | null | undefined): string | null {
  const clean = String(vin ?? '').trim()
  return clean ? `VIN …${clean.slice(-6)}` : null
}

function fuelStatusTone(status: string): Tone {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  if (status === 'sent_back' || status.endsWith('_on_hold')) return 'warning'
  return 'info'
}

type PurposeStyle = {
  bg: string
  text: string
  border: string
  bar: string
  dot: string
}

const PURPOSE_CONFIG: Record<string, PurposeStyle> = {
  DEMO: {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200/80',
    bar: 'bg-purple-500',
    dot: 'bg-purple-500',
  },
  GENSET: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200/80',
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
  },
  NEW_DELIVERY: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200/80',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
  },
  STOCK_TRANSFER: {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200/80',
    bar: 'bg-sky-500',
    dot: 'bg-sky-500',
  },
  STOCK_YARD: {
    bg: 'bg-cyan-50',
    text: 'text-cyan-700',
    border: 'border-cyan-200/80',
    bar: 'bg-cyan-500',
    dot: 'bg-cyan-500',
  },
  SERVICE: {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200/80',
    bar: 'bg-rose-500',
    dot: 'bg-rose-500',
  },
  STAFF_VEHICLE: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200/80',
    bar: 'bg-blue-500',
    dot: 'bg-blue-500',
  },
  OTHER: {
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    border: 'border-slate-200',
    bar: 'bg-slate-500',
    dot: 'bg-slate-500',
  },
}

function getPurposeConfig(purpose?: string): PurposeStyle {
  if (!purpose) return PURPOSE_CONFIG.OTHER
  const key = purpose.toUpperCase().replace(/[\s-]/g, '_')
  return PURPOSE_CONFIG[key] || PURPOSE_CONFIG.OTHER
}

function PurposeBadge({ purpose, label }: { purpose?: string; label?: string }) {
  const conf = getPurposeConfig(purpose)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        conf.bg,
        conf.text,
        conf.border,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', conf.dot)} />
      <span>{label || purpose || 'General'}</span>
    </span>
  )
}

function BranchBadge({ branch }: { branch: string }) {
  const isJK402 = branch.includes('402') || branch.toLowerCase().includes('jammu')
  const isJK501 = branch.includes('501') || branch.toLowerCase().includes('udhampur')
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap',
        isJK402 && 'border-sky-200 bg-sky-50 text-sky-800',
        isJK501 && 'border-indigo-200 bg-indigo-50 text-indigo-800',
        !isJK402 && !isJK501 && 'border-slate-200 bg-slate-50 text-slate-700',
      )}
    >
      <MapPin className="h-2.5 w-2.5 opacity-70" />
      <span>{branch}</span>
    </span>
  )
}

function EnergyTypeBadge({ energyType }: { energyType?: string }) {
  const norm = (energyType || 'PETROL').toUpperCase()
  if (norm === 'DIESEL') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-200/90 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
        <span>Diesel</span>
      </span>
    )
  }
  if (norm === 'CNG') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-teal-200/90 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
        <span>CNG</span>
      </span>
    )
  }
  if (norm === 'EV') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200/90 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
        <span>EV</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200/90 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 whitespace-nowrap">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      <span>Petrol</span>
    </span>
  )
}

function MileageBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || value <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 whitespace-nowrap">
        <Clock className="h-3 w-3 text-slate-400" />
        <span>Need 2nd fill</span>
      </span>
    )
  }
  const isHigh = value >= 14
  const isNormal = value >= 10
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums whitespace-nowrap',
        isHigh && 'border-emerald-200 bg-emerald-50 text-emerald-800',
        isNormal && !isHigh && 'border-teal-200 bg-teal-50 text-teal-800',
        !isNormal && 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      <Gauge className={cn('h-3 w-3', isHigh ? 'text-emerald-600' : isNormal ? 'text-teal-600' : 'text-amber-600')} />
      <span>{formatKm(value)} km/L</span>
    </span>
  )
}

// ── Data Loader ──────────────────────────────────────────────────────────────────

class FuelManagementLoadError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'FuelManagementLoadError'
    this.status = status
  }
}

async function loadFuelManagement(from: string, to: string, branch: Branch): Promise<FuelManagementResponse> {
  const params = new URLSearchParams({ from, to, branch })
  let res: Response
  try {
    res = await fetch(`/api/fuel-management?${params.toString()}`, { cache: 'no-store' })
  } catch {
    throw new FuelManagementLoadError('Could not reach the server. Check your connection.', 0)
  }

  if (!res.ok) {
    if (res.status === 401) throw new FuelManagementLoadError('Session expired. Sign in again.', 401)
    if (res.status === 403) throw new FuelManagementLoadError("You don't have access to Fuel Management.", 403)
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null
    const msg = typeof body?.error === 'string' ? body.error.trim() : ''
    throw new FuelManagementLoadError(msg || 'Could not load fuel data.', res.status)
  }

  const payload = (await res.json().catch(() => null)) as FuelManagementResponse | null
  if (!payload || typeof payload !== 'object' || !payload.kpis || !payload.period) {
    throw new FuelManagementLoadError('Invalid response from server.', res.status)
  }
  return payload
}

/* =================================================================================================
 * MAIN CLIENT COMPONENT
 * =============================================================================================== */

export const FuelManagementClient: FC<{ currentUser?: Record<string, unknown> }> = () => {
  const [today] = useState(() => getIndiaYmd())
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [preset, setPreset] = useState<PeriodPreset>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [branch, setBranch] = useState<Branch>('ALL')

  // Additional Global Multi-Dimensional Filters
  const [globalPurpose, setGlobalPurpose] = useState<string>('ALL')
  const [globalVehicleType, setGlobalVehicleType] = useState<'ALL' | 'DEMO' | 'OTHER'>('ALL')
  const [globalEnergyType, setGlobalEnergyType] = useState<string>('ALL')
  const [showDateModal, setShowDateModal] = useState(false)
  const [tempPreset, setTempPreset] = useState<PeriodPreset>('month')
  const [tempFrom, setTempFrom] = useState('')
  const [tempTo, setTempTo] = useState('')
  const [tempError, setTempError] = useState<string | null>(null)

  // Modals & Drawers state
  const [selectedVin, setSelectedVin] = useState<string | null>(null)
  const [showMethodologyModal, setShowMethodologyModal] = useState(false)
  const [selectedRequestDetails, setSelectedRequestDetails] = useState<any | null>(null)

  const rangeResult: RangeResult = useMemo(
    () =>
      preset === 'custom'
        ? validateCustomRange(customFrom, customTo)
        : { range: presetRange(preset, today), error: null },
    [preset, customFrom, customTo, today],
  )
  const range = rangeResult.range

  const activeRangeDays = useMemo(() => {
    if (!range) return 0
    return getRangeDays(range.from, range.to)
  }, [range])

  const tempRangeDays = useMemo(() => {
    if (!tempFrom || !tempTo) return 0
    return getRangeDays(tempFrom, tempTo)
  }, [tempFrom, tempTo])

  const query = useQuery({
    queryKey: ['fuel-management', range?.from ?? null, range?.to ?? null, branch],
    queryFn: () =>
      range
        ? loadFuelManagement(range.from, range.to, branch)
        : Promise.reject(new FuelManagementLoadError('Choose a valid period first.', 400)),
    enabled: range !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnMount: true,
  })

  const { data, error, isError, isFetching, isPlaceholderData, refetch } = query
  const loadError = error instanceof FuelManagementLoadError ? error : null

  const openDateModal = () => {
    setTempPreset(preset)
    if (preset === 'custom') {
      setTempFrom(customFrom || today)
      setTempTo(customTo || today)
    } else {
      const cur = presetRange(preset, today)
      setTempFrom(cur.from)
      setTempTo(cur.to)
    }
    setTempError(null)
    setShowDateModal(true)
  }

  const handleSelectTempPreset = (next: PeriodPreset) => {
    setTempPreset(next)
    setTempError(null)
    if (next !== 'custom') {
      const cur = presetRange(next, today)
      setTempFrom(cur.from)
      setTempTo(cur.to)
    }
  }

  const handleApplyDateModal = () => {
    if (tempPreset === 'custom') {
      const res = validateCustomRange(tempFrom, tempTo)
      if (res.error) {
        setTempError(res.error)
        return
      }
      setPreset('custom')
      setCustomFrom(tempFrom)
      setCustomTo(tempTo)
    } else {
      setPreset(tempPreset)
    }
    setShowDateModal(false)
  }

  const handleResetDateModalToDefault = () => {
    setPreset('month')
    setCustomFrom('')
    setCustomTo('')
    setTempPreset('month')
    const cur = presetRange('month', today)
    setTempFrom(cur.from)
    setTempTo(cur.to)
    setTempError(null)
    setShowDateModal(false)
  }

  const selectPreset = (next: PeriodPreset) => {
    if (next === 'custom') {
      openDateModal()
      return
    }
    setPreset(next)
  }

  const handleShiftPeriod = (direction: 'prev' | 'next') => {
    if (!range) return
    const nextRange = shiftRange(range.from, range.to, direction)
    setPreset('custom')
    setCustomFrom(nextRange.from)
    setCustomTo(nextRange.to)
  }

  const hasActiveFilters =
    preset !== 'month' || branch !== 'ALL' || globalPurpose !== 'ALL' || globalVehicleType !== 'ALL' || globalEnergyType !== 'ALL'

  const handleResetFilters = () => {
    setPreset('month')
    setBranch('ALL')
    setGlobalPurpose('ALL')
    setGlobalVehicleType('ALL')
    setGlobalEnergyType('ALL')
    setCustomFrom('')
    setCustomTo('')
    setShowDateModal(false)
  }

  // Selected vehicle for profile drawer
  const activeVehicle = useMemo(() => {
    if (!data || !selectedVin) return null
    return data.demoCars.find((c) => c.vin === selectedVin) || null
  }, [data, selectedVin])

  // Unified Request rows
  const allRequests = useMemo(() => {
    if (!data) return []
    const list: Array<{
      id: string
      date: string
      requestNumber: string
      purpose: string
      purposeLabel: string
      energyType?: string
      vehicleLabel: string
      branchLabel: string
      litres: number
      status: string
      statusLabel: string
      isDemo: boolean
      vin?: string | null
      odometerKm?: number | null
    }> = []

    // From otherFuel
    data.otherFuel.forEach((r, idx) => {
      list.push({
        id: `other-${r.requestNumber}-${idx}`,
        date: r.date,
        requestNumber: r.requestNumber,
        purpose: r.purpose,
        purposeLabel: r.purposeLabel,
        energyType: r.energyType || 'PETROL',
        vehicleLabel: r.vehicleLabel,
        branchLabel: r.branchLabel,
        litres: r.litres,
        status: r.status,
        statusLabel: r.statusLabel,
        isDemo: false,
      })
    })

    // From demoCars fills
    data.demoCars.forEach((c) => {
      c.fills.forEach((f, idx) => {
        list.push({
          id: `demo-${f.requestNumber}-${idx}`,
          date: f.date,
          requestNumber: f.requestNumber,
          purpose: 'DEMO',
          purposeLabel: 'Demo Vehicle',
          energyType: f.energyType || 'PETROL',
          vehicleLabel: [c.model, c.registrationNumber].filter(Boolean).join(' · ') || c.vin,
          branchLabel: c.branchLabel,
          litres: f.litres,
          status: f.status,
          statusLabel: f.statusLabel,
          isDemo: true,
          vin: c.vin,
          odometerKm: f.odometerKm,
        })
      })
    })

    return list.sort((a, b) => b.date.localeCompare(a.date))
  }, [data])

  // Filtered requests based on globalPurpose, globalVehicleType, and globalEnergyType
  const filteredAllRequests = useMemo(() => {
    return allRequests.filter((r) => {
      if (globalPurpose !== 'ALL' && r.purpose !== globalPurpose) return false
      if (globalVehicleType === 'DEMO' && !r.isDemo) return false
      if (globalVehicleType === 'OTHER' && r.isDemo) return false
      if (globalEnergyType !== 'ALL' && (r.energyType || 'PETROL').toUpperCase() !== globalEnergyType) return false
      return true
    })
  }, [allRequests, globalPurpose, globalVehicleType, globalEnergyType])

  // Derived Fleet Stats with multi-filter awareness
  const derivedStats = useMemo(() => {
    if (!data) return { fuelSpend: 0, costPerKm: 0, fleetAvgMileage: null, attentionCount: 0 }

    const isGlobalFiltered = globalPurpose !== 'ALL' || globalVehicleType !== 'ALL'
    const totalLitres = isGlobalFiltered
      ? filteredAllRequests.filter((r) => r.status === 'approved').reduce((acc, r) => acc + (r.litres || 0), 0)
      : data.kpis.approvedLitres

    const fuelSpend = totalLitres * ESTIMATED_FUEL_PRICE_INR
    const demoDriveKm =
      globalVehicleType === 'OTHER' || (globalPurpose !== 'ALL' && globalPurpose !== 'DEMO')
        ? 0
        : data.kpis.demoDriveKm
    const costPerKm = demoDriveKm > 0 ? fuelSpend / demoDriveKm : 0

    // Average calculated mileage across cars with valid mileage
    const carsWithMileage =
      globalVehicleType === 'OTHER' || (globalPurpose !== 'ALL' && globalPurpose !== 'DEMO')
        ? []
        : data.demoCars.filter((c) => c.kmPerLitre && c.kmPerLitre.value > 0)
    const fleetAvgMileage =
      carsWithMileage.length > 0
        ? carsWithMileage.reduce((acc, c) => acc + (c.kmPerLitre?.value || 0), 0) / carsWithMileage.length
        : null

    const attentionCount = data.checks.filter((c) => {
      if (c.severity !== 'warning') return false
      if (globalVehicleType === 'DEMO' && !c.vin) return false
      if (globalVehicleType === 'OTHER' && c.vin) return false
      return true
    }).length

    return { fuelSpend, costPerKm, fleetAvgMileage, attentionCount }
  }, [data, filteredAllRequests, globalPurpose, globalVehicleType])

  return (
    <MainLayout title="Fuel Management" subtitle="Fuel usage, vehicle efficiency and requests">
      <div className="mx-auto max-w-[1600px] space-y-4 pb-16">
        {/* =========================================================================
         * GLOBAL HEADER: MULTI-DIMENSIONAL CONTROLS & FILTER BAR
         * ========================================================================= */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs space-y-3">
          {/* Top Controls Row */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Primary Date Cluster */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Date Presets Group */}
              <div className="inline-flex rounded-xl border border-slate-200/80 bg-slate-100/80 p-1">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => selectPreset(opt.value)}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                      preset === opt.value
                        ? 'bg-white text-slate-900 font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Date Step Prev / Next Navigator & Direct Modal Trigger */}
              <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white shadow-2xs">
                <button
                  type="button"
                  onClick={() => handleShiftPeriod('prev')}
                  disabled={!range}
                  title="Shift to Previous Period"
                  className="flex h-8 w-7 items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-slate-900 rounded-l-xl transition-colors disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={openDateModal}
                  title="Click to open calendar and customize date range"
                  className="flex items-center gap-2 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 border-x border-slate-100 transition-colors group"
                >
                  <Calendar className="h-3.5 w-3.5 text-[var(--dashboard-primary)]" />
                  <span className="font-bold text-slate-900">
                    {range ? `${formatYmd(range.from, false)} – ${formatYmd(range.to)}` : 'Select dates'}
                  </span>
                  {activeRangeDays > 0 && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200/60">
                      {activeRangeDays}d
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3 text-slate-400 group-hover:text-slate-600 transition-colors" />
                </button>
                <button
                  type="button"
                  onClick={() => handleShiftPeriod('next')}
                  disabled={!range || (range.to >= today)}
                  title="Shift to Next Period"
                  className="flex h-8 w-7 items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-slate-900 rounded-r-xl transition-colors disabled:opacity-30"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Right Group: Branch & Refresh */}
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {/* Branch Selector */}
              <div className="inline-flex rounded-xl border border-slate-200/80 bg-slate-100/80 p-1">
                {BRANCH_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setBranch(opt.value)}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                      branch === opt.value
                        ? 'bg-white text-slate-900 font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Refresh Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={range === null || isFetching}
                className="h-8 gap-1.5 rounded-xl border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
              >
                <RefreshCw className={cn('h-3.5 w-3.5 text-slate-500', isFetching && 'animate-spin')} />
                <span>{isFetching ? 'Refreshing' : 'Refresh'}</span>
              </Button>
            </div>
          </div>

          {/* Secondary Controls: Fuel Type, Purpose & Vehicle Type Filters + Reset */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 pt-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Energy / Fuel Type Pill Selector */}
              <div className="inline-flex rounded-xl border border-slate-200/80 bg-slate-100/80 p-1">
                {[
                  { id: 'ALL' as const, label: 'All Fuels' },
                  { id: 'PETROL' as const, label: 'Petrol' },
                  { id: 'DIESEL' as const, label: 'Diesel' },
                  { id: 'CNG' as const, label: 'CNG' },
                  { id: 'EV' as const, label: 'EV' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setGlobalEnergyType(opt.id)}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                      globalEnergyType === opt.id
                        ? 'bg-white text-slate-900 font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Global Vehicle Type Pill Selector */}
              <div className="inline-flex rounded-xl border border-slate-200/80 bg-slate-100/80 p-1">
                {[
                  { id: 'ALL' as const, label: 'All Fleet' },
                  { id: 'DEMO' as const, label: 'Demo Cars' },
                  { id: 'OTHER' as const, label: 'Other Assets' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setGlobalVehicleType(opt.id)}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                      globalVehicleType === opt.id
                        ? 'bg-white text-slate-900 font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Global Purpose Filter Dropdown */}
              <select
                value={globalPurpose}
                onChange={(e) => setGlobalPurpose(e.target.value)}
                className={cn(
                  'h-8 rounded-xl border px-3 text-xs font-semibold transition-all focus:outline-none shadow-2xs',
                  globalPurpose !== 'ALL'
                    ? 'border-slate-400 bg-slate-50 text-slate-900 font-bold'
                    : 'border-slate-200 bg-white text-slate-700',
                )}
              >
                <option value="ALL">All Operational Purposes</option>
                {data?.byPurpose.map((p) => (
                  <option key={p.purpose} value={p.purpose}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Active Filters tags & Reset Button */}
            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-1.5">
                {preset !== 'month' && (
                  <button
                    type="button"
                    onClick={openDateModal}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 border border-slate-200 transition-colors"
                  >
                    <Calendar className="h-3 w-3 text-slate-400" />
                    <span>{PERIOD_OPTIONS.find((p) => p.value === preset)?.label || 'Custom'}</span>
                  </button>
                )}
                {branch !== 'ALL' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 border border-slate-200">
                    <Building2 className="h-3 w-3 text-slate-400" />
                    <span>{BRANCH_LABEL[branch]}</span>
                  </span>
                )}
                {globalEnergyType !== 'ALL' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 border border-slate-200 font-bold">
                    <Fuel className="h-3 w-3 text-slate-400" />
                    <span>{globalEnergyType === 'PETROL' ? 'Petrol' : globalEnergyType === 'DIESEL' ? 'Diesel' : globalEnergyType}</span>
                  </span>
                )}
                {globalPurpose !== 'ALL' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 border border-slate-200">
                    <Tag className="h-3 w-3 text-slate-400" />
                    <span>{data?.byPurpose.find((p) => p.purpose === globalPurpose)?.label || globalPurpose}</span>
                  </span>
                )}
                {globalVehicleType !== 'ALL' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 border border-slate-200">
                    <Car className="h-3 w-3 text-slate-400" />
                    <span>{globalVehicleType === 'DEMO' ? 'Demo Cars' : 'Other Assets'}</span>
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilters}
                  className="h-7 px-2 text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 transition-colors ml-1"
                >
                  <RotateCcw className="h-3 w-3 text-slate-400" />
                  <span>Reset filters</span>
                </Button>
              </div>
            )}
          </div>
          {/* Tab Navigation */}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {[
              { id: 'overview' as TabId, label: 'Overview', icon: LayoutGridIcon },
              {
                id: 'requests' as TabId,
                label: 'Fuel Requests',
                icon: FileText,
                badge: data?.kpis.awaiting.total ? `${data.kpis.awaiting.total} pending` : null,
                badgeTone: 'warning',
              },
              { id: 'mileage' as TabId, label: 'Vehicle Mileage', icon: Gauge },
              { id: 'usage' as TabId, label: 'Fuel Consumption', icon: Fuel },
              {
                id: 'exceptions' as TabId,
                label: 'Exceptions',
                icon: TriangleAlert,
                badge: data?.checks.filter((c) => c.severity === 'warning').length
                  ? `${data.checks.filter((c) => c.severity === 'warning').length}`
                  : null,
                badgeTone: 'danger',
              },
              { id: 'reports' as TabId, label: 'Reports', icon: FileSpreadsheet },
            ].map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'group flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all',
                    isActive
                      ? 'bg-[var(--dashboard-primary)] text-white shadow-xs'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5', isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600')} />
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span
                      className={cn(
                        'ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-bold',
                        isActive
                          ? 'bg-white/20 text-white'
                          : tab.badgeTone === 'warning'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800',
                      )}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* =========================================================================
         * CONTENT ROUTING
         * ========================================================================= */}
        {range === null ? (
          <StatePanel icon={<Hourglass className="h-5 w-5" />} title="Choose a date range to view fuel data">
            Pick a start and end date above to display usage, mileage and requests.
          </StatePanel>
        ) : isError && !data ? (
          <StatePanel
            tone="warning"
            icon={<TriangleAlert className="h-5 w-5" />}
            title="Could not load fuel data"
            action={<Button size="sm" onClick={() => void refetch()}>Try Again</Button>}
          >
            {loadError?.message || 'The server could not process the request.'}
          </StatePanel>
        ) : !data ? (
          <LoadingSkeleton />
        ) : (
          <div className={cn('transition-opacity duration-200', isPlaceholderData && 'opacity-60')}>
            {activeTab === 'overview' && (
              <FuelOverviewTab
                data={data}
                derivedStats={derivedStats}
                allRequests={filteredAllRequests}
                onSelectVehicle={(vin) => setSelectedVin(vin)}
                onOpenRequests={() => setActiveTab('requests')}
                onOpenExceptions={() => setActiveTab('exceptions')}
                onOpenMethodology={() => setShowMethodologyModal(true)}
              />
            )}

            {activeTab === 'requests' && (
              <FuelRequestsTab
                data={data}
                allRequests={filteredAllRequests}
                onViewDetails={(req) => setSelectedRequestDetails(req)}
              />
            )}

            {activeTab === 'mileage' && (
              <VehicleMileageTab
                data={data}
                derivedStats={derivedStats}
                onSelectVehicle={(vin) => setSelectedVin(vin)}
                onOpenMethodology={() => setShowMethodologyModal(true)}
              />
            )}

            {activeTab === 'usage' && <FuelConsumptionTab data={data} derivedStats={derivedStats} />}

            {activeTab === 'exceptions' && (
              <FuelExceptionsTab
                data={data}
                onSelectVehicle={(vin) => setSelectedVin(vin)}
                onViewRequest={(reqNo) => {
                  const match = allRequests.find((r) => r.requestNumber === reqNo)
                  if (match) setSelectedRequestDetails(match)
                }}
              />
            )}

            {activeTab === 'reports' && <FuelReportsTab data={data} derivedStats={derivedStats} />}
          </div>
        )}

        {/* =========================================================================
         * VEHICLE PROFILE DRAWER / MODAL
         * ========================================================================= */}
        <VehicleProfileDrawer
          vehicle={activeVehicle}
          isOpen={Boolean(activeVehicle)}
          onClose={() => setSelectedVin(null)}
          onOpenMethodology={() => setShowMethodologyModal(true)}
        />

        {/* =========================================================================
         * METHODOLOGY EXPLAINER MODAL
         * ========================================================================= */}
        <Dialog open={showMethodologyModal} onOpenChange={setShowMethodologyModal}>
          <DialogContent className="max-w-lg rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <HelpCircle className="h-5 w-5 text-[var(--dashboard-primary)]" />
                How Mileage is Calculated
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                True full-tank to full-tank measurement methodology
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4 text-sm text-slate-700">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-900">Full-Tank to Full-Tank Rule</p>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  To eliminate estimation bias, mileage is computed strictly using the distance between consecutive
                  qualifying odometer readings divided by the fuel added after the initial baseline fill:
                </p>
                <div className="mt-3 rounded-lg bg-white p-3 font-mono text-xs text-slate-800 border border-slate-200">
                  km/L = (Odometer_Latest − Odometer_Initial) ÷ Total_Litres_Added
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-600">
                <p className="flex items-start gap-2">
                  <span className="font-bold text-slate-800">• Requires ≥ 2 Fills:</span> A car with only one fill
                  shows &ldquo;Awaiting 2nd Fill&rdquo; because fuel consumed cannot be measured without a second
                  odometer marker.
                </p>
                <p className="flex items-start gap-2">
                  <span className="font-bold text-slate-800">• VIN Keyed:</span> Trade plates are often shared across
                  multiple demo cars. All calculations are strictly isolated by unique 17-character VIN.
                </p>
                <p className="flex items-start gap-2">
                  <span className="font-bold text-slate-800">• Honest Reporting:</span> No estimated or fabricated
                  numbers are displayed when data is incomplete.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => setShowMethodologyModal(false)}
                className="rounded-xl bg-[var(--dashboard-primary)] text-white hover:opacity-90 font-semibold"
              >
                Got it
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* =========================================================================
         * REQUEST DETAIL MODAL
         * ========================================================================= */}
        {selectedRequestDetails && (
          <Dialog open={Boolean(selectedRequestDetails)} onOpenChange={() => setSelectedRequestDetails(null)}>
            <DialogContent className="max-w-md rounded-2xl p-6">
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between text-base font-bold text-slate-900">
                  <span>Fuel Request #{selectedRequestDetails.requestNumber}</span>
                  <StatusBadge status={selectedRequestDetails.status} label={selectedRequestDetails.statusLabel} />
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Submitted for {selectedRequestDetails.purposeLabel} on {formatYmd(selectedRequestDetails.date)}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-3 divide-y divide-slate-100 text-xs">
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">Vehicle / Asset:</span>
                  <span className="font-semibold text-slate-900">{selectedRequestDetails.vehicleLabel}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">Branch:</span>
                  <span className="font-semibold text-slate-900">{selectedRequestDetails.branchLabel}</span>
                </div>
                <div className="flex justify-between py-2 items-center">
                  <span className="text-slate-500">Fuel Type:</span>
                  <EnergyTypeBadge energyType={selectedRequestDetails.energyType} />
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">Fuel Quantity:</span>
                  <span className="font-bold text-slate-900">{formatLitres(selectedRequestDetails.litres)} Litres</span>
                </div>
                {selectedRequestDetails.odometerKm !== undefined && selectedRequestDetails.odometerKm !== null && (
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Odometer Reading:</span>
                    <span className="font-semibold text-slate-900">{formatKm(selectedRequestDetails.odometerKm)} km</span>
                  </div>
                )}
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">Estimated Cost:</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(selectedRequestDetails.litres * ESTIMATED_FUEL_PRICE_INR)}
                  </span>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => setSelectedRequestDetails(null)}
                  className="rounded-xl text-xs font-semibold"
                >
                  Close
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* =========================================================================
         * DATE RANGE & CALENDAR MODAL
         * ========================================================================= */}
        <Dialog open={showDateModal} onOpenChange={setShowDateModal}>
          <DialogContent className="max-w-2xl rounded-2xl p-6 sm:p-7">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-[var(--dashboard-primary)] shadow-2xs border border-slate-200">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-slate-900">
                    Select Date Range & Period
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500">
                    Choose a period preset or pick custom start and end dates (up to 366 days)
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-4 grid gap-5 sm:grid-cols-12">
              {/* Presets Grid */}
              <div className="sm:col-span-5 space-y-1.5 border-b sm:border-b-0 sm:border-r border-slate-100 pb-4 sm:pb-0 sm:pr-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Quick Presets
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-1 gap-1.5 mt-2">
                  {PERIOD_OPTIONS.map((opt) => {
                    const isSelected = tempPreset === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleSelectTempPreset(opt.value)}
                        className={cn(
                          'flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition-all text-left',
                          isSelected
                            ? 'bg-[var(--dashboard-primary)] text-white shadow-xs font-bold'
                            : 'bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                        )}
                      >
                        <span>{opt.label}</span>
                        {isSelected && <Check className="h-3.5 w-3.5" />}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Custom Range & Live Date Summary */}
              <div className="sm:col-span-7 space-y-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Custom Period Dates
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">From Date</Label>
                    <Input
                      type="date"
                      value={tempFrom}
                      max={tempTo || today}
                      onChange={(e) => {
                        setTempPreset('custom')
                        setTempFrom(e.target.value)
                        setTempError(null)
                      }}
                      className="h-9 rounded-xl border-slate-200 text-xs font-semibold tabular-nums shadow-2xs"
                    />
                    <p className="text-[11px] text-slate-500 font-medium">
                      {isValidYmd(tempFrom) ? formatYmd(tempFrom) : 'Select start'}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">To Date</Label>
                    <Input
                      type="date"
                      value={tempTo}
                      min={tempFrom || undefined}
                      max={today}
                      onChange={(e) => {
                        setTempPreset('custom')
                        setTempTo(e.target.value)
                        setTempError(null)
                      }}
                      className="h-9 rounded-xl border-slate-200 text-xs font-semibold tabular-nums shadow-2xs"
                    />
                    <p className="text-[11px] text-slate-500 font-medium">
                      {isValidYmd(tempTo) ? formatYmd(tempTo) : 'Select end'}
                    </p>
                  </div>
                </div>

                {/* Range Summary Card */}
                <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600">Selected Duration:</span>
                    <span className="rounded-md bg-white px-2 py-0.5 font-bold text-slate-900 border border-slate-200 shadow-2xs">
                      {tempRangeDays} {tempRangeDays === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600">Active Window:</span>
                    <span className="font-bold text-[var(--dashboard-primary)]">
                      {tempFrom && tempTo ? formatRange(tempFrom, tempTo) : 'Incomplete range'}
                    </span>
                  </div>
                </div>

                {/* Error Banner if any */}
                {tempError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>{tempError}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetDateModalToDefault}
                className="gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset to Default (This Month)</span>
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDateModal(false)}
                  className="rounded-xl text-xs font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyDateModal}
                  className="gap-1.5 rounded-xl bg-[var(--dashboard-primary)] text-white hover:opacity-90 text-xs font-bold shadow-xs px-4"
                >
                  <Check className="h-4 w-4" />
                  <span>Apply Range</span>
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  )
}

/* =================================================================================================
 * TAB 1: OVERVIEW TAB (THE EXECUTIVE PULSE)
 * =============================================================================================== */

function FuelOverviewTab({
  data,
  derivedStats,
  allRequests,
  onSelectVehicle,
  onOpenRequests,
  onOpenExceptions,
  onOpenMethodology,
}: {
  data: FuelManagementResponse
  derivedStats: { fuelSpend: number; costPerKm: number; fleetAvgMileage: number | null; attentionCount: number }
  allRequests: any[]
  onSelectVehicle: (vin: string) => void
  onOpenRequests: () => void
  onOpenExceptions: () => void
  onOpenMethodology: () => void
}) {
  const [trendMetric, setTrendMetric] = useState<'fuel' | 'spend' | 'distance' | 'mileage'>('fuel')

  const topChecks = useMemo(() => {
    return data.checks.slice(0, 4)
  }, [data.checks])

  const topDemoCars = useMemo(() => {
    return data.demoCars.slice(0, 4)
  }, [data.demoCars])

  const recentActivity = useMemo(() => {
    return allRequests.slice(0, 6)
  }, [allRequests])

  return (
    <div className="space-y-4">
      {/* 1. TOP 5 KPI SECTION */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* KPI 1: Fuel Used */}
        <div className="rounded-2xl border-t-4 border-t-teal-500 border-x border-b border-slate-200/80 bg-white p-4.5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-slate-300">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-teal-800">
              Fuel Used
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 text-teal-700 border border-teal-100 shadow-2xs">
              <Fuel className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums text-slate-900 tracking-tight">
              {formatLitres(data.kpis.approvedLitres)}
            </span>
            <span className="text-xs font-bold text-teal-700">Litres</span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="inline-flex items-center rounded-md bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800 border border-teal-200/70">
              {formatCount(data.kpis.approvedRequests)} approved {plural(data.kpis.approvedRequests, 'fill', 'fills')}
            </span>
          </div>
        </div>

        {/* KPI 2: Fuel Spend */}
        <div className="rounded-2xl border-t-4 border-t-indigo-500 border-x border-b border-slate-200/80 bg-white p-4.5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-slate-300">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-800">
              Fuel Spend
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100 shadow-2xs">
              <IndianRupee className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline gap-1">
            <span className="text-2xl font-black tabular-nums text-slate-900 tracking-tight">
              {formatCurrency(derivedStats.fuelSpend)}
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 border border-indigo-200/70">
              {derivedStats.costPerKm > 0 ? `₹${derivedStats.costPerKm.toFixed(2)} / km` : 'Ref @ ₹95/L'}
            </span>
          </div>
        </div>

        {/* KPI 3: Distance Covered */}
        <div className="rounded-2xl border-t-4 border-t-sky-500 border-x border-b border-slate-200/80 bg-white p-4.5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-slate-300">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800">
              Distance Covered
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-700 border border-sky-100 shadow-2xs">
              <Gauge className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums text-slate-900 tracking-tight">
              {formatKm(data.kpis.demoDriveKm)}
            </span>
            <span className="text-xs font-bold text-sky-700">km</span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 border border-sky-200/70">
              {formatCount(data.kpis.demoDrives)} demo {plural(data.kpis.demoDrives, 'drive', 'drives')}
            </span>
          </div>
        </div>

        {/* KPI 4: Average Mileage */}
        <div className="rounded-2xl border-t-4 border-t-emerald-500 border-x border-b border-slate-200/80 bg-white p-4.5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-slate-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Avg Mileage
              </span>
              <button
                type="button"
                onClick={onOpenMethodology}
                className="text-emerald-600 hover:text-emerald-800 transition-colors"
                title="How mileage is calculated"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 shadow-2xs">
              <Gauge className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums text-slate-900 tracking-tight">
              {derivedStats.fleetAvgMileage !== null ? formatKm(derivedStats.fleetAvgMileage) : '—'}
            </span>
            <span className="text-xs font-bold text-emerald-700">km/L</span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200/70">
              {derivedStats.fleetAvgMileage !== null ? 'Full-tank verified' : 'Awaiting 2nd fills'}
            </span>
          </div>
        </div>

        {/* KPI 5: Needs Attention */}
        <div
          onClick={onOpenExceptions}
          className={cn(
            'rounded-2xl border-t-4 border-x border-b p-4.5 shadow-xs transition-all duration-200 cursor-pointer hover:shadow-md',
            derivedStats.attentionCount > 0
              ? 'border-t-amber-500 border-slate-200/80 bg-white'
              : 'border-t-slate-400 border-slate-200/80 bg-white hover:border-slate-300',
          )}
        >
          <div className="flex items-center justify-between">
            <span className={cn('text-[11px] font-bold uppercase tracking-wider', derivedStats.attentionCount > 0 ? 'text-amber-800' : 'text-slate-600')}>
              Needs Action
            </span>
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-xl shadow-2xs',
                derivedStats.attentionCount > 0
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-slate-50 text-slate-500 border border-slate-200',
              )}
            >
              <TriangleAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className={cn('text-2xl font-black tabular-nums tracking-tight', derivedStats.attentionCount > 0 ? 'text-amber-950' : 'text-slate-900')}>
              {derivedStats.attentionCount}
            </span>
            <span className={cn('text-xs font-bold', derivedStats.attentionCount > 0 ? 'text-amber-800' : 'text-slate-500')}>issues</span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border',
                derivedStats.attentionCount > 0
                  ? 'bg-amber-50 text-amber-900 border-amber-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200/60',
              )}
            >
              {derivedStats.attentionCount > 0 ? (
                <>
                  <span>Review issues</span>
                  <ArrowRight className="h-3 w-3" />
                </>
              ) : (
                'All records clear'
              )}
            </span>
          </div>
        </div>
      </div>

      {/* 2. MULTI-FUEL & ENERGY INTELLIGENCE (PETROL vs DIESEL vs CNG vs EV) */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-xs space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-700 border border-amber-200/80 shadow-2xs">
              <Fuel className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Fuel & Energy Intelligence</span>
                <Badge variant="outline" className="text-[10px] font-bold bg-amber-50 text-amber-900 border-amber-200">
                  Petrol vs. Diesel vs. EV
                </Badge>
              </h2>
              <p className="text-xs text-slate-500">Multi-energy volume, fill metrics, purpose matrix, and branch split</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Total Monitored:</span>
            <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
              {formatLitres(data.kpis.approvedLitres)} L
            </span>
          </div>
        </div>

        {/* Petrol vs Diesel vs Others Comparison Cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Petrol Card */}
          {(() => {
            const petrol = data.byEnergyType?.find((e) => e.energyType === 'PETROL')
            const totalL = petrol?.totalLitres || 0
            const pct = petrol?.percentage || 0
            return (
              <div className="rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/60 to-amber-50/20 p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-500" /> Petrol
                  </span>
                  <span className="rounded-md bg-amber-100/80 px-2 py-0.5 text-[11px] font-black text-amber-950 border border-amber-200">
                    {pct.toFixed(1)}% Share
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-xl font-black text-slate-900 tabular-nums">
                    {formatLitres(totalL)}
                  </span>
                  <span className="text-xs font-bold text-amber-800">Litres</span>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-1.5 pt-2 border-t border-amber-200/50 text-[11px]">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Vouchers</span>
                    <span className="font-bold text-slate-800">{petrol?.totalRequests || 0} reqs</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Avg Fill</span>
                    <span className="font-bold text-slate-800">{petrol?.avgFillSize || 0} L/fill</span>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Diesel Card */}
          {(() => {
            const diesel = data.byEnergyType?.find((e) => e.energyType === 'DIESEL')
            const totalL = diesel?.totalLitres || 0
            const pct = diesel?.percentage || 0
            return (
              <div className="rounded-xl border border-blue-200/80 bg-gradient-to-br from-blue-50/60 to-blue-50/20 p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-600" /> Diesel
                  </span>
                  <span className="rounded-md bg-blue-100/80 px-2 py-0.5 text-[11px] font-black text-blue-900 border border-blue-200">
                    {pct.toFixed(1)}% Share
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-xl font-black text-slate-900 tabular-nums">
                    {formatLitres(totalL)}
                  </span>
                  <span className="text-xs font-bold text-blue-700">Litres</span>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-1.5 pt-2 border-t border-blue-200/50 text-[11px]">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Vouchers</span>
                    <span className="font-bold text-slate-800">{diesel?.totalRequests || 0} reqs</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Avg Fill</span>
                    <span className="font-bold text-slate-800">{diesel?.avgFillSize || 0} L/fill</span>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* CNG & EV Status */}
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> CNG & EV
              </span>
              <span className="rounded-md bg-slate-200/60 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                Eco Fuels
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-xl font-black text-slate-900 tabular-nums">
                0
              </span>
              <span className="text-xs font-bold text-slate-500">kg / kWh</span>
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/60 text-[11px] text-slate-500 flex items-center justify-between">
              <span>Ready for EV / Hybrids</span>
              <span className="font-semibold text-slate-700">0 requests</span>
            </div>
          </div>

          {/* Genset / Stationary Diesel Card */}
          {(() => {
            const gensetRow = data.purposeEnergyMatrix?.find((m) => m.purpose === 'GENSET')
            const gensetL = gensetRow?.totalLitres || 0
            return (
              <div className="rounded-xl border border-slate-300/80 bg-gradient-to-br from-slate-100/80 to-slate-50/30 p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-slate-600" /> Genset Generator
                  </span>
                  <span className="rounded-md bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold text-slate-800 border border-slate-300">
                    Stationary Diesel
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-xl font-black text-slate-900 tabular-nums">
                    {formatLitres(gensetL)}
                  </span>
                  <span className="text-xs font-bold text-slate-700">Litres</span>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600 flex items-center justify-between">
                  <span>Showroom Backup Power</span>
                  <span className="font-bold text-slate-800">{gensetRow?.requestsCount || 0} fill</span>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Proportional Fuel Mix Visual Progress Bar */}
        {(() => {
          const petrol = data.byEnergyType?.find((e) => e.energyType === 'PETROL')
          const diesel = data.byEnergyType?.find((e) => e.energyType === 'DIESEL')
          const petrolPct = petrol?.percentage || 0
          const dieselPct = diesel?.percentage || 0
          return (
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 flex items-center gap-2">
                  <span>Fleet Fuel Mix Ratio</span>
                  <span className="font-normal text-slate-500">(Overall Period Volume)</span>
                </span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5 font-bold text-amber-900">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    Petrol: {petrolPct.toFixed(1)}% ({formatLitres(petrol?.totalLitres || 0)} L)
                  </span>
                  <span className="flex items-center gap-1.5 font-bold text-blue-900">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                    Diesel: {dieselPct.toFixed(1)}% ({formatLitres(diesel?.totalLitres || 0)} L)
                  </span>
                </div>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200/80 flex">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${petrolPct}%` }}
                  title={`Petrol: ${petrolPct.toFixed(1)}%`}
                />
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${dieselPct}%` }}
                  title={`Diesel: ${dieselPct.toFixed(1)}%`}
                />
              </div>
            </div>
          )
        })()}

        {/* Purpose vs Multi-Fuel Matrix Table */}
        <div className="rounded-xl border border-slate-200/80 overflow-hidden">
          <div className="bg-slate-50/90 px-3.5 py-2.5 border-b border-slate-200/80 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-slate-500" />
              Operational Purpose vs. Fuel Type Breakdown Matrix
            </span>
            <span className="text-[11px] text-slate-500 font-medium">Cross-tabulated volume analysis</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/50 text-[11px] font-bold text-slate-600 border-b border-slate-200/60 uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 pl-3.5">Purpose / Allocation</th>
                  <th className="py-2.5 px-3 text-right text-amber-900">Petrol (L)</th>
                  <th className="py-2.5 px-3 text-right text-blue-800">Diesel (L)</th>
                  <th className="py-2.5 px-3 text-right">Total Volume</th>
                  <th className="py-2.5 px-3 text-right">% Share</th>
                  <th className="py-2.5 pr-3.5 text-right">Requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data.purposeEnergyMatrix || []).map((row) => {
                  const grandTotal = data.kpis.approvedLitres || 1
                  const sharePct = (row.totalLitres / grandTotal) * 100
                  return (
                    <tr key={row.purpose} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2.5 pl-3.5 font-bold text-slate-900 whitespace-nowrap">
                        {row.purposeLabel}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                        {row.petrolLitres > 0 ? `${formatLitres(row.petrolLitres)} L` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700">
                        {row.dieselLitres > 0 ? `${formatLitres(row.dieselLitres)} L` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                        {formatLitres(row.totalLitres)} L
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 font-semibold">
                        {sharePct.toFixed(1)}%
                      </td>
                      <td className="py-2.5 pr-3.5 text-right font-mono text-slate-700">
                        {row.requestsCount}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Branch-wise Multi-Fuel Split (Jammu vs Udhampur) */}
        {data.byBranchEnergy && data.byBranchEnergy.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 pt-1">
            {data.byBranchEnergy.map((b) => (
              <div key={b.branch} className="rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-slate-500" />
                    {b.branchLabel} Fuel Profile
                  </span>
                  <span className="font-mono text-xs font-black text-slate-900">
                    {formatLitres(b.totalLitres)} L Total
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div className="rounded-lg bg-amber-50/60 border border-amber-200/60 p-2">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Petrol Volume</span>
                    <span className="font-bold text-amber-900">{formatLitres(b.petrolLitres)} L</span>
                    <span className="text-[10px] text-amber-700 ml-1 font-semibold">({b.petrolPct}%)</span>
                  </div>
                  <div className="rounded-lg bg-blue-50/60 border border-blue-200/60 p-2">
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Diesel Volume</span>
                    <span className="font-bold text-blue-900">{formatLitres(b.dieselLitres)} L</span>
                    <span className="text-[10px] text-blue-700 ml-1 font-semibold">({b.dieselPct}%)</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. ATTENTION REQUIRED COMPACT TABLE */}
      {topChecks.length > 0 && (
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-amber-200/60 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 text-amber-800 border border-amber-200/80 shadow-2xs">
                <TriangleAlert className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-amber-950">
                Attention Required ({data.checks.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={onOpenExceptions}
              className="text-xs font-bold text-amber-900 hover:text-amber-950 flex items-center gap-1 transition-colors"
            >
              <span>View all issues</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          <div className="mt-2.5 divide-y divide-amber-200/40">
            {topChecks.map((chk, idx) => (
              <div key={idx} className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs">
                <div className="flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className={cn(
                      'rounded-md text-[10px] font-semibold px-2 py-0.5',
                      chk.severity === 'warning'
                        ? 'border-amber-300 bg-amber-100 text-amber-950'
                        : 'border-slate-200 bg-slate-100 text-slate-700',
                    )}
                  >
                    {chk.severity === 'warning' ? 'Issue' : 'Note'}
                  </Badge>
                  <span className="font-semibold text-slate-900">{CHECK_TITLE[chk.kind] || chk.kind}</span>
                  <span className="text-slate-600">{chk.message}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-medium text-slate-600 bg-white border border-amber-200/60 px-2 py-0.5 rounded-md whitespace-nowrap">
                    {chk.requestNumber}
                  </span>
                  {chk.vin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSelectVehicle(chk.vin!)}
                      className="h-7 rounded-lg text-[11px] font-semibold border-amber-200 bg-white hover:bg-amber-50 text-amber-900"
                    >
                      View Vehicle
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. COMPACT TREND & ANALYTICAL AREA */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Fuel & Efficiency Summary</h2>
            <p className="text-xs text-slate-500">Period performance metrics across fleet</p>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200/80 bg-slate-100/80 p-1">
            {[
              { id: 'fuel' as const, label: 'Fuel (L)' },
              { id: 'spend' as const, label: 'Cost (₹)' },
              { id: 'distance' as const, label: 'Distance (km)' },
              { id: 'mileage' as const, label: 'Avg Mileage' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTrendMetric(t.id)}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-semibold transition-all',
                  trendMetric === t.id
                    ? 'bg-white text-slate-900 font-bold shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-teal-200/70 bg-teal-50/40 p-3.5 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-teal-800">Approved Volume</span>
            <p className="mt-1 text-lg font-black text-slate-900">{formatLitres(data.kpis.approvedLitres)} L</p>
            <p className="mt-0.5 text-[11px] text-teal-700 font-medium">Across {data.kpis.approvedRequests} approved vouchers</p>
          </div>
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-3.5 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Awaiting Decision</span>
            <p className="mt-1 text-lg font-black text-amber-900">{data.kpis.awaiting.total} requests</p>
            <p className="mt-0.5 text-[11px] text-amber-700 font-medium">Pending CEO / Accounts</p>
          </div>
          <div className="rounded-xl border border-sky-200/70 bg-sky-50/40 p-3.5 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800">GPS Verified Trip Share</span>
            <p className="mt-1 text-lg font-black text-slate-900">
              {data.kpis.demoDriveKm > 0
                ? `${((data.kpis.gpsVerifiedKm / data.kpis.demoDriveKm) * 100).toFixed(0)}%`
                : '0%'}
            </p>
            <p className="mt-0.5 text-[11px] text-sky-700 font-medium">{formatKm(data.kpis.gpsVerifiedKm)} km tracked</p>
          </div>
          <div className="rounded-xl border border-purple-200/70 bg-purple-50/40 p-3.5 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-800">Demo Fleet Monitored</span>
            <p className="mt-1 text-lg font-black text-slate-900">{data.demoCars.length} cars</p>
            <p className="mt-0.5 text-[11px] text-purple-700 font-medium">With active drives or fills</p>
          </div>
        </div>
      </div>

      {/* 4. TWO-COLUMN SPLIT: WHERE FUEL IS GOING vs VEHICLE EFFICIENCY PREVIEW */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Where Fuel Is Going */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Where Fuel Is Going</h2>
              <p className="text-xs text-slate-500">Volume distribution by operational purpose</p>
            </div>
            <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800">
              Total: {formatLitres(data.kpis.approvedLitres)} L
            </span>
          </div>

          <div className="mt-4 space-y-3.5">
            {data.byPurpose.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">No fuel records in this period.</p>
            ) : (
              data.byPurpose.map((p) => {
                const pct =
                  data.kpis.approvedLitres > 0 ? (p.approvedLitres / data.kpis.approvedLitres) * 100 : 0
                const conf = getPurposeConfig(p.purpose)
                return (
                  <div key={p.purpose} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2.5 w-2.5 rounded-full', conf.dot)} />
                        <span className="font-bold text-slate-800">{p.label}</span>
                      </div>
                      <span className="tabular-nums text-slate-600">
                        <strong className="font-bold text-slate-900">{formatLitres(p.approvedLitres)} L</strong>{' '}
                        · <span className="font-semibold text-slate-700">{pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 p-0.5">
                      <div
                        className={cn('h-full rounded-full transition-all duration-300 shadow-2xs', conf.bar)}
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Vehicle Efficiency Highlights */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Vehicle Efficiency</h2>
              <p className="text-xs text-slate-500">Demo fleet consumption & mileage status</p>
            </div>
            <button
              type="button"
              onClick={() => onSelectVehicle(data.demoCars[0]?.vin || '')}
              className="text-xs font-bold text-[var(--dashboard-primary)] hover:opacity-80 transition-opacity"
            >
              Fleet details →
            </button>
          </div>

          <div className="mt-3 divide-y divide-slate-100">
            {topDemoCars.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">No active demo cars in this period.</p>
            ) : (
              topDemoCars.map((car) => (
                <div
                  key={car.vin}
                  onClick={() => onSelectVehicle(car.vin)}
                  className="group flex cursor-pointer items-center justify-between py-2.5 text-xs transition-colors hover:bg-slate-50/80 -mx-2 px-2.5 rounded-xl border border-transparent hover:border-slate-200"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-700 group-hover:bg-purple-100 transition-colors shadow-2xs border border-purple-100">
                      <Car className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">{car.registrationNumber || 'Trade Plate'}</p>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-700">{car.model || 'Demo Car'}</span>
                        <span>·</span>
                        <BranchBadge branch={car.branchLabel} />
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <MileageBadge value={car.kmPerLitre?.value} />
                    <p className="text-[10px] font-semibold text-slate-500 mt-1">{formatLitres(car.approvedLitres)} L used</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 5. RECENT FUEL ACTIVITY (ALIGNED RESPONSIVE TABLE) */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Recent Fuel Activity</h2>
            <p className="text-xs text-slate-500">Latest transactions and approval requests</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenRequests}
            className="h-8 gap-1.5 rounded-xl text-xs font-semibold"
          >
            <span>View all fuel requests</span>
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="pb-2 pl-2">Request #</th>
                <th className="pb-2 px-3">Date</th>
                <th className="pb-2 px-3">Purpose</th>
                <th className="pb-2 px-3">Vehicle / Description</th>
                <th className="pb-2 px-3">Branch</th>
                <th className="pb-2 px-3 text-right">Volume</th>
                <th className="pb-2 pr-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentActivity.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 pl-2 whitespace-nowrap">
                    <span className="inline-block font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200/80">
                      {req.requestNumber}
                    </span>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-slate-600 font-medium">
                    {formatYmd(req.date, false)}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <PurposeBadge purpose={req.purpose} label={req.purposeLabel} />
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap font-bold text-slate-900">
                    {req.vehicleLabel}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <BranchBadge branch={req.branchLabel} />
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-right font-black tabular-nums text-slate-900">
                    {formatLitres(req.litres)} L
                  </td>
                  <td className="py-3 pr-2 whitespace-nowrap text-right">
                    <StatusBadge status={req.status} label={req.statusLabel} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* =================================================================================================
 * TAB 2: FUEL REQUESTS TAB (OPERATIONAL WORKFLOW)
 * =============================================================================================== */

function FuelRequestsTab({
  data,
  allRequests,
  onViewDetails,
}: {
  data: FuelManagementResponse
  allRequests: any[]
  onViewDetails: (req: any) => void
}) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [purposeFilter, setPurposeFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredRequests = useMemo(() => {
    return allRequests.filter((req) => {
      // Status filter
      if (statusFilter === 'pending' && req.status === 'approved') return false
      if (statusFilter === 'approved' && req.status !== 'approved') return false
      if (statusFilter === 'rejected' && req.status !== 'rejected') return false

      // Purpose filter
      if (purposeFilter !== 'all' && req.purpose !== purposeFilter) return false

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const match =
          req.requestNumber.toLowerCase().includes(q) ||
          req.vehicleLabel.toLowerCase().includes(q) ||
          req.purposeLabel.toLowerCase().includes(q) ||
          req.branchLabel.toLowerCase().includes(q)
        if (!match) return false
      }

      return true
    })
  }, [allRequests, statusFilter, purposeFilter, searchQuery])

  const pendingCount = allRequests.filter((r) => r.status !== 'approved' && r.status !== 'rejected').length

  return (
    <div className="space-y-4">
      {/* Workflow Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-bold text-slate-900">Fuel Requests Ledger</h2>
            {pendingCount > 0 ? (
              <Badge className="bg-amber-500 text-white hover:bg-amber-600 text-xs font-bold px-2.5 py-0.5 shadow-2xs">
                {pendingCount} Awaiting Approval
              </Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs font-bold px-2.5 py-0.5">
                All Cleared
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Manage, audit and process fuel requisition vouchers across all departments
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/fuel-approvals"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--dashboard-primary)] px-3 text-xs font-semibold text-white shadow-xs hover:opacity-90 transition-opacity"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Open Approvals Desk</span>
          </a>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Tabs */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
            {[
              { id: 'all' as const, label: 'All Requests' },
              { id: 'pending' as const, label: `Pending (${pendingCount})` },
              { id: 'approved' as const, label: 'Approved' },
              { id: 'rejected' as const, label: 'Rejected' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                  statusFilter === tab.id
                    ? 'bg-white text-[var(--dashboard-primary)] font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Purpose Filter */}
          <select
            value={purposeFilter}
            onChange={(e) => setPurposeFilter(e.target.value)}
            className="h-8 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
          >
            <option value="all">All Purposes</option>
            {data.byPurpose.map((p) => (
              <option key={p.purpose} value={p.purpose}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search request #, vehicle, branch…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 rounded-xl border-slate-200 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Requests Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Request #</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Vehicle / Asset</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3 text-center">Fuel Type</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3 text-right">Odometer</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    No requests found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 font-medium">{formatYmd(req.date)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/60">
                        {req.requestNumber}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <PurposeBadge purpose={req.purpose} label={req.purposeLabel} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900 max-w-[200px] truncate">
                      {req.vehicleLabel}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <BranchBadge branch={req.branchLabel} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <EnergyTypeBadge energyType={req.energyType} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-black tabular-nums text-teal-700">
                      {formatLitres(req.litres)} L
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600 font-medium">
                      {req.odometerKm !== undefined && req.odometerKm !== null ? `${formatKm(req.odometerKm)} km` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <StatusBadge status={req.status} label={req.statusLabel} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onViewDetails(req)}
                        className="h-7 rounded-lg px-2 text-xs font-semibold text-[var(--dashboard-primary)] hover:opacity-80"
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        Details
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* =================================================================================================
 * TAB 3: VEHICLE MILEAGE TAB (FLEET EFFICIENCY ENGINE)
 * =============================================================================================== */

function VehicleMileageTab({
  data,
  derivedStats,
  onSelectVehicle,
  onOpenMethodology,
}: {
  data: FuelManagementResponse
  derivedStats: { fleetAvgMileage: number | null }
  onSelectVehicle: (vin: string) => void
  onOpenMethodology: () => void
}) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredCars = useMemo(() => {
    return data.demoCars.filter((car) => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        car.vin.toLowerCase().includes(q) ||
        (car.registrationNumber || '').toLowerCase().includes(q) ||
        (car.model || '').toLowerCase().includes(q) ||
        car.branchLabel.toLowerCase().includes(q)
      )
    })
  }, [data.demoCars, searchQuery])

  return (
    <div className="space-y-4">
      {/* Fleet Efficiency Banner with Clean Tailored Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 text-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white">
                <Gauge className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-bold text-white tracking-wide">Fleet Mileage Intelligence</h2>
              <button
                type="button"
                onClick={onOpenMethodology}
                className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:bg-white/20 transition-colors"
              >
                <Info className="h-3 w-3 text-slate-300" />
                <span>Methodology</span>
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Verified odometer-based efficiency across {data.demoCars.length} demo fleet vehicles
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-right">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Fleet Average</span>
              <div className="flex items-baseline justify-end gap-1.5">
                <span className="text-2xl font-bold text-emerald-400 tracking-tight">
                  {derivedStats.fleetAvgMileage !== null ? formatKm(derivedStats.fleetAvgMileage) : '—'}
                </span>
                <span className="text-xs font-semibold text-slate-400">km/L</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Search Toolbar */}
      <div className="flex justify-between items-center rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xs">
        <p className="text-xs font-semibold text-slate-800">Demo Vehicles ({filteredCars.length})</p>
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search vehicle plate, model, VIN…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 rounded-xl border-slate-200 pl-8 text-xs font-medium"
          />
        </div>
      </div>

      {/* Vehicle Efficiency Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Model & Branch</th>
                <th className="px-4 py-3 text-right">Last Odometer</th>
                <th className="px-4 py-3 text-right">Drive Distance</th>
                <th className="px-4 py-3 text-right">Fuel Added</th>
                <th className="px-4 py-3 text-left">Mileage Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCars.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No demo vehicles found.
                  </td>
                </tr>
              ) : (
                filteredCars.map((car) => {
                  return (
                    <tr
                      key={car.vin}
                      onClick={() => onSelectVehicle(car.vin)}
                      className="cursor-pointer hover:bg-slate-50/60 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 shadow-2xs">
                            <Car className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900 block">{car.registrationNumber || 'Trade Plate'}</span>
                            <span className="font-mono text-[10px] text-slate-400">{vinTail(car.vin)}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-900 block">{car.model || 'Demo Car'}</span>
                        <BranchBadge branch={car.branchLabel} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-800 font-medium">
                        {car.lastFillOdometerKm !== null ? `${formatKm(car.lastFillOdometerKm)} km` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-800 font-medium">
                        {formatKm(car.driveKm)} km
                        <span className="block text-[10px] text-slate-400">{car.drives.length} drives</span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                        {formatLitres(car.approvedLitres)} L
                      </td>
                      <td className="px-4 py-3">
                        <MileageBadge value={car.kmPerLitre?.value} />
                        {!car.kmPerLitre && (
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            {car.kmPerLitreNote?.includes('backwards')
                              ? 'Odometer discrepancy'
                              : 'Requires another fuel fill with odometer'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectVehicle(car.vin)
                          }}
                          className="h-7 rounded-lg text-xs font-medium"
                        >
                          Profile
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* =================================================================================================
 * TAB 4: FUEL CONSUMPTION TAB (USAGE DEEP-DIVE)
 * =============================================================================================== */

function FuelConsumptionTab({
  data,
  derivedStats,
}: {
  data: FuelManagementResponse
  derivedStats: { fuelSpend: number }
}) {
  return (
    <div className="space-y-4">
      {/* Fuel Type Intelligence Cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Petrol */}
        {(() => {
          const petrol = data.byEnergyType?.find((e) => e.energyType === 'PETROL')
          const totalL = petrol?.totalLitres || 0
          const pct = petrol?.percentage || 0
          const spend = totalL * ESTIMATED_FUEL_PRICE_INR
          return (
            <div className="rounded-2xl border border-amber-200/90 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> Petrol Ledger
                </span>
                <span className="rounded-md bg-amber-100/80 px-2 py-0.5 text-[11px] font-black text-amber-950 border border-amber-200">
                  {pct.toFixed(1)}% Mix
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-900 tabular-nums">
                {formatLitres(totalL)} <span className="text-xs font-semibold text-slate-500">L</span>
              </p>
              <p className="text-xs font-bold text-amber-800">{formatCurrency(spend)} est.</p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                <span>{petrol?.totalRequests || 0} vouchers</span>
                <span className="font-semibold text-slate-700">{petrol?.avgFillSize || 0} L / fill</span>
              </div>
            </div>
          )
        })()}

        {/* Diesel */}
        {(() => {
          const diesel = data.byEnergyType?.find((e) => e.energyType === 'DIESEL')
          const totalL = diesel?.totalLitres || 0
          const pct = diesel?.percentage || 0
          const spend = totalL * ESTIMATED_FUEL_PRICE_INR
          return (
            <div className="rounded-2xl border border-blue-200/90 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-600" /> Diesel Ledger
                </span>
                <span className="rounded-md bg-blue-100/80 px-2 py-0.5 text-[11px] font-black text-blue-900 border border-blue-200">
                  {pct.toFixed(1)}% Mix
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-900 tabular-nums">
                {formatLitres(totalL)} <span className="text-xs font-semibold text-slate-500">L</span>
              </p>
              <p className="text-xs font-bold text-blue-700">{formatCurrency(spend)} est.</p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                <span>{diesel?.totalRequests || 0} vouchers</span>
                <span className="font-semibold text-slate-700">{diesel?.avgFillSize || 0} L / fill</span>
              </div>
            </div>
          )
        })()}

        {/* Stationary Genset Diesel */}
        {(() => {
          const gensetRow = data.purposeEnergyMatrix?.find((m) => m.purpose === 'GENSET')
          const gensetL = gensetRow?.totalLitres || 0
          const spend = gensetL * ESTIMATED_FUEL_PRICE_INR
          return (
            <div className="rounded-2xl border border-slate-300/80 bg-slate-50/50 p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-slate-600" /> Genset Generator
                </span>
                <span className="rounded-md bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold text-slate-700 border border-slate-300">
                  Stationary
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-900 tabular-nums">
                {formatLitres(gensetL)} <span className="text-xs font-semibold text-slate-500">L</span>
              </p>
              <p className="text-xs font-bold text-slate-700">{formatCurrency(spend)} est.</p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                <span>Showroom Backup</span>
                <span className="font-semibold text-slate-700">{gensetRow?.requestsCount || 0} fills</span>
              </div>
            </div>
          )
        })()}

        {/* Alternative Eco Fuels */}
        <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-violet-500" /> CNG & EV
            </span>
            <span className="rounded-md bg-slate-200/60 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              Clean Energy
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900 tabular-nums">
            0 <span className="text-xs font-semibold text-slate-500">kg / kWh</span>
          </p>
          <p className="text-xs font-medium text-slate-500">Future-ready analytics</p>
          <div className="mt-3 flex items-center justify-between border-t border-slate-200/60 pt-2 text-[11px] text-slate-500">
            <span>EV / Hybrid Fleet</span>
            <span className="font-semibold text-slate-700">0 vouchers</span>
          </div>
        </div>
      </div>

      {/* Purpose Allocation Matrix and Branch Split */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Purpose Allocation Card */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Purpose Allocation Ledger</h2>
              <p className="text-xs text-slate-500">Breakdown of litres and estimated cost across operational workflows</p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="pb-2">Purpose</th>
                  <th className="pb-2 text-right">Approved Fills</th>
                  <th className="pb-2 text-right">Litres</th>
                  <th className="pb-2 text-right">Share</th>
                  <th className="pb-2 text-right">Estimated Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byPurpose.map((p) => {
                  const pct =
                    data.kpis.approvedLitres > 0 ? (p.approvedLitres / data.kpis.approvedLitres) * 100 : 0
                  const cost = p.approvedLitres * ESTIMATED_FUEL_PRICE_INR
                  return (
                    <tr key={p.purpose} className="py-2.5">
                      <td className="py-2.5">
                        <PurposeBadge purpose={p.purpose} label={p.label} />
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-slate-600 font-medium">{p.approvedRequests}</td>
                      <td className="py-2.5 text-right font-bold tabular-nums text-slate-900">
                        {formatLitres(p.approvedLitres)} L
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-slate-700 font-semibold">{pct.toFixed(1)}%</td>
                      <td className="py-2.5 text-right font-bold tabular-nums text-slate-900">
                        {formatCurrency(cost)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Branch Multi-Fuel Distribution Card */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900">Branch Multi-Fuel Split</h2>
          <p className="text-xs text-slate-500">Distribution across active dealerships</p>

          <div className="mt-4 space-y-3">
            {data.byBranchEnergy?.map((b) => (
              <div key={b.branch} className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">{b.branchLabel}</span>
                  <BranchBadge branch={b.branch} />
                </div>
                <p className="mt-1.5 text-xl font-bold text-slate-900">
                  {formatLitres(b.totalLitres)} <span className="text-xs font-normal text-slate-500">L</span>
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-200/60 pt-2 text-[11px]">
                  <div>
                    <span className="text-amber-800 font-semibold flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-amber-500" /> Petrol: {formatLitres(b.petrolLitres)} L
                    </span>
                    <span className="text-[10px] text-slate-400">({b.petrolPct.toFixed(1)}%)</span>
                  </div>
                  <div>
                    <span className="text-blue-700 font-semibold flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-blue-600" /> Diesel: {formatLitres(b.dieselLitres)} L
                    </span>
                    <span className="text-[10px] text-slate-400">({b.dieselPct.toFixed(1)}%)</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Purpose vs Multi-Fuel Matrix */}
      {data.purposeEnergyMatrix && data.purposeEnergyMatrix.length > 0 && (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-slate-600" />
                Purpose × Fuel Type Volume Matrix
              </h2>
              <p className="text-xs text-slate-500">Deep-dive matrix showing exact Petrol and Diesel consumption across all operational purposes</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold text-slate-700">
                <tr>
                  <th className="px-3 py-2.5">Operational Purpose</th>
                  <th className="px-3 py-2.5 text-right text-amber-900">Petrol (L)</th>
                  <th className="px-3 py-2.5 text-right text-blue-800">Diesel (L)</th>
                  <th className="px-3 py-2.5 text-right text-slate-600">Other (L)</th>
                  <th className="px-3 py-2.5 text-right text-slate-900 font-black">Total (L)</th>
                  <th className="px-3 py-2.5 text-right">Vouchers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.purposeEnergyMatrix.map((row) => (
                  <tr key={row.purpose} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2.5">
                      <PurposeBadge purpose={row.purpose} label={row.purposeLabel} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-amber-800">
                      {row.petrolLitres > 0 ? `${formatLitres(row.petrolLitres)} L` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-blue-700">
                      {row.dieselLitres > 0 ? `${formatLitres(row.dieselLitres)} L` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-400">
                      {row.cngLitres + row.evKwh > 0 ? `${formatLitres(row.cngLitres + row.evKwh)}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-black tabular-nums text-slate-900">
                      {formatLitres(row.totalLitres)} L
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 font-medium">
                      {row.requestsCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* =================================================================================================
 * TAB 5: EXCEPTIONS TAB (ATTENTION REQUIRED & AUDIT)
 * =============================================================================================== */

function FuelExceptionsTab({
  data,
  onSelectVehicle,
  onViewRequest,
}: {
  data: FuelManagementResponse
  onSelectVehicle: (vin: string) => void
  onViewRequest: (reqNo: string) => void
}) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'data_quality' | 'efficiency' | 'workflow'>('all')

  const categorizedChecks = useMemo(() => {
    return data.checks.filter((chk) => {
      if (categoryFilter === 'all') return true
      const cat = CHECK_CATEGORY[chk.kind] || 'data_quality'
      return cat === categoryFilter
    })
  }, [data.checks, categoryFilter])

  const issues = categorizedChecks.filter((c) => c.severity === 'warning')
  const notes = categorizedChecks.filter((c) => c.severity === 'info')

  return (
    <div className="space-y-4">
      {/* Category Tabs */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
          {[
            { id: 'all' as const, label: `All Items (${data.checks.length})` },
            { id: 'data_quality' as const, label: 'Data Quality' },
            { id: 'efficiency' as const, label: 'Efficiency & Mileage' },
            { id: 'workflow' as const, label: 'Workflow' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategoryFilter(tab.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                categoryFilter === tab.id
                  ? 'bg-white text-[var(--dashboard-primary)] font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Actionable Issues Section */}
      <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <TriangleAlert className="h-4 w-4 text-amber-600" />
          <h2 className="text-sm font-bold text-slate-900">Issues Requiring Action ({issues.length})</h2>
        </div>

        <div className="mt-3 divide-y divide-slate-100">
          {issues.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500 mb-1" />
              <span>No critical exceptions or data quality issues in this period.</span>
            </div>
          ) : (
            issues.map((chk, idx) => (
              <div key={idx} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{CHECK_TITLE[chk.kind] || chk.kind}</span>
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 text-[10px]">
                      Action Needed
                    </Badge>
                  </div>
                  <p className="text-slate-600">{chk.message}</p>
                  <p className="font-mono text-[11px] text-slate-400">
                    Request #{chk.requestNumber} {chk.vehicleLabel ? `· ${chk.vehicleLabel}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onViewRequest(chk.requestNumber)}
                    className="h-8 rounded-xl text-xs font-semibold"
                  >
                    View Request
                  </Button>
                  {chk.vin && (
                    <Button
                      size="sm"
                      onClick={() => onSelectVehicle(chk.vin!)}
                      className="h-8 rounded-xl text-xs font-semibold bg-[var(--dashboard-primary)] text-white hover:opacity-90"
                    >
                      View Vehicle
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Informational Notes Section */}
      {notes.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Info className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">Informational Notes ({notes.length})</h2>
          </div>

          <div className="mt-3 divide-y divide-slate-100">
            {notes.map((chk, idx) => (
              <div key={idx} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                <div>
                  <span className="font-semibold text-slate-900">{chk.message}</span>
                  <p className="text-[11px] text-slate-400">Request #{chk.requestNumber}</p>
                </div>
                {chk.vin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onSelectVehicle(chk.vin!)}
                    className="h-7 text-xs font-semibold text-[var(--dashboard-primary)] hover:opacity-80"
                  >
                    Vehicle →
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* =================================================================================================
 * TAB 6: REPORTS TAB (PRINT & AUDIT LEDGER)
 * =============================================================================================== */

function FuelReportsTab({
  data,
  derivedStats,
}: {
  data: FuelManagementResponse
  derivedStats: { fuelSpend: number; costPerKm: number; fleetAvgMileage: number | null }
}) {
  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Fuel Management Audit Report</h2>
          <p className="text-xs text-slate-500">
            Official summary for {formatRange(data.period.from, data.period.to)} ({BRANCH_LABEL[data.period.branch]})
          </p>
        </div>
        <Button onClick={handlePrint} className="gap-2 rounded-xl text-xs font-semibold">
          <Printer className="h-3.5 w-3.5" />
          <span>Print / Export PDF</span>
        </Button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
        {/* Executive Summary Grid */}
        <div className="grid gap-4 sm:grid-cols-4 border-b border-slate-100 pb-6">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Total Fuel Approved</span>
            <p className="text-xl font-bold text-slate-900">{formatLitres(data.kpis.approvedLitres)} Litres</p>
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Total Estimated Spend</span>
            <p className="text-xl font-bold text-slate-900">{formatCurrency(derivedStats.fuelSpend)}</p>
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Demo Gate Distance</span>
            <p className="text-xl font-bold text-slate-900">{formatKm(data.kpis.demoDriveKm)} km</p>
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Fleet Avg Efficiency</span>
            <p className="text-xl font-bold text-slate-900">
              {derivedStats.fleetAvgMileage ? `${formatKm(derivedStats.fleetAvgMileage)} km/L` : 'Awaiting 2nd fills'}
            </p>
          </div>
        </div>

        {/* Purpose Table */}
        <div>
          <h3 className="text-xs font-bold uppercase text-slate-800 tracking-wider">Departmental Breakdown</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 font-semibold text-slate-600">
                <tr>
                  <th className="py-2">Category</th>
                  <th className="py-2 text-right">Requests</th>
                  <th className="py-2 text-right">Litres</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byPurpose.map((p) => (
                  <tr key={p.purpose}>
                    <td className="py-2 font-medium text-slate-900">{p.label}</td>
                    <td className="py-2 text-right tabular-nums text-slate-600">{p.approvedRequests}</td>
                    <td className="py-2 text-right font-bold tabular-nums text-slate-900">
                      {formatLitres(p.approvedLitres)} L
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-900">
                      {formatCurrency(p.approvedLitres * ESTIMATED_FUEL_PRICE_INR)}
                    </td>
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

/* =================================================================================================
 * VEHICLE PROFILE DRAWER (DEEP VEHICLE EFFICIENCY PROFILE)
 * =============================================================================================== */

function VehicleProfileDrawer({
  vehicle,
  isOpen,
  onClose,
  onOpenMethodology,
}: {
  vehicle: DemoCar | null
  isOpen: boolean
  onClose: () => void
  onOpenMethodology: () => void
}) {
  if (!vehicle) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-6">
        <DialogHeader>
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <DialogTitle className="text-lg font-bold text-slate-900">
                {vehicle.registrationNumber || 'Demo Vehicle'}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                {[vehicle.model, vehicle.branchLabel, vinTail(vehicle.vin)].filter(Boolean).join(' · ')}
              </DialogDescription>
            </div>
            {vehicle.kmPerLitre ? (
              <Badge className="bg-emerald-100 text-emerald-800 text-xs font-bold">
                {formatKm(vehicle.kmPerLitre.value)} km/L
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs font-medium text-slate-500">
                Awaiting Data
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* 4 Summary Stat Tiles */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Fuel Used</span>
            <p className="mt-1 text-lg font-bold text-slate-900">{formatLitres(vehicle.approvedLitres)} L</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Fuel Cost</span>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {formatCurrency(vehicle.approvedLitres * ESTIMATED_FUEL_PRICE_INR)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Distance</span>
            <p className="mt-1 text-lg font-bold text-slate-900">{formatKm(vehicle.driveKm)} km</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Last Odometer</span>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {vehicle.lastFillOdometerKm ? `${formatKm(vehicle.lastFillOdometerKm)} km` : '—'}
            </p>
          </div>
        </div>

        {/* Fuel History */}
        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Fuel Fills History</h3>
          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Request #</th>
                  <th className="px-3 py-2 text-right">Quantity</th>
                  <th className="px-3 py-2 text-right">Odometer</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicle.fills.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-400">
                      No fuel fills recorded.
                    </td>
                  </tr>
                ) : (
                  vehicle.fills.map((f, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-slate-600">{formatYmd(f.date)}</td>
                      <td className="px-3 py-2 font-mono font-medium text-slate-800">{f.requestNumber}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">
                        {formatLitres(f.litres)} L
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {f.odometerKm ? `${formatKm(f.odometerKm)} km` : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusBadge status={f.status} label={f.statusLabel} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Drives History */}
        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Demo Drives History</h3>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2">Gate Out Date</th>
                  <th className="px-3 py-2">Pass #</th>
                  <th className="px-3 py-2 text-right">Trip Distance</th>
                  <th className="px-3 py-2 text-right">GPS Tracked</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicle.drives.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-400">
                      No gate passes recorded.
                    </td>
                  </tr>
                ) : (
                  vehicle.drives.map((d, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-slate-600">{formatIndiaDateTime(d.gateOutAt)}</td>
                      <td className="px-3 py-2 font-mono font-medium text-slate-800">{d.passNo}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {d.odometerKm !== null ? `${formatKm(d.odometerKm)} km` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {d.gpsKm !== null ? `${formatKm(d.gpsKm)} km` : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className="text-[10px] font-semibold">
                          {d.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={onClose} className="rounded-xl">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* =================================================================================================
 * REUSABLE UI PRIMITIVES
 * =============================================================================================== */

function LayoutGridIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  )
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const norm = (status || '').toLowerCase()
  if (norm === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
        <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
        <span>{label}</span>
      </span>
    )
  }
  if (norm === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800">
        <X className="h-3 w-3 text-rose-600 shrink-0" />
        <span>{label}</span>
      </span>
    )
  }
  if (norm === 'sent_back' || norm.includes('hold')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">
        <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
        <span>{label}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
      <Clock className="h-3 w-3 text-slate-400 shrink-0" />
      <span>{label}</span>
    </span>
  )
}

function StatePanel({
  icon,
  title,
  children,
  action,
  tone = 'muted',
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  action?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-xs">
      <div
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: TONE[tone].bg, color: TONE[tone].fg }}
      >
        {icon}
      </div>
      <h2 className="mt-3 text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mx-auto mt-1 max-w-md text-xs text-slate-600">{children}</div>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs animate-pulse" />
        ))}
      </div>
      <div className="h-44 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs animate-pulse" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs animate-pulse" />
        <div className="h-64 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs animate-pulse" />
      </div>
    </div>
  )
}

