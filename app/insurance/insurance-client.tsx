'use client'

import { useState, useDeferredValue, useMemo, ComponentProps } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
  SlidersHorizontal,
  ArrowRight,
  IndianRupee,
  Calendar,
  X,
  PieChart as PieChartIcon,
  Sparkles,
  Zap,
  PhoneCall,
  Clock,
  UserCheck,
  UserX,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertTriangle,
  History,
  Target,
  Send,
  MessageSquare,
  Layers,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import type { CrmDisposition } from '@/lib/insurance/crm'
import type { RenewalDue, RenewalPipeline } from '@/lib/insurance/renewals'

type SearchParamsInput = Record<string, string | string[] | undefined>

const VEHICLE_MODEL_PHOTOS: Record<string, string> = {
  sonet: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Sonet/11411/1782132032079/front-left-side-47.jpg',
  seltos: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Seltos/13094/1778328978290/front-left-side-47.jpg',
  carens: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Carens/11623/1772787448187/front-left-side-47.jpg',
  carnival: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Carnival/8001/1774601542816/front-left-side-47.jpg',
  creta: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Creta/8667/1755765115423/front-left-side-47.jpg',
  venue: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Venue/12999/1771931633886/front-left-side-47.jpg',
  verna: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Verna-Facelift/13312/1773040519044/front-left-side-47.jpg',
  i20: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/i20/11092/1755774177956/front-left-side-47.jpg',
  'grand i10': 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Grand-i10-Nios/10088/1762430432997/front-left-side-47.jpg',
  i10: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Grand-i10-Nios/10088/1762430432997/front-left-side-47.jpg',
  nios: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Grand-i10-Nios/10088/1762430432997/front-left-side-47.jpg',
  aura: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Aura/10125/1762429751468/front-left-side-47.jpg',
  alcazar: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Alcazar/9246/1758802404168/front-left-side-47.jpg',
  tucson: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Tucson/10133/1762431617294/front-left-side-47.jpg',
  exter: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Exter/13342/1774007040413/front-left-side-47.jpg',
  ioniq: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/IONIQ-5-Facelift/13531/1777375118845/front-left-side-47.jpg',
  santro: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Grand-i10-Nios/10088/1762430432997/front-left-side-47.jpg',
}

const STATIC_VEHICLE_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 100' fill='none'%3E%3Crect width='160' height='100' rx='8' fill='%23F8FAFC'/%3E%3Cpath d='M22 62C22 62 26 50 38 46C50 42 62 30 84 28C106 26 122 36 130 46C138 48 142 54 142 62C142 65 140 66 136 66H126C124 58 116 52 108 52C100 52 92 58 90 66H66C64 58 56 52 48 52C40 52 32 58 30 66H24C22 66 22 64 22 62Z' fill='%2394A3B8'/%3E%3Ccircle cx='48' cy='66' r='11' fill='%23334155'/%3E%3Ccircle cx='48' cy='66' r='6' fill='%23CBD5E1'/%3E%3Ccircle cx='48' cy='66' r='2.5' fill='%23334155'/%3E%3Ccircle cx='108' cy='66' r='11' fill='%23334155'/%3E%3Ccircle cx='108' cy='66' r='6' fill='%23CBD5E1'/%3E%3Ccircle cx='108' cy='66' r='2.5' fill='%23334155'/%3E%3Cpath d='M64 34L44 48H64V34Z' fill='%23E2E8F0'/%3E%3Cpath d='M68 34H88V48H68V34Z' fill='%23E2E8F0'/%3E%3Cpath d='M92 34C102 34 114 40 120 48H92V34Z' fill='%23E2E8F0'/%3E%3Cpath d='M136 50C140 50 142 53 142 55H134L136 50Z' fill='%23FDE047'/%3E%3Cpath d='M22 52H26V56H22V52Z' fill='%23F87171'/%3E%3C/svg%3E"

function getVehicleModelPhoto(model?: string | null): string {
  if (!model) return VEHICLE_MODEL_PHOTOS.creta
  const clean = model.toLowerCase().trim()
  for (const [key, url] of Object.entries(VEHICLE_MODEL_PHOTOS)) {
    if (clean.includes(key)) return url
  }
  return STATIC_VEHICLE_FALLBACK
}

function normalizePolicyRow(p: any) {
  return {
    id: p.id,
    policyNo: p.policy_no ?? p.policyNo ?? '',
    proposalNo: p.proposal_no ?? p.proposalNo ?? '',
    customerName: p.customer_name ?? p.customerName ?? '—',
    modelName: p.model_name ?? p.modelName ?? 'Hyundai Vehicle',
    variantName: p.variant_name ?? p.variantName ?? '',
    chassisNo: p.chassis_no ?? p.chassisNo ?? '—',
    engineNo: p.engine_no ?? p.engineNo ?? '—',
    vehRegistNo: p.veh_regist_no ?? p.vehRegistNo ?? '—',
    insuranceCompany: p.insurance_company ?? p.insuranceCompany ?? '—',
    policyType: p.policy_type ?? p.policyType ?? 'Comprehensive',
    grossPremium: Number(p.gross_premium ?? p.grossPremium ?? 0),
    netPremium: Number(p.net_premium ?? p.netPremium ?? 0),
    netOdPremiumA: Number(p.net_od_premium_a ?? p.netOdPremiumA ?? 0),
    thirdPartyLiability: Number(p.third_party_liability ?? p.thirdPartyLiability ?? 0),
    addOnPremium: Number(p.add_on_premium ?? p.addOnPremium ?? 0),
    addonOpted: p.addon_opted ?? p.addonOpted ?? '—',
    serviceTax: Number(p.service_tax ?? p.serviceTax ?? 0),
    totalIdv: Number(p.total_idv ?? p.totalIdv ?? 0),
    policyIssueDate: p.policy_issue_date ?? p.policyIssueDate ?? '',
    policyStartDate: p.policy_start_date ?? p.policyStartDate ?? '',
    odExpiryDate: p.od_expiry_date ?? p.odExpiryDate ?? '',
    column64vbStatus: p.column_64vb_status ?? p.column64vbStatus ?? 'VERIFIED',
    paymentMode: p.payment_mode ?? p.paymentMode ?? 'Online / Cheque',
    rmName: p.rm_name ?? p.rmName ?? '—',
    dealerCode: p.dealer_code ?? p.dealerCode ?? '—',
    subUser: p.sub_user ?? p.subUser ?? '—',
    odTenure: p.od_tenure ?? p.odTenure ?? '1 Year',
    tpTenure: p.tp_tenure ?? p.tpTenure ?? '3 Years',
    currentNcb: p.current_ncb_percentage ?? p.currentNcbPercentage ?? '—',
    fuelType: p.fuel_type ?? p.fuelType ?? 'Petrol / Diesel',
    mfgYear: p.mfg_year ?? p.mfgYear ?? '—',
  }
}

type InsuranceType = 'hyundai' | 'platinum' | 'kia'

const BRAND_TABS: { id: InsuranceType; label: string; initial: string; badge: string; isLive: boolean }[] = [
  { id: 'hyundai', label: 'Hyundai Insurance', initial: 'H', badge: 'JAM Hyundai', isLive: true },
  { id: 'platinum', label: 'Platinum Insurance', initial: 'P', badge: 'Platinum', isLive: true },
  { id: 'kia', label: 'Kia Insurance', initial: 'K', badge: 'AM Kia', isLive: false },
]

/**
 * 6 Main Executive & Operational Workspaces
 */
type DashboardWorkspace =
  | 'overview'    // Executive Overview (Month-wise Trajectory, Same Month Last Year YoY, Renewal Depth 1st to 6th+)
  | 'renewals'    // Expiry & Retention Command (1-Year Out Expiry Tracking, Cohorts, Yr 1 vs Yr 2 Comeback)
  | 'upcoming'    // Upcoming Expiries (Next 30 Days: Critical ≤7d, Urgent 8-15d, Standard 16-30d)
  | 'lost'        // Lost Customers & Loss Reasons (Expired in last 6 months, where did they go)
  | 'crm'         // Insurance CRM Calling View (Dispositions, Follow-ups, Call Notes)
  | 'register'    // Master Policy Register (Search, Detail Inspector, CSV Export)

const WORKSPACE_TABS: { id: DashboardWorkspace; label: string; icon: any; badge?: string }[] = [
  { id: 'overview', label: 'Executive Overview', icon: BarChart3 },
  { id: 'renewals', label: 'Retention & Cohorts', icon: History },
  { id: 'upcoming', label: 'Upcoming Expiries (≤30d)', icon: Clock, badge: 'Active' },
  { id: 'lost', label: 'Lost Customers (6M)', icon: UserX },
  { id: 'crm', label: 'Insurance CRM', icon: PhoneCall, badge: 'Calling' },
  { id: 'register', label: 'Policy Register', icon: FileText },
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

const DONUT_COLORS_POLICY_TYPE = ['#055B65', '#0D9488', '#14B8A6', '#2DD4BF', '#5EEAD4', '#99F6E4']
const VINTAGE_COLORS = ['#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4', '#ccfbf1']

const CRM_DISPOSITIONS: { id: CrmDisposition; label: string; color: string }[] = [
  { id: 'PENDING', label: 'Pending Call', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { id: 'INTERESTED', label: 'Interested', color: 'bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-300' },
  { id: 'FOLLOWUP_SCHEDULED', label: 'Follow-up Scheduled', color: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300' },
  { id: 'RENEWED_WON', label: 'Renewed / Converted', color: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300' },
  { id: 'LOST_COMPETITOR', label: 'Lost: Competitor Dealer', color: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300' },
  { id: 'LOST_ONLINE', label: 'Lost: Online Portal', color: 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300' },
  { id: 'LOST_PRICE', label: 'Lost: Price Disparity', color: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300' },
  { id: 'SOLD_VEHICLE', label: 'Vehicle Sold / Transferred', color: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200' },
  { id: 'WRONG_NUMBER', label: 'Wrong Number / Invalid', color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  { id: 'NOT_INTERESTED', label: 'Not Interested', color: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
]

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
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()

  // Primary Brand Type: Hyundai | Platinum | Kia
  const [insuranceType, setInsuranceType] = useState<InsuranceType>(() => {
    const raw = Array.isArray(initialSearchParams.type) ? initialSearchParams.type[0] : initialSearchParams.type
    return raw === 'platinum' || raw === 'kia' ? raw : 'hyundai'
  })

  // Active Workspace Tab
  const [activeWorkspace, setActiveWorkspace] = useState<DashboardWorkspace>('overview')

  // Date Filter States (All History default)
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

  // Upcoming & Lost Filter Tabs
  const [upcomingSubFilter, setUpcomingSubFilter] = useState<'all' | 'critical_7' | 'urgent_15' | 'standard_30'>('all')
  const [crmDispositionFilter, setCrmDispositionFilter] = useState<string>('all')

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

  // CRM Call Modal / Drawer State
  const [selectedCrmLead, setSelectedCrmLead] = useState<RenewalDue | null>(null)
  const [crmDraftDisposition, setCrmDraftDisposition] = useState<CrmDisposition>('PENDING')
  const [crmDraftLossReason, setCrmDraftLossReason] = useState<string>('')
  const [crmDraftRemarks, setCrmDraftRemarks] = useState<string>('')
  const [crmDraftFollowUpDate, setCrmDraftFollowUpDate] = useState<string>('')

  // Policy Register Search & Sorting State
  const [tableSearch, setTableSearch] = useState<string>('')
  const [tablePage, setTablePage] = useState<number>(1)
  const [tableSort, setTableSort] = useState<string>('policy_issue_date')
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc')
  const deferredSearch = useDeferredValue(tableSearch)

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

  // Renewal Pipeline Query (Upcoming 30d, Lost 6m & CRM)
  const renewalsPipelineQuery = useQuery<RenewalPipeline>({
    queryKey: ['insurance-pipeline', insuranceType],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/renewals?brands=${insuranceType}&lookaheadDays=90&lapsedDays=180`)
      if (!res.ok) throw new Error('Failed to fetch renewal pipeline')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
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

  // Save CRM Disposition Mutation
  const saveCrmMutation = useMutation({
    mutationFn: async (payload: {
      chassisNo: string
      policyNo?: string | null
      customerName?: string | null
      phone?: string | null
      disposition: CrmDisposition
      lossReason?: string | null
      remarks?: string | null
      followUpDate?: string | null
    }) => {
      const res = await fetch('/api/insurance/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Failed to save CRM record')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance-pipeline'] })
      setSelectedCrmLead(null)
    },
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
  const pipelineData = renewalsPipelineQuery.data

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

  // Monthly Trajectory Data (Jan 2025 forward with YoY comparisons)
  const monthlyTrajectory = useMemo(() => {
    return summaryData.monthlyTrajectory || []
  }, [summaryData.monthlyTrajectory])

  // Renewal Depth Vintages (1st Policy to 6th+ Renewal)
  const renewalDepth = useMemo(() => {
    return summaryData.renewalDepth || []
  }, [summaryData.renewalDepth])

  // Top Insurer Partners
  const insurerChartData = useMemo(() => {
    const raw = summaryData.companyBreakdown || []
    return raw.map((item: any) => ({
      name: item.company || 'Other',
      value: Number(item.policies || 0),
      premium: Number(item.grossPremium || 0),
      share: Number(item.sharePct || 0),
    }))
  }, [summaryData.companyBreakdown])

  // Upcoming 30d Filtered Rows
  const upcomingFilteredRows = useMemo(() => {
    const all = pipelineData?.upcoming30Rows || []
    if (upcomingSubFilter === 'all') return all
    return all.filter((r) => r.urgencySubBucket === upcomingSubFilter)
  }, [pipelineData?.upcoming30Rows, upcomingSubFilter])

  // Lost 6M Filtered Rows
  const lost6mRows = useMemo(() => {
    return pipelineData?.lost6mRows || []
  }, [pipelineData?.lost6mRows])

  // CRM Calling Rows
  const crmRows = useMemo(() => {
    const all = pipelineData?.rows || []
    if (crmDispositionFilter === 'all') return all
    return all.filter((r) => (r.disposition || 'PENDING') === crmDispositionFilter)
  }, [pipelineData?.rows, crmDispositionFilter])

  // Open CRM Modal Helper
  const openCrmModal = (lead: RenewalDue) => {
    setSelectedCrmLead(lead)
    setCrmDraftDisposition(lead.disposition || 'PENDING')
    setCrmDraftLossReason(lead.lossReason || '')
    setCrmDraftRemarks(lead.remarks || '')
    setCrmDraftFollowUpDate(lead.followUpDate || '')
  }

  // Universal Head-to-Toe Policy Inspection Handler across all tables & subsections
  const handleInspectPolicy = async (record: any) => {
    if (!record) return
    const initial = normalizePolicyRow(record)
    setSelectedPolicyRecord(initial)

    const chassis = record.chassisNo || record.chassis_no
    if (chassis) {
      try {
        const res = await fetch(`/api/insurance/policies?type=${insuranceType}&chassisNo=${encodeURIComponent(chassis)}`)
        if (res.ok) {
          const json = await res.json()
          const fullRows = json.policies || json.rows || []
          if (fullRows.length > 0) {
            setSelectedPolicyRecord(normalizePolicyRow(fullRows[0]))
          }
        }
      } catch {
        // Retain initial normalized preview
      }
    }
  }

  const handleSaveCrmDisposition = () => {
    if (!selectedCrmLead) return
    saveCrmMutation.mutate({
      chassisNo: selectedCrmLead.chassisNo,
      policyNo: selectedCrmLead.policyNo,
      customerName: selectedCrmLead.customerName,
      disposition: crmDraftDisposition,
      lossReason: crmDraftLossReason || null,
      remarks: crmDraftRemarks || null,
      followUpDate: crmDraftFollowUpDate || null,
    })
  }

  return (
    <MainLayout
      title="Insurance Analysis & CRM"
      subtitle="Executive Retention Analytics, Renewal Depth & Tele-Calling Command Center"
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
                        ? 'bg-[var(--dashboard-primary)] text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-100'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-black',
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                      )}
                    >
                      {b.initial}
                    </span>
                    <span>{b.label}</span>
                    {!b.isLive && (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300">
                        Feed Pending
                      </span>
                    )}
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
                    <Calendar className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
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
                    <Button size="sm" onClick={handleApplyFilters} className="h-7 text-xs font-bold bg-[var(--dashboard-primary)] text-white">
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
                        ? 'bg-[var(--dashboard-primary)] text-white'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    )}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    <span>Filters</span>
                    {activeSecondaryFilterCount > 0 && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-teal-200 text-teal-900 text-[9px] font-black">
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
                    {/* Dealership Branch */}
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
                    <Button size="sm" onClick={handleApplyFilters} className="h-8 text-xs font-bold bg-[var(--dashboard-primary)] text-white">
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
                  renewalsPipelineQuery.refetch()
                  if (activeWorkspace === 'register') policiesQuery.refetch()
                }}
                disabled={summaryQuery.isFetching || renewalsPipelineQuery.isFetching}
                className="h-8 rounded-xl border-slate-200 dark:border-slate-700 text-xs font-bold gap-1.5 shadow-2xs cursor-pointer"
              >
                <RefreshCw className={cn('h-3.5 w-3.5 text-slate-500', (summaryQuery.isFetching || renewalsPipelineQuery.isFetching) && 'animate-spin')} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>

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
            onClick={() => openDrilldown('Gross Premium Breakdown', 'All issued policies within selected scope')}
            className="group cursor-pointer rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all hover:shadow-md hover:border-[var(--dashboard-primary)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Gross Premium
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--dashboard-primary-soft,#ecfeff)] text-[var(--dashboard-primary)] group-hover:scale-105 transition-transform">
                <IndianRupee className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2.5">
              <p className="text-2xl font-black tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
                {formatCurrency(kpis.grossPremium || 0)}
              </p>
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>Net: {formatCompactCurrency(kpis.netPremium || 0)}</span>
                <span className="text-[var(--dashboard-primary)] flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  View Policies <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Total Policies Issued */}
          <div
            onClick={() => openDrilldown('Total Policies Issued', 'Complete policy volume in current scope')}
            className="group cursor-pointer rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all hover:shadow-md hover:border-teal-300 dark:hover:border-teal-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Policies Issued
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400 group-hover:scale-105 transition-transform">
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
                <span className="text-teal-600 dark:text-teal-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  Inspect <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: True Renewal Retention Rate */}
          <div
            onClick={() => setActiveWorkspace('renewals')}
            className="group cursor-pointer rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Renewal Retention
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 group-hover:scale-105 transition-transform">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2.5">
              <p className="text-2xl font-black tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
                {formatPercent(kpis.renewalRatePct || 0)}
              </p>
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>Renewals: {formatNumber(kpis.renewalCount || 0)}</span>
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  Retention Command <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>

          {/* Card 4: Upcoming 30-Day Expiries */}
          <div
            onClick={() => setActiveWorkspace('upcoming')}
            className="group cursor-pointer rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all hover:shadow-md hover:border-amber-300 dark:hover:border-amber-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Expiries (≤30 Days)
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 group-hover:scale-105 transition-transform">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2.5">
              <p className="text-2xl font-black tabular-nums tracking-tight text-amber-800 dark:text-amber-400">
                {formatNumber(pipelineData?.summary?.upcoming30Total || 0)}
              </p>
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                <span>At Risk: {formatCompactCurrency(pipelineData?.summary?.premiumUpcoming30 || 0)}</span>
                <span className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  Call Queue <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── WORKSPACE SEGMENTED TABS (6 WORKSPACES) ── */}
        <Tabs
          value={activeWorkspace}
          onValueChange={(v) => setActiveWorkspace(v as DashboardWorkspace)}
          className="space-y-4"
        >
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-xs">
            <TabsList className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 bg-transparent p-0 h-auto">
              {WORKSPACE_TABS.map((tab) => {
                const Icon = tab.icon
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="flex items-center justify-center gap-2 rounded-xl py-2 px-2.5 text-xs font-black text-slate-600 dark:text-slate-400 data-[state=active]:bg-[var(--dashboard-primary)] data-[state=active]:text-white transition-all shadow-none cursor-pointer"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                    {tab.badge && (
                      <span className="hidden sm:inline-block text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950">
                        {tab.badge}
                      </span>
                    )}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>

          {/* ══════════════════════════════════════════════════════════════════════
              WORKSPACE 1: EXECUTIVE OVERVIEW
          ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="overview" className="space-y-5">
            {/* 1. Month-Wise Trajectory & Same-Month-Last-Year YoY Matrix */}
            <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
              <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-[var(--dashboard-primary)]" />
                    Month-Wise Policy Volume & Same-Month-Last-Year (YoY) Performance
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    Chronological volume from Jan 2025 forward compared against the identical month in the previous year.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* Trajectory Bar & Line Combo Chart */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyTrajectory} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="monthLabel" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload
                            return (
                              <div className="rounded-xl border border-slate-200 bg-white/95 dark:bg-slate-900/95 p-3 shadow-lg text-xs space-y-1">
                                <p className="font-black text-slate-900 dark:text-slate-100">{d.monthLabel}</p>
                                <p className="font-extrabold text-[var(--dashboard-primary)]">Total: {formatNumber(d.policies)} policies</p>
                                <p className="text-slate-600 dark:text-slate-400">Renewals: {formatNumber(d.renewalCount)} | New: {formatNumber(d.newCount)}</p>
                                <p className="text-slate-600 dark:text-slate-400 font-bold">Gross: {formatCurrency(d.grossPremium)}</p>
                                {d.priorPolicies !== null && (
                                  <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                                    <span className="text-slate-500">Same Month Last Year ({d.priorYearKey}): </span>
                                    <span className="font-black text-slate-800 dark:text-slate-200">{formatNumber(d.priorPolicies)} policies</span>
                                    <p className={cn("font-bold", (d.yoyPoliciesDelta ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600")}>
                                      YoY: {(d.yoyPoliciesDelta ?? 0) >= 0 ? '+' : ''}{d.yoyPoliciesDelta} ({formatPercent(d.yoyPoliciesGrowthPct)})
                                    </p>
                                  </div>
                                )}
                              </div>
                            )
                          }
                          return null
                        }}
                      />
                      <Bar dataKey="renewalCount" name="Renewals" stackId="a" fill="#055B65" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="newCount" name="New Policies" stackId="a" fill="#14B8A6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Exact Month-on-Month Table with Same-Month-Last-Year deltas */}
                <div className="overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-xl">
                  <Table className="text-xs">
                    <TableHeader className="bg-slate-50 dark:bg-slate-800/60">
                      <TableRow>
                        <TableHead className="font-black text-slate-900 dark:text-slate-100">Month</TableHead>
                        <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Total Policies</TableHead>
                        <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Renewals</TableHead>
                        <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">New Purchase</TableHead>
                        <TableHead className="font-black text-right text-slate-900 dark:text-slate-100">Gross Premium</TableHead>
                        <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Prior Year Same Month</TableHead>
                        <TableHead className="font-black text-right text-slate-900 dark:text-slate-100">YoY Volume Growth</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthlyTrajectory.map((m: any) => (
                        <TableRow key={m.monthKey} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <TableCell className="font-black text-slate-900 dark:text-slate-100">{m.monthLabel}</TableCell>
                          <TableCell className="text-center font-bold">{formatNumber(m.policies)}</TableCell>
                          <TableCell className="text-center font-bold text-teal-700 dark:text-teal-400">{formatNumber(m.renewalCount)}</TableCell>
                          <TableCell className="text-center font-bold text-slate-600 dark:text-slate-300">{formatNumber(m.newCount)}</TableCell>
                          <TableCell className="text-right font-black">{formatCurrency(m.grossPremium)}</TableCell>
                          <TableCell className="text-center font-mono text-slate-500">
                            {m.priorPolicies !== null ? `${formatNumber(m.priorPolicies)} policies` : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {m.yoyPoliciesGrowthPct !== null ? (
                              <Badge className={cn(
                                "font-extrabold text-[10px]",
                                m.yoyPoliciesDelta >= 0
                                  ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                                  : "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300"
                              )}>
                                {m.yoyPoliciesDelta >= 0 ? '+' : ''}{m.yoyPoliciesDelta} ({formatPercent(m.yoyPoliciesGrowthPct)})
                              </Badge>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* 2. Customer Lifetime Renewal Depth (1st Policy to 6th+ Renewal) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <Card className="lg:col-span-2 rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-teal-600" />
                    Customer Lifetime Renewal Depth & Vintage Progression
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    Tracking repeat policy renewals per vehicle across multi-year ownership (1st Policy through 6th+ Renewal).
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    {renewalDepth.map((d: any, idx: number) => (
                      <div
                        key={d.sequence}
                        className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 space-y-1 text-center"
                      >
                        <span className="text-[10px] font-black text-slate-500 uppercase block">Tier {d.sequence}</span>
                        <p className="text-base font-black text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatNumber(d.uniqueVehicles)}
                        </p>
                        <span className="text-[10px] font-bold text-teal-700 dark:text-teal-400 block leading-tight">
                          {d.label.replace(' (New Purchase)', '').replace(' (2nd Year)', '')}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Visual Retention Depth Progression Bars */}
                  <div className="space-y-2 pt-2">
                    {renewalDepth.map((d: any, idx: number) => {
                      const base = renewalDepth[0]?.uniqueVehicles || 1
                      const pctOfFirst = (d.uniqueVehicles / base) * 100
                      return (
                        <div key={d.sequence} className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-bold">
                            <span className="text-slate-800 dark:text-slate-200">{d.label}</span>
                            <span className="font-mono text-slate-600 dark:text-slate-400">
                              {formatNumber(d.uniqueVehicles)} vehicles ({formatPercent(pctOfFirst)} lifetime retention)
                            </span>
                          </div>
                          <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.max(3, pctOfFirst)}%`,
                                backgroundColor: VINTAGE_COLORS[idx % VINTAGE_COLORS.length],
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* 3. Top Insurance Partners Snapshot */}
              <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-teal-600" />
                    Top Insurance Partners
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    Insurer market share and premium distribution.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-3 space-y-3">
                  {insurerChartData.slice(0, 5).map((ins: any, idx: number) => (
                    <div
                      key={ins.name}
                      onClick={() => openDrilldown(`Insurer: ${ins.name}`, 'Policies issued with this insurance company', { insuranceCompany: ins.name })}
                      className="group cursor-pointer rounded-xl border border-slate-100 dark:border-slate-800 p-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-black text-slate-900 dark:text-slate-100">{ins.name}</span>
                        <Badge className="bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-300 font-extrabold text-[10px]">
                          {formatPercent(ins.share)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold">
                        <span>{formatNumber(ins.value)} policies</span>
                        <span className="font-black text-slate-900 dark:text-slate-100">{formatCurrency(ins.premium)}</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--dashboard-primary)] rounded-full" style={{ width: `${Math.min(100, Math.max(4, ins.share))}%` }} />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              WORKSPACE 2: RETENTION & EXPIRY COHORTS (1 YEAR OUT)
          ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="renewals" className="space-y-5">
            <RenewalPipelinePanel brands={[insuranceType]} />
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              WORKSPACE 3: UPCOMING EXPIRIES (NEXT 30 DAYS)
          ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="upcoming" className="space-y-4">
            <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
              <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-600" />
                    Upcoming Expiries Queue (Next 30 Days)
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    High-priority renewals expiring within the next 30 days. Contact before expiry to prevent policy lapse.
                  </CardDescription>
                </div>

                {/* Urgency Sub-Filters */}
                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                  <button
                    type="button"
                    onClick={() => setUpcomingSubFilter('all')}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer',
                      upcomingSubFilter === 'all' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs' : 'text-slate-500'
                    )}
                  >
                    All ({pipelineData?.summary?.upcoming30Total || 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpcomingSubFilter('critical_7')}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer',
                      upcomingSubFilter === 'critical_7' ? 'bg-rose-600 text-white shadow-2xs' : 'text-rose-600'
                    )}
                  >
                    Critical ≤7d ({pipelineData?.summary?.critical7 || 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpcomingSubFilter('urgent_15')}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer',
                      upcomingSubFilter === 'urgent_15' ? 'bg-amber-600 text-white shadow-2xs' : 'text-amber-600'
                    )}
                  >
                    Urgent 8-15d ({pipelineData?.summary?.urgent15 || 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpcomingSubFilter('standard_30')}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer',
                      upcomingSubFilter === 'standard_30' ? 'bg-teal-600 text-white shadow-2xs' : 'text-teal-600'
                    )}
                  >
                    Standard 16-30d ({pipelineData?.summary?.standard30 || 0})
                  </button>
                </div>
              </CardHeader>
              <CardContent className="pt-3 space-y-4">
                {renewalsPipelineQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
                  </div>
                ) : upcomingFilteredRows.length === 0 ? (
                  <EmptyState title="No Upcoming Expiries" body="No policies found in selected urgency tier." />
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="text-xs">
                      <TableHeader className="bg-slate-50 dark:bg-slate-800/60">
                        <TableRow>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Expiry Date</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Urgency</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Customer Name</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Vehicle / Reg #</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Insurer</TableHead>
                          <TableHead className="font-black text-right text-slate-900 dark:text-slate-100">Last Premium</TableHead>
                          <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">CRM Status</TableHead>
                          <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {upcomingFilteredRows.map((r) => {
                          const dispConfig = CRM_DISPOSITIONS.find((d) => d.id === (r.disposition || 'PENDING'))
                          return (
                            <TableRow
                              key={r.chassisNo}
                              onClick={() => handleInspectPolicy(r)}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                            >
                              <TableCell className="font-black text-slate-900 dark:text-slate-100">
                                {formatDate(r.expiryDate)}
                              </TableCell>
                              <TableCell>
                                {r.daysToExpiry <= 7 ? (
                                  <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300 font-black text-[10px]">
                                    {r.daysToExpiry}d left
                                  </Badge>
                                ) : r.daysToExpiry <= 15 ? (
                                  <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 font-bold text-[10px]">
                                    {r.daysToExpiry}d left
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-slate-700 dark:text-slate-300 text-[10px]">
                                    {r.daysToExpiry}d left
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="font-black text-slate-900 dark:text-slate-100">
                                {r.customerName || '—'}
                              </TableCell>
                              <TableCell>
                                <div className="font-bold text-slate-800 dark:text-slate-200">{r.model || 'Hyundai Vehicle'}</div>
                                <span className="text-[10px] font-mono text-slate-400">{r.registrationNo || r.chassisNo}</span>
                              </TableCell>
                              <TableCell className="font-bold text-slate-700 dark:text-slate-300">{r.insuranceCompany}</TableCell>
                              <TableCell className="text-right font-black text-slate-900 dark:text-slate-100">
                                {formatCurrency(r.lastPremium)}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge className={cn("text-[10px] font-bold", dispConfig?.color)}>
                                  {dispConfig?.label || 'Pending'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    size="sm"
                                    onClick={() => openCrmModal(r)}
                                    className="h-6 px-2 text-[11px] font-black bg-[var(--dashboard-primary)] text-white gap-1 cursor-pointer"
                                  >
                                    <PhoneCall className="h-3 w-3" /> Log Call
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleInspectPolicy(r)}
                                    className="h-6 px-2 text-[11px] font-bold cursor-pointer"
                                  >
                                    Details
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              WORKSPACE 4: LOST CUSTOMERS (EXPIRED IN LAST 6 MONTHS)
          ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="lost" className="space-y-4">
            <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
              <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <UserX className="h-4 w-4 text-rose-600" />
                  Lost Customer Audit (Expired in Last 6 Months)
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                  Customers whose policies lapsed 31–180 days ago without renewing. Investigate loss reasons and win-back opportunities.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-3 space-y-4">
                {lost6mRows.length === 0 ? (
                  <EmptyState title="No Lost Customers" body="No lapsed records found in current scope." />
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="text-xs">
                      <TableHeader className="bg-slate-50 dark:bg-slate-800/60">
                        <TableRow>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Expired Date</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Days Lapsed</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Customer Name</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Vehicle / Chassis</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Last Insurer</TableHead>
                          <TableHead className="font-black text-right text-slate-900 dark:text-slate-100">Lost Premium</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Loss Reason / Destination</TableHead>
                          <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lost6mRows.map((r) => {
                          const dispConfig = CRM_DISPOSITIONS.find((d) => d.id === (r.disposition || 'PENDING'))
                          return (
                            <TableRow
                              key={r.chassisNo}
                              onClick={() => handleInspectPolicy(r)}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                            >
                              <TableCell className="font-bold text-slate-700 dark:text-slate-300">
                                {formatDate(r.expiryDate)}
                              </TableCell>
                              <TableCell>
                                <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300 font-mono text-[10px]">
                                  {Math.abs(r.daysToExpiry)}d ago
                                </Badge>
                              </TableCell>
                              <TableCell className="font-black text-slate-900 dark:text-slate-100">
                                {r.customerName || '—'}
                              </TableCell>
                              <TableCell>
                                <div className="font-bold text-slate-800 dark:text-slate-200">{r.model || 'Hyundai Vehicle'}</div>
                                <span className="text-[10px] font-mono text-slate-400">{r.chassisNo}</span>
                              </TableCell>
                              <TableCell className="font-bold text-slate-700 dark:text-slate-300">{r.insuranceCompany}</TableCell>
                              <TableCell className="text-right font-black text-rose-700 dark:text-rose-400">
                                {formatCurrency(r.lastPremium)}
                              </TableCell>
                              <TableCell>
                                {r.lossReason ? (
                                  <span className="font-bold text-slate-800 dark:text-slate-200">{r.lossReason}</span>
                                ) : (
                                  <Badge className={cn("text-[10px]", dispConfig?.color)}>
                                    {dispConfig?.label || 'Uncontacted'}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openCrmModal(r)}
                                    className="h-6 px-2 text-[11px] font-bold gap-1 cursor-pointer"
                                  >
                                    <MessageSquare className="h-3 w-3 text-slate-500" /> Log Reason
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleInspectPolicy(r)}
                                    className="h-6 px-2 text-[11px] font-black bg-[var(--dashboard-primary)] text-white cursor-pointer"
                                  >
                                    Details
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              WORKSPACE 5: INSURANCE CRM & TELECALLING VIEW
          ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="crm" className="space-y-4">
            <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
              <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <PhoneCall className="h-4 w-4 text-teal-600" />
                    Insurance Tele-Calling CRM Workspace
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    Live calling queue with real-time disposition tagging, follow-up scheduling, and call remarks logging.
                  </CardDescription>
                </div>

                {/* Disposition Filter */}
                <div className="flex items-center gap-2">
                  <Select value={crmDispositionFilter} onValueChange={setCrmDispositionFilter}>
                    <SelectTrigger className="h-8 rounded-xl text-xs w-48 font-bold">
                      <SelectValue placeholder="All Dispositions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Dispositions</SelectItem>
                      {CRM_DISPOSITIONS.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="pt-3 space-y-4">
                {crmRows.length === 0 ? (
                  <EmptyState title="No CRM Leads" body="No leads matching selected disposition filter." />
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="text-xs">
                      <TableHeader className="bg-slate-50 dark:bg-slate-800/60">
                        <TableRow>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Expiry Date</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Customer Name</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Vehicle / Model</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Insurer</TableHead>
                          <TableHead className="font-black text-right text-slate-900 dark:text-slate-100">Premium</TableHead>
                          <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Disposition</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Follow-up Date</TableHead>
                          <TableHead className="font-black text-slate-900 dark:text-slate-100">Remarks</TableHead>
                          <TableHead className="font-black text-center text-slate-900 dark:text-slate-100">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {crmRows.slice(0, 50).map((r) => {
                          const dispConfig = CRM_DISPOSITIONS.find((d) => d.id === (r.disposition || 'PENDING'))
                          return (
                            <TableRow
                              key={r.chassisNo}
                              onClick={() => handleInspectPolicy(r)}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                            >
                              <TableCell className="font-bold text-slate-700 dark:text-slate-300">
                                {formatDate(r.expiryDate)}
                              </TableCell>
                              <TableCell className="font-black text-slate-900 dark:text-slate-100">
                                {r.customerName || '—'}
                              </TableCell>
                              <TableCell>
                                <div className="font-bold text-slate-800 dark:text-slate-200">{r.model || 'Hyundai Vehicle'}</div>
                                <span className="text-[10px] font-mono text-slate-400">{r.registrationNo || r.chassisNo}</span>
                              </TableCell>
                              <TableCell className="font-bold text-slate-700 dark:text-slate-300">{r.insuranceCompany}</TableCell>
                              <TableCell className="text-right font-black">{formatCurrency(r.lastPremium)}</TableCell>
                              <TableCell className="text-center">
                                <Badge className={cn("text-[10px] font-bold", dispConfig?.color)}>
                                  {dispConfig?.label || 'Pending'}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-slate-600 dark:text-slate-400">
                                {r.followUpDate ? formatDate(r.followUpDate) : '—'}
                              </TableCell>
                              <TableCell className="max-w-48 truncate text-slate-600 dark:text-slate-400">
                                {r.remarks || '—'}
                              </TableCell>
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    size="sm"
                                    onClick={() => openCrmModal(r)}
                                    className="h-6 px-2.5 text-[11px] font-black bg-[var(--dashboard-primary)] text-white gap-1 cursor-pointer"
                                  >
                                    <PhoneCall className="h-3 w-3" /> Update
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleInspectPolicy(r)}
                                    className="h-6 px-2 text-[11px] font-bold cursor-pointer"
                                  >
                                    Details
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══════════════════════════════════════════════════════════════════════
              WORKSPACE 6: MASTER POLICY REGISTER
          ══════════════════════════════════════════════════════════════════════ */}
          <TabsContent value="register" className="space-y-4">
            <Card className="rounded-2xl border-slate-200/90 dark:border-slate-800 shadow-xs bg-white dark:bg-slate-900">
              <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-teal-600" />
                    Master Policy Register
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                    Search and inspect individual policy records across feeds.
                  </CardDescription>
                </div>

                {/* Instant Search Bar & CSV Export */}
                <div className="flex items-center gap-2 w-full md:w-auto">
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
                  <Button
                    size="sm"
                    onClick={() => {
                      const p = new URLSearchParams(policiesQueryParams)
                      p.set('export', 'csv')
                      window.open(`/api/insurance/policies?${p.toString()}`, '_blank')
                    }}
                    className="h-8 rounded-xl bg-[var(--dashboard-primary)] text-white text-xs font-bold gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>CSV</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-3 space-y-4">
                {policiesQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
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
                      {(() => {
                        const rawList = policiesQuery.data?.policies || policiesQuery.data?.rows || []
                        if (rawList.length === 0) {
                          return (
                            <TableRow>
                              <TableCell colSpan={9} className="text-center py-12 text-slate-400">
                                <div className="flex flex-col items-center justify-center space-y-2">
                                  <FileText className="h-7 w-7 text-slate-300 dark:text-slate-600" />
                                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No policies found matching current criteria</p>
                                  <p className="text-[11px] text-slate-400">Try adjusting your search keywords, branch filters, or date range.</p>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        }
                        return rawList.map((raw: any) => {
                          const p = normalizePolicyRow(raw)
                          return (
                            <TableRow
                              key={p.id || p.policyNo || p.chassisNo}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                              onClick={() => setSelectedPolicyRecord(p)}
                            >
                              <TableCell className="font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {formatDate(p.policyIssueDate)}
                              </TableCell>
                              <TableCell>
                                <div className="font-black text-slate-900 dark:text-slate-100">{p.policyNo || 'Pending Issue'}</div>
                                {p.proposalNo && <span className="text-[10px] text-slate-400 font-mono block">{p.proposalNo}</span>}
                              </TableCell>
                              <TableCell className="font-black text-slate-900 dark:text-slate-100">
                                {p.customerName}
                              </TableCell>
                              <TableCell>
                                <div className="font-bold text-slate-800 dark:text-slate-200">{p.modelName}</div>
                                <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
                                  {p.vehRegistNo !== '—' && <span className="font-semibold text-slate-600 dark:text-slate-400">{p.vehRegistNo}</span>}
                                  <span>({p.chassisNo})</span>
                                </div>
                              </TableCell>
                              <TableCell className="font-bold text-slate-700 dark:text-slate-300">
                                {p.insuranceCompany}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300">
                                  {p.policyType}
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
                                    {p.column64vbStatus}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <Button
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedPolicyRecord(p)
                                  }}
                                  className="h-6 px-2.5 text-[11px] font-black bg-[var(--dashboard-primary)] text-white gap-1 cursor-pointer"
                                >
                                  Details
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })
                      })()}
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
                        className="h-7 text-xs font-bold cursor-pointer"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" /> Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTablePage((prev) => Math.min(policiesQuery.data.totalPages, prev + 1))}
                        disabled={tablePage === policiesQuery.data.totalPages}
                        className="h-7 text-xs font-bold cursor-pointer"
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

    {/* ── CRM CALL & DISPOSITION MODAL ── */}
    <Dialog open={Boolean(selectedCrmLead)} onOpenChange={(open) => !open && setSelectedCrmLead(null)}>
      <DialogContent className="max-w-xl rounded-3xl p-6 space-y-4">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <DialogTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <PhoneCall className="h-4.5 w-4.5 text-teal-600" />
            Log Customer Call & Disposition
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Customer: <span className="font-bold text-slate-900 dark:text-slate-100">{selectedCrmLead?.customerName}</span> | Chassis: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{selectedCrmLead?.chassisNo}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 text-xs">
          {/* Disposition Selector */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
              Call Disposition Status
            </label>
            <Select value={crmDraftDisposition} onValueChange={(v) => setCrmDraftDisposition(v as CrmDisposition)}>
              <SelectTrigger className="h-9 rounded-xl text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CRM_DISPOSITIONS.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Loss Reason (when disposition is a loss) */}
          {crmDraftDisposition.startsWith('LOST_') && (
            <div>
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Loss Reason & Customer Destination
              </label>
              <Input
                placeholder="e.g. Bought from PolicyBazaar, Moved to other brand, Price mismatch..."
                value={crmDraftLossReason}
                onChange={(e) => setCrmDraftLossReason(e.target.value)}
                className="h-8 text-xs rounded-xl"
              />
            </div>
          )}

          {/* Follow-up Date */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
              Next Follow-up Date (Optional)
            </label>
            <Input
              type="date"
              value={crmDraftFollowUpDate}
              onChange={(e) => setCrmDraftFollowUpDate(e.target.value)}
              className="h-8 text-xs rounded-xl"
            />
          </div>

          {/* Telecaller Remarks */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
              Telecaller Notes & Remarks
            </label>
            <Input
              placeholder="Customer requested quote on WhatsApp, will decide by Friday..."
              value={crmDraftRemarks}
              onChange={(e) => setCrmDraftRemarks(e.target.value)}
              className="h-8 text-xs rounded-xl"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="outline" size="sm" onClick={() => setSelectedCrmLead(null)} className="h-8 text-xs font-bold">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveCrmDisposition}
              disabled={saveCrmMutation.isPending}
              className="h-8 text-xs font-bold bg-[var(--dashboard-primary)] text-white gap-1.5"
            >
              {saveCrmMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Save Disposition
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* ── INTERACTIVE DRILLDOWN MODAL ── */}
    <Dialog open={drilldownModal.open} onOpenChange={(open) => setDrilldownModal((prev) => ({ ...prev, open }))}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto rounded-3xl p-6">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <DialogTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-teal-600" />
            {drilldownModal.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {drilldownModal.subtitle}
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 space-y-3">
          {drilldownQuery.isLoading ? (
            <div className="flex min-h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
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
                  {(() => {
                    const list = drilldownQuery.data?.policies || drilldownQuery.data?.rows || []
                    if (list.length === 0) {
                      return (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-slate-400">
                            No policies found in this drilldown.
                          </TableCell>
                        </TableRow>
                      )
                    }
                    return list.map((raw: any) => {
                      const p = normalizePolicyRow(raw)
                      return (
                        <TableRow
                          key={p.id || p.policyNo || p.chassisNo}
                          onClick={() => handleInspectPolicy(raw)}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                        >
                          <TableCell className="font-bold">{formatDate(p.policyIssueDate)}</TableCell>
                          <TableCell className="font-mono font-black">{p.policyNo || 'Pending'}</TableCell>
                          <TableCell className="font-bold">{p.customerName}</TableCell>
                          <TableCell>{p.modelName}</TableCell>
                          <TableCell>{p.insuranceCompany}</TableCell>
                          <TableCell className="text-right font-black">{formatCurrency(p.grossPremium)}</TableCell>
                        </TableRow>
                      )
                    })
                  })()}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* ── FULL POLICY DETAILS INSPECTOR MODAL (HEAD-TO-TOE) ── */}
    <Dialog open={Boolean(selectedPolicyRecord)} onOpenChange={(open) => !open && setSelectedPolicyRecord(null)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 space-y-5">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--dashboard-primary-soft,#ecfeff)] text-[var(--dashboard-primary)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-black text-slate-900 dark:text-slate-100">
                  {selectedPolicyRecord?.policyNo || selectedPolicyRecord?.proposalNo || 'Policy Record Details'}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 font-mono">
                  Chassis: <span className="font-black text-slate-800 dark:text-slate-200">{selectedPolicyRecord?.chassisNo}</span>
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-300 font-black text-xs px-2.5 py-0.5">
                {selectedPolicyRecord?.policyType || 'Comprehensive'}
              </Badge>
              {selectedPolicyRecord?.column64vbStatus === 'VERIFIED' ? (
                <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 font-black text-xs px-2.5 py-0.5">
                  64VB Verified
                </Badge>
              ) : (
                <Badge variant="secondary" className="font-bold text-xs">
                  {selectedPolicyRecord?.column64vbStatus || 'Pending'}
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        {selectedPolicyRecord && (
          <div className="space-y-4 text-xs">
            {/* 1. Vehicle Specifications & Studio Photo Hero Banner */}
            <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="relative h-24 w-36 shrink-0 overflow-hidden rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-center justify-center p-1">
                <img
                  src={getVehicleModelPhoto(selectedPolicyRecord.modelName)}
                  alt={selectedPolicyRecord.modelName}
                  className="h-full w-full object-contain"
                  onError={(e) => {
                    const target = e.currentTarget
                    if (target.src !== STATIC_VEHICLE_FALLBACK) {
                      target.src = STATIC_VEHICLE_FALLBACK
                    }
                  }}
                />
              </div>
              <div className="flex-1 space-y-1 w-full text-center sm:text-left">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <h4 className="text-base font-black text-slate-900 dark:text-slate-100">
                    {selectedPolicyRecord.modelName}
                  </h4>
                  <Badge variant="outline" className="font-mono text-[10px] font-bold">
                    Reg: {selectedPolicyRecord.vehRegistNo || 'New Vehicle'}
                  </Badge>
                </div>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {selectedPolicyRecord.variantName || 'Standard Variant'}
                </p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 text-[11px] text-slate-500 font-medium pt-1">
                  <span>Fuel: <strong className="text-slate-700 dark:text-slate-300">{selectedPolicyRecord.fuelType}</strong></span>
                  <span>Mfg Year: <strong className="text-slate-700 dark:text-slate-300">{selectedPolicyRecord.mfgYear}</strong></span>
                  {selectedPolicyRecord.engineNo !== '—' && (
                    <span>Engine: <strong className="font-mono text-slate-700 dark:text-slate-300">{selectedPolicyRecord.engineNo}</strong></span>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Customer & Timeline Matrix */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                  Customer & Identity
                </span>
                <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                  {selectedPolicyRecord.customerName}
                </p>
                <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                  <p>Policy #: <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{selectedPolicyRecord.policyNo || '—'}</span></p>
                  <p>Proposal #: <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{selectedPolicyRecord.proposalNo || '—'}</span></p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                  Policy Validity Timeline
                </span>
                <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                  <p>Issue Date: <strong className="text-slate-800 dark:text-slate-200">{formatDate(selectedPolicyRecord.policyIssueDate)}</strong></p>
                  <p>Start Date: <strong className="text-slate-800 dark:text-slate-200">{formatDate(selectedPolicyRecord.policyStartDate)}</strong></p>
                  <p>OD Expiry: <strong className="text-rose-600 dark:text-rose-400">{formatDate(selectedPolicyRecord.odExpiryDate)}</strong></p>
                </div>
              </div>
            </div>

            {/* 3. Comprehensive Financials & Premium Breakdown */}
            <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-teal-50/50 dark:bg-teal-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-teal-100 dark:border-teal-900/50 pb-2">
                <span className="text-xs font-black text-teal-950 dark:text-teal-200 uppercase tracking-wider flex items-center gap-1.5">
                  <IndianRupee className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400" />
                  Financials & Premium Breakdown
                </span>
                <span className="text-xs font-bold text-slate-500">
                  IDV: <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(selectedPolicyRecord.totalIdv)}</strong>
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center sm:text-left">
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-teal-100/80 dark:border-teal-900/30 space-y-0.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Gross Premium</span>
                  <p className="text-base font-black text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatCurrency(selectedPolicyRecord.grossPremium)}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-teal-100/80 dark:border-teal-900/30 space-y-0.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Net Premium</span>
                  <p className="text-base font-black text-teal-700 dark:text-teal-300 tabular-nums">
                    {formatCurrency(selectedPolicyRecord.netPremium)}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-teal-100/80 dark:border-teal-900/30 space-y-0.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Net OD Premium</span>
                  <p className="text-sm font-black text-slate-800 dark:text-slate-200 tabular-nums">
                    {formatCurrency(selectedPolicyRecord.netOdPremiumA)}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-teal-100/80 dark:border-teal-900/30 space-y-0.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">TP Liability</span>
                  <p className="text-sm font-black text-slate-800 dark:text-slate-200 tabular-nums">
                    {formatCurrency(selectedPolicyRecord.thirdPartyLiability)}
                  </p>
                </div>
              </div>

              {(selectedPolicyRecord.addOnPremium > 0 || selectedPolicyRecord.serviceTax > 0) && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1 text-slate-600 dark:text-slate-400 font-medium">
                  {selectedPolicyRecord.addOnPremium > 0 && (
                    <span>Add-on Premium: <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(selectedPolicyRecord.addOnPremium)}</strong></span>
                  )}
                  {selectedPolicyRecord.serviceTax > 0 && (
                    <span>Service Tax / GST: <strong className="text-slate-900 dark:text-slate-100">{formatCurrency(selectedPolicyRecord.serviceTax)}</strong></span>
                  )}
                </div>
              )}
            </div>

            {/* 4. Partner Attribution & Terms */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                  Insurance Partner & Dealership
                </span>
                <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                  {selectedPolicyRecord.insuranceCompany}
                </p>
                <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                  <p>Branch / Location: <strong className="text-slate-800 dark:text-slate-200">{selectedPolicyRecord.subUser}</strong></p>
                  <p>RM / Executive: <strong className="text-slate-800 dark:text-slate-200">{selectedPolicyRecord.rmName}</strong></p>
                  <p>Dealer Code: <strong className="font-mono text-slate-800 dark:text-slate-200">{selectedPolicyRecord.dealerCode}</strong></p>
                  <p>Payment Mode: <strong className="text-slate-800 dark:text-slate-200">{selectedPolicyRecord.paymentMode}</strong></p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                  Coverage & Tenure Details
                </span>
                <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                  <p>OD Tenure: <strong className="text-slate-800 dark:text-slate-200">{selectedPolicyRecord.odTenure}</strong></p>
                  <p>TP Tenure: <strong className="text-slate-800 dark:text-slate-200">{selectedPolicyRecord.tpTenure}</strong></p>
                  <p>Current NCB: <strong className="text-teal-600 font-bold">{selectedPolicyRecord.currentNcb}</strong></p>
                  {selectedPolicyRecord.addonOpted !== '—' && (
                    <p>Addons Opted: <span className="text-slate-700 dark:text-slate-300 font-bold">{selectedPolicyRecord.addonOpted}</span></p>
                  )}
                </div>
              </div>
            </div>

            {/* 5. Footer Actions */}
            <div className="pt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const txt = `Policy Record: ${selectedPolicyRecord.policyNo || selectedPolicyRecord.proposalNo}\nCustomer: ${selectedPolicyRecord.customerName}\nVehicle: ${selectedPolicyRecord.modelName} (${selectedPolicyRecord.chassisNo})\nInsurer: ${selectedPolicyRecord.insuranceCompany}\nGross Premium: ${formatCurrency(selectedPolicyRecord.grossPremium)}\nIssue Date: ${formatDate(selectedPolicyRecord.policyIssueDate)}\nExpiry Date: ${formatDate(selectedPolicyRecord.odExpiryDate)}`
                  navigator.clipboard.writeText(txt)
                }}
                className="h-8 text-xs font-bold gap-1.5 cursor-pointer"
              >
                Copy Details
              </Button>
              <Button
                size="sm"
                onClick={() => setSelectedPolicyRecord(null)}
                className="h-8 text-xs font-bold bg-[var(--dashboard-primary)] text-white cursor-pointer"
              >
                Close Inspector
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  </div>
</MainLayout>
  )
}
