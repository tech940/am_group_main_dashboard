'use client'

import { useState, useDeferredValue, useMemo, ComponentProps } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ShieldCheck,
  Building2,
  TrendingUp,
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
  Loader2,
  AlertCircle,
  BarChart3,
  Briefcase,
  SlidersHorizontal,
  ArrowRight,
  IndianRupee,
  Calendar,
  X,
  PieChart as PieChartIcon,
  Sparkles,
  Zap,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer as RechartsResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RenewalPipelinePanel } from '@/features/insurance/renewal-pipeline-panel'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type SearchParamsInput = Record<string, string | string[] | undefined>

type InsuranceType = 'hyundai' | 'platinum' | 'kia'

const BRAND_TABS: { id: InsuranceType; label: string; initial: string; badge: string }[] = [
  { id: 'hyundai', label: 'Hyundai Insurance', initial: 'H', badge: 'JAM Hyundai' },
  { id: 'platinum', label: 'Platinum Insurance', initial: 'P', badge: 'Platinum' },
  { id: 'kia', label: 'Kia Insurance', initial: 'K', badge: 'AM Kia' },
]

/**
 * Consolidated 4 Main Executive Workspaces
 */
type DashboardWorkspace = 'overview' | 'renewals' | 'performance' | 'register'

const WORKSPACE_TABS: { id: DashboardWorkspace; label: string; icon: any; description: string }[] = [
  {
    id: 'overview',
    label: 'Executive Overview',
    icon: BarChart3,
    description: 'Portfolio KPIs, revenue trends, and policy type mix',
  },
  {
    id: 'renewals',
    label: 'Renewal & Retention Command',
    icon: RefreshCw,
    description: 'Forward expiry book, retention cohorts & won-back tracker',
  },
  {
    id: 'performance',
    label: 'Partners & Team Performance',
    icon: Briefcase,
    description: 'Insurance companies, RM leaderboard & vehicle models',
  },
  {
    id: 'register',
    label: 'Policy Register',
    icon: FileText,
    description: 'Searchable master policy records and export',
  },
]

type BrandCapabilities = {
  has64vb?: boolean
  hasNcb?: boolean
  hasOdTpSplit?: boolean
  hasSubUser?: boolean
  hasRmName?: boolean
  hasDpName?: boolean
  hasFinancer?: boolean
  hasAddons?: boolean
  hasRegistration?: boolean
  hasCrossDealerHistory?: boolean
  hasRollover?: boolean
  hasIdv?: boolean
  hasPremiumSplit?: boolean
  hasMultiDealer?: boolean
  hasCancelledFlag?: boolean
}

const DONUT_COLORS_POLICY_TYPE = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4']

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
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}

function ResponsiveContainer(props: ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-6 py-8 text-center">
      <BarChart3 className="h-7 w-7 text-slate-400" />
      <p className="mt-2 text-xs font-bold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">{body}</p>
    </div>
  )
}

/** First and last day of the CURRENT month in IST */
function currentMonthRangeIst(): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, '0')
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

/** First and last day of the PREVIOUS month in IST */
function previousMonthRangeIst(): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  let year = Number(parts.find((part) => part.type === 'year')?.value)
  let month = Number(parts.find((part) => part.type === 'month')?.value) - 1
  if (month === 0) {
    month = 12
    year -= 1
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, '0')
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

export function InsuranceClient({ initialSearchParams }: { initialSearchParams: SearchParamsInput }) {
  const router = useRouter()
  const pathname = usePathname()

  // Primary Brand Type: Hyundai | Platinum | Kia
  const [insuranceType, setInsuranceType] = useState<InsuranceType>(() => {
    const raw = Array.isArray(initialSearchParams.type) ? initialSearchParams.type[0] : initialSearchParams.type
    return raw === 'platinum' || raw === 'kia' ? raw : 'hyundai'
  })

  // Active Workspace
  const [activeWorkspace, setActiveWorkspace] = useState<DashboardWorkspace>('overview')

  // Date Range Defaults (All History default so live data displays immediately)
  const defaultMonthRange = useMemo(() => currentMonthRangeIst(), [])
  const [appliedStartDate, setAppliedStartDate] = useState<string>('')
  const [appliedEndDate, setAppliedEndDate] = useState<string>('')
  const [appliedYear, setAppliedYear] = useState<string>('all')

  const [pendingStartDate, setPendingStartDate] = useState<string>('')
  const [pendingEndDate, setPendingEndDate] = useState<string>('')
  const [pendingYear, setPendingYear] = useState<string>('all')
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false)
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false)

  // Secondary Filter States
  const [appliedDealerCode, setAppliedDealerCode] = useState<string>('all')
  const [appliedSubUser, setAppliedSubUser] = useState<string>('all')
  const [appliedInsuranceCompany, setAppliedInsuranceCompany] = useState<string>('all')
  const [appliedRmName, setAppliedRmName] = useState<string>('all')
  const [appliedPolicyType, setAppliedPolicyType] = useState<string>('all')
  const [appliedStatus64vb, setAppliedStatus64vb] = useState<string>('all')
  const [appliedModelName, setAppliedModelName] = useState<string>('all')
  const [appliedFuelType, setAppliedFuelType] = useState<string>('all')
  const [appliedPaymentMode, setAppliedPaymentMode] = useState<string>('all')

  // Draft Filter States
  const [draftDealerCode, setDraftDealerCode] = useState<string>('all')
  const [draftSubUser, setDraftSubUser] = useState<string>('all')
  const [draftInsuranceCompany, setDraftInsuranceCompany] = useState<string>('all')
  const [draftRmName, setDraftRmName] = useState<string>('all')
  const [draftPolicyType, setDraftPolicyType] = useState<string>('all')
  const [draftStatus64vb, setDraftStatus64vb] = useState<string>('all')
  const [draftModelName, setDraftModelName] = useState<string>('all')
  const [draftFuelType, setDraftFuelType] = useState<string>('all')
  const [draftPaymentMode, setDraftPaymentMode] = useState<string>('all')

  // Active secondary filters count
  const activeSecondaryFilterCount = useMemo(() => {
    let count = 0
    if (appliedDealerCode !== 'all') count++
    if (appliedSubUser !== 'all') count++
    if (appliedInsuranceCompany !== 'all') count++
    if (appliedRmName !== 'all') count++
    if (appliedPolicyType !== 'all') count++
    if (appliedStatus64vb !== 'all') count++
    if (appliedModelName !== 'all') count++
    if (appliedFuelType !== 'all') count++
    if (appliedPaymentMode !== 'all') count++
    return count
  }, [
    appliedDealerCode,
    appliedSubUser,
    appliedInsuranceCompany,
    appliedRmName,
    appliedPolicyType,
    appliedStatus64vb,
    appliedModelName,
    appliedFuelType,
    appliedPaymentMode,
  ])

  // Drill-down Modal State
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

  // Policy Register Search & Sorting State
  const [tableSearch, setTableSearch] = useState<string>('')
  const [tablePage, setTablePage] = useState<number>(1)
  const [tableSort, setTableSort] = useState<string>('policy_issue_date')
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc')
  const deferredSearch = useDeferredValue(tableSearch)

  // Trend Granularity State (Monthly default)
  const [trendGranularity, setTrendGranularity] = useState<'monthly' | 'quarterly'>('monthly')

  // Fetch Dropdown Filter Options
  const filtersQuery = useQuery({
    queryKey: ['insurance-filters', insuranceType],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/filters?type=${insuranceType}`)
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
  }, [
    insuranceType,
    appliedYear,
    appliedStartDate,
    appliedEndDate,
    appliedDealerCode,
    appliedSubUser,
    appliedInsuranceCompany,
    appliedRmName,
    appliedPolicyType,
    appliedStatus64vb,
    appliedModelName,
    appliedFuelType,
    appliedPaymentMode,
  ])

  const summaryQuery = useQuery({
    queryKey: ['insurance-summary', summaryQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/summary?${summaryQueryParams}`)
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
  }, [
    insuranceType,
    tablePage,
    tableSort,
    tableSortDir,
    deferredSearch,
    appliedYear,
    appliedStartDate,
    appliedEndDate,
    appliedDealerCode,
    appliedSubUser,
    appliedInsuranceCompany,
    appliedRmName,
    appliedPolicyType,
    appliedStatus64vb,
    appliedModelName,
    appliedFuelType,
    appliedPaymentMode,
  ])

  const policiesQuery = useQuery({
    queryKey: ['insurance-policies', policiesQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/policies?${policiesQueryParams}`)
      if (!res.ok) throw new Error('Failed to fetch policies register')
      return res.json()
    },
    enabled: activeWorkspace === 'register',
    staleTime: 2 * 60 * 1000,
  })

  // Drilldown Query
  const drilldownQuery = useQuery({
    queryKey: ['insurance-drilldown', drilldownModal.params, insuranceType],
    queryFn: async () => {
      const p = new URLSearchParams({
        type: insuranceType,
        page: '1',
        pageSize: '50',
        sort: 'policy_issue_date',
        direction: 'desc',
        ...drilldownModal.params,
      })
      const res = await fetch(`/api/insurance/policies?${p.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch drilldown policies')
      return res.json()
    },
    enabled: drilldownModal.open,
    staleTime: 60 * 1000,
  })

  // Apply Filter Handler
  const handleApplyFilters = () => {
    setAppliedStartDate(pendingStartDate)
    setAppliedEndDate(pendingEndDate)
    setAppliedYear(pendingYear)
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
    setFilterDropdownOpen(false)
    setDateDropdownOpen(false)
  }

  // Reset Filter Handler
  const handleResetFilters = () => {
    const cur = currentMonthRangeIst()
    setPendingStartDate(cur.start)
    setPendingEndDate(cur.end)
    setPendingYear('all')
    setAppliedStartDate(cur.start)
    setAppliedEndDate(cur.end)
    setAppliedYear('all')

    setDraftDealerCode('all')
    setDraftSubUser('all')
    setDraftInsuranceCompany('all')
    setDraftRmName('all')
    setDraftPolicyType('all')
    setDraftStatus64vb('all')
    setDraftModelName('all')
    setDraftFuelType('all')
    setDraftPaymentMode('all')

    setAppliedDealerCode('all')
    setAppliedSubUser('all')
    setAppliedInsuranceCompany('all')
    setAppliedRmName('all')
    setAppliedPolicyType('all')
    setAppliedStatus64vb('all')
    setAppliedModelName('all')
    setAppliedFuelType('all')
    setAppliedPaymentMode('all')

    setTablePage(1)
  }

  // Date Preset Handlers
  const handlePresetCurrentMonth = () => {
    const cur = currentMonthRangeIst()
    setPendingStartDate(cur.start)
    setPendingEndDate(cur.end)
    setPendingYear('all')
    setAppliedStartDate(cur.start)
    setAppliedEndDate(cur.end)
    setAppliedYear('all')
    setTablePage(1)
  }

  const handlePresetPreviousMonth = () => {
    const prev = previousMonthRangeIst()
    setPendingStartDate(prev.start)
    setPendingEndDate(prev.end)
    setPendingYear('all')
    setAppliedStartDate(prev.start)
    setAppliedEndDate(prev.end)
    setAppliedYear('all')
    setTablePage(1)
  }

  const handlePresetFullHistory = () => {
    setPendingStartDate('')
    setPendingEndDate('')
    setPendingYear('all')
    setAppliedStartDate('')
    setAppliedEndDate('')
    setAppliedYear('all')
    setTablePage(1)
  }

  const summaryData = summaryQuery.data?.summary || {}
  const kpis = summaryData.kpis || {}
  const capabilities: BrandCapabilities = summaryQuery.data?.capabilities || {}
  const filterData = filtersQuery.data || {}

  // Date range display string
  const dateRangeLabel = useMemo(() => {
    if (appliedStartDate && appliedEndDate) {
      return `${formatDate(appliedStartDate)} – ${formatDate(appliedEndDate)}`
    }
    if (appliedYear !== 'all') return `Year ${appliedYear}`
    return 'All History'
  }, [appliedStartDate, appliedEndDate, appliedYear])

  // Drilldown Trigger Helper
  const openDrilldown = (title: string, subtitle: string, extraParams: Record<string, string> = {}) => {
    setDrilldownModal({
      open: true,
      title,
      subtitle,
      params: {
        ...(appliedStartDate ? { startDate: appliedStartDate } : {}),
        ...(appliedEndDate ? { endDate: appliedEndDate } : {}),
        ...(appliedYear !== 'all' ? { year: appliedYear } : {}),
        ...extraParams,
      },
    })
  }

  // Monthly / Quarterly Trend Data
  const trendData = useMemo(() => {
    const raw = summaryData.monthlyTrend || []
    if (trendGranularity === 'quarterly') {
      const qMap: Record<string, { period: string; grossPremium: number; netPremium: number; count: number }> = {}
      raw.forEach((r: any) => {
        const parts = (r.monthKey || '').split('-')
        const y = parts[0] || '2026'
        const m = parseInt(parts[1] || '1', 10)
        let q = 'Q1'
        if (m >= 4 && m <= 6) q = 'Q2'
        else if (m >= 7 && m <= 9) q = 'Q3'
        else if (m >= 10 && m <= 12) q = 'Q4'
        const key = `${q} ${y}`
        if (!qMap[key]) qMap[key] = { period: key, grossPremium: 0, netPremium: 0, count: 0 }
        qMap[key].grossPremium += Number(r.grossPremium || 0)
        qMap[key].netPremium += Number(r.netPremium || 0)
        qMap[key].count += Number(r.policies || 0)
      })
      return Object.values(qMap)
    }
    return raw.map((r: any) => ({
      period: r.monthLabel || r.monthKey,
      grossPremium: Number(r.grossPremium || 0),
      netPremium: Number(r.netPremium || 0),
      count: Number(r.policies || 0),
    }))
  }, [summaryData.monthlyTrend, trendGranularity])

  // Policy Types Pie Data
  const policyTypeChartData = useMemo(() => {
    const raw = summaryData.policyTypes || []
    return raw.map((item: any) => ({
      name: item.type || 'Other',
      value: Number(item.count || 0),
      premium: Number(item.grossPremium || 0),
    }))
  }, [summaryData.policyTypes])

  // Insurer Market Share Data
  const insurerChartData = useMemo(() => {
    const raw = summaryData.companyBreakdown || []
    return raw.map((item: any) => ({
      name: item.company || 'Other',
      value: Number(item.policies || 0),
      premium: Number(item.grossPremium || 0),
      share: Number(item.sharePct || 0),
    }))
  }, [summaryData.companyBreakdown])

  // Executives Leaderboard Data
  const executiveData = useMemo(() => {
    const raw = summaryData.executives || []
    return raw.map((item: any) => ({
      name: item.executive || 'Unassigned',
      count: Number(item.policies || 0),
      grossPremium: Number(item.grossPremium || 0),
      renewals: Number(item.renewals || 0),
      renewalPct: Number(item.renewalPct || 0),
    }))
  }, [summaryData.executives])

  // Vehicle Models Distribution Data
  const modelData = useMemo(() => {
    const raw = summaryData.models || []
    return raw.map((item: any) => ({
      name: item.model || 'Unknown Model',
      count: Number(item.count || 0),
      grossPremium: Number(item.grossPremium || 0),
      avgIdv: Number(item.avgIdv || 0),
      sharePct: Number(item.sharePct || 0),
    }))
  }, [summaryData.models])

  return (
    <MainLayout
      title="Insurance Analysis"
      subtitle="Executive Policy Analytics, Revenue Leakage & Retention Command Center"
    >
      <div className="space-y-5 pb-16">
        {/* ── STICKY TOP CONTROL HEADER ── */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-3.5 shadow-xs backdrop-blur-md space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* 1. Brand Segmented Control */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/90 p-1 rounded-xl border border-slate-200 dark:border-slate-700/80 overflow-x-auto">
              {BRAND_TABS.map((b) => {
                const isActive = insuranceType === b.id
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setInsuranceType(b.id)
                      const url = new URL(window.location.href)
                      url.searchParams.set('type', b.id)
                      router.replace(`${pathname}?${url.searchParams.toString()}`)
                    }}
                    className={cn(
                      'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer whitespace-nowrap',
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-amber-400 dark:text-slate-950 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-100'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-black',
                        isActive
                          ? 'bg-white/20 text-white dark:bg-slate-950/20 dark:text-slate-950'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                      )}
                    >
                      {b.initial}
                    </span>
                    <span>{b.label}</span>
                  </button>
                )
              })}
            </div>

            {/* 2. Date Quick Presets, Filters, Refresh & Export */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Preset Buttons */}
              <div className="hidden sm:flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                <button
                  type="button"
                  onClick={handlePresetCurrentMonth}
                  className={cn(
                    'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer',
                    appliedStartDate === defaultMonthRange.start && appliedEndDate === defaultMonthRange.end
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  )}
                >
                  This Month
                </button>
                <button
                  type="button"
                  onClick={handlePresetPreviousMonth}
                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition-all cursor-pointer"
                >
                  Last Month
                </button>
                <button
                  type="button"
                  onClick={handlePresetFullHistory}
                  className={cn(
                    'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer',
                    !appliedStartDate && !appliedEndDate
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  )}
                >
                  All History
                </button>
              </div>

              {/* Date Range Dropdown Selector */}
              <DropdownMenu open={dateDropdownOpen} onOpenChange={setDateDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl border-slate-200 dark:border-slate-700 text-xs font-bold gap-1.5 px-3 shadow-2xs cursor-pointer"
                  >
                    <Calendar className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{dateRangeLabel}</span>
                    <ChevronDown className="h-3 w-3 text-slate-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-80 p-4 rounded-2xl shadow-xl border-slate-200 dark:border-slate-800 space-y-3" align="end">
                  <div className="space-y-1">
                    <p className="text-xs font-black text-slate-900 dark:text-slate-100">Custom Date Range</p>
                    <p className="text-[11px] font-medium text-slate-500">Filter transactions by policy issue dates.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">From Date</label>
                      <Input
                        type="date"
                        value={pendingStartDate}
                        onChange={(e) => setPendingStartDate(e.target.value)}
                        className="h-8 text-xs rounded-xl mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">To Date</label>
                      <Input
                        type="date"
                        value={pendingEndDate}
                        onChange={(e) => setPendingEndDate(e.target.value)}
                        className="h-8 text-xs rounded-xl mt-1"
                      />
                    </div>
                  </div>
                  <div className="pt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
                    <Button variant="ghost" size="sm" onClick={handleResetFilters} className="h-7 text-xs font-bold">
                      Reset
                    </Button>
                    <Button size="sm" onClick={handleApplyFilters} className="h-7 text-xs font-bold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                      Apply Date
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Secondary Filters Dropdown */}
              <DropdownMenu open={filterDropdownOpen} onOpenChange={setFilterDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={activeSecondaryFilterCount > 0 ? 'default' : 'outline'}
                    size="sm"
                    className={cn(
                      'h-8 rounded-xl text-xs font-bold gap-1.5 px-3 shadow-2xs cursor-pointer',
                      activeSecondaryFilterCount > 0
                        ? 'bg-slate-900 text-white dark:bg-amber-400 dark:text-slate-950'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    )}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    <span>Filters</span>
                    {activeSecondaryFilterCount > 0 && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-slate-950 dark:bg-slate-900 dark:text-white text-[9px] font-black">
                        {activeSecondaryFilterCount}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-96 p-4 rounded-2xl shadow-xl border-slate-200 dark:border-slate-800 space-y-4" align="end">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                    <div className="flex items-center gap-1.5">
                      <SlidersHorizontal className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                      <span className="text-xs font-black text-slate-900 dark:text-slate-100">Advanced Filter Controls</span>
                    </div>
                    {activeSecondaryFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="text-[11px] font-bold text-rose-600 hover:text-rose-700 cursor-pointer"
                      >
                        Reset All
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Dealer / Branch */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Dealership Branch</label>
                      <Select value={draftSubUser} onValueChange={setDraftSubUser}>
                        <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
                          <SelectValue placeholder="All Branches" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Branches</SelectItem>
                          {(filterData.subUsers || []).map((sub: string) => (
                            <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Insurance Company */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Insurance Company</label>
                      <Select value={draftInsuranceCompany} onValueChange={setDraftInsuranceCompany}>
                        <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
                          <SelectValue placeholder="All Insurers" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Insurers</SelectItem>
                          {(filterData.insuranceCompanies || []).map((ic: string) => (
                            <SelectItem key={ic} value={ic}>{ic}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Policy Status */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Policy Status</label>
                      <Select value={draftStatus64vb} onValueChange={setDraftStatus64vb}>
                        <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
                          <SelectValue placeholder="All Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="VERIFIED">Verified / Active</SelectItem>
                          <SelectItem value="NOT VERIFIED">Pending / Unverified</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Executive / RM */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500">Executive / RM</label>
                      <Select value={draftRmName} onValueChange={setDraftRmName}>
                        <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
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

                  <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                    <Button variant="outline" size="sm" onClick={() => setFilterDropdownOpen(false)} className="h-8 text-xs font-bold">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleApplyFilters} className="h-8 text-xs font-bold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                      Apply Filters
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Quick Refresh */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  summaryQuery.refetch()
                  if (activeWorkspace === 'register') policiesQuery.refetch()
                }}
                disabled={summaryQuery.isFetching}
                className="h-8 rounded-xl border-slate-200 dark:border-slate-700 text-xs font-bold gap-1.5 shadow-2xs cursor-pointer"
              >
                <RefreshCw className={cn('h-3.5 w-3.5 text-slate-500', summaryQuery.isFetching && 'animate-spin')} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>

              {/* Export Register Button */}
              {activeWorkspace === 'register' && (
                <Button
                  size="sm"
                  onClick={() => {
                    const p = new URLSearchParams(policiesQueryParams)
                    p.set('export', 'csv')
                    window.open(`/api/insurance/policies?${p.toString()}`, '_blank')
                  }}
                  className="h-8 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold gap-1.5 shadow-xs cursor-pointer hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export CSV</span>
                </Button>
              )}

              {/* Reset Filters Pill */}
              {(activeSecondaryFilterCount > 0 || appliedStartDate !== defaultMonthRange.start || appliedEndDate !== defaultMonthRange.end) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilters}
                  className="h-8 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 gap-1 px-2.5 rounded-xl cursor-pointer"
                >
                  <X className="h-3 w-3" />
                  <span>Reset</span>
                </Button>
              )}
            </div>
          </div>

          {/* Active Filter Chips */}
          {activeSecondaryFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px]">
              <span className="font-bold text-slate-500 text-[10px] uppercase tracking-wider mr-1">Active:</span>
              {appliedSubUser !== 'all' && (
                <Badge variant="secondary" className="gap-1 font-bold bg-slate-100 dark:bg-slate-800">
                  Branch: {appliedSubUser}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => { setAppliedSubUser('all'); setDraftSubUser('all') }} />
                </Badge>
              )}
              {appliedInsuranceCompany !== 'all' && (
                <Badge variant="secondary" className="gap-1 font-bold bg-slate-100 dark:bg-slate-800">
                  Insurer: {appliedInsuranceCompany}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => { setAppliedInsuranceCompany('all'); setDraftInsuranceCompany('all') }} />
                </Badge>
              )}
              {appliedStatus64vb !== 'all' && (
                <Badge variant="secondary" className="gap-1 font-bold bg-slate-100 dark:bg-slate-800">
                  Status: {appliedStatus64vb}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => { setAppliedStatus64vb('all'); setDraftStatus64vb('all') }} />
                </Badge>
              )}
              {appliedRmName !== 'all' && (
                <Badge variant="secondary" className="gap-1 font-bold bg-slate-100 dark:bg-slate-800">
                  RM: {appliedRmName}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => { setAppliedRmName('all'); setDraftRmName('all') }} />
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* ── 4 STREAMLINED HERO EXECUTIVE PULSE KPIS ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Gross Premium */}
          <div
            onClick={() => openDrilldown('Gross Premium Breakdown', 'All issued policies within selected date range')}
            className="group cursor-pointer rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Gross Premium
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 group-hover:scale-105 transition-transform">
                <IndianRupee className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2.5">
              <p className="text-2xl font-black tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
                {formatCurrency(kpis.grossPremium || 0)}
              </p>
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>Net: {formatCompactCurrency(kpis.netPremium || 0)}</span>
                <span className="text-blue-600 dark:text-blue-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  View Policies <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Total Policies Issued */}
          <div
            onClick={() => openDrilldown('Total Policies Issued', 'Complete policy volume in current scope')}
            className="group cursor-pointer rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Policies Issued
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 group-hover:scale-105 transition-transform">
                <FileText className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2.5">
              <p className="text-2xl font-black tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
                {formatNumber(kpis.totalPolicies || 0)}
              </p>
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>
                  Avg:{' '}
                  {kpis.totalPolicies
                    ? formatCompactCurrency((kpis.grossPremium || 0) / kpis.totalPolicies)
                    : '₹0'}
                  /policy
                </span>
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  Inspect <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: Renewal Ratio */}
          <div
            onClick={() => setActiveWorkspace('renewals')}
            className="group cursor-pointer rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all hover:shadow-md hover:border-amber-300 dark:hover:border-amber-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Renewal Ratio
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 group-hover:scale-105 transition-transform">
                <RefreshCw className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2.5">
              <p className="text-2xl font-black tabular-nums tracking-tight text-amber-700 dark:text-amber-400">
                {formatPercent(kpis.renewalRatePct || 0)}
              </p>
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>Renewals: {formatNumber(kpis.renewalCount || 0)}</span>
                <span className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  Retention Command <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>

          {/* Card 4: 64VB Compliance */}
          <div
            onClick={() => openDrilldown('64VB Compliance Status', 'Compliance status verified vs unverified')}
            className="group cursor-pointer rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all hover:shadow-md hover:border-purple-300 dark:hover:border-purple-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                64VB Compliance
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400 group-hover:scale-105 transition-transform">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2.5">
              <p className="text-2xl font-black tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
                {capabilities.has64vb === false ? 'N/A (Kia)' : formatPercent(kpis.verifiedRatePct || 0)}
              </p>
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>
                  {capabilities.has64vb === false
                    ? 'Field unmapped in feed'
                    : `Verified: ${formatNumber(kpis.verified64vb || 0)}`}
                </span>
                <span className="text-purple-600 dark:text-purple-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  Audit <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── WORKSPACE SEGMENTED TABS (4 INTUITIVE WORKSPACES) ── */}
        <Tabs
          value={activeWorkspace}
          onValueChange={(v) => setActiveWorkspace(v as DashboardWorkspace)}
          className="space-y-4"
        >
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-xs">
            <TabsList className="grid grid-cols-2 md:grid-cols-4 gap-1.5 bg-transparent p-0 h-auto">
              {WORKSPACE_TABS.map((tab) => {
                const Icon = tab.icon
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-black text-slate-600 dark:text-slate-400 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:data-[state=active]:bg-amber-400 dark:data-[state=active]:text-slate-950 transition-all shadow-none cursor-pointer"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>

          {/* WORKSPACE 1: EXECUTIVE OVERVIEW */}
          <TabsContent value="overview" className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Revenue & Volume Trend Chart */}
              <Card className="lg:col-span-2 rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-600" />
                      Gross Premium & Policy Volume Trend
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                      Historical trajectory of premium collected and policy counts.
                    </CardDescription>
                  </div>
                  <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() => setTrendGranularity('monthly')}
                      className={cn(
                        'px-2.5 py-1 text-[10px] font-black rounded-md transition-all cursor-pointer',
                        trendGranularity === 'monthly'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                          : 'text-slate-500 hover:text-slate-900'
                      )}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrendGranularity('quarterly')}
                      className={cn(
                        'px-2.5 py-1 text-[10px] font-black rounded-md transition-all cursor-pointer',
                        trendGranularity === 'quarterly'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                          : 'text-slate-500 hover:text-slate-900'
                      )}
                    >
                      Quarterly
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="pt-5">
                  {trendData.length === 0 ? (
                    <EmptyState title="No Trend Data" body="No policies matching current filter parameters." />
                  ) : (
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="premiumGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis
                            dataKey="period"
                            stroke="#64748b"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            stroke="#64748b"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => formatCompactCurrency(v)}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload
                                return (
                                  <div className="rounded-xl border border-slate-200 bg-white/95 dark:bg-slate-900/95 dark:border-slate-800 p-3 shadow-lg text-xs space-y-1">
                                    <p className="font-black text-slate-900 dark:text-slate-100">{data.period}</p>
                                    <p className="text-blue-600 dark:text-blue-400 font-extrabold">
                                      Gross: {formatCurrency(data.grossPremium)}
                                    </p>
                                    <p className="text-slate-600 dark:text-slate-400 font-bold">
                                      Policies: {formatNumber(data.count)}
                                    </p>
                                  </div>
                                )
                              }
                              return null
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="grossPremium"
                            stroke="#2563eb"
                            strokeWidth={2.5}
                            fillOpacity={1}
                            fill="url(#premiumGrad)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Policy Type Distribution Donut */}
              <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4 text-purple-600" />
                    Policy Type Mix
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    Distribution across Comprehensive, OD, and TP.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  {policyTypeChartData.length === 0 ? (
                    <EmptyState title="No Data" body="No policy types recorded." />
                  ) : (
                    <>
                      <div className="h-44 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={policyTypeChartData}
                              cx="50%"
                              cy="50%"
                              innerRadius={45}
                              outerRadius={65}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {policyTypeChartData.map((_entry: any, index: number) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={DONUT_COLORS_POLICY_TYPE[index % DONUT_COLORS_POLICY_TYPE.length]}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const d = payload[0].payload
                                  return (
                                    <div className="rounded-xl border border-slate-200 bg-white dark:bg-slate-900 p-2.5 shadow-md text-xs">
                                      <span className="font-bold text-slate-900 dark:text-slate-100">{d.name}</span>
                                      <p className="font-black text-slate-700 dark:text-slate-300">
                                        {formatNumber(d.value)} Policies ({formatCurrency(d.premium)})
                                      </p>
                                    </div>
                                  )
                                }
                                return null
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Policy Types Compact Table */}
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {policyTypeChartData.map((item: any, idx: number) => (
                          <div
                            key={item.name}
                            onClick={() => openDrilldown(`Policy Type: ${item.name}`, 'Filtered by policy type', { policyType: item.name })}
                            className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 text-xs cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: DONUT_COLORS_POLICY_TYPE[idx % DONUT_COLORS_POLICY_TYPE.length] }}
                              />
                              <span className="font-black text-slate-800 dark:text-slate-200">{item.name}</span>
                            </div>
                            <div className="text-right font-black text-slate-700 dark:text-slate-300">
                              <span>{formatNumber(item.value)}</span>
                              <span className="text-[10px] text-slate-400 block">{formatCompactCurrency(item.premium)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Row 2: Top Insurance Partners Snapshot & Revenue Leakage */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Top Insurers Snapshot */}
              <Card className="lg:col-span-2 rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      Top Insurance Partners & Market Share
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                      Market share, policies issued, and gross premium by insurance company.
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveWorkspace('performance')}
                    className="h-7 text-xs font-black text-blue-600 hover:text-blue-700 gap-1 cursor-pointer"
                  >
                    View All <ArrowRight className="h-3 w-3" />
                  </Button>
                </CardHeader>
                <CardContent className="pt-4">
                  {insurerChartData.length === 0 ? (
                    <EmptyState title="No Insurer Data" body="No partner transactions available." />
                  ) : (
                    <div className="space-y-3">
                      {insurerChartData.slice(0, 5).map((ins: any, idx: number) => (
                        <div
                          key={ins.name}
                          onClick={() => openDrilldown(`Insurer: ${ins.name}`, 'Policies issued with this insurance company', { insuranceCompany: ins.name })}
                          className="group cursor-pointer rounded-xl border border-slate-100 dark:border-slate-800 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors space-y-2"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-black text-slate-700 dark:text-slate-300">
                                {idx + 1}
                              </span>
                              <span className="font-black text-slate-900 dark:text-slate-100">{ins.name}</span>
                            </div>
                            <div className="flex items-center gap-3 font-bold">
                              <span className="text-slate-500 dark:text-slate-400">{formatNumber(ins.value)} policies</span>
                              <span className="font-black text-slate-900 dark:text-slate-100">{formatCurrency(ins.premium)}</span>
                              <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 font-extrabold text-[10px]">
                                {formatPercent(ins.share)}
                              </Badge>
                            </div>
                          </div>
                          {/* Progress Bar */}
                          <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full transition-all"
                              style={{ width: `${Math.min(100, Math.max(4, ins.share))}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Revenue Leakage & Compliance Card */}
              <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-rose-600" />
                    Revenue & Compliance Audit
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    64VB compliance, uncollected premiums, and policy lapses.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-600 dark:text-slate-400">Verified 64VB Policies</span>
                      <span className="font-black text-emerald-600">{formatNumber(kpis.verified64vb || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-600 dark:text-slate-400">Unverified / Pending</span>
                      <span className="font-black text-rose-600">{formatNumber(kpis.notVerified64vb || 0)}</span>
                    </div>
                    <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${Math.min(100, kpis.verifiedRatePct || 0)}%` }}
                      />
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 space-y-2">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <span className="text-xs font-black text-amber-950 dark:text-amber-300">Renewal Opportunity</span>
                    </div>
                    <p className="text-[11px] font-medium text-amber-900/80 dark:text-amber-300/80">
                      Track forward pipeline, expiring policies, and customer win-backs in the Renewal Command workspace.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => setActiveWorkspace('renewals')}
                      className="w-full h-7 text-xs font-black bg-amber-500 hover:bg-amber-600 text-slate-950 cursor-pointer shadow-xs"
                    >
                      Open Renewal Command
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* WORKSPACE 2: RENEWAL & RETENTION COMMAND */}
          <TabsContent value="renewals" className="space-y-5">
            <RenewalPipelinePanel brands={[insuranceType]} />
          </TabsContent>

          {/* WORKSPACE 3: PARTNERS & TEAM PERFORMANCE */}
          <TabsContent value="performance" className="space-y-5">
            {/* Insurer Partners Performance Leaderboard */}
            <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
              <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-blue-600" />
                  Insurance Partner Performance Leaderboard
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                  Comprehensive performance matrix across all insurance partner companies.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-3">
                <div className="overflow-x-auto">
                  <Table className="text-xs">
                    <TableHeader className="bg-slate-50 dark:bg-slate-800/60">
                      <TableRow>
                        <TableHead className="font-black text-slate-900 dark:text-slate-100">Insurance Company</TableHead>
                        <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Policies</TableHead>
                        <TableHead className="font-black text-right text-slate-900 dark:text-slate-100">Gross Premium</TableHead>
                        <TableHead className="font-black text-right text-slate-900 dark:text-slate-100">Avg Ticket</TableHead>
                        <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Market Share</TableHead>
                        <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {insurerChartData.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-slate-400">
                            No insurer performance records found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        insurerChartData.map((ins: any) => (
                          <TableRow key={ins.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <TableCell className="font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 text-emerald-600" />
                              <span>{ins.name}</span>
                            </TableCell>
                            <TableCell className="text-center font-bold">{formatNumber(ins.value)}</TableCell>
                            <TableCell className="text-right font-black text-slate-900 dark:text-slate-100">
                              {formatCurrency(ins.premium)}
                            </TableCell>
                            <TableCell className="text-right font-bold text-slate-500">
                              {ins.value ? formatCurrency(ins.premium / ins.value) : '₹0'}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge className="bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300 font-extrabold text-[10px]">
                                {formatPercent(ins.share)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDrilldown(`Insurer: ${ins.name}`, 'Policies for this company', { insuranceCompany: ins.name })}
                                className="h-6 px-2 text-[11px] font-black text-blue-600 hover:text-blue-700 cursor-pointer"
                              >
                                Drilldown
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* RM / Executive Performance & Vehicle Models */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Executive / RM Leaderboard */}
              <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Users className="h-4 w-4 text-purple-600" />
                    Top Relationship Managers & Executives
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    Policy conversions and gross premium generated per executive.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-3">
                  <div className="space-y-2.5 max-h-80 overflow-y-auto">
                    {executiveData.length === 0 ? (
                      <EmptyState title="No Executive Records" body="No executive breakdown available in current scope." />
                    ) : (
                      executiveData.map((exec: any, idx: number) => (
                        <div
                          key={exec.name || idx}
                          onClick={() => openDrilldown(`Executive: ${exec.name}`, 'Policies closed by this executive', { rmName: exec.name })}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-xs cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 text-[10px] font-black">
                              {idx + 1}
                            </span>
                            <span className="font-black text-slate-900 dark:text-slate-100">{exec.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 font-bold">{formatNumber(exec.count)} policies</span>
                            <span className="font-black text-purple-700 dark:text-purple-400">{formatCurrency(exec.grossPremium)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Top Vehicle Models */}
              <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Car className="h-4 w-4 text-amber-600" />
                    Vehicle Model Distribution
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    Highest volume models in policy portfolio.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-3">
                  <div className="space-y-2.5 max-h-80 overflow-y-auto">
                    {modelData.length === 0 ? (
                      <EmptyState title="No Vehicle Models" body="No vehicle data in current scope." />
                    ) : (
                      modelData.map((model: any, idx: number) => (
                        <div
                          key={model.name || idx}
                          onClick={() => openDrilldown(`Model: ${model.name}`, 'Policies for this vehicle model', { modelName: model.name })}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-xs cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-black">
                              {idx + 1}
                            </span>
                            <span className="font-black text-slate-900 dark:text-slate-100">{model.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 font-bold">{formatNumber(model.count)} policies</span>
                            <span className="font-black text-amber-700 dark:text-amber-400">{formatCurrency(model.grossPremium)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* WORKSPACE 4: MASTER POLICY REGISTER */}
          <TabsContent value="register" className="space-y-4">
            <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
              <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    Master Policy Register
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    Search and inspect individual policy records across feeds.
                  </CardDescription>
                </div>

                {/* Instant Search Bar */}
                <div className="relative w-full md:w-72">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="Search chassis, policy #, owner..."
                    value={tableSearch}
                    onChange={(e) => {
                      setTableSearch(e.target.value)
                      setTablePage(1)
                    }}
                    className="h-8 pl-8 text-xs rounded-xl border-slate-200 dark:border-slate-700"
                  />
                  {tableSearch && (
                    <X
                      className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                      onClick={() => setTableSearch('')}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-3 space-y-4">
                {policiesQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table className="text-xs">
                        <TableHeader className="bg-slate-50 dark:bg-slate-800/60">
                          <TableRow>
                            <TableHead className="font-black text-slate-900 dark:text-slate-100">Issue Date</TableHead>
                            <TableHead className="font-black text-slate-900 dark:text-slate-100">Policy / Proposal #</TableHead>
                            <TableHead className="font-black text-slate-900 dark:text-slate-100">Customer Name</TableHead>
                            <TableHead className="font-black text-slate-900 dark:text-slate-100">Vehicle / Chassis</TableHead>
                            <TableHead className="font-black text-slate-900 dark:text-slate-100">Insurer</TableHead>
                            <TableHead className="font-black text-slate-900 dark:text-slate-100">Type</TableHead>
                            <TableHead className="font-black text-right text-slate-900 dark:text-slate-100">Gross Premium</TableHead>
                            <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">64VB</TableHead>
                            <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(policiesQuery.data?.policies || []).length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={9} className="text-center py-8 text-slate-400">
                                No policies found matching your search and filter criteria.
                              </TableCell>
                            </TableRow>
                          ) : (
                            (policiesQuery.data?.policies || []).map((p: any) => (
                              <TableRow
                                key={p.id || p.policyNo || p.proposalNo}
                                className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                                onClick={() => setSelectedPolicyRecord(p)}
                              >
                                <TableCell className="font-bold text-slate-700 dark:text-slate-300">
                                  {formatDate(p.policyIssueDate)}
                                </TableCell>
                                <TableCell>
                                  <div className="font-black text-slate-900 dark:text-slate-100">{p.policyNo || 'Pending'}</div>
                                  <span className="text-[10px] text-slate-400 font-medium">{p.proposalNo}</span>
                                </TableCell>
                                <TableCell className="font-black text-slate-900 dark:text-slate-100">
                                  {p.customerName || '—'}
                                </TableCell>
                                <TableCell>
                                  <div className="font-bold text-slate-800 dark:text-slate-200">{p.modelName || '—'}</div>
                                  <span className="text-[10px] font-mono text-slate-400">{p.chassisNo}</span>
                                </TableCell>
                                <TableCell className="font-bold text-slate-700 dark:text-slate-300">
                                  {p.insuranceCompany}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-[10px] font-extrabold">
                                    {p.policyType || 'Comprehensive'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-black text-slate-900 dark:text-slate-100">
                                  {formatCurrency(p.grossPremium)}
                                </TableCell>
                                <TableCell className="text-center">
                                  {p.column64vbStatus === 'VERIFIED' ? (
                                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-black">
                                      Verified
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px] font-bold">
                                      {p.column64vbStatus || 'Pending'}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedPolicyRecord(p)
                                    }}
                                    className="h-6 px-2 text-[11px] font-black text-blue-600 hover:text-blue-700"
                                  >
                                    View
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination Controls */}
                    {policiesQuery.data?.totalPages > 1 && (
                      <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
                        <span className="text-xs text-slate-500 font-bold">
                          Page {policiesQuery.data.page} of {policiesQuery.data.totalPages} ({policiesQuery.data.totalCount} policies)
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}
                            disabled={tablePage === 1}
                            className="h-7 text-xs font-bold"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" /> Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setTablePage((prev) => Math.min(policiesQuery.data.totalPages, prev + 1))}
                            disabled={tablePage === policiesQuery.data.totalPages}
                            className="h-7 text-xs font-bold"
                          >
                            Next <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ── INTERACTIVE DRILLDOWN MODAL ── */}
        <Dialog open={drilldownModal.open} onOpenChange={(open) => setDrilldownModal((prev) => ({ ...prev, open }))}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto rounded-3xl p-6">
            <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <DialogTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sparkles className="h-4.5 w-4.5 text-amber-500" />
                {drilldownModal.title}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                {drilldownModal.subtitle}
              </DialogDescription>
            </DialogHeader>

            <div className="py-3 space-y-3">
              {drilldownQuery.isLoading ? (
                <div className="flex min-h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="text-xs">
                    <TableHeader className="bg-slate-50 dark:bg-slate-800/60">
                      <TableRow>
                        <TableHead className="font-black">Date</TableHead>
                        <TableHead className="font-black">Policy #</TableHead>
                        <TableHead className="font-black">Customer</TableHead>
                        <TableHead className="font-black">Model</TableHead>
                        <TableHead className="font-black">Insurer</TableHead>
                        <TableHead className="font-black text-right">Gross Premium</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(drilldownQuery.data?.policies || []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-slate-400">
                            No policies found in this drilldown.
                          </TableCell>
                        </TableRow>
                      ) : (
                        (drilldownQuery.data?.policies || []).map((p: any) => (
                          <TableRow
                            key={p.id || p.policyNo}
                            onClick={() => setSelectedPolicyRecord(p)}
                            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                          >
                            <TableCell className="font-bold">{formatDate(p.policyIssueDate)}</TableCell>
                            <TableCell className="font-mono font-black">{p.policyNo || 'Pending'}</TableCell>
                            <TableCell className="font-bold">{p.customerName}</TableCell>
                            <TableCell>{p.modelName}</TableCell>
                            <TableCell>{p.insuranceCompany}</TableCell>
                            <TableCell className="text-right font-black">{formatCurrency(p.grossPremium)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* ── POLICY DETAIL INSPECTOR DRAWER / MODAL ── */}
        <Dialog open={Boolean(selectedPolicyRecord)} onOpenChange={(open) => !open && setSelectedPolicyRecord(null)}>
          <DialogContent className="max-w-2xl rounded-3xl p-6 space-y-4">
            <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-blue-600" />
                  Policy Details Inspector
                </DialogTitle>
                <Badge className="bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300 font-black text-xs">
                  {selectedPolicyRecord?.policyType || 'Comprehensive'}
                </Badge>
              </div>
              <DialogDescription className="text-xs text-slate-500">
                Chassis: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{selectedPolicyRecord?.chassisNo}</span>
              </DialogDescription>
            </DialogHeader>

            {selectedPolicyRecord && (
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Customer & Policy</span>
                  <p className="font-black text-slate-900 dark:text-slate-100 text-sm">{selectedPolicyRecord.customerName}</p>
                  <p className="font-mono text-slate-600 dark:text-slate-400">Policy: {selectedPolicyRecord.policyNo || '—'}</p>
                  <p className="font-mono text-slate-600 dark:text-slate-400">Proposal: {selectedPolicyRecord.proposalNo || '—'}</p>
                  <p className="text-slate-600 dark:text-slate-400">Issue Date: {formatDate(selectedPolicyRecord.policyIssueDate)}</p>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Vehicle Specifications</span>
                  <p className="font-black text-slate-900 dark:text-slate-100 text-sm">{selectedPolicyRecord.modelName || '—'}</p>
                  <p className="text-slate-600 dark:text-slate-400">Variant: {selectedPolicyRecord.variantName || '—'}</p>
                  <p className="text-slate-600 dark:text-slate-400">Fuel: {selectedPolicyRecord.fuelType || '—'}</p>
                  <p className="text-slate-600 dark:text-slate-400">Reg #: {selectedPolicyRecord.vehRegistNo || '—'}</p>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Insurance Partner</span>
                  <p className="font-black text-slate-900 dark:text-slate-100 text-sm">{selectedPolicyRecord.insuranceCompany}</p>
                  <p className="text-slate-600 dark:text-slate-400">Branch: {selectedPolicyRecord.subUser || '—'}</p>
                  <p className="text-slate-600 dark:text-slate-400">Advisor / RM: {selectedPolicyRecord.rmName || '—'}</p>
                </div>

                <div className="p-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 space-y-1.5">
                  <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase">Financials</span>
                  <p className="font-black text-blue-950 dark:text-blue-100 text-base">
                    Gross: {formatCurrency(selectedPolicyRecord.grossPremium)}
                  </p>
                  <p className="text-slate-600 dark:text-slate-400">Net: {formatCurrency(selectedPolicyRecord.netPremium)}</p>
                  <p className="text-slate-600 dark:text-slate-400">IDV: {formatCurrency(selectedPolicyRecord.totalIdv)}</p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  )
}
