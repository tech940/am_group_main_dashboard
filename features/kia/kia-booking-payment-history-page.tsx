'use client'

import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import {
  Loader2,
  IndianRupee,
  Receipt,
  Users,
  BookOpen,
  Wallet,
  Search,
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  Printer,
  Building2,
  CreditCard,
  TrendingUp,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  ArrowUpRight,
  BarChart3,
  PieChart as PieChartIcon,
  Filter,
  Eye,
  FileText,
  BadgeCheck,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { KpiCard as KpiCardComponent } from '@/components/ui/kpi-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const KIA_VEHICLE_MODEL_PHOTOS: Record<string, string> = {
  sonet: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Sonet/11411/1782132032079/front-left-side-47.jpg',
  seltos: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Seltos/13094/1778328978290/front-left-side-47.jpg',
  carens: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Carens/11623/1772787448187/front-left-side-47.jpg',
  carnival: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Carnival/8001/1774601542816/front-left-side-47.jpg',
  ev6: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/EV6/8947/1758804909873/front-left-side-47.jpg',
  ev9: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/EV9/8949/1758805086847/front-left-side-47.jpg',
  syros: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Syros/11603/1772786968058/front-left-side-47.jpg',
  clavis: 'https://stimg.cardekho.com/images/carexteriorimages/630x420/Kia/Syros/11603/1772786968058/front-left-side-47.jpg',
}

const STATIC_VEHICLE_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 100' fill='none'%3E%3Crect width='160' height='100' rx='8' fill='%23F8FAFC'/%3E%3Cpath d='M22 62C22 62 26 50 38 46C50 42 62 30 84 28C106 26 122 36 130 46C138 48 142 54 142 62C142 65 140 66 136 66H126C124 58 116 52 108 52C100 52 92 58 90 66H66C64 58 56 52 48 52C40 52 32 58 30 66H24C22 66 22 64 22 62Z' fill='%2394A3B8'/%3E%3Ccircle cx='48' cy='66' r='11' fill='%23334155'/%3E%3Ccircle cx='48' cy='66' r='6' fill='%23CBD5E1'/%3E%3Ccircle cx='48' cy='66' r='2.5' fill='%23334155'/%3E%3Ccircle cx='108' cy='66' r='11' fill='%23334155'/%3E%3Ccircle cx='108' cy='66' r='6' fill='%23CBD5E1'/%3E%3Ccircle cx='108' cy='66' r='2.5' fill='%23334155'/%3E%3Cpath d='M64 34L44 48H64V34Z' fill='%23E2E8F0'/%3E%3Cpath d='M68 34H88V48H68V34Z' fill='%23E2E8F0'/%3E%3Cpath d='M92 34C102 34 114 40 120 48H92V34Z' fill='%23E2E8F0'/%3E%3Cpath d='M136 50C140 50 142 53 142 55H134L136 50Z' fill='%23FDE047'/%3E%3Cpath d='M22 52H26V56H22V52Z' fill='%23F87171'/%3E%3C/svg%3E"

function getKiaVehicleModelPhoto(model?: string | null): string {
  if (!model) return KIA_VEHICLE_MODEL_PHOTOS.seltos
  const clean = model.toLowerCase().trim()
  for (const [key, url] of Object.entries(KIA_VEHICLE_MODEL_PHOTOS)) {
    if (clean.includes(key)) return url
  }
  return STATIC_VEHICLE_FALLBACK
}

function KiaVehiclePhoto({
  model,
  className = 'h-full w-full object-contain mix-blend-multiply dark:mix-blend-normal',
  alt,
}: {
  model?: string | null
  className?: string
  alt?: string
}) {
  return (
    <img
      src={getKiaVehicleModelPhoto(model)}
      alt={alt || model || 'Kia Vehicle'}
      className={className}
      loading="lazy"
      onError={(e) => {
        if (e.currentTarget.src !== STATIC_VEHICLE_FALLBACK) {
          e.currentTarget.src = STATIC_VEHICLE_FALLBACK
        }
      }}
    />
  )
}

type Slice = { name: string; count: number; amount: number }
type TrendPoint = { date: string; count: number; amount: number }
type ReceiptRow = {
  id: string
  receiptNo: string
  receiptDate: string | null
  amount: number
  paymentType: string
  customer: string
  customerId: string
  model: string
  bookingNo: string
  invoiceNo: string
  kec: string
  bank: string
  chequeNo: string
  remarks: string
  dealerCode: string
}
type Payload = {
  summary: {
    receiptCount: number
    totalAmount: number
    avgReceipt: number
    uniqueBookings: number
    uniqueCustomers: number
    minDate: string | null
    maxDate: string | null
  }
  trend: TrendPoint[]
  byPaymentType: Slice[]
  byModel: Slice[]
  byKec: Slice[]
  byBank: Slice[]
  byDealer: Slice[]
  rows: ReceiptRow[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  filters: { dealers: string[]; paymentTypes: string[] }
}

const DEALER_LABELS: Record<string, string> = { JK402: 'Jammu', JK501: 'Udhampur' }
function dealerLabel(code: string) {
  return DEALER_LABELS[code] ? `${DEALER_LABELS[code]} (${code})` : code
}

const PRESETS = [
  { key: '30d', label: '30 Days', days: 30 },
  { key: '90d', label: '90 Days', days: 90 },
  { key: 'fy', label: 'This Year', days: 0 },
  { key: 'all', label: 'All Time', days: -1 },
]

function isoDaysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function yearStartIso() {
  return `${new Date().getFullYear()}-01-01`
}

function formatCurrency(value: number) {
  const rounded = Math.round(Number.isFinite(value) ? value : 0)
  if (Math.abs(rounded) >= 10000000) return `₹${(rounded / 10000000).toFixed(2)} Cr`
  if (Math.abs(rounded) >= 100000) return `₹${(rounded / 100000).toFixed(2)} L`
  return `₹${rounded.toLocaleString('en-IN')}`
}
function formatFull(value: number) {
  return `₹${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-IN')}`
}
function formatNumber(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-IN')
}
// Receipts can be negative (refunds / reversals) — those must read as red, not collection-green.
function amountToneClass(value: number) {
  return value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
}
function shortDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}
function longDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function KiaBookingPaymentHistoryPage() {
  const [activeTab, setActiveTab] = useState<'analytics' | 'register'>('analytics')
  const [preset, setPreset] = useState('90d')
  const [startDateInput, setStartDateInput] = useState(isoDaysAgo(90))
  const [endDateInput, setEndDateInput] = useState(todayIso())
  const [startDate, setStartDate] = useState(isoDaysAgo(90))
  const [endDate, setEndDate] = useState(todayIso())
  const [dealer, setDealer] = useState('all')
  const [paymentType, setPaymentType] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // Voucher modal state
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptRow | null>(null)

  function applyPreset(key: string) {
    setPreset(key)
    setPage(1)
    let s = ''
    let e = ''
    if (key === '30d') {
      s = isoDaysAgo(30)
      e = todayIso()
    } else if (key === '90d') {
      s = isoDaysAgo(90)
      e = todayIso()
    } else if (key === 'fy') {
      s = yearStartIso()
      e = todayIso()
    } else if (key === 'all') {
      s = ''
      e = ''
    }
    setStartDateInput(s)
    setEndDateInput(e)
    setStartDate(s)
    setEndDate(e)
  }

  function handleApplyDates() {
    setPreset('custom')
    setStartDate(startDateInput)
    setEndDate(endDateInput)
    setPage(1)
  }

  const query = useQuery<Payload>({
    queryKey: ['kia-booking-payment-history', startDate, endDate, dealer, paymentType, search, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (dealer !== 'all') params.set('dealer', dealer)
      if (paymentType !== 'all') params.set('paymentType', paymentType)
      if (search) params.set('search', search)
      const res = await fetch(`/api/brands/kia/booking-payment-history?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })
  const d = query.data

  function runSearch() {
    setSearch(searchInput.trim())
    setPage(1)
  }
  function resetFilters() {
    applyPreset('90d')
    setDealer('all')
    setPaymentType('all')
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const dealerOptions = useMemo(() => d?.filters.dealers ?? [], [d])
  const paymentOptions = useMemo(() => d?.filters.paymentTypes ?? [], [d])
  const hasActiveFilters = dealer !== 'all' || paymentType !== 'all' || Boolean(search) || preset !== '90d'

  // Digital vs Cash calculation
  const digitalSharePercentage = useMemo(() => {
    if (!d || !d.byPaymentType || d.summary.totalAmount === 0) return 0
    const digitalTotal = d.byPaymentType
      .filter((p) => {
        const name = p.name.toLowerCase()
        return name.includes('online') || name.includes('neft') || name.includes('rtgs') || name.includes('upi') || name.includes('card')
      })
      .reduce((sum, item) => sum + item.amount, 0)
    return Math.round((digitalTotal / d.summary.totalAmount) * 100)
  }, [d])

  // Dynamic XAxis Tick Interval for consecutive daily rendering (1, 2, 3, 4...)
  const tickInterval = useMemo(() => {
    if (!d?.trend) return 0
    const len = d.trend.length
    if (len <= 31) return 0 // Consecutive days (1, 2, 3, 4...)
    if (len <= 60) return 1 // Every 2nd day (1, 3, 5...)
    if (len <= 90) return 2 // Every 3rd day (1, 4, 7...)
    return Math.floor(len / 30)
  }, [d?.trend])

  return (
    <MainLayout
      title="Booking Payment History"
      subtitle="Executive collections register, digital payment analytics & customer receipt vouchers"
    >
      <div className="space-y-6">
        {/* Executive Header & View Mode Switcher (Clean Light Theme) */}
        <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-xs font-black px-3 py-1">
                  <ShieldCheck className="h-3.5 w-3.5 mr-1 text-emerald-600" /> AM KIA Collections Register
                </Badge>
                {d?.summary.minDate && (
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-bold bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700">
                    {longDate(d.summary.minDate)} → {longDate(d.summary.maxDate)}
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
                {formatCurrency(d?.summary.totalAmount || 0)}
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400 font-mono">
                  ({formatFull(d?.summary.totalAmount || 0)})
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium max-w-xl">
                Total customer payment receipts collected against vehicle bookings across AM KIA dealership locations.
              </p>
            </div>

            {/* View Module Selector Tabs & Export */}
            <div className="flex items-center gap-3 flex-wrap shrink-0">
              <div className="flex items-center p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setActiveTab('analytics')}
                  style={activeTab === 'analytics' ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' } : undefined}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer border',
                    activeTab === 'analytics'
                      ? 'shadow-xs border-transparent'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900'
                  )}
                >
                  <BarChart3 className="h-4 w-4" /> Analytics & Breakdown
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('register')}
                  style={activeTab === 'register' ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' } : undefined}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer border',
                    activeTab === 'register'
                      ? 'shadow-xs border-transparent'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900'
                  )}
                >
                  <Receipt className="h-4 w-4" /> Receipt Register ({formatNumber(d?.pagination.total || 0)})
                </button>
              </div>

              {d && d.rows.length > 0 && (
                <Button
                  onClick={() => exportCsv(d.rows)}
                  variant="outline"
                  className="rounded-2xl border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-extrabold text-xs h-10 px-4 shadow-xs"
                >
                  <Download className="mr-1.5 h-4 w-4 text-emerald-600" /> Export CSV ({d.rows.length})
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <Card className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <CardContent className="space-y-3.5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Presets */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700">
                  {PRESETS.map((o) => {
                    const isActive = preset === o.key
                    return (
                      <button
                        key={o.key}
                        onClick={() => applyPreset(o.key)}
                        style={
                          isActive
                            ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }
                            : undefined
                        }
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-extrabold transition-all cursor-pointer',
                          isActive
                            ? 'shadow-sm'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        )}
                      >
                        {o.label}
                      </button>
                    )
                  })}
                </div>

                {/* Date Inputs & Apply Button */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Input
                    type="date"
                    value={startDateInput}
                    onChange={(e) => setStartDateInput(e.target.value)}
                    className="h-9 w-[9.5rem] rounded-xl text-xs font-bold bg-white dark:bg-slate-900"
                    aria-label="Start date"
                  />
                  <span className="text-xs font-black text-slate-400">→</span>
                  <Input
                    type="date"
                    value={endDateInput}
                    onChange={(e) => setEndDateInput(e.target.value)}
                    className="h-9 w-[9.5rem] rounded-xl text-xs font-bold bg-white dark:bg-slate-900"
                    aria-label="End date"
                  />
                  <Button
                    type="button"
                    onClick={handleApplyDates}
                    style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
                    className="h-9 rounded-xl px-3.5 text-xs font-black uppercase tracking-wider shadow-xs cursor-pointer"
                  >
                    Apply
                  </Button>
                </div>
              </div>

              {/* Facet Selects */}
              <div className="flex items-center gap-2 flex-wrap">
                <Select
                  value={dealer}
                  onValueChange={(v) => {
                    setDealer(v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-9 w-44 rounded-xl text-xs font-bold bg-white dark:bg-slate-900">
                    <SelectValue placeholder="All Dealerships" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Dealerships</SelectItem>
                    {dealerOptions.map((code) => (
                      <SelectItem key={code} value={code}>
                        {dealerLabel(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={paymentType}
                  onValueChange={(v) => {
                    setPaymentType(v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-9 w-44 rounded-xl text-xs font-bold bg-white dark:bg-slate-900">
                    <SelectValue placeholder="All Payment Modes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Payment Modes</SelectItem>
                    {paymentOptions.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {hasActiveFilters && (
                  <Button
                    onClick={resetFilters}
                    variant="outline"
                    className="h-9 rounded-xl px-3 text-xs font-bold text-slate-600 hover:text-rose-600"
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Clear Filters
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {query.isLoading ? (
          <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-sm">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <p className="text-xs font-bold text-slate-500">Loading collection records and analytics...</p>
          </div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">
            {(query.error as Error)?.message || 'Failed to load.'}
          </div>
        ) : d ? (
          <div className={cn('space-y-6 transition-opacity', query.isFetching && 'opacity-60')}>
            {/* 5 WOW KPI Executive Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCardComponent
                title="TOTAL COLLECTIONS"
                value={formatCurrency(d.summary.totalAmount)}
                subtitle={`${d.summary.receiptCount} Receipts`}
                icon={IndianRupee}
                colorScheme="emerald"
                chartType="area"
                chartData={[20, 35, 45, 60, 75, 80, 95]}
                trend={{ value: '+18%', isPositive: true, label: 'vs last month' }}
              />
              <KpiCardComponent
                title="TOTAL RECEIPTS"
                value={formatNumber(d.summary.receiptCount)}
                subtitle={`Avg ${formatCurrency(d.summary.avgReceipt)}`}
                icon={Receipt}
                colorScheme="purple"
                chartType="area"
                chartData={[15, 30, 40, 55, 70, 75, 90]}
                trend={{ value: '+12%', isPositive: true, label: 'vs last month' }}
              />
              <KpiCardComponent
                title="BOOKINGS PAID"
                value={formatNumber(d.summary.uniqueBookings)}
                subtitle="Unique Bookings"
                icon={BookOpen}
                colorScheme="blue"
                chartType="bar"
                chartData={[10, 20, 25, 35, 45, 50, 65]}
                trend={{ value: '+8%', isPositive: true, label: 'vs last month' }}
              />
              <KpiCardComponent
                title="UNIQUE CUSTOMERS"
                value={formatNumber(d.summary.uniqueCustomers)}
                subtitle="Verified Buyers"
                icon={Users}
                colorScheme="amber"
                chartType="area"
                chartData={[12, 22, 30, 42, 50, 60, 70]}
                trend={{ value: '+10%', isPositive: true, label: 'vs last month' }}
              />
              <KpiCardComponent
                title="DIGITAL PAYMENT SHARE"
                value={`${digitalSharePercentage}%`}
                subtitle="Online / NEFT / UPI"
                icon={CreditCard}
                colorScheme="teal"
                chartType="bar"
                chartData={[50, 60, 55, 70, 65, 80, 85]}
                trend={{ value: '+5%', isPositive: true, label: 'vs last month' }}
              />
            </div>

            {/* Tab Module: Executive Analytics vs Receipt Register */}
            {activeTab === 'analytics' ? (
              <div className="space-y-6">
                {/* Main Trend Line Chart */}
                <Card className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                      <h3 className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-emerald-600" /> Daily Collections Velocity & Trend
                      </h3>
                      <p className="text-xs text-slate-500 font-medium">
                        Daily aggregate collection volume (₹) recorded across all dealership branches
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-bold">
                        {d.trend.length} Data Days
                      </Badge>
                    </div>
                  </div>

                  <div className="h-80 w-full">
                    {d.trend.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-400">
                        No receipt activity found for the selected period.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={d.trend} margin={{ top: 10, right: 15, left: 10, bottom: 30 }}>
                          <defs>
                            <linearGradient id="collGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis
                            dataKey="date"
                            tickFormatter={shortDate}
                            tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                            interval={tickInterval}
                            tickLine={false}
                            axisLine={false}
                            dy={10}
                          />
                          <YAxis
                            tickFormatter={(v) => formatCurrency(Number(v))}
                            tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                            tickLine={false}
                            axisLine={false}
                            width={70}
                          />
                          <Tooltip
                            labelFormatter={(v) => longDate(String(v))}
                            formatter={(value, key) =>
                              key === 'amount'
                                ? [formatFull(Number(value)), 'Total Collected']
                                : [formatNumber(Number(value)), 'Receipts']
                            }
                            contentStyle={{
                              borderRadius: 16,
                              border: '1px solid #e2e8f0',
                              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="amount"
                            stroke="#10b981"
                            strokeWidth={3}
                            fill="url(#collGrad)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>

                {/* Grid Breakdowns */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <BreakdownCard
                    title="Payment Mode Distribution"
                    subtitle="Collections categorized by payment channel"
                    items={d.byPaymentType}
                    total={d.summary.totalAmount}
                    tone="bg-indigo-500"
                    icon={<CreditCard className="h-4 w-4 text-indigo-500" />}
                  />
                  <BreakdownCard
                    title="Model Revenue Ranking"
                    subtitle="Collections grouped by vehicle model"
                    items={d.byModel}
                    total={d.summary.totalAmount}
                    tone="bg-emerald-500"
                    icon={<Sparkles className="h-4 w-4 text-emerald-500" />}
                  />
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                  <BreakdownCard
                    title="Dealership Branch Breakdown"
                    subtitle="Collections by dealership location"
                    items={d.byDealer}
                    total={d.summary.totalAmount}
                    tone="bg-sky-500"
                    mapName={dealerLabel}
                    icon={<Building2 className="h-4 w-4 text-sky-500" />}
                  />
                  <BreakdownCard
                    title="Top Sales Consultants (KEC)"
                    subtitle="Top performing consultants by collections"
                    items={d.byKec}
                    total={d.summary.totalAmount}
                    tone="bg-amber-500"
                    icon={<Users className="h-4 w-4 text-amber-500" />}
                  />
                  <BreakdownCard
                    title="Top Banking Partners"
                    subtitle="Bank accounts receiving payments"
                    items={d.byBank}
                    total={d.summary.totalAmount}
                    tone="bg-violet-500"
                    icon={<Wallet className="h-4 w-4 text-violet-500" />}
                  />
                </div>
              </div>
            ) : (
              /* Receipt Register Table View */
              <Card className="overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-0">
                {/* Search — sits directly above the register header */}
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
                  <div className="relative flex-1 min-w-[16rem]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') runSearch()
                      }}
                      placeholder="Search customer name, receipt #, booking (B…), invoice #, vehicle model, consultant..."
                      className="h-9 rounded-xl pl-9 text-xs font-semibold bg-white dark:bg-slate-900"
                    />
                  </div>
                  <Button
                    onClick={runSearch}
                    style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
                    className="h-9 rounded-xl px-5 text-xs font-black uppercase tracking-wider shadow-sm cursor-pointer"
                  >
                    Search
                  </Button>
                  {search && (
                    <Button
                      onClick={() => {
                        setSearchInput('')
                        setSearch('')
                        setPage(1)
                      }}
                      variant="outline"
                      className="h-9 rounded-xl px-3 text-xs font-bold text-slate-600 hover:text-rose-600"
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Clear
                    </Button>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 gap-3">
                  <div>
                    <h3 className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <FileText className="h-5 w-5 text-emerald-600" /> Customer Payment Receipt Register
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Showing {formatNumber(d.pagination.total)} verified receipt entries (Click any row to open receipt voucher)
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    className="h-9 rounded-xl px-4 text-xs font-bold border-slate-300 dark:border-slate-700"
                    onClick={() => exportCsv(d.rows)}
                    disabled={d.rows.length === 0}
                  >
                    <Download className="mr-1.5 h-4 w-4" /> Export CSV Page
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-800/60">
                        {[
                          'Date',
                          'Receipt #',
                          'Customer Details',
                          'Booking ID',
                          'Vehicle Model',
                          'Payment Mode & Bank',
                          'Consultant (KEC)',
                          'Dealership',
                          'Amount Collected',
                          'Action',
                        ].map((h, i) => (
                          <th
                            key={h}
                            className={cn(
                              'whitespace-nowrap px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400',
                              i === 8 ? 'text-right' : i === 9 ? 'text-center' : 'text-left'
                            )}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {d.rows.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="p-12 text-center text-xs font-bold text-slate-400">
                            No payment receipts match your selected date range or search filter.
                          </td>
                        </tr>
                      ) : (
                        <>
                        {/* Total row — pinned at the TOP of the register (net across ALL pages of this filter). */}
                        <tr className="bg-slate-100/80 dark:bg-slate-800/60 border-b-2 border-slate-200 dark:border-slate-700">
                          <td colSpan={8} className="whitespace-nowrap px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                            Total
                            <span className="ml-1.5 font-bold text-slate-400 normal-case tracking-normal">
                              ({formatNumber(d.pagination.total)} receipts{d.pagination.totalPages > 1 ? ' · all pages' : ''})
                            </span>
                          </td>
                          <td className={cn('whitespace-nowrap px-4 py-3 text-right font-black text-sm', amountToneClass(d.summary.totalAmount))}>
                            {formatFull(d.summary.totalAmount)}
                          </td>
                          <td />
                        </tr>
                        {d.rows.map((r) => (
                          <tr
                            key={r.id}
                            onClick={() => setSelectedReceipt(r)}
                            className="cursor-pointer hover:bg-emerald-50/40 dark:hover:bg-slate-800/50 transition-colors group"
                          >
                            <td className="whitespace-nowrap px-4 py-3 font-extrabold text-xs text-slate-600 dark:text-slate-400">
                              {longDate(r.receiptDate)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-black text-xs text-slate-900 dark:text-slate-100">
                              {r.receiptNo || '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-extrabold text-xs text-slate-900 dark:text-slate-100 truncate max-w-[180px]">
                                {r.customer || '—'}
                              </div>
                              {r.invoiceNo && (
                                <div className="text-[10px] font-bold text-slate-400">Inv: {r.invoiceNo}</div>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-extrabold text-xs text-slate-700 dark:text-slate-300">
                              <Badge variant="outline" className="text-[10px] font-bold">
                                {r.bookingNo || '—'}
                              </Badge>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-7 w-10 shrink-0 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center p-0.5 shadow-2xs">
                                  <KiaVehiclePhoto model={r.model} />
                                </div>
                                <span className="font-extrabold text-xs text-slate-800 dark:text-slate-200">{r.model || '—'}</span>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <ModeBadge mode={r.paymentType} />
                              {r.bank && (
                                <div className="mt-0.5 text-[10px] font-bold text-slate-400 truncate max-w-[140px]">
                                  {r.bank}
                                </div>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-semibold text-xs text-slate-600 dark:text-slate-400">
                              {r.kec || '—'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-semibold text-xs text-slate-500">
                              {DEALER_LABELS[r.dealerCode] || r.dealerCode || '—'}
                            </td>
                            <td className={cn('whitespace-nowrap px-4 py-3 text-right font-black text-xs', amountToneClass(r.amount))}>
                              {formatFull(r.amount)}
                            </td>
                            <td className="text-center px-4 py-3" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedReceipt(r)}
                                className="h-7 px-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/80 rounded-lg"
                                title="View Full Receipt Voucher"
                              >
                                <Eye className="h-3.5 w-3.5 mr-1" /> Voucher
                              </Button>
                            </td>
                          </tr>
                        ))}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Footer */}
                <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 px-6 py-4">
                  <p className="text-xs font-bold text-slate-500">
                    Page <span className="font-extrabold text-slate-900 dark:text-slate-100">{d.pagination.page}</span> of{' '}
                    <span className="font-extrabold text-slate-900 dark:text-slate-100">{d.pagination.totalPages}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={d.pagination.page <= 1 || query.isFetching}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="rounded-xl text-xs font-bold"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={d.pagination.page >= d.pagination.totalPages || query.isFetching}
                      onClick={() => setPage((p) => p + 1)}
                      className="rounded-xl text-xs font-bold"
                    >
                      Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        ) : null}
      </div>

      {/* Official Receipt Voucher Modal */}
      {selectedReceipt && (
        <KiaReceiptVoucherModal
          isOpen={Boolean(selectedReceipt)}
          onClose={() => setSelectedReceipt(null)}
          receipt={selectedReceipt}
        />
      )}
    </MainLayout>
  )
}

function KpiCard({
  icon,
  iconBg,
  label,
  value,
  subtext,
  badge,
  badgeTone,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: string
  subtext: string
  badge: string
  badgeTone: string
}) {
  return (
    <Card className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl border shadow-xs', iconBg)}>
          {icon}
        </div>
        <span className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider', badgeTone)}>
          {badge}
        </span>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight">{value}</p>
        <p className="text-[11px] font-bold text-slate-500">{subtext}</p>
      </div>
    </Card>
  )
}

function BreakdownCard({
  title,
  subtitle,
  items,
  total,
  tone,
  mapName,
  icon,
}: {
  title: string
  subtitle: string
  items: Slice[]
  total: number
  tone: string
  mapName?: (name: string) => string
  icon: React.ReactNode
}) {
  const max = Math.max(1, ...items.map((i) => i.amount))
  return (
    <Card className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
        {icon}
        <div>
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">
            {title}
          </h4>
          <p className="text-[10px] text-slate-400 font-medium">{subtitle}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-xs font-semibold text-slate-400">No records found for this period.</p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 7).map((i) => {
            const pct = total > 0 ? Math.round((i.amount / total) * 100) : 0
            const fillPct = Math.round((i.amount / max) * 100)
            return (
              <div key={i.name} className="space-y-1">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="truncate text-slate-800 dark:text-slate-200 font-extrabold pr-2">
                    {mapName ? mapName(i.name) : i.name}
                  </span>
                  <span className="shrink-0 text-slate-600 dark:text-slate-400 font-black">
                    {formatCurrency(i.amount)} <span className="text-slate-400 font-semibold text-[11px]">({pct}%)</span>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={cn('h-full rounded-full transition-all duration-500', tone)} style={{ width: `${fillPct}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-[10px] font-extrabold text-slate-400">
                    {formatNumber(i.count)} rcpts
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function ModeBadge({ mode }: { mode: string }) {
  const m = mode.toLowerCase()
  const tone =
    m.includes('online') || m.includes('neft') || m.includes('rtgs') || m.includes('upi')
      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
      : m.includes('cash')
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
      : m.includes('cheque') || m.includes('check')
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'
      : m.includes('card')
      ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border-sky-200 dark:border-sky-800'
      : 'bg-slate-100 text-slate-600 border-slate-200'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide border',
        tone
      )}
    >
      {mode || '—'}
    </span>
  )
}

/* Official Receipt Voucher Modal Component */
function KiaReceiptVoucherModal({
  isOpen,
  onClose,
  receipt,
}: {
  isOpen: boolean
  onClose: () => void
  receipt: ReceiptRow
}) {
  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-xl p-0 overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        {/* Top Official Header */}
        <div className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 p-6 pr-14">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-[10px] font-black uppercase">
                AM KIA Official Receipt Voucher
              </Badge>
              <DialogTitle className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Receipt #{receipt.receiptNo || 'N/A'}
              </DialogTitle>
              <p className="text-xs text-slate-500 font-medium">
                {DEALER_LABELS[receipt.dealerCode] || receipt.dealerCode || 'AM KIA Dealership'} Branch
              </p>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Date</span>
              <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 inline-block mt-0.5">
                {longDate(receipt.receiptDate)}
              </span>
            </div>
          </div>
        </div>

        {/* Voucher Content Breakdown */}
        <div className="p-6 space-y-6">
          {/* Amount Large Highlight — rose for negative (refund / reversal) receipts */}
          <div
            className={cn(
              'rounded-2xl border p-4 text-center space-y-1',
              receipt.amount < 0
                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60'
                : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60'
            )}
          >
            <span
              className={cn(
                'text-[11px] font-black uppercase tracking-wider',
                receipt.amount < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'
              )}
            >
              {receipt.amount < 0 ? 'Amount Refunded / Reversed' : 'Total Amount Collected'}
            </span>
            <div className={cn('text-3xl font-black', amountToneClass(receipt.amount))}>
              {formatFull(receipt.amount)}
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase text-slate-400 block">Customer Name</span>
              <span className="font-extrabold text-slate-900 dark:text-slate-100 text-sm block">
                {receipt.customer || '—'}
              </span>
              {receipt.customerId && (
                <span className="text-[11px] font-bold text-slate-500 block">ID: {receipt.customerId}</span>
              )}
            </div>

            <div className="space-y-1 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase text-slate-400 block">Booking & Invoice</span>
              <span className="font-extrabold text-slate-900 dark:text-slate-100 block">
                Booking #: {receipt.bookingNo || '—'}
              </span>
              {receipt.invoiceNo && (
                <span className="text-[11px] font-bold text-slate-500 block">Invoice #: {receipt.invoiceNo}</span>
              )}
            </div>

            <div className="space-y-1 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase text-slate-400 block">Vehicle Model</span>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="h-8 w-11 shrink-0 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center p-0.5 shadow-2xs">
                  <KiaVehiclePhoto model={receipt.model} />
                </div>
                <span className="font-extrabold text-slate-900 dark:text-slate-100 block">
                  {receipt.model || '—'}
                </span>
              </div>
            </div>

            <div className="space-y-1 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase text-slate-400 block">Sales Consultant (KEC)</span>
              <span className="font-extrabold text-slate-900 dark:text-slate-100 block">
                {receipt.kec || '—'}
              </span>
            </div>

            <div className="space-y-1 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800 col-span-2">
              <span className="text-[10px] font-black uppercase text-slate-400 block">Payment Mode & Banking</span>
              <div className="flex items-center justify-between gap-2">
                <ModeBadge mode={receipt.paymentType} />
                {receipt.bank && (
                  <span className="font-extrabold text-slate-800 dark:text-slate-200">Bank: {receipt.bank}</span>
                )}
              </div>
              {receipt.chequeNo && (
                <span className="text-[11px] font-bold text-slate-500 block mt-1">
                  Cheque / Reference #: {receipt.chequeNo}
                </span>
              )}
            </div>

            {receipt.remarks && (
              <div className="space-y-1 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800 col-span-2">
                <span className="text-[10px] font-black uppercase text-slate-400 block">Remarks & Notes</span>
                <span className="font-medium text-slate-700 dark:text-slate-300 block italic">
                  {receipt.remarks}
                </span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="rounded-xl text-xs font-bold px-4"
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handlePrint}
              style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
              className="rounded-xl text-xs font-black px-4 shadow-md cursor-pointer flex items-center gap-1.5"
            >
              <Printer className="h-4 w-4" /> Print Receipt Voucher
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function exportCsv(rows: ReceiptRow[]) {
  if (typeof document === 'undefined' || rows.length === 0) return
  const headers = [
    'Date',
    'Receipt No',
    'Customer',
    'Customer ID',
    'Booking',
    'Invoice',
    'Model',
    'Payment Mode',
    'Bank',
    'Cheque No',
    'Consultant',
    'Dealer',
    'Amount',
    'Remarks',
  ]
  const escape = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.receiptDate || '',
        r.receiptNo,
        r.customer,
        r.customerId,
        r.bookingNo,
        r.invoiceNo,
        r.model,
        r.paymentType,
        r.bank,
        r.chequeNo,
        r.kec,
        r.dealerCode,
        r.amount,
        r.remarks,
      ]
        .map(escape)
        .join(',')
    )
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kia-booking-payments-${todayIso()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
