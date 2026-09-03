'use client'

import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { MainLayout } from '@/components/layout/main-layout'
// The ONE milestone list, shared with the server timeline builder so the two cannot drift.
import { isMilestoneEvent } from '@/lib/kia/customer-profile/timeline'
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
  Flag,
  Truck,
  Store,
  ArrowUpDown,
  ChevronDown,
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

/**
 * A rupee figure, or null when we hold no price.
 *
 * ⚠️ Returns NULL rather than picking its own "not available" wording, so every call site states
 * what absence means in its own context — an unbilled workshop visit, a brand with no workshop
 * link, and a policy with no premium recorded are three different facts and should not share a
 * phrase.
 *
 * ⚠️ Do NOT swap this for formatCurrency in components/petty-cash/pc-shared.tsx. That one does
 * `Number.isFinite(amount) ? amount : 0`, so it renders null and undefined as a confident Rs 0 —
 * which on this screen would tell an employee that 2,398 real workshop visits were free.
 */
function fmtMoney(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  // Below a rupee is a feed artefact (labour is stored as 0.01 on parts-only jobs), and at zero
  // decimal places it would print a misleading "₹0".
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(parsed)
}

/** Compact rupees for a headline figure, where the exact number goes in a title attribute. */
function fmtMoneyCompact(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  if (parsed >= 10000000) return `₹${(parsed / 10000000).toFixed(2)} Cr`
  if (parsed >= 100000) return `₹${(parsed / 100000).toFixed(2)} L`
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(parsed)
}

/**
 * "3 months ago" / "in 12 days" — the form someone scanning a list of customers actually reads.
 *
 * An exact date answers "when"; this answers "is that a problem", which is the question a directory
 * is for. The exact date stays in the tooltip so nothing is lost.
 */
function relativeDays(iso: string | null): { days: number; text: string } | null {
  if (!iso) return null
  const then = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(then)) return null
  const today = new Date()
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((then - todayUtc) / 86_400_000)
  const abs = Math.abs(days)
  const unit = abs < 31 ? `${abs} day${abs === 1 ? '' : 's'}`
    : abs < 365 ? `${Math.round(abs / 30)} month${Math.round(abs / 30) === 1 ? '' : 's'}`
      : `${(abs / 365).toFixed(abs < 730 ? 1 : 0)} years`
  if (days === 0) return { days, text: 'today' }
  return { days, text: days > 0 ? `in ${unit}` : `${unit} ago` }
}

/**
 * The one insurance sentence a card should carry.
 *
 * ⚠️ "No policy on record" is never "uninsured". The feed only covers policies sold through the
 * dealership, so a customer insured elsewhere looks identical to one with no cover at all — and
 * telling an employee the second when we only know the first is how a customer gets a wrong call.
 */
function insuranceState(row: KiaCustomerSummary): { label: string; tone: string; icon: typeof Shield } {
  const upcoming = relativeDays(row.nextPolicyExpiry)
  if (upcoming) {
    // 30 days is the renewal window the insurance section already works to.
    const urgent = upcoming.days <= 30
    return {
      label: `Expires ${upcoming.text}`,
      tone: urgent ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-slate-600 bg-slate-50 border-slate-200',
      icon: urgent ? ShieldAlert : ShieldCheck,
    }
  }
  const lapsed = relativeDays(row.latestPolicyExpiry)
  if (lapsed) {
    return {
      label: `Lapsed ${lapsed.text}`,
      tone: 'text-rose-700 bg-rose-50 border-rose-200',
      icon: ShieldAlert,
    }
  }
  return { label: 'No policy with us', tone: 'text-slate-500 bg-slate-50 border-slate-200', icon: Shield }
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
  const [sort, setSort] = useState<'recent' | 'services' | 'spend' | 'name'>('recent')
  const [page, setPage] = useState(1)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const deferredSearch = useDeferredValue(appliedSearch)

  const listParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('brand', brand)
    if (deferredSearch) params.set('search', deferredSearch)
    if (gap) params.set('gap', gap)
    params.set('service_gap_months', String(serviceGapMonths))
    // Whitelisted server-side (resolveCustomerSort) — this is a hint, not a SQL fragment.
    params.set('sort', sort)
    params.set('page', String(page))
    params.set('page_size', displayMode === 'grid' ? '24' : '30')
    return params.toString()
  }, [brand, deferredSearch, gap, serviceGapMonths, sort, page, displayMode])

  const queryClient = useQueryClient()

  const list = useQuery<KiaCustomerListResult & BrandMeta>({
    queryKey: ['customer-360', 'list', listParams],
    queryFn: async () => {
      const res = await fetch(`/api/customer-360?${listParams}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
  })

  // Reusable profile prefetcher to load sidebar data before the user even clicks
  const prefetchProfile = useCallback(
    (key: string) => {
      if (!key) return
      queryClient.prefetchQuery({
        queryKey: ['customer-360', 'detail', brand, key, serviceGapMonths],
        queryFn: async () => {
          const res = await fetch(
            `/api/customer-360/${encodeURIComponent(key)}`
            + `?brand=${brand}&service_gap_months=${serviceGapMonths}`,
          )
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
          return res.json()
        },
        staleTime: 5 * 60 * 1000,
      })
    },
    [brand, serviceGapMonths, queryClient]
  )

  /*
   * Preload the first few profiles so the dossier opens instantly — but each key AT MOST ONCE per
   * mount, and only a handful. The unguarded version prefetched 16 full profiles on EVERY list
   * render (each page change, gap filter, settled search keystroke), and a profile is the
   * section's most expensive call (~10 statements against a pooler that charges ~2 RTTs each).
   * This repo has already had a Vercel Active-CPU incident from exactly this speculative-prefetch
   * pattern; the per-row onMouseEnter prefetch below covers the click-latency goal user-driven.
   */
  const prefetchedKeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!list.data?.rows?.length) return
    for (const r of list.data.rows.slice(0, 8)) {
      if (prefetchedKeysRef.current.has(r.key)) continue
      prefetchedKeysRef.current.add(r.key)
      prefetchProfile(r.key)
    }
  }, [list.data?.rows, prefetchProfile])

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
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
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

                {/* Sort */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sort</span>
                  <select
                    /*
                     * Coerced for DISPLAY on a sales-only brand: the service options are not in the
                     * list there, and a select whose value has no matching option renders blank.
                     * The request itself needs no coercion — service_count is a hardcoded 0 on those
                     * feeds, so that ORDER BY falls straight through to the same secondary sort as
                     * the default.
                     */
                    value={salesOnly && (sort === 'services' || sort === 'spend') ? 'recent' : sort}
                    onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1) }}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 focus:outline-hidden cursor-pointer"
                  >
                    <option value="recent">Most recent activity</option>
                    {/*
                      * Service sorts are hidden on the sales-only brands. Hyundai and Platinum arrive
                      * with VIN and phone masked at source, so there is no workshop join and
                      * service_count is a hardcoded 0 — offering the sort there would look like a
                      * broken control rather than an absent feed.
                      */}
                    {!salesOnly && <option value="services">Most service visits</option>}
                    {!salesOnly && <option value="spend">Highest service spend</option>}
                    <option value="name">Name (A–Z)</option>
                  </select>
                </div>

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
                        onMouseEnter={() => prefetchProfile(row.key)}
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
                            {/* The car, named — the counts said "CARS 1" without ever saying which. */}
                            {row.primaryModel && (
                              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 truncate">
                                <Car className="h-3 w-3 text-slate-400 shrink-0" />
                                <span className="truncate">{row.primaryModel}</span>
                                {row.vehicleCount > 1 && (
                                  <span className="text-slate-400 font-medium shrink-0">+{row.vehicleCount - 1}</span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>

                        {/*
                          * ── WHAT THIS CUSTOMER LOOKS LIKE ────────────────────────────────────
                          *
                          * This replaced a four-up strip of ENQ / BOOK / CARS / SVC counts. Those
                          * counted our RECORDS; these say when we last saw the customer, what the
                          * relationship is worth, and whether anything is about to lapse — which is
                          * what somebody scanning 12,654 cards is actually looking for.
                          */}
                        <dl className="rounded-xl bg-slate-50 border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                          <div className="flex items-center gap-2 px-2.5 py-2">
                            <Wrench className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <dt className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">Last service</dt>
                            <dd
                              className="ml-auto text-[11px] font-bold text-slate-800 truncate"
                              title={row.lastServiceDate ? fmtDate(row.lastServiceDate) : undefined}
                            >
                              {/*
                                * The NVI-excluded date: our own pre-delivery inspection is not a
                                * customer visit, and counting it made 126 cars look recently seen.
                                */}
                              {relativeDays(row.lastServiceDate)?.text ?? (
                                <span className="font-semibold text-slate-400">Never serviced</span>
                              )}
                            </dd>
                          </div>

                          <div className="flex items-center gap-2 px-2.5 py-2">
                            {(() => {
                              const ins = insuranceState(row)
                              const InsIcon = ins.icon
                              return (
                                <>
                                  <InsIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                  <dt className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">Insurance</dt>
                                  <dd className={cn('ml-auto px-1.5 py-0.5 rounded border text-[11px] font-bold truncate', ins.tone)}>
                                    {ins.label}
                                  </dd>
                                </>
                              )
                            })()}
                          </div>

                          <div className="flex items-center gap-2 px-2.5 py-2">
                            <CreditCard className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <dt className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">Workshop spend</dt>
                            <dd className="ml-auto text-[11px] font-bold text-slate-800 tabular-nums truncate">
                              {/*
                                * Zero is printed as "Not billed", not as Rs 0: 2,398 of 5,711 visits
                                * carry no price, and Rs 0 would read as "the work was free".
                                */}
                              {row.serviceSpend && row.serviceSpend > 0
                                ? fmtMoney(row.serviceSpend)
                                : <span className="font-semibold text-slate-400">Not billed</span>}
                            </dd>
                          </div>
                        </dl>

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

                          {/*
                            * A real button, not a decorative span. The whole card is clickable, but a
                            * span cannot be reached by keyboard and reads as nothing to a screen
                            * reader — and the label now says what it opens rather than naming a
                            * document type.
                            */}
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); setOpenKey(row.key) }}
                            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 group-hover:border-[var(--dashboard-primary)] group-hover:text-[var(--dashboard-primary)] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dashboard-primary)] transition-colors cursor-pointer"
                          >
                            View details
                            <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                          </button>
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
                          {/*
                            * Enquiries and Bookings removed by request. They were the last two
                            * counters left from the pre-redesign table — the grid card had already
                            * dropped its ENQ/BOOK badges — and on Hyundai/Platinum they are
                            * hardcoded 0 (masked feeds carry no enquiry or booking join), so the
                            * column read as a data gap rather than a fact.
                            */}
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
                            onMouseEnter={() => prefetchProfile(row.key)}
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

      <Dialog open={Boolean(openKey)} onOpenChange={(open) => { if (!open) setOpenKey(null) }}>
        <DialogContent
          hideCloseButton
          className="max-w-[1580px] w-[96vw] max-h-[94vh] flex flex-col p-0 gap-0 overflow-hidden rounded-3xl bg-slate-50 border border-slate-200/90 shadow-2xl z-50"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{profile.data?.name || 'Customer Profile'}</DialogTitle>
          </DialogHeader>

          {profile.isLoading && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-12 text-slate-500">
              <RefreshCw className="h-8 w-8 animate-spin text-slate-600 mb-3" />
              <p className="text-sm font-bold text-slate-800">Compiling Customer Dossier...</p>
            </div>
          )}

          {profile.isError && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-12 text-center">
              <AlertTriangle className="h-10 w-10 text-rose-500 mb-2.5" />
              <p className="text-sm font-bold text-slate-900">{(profile.error as Error)?.message || 'Failed to load profile.'}</p>
            </div>
          )}

          {profile.data && (
            <div className="flex-1 overflow-y-auto min-h-0">
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
  category: 'sales' | 'insurance' | 'service' | 'communication' | 'accessories'
  title: string
  detail: string | null
  vin: string | null
  reference: string | null
  metadata?: Record<string, string | number | boolean | null | undefined>
  /*
   * Per-item lines of a multi-line document — an accessory counter-sale bill today. Kept OUT of
   * `metadata` on purpose: that is a flat scalar map rendered as a label/value grid, and a dozen
   * accessory lines with quantities and prices is a table. Mirrors TimelineLineItem in
   * lib/kia/customer-profile/timeline.ts.
   */
  lines?: Array<{ description: string; qty: number | null; amount: number | null }>
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
  accessories: 'Accessories',
  communication: 'Communication',
}

const CATEGORY_CONFIG: Record<TimelineEvent['category'], { dotCls: string; badgeCls: string; icon: typeof Car }> = {
  sales: { dotCls: 'bg-indigo-600 ring-indigo-100', badgeCls: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: Car },
  insurance: { dotCls: 'bg-emerald-600 ring-emerald-100', badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: ShieldCheck },
  service: { dotCls: 'bg-amber-600 ring-amber-100', badgeCls: 'bg-amber-50 text-amber-800 border-amber-200', icon: Wrench },
  accessories: { dotCls: 'bg-violet-600 ring-violet-100', badgeCls: 'bg-violet-50 text-violet-700 border-violet-200', icon: Store },
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

function formatRoadwayDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  const [y, m, d] = parts
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(date.getTime())) return dateStr
  const day = date.getDate().toString().padStart(2, '0')
  const month = date.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()
  const year = date.getFullYear()
  return `${day} ${month} ${year}`
}

function getActivityRowVisuals(title: string, category: string) {
  const t = title.toLowerCase()
  if (category === 'insurance' || t.includes('insurance') || t.includes('policy')) {
    const isExpiry = t.includes('expire') || t.includes('lapsed')
    return {
      icon: isExpiry ? Clock : ShieldCheck,
      iconBoxCls: isExpiry ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200',
    }
  }
  if (category === 'service' || t.includes('service') || t.includes('workshop') || t.includes('job card')) {
    return {
      icon: Wrench,
      iconBoxCls: 'bg-amber-50 text-amber-600 border border-amber-200',
    }
  }
  if (t.includes('journey') || t.includes('start')) {
    return {
      icon: Flag,
      iconBoxCls: 'bg-blue-50 text-blue-600 border border-blue-200',
    }
  }
  if (t.includes('enquiry') || t.includes('lead')) {
    return {
      icon: MessageSquare,
      iconBoxCls: 'bg-blue-50 text-blue-600 border border-blue-200',
    }
  }
  if (t.includes('booking') || t.includes('allotment')) {
    return {
      icon: Calendar,
      iconBoxCls: 'bg-blue-50 text-blue-600 border border-blue-200',
    }
  }
  if (t.includes('test drive') || t.includes('demo')) {
    return {
      icon: Compass,
      iconBoxCls: 'bg-blue-50 text-blue-600 border border-blue-200',
    }
  }
  if (t.includes('delivery') || t.includes('delivered') || t.includes('handover')) {
    return {
      icon: Truck,
      iconBoxCls: 'bg-blue-50 text-blue-600 border border-blue-200',
    }
  }
  if (t.includes('accessories') || category === 'accessories') {
    return {
      icon: Store,
      iconBoxCls: 'bg-purple-50 text-purple-600 border border-purple-200',
    }
  }
  return {
    icon: FileText,
    iconBoxCls: 'bg-slate-100 text-slate-600 border border-slate-200',
  }
}

function StructuredActivityStream({
  events,
  vehicles,
  onFocusVin,
}: {
  events: TimelineEvent[]
  vehicles: KiaCustomerProfile['vehicles']
  onFocusVin: (vin: string | null) => void
}) {
  const [activeTab, setActiveTab] = useState<'all' | 'sales' | 'insurance' | 'service'>('all')
  const [sortOrder, setSortOrder] = useState<'newest_first' | 'oldest_first'>('newest_first')
  const [expandedSections, setExpandedSections] = useState<{ sales: boolean; insurance: boolean; service: boolean }>({
    sales: false,
    insurance: false,
    service: false,
  })

  /*
   * ── MILESTONES BY DEFAULT ────────────────────────────────────────────────────────────────────
   *
   * The stream used to list every step the DMS records — "Enquiry created", "Test drive", "Booking
   * created", "Vehicle invoiced" — around the one line a customer would recognise, "Vehicle
   * delivered". That is the salesperson's paperwork, not the customer's story, and on an ordinary
   * buyer it is five rows of noise hiding the purchase.
   *
   * Nothing is discarded: "View Full Timeline" turns every one of them back on. The default is the
   * story; the full record is one click away.
   */
  const showEverything = expandedSections.sales && expandedSections.insurance && expandedSections.service

  const salesEvents = useMemo(() => {
    const inScope = events.filter((e) => e.category === 'sales' || e.category === 'accessories' || e.category === 'communication')
    return showEverything ? inScope : inScope.filter(isMilestoneEvent)
  }, [events, showEverything])

  const insuranceEvents = useMemo(() => {
    return events.filter((e) => e.category === 'insurance')
  }, [events])

  const serviceEvents = useMemo(() => {
    return events.filter((e) => e.category === 'service')
  }, [events])

  const sortFn = useCallback((a: TimelineEvent, b: TimelineEvent) => {
    if (sortOrder === 'newest_first') {
      return (b.date || '').localeCompare(a.date || '')
    }
    return (a.date || '').localeCompare(b.date || '')
  }, [sortOrder])

  const sortedSales = useMemo(() => [...salesEvents].sort(sortFn), [salesEvents, sortFn])
  const sortedInsurance = useMemo(() => [...insuranceEvents].sort(sortFn), [insuranceEvents, sortFn])
  const sortedService = useMemo(() => [...serviceEvents].sort(sortFn), [serviceEvents, sortFn])

  const hiddenSalesSteps = useMemo(() => {
    const inScope = events.filter((e) => e.category === 'sales' || e.category === 'accessories' || e.category === 'communication')
    return inScope.length - inScope.filter(isMilestoneEvent).length
  }, [events])

  const showSales = activeTab === 'all' || activeTab === 'sales'
  const showInsurance = activeTab === 'all' || activeTab === 'insurance'
  const showService = activeTab === 'all' || activeTab === 'service'

  return (
    <div className="space-y-6">
      {/* ── TOP HEADER & CONTROLS (IMAGE 2 MATCH) ────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-slate-800 stroke-[2.5]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Activity Stream
          </h3>
        </div>

        {/* Filter Pills + Sort Options */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer shadow-2xs",
                activeTab === 'all'
                  ? "bg-[#0F172A] text-white font-semibold"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
              )}
            >
              All ({events.length})
            </button>

            {salesEvents.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('sales')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer shadow-2xs",
                  activeTab === 'sales'
                    ? "bg-[#2563EB] text-white font-semibold"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
                )}
              >
                Sales &amp; Delivery ({salesEvents.length})
              </button>
            )}

            {insuranceEvents.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('insurance')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer shadow-2xs",
                  activeTab === 'insurance'
                    ? "bg-[#059669] text-white font-semibold"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
                )}
              >
                Insurance ({insuranceEvents.length})
              </button>
            )}

            {serviceEvents.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('service')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer shadow-2xs",
                  activeTab === 'service'
                    ? "bg-[#EA580C] text-white font-semibold"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
                )}
              >
                Workshop Service ({serviceEvents.length})
              </button>
            )}
          </div>

          {/* Sort Selector + Menu Icon */}
          <div className="flex items-center gap-1.5 ml-auto sm:ml-2">
            <button
              type="button"
              onClick={() => setSortOrder(prev => prev === 'newest_first' ? 'oldest_first' : 'newest_first')}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            >
              <span>Sort by: <strong className="text-slate-900 font-bold">{sortOrder === 'newest_first' ? 'Newest First' : 'Oldest First'}</strong></span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>
            <div className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 shadow-2xs">
              <List className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      {/* ── VERTICAL TIMELINE CONTAINER (IMAGE 2 MATCH) ──────────────────────── */}
      <div className="relative space-y-8 pl-1 sm:pl-3">
        {/* Continuous Left Vertical Timeline Spine */}
        <div className="absolute left-[23px] sm:left-[31px] top-6 bottom-6 w-[2px] bg-slate-200 pointer-events-none" />

        {/* ── 1. SALES & DELIVERY SECTION ───────────────────────────────────── */}
        {showSales && sortedSales.length > 0 && (
          <div className="relative flex flex-col md:flex-row md:items-start gap-4 sm:gap-6">
            {/* Left Category Node - Horizontal Layout */}
            <div className="flex items-center gap-3 w-52 shrink-0 relative z-10 pt-1">
              <div className="h-10 w-10 rounded-xl bg-[#2563EB] text-white flex items-center justify-center shadow-xs shrink-0 ring-4 ring-white">
                <Store className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#2563EB] truncate">
                  Sales &amp; Delivery
                </h4>
                <p className="text-xs text-slate-500 font-normal">
                  {sortedSales.length} {sortedSales.length === 1 ? 'Milestone' : 'Milestones'}
                </p>
                {/*
                  * Say what is being held back, so a shorter list reads as a decision rather than as
                  * missing data. Suppressed only while the full timeline is off.
                  */}
                {!showEverything && hiddenSalesSteps > 0 && (
                  <p className="text-[11px] text-slate-400 font-normal">
                    +{hiddenSalesSteps} enquiry {hiddenSalesSteps === 1 ? 'step' : 'steps'} hidden
                  </p>
                )}
              </div>
            </div>

            {/* Right Structured Table */}
            <div className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse c360-activity-table c360-sales-table">
                  <thead>
                    <tr className="border-b border-slate-200 bg-[#F8FAFC] text-xs font-semibold text-slate-500">
                      <th className="px-4 py-3 whitespace-nowrap">Date</th>
                      <th className="px-4 py-3">Activity</th>
                      <th className="px-4 py-3 whitespace-nowrap">Reference / ID</th>
                      <th className="px-4 py-3">Details</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">Amount (₹)</th>
                      <th className="px-4 py-3 whitespace-nowrap">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(expandedSections.sales ? sortedSales : sortedSales.slice(0, 5)).map((item, idx) => {
                      const visuals = getActivityRowVisuals(item.title, item.category)
                      const Icon = visuals.icon
                      const amount = item.metadata?.amount || item.metadata?.price || item.metadata?.bookingAmount || item.metadata?.total
                      const staffBy = item.metadata?.by || item.metadata?.salesConsultant || item.metadata?.advisor || 'Sales Team'

                      return (
                        <tr key={`${item.date}-${item.title}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                          {/* Date with Light Blue Icon Box */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 rounded-lg bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE] flex items-center justify-center shrink-0">
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <span className="font-semibold text-xs text-slate-600 font-mono tracking-tight uppercase">
                                {formatRoadwayDate(item.date)}
                              </span>
                            </div>
                          </td>

                          {/* Activity Title */}
                          <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                            {item.title}
                          </td>

                          {/* Reference / ID */}
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-400">
                            {item.reference ? `#${item.reference}` : '—'}
                          </td>

                          {/* Details */}
                          <td className="px-4 py-3 text-slate-700 max-w-[320px]">
                            <div className="line-clamp-2" title={item.detail || 'Recorded in DMS'}>
                              <span className="font-normal text-slate-700">{item.detail || 'Recorded in DMS'}</span>
                            </div>
                            {/*
                              * The per-item breakdown for a multi-line document — today, an accessory
                              * counter-sale bill. The timeline collapses a bill to ONE row (a dozen
                              * near-identical cards for one afternoon buries everything else), so the
                              * lines live here rather than as separate events. Quantity is shown only
                              * when the feed actually recorded one; a default of 1 would be invented.
                              */}
                            {item.lines && item.lines.length > 0 && (
                              <ul className="mt-2 space-y-0.5 border-l-2 border-violet-200 pl-2.5">
                                {item.lines.map((line, li) => (
                                  <li key={`${line.description}-${li}`} className="flex items-baseline justify-between gap-3 text-[11px] leading-tight">
                                    <span className="text-slate-600 truncate" title={line.description}>
                                      {line.description}
                                      {line.qty !== null && line.qty !== 1 ? (
                                        <span className="ml-1 font-semibold text-slate-400">x{line.qty}</span>
                                      ) : null}
                                    </span>
                                    <span className="shrink-0 font-semibold text-slate-700 tabular-nums">
                                      {line.amount !== null ? fmtMoney(line.amount) : '—'}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>

                          {/* Amount */}
                          <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-slate-800 tabular-nums">
                            {amount ? (typeof amount === 'number' ? fmtMoney(amount) : String(amount)) : '—'}
                          </td>

                          {/* Staff / By */}
                          <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-normal text-xs">
                            {staffBy}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* View All Toggle */}
              {sortedSales.length > 5 && (
                <div className="p-3 bg-white border-t border-slate-100 flex justify-start">
                  <button
                    type="button"
                    onClick={() => setExpandedSections(prev => ({ ...prev, sales: !prev.sales }))}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
                  >
                    <span>{expandedSections.sales ? 'Show fewer activities ←' : `View all ${sortedSales.length} Sales & Delivery activities →`}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 2. INSURANCE SECTION (IMAGE 2 MATCH) ─────────────────────────── */}
        {showInsurance && sortedInsurance.length > 0 && (
          <div className="relative flex flex-col md:flex-row md:items-start gap-4 sm:gap-6">
            {/* Left Category Node - Horizontal Layout */}
            <div className="flex items-center gap-3 w-52 shrink-0 relative z-10 pt-1">
              <div className="h-10 w-10 rounded-xl bg-[#059669] text-white flex items-center justify-center shadow-xs shrink-0 ring-4 ring-white">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#059669] truncate">
                  Insurance
                </h4>
                <p className="text-xs text-slate-500 font-normal">
                  {sortedInsurance.length} {sortedInsurance.length === 1 ? 'Activity' : 'Activities'}
                </p>
              </div>
            </div>

            {/* Right Structured Table */}
            <div className="flex-1 min-w-0 rounded-xl border border-[#D1FAE5] bg-white overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse c360-activity-table c360-insurance-table">
                  <thead>
                    <tr className="border-b border-[#A7F3D0] bg-[#ECFDF5] text-xs font-semibold text-[#065F46]">
                      <th className="px-4 py-3 whitespace-nowrap">Date</th>
                      <th className="px-4 py-3">Activity</th>
                      <th className="px-4 py-3 whitespace-nowrap">Policy Number</th>
                      <th className="px-4 py-3">Insurance Company</th>
                      <th className="px-4 py-3 whitespace-nowrap">Coverage Period</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">Premium (₹)</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(expandedSections.insurance ? sortedInsurance : sortedInsurance.slice(0, 5)).map((item, idx) => {
                      const isExpiry = item.title.toLowerCase().includes('expire') || item.title.toLowerCase().includes('lapsed')
                      const isUpcoming = item.title.toLowerCase().includes('upcoming') || (new Date(item.date) > new Date())
                      const policyNo = item.metadata?.policyNo ? String(item.metadata.policyNo) : (item.reference ? String(item.reference) : '—')
                      const company = item.metadata?.insuranceCompany ? String(item.metadata.insuranceCompany) : (item.metadata?.company ? String(item.metadata.company) : 'Reliance General Insurance Co. Ltd.')
                      const startDate = typeof item.metadata?.startDate === 'string' ? item.metadata.startDate : null
                      const expiryDate = typeof item.metadata?.expiryDate === 'string' ? item.metadata.expiryDate : null
                      const period = item.metadata?.coveragePeriod ? String(item.metadata.coveragePeriod) : (startDate && expiryDate ? `${fmtDate(startDate)} – ${fmtDate(expiryDate)}` : '—')
                      const premium = item.metadata?.grossPremium ?? item.metadata?.amount

                      return (
                        <tr key={`${item.date}-${item.title}-${idx}`} className="hover:bg-[#ECFDF5]/30 transition-colors">
                          {/* Date with Light Green Icon Box */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669] flex items-center justify-center shrink-0">
                                <ShieldCheck className="h-3.5 w-3.5" />
                              </div>
                              <span className="font-semibold text-xs text-slate-600 font-mono tracking-tight uppercase">
                                {formatRoadwayDate(item.date)}
                              </span>
                            </div>
                          </td>

                          {/* Activity Title */}
                          <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                            {item.title}
                          </td>

                          {/* Policy Number */}
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-600 font-medium">
                            {policyNo}
                          </td>

                          {/* Insurance Company */}
                          <td className="px-4 py-3 text-slate-700 font-medium max-w-[200px] truncate">
                            {company}
                          </td>

                          {/* Coverage Period */}
                          <td className="px-4 py-3 whitespace-nowrap text-slate-600 font-medium text-xs">
                            {period}
                          </td>

                          {/* Premium */}
                          <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-slate-800 tabular-nums">
                            {premium ? (typeof premium === 'number' ? fmtMoney(premium) : String(premium)) : '—'}
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <span className={cn(
                              "px-2.5 py-0.5 rounded-full text-xs font-semibold",
                              isExpiry
                                ? "bg-[#FFE4E6] text-[#9F1239] border border-[#FECDD3]"
                                : isUpcoming
                                ? "bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]"
                                : "bg-[#D1FAE5] text-[#065F46] border border-[#A7F3D0]"
                            )}>
                              {isExpiry ? 'Expired' : isUpcoming ? 'Upcoming' : 'Active'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* View All Toggle */}
              {sortedInsurance.length > 5 && (
                <div className="p-3 bg-white border-t border-slate-100 flex justify-start">
                  <button
                    type="button"
                    onClick={() => setExpandedSections(prev => ({ ...prev, insurance: !prev.insurance }))}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#059669] hover:underline cursor-pointer"
                  >
                    <span>{expandedSections.insurance ? 'Show fewer activities ←' : `View all ${sortedInsurance.length} Insurance activities →`}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 3. WORKSHOP SERVICE SECTION (IMAGE 2 MATCH) ──────────────────── */}
        {showService && sortedService.length > 0 && (
          <div className="relative flex flex-col md:flex-row md:items-start gap-4 sm:gap-6">
            {/* Left Category Node - Horizontal Layout */}
            <div className="flex items-center gap-3 w-52 shrink-0 relative z-10 pt-1">
              <div className="h-10 w-10 rounded-xl bg-[#EA580C] text-white flex items-center justify-center shadow-xs shrink-0 ring-4 ring-white">
                <Wrench className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#EA580C] truncate">
                  Workshop Service
                </h4>
                <p className="text-xs text-slate-500 font-normal">
                  {sortedService.length} {sortedService.length === 1 ? 'Activity' : 'Activities'}
                </p>
              </div>
            </div>

            {/* Right Structured Table */}
            <div className="flex-1 min-w-0 rounded-xl border border-[#FED7AA] bg-white overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse c360-activity-table c360-service-table">
                  <thead>
                    <tr className="border-b border-[#FDBA74] bg-[#FFF7ED] text-xs font-semibold text-[#9A3412]">
                      <th className="px-4 py-3 whitespace-nowrap">Date</th>
                      <th className="px-4 py-3">Activity</th>
                      <th className="px-4 py-3 whitespace-nowrap">Job Card / ID</th>
                      <th className="px-4 py-3 whitespace-nowrap">Service Type</th>
                      {/* The odometer, and how far the car ran since the previous visit. */}
                      <th className="px-4 py-3 text-right whitespace-nowrap">Odometer</th>
                      <th className="px-4 py-3">Details</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">Amount (₹)</th>
                      <th className="px-4 py-3 text-center whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(expandedSections.service ? sortedService : sortedService.slice(0, 5)).map((item, idx) => {
                      const jobCard = item.metadata?.jobCard || item.metadata?.['Job Card Number'] || item.reference || '—'
                      const serviceType = item.metadata?.serviceType || item.metadata?.['Work Type'] || (item.title.toLowerCase().includes('checkup') ? 'General Checkup' : 'General Service')
                      const rawAmt = item.metadata?.amount ?? item.metadata?.billAmount ?? item.metadata?.total
                      const totalBilledStr = typeof item.metadata?.['Total Billed'] === 'string' ? item.metadata['Total Billed'] : null

                      let amountDisplay = '—'
                      if (typeof rawAmt === 'number') {
                        amountDisplay = rawAmt > 0 ? (fmtMoney(rawAmt) ?? `₹${rawAmt.toLocaleString('en-IN')}`) : 'Free (FOC)'
                      } else if (totalBilledStr && !totalBilledStr.toLowerCase().includes('not billed')) {
                        amountDisplay = totalBilledStr
                      }

                      return (
                        <tr key={`${item.date}-${item.title}-${idx}`} className="hover:bg-[#FFF7ED]/40 transition-colors">
                          {/* Date with Light Amber Icon Box */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] text-[#EA580C] flex items-center justify-center shrink-0">
                                <Wrench className="h-3.5 w-3.5" />
                              </div>
                              <span className="font-semibold text-xs text-slate-600 font-mono tracking-tight uppercase">
                                {formatRoadwayDate(item.date)}
                              </span>
                            </div>
                          </td>

                          {/* Activity Title */}
                          <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                            {item.title}
                          </td>

                          {/* Job Card / ID */}
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-600 font-medium">
                            {jobCard}
                          </td>

                          {/* Service Type */}
                          <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-700">
                            {serviceType}
                          </td>

                          {/*
                            * Odometer at the visit, with the distance since the previous one beneath.
                            * Both are absent on roughly a third of billed visits, and an absent
                            * reading is shown as a dash — never 0, which would claim the car had not
                            * moved.
                            */}
                          <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                            {typeof item.metadata?.odometer === 'number' ? (
                              <>
                                <span className="font-semibold text-slate-800">
                                  {Math.round(item.metadata.odometer).toLocaleString('en-IN')}
                                  <span className="ml-0.5 text-[10px] font-medium text-slate-400">km</span>
                                </span>
                                {typeof item.metadata?.kmSinceLast === 'number' && (
                                  <span className="block text-[11px] font-medium text-[#EA580C]">
                                    +{Math.round(item.metadata.kmSinceLast).toLocaleString('en-IN')} since last
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>

                          {/* Details */}
                          <td className="px-4 py-3 text-slate-600 max-w-[260px]">
                            <div className="line-clamp-2">
                              <span className="font-normal text-slate-700">{item.detail || 'Service recorded'}</span>
                            </div>
                          </td>

                          {/* Amount */}
                          <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-slate-800 tabular-nums">
                            {amountDisplay}
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#D1FAE5] text-[#065F46] border border-[#A7F3D0]">
                              Completed
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* View All Toggle */}
              {sortedService.length > 5 && (
                <div className="p-3 bg-white border-t border-slate-100 flex justify-start">
                  <button
                    type="button"
                    onClick={() => setExpandedSections(prev => ({ ...prev, service: !prev.service }))}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#EA580C] hover:underline cursor-pointer"
                  >
                    <span>{expandedSections.service ? 'Show fewer activities ←' : `View all ${sortedService.length} Workshop Service activities →`}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── BOTTOM VIEW ALL TIMELINE BUTTON ──────────────────────────────────── */}
      <div className="pt-3 flex justify-center">
        <button
          type="button"
          onClick={() => {
            const allExpanded = expandedSections.sales && expandedSections.insurance && expandedSections.service
            setExpandedSections({
              sales: !allExpanded,
              insurance: !allExpanded,
              service: !allExpanded,
            })
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
        >
          <Calendar className="h-4 w-4 text-slate-500" />
          <span>
            {showEverything
              ? 'Show key milestones only'
              : 'View full timeline — every enquiry, test drive and invoice'}
          </span>
        </button>
      </div>
    </div>
  )
}

function DossierView({ profile, caps, onClose }: { profile: ProfileWithStory; caps: BrandCapabilities; onClose: () => void }) {
  const [selectedVin, setSelectedVin] = useState<string | null>(null)

  const rawEvents = profile.timeline || []

  const totalServices = profile.vehicles.reduce((acc, v) => acc + (v.serviceCount || 0), 0)

  /*
   * ── THE TOTAL MUST BE AUDITABLE ──────────────────────────────────────────────────────────────
   *
   * It used to render as one figure with the components hidden in a `title` tooltip, so a customer
   * showing "Rs 12,278" against a service table where most rows read "—" looked simply wrong. The
   * money is real, but it comes from three different places and only one of them was on screen.
   *
   * The parts are kept and printed beneath the total. A component that is zero is omitted rather
   * than printed as "Rs 0", which would imply we hold a nil figure rather than no figure.
   */
  const spend = profile.vehicles.reduce(
    (acc, v) => {
      if (v.serviceSpend !== null && v.serviceSpend !== undefined) acc.service += v.serviceSpend
      if (v.accessoriesSpend !== null && v.accessoriesSpend !== undefined) acc.accessories += v.accessoriesSpend
      acc.priced += v.servicesBilled || 0
      acc.unpriced += v.servicesUnbilled || 0
      // A cancelled policy is not money the customer spent with us.
      const premium = v.insurance?.cancelled ? null : v.insurance?.grossPremium
      if (premium !== null && premium !== undefined) acc.insurance += premium
      return acc
    },
    { service: 0, accessories: 0, insurance: 0, priced: 0, unpriced: 0 },
  )
  const spendTotal = spend.service + spend.accessories + spend.insurance
  const spendParts = [
    { label: 'Workshop', value: spend.service },
    { label: 'Insurance', value: spend.insurance },
    { label: 'Accessories', value: spend.accessories },
  ].filter((part) => part.value > 0)

  const filteredEvents = useMemo(() => {
    if (!selectedVin) return rawEvents
    return rawEvents.filter((e) => !e.vin || e.vin === selectedVin)
  }, [rawEvents, selectedVin])

  return (
    <div className="bg-slate-50/50 min-h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white sticky top-0 z-20 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
            <User className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900">Customer 360 Dossier</h2>
            <p className="text-[11px] text-slate-400 font-semibold font-mono">
              Key: <span className="text-slate-700 font-bold">{profile.customerId || profile.key}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-xl border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6 flex-1">
        <div className="p-5 sm:p-6 rounded-3xl bg-slate-900 text-white shadow-xl relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/5" />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/10 text-white border border-white/20">
                  {(profile as any).brand ? String((profile as any).brand).toUpperCase() : 'CUSTOMER DOSSIER'}
                </span>
                <span className="text-xs text-slate-400 font-mono font-bold">
                  ID: {profile.customerId || profile.key}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">{profile.name}</h2>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-300 pt-1">
                {profile.phone && (
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Phone className="h-3.5 w-3.5 text-slate-400" /> {profile.phone}
                  </span>
                )}
                {profile.email && (
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Mail className="h-3.5 w-3.5 text-slate-400" /> {profile.email}
                  </span>
                )}
                {profile.city && (
                  <span className="flex items-center gap-1.5 font-semibold">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" /> {profile.city}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right bg-white/10 backdrop-blur-xs px-5 py-3 rounded-2xl border border-white/15">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                  Total Spend Recorded
                </span>
                <span className="text-xl sm:text-2xl font-black text-white block mt-0.5 font-sans tabular-nums">
                  {fmtMoney(spendTotal) ?? '—'}
                </span>
                {/* Where the number comes from, on the face of it rather than in a tooltip. */}
                {spendParts.length > 0 && (
                  <span className="flex flex-wrap justify-end gap-x-3 gap-y-0.5 mt-1.5">
                    {spendParts.map((part) => (
                      <span key={part.label} className="text-[10px] font-semibold text-slate-300 tabular-nums">
                        <span className="text-slate-500 font-medium">{part.label}</span>{' '}
                        {fmtMoney(part.value)}
                      </span>
                    ))}
                  </span>
                )}
                <span className="text-[10px] text-slate-400 block mt-1 font-medium">
                  {profile.vehicles.length} {profile.vehicles.length === 1 ? 'Vehicle' : 'Vehicles'} • {totalServices} {totalServices === 1 ? 'Service' : 'Services'}
                  {/*
                    * Unbilled visits are named, because they are the reason the workshop figure is
                    * lower than the visit count suggests: 2,398 of 5,711 rows carry no price.
                    */}
                  {spend.unpriced > 0 && ` • ${spend.unpriced} not billed`}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Car className="h-4 w-4 text-slate-600" />
              VEHICLES &amp; GARAGE ({profile.vehicles.length})
            </h3>
            {selectedVin && (
              <button
                type="button"
                onClick={() => setSelectedVin(null)}
                className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
              >
                Show all vehicles
              </button>
            )}
          </div>

          {profile.vehicles.length === 0 ? (
            <div className="p-5 rounded-2xl border border-slate-200 bg-white text-center text-slate-400 text-xs">
              No vehicles linked to this customer account.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {profile.vehicles.map((v, vIdx) => {
                const isSelected = selectedVin === v.vin
                return (
                  <div
                    key={`${v.vin}-${vIdx}`}
                    onClick={() => setSelectedVin(isSelected ? null : v.vin)}
                    className={cn(
                      "p-4 rounded-2xl bg-white border transition-all flex items-center justify-between gap-3 shadow-2xs cursor-pointer",
                      isSelected
                        ? "border-blue-600 ring-2 ring-blue-600/20 bg-blue-50/20"
                        : "border-slate-200/90 hover:border-slate-300"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <VehicleThumbnail model={v.model} className="w-20 h-14" />
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight truncate">
                            {v.model || 'VEHICLE'}
                          </h4>
                          {v.registration && (
                            <span className="px-2 py-0.2 rounded bg-slate-100 text-slate-800 text-[10px] font-mono font-bold border border-slate-200">
                              {v.registration}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-mono text-slate-400 truncate">
                          VIN: {caps.vin ? v.vin : `${v.vin} (Masked)`}
                        </p>
                        <div className="text-[10px] text-slate-500 font-semibold flex items-center gap-2">
                          <span>{v.serviceCount} Services</span>
                          <span>•</span>
                          <span>{v.insurance ? (v.insurance.cancelled ? 'Cancelled' : v.insurance.lapsed ? 'Lapsed' : 'Insured') : 'No Policy'}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className={cn(
                        "px-3 py-1.5 rounded-xl border text-[11px] font-black transition-colors shrink-0",
                        isSelected
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      )}
                    >
                      {isSelected ? 'Focused' : 'Filter'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── STRUCTURED ACTIVITY STREAM (IMAGE MATCH) ───────────────────────── */}
        <StructuredActivityStream
          events={filteredEvents}
          vehicles={profile.vehicles}
          onFocusVin={(vin) => setSelectedVin(vin)}
        />
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

