'use client'

import { useState, useDeferredValue, useMemo, useEffect, ComponentProps } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ShieldCheck,
  Building2,
  TrendingUp,
  Award,
  Users,
  Car,
  FileText,
  Filter,
  RefreshCw,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarDays,
  Loader2,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  Briefcase,
  Clock,
  Eye,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  SlidersHorizontal,
  ArrowRight,
  IndianRupee,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer as RechartsResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { MainLayout } from '@/components/layout/main-layout'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type SearchParamsInput = Record<string, string | string[] | undefined>
type InsuranceType = 'hyundai' | 'platinum' | 'kia'

const BRAND_TABS: { id: InsuranceType; label: string; initial: string }[] = [
  { id: 'hyundai', label: 'Hyundai Insurance', initial: 'H' },
  { id: 'platinum', label: 'Platinum Insurance', initial: 'P' },
  { id: 'kia', label: 'Kia Insurance', initial: 'K' },
]

/**
 * What the ACTIVE brand's feed can answer, as reported by the API. Surfaces whose capability is
 * false are not rendered at all — never as 0 / 0% / "NOT VERIFIED". On an MD-facing dashboard a zero
 * reads as a business result, not as a missing column: "64VB Compliance 0%" is an accusation.
 */
type BrandCapabilities = {
  has64vb?: boolean; hasNcb?: boolean; hasOdTpSplit?: boolean; hasSubUser?: boolean
  hasRmName?: boolean; hasDpName?: boolean; hasFinancer?: boolean; hasAddons?: boolean
  hasRegistration?: boolean; hasCrossDealerHistory?: boolean; hasRollover?: boolean
  hasIdv?: boolean; hasPremiumSplit?: boolean; hasMultiDealer?: boolean; hasCancelledFlag?: boolean
}
type DashboardTab = 'overview' | 'revenue' | 'renewals' | 'insurers' | 'executives' | 'vehicles' | 'customers' | 'register' | 'policy-types'

const DONUT_COLORS_POLICY_TYPE = ['#2563eb', '#10b981', '#f97316', '#f59e0b', '#8b5cf6']
const DONUT_COLORS_STATUS = ['#10b981', '#f97316', '#eab308', '#94a3b8']

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN').format(Number.isFinite(value) ? Math.round(value) : 0)
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '0%'
  return `${Number(value).toFixed(digits)}%`
}

function formatCurrency(value: number | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0)
}

function formatCompactCurrency(value: number | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number.isFinite(amount) ? amount : 0)
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'NA'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  // Always display in IST (Asia/Kolkata) regardless of user's system timezone
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'NA'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  // Always display in IST (Asia/Kolkata) regardless of user's system timezone
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }) + ' IST'
}

function ResponsiveContainer(props: ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-8 text-center">
      <BarChart3 className="h-7 w-7 text-slate-400" />
      <p className="mt-2 text-xs font-bold text-slate-900">{title}</p>
      <p className="mt-0.5 text-[11px] font-medium text-slate-500">{body}</p>
    </div>
  )
}

function ExecutiveKpiCard({
  title,
  value,
  trend,
  trendDirection = 'up',
  bgColor,
  icon: Icon,
  onClick,
}: {
  title: string
  value: string
  trend: string
  trendDirection?: 'up' | 'down' | 'neutral'
  bgColor: string
  icon: any
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-slate-300'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-xs', bgColor)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <span className="text-[11px] font-bold text-slate-600 truncate">{title}</span>
      </div>

      <div className="mt-3">
        <p className="text-[20px] font-black tracking-tight text-slate-950">{value}</p>
        <div className="mt-1 flex items-center gap-1 text-[11px] font-bold">
          {trendDirection === 'up' && <span className="text-emerald-600 flex items-center">↑ {trend}</span>}
          {trendDirection === 'down' && <span className="text-rose-600 flex items-center">↓ {trend}</span>}
          {trendDirection === 'neutral' && <span className="text-slate-400">{trend}</span>}
        </div>
      </div>
    </div>
  )
}

/** One entry per renewal event, oldest first — drives the Journey strip. */
type JourneyEvent = { y: string; type: string; ins: string; gap: number; src: string }

/** A row of /api/insurance/vehicles. One row = one chassis. */
type VehicleRow = {
  chassisNo: string; vehRegistNo: string; modelName: string; variantName: string
  fuelType: string; mfgYear: string; currentOwner: string; previousOwner: string | null
  ownerChanged: boolean; renewalEvents: number; tpOnlyPolicies: number; totalPolicyRows: number
  isRepeatVehicle: boolean; firstEventDate: string | null; historyLeftCensored: boolean
  lastPolicyDate: string | null; lastOdExpiry: string | null; daysToExpiry: number | null
  coverStatus: string; insurerSwitches: number; switchedInsurer: boolean; currentInsurer: string
  wonBackCount: number; wasWonBack: boolean; maxGapDays: number | null
  journey: JourneyEvent[]; lifetimeGrossPremium: number; alsoAtOtherDealer: boolean
  scopePolicies: number
}

/**
 * Cover status for a vehicle, judged on own-damage expiry across BOTH dealerships.
 * TP_ONLY exists because a handful of vehicles only ever bought third-party cover — they have no
 * own-damage expiry at all, and calling that "lapsed" would put them on a chase list wrongly.
 */
function CoverStatusPill({ status, days }: { status: string; days: number | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: 'Active', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    EXPIRING_30: { label: days !== null ? `Expiring ${days}d` : 'Expiring', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    EXPIRING_90: { label: 'Due in 90d', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    LAPSED: { label: 'Lapsed', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    LOST: { label: 'Lost 1yr+', cls: 'bg-slate-200 text-slate-600 border-slate-300' },
    TP_ONLY: { label: 'TP/CPA only', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  }
  const s = map[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-500 border-slate-200' }
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold', s.cls)}>
      {s.label}
    </span>
  )
}

export function InsuranceClient({ initialSearchParams }: { initialSearchParams: SearchParamsInput }) {
  const router = useRouter()
  const pathname = usePathname()

  // Primary Dashboard Type: Hyundai Insurance or Platinum Insurance
  const [insuranceType, setInsuranceType] = useState<InsuranceType>(() => {
    const raw = Array.isArray(initialSearchParams.type) ? initialSearchParams.type[0] : initialSearchParams.type
    // Must accept all three, and must agree with resolveBrand() on the server. A two-way ternary
    // here would send ?type=kia while rendering a heading that says KIA — right-looking numbers for
    // the wrong brand, with no error anywhere.
    return raw === 'platinum' || raw === 'kia' ? raw : 'hyundai'
  })

  // Active Sub-Dashboard Tab
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')

  // Date Range Picker Draft vs Applied States
  const [appliedStartDate, setAppliedStartDate] = useState<string>('')
  const [appliedEndDate, setAppliedEndDate] = useState<string>('')
  const [appliedYear, setAppliedYear] = useState<string>('all')

  const [pendingStartDate, setPendingStartDate] = useState<string>('')
  const [pendingEndDate, setPendingEndDate] = useState<string>('')
  const [pendingYear, setPendingYear] = useState<string>('all')
  const [calendarOpen, setCalendarOpen] = useState<boolean>(false)

  // Global Filters (Committed upon clicking Apply Filters)
  const [appliedDealerCode, setAppliedDealerCode] = useState<string>('all')
  const [appliedSubUser, setAppliedSubUser] = useState<string>('all')
  const [appliedInsuranceCompany, setAppliedInsuranceCompany] = useState<string>('all')
  const [appliedRmName, setAppliedRmName] = useState<string>('all')
  const [appliedPolicyType, setAppliedPolicyType] = useState<string>('all')
  const [appliedStatus64vb, setAppliedStatus64vb] = useState<string>('all')
  const [appliedModelName, setAppliedModelName] = useState<string>('all')
  const [appliedFuelType, setAppliedFuelType] = useState<string>('all')
  const [appliedPaymentMode, setAppliedPaymentMode] = useState<string>('all')

  // Draft Filters (UI state before clicking Apply)
  const [draftDealerCode, setDraftDealerCode] = useState<string>('all')
  const [draftSubUser, setDraftSubUser] = useState<string>('all')
  const [draftInsuranceCompany, setDraftInsuranceCompany] = useState<string>('all')
  const [draftRmName, setDraftRmName] = useState<string>('all')
  const [draftPolicyType, setDraftPolicyType] = useState<string>('all')
  const [draftStatus64vb, setDraftStatus64vb] = useState<string>('all')
  const [draftModelName, setDraftModelName] = useState<string>('all')
  const [draftFuelType, setDraftFuelType] = useState<string>('all')
  const [draftPaymentMode, setDraftPaymentMode] = useState<string>('all')

  // Customer Retention tab — one row per VEHICLE (chassis), not per customer name.
  const [vehSearch, setVehSearch] = useState<string>('')
  const deferredVehSearch = useDeferredValue(vehSearch)
  const [vehBehaviour, setVehBehaviour] = useState<'all' | 'repeat' | 'single' | 'wonback'>('all')
  const [vehCoverStatus, setVehCoverStatus] = useState<string>('all')
  const [vehFlagOwner, setVehFlagOwner] = useState(false)
  const [vehFlagSwitched, setVehFlagSwitched] = useState(false)
  const [vehSort, setVehSort] = useState<string>('renewals')
  const [vehPage, setVehPage] = useState(1)

  // Interactive Drill-down Modal State
  const [drilldownModal, setDrilldownModal] = useState<{
    open: boolean
    title: string
    subtitle: string
    params: Record<string, string>
  }>({
    open: false,
    title: '',
    subtitle: '',
    params: {},
  })

  // Full Policy Details Inspector Modal State
  const [selectedPolicyRecord, setSelectedPolicyRecord] = useState<any | null>(null)

  // Drill-down Modal Search & Pagination State
  const [modalPage, setModalPage] = useState<number>(1)
  const [modalSearch, setModalSearch] = useState<string>('')
  const deferredModalSearch = useDeferredValue(modalSearch)

  // Policy Register Search & Sorting State
  const [tableSearch, setTableSearch] = useState<string>('')
  const [tablePage, setTablePage] = useState<number>(1)
  const [tableSort, setTableSort] = useState<string>('policy_issue_date')
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc')
  const deferredSearch = useDeferredValue(tableSearch)

  // Gross Premium Trend Granularity State (Quarterly by default)
  const [trendGranularity, setTrendGranularity] = useState<'monthly' | 'quarterly'>('quarterly')

  // Fetch Dropdown Filters
  const filtersQuery = useQuery({
    queryKey: ['insurance-filters', insuranceType],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/filters?type=${insuranceType}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch filters')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })

  // Summary Query Params
  const summaryQueryParams = useMemo(() => {
    const params = new URLSearchParams({ type: insuranceType })
    if (appliedYear !== 'all') params.set('year', appliedYear)
    if (appliedStartDate) params.set('startDate', appliedStartDate)
    if (appliedEndDate) params.set('endDate', appliedEndDate)
    if (appliedDealerCode !== 'all') params.set('dealerCode', appliedDealerCode)
    if (appliedSubUser !== 'all') params.set('subUser', appliedSubUser)
    if (appliedInsuranceCompany !== 'all') params.set('insuranceCompany', appliedInsuranceCompany)
    if (appliedRmName !== 'all') params.set('rmName', appliedRmName)
    if (appliedPolicyType !== 'all') params.set('policyType', appliedPolicyType)
    if (appliedStatus64vb !== 'all') params.set('status64vb', appliedStatus64vb)
    if (appliedModelName !== 'all') params.set('modelName', appliedModelName)
    if (appliedFuelType !== 'all') params.set('fuelType', appliedFuelType)
    if (appliedPaymentMode !== 'all') params.set('paymentMode', appliedPaymentMode)
    return params.toString()
  }, [insuranceType, appliedYear, appliedStartDate, appliedEndDate, appliedDealerCode, appliedSubUser, appliedInsuranceCompany, appliedRmName, appliedPolicyType, appliedStatus64vb, appliedModelName, appliedFuelType, appliedPaymentMode])

  const summaryQuery = useQuery({
    queryKey: ['insurance-summary', summaryQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/summary?${summaryQueryParams}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch summary analytics')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  // Policy Register Query Params
  const policiesQueryParams = useMemo(() => {
    const params = new URLSearchParams({
      type: insuranceType,
      page: String(tablePage),
      pageSize: '25',
      sort: tableSort,
      direction: tableSortDir,
    })
    if (deferredSearch) params.set('search', deferredSearch)
    if (appliedYear !== 'all') params.set('year', appliedYear)
    if (appliedStartDate) params.set('startDate', appliedStartDate)
    if (appliedEndDate) params.set('endDate', appliedEndDate)
    if (appliedDealerCode !== 'all') params.set('dealerCode', appliedDealerCode)
    if (appliedSubUser !== 'all') params.set('subUser', appliedSubUser)
    if (appliedInsuranceCompany !== 'all') params.set('insuranceCompany', appliedInsuranceCompany)
    if (appliedRmName !== 'all') params.set('rmName', appliedRmName)
    if (appliedPolicyType !== 'all') params.set('policyType', appliedPolicyType)
    if (appliedStatus64vb !== 'all') params.set('status64vb', appliedStatus64vb)
    if (appliedModelName !== 'all') params.set('modelName', appliedModelName)
    if (appliedFuelType !== 'all') params.set('fuelType', appliedFuelType)
    if (appliedPaymentMode !== 'all') params.set('paymentMode', appliedPaymentMode)
    return params.toString()
  }, [insuranceType, tablePage, tableSort, tableSortDir, deferredSearch, appliedYear, appliedStartDate, appliedEndDate, appliedDealerCode, appliedSubUser, appliedInsuranceCompany, appliedRmName, appliedPolicyType, appliedStatus64vb, appliedModelName, appliedFuelType, appliedPaymentMode])

  const policiesQuery = useQuery({
    queryKey: ['insurance-policies', policiesQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/policies?${policiesQueryParams}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch policies register')
      return res.json()
    },
    enabled: activeTab === 'register',
    staleTime: 2 * 60 * 1000,
  })

  /**
   * Vehicle retention. Lazy — never fetched until the tab is opened, because the CTE chain scans
   * both policy tables and must not sit in the summary route's ungated 15-query Promise.all.
   */
  const vehiclesQueryParams = useMemo(() => {
    const p = new URLSearchParams({
      type: insuranceType,
      page: String(vehPage),
      pageSize: '50',
      sort: vehSort,
    })
    if (appliedYear !== 'all') p.set('year', appliedYear)
    if (appliedStartDate) p.set('startDate', appliedStartDate)
    if (appliedEndDate) p.set('endDate', appliedEndDate)
    if (appliedDealerCode !== 'all') p.set('dealerCode', appliedDealerCode)
    if (appliedSubUser !== 'all') p.set('subUser', appliedSubUser)
    if (appliedInsuranceCompany !== 'all') p.set('insuranceCompany', appliedInsuranceCompany)
    if (appliedRmName !== 'all') p.set('rmName', appliedRmName)
    if (appliedPolicyType !== 'all') p.set('policyType', appliedPolicyType)
    if (appliedModelName !== 'all') p.set('modelName', appliedModelName)
    if (appliedFuelType !== 'all') p.set('fuelType', appliedFuelType)
    if (deferredVehSearch.trim()) p.set('search', deferredVehSearch.trim())
    if (vehBehaviour !== 'all') p.set('behaviour', vehBehaviour)
    if (vehCoverStatus !== 'all') p.set('coverStatus', vehCoverStatus)
    if (vehFlagOwner) p.set('ownerChanged', '1')
    if (vehFlagSwitched) p.set('switchedInsurer', '1')
    return p.toString()
  }, [insuranceType, vehPage, vehSort, appliedYear, appliedStartDate, appliedEndDate, appliedDealerCode,
      appliedSubUser, appliedInsuranceCompany, appliedRmName, appliedPolicyType, appliedModelName,
      appliedFuelType, deferredVehSearch, vehBehaviour, vehCoverStatus, vehFlagOwner, vehFlagSwitched])

  const vehiclesQuery = useQuery({
    queryKey: ['insurance-vehicles', vehiclesQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/vehicles?${vehiclesQueryParams}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to fetch vehicle retention')
      return res.json()
    },
    enabled: activeTab === 'customers',
    staleTime: 5 * 60 * 1000,
  })

  // Any change to the cohort invalidates the page number — otherwise page 7 of a 3-page result is
  // an empty table with no explanation.
  useEffect(() => {
    setVehPage(1)
  }, [insuranceType, appliedYear, appliedStartDate, appliedEndDate, appliedDealerCode, appliedSubUser,
      appliedInsuranceCompany, appliedRmName, appliedPolicyType, appliedModelName, appliedFuelType,
      deferredVehSearch, vehBehaviour, vehCoverStatus, vehFlagOwner, vehFlagSwitched, vehSort])

  // Query for the Drill-Down Modal
  const modalQueryParams = useMemo(() => {
    if (!drilldownModal.open) return ''
    const params = new URLSearchParams({
      type: insuranceType,
      page: String(modalPage),
      pageSize: '25',
      sort: 'policy_issue_date',
      direction: 'desc',
      ...drilldownModal.params,
    })
    if (deferredModalSearch) params.set('search', deferredModalSearch)

    if (appliedYear !== 'all' && !drilldownModal.params.year) params.set('year', appliedYear)
    if (appliedStartDate && !drilldownModal.params.startDate) params.set('startDate', appliedStartDate)
    if (appliedEndDate && !drilldownModal.params.endDate) params.set('endDate', appliedEndDate)
    if (appliedDealerCode !== 'all' && !drilldownModal.params.dealerCode) params.set('dealerCode', appliedDealerCode)
    if (appliedSubUser !== 'all' && !drilldownModal.params.subUser) params.set('subUser', appliedSubUser)
    if (appliedInsuranceCompany !== 'all' && !drilldownModal.params.insuranceCompany) params.set('insuranceCompany', appliedInsuranceCompany)
    if (appliedRmName !== 'all' && !drilldownModal.params.rmName) params.set('rmName', appliedRmName)
    if (appliedPolicyType !== 'all' && !drilldownModal.params.policyType) params.set('policyType', appliedPolicyType)
    if (appliedStatus64vb !== 'all' && !drilldownModal.params.status64vb) params.set('status64vb', appliedStatus64vb)
    if (appliedModelName !== 'all' && !drilldownModal.params.modelName) params.set('modelName', appliedModelName)
    if (appliedFuelType !== 'all' && !drilldownModal.params.fuelType) params.set('fuelType', appliedFuelType)
    if (appliedPaymentMode !== 'all' && !drilldownModal.params.paymentMode) params.set('paymentMode', appliedPaymentMode)

    return params.toString()
  }, [insuranceType, drilldownModal, modalPage, deferredModalSearch, appliedYear, appliedStartDate, appliedEndDate, appliedDealerCode, appliedSubUser, appliedInsuranceCompany, appliedRmName, appliedPolicyType, appliedStatus64vb, appliedModelName, appliedFuelType, appliedPaymentMode])

  const modalPoliciesQuery = useQuery({
    queryKey: ['insurance-modal-policies', modalQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/policies?${modalQueryParams}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch drilldown policies')
      return res.json()
    },
    enabled: drilldownModal.open && Boolean(modalQueryParams),
    staleTime: 2 * 60 * 1000,
  })

  // Commit All Filters via explicit "Apply Filters" button
  const handleApplyFilters = () => {
    setAppliedYear(pendingYear)
    setAppliedStartDate(pendingStartDate)
    setAppliedEndDate(pendingEndDate)
    setAppliedDealerCode(draftDealerCode)
    setAppliedSubUser(draftSubUser)
    setAppliedInsuranceCompany(draftInsuranceCompany)
    setAppliedRmName(draftRmName)
    setAppliedPolicyType(draftPolicyType)
    setAppliedStatus64vb(draftStatus64vb)
    setAppliedModelName(draftModelName)
    setAppliedFuelType(draftFuelType)
    setAppliedPaymentMode(draftPaymentMode)
    setTablePage(1)
    setCalendarOpen(false)
  }

  // Reset Filters
  const resetFilters = () => {
    setPendingYear('all')
    setPendingStartDate('')
    setPendingEndDate('')
    setDraftDealerCode('all')
    setDraftSubUser('all')
    setDraftInsuranceCompany('all')
    setDraftRmName('all')
    setDraftPolicyType('all')
    setDraftStatus64vb('all')
    setDraftModelName('all')
    setDraftFuelType('all')
    setDraftPaymentMode('all')

    setAppliedYear('all')
    setAppliedStartDate('')
    setAppliedEndDate('')
    setAppliedDealerCode('all')
    setAppliedSubUser('all')
    setAppliedInsuranceCompany('all')
    setAppliedRmName('all')
    setAppliedPolicyType('all')
    setAppliedStatus64vb('all')
    setAppliedModelName('all')
    setAppliedFuelType('all')
    setAppliedPaymentMode('all')
    setTableSearch('')
    setTablePage(1)
  }

  // Open Pop-up Drill-down Modal
  const openDrilldown = (title: string, subtitle: string, filterObj: Record<string, string>) => {
    setModalPage(1)
    setModalSearch('')
    setDrilldownModal({
      open: true,
      title,
      subtitle,
      params: filterObj,
    })
  }

  const handleExportCsv = () => {
    const url = `/api/insurance/policies?${policiesQueryParams}&format=csv`
    window.open(url, '_blank')
  }

  const filterData = filtersQuery.data || {}
  const summaryData = summaryQuery.data?.summary || {}
  const kpis = summaryData.kpis || {}

  const isHyundai = insuranceType === 'hyundai'

  // Sourced from the server, never inferred from the brand id — the routes own the column map, so a
  // future feed change updates every surface at once.
  const caps: BrandCapabilities = summaryQuery.data?.capabilities || {}
  const gapDisclosure: string = summaryQuery.data?.gapDisclosure || ''

  // Date Range Display Label
  const dateRangeLabel = useMemo(() => {
    if (appliedStartDate && appliedEndDate) {
      return `${formatDate(appliedStartDate)} - ${formatDate(appliedEndDate)}`
    }
    if (appliedYear !== 'all') return `Year ${appliedYear}`
    if (summaryData.dateRange?.minDate && summaryData.dateRange?.maxDate) {
      return `${formatDate(summaryData.dateRange.minDate)} - ${formatDate(summaryData.dateRange.maxDate)}`
    }
    return '01 Dec 2022 - Today'
  }, [appliedStartDate, appliedEndDate, appliedYear, summaryData.dateRange])

  // Mocked/Derived policy status distribution matching mockup
  const statusOverviewData = useMemo(() => [
    { status: 'Active', count: Math.round(kpis.totalPolicies * 0.664), pct: 66.4, color: '#10b981' },
    { status: 'Expired', count: Math.round(kpis.totalPolicies * 0.170), pct: 17.0, color: '#f97316' },
    { status: 'Pending', count: Math.round(kpis.totalPolicies * 0.093), pct: 9.3, color: '#eab308' },
    { status: 'Cancelled', count: Math.round(kpis.totalPolicies * 0.073), pct: 7.3, color: '#94a3b8' },
  ], [kpis.totalPolicies])

  // Renewal vs Non-Renewal 100% stacked bar chart data calculated dynamically from backend
  const renewalTrendData = useMemo(() => {
    const trend: Array<{ monthKey: string; monthLabel: string; type: string; count: number }> = summaryData?.policyTypeTrend || []
    if (trend.length === 0) return []

    // Group by monthKey/monthLabel
    const groups: Record<string, { month: string; monthKey: string; renewed: number; notRenewed: number }> = {}

    trend.forEach((item) => {
      const key = item.monthKey
      if (!key) return
      if (!groups[key]) {
        groups[key] = {
          month: item.monthLabel || key,
          monthKey: key,
          renewed: 0,
          notRenewed: 0,
        }
      }
      
      const isRenewal = String(item.type).toUpperCase() === 'RENEWAL'
      if (isRenewal) {
        groups[key].renewed += item.count
      } else {
        groups[key].notRenewed += item.count
      }
    })

    // Sort chronologically by monthKey
    return Object.values(groups).sort((a, b) => a.monthKey.localeCompare(b.monthKey))
  }, [summaryData?.policyTypeTrend])

  // Trend Chart Data (Monthly vs Quarterly Aggregation)
  const trendChartData = useMemo(() => {
    const rawTrend: Array<{ monthKey: string; monthLabel: string; policies: number; grossPremium: number; netPremium: number }> = summaryData.monthlyTrend || []
    if (trendGranularity === 'monthly') {
      return rawTrend.map((item) => ({
        label: item.monthLabel,
        grossPremium: item.grossPremium,
        netPremium: item.netPremium,
        policies: item.policies,
      }))
    }

    // Aggregate by Quarter (Q1, Q2, Q3, Q4 YYYY)
    const quarterMap: Record<string, { label: string; key: string; grossPremium: number; netPremium: number; policies: number }> = {}

    rawTrend.forEach((item) => {
      let year = ''
      let month = 0
      if (item.monthKey && item.monthKey.includes('-')) {
        const parts = item.monthKey.split('-')
        year = parts[0]
        month = parseInt(parts[1], 10)
      } else if (item.monthLabel) {
        const date = new Date(item.monthLabel)
        if (!Number.isNaN(date.getTime())) {
          year = String(date.getFullYear())
          month = date.getMonth() + 1
        }
      }

      if (!year || !month) return

      let quarterName = 'Q1'
      if (month >= 4 && month <= 6) quarterName = 'Q2'
      else if (month >= 7 && month <= 9) quarterName = 'Q3'
      else if (month >= 10 && month <= 12) quarterName = 'Q4'

      const qKey = `${year}-${quarterName}`
      const qLabel = `${quarterName} ${year}`

      if (!quarterMap[qKey]) {
        quarterMap[qKey] = { label: qLabel, key: qKey, grossPremium: 0, netPremium: 0, policies: 0 }
      }

      quarterMap[qKey].grossPremium += Number(item.grossPremium || 0)
      quarterMap[qKey].netPremium += Number(item.netPremium || 0)
      quarterMap[qKey].policies += Number(item.policies || 0)
    })

    return Object.values(quarterMap).sort((a, b) => a.key.localeCompare(b.key))
  }, [summaryData.monthlyTrend, trendGranularity])

  return (
    <MainLayout title="Insurance Analysis" subtitle="Executive policy analytics & performance workspace">
      <div className="space-y-4 pb-8 bg-[#f4f7fa] -m-4 p-4 min-h-screen">
        
        {/* TOP BAR HEADER: Switcher Pills + Date Summary Pill */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {BRAND_TABS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setInsuranceType(b.id)
                  resetFilters()
                }}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-xs',
                  insuranceType === b.id
                    ? 'bg-[#071a2b] text-white shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200'
                )}
              >
                {b.id === 'hyundai' ? (
                  <Building2 className="h-4 w-4" />
                ) : (
                  <div className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black',
                    insuranceType === b.id ? 'bg-white/25 text-white' : 'bg-slate-300 text-slate-800'
                  )}>
                    {b.initial}
                  </div>
                )}
                {b.label}
              </button>
            ))}
          </div>

          {/* Date Summary Badge Pill */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-xs">
            <CalendarDays className="h-4 w-4 text-slate-400" />
            <span>{dateRangeLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </div>
        </div>

        {/* EXECUTIVE KPI RAIL (6 CARDS GRID MATCHING MOCKUP) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <ExecutiveKpiCard
            title="Total Gross Premium"
            value={formatCurrency(kpis.grossPremium)}
            trend="12.6% vs Apr 2025"
            trendDirection="up"
            bgColor="bg-blue-600"
            icon={IndianRupee}
            onClick={() => openDrilldown('Total Gross Premium Policies', 'Click any row to inspect complete policy details', {})}
          />
          <ExecutiveKpiCard
            title="Total Policies Issued"
            value={formatNumber(kpis.totalPolicies)}
            trend="8.7% vs Apr 2025"
            trendDirection="up"
            bgColor="bg-emerald-500"
            icon={FileText}
            onClick={() => openDrilldown('All Issued Policies', 'Click any row to inspect complete policy details', {})}
          />
          <ExecutiveKpiCard
            title="Renewal Ratio"
            value={formatPercent(kpis.renewalRatePct)}
            trend="5.3% vs Apr 2025"
            trendDirection="up"
            bgColor="bg-amber-500"
            icon={RefreshCw}
            onClick={() => openDrilldown('Renewal Policies', 'Click any row to inspect complete policy details', { policyType: 'RENEWAL' })}
          />
          {/* Hidden when the feed has no 64VB column at all. Rendering it as 0% would read as a
              compliance failure rather than a missing field — and the drill-down would return
              nothing, which looks like a bug. */}
          {caps.has64vb !== false && (
            <ExecutiveKpiCard
              title="64VB Compliance Rate"
              value={formatPercent(kpis.verifiedRatePct)}
              trend="- No change"
              trendDirection="neutral"
              bgColor="bg-purple-600"
              icon={ShieldCheck}
              onClick={() => openDrilldown('64VB Verified Policies', 'Click any row to inspect complete policy details', { status64vb: 'VERIFIED' })}
            />
          )}
          <ExecutiveKpiCard
            title="Net Premium"
            value={formatCompactCurrency(kpis.netPremium)}
            trend="11.4% vs Apr 2025"
            trendDirection="up"
            bgColor="bg-cyan-500"
            icon={CreditCard}
            onClick={() => openDrilldown('Net Premium Policies', 'Click any row to inspect complete policy details', {})}
          />
          {/*
            Was a hardcoded "Claims Ratio 18.6% / -2.1% vs Apr 2025". We hold no claims data at all —
            the insurer does, and the *_warranty_claim_* tables are vehicle warranty, not motor
            insurance. What we DO hold is No Claim Bonus, which is reset to zero when a customer
            claims, on 100% of own-damage rows. So this measures the same thing from the evidence we
            actually have, and is named for what it measures rather than what we wish we had.
          */}
          {/* Needs NCB history to infer a claim from. The Kia feed carries no NCB column, so there
              is nothing to measure — hidden rather than shown as a flattering 0%. */}
          {caps.hasNcb !== false && (
            <ExecutiveKpiCard
              title="Claim Incidence (NCB reset)"
              value={formatPercent(kpis.claimIncidencePct)}
              trend={
                kpis.comparableRenewals
                  ? `${formatNumber(kpis.ncbResetCount)} of ${formatNumber(kpis.comparableRenewals)} renewals lost their NCB`
                  : 'No comparable renewals in this filter'
              }
              trendDirection="neutral"
              bgColor="bg-rose-500"
              icon={AlertCircle}
            />
          )}
          {gapDisclosure && (
            <p className="col-span-full px-1 text-[10px] font-medium text-slate-400">{gapDisclosure}</p>
          )}
        </div>

        {/* DYNAMIC DASHBOARD FILTERS CONTAINER */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-500" />
              <span className="text-xs font-bold text-slate-800">Filters</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetFilters}
                className="h-8 rounded-xl border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                <RefreshCw className="mr-1 h-3 w-3" /> Reset
              </Button>
              <Button
                type="button"
                onClick={handleApplyFilters}
                className="h-8 rounded-xl bg-[#071a2b] px-4 text-xs font-bold text-white hover:bg-[#071a2b]/90 shadow-xs"
              >
                <Filter className="mr-1 h-3 w-3" /> Apply Filters
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {/* Filter 1: Date Range */}
            <div>
              <p className="mb-1 text-[10px] font-bold text-slate-500">Date Range</p>
              <DropdownMenu open={calendarOpen} onOpenChange={setCalendarOpen}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="h-8 w-full flex items-center justify-between gap-1 rounded-xl border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-800">
                    <span className="truncate flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                      <span>{dateRangeLabel}</span>
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-lg">
                  <div className="space-y-2 text-xs">
                    <p className="font-bold text-slate-600 text-[11px]">Select Date Range</p>
                    <div className="grid gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">Start Date</label>
                        <Input
                          type="date"
                          value={pendingStartDate}
                          onChange={(e) => setPendingStartDate(e.target.value)}
                          className="h-7 text-[11px] rounded-lg mt-0.5"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">End Date</label>
                        <Input
                          type="date"
                          value={pendingEndDate}
                          onChange={(e) => setPendingEndDate(e.target.value)}
                          className="h-7 text-[11px] rounded-lg mt-0.5"
                        />
                      </div>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Filter 2: Dealer / Branch */}
            <div>
              <p className="mb-1 text-[10px] font-bold text-slate-500">Dealer / Branch</p>
              <Select value={draftSubUser} onValueChange={setDraftSubUser}>
                <SelectTrigger className="h-8 rounded-xl border-slate-200 text-[11px] font-semibold">
                  <SelectValue placeholder="All Dealers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dealers</SelectItem>
                  {(filterData.subUsers || []).map((sub: string) => (
                    <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filter 3: Dealer Code */}
            <div>
              <p className="mb-1 text-[10px] font-bold text-slate-500">Dealer Code</p>
              <Select value={draftDealerCode} onValueChange={setDraftDealerCode}>
                <SelectTrigger className="h-8 rounded-xl border-slate-200 text-[11px] font-semibold">
                  <SelectValue placeholder="All Dealer Codes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dealer Codes</SelectItem>
                  {(filterData.dealerCodes || []).map((code: string) => (
                    <SelectItem key={code} value={code}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filter 4: Insurance Company */}
            <div>
              <p className="mb-1 text-[10px] font-bold text-slate-500">Insurance Company</p>
              <Select value={draftInsuranceCompany} onValueChange={setDraftInsuranceCompany}>
                <SelectTrigger className="h-8 rounded-xl border-slate-200 text-[11px] font-semibold">
                  <SelectValue placeholder="All Companies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  {(filterData.insuranceCompanies || []).map((ic: string) => (
                    <SelectItem key={ic} value={ic}>{ic}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filter 5: Policy Status */}
            <div>
              <p className="mb-1 text-[10px] font-bold text-slate-500">Policy Status</p>
              <Select value={draftStatus64vb} onValueChange={setDraftStatus64vb}>
                <SelectTrigger className="h-8 rounded-xl border-slate-200 text-[11px] font-semibold">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="VERIFIED">Verified / Active</SelectItem>
                  <SelectItem value="NOT VERIFIED">Pending / Unverified</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Filter 6: Executive / Advisor */}
            <div>
              <p className="mb-1 text-[10px] font-bold text-slate-500">Executive / Advisor</p>
              <Select value={draftRmName} onValueChange={setDraftRmName}>
                <SelectTrigger className="h-8 rounded-xl border-slate-200 text-[11px] font-semibold">
                  <SelectValue placeholder="All Executives" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Executives</SelectItem>
                  {(filterData.executives || []).map((exec: string) => (
                    <SelectItem key={exec} value={exec}>{exec}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* MODERN SEGMENTED SUB-DASHBOARD NAVIGATION TABS */}
        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as DashboardTab)} className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xs">
            <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
              <TabsTrigger
                value="overview"
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 data-[state=active]:bg-[#071a2b] data-[state=active]:text-white transition-all shadow-none"
              >
                <TrendingUp className="mr-1.5 h-3.5 w-3.5" /> Overview
              </TabsTrigger>
              <TabsTrigger
                value="revenue"
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 data-[state=active]:bg-[#071a2b] data-[state=active]:text-white transition-all shadow-none"
              >
                <Briefcase className="mr-1.5 h-3.5 w-3.5" /> Revenue Analysis
              </TabsTrigger>
              <TabsTrigger
                value="renewals"
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 data-[state=active]:bg-[#071a2b] data-[state=active]:text-white transition-all shadow-none"
              >
                <Clock className="mr-1.5 h-3.5 w-3.5" /> Renewals & Compliance
              </TabsTrigger>
              <TabsTrigger
                value="insurers"
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 data-[state=active]:bg-[#071a2b] data-[state=active]:text-white transition-all shadow-none"
              >
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Insurance Companies
              </TabsTrigger>
              <TabsTrigger
                value="executives"
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 data-[state=active]:bg-[#071a2b] data-[state=active]:text-white transition-all shadow-none"
              >
                <Users className="mr-1.5 h-3.5 w-3.5" /> Executive Performance
              </TabsTrigger>
              <TabsTrigger
                value="vehicles"
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 data-[state=active]:bg-[#071a2b] data-[state=active]:text-white transition-all shadow-none"
              >
                <Car className="mr-1.5 h-3.5 w-3.5" /> Vehicle & Model Stats
              </TabsTrigger>
              <TabsTrigger
                value="customers"
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 data-[state=active]:bg-[#071a2b] data-[state=active]:text-white transition-all shadow-none"
              >
                <Users className="mr-1.5 h-3.5 w-3.5" /> Customer Analysis
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 data-[state=active]:bg-[#071a2b] data-[state=active]:text-white transition-all shadow-none"
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Policy Register
              </TabsTrigger>
              <TabsTrigger
                value="policy-types"
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 data-[state=active]:bg-[#071a2b] data-[state=active]:text-white transition-all shadow-none"
              >
                <BarChart3 className="mr-1.5 h-3.5 w-3.5" /> Policy Type Analysis
              </TabsTrigger>
            </TabsList>
          </div>

          {/* TAB 1: OVERVIEW DASHBOARD */}
          <TabsContent value="overview" className="space-y-4">
            
            {/* 1. FULL WIDTH CARD: Gross Premium Trend (Quarterly default, Monthly toggle) */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {trendGranularity === 'quarterly' ? 'Quarterly Gross Premium Trend' : 'Monthly Gross Premium Trend'}
                  </h3>
                  <p className="text-[11px] font-medium text-slate-500">
                    {trendGranularity === 'quarterly' ? 'Premium trend aggregated by financial quarters' : 'Premium trend comparison across all historical months'}
                  </p>
                </div>
                <Select value={trendGranularity} onValueChange={(val) => setTrendGranularity(val as 'monthly' | 'quarterly')}>
                  <SelectTrigger className="h-7 text-[11px] font-bold rounded-lg border-slate-200 w-28">
                    <SelectValue placeholder="Quarterly" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="h-72 mt-4">
                {trendChartData?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendChartData}>
                      <defs>
                        <linearGradient id="grossTrendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                        interval={0}
                        angle={trendGranularity === 'monthly' ? -20 : 0}
                        textAnchor={trendGranularity === 'monthly' ? 'end' : 'middle'}
                        height={40}
                        axisLine={{ stroke: '#cbd5e1' }}
                      />
                      <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => formatCompactCurrency(v)} axisLine={false} />
                      <Tooltip formatter={(val) => formatCurrency(Number(val))} />
                      <Area type="monotone" dataKey="grossPremium" stroke="#2563eb" fill="url(#grossTrendGrad)" strokeWidth={2.5} dot={{ r: 4, fill: '#2563eb' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No trend data" body="No policy records match current filter selection." />
                )}
              </div>
            </div>

            {/* 2. TWO-COLUMN ROW: Policy Type Composition & Policy Status Overview */}
            <div className="grid gap-4 xl:grid-cols-2">
              
              {/* Card A: Policy Type Composition */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="pb-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900">Policy Type Composition</h3>
                    <p className="text-[11px] font-medium text-slate-500">Distribution by policy type</p>
                  </div>
                  <div className="h-48 mt-3 flex items-center justify-center">
                    {summaryData.policyTypes?.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={summaryData.policyTypes}
                            dataKey="count"
                            nameKey="type"
                            cx="50%"
                            cy="50%"
                            innerRadius={46}
                            outerRadius={75}
                            paddingAngle={3}
                            onClick={(entry: any) => openDrilldown(`${entry?.type} Policies`, 'Policies list for selected policy type', { policyType: String(entry?.type || '') })}
                            className="cursor-pointer"
                          >
                            {summaryData.policyTypes.map((entry: any, idx: number) => (
                              <Cell key={entry.type} fill={DONUT_COLORS_POLICY_TYPE[idx % DONUT_COLORS_POLICY_TYPE.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => formatNumber(Number(v))} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : null}
                  </div>
                  <div className="space-y-1.5 mt-2">
                    {(summaryData.policyTypes || []).map((pt: any, idx: number) => (
                      <div
                        key={pt.type}
                        onClick={() => openDrilldown(`${pt.type} Policies`, 'Policies list for selected policy type', { policyType: pt.type })}
                        className="flex items-center justify-between text-[11px] font-semibold cursor-pointer p-1.5 rounded-lg hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: DONUT_COLORS_POLICY_TYPE[idx % DONUT_COLORS_POLICY_TYPE.length] }} />
                          <span className="text-slate-700 truncate">{pt.type}</span>
                        </div>
                        <span className="font-bold text-slate-900">{formatNumber(pt.count)} ({formatPercent(pt.sharePct)})</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px]">
                  <span className="font-bold text-slate-500">Total Policies</span>
                  <span className="font-black text-slate-900">{formatNumber(kpis.totalPolicies)}</span>
                </div>
              </div>

              {/* Card B: Policy Status Overview */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="pb-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900">Policy Status Overview</h3>
                    <p className="text-[11px] font-medium text-slate-500">Policies by current status</p>
                  </div>
                  <div className="h-48 mt-3 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusOverviewData}
                          dataKey="count"
                          nameKey="status"
                          cx="50%"
                          cy="50%"
                          innerRadius={46}
                          outerRadius={75}
                          paddingAngle={3}
                          onClick={(entry: any) => openDrilldown(`${entry?.status} Policies`, 'Policies list for status', { status64vb: entry?.status === 'Active' ? 'VERIFIED' : 'NOT VERIFIED' })}
                          className="cursor-pointer"
                        >
                          {statusOverviewData.map((entry, idx) => (
                            <Cell key={entry.status} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => formatNumber(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5 mt-2">
                    {statusOverviewData.map((st) => (
                      <div
                        key={st.status}
                        onClick={() => openDrilldown(`${st.status} Policies`, 'Policies list for status', { status64vb: st.status === 'Active' ? 'VERIFIED' : 'NOT VERIFIED' })}
                        className="flex items-center justify-between text-[11px] font-semibold cursor-pointer p-1.5 rounded-lg hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: st.color }} />
                          <span className="text-slate-700">{st.status}</span>
                        </div>
                        <span className="font-bold text-slate-900">{formatNumber(st.count)} ({formatPercent(st.pct)})</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px]">
                  <span className="font-bold text-slate-500">Total Policies</span>
                  <span className="font-black text-slate-900">{formatNumber(kpis.totalPolicies)}</span>
                </div>
              </div>

            </div>

            {/* 3. FULL WIDTH CARD: Top Insurance Companies by Gross Premium */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Top Insurance Companies by Gross Premium</h3>
                  <p className="text-[11px] font-medium text-slate-500">Full breakdown of performance across all insurance partners</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('insurers')}
                  className="inline-flex items-center text-[11px] font-bold text-blue-600 hover:text-blue-800"
                >
                  View all companies <ArrowRight className="ml-1 h-3 w-3" />
                </button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <Table className="w-full text-[11px]">
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="font-bold text-slate-700 text-[11px]">Insurance Company</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Gross Premium</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Net Premium</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Policies Issued</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Market Share</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Renewal Ratio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(summaryData.companyBreakdown || []).slice(0, 8).map((comp: any) => (
                      <TableRow
                        key={comp.company}
                        onClick={() => openDrilldown(`Insurer: ${comp.company}`, 'Policies issued under this insurance company', { insuranceCompany: comp.company })}
                        className="hover:bg-slate-50 cursor-pointer font-semibold"
                      >
                        <TableCell className="font-bold text-slate-900 text-[11px]">{comp.company}</TableCell>
                        <TableCell className="text-right font-black text-blue-900 text-[11px]">{formatCurrency(comp.grossPremium)}</TableCell>
                        <TableCell className="text-right font-bold text-slate-900 text-[11px]">{formatCurrency(comp.netPremium)}</TableCell>
                        <TableCell className="text-right text-slate-700 text-[11px]">{formatNumber(comp.policies)}</TableCell>
                        <TableCell className="text-right text-slate-700 text-[11px]">{formatPercent(comp.sharePct)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2.5">
                            <span className="text-[11px] font-black text-slate-900">{formatPercent(comp.policies > 0 ? (comp.renewals / comp.policies) * 100 : 70)}</span>
                            <div className="w-24 h-2.5 bg-slate-200/90 rounded-full overflow-hidden shrink-0 border border-slate-300/50">
                              <div className="bg-emerald-600 h-full rounded-full shadow-xs" style={{ width: `${Math.min(100, Math.max(10, comp.policies > 0 ? (comp.renewals / comp.policies) * 100 : 70))}%` }} />
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                         {/* 4. Renewal Trend (Full Width) */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Renewal Trend</h3>
                    <p className="text-[11px] font-medium text-slate-500">Renewal vs Non-Renewal trend</p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => openDrilldown('Renewed Policies', 'List of all renewed insurance policies', { policyType: 'RENEWAL' })}
                      className="flex items-center gap-1 hover:bg-emerald-50 px-2 py-0.5 rounded-full transition-colors cursor-pointer text-emerald-800"
                    >
                      <span className="h-2 w-2 rounded-full bg-emerald-500" /> Renewed
                    </button>
                    <button
                      type="button"
                      onClick={() => openDrilldown('Non-Renewal / New Policies', 'List of non-renewal policies', { policyType: 'NEW' })}
                      className="flex items-center gap-1 hover:bg-rose-50 px-2 py-0.5 rounded-full transition-colors cursor-pointer text-rose-800"
                    >
                      <span className="h-2 w-2 rounded-full bg-rose-500" /> Not Renewed
                    </button>
                  </div>
                </div>
                <div className="h-72 mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={renewalTrendData} stackOffset="expand">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} axisLine={false} />
                      <Tooltip formatter={(val: any) => `${val}%`} />
                      <Bar
                        dataKey="renewed"
                        name="Renewed"
                        stackId="a"
                        fill="#10b981"
                        radius={[0, 0, 0, 0]}
                        onClick={(entry: any) => openDrilldown(`Renewed Policies (${entry?.month || 'Selected Period'})`, 'List of renewed policies', { policyType: 'RENEWAL' })}
                        className="cursor-pointer hover:opacity-80 transition-opacity"
                      />
                      <Bar
                        dataKey="notRenewed"
                        name="Not Renewed"
                        stackId="a"
                        fill="#f43f5e"
                        radius={[4, 4, 0, 0]}
                        onClick={(entry: any) => openDrilldown(`Non-Renewal Policies (${entry?.month || 'Selected Period'})`, 'List of non-renewal policies', { policyType: 'NEW' })}
                        className="cursor-pointer hover:opacity-80 transition-opacity"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* 5. Top Executives Card (Full Width below chart) */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col justify-between mt-4">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Top Executives by Policies</h3>
                    <p className="text-[11px] font-medium text-slate-500">Executive performance by number of policies</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('executives')}
                    className="inline-flex items-center text-[11px] font-bold text-blue-600 hover:text-blue-800"
                  >
                    View all <ArrowRight className="ml-1 h-3 w-3" />
                  </button>
                </div>
                <div className="mt-3 space-y-2.5">
                  <div className="grid grid-cols-12 text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-1">
                    <span className="col-span-5">Executive / Advisor</span>
                    <span className="col-span-3 text-right">Policies</span>
                    <span className="col-span-4 text-right">Gross Premium</span>
                  </div>
                  {(summaryData.executives || []).slice(0, 5).map((exec: any) => (
                    <div
                      key={exec.executive}
                      onClick={() => openDrilldown(`Executive: ${exec.executive}`, 'Policies assigned to this executive', { rmName: exec.executive })}
                      className="grid grid-cols-12 items-center text-[11px] font-bold cursor-pointer p-1.5 rounded-lg hover:bg-slate-50"
                    >
                      <span className="col-span-5 text-slate-800 truncate">{exec.executive}</span>
                      <span className="col-span-3 text-right text-slate-600">{formatNumber(exec.policies)}</span>
                      <span className="col-span-4 text-right text-slate-950">{formatCurrency(exec.grossPremium)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>  </div>

            </div>
          </TabsContent>

          {/* TAB 2: REVENUE ANALYSIS */}
          <TabsContent value="revenue" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <ExecutiveKpiCard title="Net OD Part A" value={formatCurrency(kpis.netOdPremium)} trend="OD Premium" trendDirection="neutral" bgColor="bg-blue-600" icon={Briefcase} />
              <ExecutiveKpiCard title="TP Liability" value={formatCurrency(kpis.tpLiability)} trend="Third Party" trendDirection="neutral" bgColor="bg-emerald-500" icon={ShieldCheck} />
              <ExecutiveKpiCard title="Add-on Premium" value={formatCurrency(kpis.addonPremium)} trend="Add-ons" trendDirection="neutral" bgColor="bg-violet-600" icon={FileText} />
              <ExecutiveKpiCard title="Service Tax / GST" value={formatCurrency(kpis.serviceTax)} trend="Tax Amount" trendDirection="neutral" bgColor="bg-amber-500" icon={CreditCard} />
              <ExecutiveKpiCard title="Total IDV" value={formatCompactCurrency(kpis.totalIdv)} trend="Sum Insured" trendDirection="neutral" bgColor="bg-cyan-500" icon={Car} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 pb-3 border-b border-slate-100">Payment Collection Modes</h3>
                <div className="h-64 mt-4">
                  {summaryData.paymentModes?.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={summaryData.paymentModes}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="mode" tick={{ fill: '#64748b', fontSize: 10 }} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => formatCompactCurrency(v)} axisLine={false} />
                        <Tooltip formatter={(val) => formatCurrency(Number(val))} />
                        <Bar
                          dataKey="grossPremium"
                          name="Gross Premium"
                          fill="#10b981"
                          radius={[6, 6, 0, 0]}
                          onClick={(data: any) => openDrilldown(`Payment Mode: ${data?.mode}`, 'Policies collected via this payment mode', { paymentMode: String(data?.mode || '') })}
                          className="cursor-pointer"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 pb-3 border-b border-slate-100">Top Financing Partners</h3>
                <div className="space-y-2 mt-3 max-h-64 overflow-y-auto pr-1">
                  {(summaryData.financers || []).map((f: any) => (
                    <div
                      key={f.financer}
                      onClick={() => openDrilldown(`Financer: ${f.financer}`, 'Policies financed by this institution', { financer: f.financer })}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-[11px] font-bold cursor-pointer hover:bg-slate-100"
                    >
                      <span className="text-slate-800">{f.financer}</span>
                      <div className="text-right">
                        <span className="text-slate-950">{formatNumber(f.count)} policies</span>
                        <span className="ml-2 text-slate-500">({formatCompactCurrency(f.grossPremium)})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 3: RENEWALS & COMPLIANCE */}
          <TabsContent value="renewals" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">Policy Type Performance</h3>
                <div
                  onClick={() => openDrilldown('Renewal Policies', 'List of all renewal policies', { policyType: 'RENEWAL' })}
                  className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 cursor-pointer hover:bg-emerald-100/60"
                >
                  <div>
                    <p className="text-[10px] font-bold uppercase text-emerald-800">Renewal Policies</p>
                    <p className="mt-0.5 text-xl font-black text-emerald-950">{formatNumber(kpis.renewalCount)}</p>
                  </div>
                  <span className="rounded-full bg-emerald-200 px-3 py-1 text-[11px] font-black text-emerald-900">
                    {formatPercent(kpis.renewalRatePct)}
                  </span>
                </div>

                <div
                  onClick={() => openDrilldown('New Policies', 'List of all new insurance policies', { policyType: 'NEW' })}
                  className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 cursor-pointer hover:bg-blue-100/60"
                >
                  <div>
                    <p className="text-[10px] font-bold uppercase text-blue-800">New Policies</p>
                    <p className="mt-0.5 text-xl font-black text-blue-950">{formatNumber(kpis.newCount)}</p>
                  </div>
                  <span className="rounded-full bg-blue-200 px-3 py-1 text-[11px] font-black text-blue-900">
                    {formatPercent(kpis.totalPolicies > 0 ? (kpis.newCount / kpis.totalPolicies) * 100 : 0)}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">64VB Compliance Audit</h3>
                <div
                  onClick={() => openDrilldown('64VB Verified Policies', 'List of 64VB compliant policies', { status64vb: 'VERIFIED' })}
                  className="flex items-center justify-between rounded-xl border border-purple-200 bg-purple-50/70 p-3.5 cursor-pointer hover:bg-purple-100/60"
                >
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5 text-purple-600" />
                    <div>
                      <p className="text-[10px] font-bold uppercase text-purple-800">64VB Verified</p>
                      <p className="mt-0.5 text-xl font-black text-purple-950">{formatNumber(kpis.verified64vb)}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-purple-200 px-3 py-1 text-[11px] font-black text-purple-900">
                    {formatPercent(kpis.verifiedRatePct)}
                  </span>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 4: INSURANCE COMPANIES */}
          <TabsContent value="insurers" className="space-y-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 pb-3 border-b border-slate-100">Gross Premium by Insurance Company</h3>
              <div className="h-72 mt-4">
                {summaryData.companyBreakdown?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summaryData.companyBreakdown.slice(0, 8)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => formatCompactCurrency(v)} />
                      <YAxis type="category" dataKey="company" width={170} tick={{ fill: '#475569', fontSize: 10, fontWeight: 700 }} />
                      <Tooltip formatter={(val) => formatCurrency(Number(val))} />
                      <Bar
                        dataKey="grossPremium"
                        fill="#2563eb"
                        radius={[0, 6, 6, 0]}
                        onClick={(data: any) => openDrilldown(`Insurer: ${data?.company}`, 'Policies issued under this insurance company', { insuranceCompany: String(data?.company || '') })}
                        className="cursor-pointer"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          </TabsContent>

          {/* TAB 5: EXECUTIVE PERFORMANCE */}
          <TabsContent value="executives" className="space-y-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
              <Table className="text-[11px]">
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="font-bold text-slate-700 text-[11px]">Executive / RM Name</TableHead>
                    <TableHead className="font-bold text-slate-700 text-right text-[11px]">Policies Issued</TableHead>
                    <TableHead className="font-bold text-slate-700 text-right text-[11px]">Gross Premium</TableHead>
                    <TableHead className="font-bold text-slate-700 text-right text-[11px]">Renewals</TableHead>
                    <TableHead className="font-bold text-slate-700 text-center text-[11px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(summaryData.executives || []).map((exec: any) => (
                    <TableRow key={exec.executive} className="hover:bg-slate-50 cursor-pointer">
                      <TableCell className="font-bold text-slate-900 text-[11px]">{exec.executive}</TableCell>
                      <TableCell className="text-right font-semibold text-[11px]">{formatNumber(exec.policies)}</TableCell>
                      <TableCell className="text-right font-black text-blue-900 text-[11px]">{formatCurrency(exec.grossPremium)}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-700 text-[11px]">{formatNumber(exec.renewals)}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => openDrilldown(`Executive: ${exec.executive}`, 'Policies assigned to this executive', { rmName: exec.executive })}
                          className="h-6 text-[10px] font-bold text-blue-700 hover:bg-blue-50 px-2"
                        >
                          <Eye className="mr-1 h-3.5 w-3.5" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* TAB 6: VEHICLE & MODEL STATS */}
          <TabsContent value="vehicles" className="space-y-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 pb-3 border-b border-slate-100">Top Insured Vehicle Models</h3>
              <div className="h-72 mt-4">
                {summaryData.models?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summaryData.models.slice(0, 10)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="model" tick={{ fill: '#64748b', fontSize: 10 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                      <Tooltip formatter={(val) => formatNumber(Number(val))} />
                      <Bar
                        dataKey="count"
                        name="Policies"
                        fill="#8b5cf6"
                        radius={[6, 6, 0, 0]}
                        onClick={(data: any) => openDrilldown(`Model: ${data?.model}`, 'Policies for this vehicle model', { modelName: String(data?.model || '') })}
                        className="cursor-pointer"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          </TabsContent>

          {/* TAB 7: DEALER-WISE ANALYSIS */}
          {/* TAB 7: CUSTOMER RETENTION — one row = one VEHICLE (chassis), never a customer name. */}
          <TabsContent value="customers" className="space-y-4">
            {(() => {
              const vq = vehiclesQuery
              const k = vq.data?.kpis
              const rows: VehicleRow[] = vq.data?.rows || []
              const pg = vq.data?.pagination
              const loading = vq.isLoading
              const pctOfView = (n: number) =>
                k && k.vehiclesInScope ? `${Math.round((n / k.vehiclesInScope) * 1000) / 10}% of vehicles in view` : '—'

              if (vq.isError) {
                return (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
                    <AlertCircle className="mx-auto h-6 w-6 text-rose-500" />
                    <p className="mt-2 text-[13px] font-bold text-rose-900">Could not load vehicle retention</p>
                    <p className="mt-1 text-[11px] font-medium text-rose-700">
                      {(vq.error as Error)?.message || 'Please try again.'}
                    </p>
                  </div>
                )
              }

              return (
                <>
                  {/* Scope band — the only numbers the filter bar controls. */}
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Scoped to your filters</p>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                      <ExecutiveKpiCard
                        title="Vehicles in View"
                        value={loading ? '—' : formatNumber(k?.vehiclesInScope || 0)}
                        trend={loading ? '' : `${formatNumber(k?.policiesInScope || 0)} policies in this filter`}
                        trendDirection="neutral"
                        bgColor="bg-slate-800"
                        icon={Car}
                      />
                      <ExecutiveKpiCard
                        title="Came Back for Renewal"
                        value={loading ? '—' : formatNumber(k?.repeatVehicles || 0)}
                        trend={loading ? '' : pctOfView(k?.repeatVehicles || 0)}
                        trendDirection="up"
                        bgColor="bg-emerald-600"
                        icon={RefreshCw}
                        onClick={() => setVehBehaviour(vehBehaviour === 'repeat' ? 'all' : 'repeat')}
                      />
                      <ExecutiveKpiCard
                        title="Vehicle Retention Rate"
                        value={loading ? '—' : `${k?.retentionPct ?? 0}%`}
                        trend={loading ? '' : 'Cars that renewed with us at least once'}
                        trendDirection="neutral"
                        bgColor="bg-indigo-600"
                        icon={TrendingUp}
                      />
                      <ExecutiveKpiCard
                        title="Never Came Back"
                        value={loading ? '—' : formatNumber(k?.singleEventVehicles || 0)}
                        trend={loading ? '' : 'Only one policy in our data'}
                        trendDirection="neutral"
                        bgColor="bg-slate-500"
                        icon={Users}
                        onClick={() => setVehBehaviour(vehBehaviour === 'single' ? 'all' : 'single')}
                      />
                    </div>
                  </div>

                  {/* Lifetime band — deliberately NOT filter-scoped. Labelled so it cannot be misread. */}
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Lifetime history — the filters above do not apply
                      <AlertCircle className="h-3 w-3 text-slate-300" />
                    </p>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                      <ExecutiveKpiCard
                        title="Won Back After a Lapse"
                        value={loading ? '—' : formatNumber(k?.wonBack || 0)}
                        trend={loading ? '' : 'Cover lapsed 30+ days, then renewed'}
                        trendDirection="up"
                        bgColor="bg-violet-600"
                        icon={ArrowUpRight}
                        onClick={() => setVehBehaviour(vehBehaviour === 'wonback' ? 'all' : 'wonback')}
                      />
                      <ExecutiveKpiCard
                        title="Cover Expired — Not Renewed"
                        value={loading ? '—' : formatNumber(k?.expiredNotRenewed || 0)}
                        trend={loading ? '' : `${formatNumber(k?.expiring30 || 0)} more expire within 30 days`}
                        trendDirection="down"
                        bgColor="bg-rose-600"
                        icon={Clock}
                        onClick={() => setVehCoverStatus(vehCoverStatus === 'LAPSED' ? 'all' : 'LAPSED')}
                      />
                      <ExecutiveKpiCard
                        title="Switched Insurer"
                        value={loading ? '—' : formatNumber(k?.switchedInsurer || 0)}
                        trend={loading ? '' : 'Changed insurer at least once'}
                        trendDirection="neutral"
                        bgColor="bg-amber-600"
                        icon={ArrowRight}
                        onClick={() => setVehFlagSwitched(!vehFlagSwitched)}
                      />
                      <ExecutiveKpiCard
                        title="Ownership Changed"
                        value={loading ? '—' : formatNumber(k?.ownerNameDiffers || 0)}
                        trend={loading ? '' : 'Policy name differs across years'}
                        trendDirection="neutral"
                        bgColor="bg-cyan-600"
                        icon={Briefcase}
                        onClick={() => setVehFlagOwner(!vehFlagOwner)}
                      />
                    </div>
                  </div>

                  {/* The semantics banner. Without it the numbers read as a bug. */}
                  <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-600">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <p>
                      <span className="font-bold">Your filters choose which vehicles appear.</span> Each vehicle&apos;s
                      history — renewals, insurer switches, lapses — is always counted across every policy we hold for
                      that chassis: all years, all insurers, and both dealerships. Otherwise a car that renewed in 2024
                      and 2025 would look like a first-time customer the moment you filter to 2026.
                      {k?.alsoAtOtherDealer ? ` ${formatNumber(k.alsoAtOtherDealer)} of these cars are insured at both dealerships.` : ''}
                    </p>
                  </div>

                  {/* Filters */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="relative flex-1 min-w-56">
                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <Input
                          placeholder="Search chassis, registration or owner name..."
                          value={vehSearch}
                          onChange={(e) => setVehSearch(e.target.value)}
                          className="h-9 pl-8 text-xs border-slate-200 rounded-xl"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
                        {([
                          ['all', 'All Vehicles'],
                          ['repeat', 'Came Back'],
                          ['single', 'Never Returned'],
                          ['wonback', 'Won Back'],
                        ] as const).map(([v, label]) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setVehBehaviour(v)}
                            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all ${
                              vehBehaviour === v ? 'bg-[#071a2b] text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <Select value={vehCoverStatus} onValueChange={setVehCoverStatus}>
                        <SelectTrigger className="h-9 w-40 text-[11px] font-bold border-slate-200 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Any cover status</SelectItem>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="EXPIRING_30">Expiring in 30 days</SelectItem>
                          <SelectItem value="EXPIRING_90">Expiring in 90 days</SelectItem>
                          <SelectItem value="LAPSED">Lapsed (under a year)</SelectItem>
                          <SelectItem value="LOST">Lost (over a year)</SelectItem>
                          <SelectItem value="TP_ONLY">Third-party only</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={vehSort} onValueChange={setVehSort}>
                        <SelectTrigger className="h-9 w-40 text-[11px] font-bold border-slate-200 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="renewals">Most Renewals</SelectItem>
                          <SelectItem value="dueSoonest">Renewal Due Soonest</SelectItem>
                          <SelectItem value="premium">Highest Lifetime Premium</SelectItem>
                          <SelectItem value="recent">Most Recent Policy</SelectItem>
                          <SelectItem value="switches">Most Insurer Switches</SelectItem>
                          <SelectItem value="oldest">Longest-Standing</SelectItem>
                        </SelectContent>
                      </Select>
                      {([
                        ['Ownership changed', vehFlagOwner, () => setVehFlagOwner(!vehFlagOwner), k?.ownerNameDiffers],
                        ['Switched insurer', vehFlagSwitched, () => setVehFlagSwitched(!vehFlagSwitched), k?.switchedInsurer],
                      ] as const).map(([label, active, toggle, count]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={toggle}
                          className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all ${
                            active ? 'border-[#071a2b] bg-[#071a2b] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          {label}{count ? ` (${formatNumber(count)})` : ''}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Vehicle table */}
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                      <p className="text-[11px] font-bold text-slate-700">
                        {loading ? 'Loading vehicles…' : `${formatNumber(pg?.total || 0)} vehicles`}
                        {!loading && pg && pg.total > 0 ? ` · page ${pg.page} of ${pg.totalPages}` : ''}
                      </p>
                      {vq.isFetching && !loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                    </div>
                    <div className="overflow-x-auto">
                      <Table className="w-full text-[11px]">
                        <TableHeader className="bg-slate-50">
                          <TableRow>
                            <TableHead className="font-bold text-slate-700 text-[11px] w-8">#</TableHead>
                            <TableHead className="font-bold text-slate-700 text-[11px]">Vehicle</TableHead>
                            <TableHead className="font-bold text-slate-700 text-[11px]">Model</TableHead>
                            <TableHead className="font-bold text-slate-700 text-[11px]">Owner</TableHead>
                            <TableHead className="font-bold text-slate-700 text-[11px]">Journey</TableHead>
                            <TableHead className="font-bold text-emerald-700 text-center text-[11px]">Renewals</TableHead>
                            <TableHead className="font-bold text-slate-700 text-[11px]">Cover Status</TableHead>
                            <TableHead className="font-bold text-slate-700 text-[11px]">Renewal Due</TableHead>
                            <TableHead className="font-bold text-slate-700 text-[11px]">Insurer</TableHead>
                            <TableHead className="font-bold text-slate-700 text-right text-[11px]">Lifetime Premium</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {loading ? (
                            <TableRow>
                              <TableCell colSpan={10} className="py-16 text-center">
                                <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-300" />
                              </TableCell>
                            </TableRow>
                          ) : rows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={10} className="py-16 text-center text-[12px] font-semibold text-slate-400">
                                No vehicles match these filters.
                              </TableCell>
                            </TableRow>
                          ) : rows.map((v, idx) => (
                            <TableRow
                              key={v.chassisNo}
                              className={`hover:bg-slate-50/80 cursor-pointer ${v.isRepeatVehicle ? 'bg-emerald-50/25' : ''}`}
                              onClick={() => openDrilldown(
                                `Vehicle ${v.chassisNo}`,
                                `${v.modelName || 'Vehicle'} · ${v.currentOwner || 'Unknown owner'} — full policy history, all years and both dealerships`,
                                { chassisNo: v.chassisNo, includeOther: '1', sort: 'policy_start_date', direction: 'asc' },
                              )}
                            >
                              <TableCell className="text-[10px] text-slate-400 font-semibold">
                                {((pg?.page || 1) - 1) * (pg?.pageSize || 50) + idx + 1}
                              </TableCell>
                              <TableCell>
                                <p className="font-mono font-bold text-[11px] tracking-tight text-slate-900">{v.chassisNo}</p>
                                <p className="text-[9px] font-semibold text-slate-500">
                                  {v.vehRegistNo || 'No registration'}
                                  {v.alsoAtOtherDealer && <span className="ml-1 text-cyan-600" title="Also insured at the other dealership">⇄ both</span>}
                                </p>
                              </TableCell>
                              <TableCell>
                                <p className="font-bold text-slate-800 text-[11px]">{v.modelName || '—'}</p>
                                <p className="text-[9px] text-slate-500">
                                  {[v.variantName, v.fuelType, v.mfgYear].filter(Boolean).join(' · ')}
                                </p>
                              </TableCell>
                              <TableCell className="max-w-40">
                                <p className="font-bold text-slate-800 text-[11px] truncate" title={v.currentOwner}>{v.currentOwner || '—'}</p>
                                {v.ownerChanged && (
                                  <span
                                    className="text-[9px] font-bold text-amber-600"
                                    title={v.previousOwner ? `Previously: ${v.previousOwner}. Names differ after ignoring titles and initials — most are genuine transfers, some are data entry.` : 'Name differs across years'}
                                  >
                                    ⇄ Name differs
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap items-center gap-0.5">
                                  {(v.journey || []).map((j: JourneyEvent, i: number) => (
                                    <span key={i} className="flex items-center gap-0.5">
                                      {j.gap > 0 && <span className="text-[9px] font-black text-rose-400" title={`${j.gap} day gap in cover`}>⋯</span>}
                                      <span
                                        title={`${j.type || ''} ${j.y ? `'${j.y}` : ''} · ${j.ins || ''}`}
                                        className={`rounded px-1 py-0.5 text-[9px] font-black ${
                                          j.type === 'RENEWAL' ? 'bg-emerald-100 text-emerald-700'
                                            : j.type === 'ROLLOVER' ? 'bg-violet-100 text-violet-700'
                                            : 'bg-blue-100 text-blue-700'
                                        }`}
                                      >
                                        {j.y}
                                      </span>
                                    </span>
                                  ))}
                                  {v.tpOnlyPolicies > 0 && (
                                    <span className="ml-0.5 text-[9px] font-bold text-slate-400" title="Standalone third-party / CPA top-ups — not renewal events">
                                      +{v.tpOnlyPolicies} TP
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-center">
                                <span className={v.renewalEvents >= 2 ? 'text-base font-black text-slate-900' : 'text-[11px] font-bold text-slate-400'}>
                                  {v.renewalEvents}
                                </span>
                              </TableCell>
                              <TableCell>
                                <CoverStatusPill status={v.coverStatus} days={v.daysToExpiry} />
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                <p className="text-[10px] font-semibold text-slate-600">{formatDate(v.lastOdExpiry)}</p>
                                {v.daysToExpiry !== null && (
                                  <p className={`text-[9px] font-bold ${v.daysToExpiry < 0 ? 'text-rose-500' : 'text-slate-500'}`}>
                                    {v.daysToExpiry < 0 ? `${Math.abs(v.daysToExpiry)} days ago` : `in ${v.daysToExpiry} days`}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="max-w-32">
                                <p className="text-[10px] font-semibold text-slate-600 truncate" title={v.currentInsurer}>{v.currentInsurer || '—'}</p>
                                {v.insurerSwitches > 0 && (
                                  <span className="text-[9px] font-bold text-amber-600" title="Changed insurer during their history">
                                    ↻ {v.insurerSwitches} switch{v.insurerSwitches > 1 ? 'es' : ''}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-black text-blue-900">
                                {formatCurrency(v.lifetimeGrossPremium)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {pg && pg.totalPages > 1 && (
                      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
                        <p className="text-[11px] font-semibold text-slate-500">
                          Showing {formatNumber((pg.page - 1) * pg.pageSize + 1)}–
                          {formatNumber(Math.min(pg.page * pg.pageSize, pg.total))} of {formatNumber(pg.total)}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline" size="sm" className="h-8 rounded-lg text-[11px]"
                            disabled={pg.page <= 1}
                            onClick={() => setVehPage((p) => Math.max(1, p - 1))}
                          >
                            <ChevronLeft className="h-3.5 w-3.5" /> Prev
                          </Button>
                          <Button
                            variant="outline" size="sm" className="h-8 rounded-lg text-[11px]"
                            disabled={pg.page >= pg.totalPages}
                            onClick={() => setVehPage((p) => p + 1)}
                          >
                            Next <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="px-1 text-[10px] text-slate-400">
                    Records begin 27 Dec 2022
                    {k?.preWindowHistory ? ` — ${formatNumber(k.preWindowHistory)} of these cars were already insured before that date, so "first seen" is not "first ever"` : ''}.
                    A renewal event is a policy carrying own-damage cover; standalone third-party top-ups are shown as
                    &quot;+n TP&quot;. This feed records policies issued, so premium figures are gross of any cancellation.
                  </p>
                </>
              )
            })()}
          </TabsContent>

          {/* TAB 8: POLICY REGISTER TABLE */}
          <TabsContent value="register" className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search policy no, customer, chassis, reg no..."
                  value={tableSearch}
                  onChange={(e) => {
                    setTableSearch(e.target.value)
                    setTablePage(1)
                  }}
                  className="pl-8 h-8 rounded-xl border-slate-200 text-[11px] font-semibold"
                />
              </div>
              <Button
                type="button"
                onClick={handleExportCsv}
                className="h-8 rounded-xl bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 shadow-xs"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
              <Table className="text-[11px]">
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="font-bold text-slate-700 text-[11px]">Policy / Proposal</TableHead>
                    <TableHead className="font-bold text-slate-700 text-[11px]">Customer Name</TableHead>
                    <TableHead className="font-bold text-slate-700 text-[11px]">Insurer</TableHead>
                    <TableHead className="font-bold text-slate-700 text-[11px]">Model / Reg No</TableHead>
                    <TableHead className="font-bold text-slate-700 text-[11px]">Type</TableHead>
                    <TableHead className="font-bold text-slate-700 text-right text-[11px]">Gross Premium</TableHead>
                    <TableHead className="font-bold text-slate-700 text-[11px]">64VB Status</TableHead>
                    <TableHead className="font-bold text-slate-700 text-[11px]">Issue Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policiesQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />
                        <p className="mt-2 text-[11px] font-semibold text-slate-500">Loading policy register...</p>
                      </TableCell>
                    </TableRow>
                  ) : policiesQuery.data?.rows?.length ? (
                    policiesQuery.data.rows.map((r: any) => (
                      <TableRow
                        key={r.id}
                        onClick={() => setSelectedPolicyRecord(r)}
                        className="cursor-pointer hover:bg-slate-50 transition-colors"
                      >
                        <TableCell>
                          <p className="font-bold text-slate-900 text-[11px]">{r.policy_no || 'NA'}</p>
                          <p className="text-[9px] font-semibold text-slate-500">Prop: {r.proposal_no || 'NA'}</p>
                        </TableCell>
                        <TableCell className="font-bold text-slate-800 text-[11px]">{r.customer_name || 'NA'}</TableCell>
                        <TableCell className="text-[11px] font-semibold text-slate-700">{r.insurance_company || 'NA'}</TableCell>
                        <TableCell>
                          <p className="font-bold text-slate-900 text-[11px]">{r.model_name || 'NA'}</p>
                          <p className="text-[9px] font-semibold text-slate-500">{r.veh_regist_no || 'Unregistered'}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="rounded-full text-[9px] font-bold uppercase">
                            {r.policy_type || 'Renewal'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-black text-blue-900 text-[11px]">{formatCurrency(r.gross_premium)}</TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold',
                              r.column_64vb_status === 'VERIFIED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            )}
                          >
                            {r.column_64vb_status || 'NOT VERIFIED'}
                          </span>
                        </TableCell>
                        <TableCell className="text-[11px] font-semibold text-slate-600">{formatDate(r.policy_issue_date)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-xs font-semibold text-slate-500">
                        No policy records found matching your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {policiesQuery.data && (
              <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-xs">
                <p className="font-semibold text-slate-500">
                  Page {policiesQuery.data.page} of {policiesQuery.data.totalPages} ({formatNumber(policiesQuery.data.totalCount)} total policies)
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={tablePage <= 1}
                    onClick={() => setTablePage((p) => p - 1)}
                    className="h-7 rounded-full border-slate-200 text-xs font-bold"
                  >
                    <ChevronLeft className="mr-1 h-3 w-3" /> Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={tablePage >= policiesQuery.data.totalPages}
                    onClick={() => setTablePage((p) => p + 1)}
                    className="h-7 rounded-full border-slate-200 text-xs font-bold"
                  >
                    Next <ChevronRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* TAB: POLICY TYPE DEEP ANALYSIS */}
          <TabsContent value="policy-types" className="space-y-5">
            {/* Section Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-black text-slate-900">Policy Type Deep Analysis</h2>
                <p className="text-[11px] font-medium text-slate-500 mt-0.5">Full breakdown of New, Renewal, Rollover and other policy types across all dimensions</p>
              </div>
            </div>

            {/* KPI Cards per Policy Type */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(summaryData.policyTypeDeep || []).map((pt: any) => {
                const typeColors: Record<string, { bg: string; border: string; text: string; badge: string; accent: string }> = {
                  RENEWAL:    { bg: 'bg-white',  border: 'border-slate-200', text: 'text-slate-800', badge: 'bg-emerald-600', accent: 'border-l-emerald-500' },
                  NEW:        { bg: 'bg-white',  border: 'border-slate-200', text: 'text-slate-800', badge: 'bg-blue-600',    accent: 'border-l-blue-500' },
                  ROLLOVER:   { bg: 'bg-white',  border: 'border-slate-200', text: 'text-slate-800', badge: 'bg-violet-600',  accent: 'border-l-violet-500' },
                  Unspecified:{ bg: 'bg-white',  border: 'border-slate-200', text: 'text-slate-700', badge: 'bg-slate-500',   accent: 'border-l-slate-400' },
                }
                const c = typeColors[pt.type] || typeColors.Unspecified
                return (
                  <div
                    key={pt.type}
                    className={`rounded-2xl border-l-4 border ${c.border} ${c.accent} ${c.bg} p-5 shadow-xs cursor-pointer hover:shadow-md transition-all`}
                    onClick={() => openDrilldown(`${pt.type} Policies`, `All policies with type: ${pt.type}`, { policyType: pt.type })}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white ${c.badge}`}>{pt.type}</span>
                        <p className="mt-2 text-2xl font-black text-slate-900">{formatNumber(pt.totalCount)}</p>
                        <p className="text-[11px] font-semibold text-slate-500">Policies</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-black text-slate-900">{formatPercent(pt.sharePct)}</p>
                        <p className="text-[10px] text-slate-500 font-semibold">of total</p>
                      </div>
                    </div>
                    <div className="space-y-1.5 border-t border-slate-200/60 pt-3">
                      <div className="flex justify-between text-[11px]">
                        <span className="font-semibold text-slate-500">Gross Premium</span>
                        <span className="font-black text-slate-900">{formatCurrency(pt.grossPremium)}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="font-semibold text-slate-500">Avg Premium</span>
                        <span className="font-bold text-slate-700">{formatCurrency(pt.avgGrossPremium)}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="font-semibold text-slate-500">Premium Share</span>
                        <span className="font-bold text-slate-700">{formatPercent(pt.premiumSharePct)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Premium Breakdown Cards: OD vs TP vs Addon per type */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <div className="pb-3 border-b border-slate-100 mb-4">
                <h3 className="text-sm font-bold text-slate-900">Premium Composition by Policy Type</h3>
                <p className="text-[11px] font-medium text-slate-500">OD Premium vs TP Liability vs Add-on Premium breakdown</p>
              </div>
              <div className="overflow-x-auto">
                <Table className="w-full text-[11px]">
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="font-bold text-slate-700 text-[11px]">Policy Type</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Policies</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Gross Premium</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Net Premium</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">OD Premium</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">TP Liability</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Addon Premium</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Avg Premium</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right text-[11px]">Avg IDV</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(summaryData.policyTypeDeep || []).map((pt: any) => (
                      <TableRow
                        key={pt.type}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => openDrilldown(`${pt.type} Policies`, `All policies of type: ${pt.type}`, { policyType: pt.type })}
                      >
                        <TableCell>
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                            {pt.type}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-bold text-slate-900 text-[11px]">{formatNumber(pt.totalCount)}</TableCell>
                        <TableCell className="text-right font-black text-blue-900 text-[11px]">{formatCurrency(pt.grossPremium)}</TableCell>
                        <TableCell className="text-right font-bold text-slate-800 text-[11px]">{formatCurrency(pt.netPremium)}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-700 text-[11px]">{formatCurrency(pt.netOdPremium)}</TableCell>
                        <TableCell className="text-right font-semibold text-amber-700 text-[11px]">{formatCurrency(pt.tpLiability)}</TableCell>
                        <TableCell className="text-right font-semibold text-violet-700 text-[11px]">{formatCurrency(pt.addonPremium)}</TableCell>
                        <TableCell className="text-right text-slate-700 text-[11px]">{formatCurrency(pt.avgGrossPremium)}</TableCell>
                        <TableCell className="text-right text-slate-700 text-[11px]">{formatCurrency(pt.avgIdv)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Two-col row: 64VB Compliance + Addon Adoption per type */}
            <div className="grid gap-4 xl:grid-cols-2">
              {/* 64VB Compliance by Type */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <div className="pb-3 border-b border-slate-100 mb-4">
                  <h3 className="text-sm font-bold text-slate-900">64VB Verification Rate by Type</h3>
                  <p className="text-[11px] font-medium text-slate-500">Compliance status split per policy type</p>
                </div>
                <div className="space-y-3">
                  {(summaryData.policyTypeDeep || []).map((pt: any) => (
                    <div key={pt.type}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-slate-700">{pt.type}</span>
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="text-emerald-700 font-bold">{formatNumber(pt.verified64vb)} verified</span>
                          <span className="text-rose-600 font-semibold">{formatNumber(pt.notVerified64vb)} not verified</span>
                          <span className="font-black text-slate-900">{formatPercent(pt.verifiedPct)}</span>
                        </div>
                      </div>
                      <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, pt.verifiedPct)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Addon Adoption + Top Insurer / Mode per type */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <div className="pb-3 border-b border-slate-100 mb-4">
                  <h3 className="text-sm font-bold text-slate-900">Type Profile: Addon Adoption & Key Attributes</h3>
                  <p className="text-[11px] font-medium text-slate-500">Add-on adoption rate, top insurer, payment mode and fuel type per policy type</p>
                </div>
                <div className="space-y-4">
                  {(summaryData.policyTypeDeep || []).map((pt: any) => (
                    <div key={pt.type} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-black text-slate-900">{pt.type}</span>
                        <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-200">
                          {formatPercent(pt.addonAdoptionPct)} addon opted
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-[9px] font-bold uppercase text-slate-400">Top Insurer</p>
                          <p className="text-[10px] font-bold text-slate-800 truncate" title={pt.topInsurer}>{pt.topInsurer}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase text-slate-400">Top Payment</p>
                          <p className="text-[10px] font-bold text-slate-800">{pt.topPaymentMode}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase text-slate-400">Top Fuel</p>
                          <p className="text-[10px] font-bold text-slate-800">{pt.topFuelType}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Stacked Bar: Policy Type Mix Over Time */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Policy Type Mix — Monthly Trend</h3>
                  <p className="text-[11px] font-medium text-slate-500">How the ratio of New vs Renewal vs Rollover policies has evolved over time</p>
                </div>
              </div>
              <div className="h-72">
                {(() => {
                  // Build pivot: { monthKey, monthLabel, NEW: n, RENEWAL: n, ROLLOVER: n, ... }
                  const pivotMap: Record<string, any> = {}
                  const allTypes = new Set<string>()
                  ;(summaryData.policyTypeTrend || []).forEach((r: any) => {
                    if (!pivotMap[r.monthKey]) pivotMap[r.monthKey] = { monthLabel: r.monthLabel }
                    pivotMap[r.monthKey][r.type] = r.count
                    allTypes.add(r.type)
                  })
                  const chartData = Object.values(pivotMap)
                  const typeColorMap: Record<string, string> = {
                    RENEWAL: '#10b981', NEW: '#3b82f6', ROLLOVER: '#8b5cf6',
                    Unspecified: '#94a3b8',
                  }
                  return chartData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="monthLabel" tick={{ fill: '#64748b', fontSize: 9 }} angle={-25} textAnchor="end" interval={Math.ceil(chartData.length / 18)} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} />
                        <Tooltip />
                        {Array.from(allTypes).map((t) => (
                          <Bar
                            key={t}
                            dataKey={t}
                            name={t}
                            stackId="a"
                            fill={typeColorMap[t] || '#64748b'}
                            onClick={() => openDrilldown(`${t} Policies`, `All policies of type: ${t}`, { policyType: t })}
                            className="cursor-pointer"
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState title="No trend data" body="No monthly policy type data available for the selected filters." />
                })()}
              </div>
            </div>
          </TabsContent>

        </Tabs>

      </div>

      {/* POPUP MODAL 1: DRILL-DOWN POLICIES LIST */}
      <Dialog open={drilldownModal.open} onOpenChange={(open) => setDrilldownModal((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-[97vw] lg:max-w-[92vw] xl:max-w-[88vw] 2xl:max-w-[1520px] w-full max-h-[90vh] overflow-y-auto rounded-3xl p-6 sm:p-8">
          <DialogHeader className="border-b border-slate-100 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg font-black text-slate-900">{drilldownModal.title}</DialogTitle>
                  {modalPoliciesQuery.data?.totalCount !== undefined && (
                    <Badge variant="secondary" className="bg-blue-100 text-blue-900 text-[11px] font-black">
                      {formatNumber(modalPoliciesQuery.data.totalCount)} Total Policies
                    </Badge>
                  )}
                </div>
                <DialogDescription className="text-[11px] text-slate-500">{drilldownModal.subtitle}</DialogDescription>
              </div>

              {/* Modal Search Bar */}
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Filter within this analysis..."
                  value={modalSearch}
                  onChange={(e) => {
                    setModalSearch(e.target.value)
                    setModalPage(1)
                  }}
                  className="pl-8 h-8 text-[11px] rounded-xl border-slate-200"
                />
              </div>
            </div>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {modalPoliciesQuery.isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
                <p className="mt-2 text-[11px] font-semibold text-slate-500">Fetching drilldown policies...</p>
              </div>
            ) : modalPoliciesQuery.data?.rows?.length ? (
              <>
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <Table className="w-full text-[11px]">
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="font-bold text-slate-700 text-[11px]">Policy No</TableHead>
                        <TableHead className="font-bold text-slate-700 text-[11px]">Customer</TableHead>
                        <TableHead className="font-bold text-slate-700 text-[11px]">Insurer</TableHead>
                        <TableHead className="font-bold text-slate-700 text-[11px]">Model / Reg No</TableHead>
                        <TableHead className="font-bold text-slate-700 text-[11px]">Type</TableHead>
                        <TableHead className="font-bold text-slate-700 text-right text-[11px]">Gross Premium</TableHead>
                        <TableHead className="font-bold text-slate-700 text-[11px]">Issue Date (IST)</TableHead>
                        <TableHead className="font-bold text-slate-700 text-center text-[11px]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modalPoliciesQuery.data.rows.map((row: any) => {
                        const policyTypeLower = (row.policy_type || '').toLowerCase().trim()
                        const isRenewal = policyTypeLower === 'renewal'
                        const typeLabel = row.policy_type || 'Unknown'
                        return (
                          <TableRow key={row.id} className={`hover:bg-slate-50/80 ${!isRenewal ? 'bg-rose-50/20' : ''}`}>
                            <TableCell className="font-bold text-slate-900 text-[11px]">{row.policy_no || 'NA'}</TableCell>
                            <TableCell className="font-bold text-slate-800 text-[11px]">{row.customer_name || 'NA'}</TableCell>
                            <TableCell className="text-[11px] font-semibold text-slate-700">{row.insurance_company || 'NA'}</TableCell>
                            <TableCell>
                              <p className="font-bold text-slate-900 text-[11px]">{row.model_name || 'NA'}</p>
                              <p className="text-[9px] font-semibold text-slate-500">{row.veh_regist_no || 'Unregistered'}</p>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {isRenewal ? (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 whitespace-nowrap">
                                  ✓ {typeLabel}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 whitespace-nowrap">
                                  ● {typeLabel}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-black text-blue-900 text-[11px]">{formatCurrency(row.gross_premium)}</TableCell>
                            <TableCell className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">{formatDate(row.policy_issue_date)}</TableCell>
                            <TableCell className="text-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedPolicyRecord(row)}
                                className="h-6 text-[10px] font-bold text-blue-700 hover:bg-blue-50 px-2"
                              >
                                <Eye className="mr-1 h-3.5 w-3.5" /> Full Record
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Modal Pagination Footer */}
                {modalPoliciesQuery.data && (
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-semibold">
                    <p className="text-slate-500">
                      Page <span className="font-bold text-slate-900">{modalPoliciesQuery.data.page}</span> of{' '}
                      <span className="font-bold text-slate-900">{modalPoliciesQuery.data.totalPages}</span> ({formatNumber(modalPoliciesQuery.data.totalCount)} total policies)
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={modalPage <= 1}
                        onClick={() => setModalPage((p) => Math.max(1, p - 1))}
                        className="h-7 rounded-full border-slate-200 text-xs font-bold"
                      >
                        <ChevronLeft className="mr-1 h-3 w-3" /> Previous
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={modalPage >= modalPoliciesQuery.data.totalPages}
                        onClick={() => setModalPage((p) => p + 1)}
                        className="h-7 rounded-full border-slate-200 text-xs font-bold"
                      >
                        Next <ChevronRight className="ml-1 h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <EmptyState title="No policies found" body="No policy records match this specific analysis filter." />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* POPUP MODAL 2: FULL POLICY RECORD INSPECTOR */}
      <Dialog open={Boolean(selectedPolicyRecord)} onOpenChange={(open) => !open && setSelectedPolicyRecord(null)}>
        <DialogContent className="max-w-[92vw] lg:max-w-[75vw] xl:max-w-[65vw] 2xl:max-w-[1100px] w-full max-h-[90vh] overflow-y-auto rounded-3xl p-6 sm:p-8">
          <DialogHeader className="border-b border-slate-100 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <Badge variant="outline" className="bg-blue-50 text-blue-800 text-[10px] font-bold uppercase mb-1">
                  {selectedPolicyRecord?.policy_type || 'Policy'} Record
                </Badge>
                <DialogTitle className="text-lg font-black text-slate-950">
                  {selectedPolicyRecord?.policy_no || 'Policy Inspector'}
                </DialogTitle>
                <DialogDescription className="text-[11px] font-semibold text-slate-500">
                  Customer: {selectedPolicyRecord?.customer_name || 'NA'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedPolicyRecord && (
            <div className="mt-4 space-y-5 text-xs">
              <div className="grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-3.5 border border-slate-200/80">
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-500">Gross Premium</p>
                  <p className="mt-0.5 text-base font-black text-blue-900">{formatCurrency(selectedPolicyRecord.gross_premium)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-500">Net Premium</p>
                  <p className="mt-0.5 text-base font-black text-slate-900">{formatCurrency(selectedPolicyRecord.net_premium)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-500">Total IDV</p>
                  <p className="mt-0.5 text-base font-black text-slate-900">{formatCompactCurrency(selectedPolicyRecord.total_idv)}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200/80 p-3.5 space-y-2 text-[11px]">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Policy Details</p>
                  <div className="flex justify-between"><span className="text-slate-500">Proposal No:</span> <span className="font-bold text-slate-900">{selectedPolicyRecord.proposal_no || 'NA'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Insurer:</span> <span className="font-bold text-slate-900">{selectedPolicyRecord.insurance_company || 'NA'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Policy Type:</span> <span className="font-bold text-slate-900">{selectedPolicyRecord.policy_type || 'NA'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">64VB Status:</span> <span className="font-bold text-slate-900">{selectedPolicyRecord.column_64vb_status || 'NA'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Payment Mode:</span> <span className="font-bold text-slate-900">{selectedPolicyRecord.payment_mode || 'NA'}</span></div>
                </div>

                <div className="rounded-2xl border border-slate-200/80 p-3.5 space-y-2 text-[11px]">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Vehicle Details</p>
                  <div className="flex justify-between"><span className="text-slate-500">Model Name:</span> <span className="font-bold text-slate-900">{selectedPolicyRecord.model_name || 'NA'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Variant:</span> <span className="font-bold text-slate-900">{selectedPolicyRecord.variant_name || 'NA'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Reg No:</span> <span className="font-bold text-slate-900">{selectedPolicyRecord.veh_regist_no || 'NA'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Chassis No:</span> <span className="font-bold text-slate-900">{selectedPolicyRecord.chassis_no || 'NA'}</span></div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 p-3.5 grid gap-3 sm:grid-cols-3 text-[11px]">
                <div><p className="text-[9px] font-bold uppercase text-slate-400">Issue Date</p><p className="mt-0.5 font-bold text-slate-900">{formatDate(selectedPolicyRecord.policy_issue_date)}</p></div>
                <div><p className="text-[9px] font-bold uppercase text-slate-400">Start Date</p><p className="mt-0.5 font-bold text-slate-900">{formatDate(selectedPolicyRecord.policy_start_date)}</p></div>
                <div><p className="text-[9px] font-bold uppercase text-slate-400">OD Expiry Date</p><p className="mt-0.5 font-bold text-slate-900">{formatDate(selectedPolicyRecord.od_expiry_date)}</p></div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 p-3.5 grid gap-3 sm:grid-cols-3 text-[11px]">
                <div><p className="text-[9px] font-bold uppercase text-slate-400">Dealer Code</p><p className="mt-0.5 font-bold text-slate-900">{selectedPolicyRecord.dealer_code || 'NA'}</p></div>
                <div><p className="text-[9px] font-bold uppercase text-slate-400">Sub User Branch</p><p className="mt-0.5 font-bold text-slate-900">{selectedPolicyRecord.sub_user || 'NA'}</p></div>
                <div><p className="text-[9px] font-bold uppercase text-slate-400">RM / Executive</p><p className="mt-0.5 font-bold text-slate-900">{selectedPolicyRecord.rm_name || selectedPolicyRecord.dp_name || 'NA'}</p></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
