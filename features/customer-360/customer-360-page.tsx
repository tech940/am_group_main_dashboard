'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { MainLayout } from '@/components/layout/main-layout'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Users,
  Car,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Wrench,
  AlertTriangle,
  AlertCircle,
  Clock,
  ChevronRight,
  ChevronLeft,
  Search,
  Filter,
  ArrowUpRight,
  ArrowRight,
  RefreshCw,
  FileText,
  CheckCircle2,
  Phone,
  Mail,
  MapPin,
  Building2,
  Calendar,
  Layers,
  ExternalLink,
  Lock,
  X,
  Sparkles,
  Activity,
  Compass,
  ArrowLeft,
  CircleDot,
  Info,
  Check,
  Copy,
  User,
  UserCheck,
  UserX,
  CreditCard,
  MessageSquare,
  LayoutGrid,
  List,
} from 'lucide-react'
import type { KiaCustomerGaps, KiaCustomerListResult, KiaCustomerProfile, KiaCustomerSummary } from '@/lib/kia/customer-profile/reader'
import type { BrandCapabilities, CustomerBrand } from '@/lib/customer-360/brands'
import { cn } from '@/lib/utils'

type BrandOption = { brand: CustomerBrand; label: string; salesOnly: string | null }

type BrandMeta = {
  brand?: CustomerBrand
  capabilities?: BrandCapabilities
  salesOnly?: string | null
  brands?: BrandOption[]
}

type CommonVehicle = {
  brand: CustomerBrand
  brandLabel: string
  customerId: string | null
  name: string | null
  outlet: string | null
  model: string | null
  invoiceDate: string | null
}

type CommonCustomer = {
  key: string
  name: string | null
  brands: CustomerBrand[]
  confidence: 'confirmed' | 'likely'
  evidence: string
  vehicles: CommonVehicle[]
}

type CommonResult = {
  rows: CommonCustomer[]
  total: number
  pairCounts: { pair: string; confirmed: number; likely: number }[]
  notes: string[]
}

const FULL_CAPS: BrandCapabilities = {
  enquiries: true, bookings: true, service: true, insurance: true,
  complaints: true, receipts: true, phone: true, vin: true,
}

type GapKey = keyof KiaCustomerGaps

const GAPS: { key: GapKey; label: string; shortLabel: string; help: string; icon: typeof Users; badgeCls: string }[] = [
  {
    key: 'enquiryNoBooking',
    label: 'Enquired, never booked',
    shortLabel: 'Enquiry Drop-off',
    help: 'Customer logged an enquiry but no booking was ever created.',
    icon: Compass,
    badgeCls: 'bg-amber-50 text-amber-800 border-amber-200/80',
  },
  {
    key: 'bookingNoInsurance',
    label: 'No insurance on record',
    shortLabel: 'Uninsured with us',
    help: 'Vehicle sold but no insurance policy recorded in our system.',
    icon: ShieldAlert,
    badgeCls: 'bg-rose-50 text-rose-800 border-rose-200/80',
  },
  {
    key: 'noRecentService',
    label: 'No recent service',
    shortLabel: 'Lapsed Service',
    help: 'No service visit recorded within the active service window.',
    icon: Wrench,
    badgeCls: 'bg-violet-50 text-violet-800 border-violet-200/80',
  },
  {
    key: 'openComplaint',
    label: 'Open complaint',
    shortLabel: 'Open Complaint',
    help: 'Customer has an unresolved complaint requiring management attention.',
    icon: AlertTriangle,
    badgeCls: 'bg-rose-100 text-rose-900 border-rose-300 font-bold',
  },
  {
    key: 'insuranceLapsed',
    label: 'Insurance lapsed',
    shortLabel: 'Policy Lapsed',
    help: 'The most recent insurance policy held with us has expired.',
    icon: Clock,
    badgeCls: 'bg-rose-50 text-rose-800 border-rose-200/80',
  },
  {
    key: 'bookedNotDelivered',
    label: 'Booked, not delivered',
    shortLabel: 'Pending Delivery',
    help: 'Vehicle booked but delivery handover has not been recorded.',
    icon: Car,
    badgeCls: 'bg-blue-50 text-blue-800 border-blue-200/80',
  },
]

export type InferredGender = 'male' | 'female' | 'corporate'

export function detectGender(name: string | null): InferredGender {
  if (!name) return 'male'
  const clean = name.trim().toLowerCase()
  const words = clean.split(/[\s,./\-_()]+/).filter(Boolean)
  if (!words.length) return 'male'

  const corporateKeywords = new Set([
    'ltd', 'limited', 'pvt', 'private', 'motors', 'services', 'travels', 'transport', 'enterprises',
    'corporation', 'corp', 'agency', 'agencies', 'firm', 'works', 'solutions', 'bank', 'trust',
    'school', 'college', 'hospital', 'academy', 'associates', 'industries', 'traders', 'trading',
    'auto', 'logistics', 'infra', 'infrastructure', 'club', 'hotel', 'society', 'foundation', 'govt',
    'department', 'police', 'security', 'builders', 'ventures', 'commercial'
  ])
  for (const w of words) {
    if (corporateKeywords.has(w)) return 'corporate'
  }

  if (words[0] === 'mrs' || words[0] === 'ms' || words[0] === 'miss' || words[0] === 'smt' || words[0] === 'shrimati') {
    return 'female'
  }

  if (words[0] === 'mr' || words[0] === 'shri' || words[0] === 'sh' || words[0] === 'sardar') {
    return 'male'
  }

  const femaleKeywords = new Set([
    'kaur', 'devi', 'begum', 'khatoon', 'kumari', 'bai', 'bibi', 'bano', 'jahan', 'ara', 'parveen',
    'rubina', 'shabnam', 'nasreen', 'shazia', 'tahira', 'fatima', 'zeenat', 'yasmeen', 'priya',
    'pooja', 'puja', 'neha', 'anjali', 'sunita', 'anita', 'rekha', 'geeta', 'gita', 'seema', 'meena',
    'reena', 'rina', 'kavita', 'rashmi', 'shweta', 'poonam', 'mamta', 'monika', 'komal', 'deepika',
    'divya', 'neetu', 'nitu', 'sonia', 'priyanka', 'tanvi', 'simran', 'sakshi', 'payal', 'ritika',
    'sneha', 'arti', 'aarti', 'vandana', 'radha', 'laxmi', 'lakshmi', 'kiran', 'sonam', 'alka', 'usha',
    'sarita', 'asha', 'sudha', 'manju', 'anuradha', 'nirmala', 'savita', 'jyoti', 'swati', 'renu',
    'archana', 'bhavna', 'mona', 'shalu', 'chhaya', 'preeti', 'priti', 'ritu', 'sheetal', 'kanchan',
    'sapna', 'madhu', 'anamika', 'garima', 'nisha', 'kamlesh', 'shilpa', 'richa', 'khushboo', 'anupam',
    'gunjan', 'kanika', 'charu', 'pallavi', 'bina', 'suman', 'santosh', 'pinki', 'pinky', 'tanya',
    'mansi', 'shreya', 'rashi', 'avani', 'aditi', 'tanisha', 'ishita', 'muskan', 'megha', 'rashmika',
    'akanksha', 'nidha', 'asma', 'ayesha', 'zoya', 'sana', 'samina', 'salma', 'mumtaz', 'razia',
    'nazia', 'farzana', 'farah', 'afreen', 'tasleem', 'reshma', 'deepa', 'radhika', 'shristi',
    'srishti', 'kriti', 'sonal', 'meghna', 'vaishali', 'prerna', 'namrata', 'khushi', 'ananya', 'diya',
    'shagun', 'navneet', 'harpreet', 'jaspreet', 'manpreet', 'gurpreet', 'gurmeet', 'amrit'
  ])

  for (const w of words) {
    if (femaleKeywords.has(w)) {
      if (words.includes('singh')) return 'male'
      return 'female'
    }
  }

  return 'male'
}

function getInitials(name: string | null): string {
  if (!name) return 'CU'
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'CU'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * Clean, modern executive avatar badge with subtle typography & neutral tones.
 */
export function ExecutiveAvatar({
  name,
  size = 'md',
  className,
}: {
  name: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const initials = getInitials(name)
  const gender = detectGender(name)

  const sizeClasses = {
    sm: 'h-9 w-9 text-xs rounded-xl',
    md: 'h-11 w-11 text-sm rounded-xl',
    lg: 'h-14 w-14 text-base rounded-2xl',
    xl: 'h-18 w-18 md:h-20 md:w-20 text-2xl rounded-full',
  }[size]

  if (gender === 'corporate') {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center bg-[var(--dashboard-primary)] text-white font-black border border-white/20 shadow-xs",
          sizeClasses,
          className
        )}
        title={`${name || 'Customer'} (Corporate Account)`}
      >
        <Building2 className={size === 'xl' ? 'h-8 w-8' : 'h-4 w-4'} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center font-black tracking-tight bg-[var(--dashboard-primary)] text-white border border-white/20 shadow-xs select-none",
        sizeClasses,
        className
      )}
      title={`${name || 'Customer'} (${gender === 'female' ? 'Female' : 'Male'})`}
    >
      <span>{initials}</span>
    </div>
  )
}

function fmtDate(value: string | null) {
  if (!value) return '—'
  const parts = value.split('-')
  if (parts.length !== 3) return value
  const [y, m, d] = parts
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function Customer360Page({ canViewPii }: { canViewPii: boolean }) {
  const [view, setView] = useState<'directory' | 'common'>('directory')
  const [displayMode, setDisplayMode] = useState<'grid' | 'table'>('grid')
  const [brand, setBrand] = useState<CustomerBrand>('kia')
  const [draftSearch, setDraftSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [gap, setGap] = useState<GapKey | null>(null)
  const [serviceGapMonths, setServiceGapMonths] = useState(12)
  const [page, setPage] = useState(1)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const deferredSearch = useDeferredValue(appliedSearch)

  const listParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('brand', brand)
    if (deferredSearch) params.set('search', deferredSearch)
    if (gap) params.set('gap', gap)
    params.set('service_gap_months', String(serviceGapMonths))
    params.set('page', String(page))
    params.set('page_size', displayMode === 'grid' ? '24' : '30')
    return params.toString()
  }, [brand, deferredSearch, gap, serviceGapMonths, page, displayMode])

  const list = useQuery<KiaCustomerListResult & BrandMeta>({
    queryKey: ['customer-360', 'list', listParams],
    queryFn: async () => {
      const res = await fetch(`/api/customer-360?${listParams}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
  })

  const profile = useQuery<KiaCustomerProfile & BrandMeta>({
    queryKey: ['customer-360', 'detail', brand, openKey, serviceGapMonths],
    enabled: Boolean(openKey),
    queryFn: async () => {
      const res = await fetch(
        `/api/customer-360/${encodeURIComponent(openKey!)}`
        + `?brand=${brand}&service_gap_months=${serviceGapMonths}`,
      )
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
  })

  const common = useQuery<CommonResult>({
    queryKey: ['customer-360', 'common'],
    enabled: view === 'common',
    queryFn: async () => {
      const res = await fetch('/api/customer-360/common')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })

  const applySearch = () => { setAppliedSearch(draftSearch.trim()); setPage(1) }
  const clearFilters = () => { setDraftSearch(''); setAppliedSearch(''); setGap(null); setPage(1) }

  const caps = list.data?.capabilities ?? FULL_CAPS
  const salesOnly = list.data?.salesOnly ?? null
  const brandOptions: BrandOption[] = list.data?.brands ?? []

  const switchBrand = (next: CustomerBrand) => {
    setBrand(next)
    setPage(1)
    setGap(null)
    setOpenKey(null)
  }

  const totalGapsCount = useMemo(() => {
    if (!list.data?.gapCounts) return 0
    return Object.values(list.data.gapCounts).reduce((a, b) => a + b, 0)
  }, [list.data?.gapCounts])

  return (
    <MainLayout>
      <div className="min-h-screen bg-slate-50/50 p-4 md:p-8 space-y-7">
        {/* ========================================================================= */}
        {/* EXECUTIVE HEADER                                                          */}
        {/* ========================================================================= */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-[var(--dashboard-primary)] text-white shadow-2xs">
                Customer Intelligence
              </span>
              <span className="text-xs font-semibold text-slate-400">AM Group 360</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight mt-1.5 font-sans">
              Customer 360
            </h1>
            <p className="mt-0.5 text-xs md:text-sm font-medium text-slate-500 max-w-2xl">
              Complete customer lifecycle directory. Click any customer to inspect full vehicle garage, service history, and timeline.
            </p>
          </div>

          {/* View Toggle Bar (Directory vs Common Customers) */}
          <div className="flex items-center gap-2">
            <div className="flex items-center p-1 bg-white rounded-xl border border-slate-200 shadow-2xs">
              <button
                type="button"
                onClick={() => setView('directory')}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  view === 'directory'
                    ? "bg-[var(--dashboard-primary)] text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                )}
              >
                <Users className="h-3.5 w-3.5" />
                Directory
              </button>
              <button
                type="button"
                onClick={() => setView('common')}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                  view === 'common'
                    ? "bg-[var(--dashboard-primary)] text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                )}
              >
                <Layers className="h-3.5 w-3.5" />
                Cross-Brand
                {common.data?.total ? (
                  <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-white text-[10px] font-black">
                    {common.data.total}
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* BRAND SELECTOR STRIP                                                      */}
        {/* ========================================================================= */}
        {view === 'directory' && brandOptions.length > 1 && (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-bold text-slate-400 mr-1 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Dealership:
            </span>
            {brandOptions.map((option) => {
              const active = option.brand === brand
              return (
                <button
                  key={option.brand}
                  type="button"
                  onClick={() => switchBrand(option.brand)}
                  className={cn(
                    "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer",
                    active
                      ? "bg-white text-[var(--dashboard-primary)] border-[var(--dashboard-primary)] ring-1 ring-[var(--dashboard-primary)]/20 shadow-2xs"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-[var(--dashboard-primary)]" : "bg-slate-300")} />
                  <span>{option.label}</span>
                  {option.salesOnly ? (
                    <span className="px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 text-[10px] font-semibold border border-amber-200">
                      Sales Only
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200">
                      Full 360
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* ========================================================================= */}
        {/* MAIN BODY                                                                 */}
        {/* ========================================================================= */}
        {view === 'common' ? (
          <CommonCustomers query={common} />
        ) : (
          <div className="space-y-6">
            {/* Sales-Only Warning Banner */}
            {salesOnly && (
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-amber-900 text-xs">
                <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong className="font-black uppercase mr-1">Notice for {brand.toUpperCase()}:</strong>
                  {salesOnly}
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* LIFECYCLE OPPORTUNITY CARDS                                          */}
            {/* ===================================================================== */}
            {caps.service && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-slate-500" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Lifecycle Retention Opportunities ({totalGapsCount.toLocaleString('en-IN')})
                    </h2>
                  </div>
                  {gap && (
                    <button
                      type="button"
                      onClick={() => { setGap(null); setPage(1) }}
                      className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                    >
                      <X className="h-3 w-3" /> Clear Filter
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  {GAPS.map((item) => {
                    const active = gap === item.key
                    const count = list.data?.gapCounts?.[item.key]
                    const Icon = item.icon
                    return (
                      <button
                        key={item.key}
                        type="button"
                        title={item.help}
                        onClick={() => { setGap(active ? null : item.key); setPage(1) }}
                        className={cn(
                          "p-3.5 rounded-xl border text-left transition-all group cursor-pointer flex flex-col justify-between",
                          active
                            ? "bg-[var(--dashboard-primary)] text-white border-[var(--dashboard-primary)] shadow-sm"
                            : "bg-white text-slate-800 border-slate-200/80 hover:border-slate-300"
                        )}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                            active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700"
                          )}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-1.5 py-0.2 rounded border",
                            active
                              ? "bg-white/10 text-slate-200 border-white/20"
                              : "bg-slate-50 text-slate-400 border-slate-200"
                          )}>
                            {active ? 'Active' : 'Filter'}
                          </span>
                        </div>

                        <div className="mt-3">
                          <div className={cn(
                            "text-xl font-black font-sans tabular-nums tracking-tight",
                            active ? "text-white" : "text-slate-900"
                          )}>
                            {count === undefined ? '—' : count.toLocaleString('en-IN')}
                          </div>
                          <div className={cn(
                            "text-[11px] font-bold mt-0.5 truncate",
                            active ? "text-slate-200" : "text-slate-600"
                          )}>
                            {item.label}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ===================================================================== */}
            {/* SEARCH & CONTROLS BAR                                                */}
            {/* ===================================================================== */}
            <div className="p-3 rounded-xl bg-white border border-slate-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-1 min-w-[260px] max-w-xl items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    id="cp-search"
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') applySearch() }}
                    placeholder={caps.phone
                      ? "Search name, phone (9149...), VIN, or registration..."
                      : "Search name, customer ID, or model..."}
                    className="w-full pl-9 pr-8 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50/50 text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-[var(--dashboard-primary)] focus:ring-1 focus:ring-[var(--dashboard-primary)]/20 outline-none transition-all"
                  />
                  {draftSearch && (
                    <button
                      type="button"
                      onClick={() => { setDraftSearch(''); setAppliedSearch(''); setPage(1) }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={applySearch}
                  className="px-4 py-2 rounded-lg bg-[var(--dashboard-primary)] hover:opacity-90 text-white text-xs font-bold transition-all cursor-pointer shrink-0 shadow-2xs"
                >
                  Search
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {caps.service && (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <span>Window:</span>
                    <select
                      id="cp-months"
                      value={serviceGapMonths}
                      onChange={(e) => { setServiceGapMonths(Number(e.target.value)); setPage(1) }}
                      className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-slate-50 text-slate-700 outline-none cursor-pointer"
                    >
                      {[6, 9, 12, 18, 24].map((m) => (
                        <option key={m} value={m}>{m} Months</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Display Mode Switcher (Grid vs Table) */}
                <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setDisplayMode('grid')}
                    title="Grid Card View"
                    className={cn(
                      "p-1.5 rounded-md transition-all cursor-pointer",
                      displayMode === 'grid' ? "bg-white text-[var(--dashboard-primary)] shadow-2xs" : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayMode('table')}
                    title="Table List View"
                    className={cn(
                      "p-1.5 rounded-md transition-all cursor-pointer",
                      displayMode === 'table' ? "bg-white text-[var(--dashboard-primary)] shadow-2xs" : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                </div>

                {(appliedSearch || gap) && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* PII Redaction Notice */}
            {!canViewPii && (
              <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 text-xs">
                <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>Contact details are redacted according to role privacy permissions.</span>
              </div>
            )}

            {/* ===================================================================== */}
            {/* DIRECTORY VIEW: GRID OR TABLE                                         */}
            {/* ===================================================================== */}
            <div>
              {list.isLoading && (
                <div className="p-14 rounded-2xl bg-white border border-slate-200 text-center text-slate-400 shadow-2xs">
                  <RefreshCw className="h-8 w-8 mx-auto animate-spin text-slate-500 mb-2.5" />
                  <p className="text-sm font-bold text-slate-700">Loading Directory...</p>
                </div>
              )}

              {list.isError && (
                <div className="p-10 rounded-2xl bg-rose-50 border border-rose-200 text-center text-rose-900 shadow-2xs">
                  <AlertCircle className="h-8 w-8 mx-auto text-rose-500 mb-2" />
                  <p className="text-sm font-bold">{(list.error as Error)?.message || 'Failed to load customer directory.'}</p>
                </div>
              )}

              {!list.isLoading && list.data?.rows.length === 0 && (
                <div className="p-14 rounded-2xl bg-white border border-slate-200 text-center text-slate-400 shadow-2xs">
                  <UserX className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                  <p className="text-sm font-bold text-slate-700">No matching customer records.</p>
                  <p className="text-xs text-slate-400 mt-0.5">Try adjusting your search query or clearing active filters.</p>
                </div>
              )}

              {/* 1. GRID VIEW MODE */}
              {displayMode === 'grid' && !list.isLoading && (list.data?.rows.length ?? 0) > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {list.data?.rows.map((row: KiaCustomerSummary) => {
                    return (
                      <div
                        key={row.key}
                        onClick={() => setOpenKey(row.key)}
                        className="group p-4 rounded-2xl bg-white border border-slate-200/90 hover:border-[var(--dashboard-primary)] hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-3.5"
                      >
                        {/* Top Metadata Row */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-mono font-bold">
                            {row.dealerCode || 'Direct'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {row.kind === 'vehicle' ? 'Lead' : (row.customerId || 'DMS')}
                          </span>
                        </div>

                        {/* Identity & Avatar */}
                        <div className="flex items-center gap-3">
                          <ExecutiveAvatar name={row.name} size="md" />
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-black text-slate-900 group-hover:text-[var(--dashboard-primary)] transition-colors truncate">
                              {row.name || 'Unknown Customer'}
                            </h3>
                            <p className="text-xs font-semibold text-slate-700 font-sans tabular-nums mt-0.5 truncate">
                              {caps.phone ? (row.phone || '—') : <span className="text-slate-400 italic">Masked</span>}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {row.city || 'Location unrecorded'}
                            </p>
                          </div>
                        </div>

                        {/* Telemetry Matrix */}
                        <div className="grid grid-cols-4 gap-1 p-2 rounded-xl bg-slate-50 border border-slate-100 text-center">
                          <div>
                            <span className="text-[9px] font-semibold text-slate-400 block">ENQ</span>
                            <span className="text-xs font-black text-slate-800 tabular-nums">{row.enquiryCount}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-semibold text-slate-400 block">BOOK</span>
                            <span className="text-xs font-black text-slate-800 tabular-nums">{row.bookingCount}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-semibold text-slate-400 block">CARS</span>
                            <span className="text-xs font-black text-[var(--dashboard-primary)] tabular-nums">{row.vehicleCount}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-semibold text-slate-400 block">SVC</span>
                            <span className="text-xs font-black text-slate-800 tabular-nums">{row.serviceCount}</span>
                          </div>
                        </div>

                        {/* Bottom Gaps & CTA */}
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                          <div className="flex flex-wrap gap-1 min-w-0">
                            {GAPS.filter((g) => row.gaps[g.key]).slice(0, 1).map((g) => (
                              <span
                                key={g.key}
                                className={cn("px-2 py-0.5 rounded text-[10px] font-bold border truncate", g.badgeCls)}
                              >
                                {g.shortLabel}
                              </span>
                            ))}
                            {row.gapCount === 0 && (
                              <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Clean
                              </span>
                            )}
                          </div>

                          <span className="text-xs font-bold text-slate-500 group-hover:text-[var(--dashboard-primary)] inline-flex items-center gap-1 transition-colors shrink-0">
                            Dossier <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* 2. TABLE VIEW MODE */}
              {displayMode === 'table' && !list.isLoading && (list.data?.rows.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[var(--dashboard-primary)] text-white font-bold text-[11px] uppercase tracking-wider">
                          <th className="py-3.5 px-4">Customer Identity</th>
                          <th className="py-3.5 px-4">Contact & Location</th>
                          <th className="py-3.5 px-4 text-center">Enquiries</th>
                          <th className="py-3.5 px-4 text-center">Bookings</th>
                          <th className="py-3.5 px-4 text-center">Vehicles</th>
                          <th className="py-3.5 px-4 text-center">Services</th>
                          <th className="py-3.5 px-4">Lifecycle Gaps</th>
                          <th className="py-3.5 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {list.data?.rows.map((row: KiaCustomerSummary) => (
                          <tr
                            key={row.key}
                            onClick={() => setOpenKey(row.key)}
                            className="hover:bg-slate-50 transition-colors cursor-pointer group"
                          >
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-3 min-w-[180px]">
                                <ExecutiveAvatar name={row.name} size="sm" />
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-900 group-hover:text-[var(--dashboard-primary)] transition-colors truncate">
                                    {row.name || 'Unknown Customer'}
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-400">
                                    {row.kind === 'vehicle' ? 'Lead' : (row.customerId || 'DMS')}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-slate-800 font-sans tabular-nums">
                                {caps.phone ? (row.phone || '—') : <span className="text-slate-400 italic">Masked</span>}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {row.city || '—'} · {row.dealerCode || 'Direct'}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center font-bold text-slate-700 font-sans tabular-nums">
                              {row.enquiryCount}
                            </td>
                            <td className="py-3.5 px-4 text-center font-bold text-slate-700 font-sans tabular-nums">
                              {row.bookingCount}
                            </td>
                            <td className="py-3.5 px-4 text-center font-black text-[var(--dashboard-primary)] font-sans tabular-nums">
                              {row.vehicleCount}
                            </td>
                            <td className="py-3.5 px-4 text-center font-bold text-slate-700 font-sans tabular-nums">
                              {row.serviceCount}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="flex flex-wrap gap-1">
                                {GAPS.filter((g) => row.gaps[g.key]).map((g) => (
                                  <span key={g.key} className={cn("px-2 py-0.5 rounded text-[10px] font-bold border", g.badgeCls)}>
                                    {g.shortLabel}
                                  </span>
                                ))}
                                {row.gapCount === 0 && (
                                  <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" /> Clean
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 group-hover:text-[var(--dashboard-primary)] transition-colors">
                                Dossier <ArrowRight className="h-3 w-3" />
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Pagination */}
              {list.data && list.data.total > list.data.pageSize && (
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-white border border-slate-200/80 shadow-2xs text-xs font-bold text-slate-600 mt-5">
                  <div>
                    Showing {((list.data.page - 1) * list.data.pageSize + 1).toLocaleString('en-IN')} to{' '}
                    {Math.min(list.data.page * list.data.pageSize, list.data.total).toLocaleString('en-IN')} of{' '}
                    <span className="text-slate-900 font-black">{list.data.total.toLocaleString('en-IN')}</span> customers
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      Previous
                    </button>
                    <span className="px-3 py-1.5 rounded-lg bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-primary)] border border-[var(--dashboard-primary-border)] font-black">
                      Page {page} of {Math.ceil(list.data.total / list.data.pageSize)}
                    </span>
                    <button
                      type="button"
                      disabled={list.data.page * list.data.pageSize >= list.data.total}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* CUSTOMER 360 DOSSIER DRAWER                                               */}
      {/* ========================================================================= */}
      <Dialog open={Boolean(openKey)} onOpenChange={(open) => { if (!open) setOpenKey(null) }}>
        <DialogContent className="fixed inset-y-0 !left-0 sm:!left-auto !right-0 !top-0 z-50 !flex min-w-0 h-dvh max-h-dvh w-full max-w-full sm:max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l border-slate-200 bg-slate-50 p-0 shadow-2xl duration-300 sm:!w-[min(940px,calc(100vw-2rem))] sm:rounded-l-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{profile.data?.name || 'Customer Profile'}</DialogTitle>
          </DialogHeader>

          {profile.isLoading && (
            <div className="flex flex-col items-center justify-center h-full p-12 text-slate-500">
              <RefreshCw className="h-8 w-8 animate-spin text-slate-600 mb-3" />
              <p className="text-sm font-bold text-slate-800">Compiling Customer Dossier...</p>
            </div>
          )}

          {profile.isError && (
            <div className="flex flex-col items-center justify-center h-full p-12 text-center">
              <AlertTriangle className="h-10 w-10 text-rose-500 mb-2.5" />
              <p className="text-sm font-bold text-slate-900">{(profile.error as Error)?.message || 'Failed to load profile.'}</p>
            </div>
          )}

          {profile.data && (
            <div className="flex-1 overflow-y-auto">
              <DossierView
                profile={profile.data}
                caps={profile.data.capabilities ?? FULL_CAPS}
                onClose={() => setOpenKey(null)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}

/**
 * =============================================================================
 * DOSSIER SLIDE-OVER VIEW
 * =============================================================================
 */
type TimelineEvent = {
  date: string
  category: 'sales' | 'insurance' | 'service' | 'communication'
  title: string
  detail: string | null
  vin: string | null
  reference: string | null
  metadata?: Record<string, string | number | boolean | null | undefined>
}

type NextBestAction = {
  urgency: 'overdue' | 'urgent' | 'soon' | 'watch'
  title: string
  reason: string
  vin: string | null
}

type ProfileWithStory = KiaCustomerProfile & {
  timeline?: TimelineEvent[]
  timelineCategories?: TimelineEvent['category'][]
  nextBestActions?: NextBestAction[]
}

const CATEGORY_LABEL: Record<TimelineEvent['category'], string> = {
  sales: 'Sales & Delivery',
  insurance: 'Insurance',
  service: 'Workshop Service',
  communication: 'Communication',
}

const CATEGORY_CONFIG: Record<TimelineEvent['category'], { dotCls: string; badgeCls: string; icon: typeof Car }> = {
  sales: { dotCls: 'bg-indigo-600 ring-indigo-100', badgeCls: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: Car },
  insurance: { dotCls: 'bg-emerald-600 ring-emerald-100', badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: ShieldCheck },
  service: { dotCls: 'bg-amber-600 ring-amber-100', badgeCls: 'bg-amber-50 text-amber-800 border-amber-200', icon: Wrench },
  communication: { dotCls: 'bg-rose-600 ring-rose-100', badgeCls: 'bg-rose-50 text-rose-800 border-rose-200', icon: MessageSquare },
}

const URGENCY_STYLE: Record<NextBestAction['urgency'], { badgeCls: string; cardCls: string }> = {
  overdue: { badgeCls: 'bg-rose-600 text-white', cardCls: 'border-rose-300 bg-rose-50/70 text-rose-950' },
  urgent: { badgeCls: 'bg-rose-600 text-white', cardCls: 'border-rose-300 bg-rose-50/70 text-rose-950' },
  soon: { badgeCls: 'bg-amber-600 text-white', cardCls: 'border-amber-300 bg-amber-50/70 text-amber-950' },
  watch: { badgeCls: 'bg-slate-700 text-white', cardCls: 'border-slate-200 bg-slate-50 text-slate-800' },
}

function actionCategory(title: string): TimelineEvent['category'] {
  const t = title.toLowerCase()
  if (t.includes('insurance')) return 'insurance'
  if (t.includes('complaint')) return 'communication'
  if (t.includes('service')) return 'service'
  return 'sales'
}

const VEHICLE_MODEL_PHOTOS: Record<string, string> = {
  // Kia Lineup
  sonet: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Sonet/11411/1782132032079/front-left-side-47.jpg',
  seltos: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Seltos/13094/1778328978290/front-left-side-47.jpg',
  carens: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Carens/11623/1772787448187/front-left-side-47.jpg',
  carnival: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Carnival/8001/1774601542816/front-left-side-47.jpg',
  ev6: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/EV6/11740/1760005604163/front-left-side-47.jpg',
  ev9: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/EV6/11740/1760005604163/front-left-side-47.jpg',

  // Hyundai Lineup
  creta: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Creta/8667/1755765115423/front-left-side-47.jpg',
  venue: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Venue/12999/1771931633886/front-left-side-47.jpg',
  verna: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Verna-Facelift/13312/1773040519044/front-left-side-47.jpg',
  i20: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/i20/11092/1755774177956/front-left-side-47.jpg',
  'grand i10': 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Grand-i10-Nios/10088/1762430432997/front-left-side-47.jpg',
  'i10': 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Grand-i10-Nios/10088/1762430432997/front-left-side-47.jpg',
  nios: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Grand-i10-Nios/10088/1762430432997/front-left-side-47.jpg',
  aura: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Aura/10125/1762429751468/front-left-side-47.jpg',
  alcazar: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Alcazar/9246/1758802404168/front-left-side-47.jpg',
  tucson: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Tucson/10133/1762431617294/front-left-side-47.jpg',
  exter: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Exter/13342/1774007040413/front-left-side-47.jpg',
  ioniq: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/IONIQ-5-Facelift/13531/1777375118845/front-left-side-47.jpg',
  santro: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Hyundai/Grand-i10-Nios/10088/1762430432997/front-left-side-47.jpg',

  // MG Lineup
  hector: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/MG/Hector/13125/1783321472876/front-left-side-47.jpg',
  astor: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/MG/Astor/11413/1762752659543/front-left-side-47.jpg',
  zs: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/MG/ZS-EV/11503/1755845485024/front-left-side-47.jpg',
  comet: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/MG/Comet-EV/11556/1772712400778/front-left-side-47.jpg',
  gloster: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/MG/Gloster/9294/1755844590260/front-left-side-47.jpg',
}

function getVehicleModelPhoto(model?: string | null): string {
  if (!model) return VEHICLE_MODEL_PHOTOS.seltos
  const clean = model.toLowerCase().trim()
  for (const [key, url] of Object.entries(VEHICLE_MODEL_PHOTOS)) {
    if (clean.includes(key)) return url
  }
  return VEHICLE_MODEL_PHOTOS.seltos
}

function VehicleThumbnail({ model, className }: { model?: string | null; className?: string }) {
  const [imgError, setImgError] = useState(false)
  const photoUrl = getVehicleModelPhoto(model)

  return (
    <div className={cn("relative w-24 sm:w-28 h-18 bg-slate-100 rounded-xl border border-slate-200/90 flex items-center justify-center p-1 shrink-0 overflow-hidden shadow-2xs group", className)}>
      {!imgError ? (
        <img
          src={photoUrl}
          alt={model || 'Vehicle'}
          onError={() => setImgError(true)}
          className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300 drop-shadow-sm"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-200/60 rounded-lg text-slate-400">
          <Car className="h-6 w-6 stroke-[1.5]" />
        </div>
      )}
    </div>
  )
}

function formatStreamDate(dateStr: string | null) {
  if (!dateStr) return { day: '—', monthYear: '—' }
  const parts = dateStr.split('-')
  if (parts.length !== 3) return { day: dateStr, monthYear: '' }
  const [y, m, d] = parts
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(date.getTime())) return { day: dateStr, monthYear: '' }
  const day = date.toLocaleDateString('en-IN', { day: 'numeric' })
  const monthYear = date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  return { day, monthYear }
}

function getStreamItemVisuals(item: TimelineEvent) {
  const t = item.title.toLowerCase()
  if (item.category === 'insurance') {
    return {
      icon: Shield,
      badgeLabel: 'Insurance',
      badgeCls: 'bg-blue-50 text-blue-600 border border-blue-100',
      iconCls: 'border-blue-200 text-blue-600 bg-blue-50/50',
    }
  }
  if (item.category === 'service') {
    return {
      icon: Wrench,
      badgeLabel: 'Workshop Service',
      badgeCls: 'bg-slate-100 text-slate-600 border border-slate-200',
      iconCls: 'border-slate-200 text-slate-600 bg-slate-50',
    }
  }
  if (t.includes('delivered') || t.includes('delivery')) {
    return {
      icon: Car,
      badgeLabel: 'Sales & Delivery',
      badgeCls: 'bg-blue-50/60 text-blue-700 border border-blue-100',
      iconCls: 'border-slate-200 text-slate-600 bg-slate-50',
    }
  }
  if (t.includes('test drive')) {
    return {
      icon: Compass,
      badgeLabel: 'Sales & Delivery',
      badgeCls: 'bg-blue-50/60 text-blue-700 border border-blue-100',
      iconCls: 'border-slate-200 text-slate-600 bg-slate-50',
    }
  }
  return {
    icon: MessageSquare,
    badgeLabel: 'Sales & Delivery',
    badgeCls: 'bg-blue-50/60 text-blue-700 border border-blue-100',
    iconCls: 'border-slate-200 text-slate-600 bg-slate-50',
  }
}

function ActivityEventDeepDive({
  item,
  onFocusVin,
}: {
  item: TimelineEvent
  onFocusVin: (vin: string | null) => void
}) {
  const [copied, setCopied] = useState(false)

  const copyDetails = (e: React.MouseEvent) => {
    e.stopPropagation()
    const metaEntries = Object.entries(item.metadata || {})
    const lines = [
      `--- EVENT DETAIL: ${item.title.toUpperCase()} ---`,
      `Category: ${CATEGORY_LABEL[item.category] || item.category}`,
      `Date: ${fmtDate(item.date)} (${item.date})`,
      item.reference ? `Reference No: ${item.reference}` : '',
      item.vin ? `VIN: ${item.vin}` : '',
      item.detail ? `Summary: ${item.detail}` : '',
      ...metaEntries.map(([k, v]) => `${k}: ${v ?? '—'}`),
    ].filter(Boolean)

    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const entries = Object.entries(item.metadata || {}).filter(
    ([_, v]) => v !== null && v !== undefined && v !== ''
  )

  return (
    <div className="p-4 sm:p-5 bg-gradient-to-b from-slate-50/90 to-white border-t border-slate-200/90 space-y-4 text-xs select-text">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/70">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[var(--dashboard-primary)] text-white shadow-2xs">
            {CATEGORY_LABEL[item.category] || item.category}
          </span>
          <span className="text-xs font-bold text-slate-800">
            Full Milestone Record Breakdown
          </span>
        </div>

        <div className="flex items-center gap-2">
          {item.vin && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onFocusVin(item.vin)
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-[var(--dashboard-primary)] hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
            >
              <Car className="h-3 w-3" /> Focus Garage
            </button>
          )}

          <button
            type="button"
            onClick={copyDetails}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-slate-400" />}
            <span>{copied ? 'Copied to Clipboard!' : 'Copy Summary'}</span>
          </button>
        </div>
      </div>

      {/* Head to Toe Key-Value Matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Record Milestone</span>
          <span className="text-xs font-black text-slate-900 block">{item.title}</span>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Event Date</span>
          <span className="text-xs font-bold text-slate-900 font-sans tabular-nums block">{fmtDate(item.date)}</span>
        </div>

        {item.reference && (
          <div className="p-3 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Reference / Doc No</span>
            <span className="text-xs font-mono font-bold text-slate-900 block truncate" title={item.reference}>
              #{item.reference}
            </span>
          </div>
        )}

        {item.vin && (
          <div className="p-3 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Chassis / VIN</span>
            <span className="text-xs font-mono font-bold text-slate-900 block truncate" title={item.vin}>
              {item.vin}
            </span>
          </div>
        )}

        {entries.map(([key, val]) => (
          <div key={key} className="p-3 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate" title={key}>
              {key}
            </span>
            <span className="text-xs font-semibold text-slate-900 block truncate" title={String(val)}>
              {String(val)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DossierView({ profile, caps, onClose }: { profile: ProfileWithStory; caps: BrandCapabilities; onClose: () => void }) {
  const [timelineFocus, setTimelineFocus] = useState<{ category: TimelineEvent['category'] | 'all'; vin: string | null }>({
    category: 'all',
    vin: null,
  })
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(15)

  const events = profile.timeline || []
  const categories = profile.timelineCategories || []

  const activeCategory = timelineFocus.category
  const filteredEvents = events.filter((e) =>
    (activeCategory === 'all' || e.category === activeCategory) && (!timelineFocus.vin || e.vin === timelineFocus.vin)
  )

  const totalServices = profile.vehicles.reduce((acc, v) => acc + (v.serviceCount || 0), 0)

  return (
    <div className="bg-white min-h-full flex flex-col">
      {/* ── TOP BAR ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Directory
        </button>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-mono font-semibold border border-slate-200">
            Key: <span className="text-slate-900 font-bold">{profile.customerId || profile.key}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-6 sm:p-8 space-y-6 flex-1">
        {/* ── HERO IDENTITY & METRIC CARDS ────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Avatar & Customer Name */}
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 sm:h-18 sm:w-18 rounded-full bg-[var(--dashboard-primary)] flex items-center justify-center text-white shrink-0 shadow-sm border border-white/20">
              <User className="h-8 w-8 stroke-[1.5]" />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight uppercase font-sans">
                {profile.name || 'Unknown Customer'}
              </h2>
              <p className="text-xs font-medium text-slate-500 mt-1 flex items-center gap-1.5">
                <span>{profile.city || 'JAMMU'}</span>
                <span>•</span>
                <span>Branch: <strong className="text-[var(--dashboard-primary)] font-bold">{profile.dealerCode || 'JK402'}</strong></span>
              </p>
            </div>
          </div>

          {/* 3 Metric Cards */}
          <div className="grid grid-cols-3 gap-3 min-w-[280px] sm:min-w-[340px]">
            <div className="p-3.5 rounded-xl border border-slate-200/90 bg-white text-center shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">VEHICLES</span>
              <span className="text-2xl font-black text-slate-900 font-sans tabular-nums mt-0.5 block">
                {profile.vehicles.length}
              </span>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-200/90 bg-white text-center shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">ENQUIRIES</span>
              <span className="text-2xl font-black text-slate-900 font-sans tabular-nums mt-0.5 block">
                {profile.enquiries.length}
              </span>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-200/90 bg-white text-center shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">SERVICES</span>
              <span className="text-2xl font-black text-slate-900 font-sans tabular-nums mt-0.5 block">
                {totalServices}
              </span>
            </div>
          </div>
        </div>

        {/* ── CONTACT STRIP (4 Mini Cards) ────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs">
            <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-slate-400" /> Phone
            </span>
            <span className="text-xs font-bold text-slate-900 font-sans tabular-nums block mt-1">
              {caps.phone ? (profile.phone || '—') : <span className="text-slate-400 italic font-normal">Masked</span>}
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs">
            <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-slate-400" /> Email
            </span>
            <span className="text-xs font-bold text-slate-900 block mt-1 truncate">
              {caps.phone ? (profile.email || '—') : <span className="text-slate-400 italic font-normal">Masked</span>}
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs">
            <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400" /> City
            </span>
            <span className="text-xs font-bold text-slate-900 block mt-1 truncate">
              {profile.city || '—'}
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs">
            <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-slate-400" /> Outlet
            </span>
            <span className="text-xs font-bold text-slate-900 block mt-1">
              {profile.dealerCode || '—'}
            </span>
          </div>
        </div>

        {/* ── VEHICLE FLEET SECTION ────────────────────────────────────────────── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Car className="h-4 w-4 text-slate-600" />
              VEHICLE FLEET ({profile.vehicles.length})
            </h3>
            {timelineFocus.vin ? (
              <button
                type="button"
                onClick={() => setTimelineFocus((prev) => ({ ...prev, vin: null }))}
                className="text-xs font-bold text-[var(--dashboard-primary)] hover:underline cursor-pointer"
              >
                Show all vehicles
              </button>
            ) : (
              <span className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer flex items-center gap-1">
                View all vehicles <ArrowRight className="h-3 w-3" />
              </span>
            )}
          </div>

          {profile.vehicles.length === 0 ? (
            <div className="p-6 rounded-xl border border-slate-200 bg-white text-center text-slate-400 text-xs">
              No vehicles linked to this customer account.
            </div>
          ) : (
            <div className="space-y-3">
              {profile.vehicles.map((v, vIdx) => {
                const isSelected = timelineFocus.vin === v.vin
                return (
                  <div
                    key={`${v.vin}-${vIdx}`}
                    className={cn(
                      "p-4 sm:p-5 rounded-2xl bg-white border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs",
                      isSelected ? "border-[var(--dashboard-primary)] ring-2 ring-[var(--dashboard-primary)]/20" : "border-slate-200 hover:border-slate-300"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      {/* Car Graphic */}
                      <VehicleThumbnail model={v.model} />

                      {/* Details */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-base font-black text-slate-900 uppercase tracking-tight">
                            {v.model || 'SONET'}
                          </h4>
                          {v.registration && (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[11px] font-mono font-bold border border-slate-200">
                              {v.registration}
                            </span>
                          )}
                        </div>

                        <p className="text-xs font-mono text-slate-400">
                          VIN: {caps.vin ? v.vin : `${v.vin} (Masked)`}
                        </p>

                        <div className="flex items-center gap-6 pt-1 text-xs">
                          <div>
                            <span className="text-[10px] font-semibold text-slate-400 block">Insurance</span>
                            {!caps.insurance ? (
                              <span className="text-slate-400 italic">Not Linked</span>
                            ) : v.insurance ? (
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className={cn("font-bold", v.insurance.lapsed ? "text-rose-600" : "text-[var(--dashboard-primary)]")}>
                                  {v.insurance.lapsed ? 'Lapsed' : 'Active'}
                                </span>
                                <span className="text-slate-400 font-medium">
                                  ({fmtDate(v.insurance.expiryDate)})
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-400">No Policy</span>
                            )}
                          </div>

                          <div>
                            <span className="text-[10px] font-semibold text-slate-400 block">Last Service</span>
                            <span className="font-bold text-slate-900 block mt-0.5 font-sans tabular-nums">
                              {caps.service ? (v.lastServiceDate ? fmtDate(v.lastServiceDate) : 'Never Serviced') : 'Unlinked'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Action Button */}
                    <button
                      type="button"
                      onClick={() => setTimelineFocus((prev) => ({ ...prev, vin: isSelected ? null : v.vin }))}
                      className={cn(
                        "px-3.5 py-1.5 rounded-lg border text-xs font-bold transition-colors shrink-0 cursor-pointer self-start sm:self-center",
                        isSelected
                          ? "bg-[var(--dashboard-primary)] text-white border-[var(--dashboard-primary)]"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      )}
                    >
                      {v.serviceCount} Services &gt;
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── ACTIVITY STREAM SECTION ──────────────────────────────────────────── */}
        <div id="c360-timeline-section" className="space-y-3 pt-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-slate-600" />
                ACTIVITY STREAM ({events.length})
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Click any event row to inspect full details and parameters from head to toe.
              </p>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap gap-1.5">
              {(['all', ...categories] as const).map((cat) => {
                const count = cat === 'all' ? events.length : events.filter((e) => e.category === cat).length
                const isActive = activeCategory === cat
                const label = cat === 'all' ? `All (${count})` : cat === 'sales' ? `Sales & Delivery (${count})` : cat === 'insurance' ? `Insurance (${count})` : `Workshop Service (${count})`

                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setTimelineFocus((prev) => ({ ...prev, category: cat }))}
                    className={cn(
                      "px-3 py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer",
                      isActive
                        ? "bg-[var(--dashboard-primary)] text-white border-[var(--dashboard-primary)] shadow-2xs"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Activity Stream Container */}
          <div className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-2xs divide-y divide-slate-100">
            {filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs font-medium">
                No activity records match the selected category filter.
              </div>
            ) : (
              filteredEvents.slice(0, visibleCount).map((item, idx) => {
                const eventId = `${item.date}-${item.title}-${item.vin ?? ''}-${item.reference ?? ''}-${idx}`
                const isExpanded = expandedEventId === eventId
                const { day, monthYear } = formatStreamDate(item.date)
                const visuals = getStreamItemVisuals(item)
                const Icon = visuals.icon

                return (
                  <div key={eventId} className="transition-colors">
                    <div
                      onClick={() => setExpandedEventId(isExpanded ? null : eventId)}
                      className={cn(
                        "flex items-center justify-between p-3.5 sm:p-4 hover:bg-slate-50/80 transition-all cursor-pointer group gap-3 select-none",
                        isExpanded ? "bg-slate-50/60 border-l-4 border-l-[var(--dashboard-primary)] pl-2.5 sm:pl-3" : ""
                      )}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Left Date Column */}
                        <div className="w-14 sm:w-16 shrink-0 text-left pr-3 border-r border-slate-100">
                          <div className="text-base font-black text-slate-900 leading-tight font-sans tabular-nums">
                            {day}
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium truncate">
                            {monthYear}
                          </div>
                        </div>

                        {/* Icon Circle */}
                        <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0 border", visuals.iconCls)}>
                          <Icon className="h-4 w-4 stroke-[1.75]" />
                        </div>

                        {/* Event Title & Subtitle */}
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs sm:text-sm font-bold text-slate-900 font-sans">
                              {item.title}
                            </span>
                            <span className={cn("px-2 py-0.5 rounded text-[10px] font-semibold", visuals.badgeCls)}>
                              {visuals.badgeLabel}
                            </span>
                            {isExpanded && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-primary)] border border-[var(--dashboard-primary-border)]">
                                Expanded
                              </span>
                            )}
                          </div>

                          <p className="text-[11px] text-slate-500 font-normal truncate flex items-center gap-1.5 flex-wrap">
                            {item.detail}
                            {item.reference && (
                              <>
                                <span>•</span>
                                <span className="font-mono text-slate-400">#{item.reference}</span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* Right Chevron indicating expand state */}
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 transition-all shrink-0",
                          isExpanded
                            ? "rotate-90 text-[var(--dashboard-primary)] font-bold"
                            : "text-slate-300 group-hover:text-slate-600 group-hover:translate-x-0.5"
                        )}
                      />
                    </div>

                    {/* Expandable Deep Dive Details (Head to Toe) */}
                    {isExpanded && (
                      <ActivityEventDeepDive
                        item={item}
                        onFocusVin={(vin) => setTimelineFocus((prev) => ({ ...prev, vin }))}
                      />
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Load More Button */}
          {filteredEvents.length > visibleCount && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 20)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
              >
                Load more ⌵
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * =============================================================================
 * COMMON CUSTOMERS
 * =============================================================================
 */
function CommonCustomers({ query }: { query: UseQueryResult<CommonResult> }) {
  if (query.isLoading) {
    return (
      <div className="p-12 rounded-xl bg-white border border-slate-200 text-center text-slate-400">
        <RefreshCw className="h-6 w-6 mx-auto animate-spin text-slate-500 mb-2" />
        <p className="text-xs font-bold">Matching Cross-Brand Records...</p>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="p-8 rounded-xl bg-rose-50 border border-rose-200 text-center text-rose-900 text-xs font-bold">
        Failed to load cross-brand matches.
      </div>
    )
  }

  const data = query.data
  if (!data) return null

  return (
    <div className="space-y-5">
      {data.pairCounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.pairCounts.map((pair) => (
            <div key={pair.pair} className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
              <div className="text-xs font-bold uppercase text-slate-400">{pair.pair}</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900 font-sans tabular-nums">
                  {pair.confirmed.toLocaleString('en-IN')}
                </span>
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Confirmed
                </span>
                <span className="text-[11px] font-bold text-slate-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                  +{pair.likely.toLocaleString('en-IN')} Likely
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.rows.map((row, rIdx) => (
          <div key={`${row.key}-${rIdx}`} className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900">{row.name || 'Unknown Customer'}</h4>
                <p className="text-[11px] text-slate-500">{row.evidence}</p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-slate-100 text-slate-700">
                {row.confidence}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {row.vehicles.map((v, i) => (
                <div key={`${v.brand}-${v.customerId}-${v.invoiceDate}-${i}`} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 space-y-0.5">
                  <div className="font-bold text-indigo-700">{v.brandLabel}</div>
                  <div className="font-semibold text-slate-800">{v.model || 'Model Unspecified'}</div>
                  <div className="text-[11px] text-slate-400">{v.invoiceDate ? fmtDate(v.invoiceDate) : '—'}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

