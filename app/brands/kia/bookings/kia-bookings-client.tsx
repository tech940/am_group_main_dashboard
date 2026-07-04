'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  BadgeIndianRupee,
  CalendarCheck,
  Car,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  UserRound,
  XCircle,
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type SearchParamsInput = Record<string, string | string[] | undefined>

type BookingStatus =
  | 'draft'
  | 'booking_created'
  | 'proforma_generated'
  | 'vehicle_allocated'
  | 'finance_pending'
  | 'ready_delivery'
  | 'delivered'
  | 'cancelled'

type BookingRow = {
  id: string
  bookingNumber: string
  customerName: string
  customerPhone: string
  dealerCode: string
  model: string
  variant: string
  consultantName: string
  consultantEmail?: string | null
  status: BookingStatus | string
  proformaNumber?: string | null
  financeOrderNumber?: string | null
  allocatedVin?: string | null
  updatedAt?: string | null
}

type BookingListPayload = {
  rows: BookingRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  kpis: {
    today: number
    pendingProforma: number
    waitingAllocation: number
    financePending: number
    readyDelivery: number
    delivered: number
    cancelled: number
  }
  filters: {
    dealers: string[]
    models: string[]
    statuses: string[]
    consultants: string[]
  }
}

type TestPersona = 'actual' | 'sales_person' | 'sales_manager' | 'accounts'
type BookingClientMode = 'crm' | 'stock'

type BookingActivity = {
  id: string
  type: string
  message: string
  actorName?: string | null
  createdAt: string
}

type VehicleAllocation = {
  id: string
  vinNumber: string
  dealerCode: string
  model: string
  variant: string
  color?: string | null
  status?: string | null
  allocatedAt?: string | null
  expiresAt?: string | null
}

type LinkedRecord = {
  id: string
  number?: string | null
  status?: string | null
  createdAt?: string | null
}

type BookingDetailPayload = {
  booking: BookingRow & {
    customerEmail?: string | null
    address?: string | null
    customerAddress?: string | null
    colorPreference?: string | null
    expectedDeliveryDate?: string | null
    notes?: string | null
    fuelType?: string | null
    source?: string | null
    bankName?: string | null
    metadata?: Record<string, unknown> | null
  }
  allocation?: VehicleAllocation | null
  proforma?: LinkedRecord | null
  financeOrder?: LinkedRecord | null
  transfers: Array<{
    id: string
    vinNumber: string
    fromDealerCode?: string | null
    toDealerCode?: string | null
    status: string
    createdAt: string
  }>
  activities: BookingActivity[]
}

type MatchingVehicle = {
  vinNumber: string
  dealerCode: string
  model: string
  variant: string
  color?: string | null
  stockStatus?: string | null
  stockAge?: number | null
  source?: 'dms' | 'bbnd'
}

type MatchingVehiclesPayload = {
  rows: MatchingVehicle[]
}

type ProformaOptionsPayload = {
  models: string[]
  trims: { model: string; trim_description: string }[]
  banks: { bank_name: string; bank_branch: string | null }[]
}

type CreateBookingForm = {
  customerName: string
  countryCode: string
  customerPhone: string
  customerEmailId: string
  model: string
  year: string
  fuelType: string
  variant: string
  bankFinance: string
  bookingAmount: string
  bookingDate: string
  pmtSource: string
  paymentAmount: string
  managerName: string
  tlName: string
  consultantName: string
  color: string
  leadSource: string
  status: string
  expectedDeliveryDate: string
  commitment: string
  otherDealerDetails: string
  promiseDate: string
  costSheet: string
  paymentReceived: string
  waitingPeriod: string
  dealerCode: string
  notes: string
}

const DEFAULT_PAGE_SIZE = 10
const ALL_VALUE = 'all'
const PRIMARY_SURFACE = 'rounded-[1.5rem] border border-slate-200 bg-white shadow-sm sm:rounded-[2rem]'
const INPUT_STYLE = 'h-10 w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-3 text-sm font-semibold text-slate-800 transition-all duration-200 focus:bg-white focus:border-[#c8102e] focus:ring-4 focus:ring-red-50 focus:outline-none sm:h-12 sm:px-4'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  booking_created: 'Booking Created',
  proforma_generated: 'Proforma Generated',
  on_hold: 'On Hold',
  vehicle_allocated: 'Vehicle Allocated',
  finance_pending: 'Finance Pending',
  ready_delivery: 'Ready Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  booking_created: 'border-sky-200 bg-sky-50 text-sky-700',
  proforma_generated: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  on_hold: 'border-amber-200 bg-amber-50 text-amber-800',
  vehicle_allocated: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  finance_pending: 'border-amber-200 bg-amber-50 text-amber-700',
  ready_delivery: 'border-teal-200 bg-teal-50 text-teal-700',
  delivered: 'border-green-200 bg-green-50 text-green-700',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
}

const KPI_CONFIG = [
  { key: 'today', label: 'Today', icon: ClipboardList, accent: 'border-sky-400' },
  { key: 'pendingProforma', label: 'Pending Proforma', icon: FileText, accent: 'border-indigo-400' },
  { key: 'waitingAllocation', label: 'Waiting Allocation', icon: Car, accent: 'border-cyan-400' },
  { key: 'financePending', label: 'Finance Pending', icon: BadgeIndianRupee, accent: 'border-amber-400' },
  { key: 'readyDelivery', label: 'Ready Delivery', icon: Truck, accent: 'border-teal-400' },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle2, accent: 'border-emerald-400' },
  { key: 'cancelled', label: 'Cancelled', icon: XCircle, accent: 'border-rose-400' },
] as const

const CREATE_TABS = ['Customer', 'Vehicle', 'Sales Team', 'Payment', 'Delivery'] as const
const TEST_PERSONA_LABELS: Record<TestPersona, string> = {
  actual: 'Actual Role',
  sales_person: 'Sales Person',
  sales_manager: 'Sales Manager',
  accounts: 'Accounts',
}

function normalizeRole(role?: string | null) {
  return String(role || '').trim().toLowerCase()
}

function roleCanActAsSalesManager(role?: string | null) {
  const value = normalizeRole(role)
  return ['super_admin', 'admin', 'manager', 'general_manager', 'sales_head', 'md', 'ea', 'ceo'].includes(value)
}

function roleCanActAsAccounts(role?: string | null) {
  const value = normalizeRole(role)
  return ['super_admin', 'admin', 'accounts', 'finance_head'].includes(value)
}

function roleCanActAsSalesPerson(role?: string | null) {
  const value = normalizeRole(role)
  if (roleCanActAsAccounts(value)) return value === 'super_admin' || value === 'admin'
  if (roleCanActAsSalesManager(value)) return true
  return ['viewer', 'branch_admin', 'employee', 'sales_consultant', 'sales_executive', 'salesperson', 'user'].includes(value)
}

async function fetchJson<T>(url: string, label: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string; reason?: string } | null
      throw new Error(payload?.error || payload?.reason || `Request failed for ${label} (${response.status})`)
    }
    return await response.json() as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${label} timed out. Please refresh once; the server did not respond in time.`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function firstParam(params: SearchParamsInput, key: string, fallback = '') {
  const value = params[key]
  if (Array.isArray(value)) return value[0] || fallback
  return value || fallback
}

function buildQueryString(values: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === ALL_VALUE) return
    params.set(key, String(value))
  })
  return params.toString()
}

function formatDate(value?: string | null) {
  if (!value) return 'NA'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function formatTimeRemaining(value?: string | null) {
  if (!value) return 'No deadline'
  const diff = new Date(value).getTime() - Date.now()
  if (!Number.isFinite(diff) || diff <= 0) return 'Expired'
  const hours = Math.floor(diff / (60 * 60 * 1000))
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000))
  return `${hours}h ${minutes}m left`
}

function statusLabel(status?: string | null) {
  if (!status) return 'Unknown'
  return STATUS_LABELS[status] || status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-2xl bg-slate-200/70', className)} />
}

function TableSkeleton({ columns = 9, rows = 10 }: { columns?: number; rows?: number }) {
  return (
    <div className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
      <div className="border-b border-slate-200 bg-slate-950 px-4 py-3">
        <SkeletonBlock className="h-4 w-44 bg-white/20" />
      </div>
      <div className="space-y-2 p-4">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <SkeletonBlock key={columnIndex} className="h-8" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white/80 p-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white">
        <ClipboardList className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-xl font-black text-slate-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm font-semibold text-slate-500">{description}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em]', STATUS_STYLES[status] || STATUS_STYLES.draft)}>
      {statusLabel(status)}
    </Badge>
  )
}

function BookingMobileCard({
  row,
  onOpen,
}: {
  row: BookingRow
  onOpen: (id: string) => void
}) {
  const router = useRouter()
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" onClick={() => onOpen(row.id)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Booking</p>
          <h3 className="mt-1 text-sm font-black leading-5 text-slate-950">{row.bookingNumber}</h3>
          <p className="mt-1 truncate text-xs font-bold text-slate-600">{row.customerName}</p>
          <p className="text-[11px] font-semibold text-slate-500">{row.customerPhone}</p>
        </div>
        <StatusBadge status={row.proformaNumber ? 'proforma_generated' : row.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Vehicle</p>
          <p className="mt-1 font-black text-slate-900">{row.model || '-'}</p>
          <p className="mt-0.5 break-words font-semibold text-slate-500">{row.variant || '-'}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Consultant</p>
          <p className="mt-1 font-bold text-slate-700">{row.consultantName || '-'}</p>
          <p className="mt-0.5 font-semibold text-slate-500">{formatDate(row.updatedAt)}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">VIN</p>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-600">{row.allocatedVin || '-'}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Finance</p>
          <p className="mt-1 font-bold text-slate-700">{row.financeOrderNumber || '-'}</p>
        </div>
      </div>
      <div className="mt-3" onClick={(event) => event.stopPropagation()}>
        {row.proformaNumber ? (
          <Link
            href={`/brands/kia/proforma/all-proforma-details?search=${row.proformaNumber}`}
            className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-[10px] font-black uppercase tracking-[0.08em] text-indigo-700"
          >
            Proforma Generated
          </Link>
        ) : (
          <Button
            size="sm"
            className="h-9 w-full rounded-xl border-none bg-[#c8102e] px-3 text-[11px] font-black text-white shadow-sm hover:bg-red-700"
            onClick={() => router.push(`/brands/kia/proforma/generate?bookingId=${row.id}`)}
          >
            Generate Proforma
          </Button>
        )}
      </div>
    </article>
  )
}

function Stepper({ status }: { status: string }) {
  const steps = [
    { key: 'booking_created', label: 'Booking' },
    { key: 'proforma_generated', label: 'Proforma' },
    { key: 'vehicle_allocated', label: 'VIN' },
    { key: 'finance_pending', label: 'Finance' },
    { key: 'ready_delivery', label: 'Ready' },
    { key: 'delivered', label: 'Delivered' },
  ]
  const currentIndex = Math.max(0, steps.findIndex((step) => step.key === status))
  return (
    <div className="rounded-[1.75rem] border border-white/80 bg-white/90 p-2 shadow-[0_18px_55px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.03] backdrop-blur">
      <div className="grid gap-2 sm:grid-cols-6">
      {steps.map((step, index) => {
        const active = index <= currentIndex || status === 'delivered'
        const current = index === currentIndex && status !== 'delivered'
        return (
          <div
            key={step.key}
            className={cn(
              'relative overflow-hidden rounded-2xl border px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] transition-all',
              active
                ? 'border-slate-900 bg-slate-950 text-white shadow-sm'
                : 'border-slate-200 bg-slate-50/80 text-slate-400',
              current && 'shadow-[0_12px_30px_rgba(15,23,42,0.16)]'
            )}
          >
            <span className={cn('mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px]', active ? 'bg-white text-slate-950' : 'bg-white text-slate-400')}>
              {index + 1}
            </span>
            <span>{step.label}</span>
          </div>
        )
      })}
      </div>
    </div>
  )
}

const YEARS = ['2026', '2025', '2024', '2023'] as const

const FUEL_TYPES = ['PETROL', 'ELECTRIC', 'DIESEL'] as const

const DEALERS = ['AM KIA', 'JK402', 'JK501'] as const

const COLORS = [
  'SNOW WHITE PEARL',
  'GRAVITY GREY',
  'AURORA BLACK PEARL',
  'GLACIER WHITE PEARL',
  'PEWTER OLIVE',
  'INTENSE RED (B) WITH AURORA BLACK PEARL (R)',
  'IMPERIAL BLUE',
  'CLEAR WHITE',
  'FROST BLUE',
  'FUSION BLACK',
  'INTENSE RED',
  'SPARKLING SILVER',
  'MATTE GRAPHITE',
  'Metalic',
  'Two Tone',
  'Morning Haze',
  'Magma Red',
  'Forst Blue',
  'Ivory Silver gloss',
  'Piter olive',
  'Imperial blue',
  'Gravity grey',
  'Aurora black pearl',
  'Glacier white pearl',
  'Mattee Graphite'
] as const

const CONSULTANTS = [
  'OTHER DEALER',
  'SUNAKSHIT',
  'Arun Sharma',
  'ANAM SINGH',
  'AKHASH BHATT',
  'SHUBHAM',
  'JK501',
  'ASHISH KUMAR',
  'RAMANTHAN',
  'RAHUL GAUTAM',
  'GULSHAN KUMAR',
  'SANJAY KUMAR',
  'DILDAR SINGH',
  'RONIT',
  'NEERAJ',
  'ANSH',
  'JATINDER SINGH',
  'SAGAR'
] as const

const MANAGERS = ['SANJEEV KOUL'] as const

const TLS = [
  'MICHAEL DEEP SINGH',
  'Naval preet Singh',
  'UDHAMPUR',
  'OTHER DEALER',
  'SHIV DEV SINGH'
] as const

const LEAD_SOURCES = [
  'WALK IN',
  'HYPERLOCAL',
  'SOCIAL MEDIA',
  'REFERENCE',
  'FIELD GENERATION',
  'CALL IN'
] as const

const STOCK_STATUSES = ['NOT IN STOCK', 'IN STOCK'] as const

const BANKS = [
  'AU BANK',
  'AXIS BANK',
  'BAJAJ FINANCE',
  'BANK OF BARODA',
  'BANK OF INDIA',
  'CANARA BANK',
  'CAPITAL SMALL FINANCE BANK',
  'CASH',
  'CENTRAL BANK OF INDIA',
  'CHOLA MANDALAM',
  'HDFC BANK',
  'ICICI BANK',
  'IDBI BANK',
  'INDIAN BANK',
  'INDIAN OIL CORP',
  'INDUSIND BANK',
  'Indian Overseas Bank',
  'JK BANK',
  'JK GRAMEEN BANK',
  'KOTAK MAHINDRA',
  'LIC OF INDIA',
  'M&M',
  'Punjab & Sind Bank',
  'PNB BANK',
  'SBI',
  'SRI RAM',
  'UCO',
  'UNION BANK OF INDIA',
  'YES BANK',
  'OTHERS'
] as const

const VARIANTS = Array.from(new Set([
  "Carens D1.5 6AT Luxury Plus 7",
  "Carens D1.5 6MT Gravity",
  "Carens D1.5 6MT MDrive7",
  "Carens D1.5 6MT Premium (O) 7",
  "Carens G1.5 6MT Gravity",
  "Carens G1.5 6MT MDrive7",
  "Carens G1.5 6MT Premium (O) 7",
  "Carens G1.5 6MT Prestige (O) 7",
  "EV6 GT-Line AWD",
  "Kia Carnival D2.2 8AT Limousine Plus-",
  "Seltos GRAVITY 1.5 Petrol- New",
  "Seltos GTX Plus AT 1.5 Diesel- New",
  "Seltos GTX Plus DCT 1.5T Petrol- New",
  "Seltos HTE (O) 1.5 Diesel- New",
  "Seltos HTE (O) 1.5 Petrol- New",
  "Seltos HTK (O) 1.5 Diesel- New",
  "Seltos HTK (O) 1.5 Petrol- New",
  "Seltos HTK 1.5 Diesel- New",
  "Seltos HTK Plus (O) 1.5 Diesel- New",
  "Seltos HTK Plus (O) 1.5 Petrol- New",
  "Seltos HTK Plus 1.5 Diesel- New",
  "Seltos HTX (O) 1.5 Petrol- New",
  "Seltos HTX (O) IVT 1.5 Petrol- New",
  "Seltos HTX 1.5 Petrol- New",
  "Seltos HTX AT 1.5 Diesel- New",
  "Seltos HTX IVT 1.5 Petrol- New",
  "Seltos X Line AT 1.5 Diesel - New",
  "Sonet D1.5 6AT HTX",
  "Sonet D1.5 6MT HTK (O)",
  "Sonet D1.5 6MT HTK+(O)",
  "Sonet D1.5 6MT HTX",
  "Sonet G1.0T 7DCT GTX Plus",
  "Sonet G1.0T 7DCT HTX",
  "Sonet G1.2 5MT Gravity",
  "Sonet G1.2 5MT HTE (O)",
  "Sonet G1.2 5MT HTK",
  "Sonet G1.2 5MT HTK (O)",
  "Sonet G1.2 5MT HTK+(O)",
  "Syros D1.5 6MT HTK Plus",
  "Syros D1.5 6MT HTK(O)",
  "Syros G1.0T 6MT HTK",
  "Syros G1.0T 6MT HTK Plus",
  "Syros G1.0T 6MT HTK(O)",
  "Syros G1.0T 6MT HTX",
  "Syros G1.0T 7DCT HTK Plus",
  "Syros G1.0T 7DCT HTX Plus",
  "Syros G1.0T 7DCT HTX Plus(O)",
  "Syros G1.0 HTX DCT",
  "Syros D1.5 HTX",
  "Syros HTX Plus DCT",
  "Syros HTX Plus (O) DCT",
  "Carens G1.5 Premium 7",
  "Carens D1.5 Premium 7",
  "Carens G1.5 Premium 7 IMT",
  "Carens G1.5 Gravity IMT",
  "Carens G1.5 Prestige (O) 6",
  "Carens G1.5 Premium (O) 7 IMT",
  "Carens D1.5 Prestige 7",
  "Carens G1.5 Prestige Plus 7 IMT",
  "Carens D1.5 Prestige Plus 7",
  "Carens G1.5 Prestige Plus (O)",
  "Carens D1.5 Prestige Plus (O)",
  "Carens G1.5 7DCT Prestige Plus (O)",
  "Carens D1.5 AT Prestige Plus (O)",
  "Carens G1.5 7DCT X-line 6",
  "Carens G1.5 7CT X-Line 7",
  "Seltos G1.5 HTK- New",
  "Seltos G1.5 IVT HTK Plus (O)- New",
  "Seltos G1.5 T DCT X line- New",
  "Seltos G1.5 IMT HTK Plus- New",
  "Seltos D1.5 AT HTK Plus (O)- New",
  "Seltos D1.5 HTX- New",
  "Seltos D1.5 HTX (O)- New",
  "Sonet D1.5 HTE (O)",
  "Sonet D1.5 6AT GTX Plus",
  "Sonet G1.02HTE",
  "Sonet G1.0T IMT HTK",
  "Sonet G1.0T IMT HTK (O)",
  "Sonet G1.0T IMT HTK Plus (O)",
  "Sonet G1.0T IMT HTX",
  "Sonet G1.0T 7DCT X Line",
  "Carens Clavis G1.5 6MT HTE 7",
  "Carens Clavis G1.5 6MT HTM 7",
  "Carens Clavis G1.5 6MT HTE(O)7",
  "Carens ClavisG1.5T 6MT HTE(O)7",
  "Carens Clavis G1.5 6MT HTK 7",
  "Carens Clavis G1.5T 6MT HTK 7",
  "Carens ClavisG1.5T 6MT HTK Plus 7",
  "Carens ClavisG1.5T6MT HTK Plus (O)7",
  "Carens Clavis G1.5T DCT HTK Plus 7",
  "Carens ClavisG1.5T DCT HTK Plus (O)7",
  "Carens Clavis G1.5T 6MT HTX 7",
  "Carens Clavis G1.5T iMT HTX 7",
  "Carens ClavisG1.5T 6MT HTX Plus 6",
  "Carens ClavisG1.5T 6MT HTX Plus 7",
  "Carens Clavis G1.5TiMT HTX Plus 6",
  "Carens Clavis G1.5T Imt HTX Plus 7",
  "Carens Clavis G1.5T DCT HTX Plus 6",
  "Carens Clavis G1.5T DCT HTX Plus 7",
  "Carens Clavis D1.5 6MT HTE7",
  "Carens Clavis D1.5 6MT HTM 7",
  "Carens Clavis D1.5 6MT HTE(O)7",
  "Carens Clavis D1.5 6MT HTK 7",
  "Carens ClavisD1.5 6MT HTK Plus 7",
  "Carens ClavisD1.5 6MTHTK Plus (O)7",
  "Carens ClavisD1.5 6AT HTK Plus 7",
  "Carens Clavis D1.5 6MT HTX 7",
  "Seltos HTX (O) IVT PETROL-New",
  "Sonet HTK Plus petrol",
  "Sonet HTK Plus Diesel",
  "Seltos D1.5 6MT HTE",
  "Seltos D1.5 6MT HTK",
  "Seltos D1.5 6AT HTE (O)",
  "Seltos D1.5 6MT HTK (O)",
  "Seltos D1.5 6AT HTK",
  "Seltos D1.5 6AT HTK (O)",
  "Seltos D1.5 6MT HTX",
  "Seltos D1.5 6MT HTX (A)",
  "Seltos D1.5 6AT HTX",
  "Seltos D1.5 6AT HTX (A)",
  "Seltos D1.5 6AT X Line",
  "Seltos D1.5 6AT GTX",
  "Seltos D1.5 6AT GTX (A)",
  "Seltos D1.5 6AT X Line (A)",
  "OSeltos D1.5 6MT HTE",
  "Seltos D1.5 6MT HTE (O)",
  "Seltos D1.5 6AT HTX (A)",
  "Seltos G1.5 6MT HTE",
  "Seltos G1.5 6MT HTE (O)",
  "Seltos G1.5T iMT HTE (O)",
  "Seltos G1.5 6MT HTK",
  "Seltos G1.5 IVT HTE (O)",
  "Seltos G1.5T iMT HTK",
  "Seltos G1.5 6MT HTK (O)",
  "Seltos G1.5 IVT HTK",
  "Seltos G1.5T iMT HTK (O)",
  "Seltos G1.5 IVT HTK (O)",
  "Seltos G1.5 6MT HTX",
  "Seltos G1.5T 7DCT HTK (O)",
  "Seltos G1.5 6MT HTX (A)",
  "Seltos G1.5 IVT HTX",
  "Seltos G1.5T 7DCT HTX",
  "Seltos G1.5 IVT HTX (A)",
  "Seltos G1.5 IVT X Line",
  "Seltos G1.5 IVT GTX",
  "Seltos G1.5T 7DCT HTX (A)",
  "Seltos G1.5T 7DCT GTX",
  "Seltos G1.5T 7DCT X Line",
  "Seltos G1.5 IVT GTX (A)",
  "Seltos G1.5 IVT X Line (A)",
  "Seltos G1.5T 7DCT X Line (A)",
  "Option 139",
  "Option 140",
  "Option 141",
  "Seltos D1.5 6MT HTE (O)",
  "Seltos D1.5 6MT HTK",
  "Seltos D1.5 6AT HTE (O)",
  "Seltos D1.5 6MT HTK (O)",
  "Seltos D1.5 6AT HTK",
  "Seltos D1.5 6AT HTK (O)",
  "Seltos D1.5 6MT HTX",
  "Seltos D1.5 6MT HTX (A)",
  "Seltos D1.5 6AT HTX",
  "Seltos D1.5 6AT HTX (A)",
  "Seltos D1.5 6AT X Line",
  "Seltos D1.5 6AT GTX",
  "Option 154",
  "Seltos G1.5 6MT HTE",
  "Seltos G1.5 6MT HTE (O)",
  "Seltos G1.5T iMT HTE (O)",
  "Seltos G1.5 6MT HTK",
  "Seltos G1.5 IVT HTE (O)",
  "Seltos G1.5T 7DCT GTX",
  "Seltos G1.5T 7DCT X Line",
  "Seltos G1.5 IVT GTX (A)",
  "Seltos G1.5 IVT X Line (A)",
  "Seltos G1.5T 7DCT X Line (A)",
  "Seltos G1.5T 7DCT GTX (A)",
  "Option 183"
]))

function SearchableVariantSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (val: string) => void
  options: string[]
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const [openUpwards, setOpenUpwards] = useState(false)

  const selectedDisplay = value === 'OTHER' ? 'Other / Custom' : (value || 'Select Variant...')

  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim()
    const source = options.length > 0 ? options : VARIANTS
    if (!query) return source
    return source.filter((v) => v.toLowerCase().includes(query))
  }, [options, search])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      setOpenUpwards(spaceBelow < 280) // threshold to open upwards
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          INPUT_STYLE,
          "flex w-full items-center justify-between border border-slate-200 px-3 text-left font-semibold text-slate-800"
        )}
      >
        <span className="truncate">{selectedDisplay}</span>
        <span className="ml-2 text-slate-400">▼</span>
      </button>

      {open && (
        <div className={cn(
          "absolute left-0 z-50 w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl",
          openUpwards ? "bottom-full mb-1.5" : "top-full mt-1.5"
        )}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search variant..."
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
            autoFocus
          />
          <div className="mt-2 max-h-56 overflow-y-auto space-y-0.5 pr-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs font-medium text-slate-400">No variants found</p>
            ) : (
              filtered.map((variant) => (
                <button
                  key={variant}
                  type="button"
                  onClick={() => {
                    onChange(variant)
                    setOpen(false)
                    setSearch('')
                  }}
                  className={cn(
                    "w-full rounded-lg px-3 py-1.5 text-left text-xs font-bold transition-colors hover:bg-slate-100",
                    value === variant ? "bg-slate-50 text-slate-950" : "text-slate-700"
                  )}
                >
                  {variant}
                </button>
              ))
            )}
            <div className="border-t border-slate-100 my-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  onChange('OTHER')
                  setOpen(false)
                  setSearch('')
                }}
                className={cn(
                  "w-full rounded-lg px-3 py-1.5 text-left text-xs font-black transition-colors hover:bg-slate-100 text-indigo-700 hover:text-indigo-800",
                  value === 'OTHER' ? "bg-indigo-50" : ""
                )}
              >
                + Other / Custom Variant
              </button>
            </div>
          </div>
        </div>
      )}

      {value && !filtered.includes(value) && (
        <Input
          value={value === 'OTHER' ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type custom variant..."
          className={cn(INPUT_STYLE, 'mt-2')}
          required
        />
      )}
    </div>
  )
}

function initialCreateForm(): CreateBookingForm {
  return {
    customerName: '',
    countryCode: '91',
    customerPhone: '',
    customerEmailId: '',
    model: '',
    year: '2026',
    fuelType: 'PETROL',
    variant: '',
    bankFinance: '',
    bookingAmount: '',
    bookingDate: new Date().toISOString().split('T')[0],
    pmtSource: '',
    paymentAmount: '',
    managerName: 'SANJEEV KOUL',
    tlName: '',
    consultantName: '',
    color: '',
    leadSource: '',
    status: 'NOT IN STOCK',
    expectedDeliveryDate: '',
    commitment: '',
    otherDealerDetails: '',
    promiseDate: '',
    costSheet: '',
    paymentReceived: '',
    waitingPeriod: '',
    dealerCode: 'AM KIA',
    notes: '',
  }
}

export function KiaBookingsClient({
  initialSearchParams,
  embedMode = false,
  currentUserRole = 'viewer',
  mode = 'crm',
}: {
  initialSearchParams: SearchParamsInput
  embedMode?: boolean
  currentUserRole?: string
  mode?: BookingClientMode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState(firstParam(initialSearchParams, 'search'))
  const [dealer, setDealer] = useState(firstParam(initialSearchParams, 'dealer_code', ALL_VALUE))
  const [model, setModel] = useState(firstParam(initialSearchParams, 'model', ALL_VALUE))
  const [status, setStatus] = useState(firstParam(initialSearchParams, 'status', ALL_VALUE))
  const [consultant, setConsultant] = useState(firstParam(initialSearchParams, 'consultant', ALL_VALUE))
  const [page, setPage] = useState(Number(firstParam(initialSearchParams, 'page', '1')) || 1)
  const [createOpen, setCreateOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [allotDialogVehicle, setAllotDialogVehicle] = useState<MatchingVehicle | null>(null)
  const [transferTarget, setTransferTarget] = useState<{
    vinNumber: string
    model: string
    variant: string
    color?: string | null
    stockAge?: number | null
    dealerCode?: string | null
  } | null>(null)
  const [transferToDealerCode, setTransferToDealerCode] = useState('')
  const [transferReferenceName, setTransferReferenceName] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentInvoiceFile, setPaymentInvoiceFile] = useState<File | null>(null)
  const [createTab, setCreateTab] = useState<(typeof CREATE_TABS)[number]>('Customer')
  const [createForm, setCreateForm] = useState<CreateBookingForm>(() => initialCreateForm())
  const [formError, setFormError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [testPersona, setTestPersona] = useState<TestPersona>('actual')
  const canUseTestPersona = currentUserRole === 'super_admin'
  const normalizedCurrentRole = normalizeRole(currentUserRole)
  const canCreateBookings = roleCanActAsSalesPerson(normalizedCurrentRole)
  const stockMode = mode === 'stock'

  const selectedBookingId = searchParams.get('bookingId') || ''

  useEffect(() => {
    const query = buildQueryString({ search, dealer_code: dealer, model, status, consultant, page })
    const next = new URLSearchParams(query)
    if (selectedBookingId && embedMode) next.set('bookingId', selectedBookingId)
    const nextSearch = next.toString() ? `?${next.toString()}` : ''
    const currentSearch = typeof window !== 'undefined' ? window.location.search : ''
    if (nextSearch !== currentSearch) {
      router.replace(`${pathname}${nextSearch}`, { scroll: false })
    }
  }, [pathname, consultant, dealer, model, page, router, search, selectedBookingId, status, embedMode])

  const listQueryString = useMemo(() => buildQueryString({
    search,
    dealer_code: dealer,
    model,
    status,
    consultant,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  }), [consultant, dealer, model, page, search, status])

  const listQuery = useQuery({
    queryKey: ['kia-bookings', listQueryString],
    queryFn: () => fetchJson<BookingListPayload>(`/api/brands/kia/bookings?${listQueryString}`, 'kia-bookings-list'),
    retry: 2,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })

  const detailQuery = useQuery({
    queryKey: ['kia-booking-detail', selectedBookingId],
    queryFn: () => fetchJson<BookingDetailPayload>(`/api/brands/kia/bookings/${selectedBookingId}`, 'kia-booking-detail'),
    enabled: Boolean(selectedBookingId),
    retry: 2,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })

  const matchingQuery = useQuery({
    queryKey: ['kia-booking-matching-vehicles', selectedBookingId],
    queryFn: () => fetchJson<MatchingVehiclesPayload>(`/api/brands/kia/bookings/${selectedBookingId}/matching-vehicles`, 'kia-booking-matching-vehicles'),
    enabled: Boolean(selectedBookingId) && detailQuery.data?.proforma?.status === 'APPROVED',
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const proformaOptionsQuery = useQuery({
    queryKey: ['kia-proforma-options-for-bookings'],
    queryFn: () => fetchJson<ProformaOptionsPayload>('/api/brands/kia/proforma/options?lite=1', 'kia-proforma-options'),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })

  const createMutation = useMutation({
    mutationFn: (payload: CreateBookingForm) => fetchJson<{ id: string }>('/api/brands/kia/bookings', 'kia-booking-create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    onSuccess: (created) => {
      setCreateOpen(false)
      setCreateForm(initialCreateForm())
      setCreateTab('Customer')
      setActionMessage(`Booking ${created.id ? 'created' : 'saved'} successfully. Open it from the table when you are ready for the next stage.`)
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
    },
  })

  const actionMutation = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string; body?: Record<string, string> }) => fetchJson<{ ok: boolean }>(endpoint, 'kia-booking-action', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
    onSuccess: () => {
      setActionMessage('Action completed and timeline refreshed.')
      setAllotDialogVehicle(null)
      setTransferTarget(null)
      setTransferToDealerCode('')
      setTransferReferenceName('')
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', selectedBookingId] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-matching-vehicles', selectedBookingId] })
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : 'Action failed'),
  })

  const paymentMutation = useMutation({
    mutationFn: async ({ bookingId, reference, invoiceFile }: { bookingId: string; reference: string; invoiceFile: File | null }) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)
      try {
        const formData = new FormData()
        if (reference.trim()) formData.append('reference', reference.trim())
        if (invoiceFile) formData.append('invoice', invoiceFile)
        const response = await fetch(`/api/brands/kia/bookings/${bookingId}/payment`, {
          method: 'POST',
          body: formData,
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string; reason?: string } | null
          throw new Error(payload?.error || payload?.reason || 'Failed to confirm payment')
        }
        return await response.json() as { ok: boolean }
      } finally {
        clearTimeout(timeout)
      }
    },
    onSuccess: () => {
      setPaymentDialogOpen(false)
      setPaymentReference('')
      setPaymentInvoiceFile(null)
      setActionMessage('Payment confirmed and delivery stage unlocked.')
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', selectedBookingId] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-matching-vehicles', selectedBookingId] })
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : 'Payment confirmation failed'),
  })

  const statusMutation = useMutation({
    mutationFn: (newStatus: string) => fetchJson<{ ok: boolean }>(`/api/brands/kia/bookings/${selectedBookingId}`, 'kia-booking-update-status', {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    }),
    onSuccess: () => {
      setActionMessage('Status updated successfully and timeline refreshed.')
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', selectedBookingId] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-matching-vehicles', selectedBookingId] })
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : 'Status update failed'),
  })

  const [generatingId, setGeneratingId] = useState<string | null>(null)

  const rowActionMutation = useMutation({
    mutationFn: ({ bookingId }: { bookingId: string }) => {
      setGeneratingId(bookingId)
      return fetchJson<{ ok: boolean }>(`/api/brands/kia/bookings/${bookingId}/proforma`, 'kia-booking-action', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
    onSuccess: () => {
      alert('Proforma generated successfully!')
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : 'Failed to generate proforma')
    },
    onSettled: () => {
      setGeneratingId(null)
    },
  })

  const data = listQuery.data
  const priceModels = proformaOptionsQuery.data?.models || []
  const priceTrims = useMemo(() => proformaOptionsQuery.data?.trims || [], [proformaOptionsQuery.data?.trims])
  const rows = data?.rows || []
  const filters = data?.filters || { dealers: ['JK402', 'JK501'], models: [], statuses: Object.keys(STATUS_LABELS), consultants: [] }
  const bookingModelOptions = priceModels.length > 0 ? priceModels : filters.models
  const bookingVariantOptions = useMemo(() => {
    const modelValue = createForm.model.trim()
    return Array.from(new Set(priceTrims
      .filter((trim) => !modelValue || trim.model === modelValue)
      .map((trim) => trim.trim_description)
      .filter(Boolean)))
  }, [createForm.model, priceTrims])
  const kpis = data?.kpis || {
    today: 0,
    pendingProforma: 0,
    waitingAllocation: 0,
    financePending: 0,
    readyDelivery: 0,
    delivered: 0,
    cancelled: 0,
  }

  useEffect(() => {
    rows.slice(0, 8).forEach((row) => {
      queryClient.prefetchQuery({
        queryKey: ['kia-booking-detail', row.id],
        queryFn: () => fetchJson<BookingDetailPayload>(`/api/brands/kia/bookings/${row.id}`, 'kia-booking-detail'),
        staleTime: 10_000,
      })
    })
  }, [queryClient, rows])

  function openBooking(id: string) {
    if (embedMode) {
      const next = new URLSearchParams(searchParams.toString())
      next.set('bookingId', id)
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    } else {
      router.push(`${pathname}/${id}`)
    }
  }

  function closeBooking() {
    if (embedMode) {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('bookingId')
      router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false })
    } else {
      router.push(pathname)
    }
    setActionMessage('')
  }

  function updateCreateForm<K extends keyof CreateBookingForm>(key: K, value: CreateBookingForm[K]) {
    setCreateForm((current) => ({ ...current, [key]: value }))
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    const requiredFields: Array<[keyof CreateBookingForm, string]> = [
      ['customerName', 'Customer Name'],
      ['countryCode', 'Country Code'],
      ['customerPhone', 'Mobile number'],
      ['customerEmailId', 'Customer Email Id'],
      ['model', 'Model'],
      ['year', 'YEAR'],
      ['variant', 'Variant'],
      ['consultantName', 'Consultant Name'],
    ]
    const missing = requiredFields.find(([key]) => !createForm[key]?.trim())
    if (missing) {
      setFormError(`${missing[1]} is required.`)
      const tabByField: Record<keyof CreateBookingForm, (typeof CREATE_TABS)[number]> = {
        customerName: 'Customer',
        countryCode: 'Customer',
        customerPhone: 'Customer',
        customerEmailId: 'Customer',
        model: 'Vehicle',
        variant: 'Vehicle',
        year: 'Vehicle',
        fuelType: 'Vehicle',
        color: 'Vehicle',
        status: 'Vehicle',
        waitingPeriod: 'Vehicle',
        managerName: 'Sales Team',
        tlName: 'Sales Team',
        consultantName: 'Sales Team',
        leadSource: 'Sales Team',
        bookingAmount: 'Payment',
        bookingDate: 'Payment',
        pmtSource: 'Payment',
        paymentAmount: 'Payment',
        paymentReceived: 'Payment',
        costSheet: 'Payment',
        bankFinance: 'Payment',
        expectedDeliveryDate: 'Delivery',
        promiseDate: 'Delivery',
        commitment: 'Delivery',
        otherDealerDetails: 'Delivery',
        dealerCode: 'Customer',
        notes: 'Delivery',
      }
      setCreateTab(tabByField[missing[0]] || 'Customer')
      return
    }
    createMutation.mutate(createForm)
  }

  function runAction(action: 'proforma' | 'finance' | 'payment' | 'release' | 'deliver' | 'cancel' | 'transfer') {
    if (!selectedBookingId) return
    if (action === 'proforma') {
      router.push(`/brands/kia/proforma/generate?bookingId=${selectedBookingId}`)
      return
    }
    if (action === 'payment') {
      setPaymentDialogOpen(true)
      return
    }
    if (action === 'release' && !window.confirm('Release this VIN allocation? The vehicle will become matchable again.')) return
    if (action === 'deliver' && !window.confirm('Mark this booking as delivered? This is a final delivery action.')) return
    if (action === 'cancel' && !window.confirm('Cancel this booking?')) return
    if (action === 'transfer') {
      if (!detailQuery.data) return
      setTransferTarget({
        vinNumber: detailQuery.data.allocation?.vinNumber || detailQuery.data.booking.allocatedVin || '',
        model: detailQuery.data.allocation?.model || detailQuery.data.booking.model || '',
        variant: detailQuery.data.allocation?.variant || detailQuery.data.booking.variant || '',
        color: detailQuery.data.allocation?.color || detailQuery.data.booking.colorPreference || '',
        dealerCode: detailQuery.data.allocation?.dealerCode || detailQuery.data.booking.dealerCode || '',
      })
      setTransferToDealerCode(detailQuery.data.booking.dealerCode || '')
      setTransferReferenceName('')
      return
    }
    actionMutation.mutate({ endpoint: `/api/brands/kia/bookings/${selectedBookingId}/${action}` })
  }

  function openTransferDialog(vehicle?: MatchingVehicle | null) {
    if (!detailQuery.data) return
    setTransferTarget({
      vinNumber: vehicle?.vinNumber || detailQuery.data.allocation?.vinNumber || detailQuery.data.booking.allocatedVin || '',
      model: vehicle?.model || detailQuery.data.allocation?.model || detailQuery.data.booking.model || '',
      variant: vehicle?.variant || detailQuery.data.allocation?.variant || detailQuery.data.booking.variant || '',
      color: vehicle?.color || detailQuery.data.allocation?.color || detailQuery.data.booking.colorPreference || '',
      stockAge: vehicle?.stockAge ?? null,
      dealerCode: vehicle?.dealerCode || detailQuery.data.allocation?.dealerCode || detailQuery.data.booking.dealerCode || '',
    })
    setTransferToDealerCode(detailQuery.data.booking.dealerCode || '')
    setTransferReferenceName('')
  }

  function confirmTransfer() {
    if (!selectedBookingId || !transferTarget || !transferToDealerCode) return
    actionMutation.mutate({
      endpoint: `/api/brands/kia/bookings/${selectedBookingId}/transfer`,
      body: {
        toDealerCode: transferToDealerCode,
        notes: transferReferenceName,
        vinNumber: transferTarget.vinNumber,
      },
    })
  }

  function allotVehicle(vinNumber: string) {
    if (!selectedBookingId) return
    const vehicle = matchingQuery.data?.rows.find((row) => row.vinNumber === vinNumber) || null
    if (vehicle) {
      setAllotDialogVehicle(vehicle)
      return
    }
    actionMutation.mutate({
      endpoint: `/api/brands/kia/bookings/${selectedBookingId}/allot`,
      body: { vinNumber },
    })
  }

  function confirmAllot() {
    if (!selectedBookingId || !allotDialogVehicle) return
    actionMutation.mutate({
      endpoint: `/api/brands/kia/bookings/${selectedBookingId}/allot`,
      body: { vinNumber: allotDialogVehicle.vinNumber },
    })
  }

  function markPaymentNotReceived() {
    if (!selectedBookingId) return
    actionMutation.mutate({
      endpoint: `/api/brands/kia/bookings/${selectedBookingId}/release`,
      body: { reason: 'Payment not received within reservation window' },
    })
  }

  function confirmPayment() {
    if (!selectedBookingId) return
    paymentMutation.mutate({
      bookingId: selectedBookingId,
      reference: paymentReference,
      invoiceFile: paymentInvoiceFile,
    })
  }

  const currentHeading = stockMode
    ? {
        badge: 'AM Kia Stock',
        title: 'Stock',
        subtitle: 'Approved bookings, VIN reservation windows, transfer requests, and accounts payment follow-up.',
      }
    : {
        badge: 'AM Kia Sales',
        title: 'Bookings CRM',
        subtitle: 'Booking creation, proforma generation, VIN allocation, finance draft, delivery readiness, and full timeline audit in one workspace.',
      }

  const currentEmptyState = stockMode
    ? {
        title: 'No stock-stage bookings found',
        description: 'Approved bookings and active allocations will appear here once the sales and approval stages move forward.',
      }
    : {
        title: 'No bookings found',
        description: 'Create a booking or adjust filters to see the customer journey table.',
      }

  const stockSectionHint = stockMode
    ? 'Choose an approved booking, then allot a VIN or initiate a transfer. Payment confirmation remains accounts-owned.'
    : null

  const content = (
    <>
      <div className="space-y-5">
        <section className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
          <div className="bg-gradient-to-br from-white via-slate-50 to-sky-50 p-3 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              {!embedMode ? (
                <div>
                  <Badge variant="outline" className="rounded-full border-sky-100 bg-sky-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-sky-700 sm:px-4 sm:text-xs">
                    {currentHeading.badge}
                  </Badge>
                  <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:mt-4 sm:text-4xl">{currentHeading.title}</h1>
                  <p className="mt-2 max-w-3xl text-xs font-semibold leading-5 text-slate-600 sm:text-sm sm:leading-6">
                    {currentHeading.subtitle}
                  </p>
                </div>
              ) : (
                <div>
                  <Badge variant="outline" className="rounded-full border-sky-100 bg-sky-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-sky-700 sm:px-4 sm:text-xs">
                    {currentHeading.badge}
                  </Badge>
                </div>
              )}
              <div className="grid gap-2 sm:flex sm:flex-wrap sm:gap-3">
                {canCreateBookings && !stockMode && (
                  <>
                    <Button className="h-10 rounded-2xl bg-slate-950 px-4 text-xs font-black text-white hover:bg-slate-800 sm:h-11 sm:px-5 sm:text-sm" onClick={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4" /> New Booking
                    </Button>
                    <Button variant="outline" className="h-10 rounded-2xl border-slate-200 bg-white px-4 text-xs font-black text-slate-800 shadow-sm hover:bg-slate-50 sm:h-11 sm:px-5 sm:text-sm" onClick={() => setQuoteOpen(true)}>
                      <FileText className="mr-2 h-4 w-4" /> Email Quote
                    </Button>
                  </>
                )}
                <Button variant="outline" className="h-10 rounded-2xl bg-white px-4 text-xs font-black sm:h-11 sm:px-5 sm:text-sm" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
                  <RefreshCw className={cn('h-4 w-4', listQuery.isFetching && 'animate-spin')} /> Refresh
                </Button>
              </div>
            </div>
            {canUseTestPersona && (
              <div className="mt-4 rounded-3xl border border-slate-200 bg-white/85 p-3 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Super Admin Test Mode</p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">Switch the visible workflow controls to rehearse each KIA booking stage before release.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    {(Object.keys(TEST_PERSONA_LABELS) as TestPersona[]).map((persona) => (
                      <Button
                        key={persona}
                        type="button"
                        variant={testPersona === persona ? 'default' : 'outline'}
                        className={cn(
                          'h-9 rounded-2xl px-3 text-[11px] font-black sm:px-4',
                          testPersona === persona
                            ? 'bg-slate-950 text-white hover:bg-slate-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        )}
                        onClick={() => setTestPersona(persona)}
                      >
                        {TEST_PERSONA_LABELS[persona]}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {actionMessage && !selectedBookingId && (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            {actionMessage}
          </div>
        )}

        {stockSectionHint && (
          <div className="rounded-3xl border border-sky-100 bg-white px-4 py-3 text-sm font-bold text-sky-900 shadow-sm">
            {stockSectionHint}
          </div>
        )}

        <section className={cn(PRIMARY_SURFACE, 'sticky top-2 z-20 p-3 sm:top-3 sm:p-4')}>
          <div className="grid gap-2 sm:gap-3 lg:grid-cols-[1.4fr_repeat(4,minmax(0,0.8fr))_auto]">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search booking, customer, phone, VIN..." className={cn(INPUT_STYLE, 'pl-11')} />
            </div>
            <FilterSelect value={dealer} placeholder="Dealer" values={filters.dealers} onChange={(value) => { setDealer(value); setPage(1) }} />
            <FilterSelect value={model} placeholder="Model" values={filters.models} onChange={(value) => { setModel(value); setPage(1) }} />
            <FilterSelect value={status} placeholder="Status" values={filters.statuses} onChange={(value) => { setStatus(value); setPage(1) }} labeler={statusLabel} />
            <FilterSelect value={consultant} placeholder="Consultant" values={filters.consultants} onChange={(value) => { setConsultant(value); setPage(1) }} />
            <Button variant="outline" className="h-10 rounded-2xl bg-white text-xs font-black sm:h-11 sm:text-sm" onClick={() => { setSearch(''); setDealer(ALL_VALUE); setModel(ALL_VALUE); setStatus(ALL_VALUE); setConsultant(ALL_VALUE); setPage(1) }}>
              Clear
            </Button>
          </div>
        </section>

        {listQuery.isLoading ? (
          <TableSkeleton columns={9} />
        ) : listQuery.isError ? (
          <EmptyState
            title="Unable to load bookings"
            description={listQuery.error instanceof Error ? listQuery.error.message : 'The bookings request failed. Refresh to retry or check the server logs if it repeats.'}
          />
        ) : rows.length === 0 ? (
          <EmptyState title={currentEmptyState.title} description={currentEmptyState.description} />
        ) : (
          <section className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60">Bookings Pipeline</p>
                <h2 className="text-base font-black">{data?.total || 0} records</h2>
              </div>
              {listQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-white/70" />}
            </div>
            <div className="grid gap-3 p-3 sm:hidden">
              {rows.map((row) => (
                <BookingMobileCard key={row.id} row={row} onOpen={openBooking} />
              ))}
            </div>
            <Table className="hidden sm:table">
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  {['Booking', 'Customer', 'Vehicle', 'Consultant', 'Status', 'Finance', 'VIN', 'Updated', 'Action'].map((head) => (
                    <TableHead key={head} className="h-9 px-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{head}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer bg-white text-sm hover:bg-slate-50" onClick={() => openBooking(row.id)}>
                    <TableCell className="px-3 py-3 text-xs font-black leading-5 text-slate-950">{row.bookingNumber}</TableCell>
                    <TableCell className="px-3 py-3">
                      <div className="text-sm font-black leading-5 text-slate-900">{row.customerName}</div>
                      <div className="text-[11px] font-semibold text-slate-500">{row.customerPhone}</div>
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <div className="text-sm font-bold leading-5 text-slate-900">{row.model}</div>
                      <div className="max-w-[220px] truncate text-[11px] text-slate-500">{row.variant}</div>
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs font-semibold text-slate-600">{row.consultantName}</TableCell>
                    <TableCell className="px-3 py-3"><StatusBadge status={row.proformaNumber ? 'proforma_generated' : row.status} /></TableCell>
                    <TableCell className="px-3 py-3 text-xs font-semibold text-slate-600">{row.financeOrderNumber || '-'}</TableCell>
                    <TableCell className="px-3 py-3 font-mono text-[11px] text-slate-600">{row.allocatedVin || '-'}</TableCell>
                    <TableCell className="px-3 py-3 text-xs font-semibold text-slate-500">{formatDate(row.updatedAt)}</TableCell>
                    <TableCell className="px-3 py-3 text-xs font-semibold text-slate-600" onClick={(e) => e.stopPropagation()}>
                      {row.proformaNumber ? (
                        <Link
                          href={`/brands/kia/proforma/all-proforma-details?search=${row.proformaNumber}`}
                          className="inline-flex h-8 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-[10px] font-black uppercase tracking-[0.08em] text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800"
                        >
                          {stockMode ? 'OPEN STOCK STAGE' : 'PROFORMA GENERATED'}
                        </Link>
                      ) : canCreateBookings ? (
                        <Button
                          size="sm"
                          className="h-8 rounded-xl border-none bg-[#c8102e] px-3 text-[11px] font-black text-white shadow-sm hover:bg-red-700"
                          onClick={() => {
                            router.push(`/brands/kia/proforma/generate?bookingId=${row.id}`)
                          }}
                        >
                          Generate Proforma
                        </Button>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-400">Awaiting sales action</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold text-slate-500">Page {data?.page || page} of {data?.totalPages || 1}</p>
              <div className="flex gap-2">
                <Button variant="outline" className="h-9 rounded-2xl bg-white text-xs font-black" disabled={page <= 1 || listQuery.isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
                <Button variant="outline" className="h-9 rounded-2xl bg-white text-xs font-black" disabled={page >= (data?.totalPages || 1) || listQuery.isFetching} onClick={() => setPage((current) => current + 1)}>Next</Button>
              </div>
            </div>
          </section>
        )}
      </div>

      <CreateBookingDialog
        open={createOpen}
        form={createForm}
        activeTab={createTab}
        modelOptions={bookingModelOptions}
        variantOptions={bookingVariantOptions}
        masterLoading={proformaOptionsQuery.isLoading}
        error={formError || (createMutation.error instanceof Error ? createMutation.error.message : '')}
        isSubmitting={createMutation.isPending}
        onOpenChange={setCreateOpen}
        onTabChange={setCreateTab}
        onChange={updateCreateForm}
        onSubmit={submitCreate}
      />

      <EmailQuoteDialog
        open={quoteOpen}
        onOpenChange={setQuoteOpen}
        modelOptions={bookingModelOptions}
        trims={priceTrims}
      />

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-xl overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
          <DialogHeader className="border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,#dcfce7,transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            <Badge variant="outline" className="mb-3 w-fit rounded-full border-emerald-100 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Accounts Confirmation</Badge>
            <DialogTitle className="text-2xl font-black tracking-tight text-slate-950">Confirm Booking Payment</DialogTitle>
            <DialogDescription className="mt-2 text-xs font-semibold leading-5 text-slate-500 sm:text-sm">
              Confirm payment, optionally attach the invoice, and move the booking into delivery-ready state.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            <div>
              <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Payment Reference / UTR</Label>
              <Input className={cn(INPUT_STYLE, 'mt-1.5')} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Optional reference" />
            </div>
            <div>
              <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Invoice Upload</Label>
              <Input className={cn(INPUT_STYLE, 'mt-1.5 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-xs file:font-black file:text-white')} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => setPaymentInvoiceFile(event.target.files?.[0] || null)} />
              <p className="mt-1 text-[11px] font-semibold text-slate-500">Optional. PDF or image invoice is enough for testing and audit.</p>
            </div>
          </div>
          <DialogFooter className="grid gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:flex sm:p-4">
            <Button type="button" variant="outline" className="h-10 rounded-xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 sm:text-sm" onClick={() => setPaymentDialogOpen(false)} disabled={paymentMutation.isPending}>Cancel</Button>
            <Button type="button" className="h-10 rounded-xl bg-slate-950 text-xs font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800 sm:text-sm" onClick={confirmPayment} disabled={paymentMutation.isPending}>
              {paymentMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(allotDialogVehicle)} onOpenChange={(open) => !open && setAllotDialogVehicle(null)}>
        <DialogContent className="max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-5xl overflow-hidden rounded-[1.5rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
          <DialogHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] p-5 sm:p-8">
            <DialogTitle className="text-2xl font-black tracking-tight text-slate-950 sm:text-4xl">Allot this car</DialogTitle>
            <DialogDescription className="mt-2 max-w-4xl text-sm font-semibold leading-7 text-slate-500 sm:text-[17px]">
              Link this VIN to the selected approved booking. Customer details are pulled from the booking and the 72-hour payment clock starts immediately after allotment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 p-5 sm:p-8">
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 px-5 py-4 text-lg font-semibold leading-8 text-slate-800">
              <span className="font-black text-slate-950">{allotDialogVehicle?.model}</span> {allotDialogVehicle?.variant} · {allotDialogVehicle?.color || 'Color NA'} · {allotDialogVehicle?.stockAge || 0} days on lot · {allotDialogVehicle?.vinNumber}
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Booking ID</Label>
                <Input readOnly value={detailQuery.data?.booking.bookingNumber || ''} className={cn(INPUT_STYLE, 'mt-2 bg-slate-50 text-xl tracking-[0.18em]')} />
              </div>
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Customer name (from booking)</Label>
                <Input readOnly value={detailQuery.data?.booking.customerName || ''} className={cn(INPUT_STYLE, 'mt-2 bg-slate-50')} />
              </div>
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Contact number (from booking)</Label>
                <Input readOnly value={detailQuery.data?.booking.customerPhone || ''} className={cn(INPUT_STYLE, 'mt-2 bg-slate-50')} />
              </div>
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Financier</Label>
                <Input readOnly value={detailQuery.data?.booking.bankName || String(((detailQuery.data?.booking.metadata || {}) as Record<string, unknown>).bankFinance || 'Cash / not decided')} className={cn(INPUT_STYLE, 'mt-2 bg-slate-50')} />
              </div>
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Manager</Label>
                <Input readOnly value={String(((detailQuery.data?.booking.metadata || {}) as Record<string, unknown>).managerName || '-')} className={cn(INPUT_STYLE, 'mt-2 bg-slate-50')} />
              </div>
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Team Leader</Label>
                <Input readOnly value={String(((detailQuery.data?.booking.metadata || {}) as Record<string, unknown>).tlName || '-')} className={cn(INPUT_STYLE, 'mt-2 bg-slate-50')} />
              </div>
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Consultant</Label>
                <Input readOnly value={detailQuery.data?.booking.consultantName || '-'} className={cn(INPUT_STYLE, 'mt-2 bg-slate-50')} />
              </div>
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Remarks (optional)</Label>
                <Input readOnly value={String(((detailQuery.data?.booking.metadata || {}) as Record<string, unknown>).commitment || '') || 'Booking details will remain linked in the timeline.'} className={cn(INPUT_STYLE, 'mt-2 bg-slate-50')} />
              </div>
            </div>
          </div>
          <DialogFooter className="grid gap-2 border-t border-slate-100 bg-slate-50 p-4 sm:flex sm:justify-end sm:p-6">
            <Button type="button" variant="outline" className="h-12 rounded-2xl border-slate-200 bg-white px-6 text-base font-black" onClick={() => setAllotDialogVehicle(null)} disabled={actionMutation.isPending}>Cancel</Button>
            <Button type="button" className="h-12 rounded-2xl bg-slate-950 px-6 text-base font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800" onClick={confirmAllot} disabled={actionMutation.isPending}>
              {actionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Allot car
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(transferTarget)} onOpenChange={(open) => !open && setTransferTarget(null)}>
        <DialogContent className="max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-4xl overflow-hidden rounded-[1.5rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
          <DialogHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] p-5 sm:p-8">
            <DialogTitle className="text-2xl font-black tracking-tight text-slate-950 sm:text-4xl">Transfer this car</DialogTitle>
            <DialogDescription className="mt-2 max-w-3xl text-sm font-semibold leading-7 text-slate-500 sm:text-[17px]">
              Move the VIN into a transfer workflow for this booking. The unit leaves the sellable pool here while the transfer request remains active.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 p-5 sm:p-8">
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 px-5 py-4 text-lg font-semibold leading-8 text-slate-800">
              <span className="font-black text-slate-950">{transferTarget?.model}</span> {transferTarget?.variant} · {transferTarget?.color || 'Color NA'} · {transferTarget?.vinNumber}
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Transfer to</Label>
                <Select value={transferToDealerCode} onValueChange={setTransferToDealerCode}>
                  <SelectTrigger className={cn(INPUT_STYLE, 'mt-2')}>
                    <SelectValue placeholder="Select destination outlet" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(new Set([detailQuery.data?.booking.dealerCode || '', 'JK402', 'JK501'].filter(Boolean))).map((dealerCode) => (
                      <SelectItem key={dealerCode} value={dealerCode}>{dealerCode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Reference / dealer name</Label>
                <Input value={transferReferenceName} onChange={(event) => setTransferReferenceName(event.target.value)} placeholder="e.g. Kangra Kia" className={cn(INPUT_STYLE, 'mt-2')} />
              </div>
            </div>
          </div>
          <DialogFooter className="grid gap-2 border-t border-slate-100 bg-slate-50 p-4 sm:flex sm:justify-end sm:p-6">
            <Button type="button" variant="outline" className="h-12 rounded-2xl border-slate-200 bg-white px-6 text-base font-black" onClick={() => setTransferTarget(null)} disabled={actionMutation.isPending}>Cancel</Button>
            <Button type="button" className="h-12 rounded-2xl bg-slate-950 px-6 text-base font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800" onClick={confirmTransfer} disabled={actionMutation.isPending || !transferToDealerCode}>
              {actionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedBookingId)} onOpenChange={(open) => { if (!open) closeBooking() }}>
        <DialogContent
          className="fixed inset-y-0 right-0 left-auto top-0 z-50 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l border-white/70 bg-white p-0 shadow-[0_30px_110px_rgba(15,23,42,0.24)] duration-300 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:w-[min(920px,calc(100vw-2rem))] sm:rounded-l-[2rem]"
        >
          <DialogTitle className="sr-only">Booking Details</DialogTitle>
          {detailQuery.isLoading ? (
            <DrawerSkeleton />
          ) : detailQuery.isError ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <XCircle className="h-12 w-12 text-rose-500" />
              <h2 className="mt-4 text-2xl font-black text-slate-950">Unable to load booking</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">{detailQuery.error instanceof Error ? detailQuery.error.message : 'The booking detail request failed.'}</p>
            </div>
          ) : detailQuery.data ? (
            <BookingDrawer
              detail={detailQuery.data}
              currentUserRole={currentUserRole}
              testPersona={canUseTestPersona ? testPersona : 'actual'}
              canUseTestPersona={canUseTestPersona}
              matchingVehicles={matchingQuery.data?.rows || []}
              matchingLoading={matchingQuery.isLoading || matchingQuery.isFetching}
              actionLoading={actionMutation.isPending || statusMutation.isPending || paymentMutation.isPending}
              actionMessage={actionMessage}
              onAction={runAction}
              onAllot={allotVehicle}
              onOpenTransfer={openTransferDialog}
              onPaymentNotReceived={markPaymentNotReceived}
              onStatusChange={(status) => statusMutation.mutate(status)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )

  if (embedMode) return content

  return (
    <MainLayout title="Bookings CRM" subtitle="AM Kia customer journey workspace">
      {content}
    </MainLayout>
  )
}

function FilterSelect({
  value,
  placeholder,
  values,
  onChange,
  labeler = (item: string) => item,
}: {
  value: string
  placeholder: string
  values: string[]
  onChange: (value: string) => void
  labeler?: (value: string) => string
}) {
  const uniqueValues = Array.from(new Set(values.filter(Boolean)))
  return (
    <Select value={value || ALL_VALUE} onValueChange={onChange}>
      <SelectTrigger className={INPUT_STYLE}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>All {placeholder.toLowerCase()}</SelectItem>
        {uniqueValues.map((item) => <SelectItem key={item} value={item}>{labeler(item)}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function CreateBookingDialog({
  open,
  form,
  activeTab,
  modelOptions,
  variantOptions,
  masterLoading,
  error,
  isSubmitting,
  onOpenChange,
  onTabChange,
  onChange,
  onSubmit,
}: {
  open: boolean
  form: CreateBookingForm
  activeTab: (typeof CREATE_TABS)[number]
  modelOptions: string[]
  variantOptions: string[]
  masterLoading: boolean
  error: string
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: (typeof CREATE_TABS)[number]) => void
  onChange: <K extends keyof CreateBookingForm>(key: K, value: CreateBookingForm[K]) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const activeIndex = CREATE_TABS.indexOf(activeTab)
  const isLastStep = activeIndex === CREATE_TABS.length - 1
  const isFirstStep = activeIndex === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-5xl overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
        <form
          onSubmit={onSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
              e.preventDefault()
            }
          }}
          className="flex max-h-[94dvh] flex-col"
        >
          {/* ── HEADER ── */}
          <DialogHeader className="relative overflow-hidden border-b border-slate-100 bg-[radial-gradient(circle_at_top_left,#e0f2fe,transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] px-5 py-4 sm:px-7 sm:py-5">
            <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#081a33]/10 blur-2xl" />
            <div className="relative">
              <Badge variant="outline" className="mb-2 rounded-full border-sky-100 bg-sky-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-sky-700">Stepwise Booking</Badge>
              <DialogTitle className="text-xl font-black tracking-tight text-slate-950 sm:text-2xl">Create AM Kia Booking</DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-slate-500">Create the booking first, then generate the proforma for manager approval.</DialogDescription>
            </div>
          </DialogHeader>

          {/* ── PROGRESS STEPPER ── */}
          <div className="border-b border-slate-100 bg-white px-5 py-3 sm:px-7 sm:py-4">
            <div className="flex items-start">
              {CREATE_TABS.map((tab, index) => {
                const isActive = tab === activeTab
                const isCompleted = index < activeIndex
                return (
                  <div key={tab} className={cn('flex items-center', index < CREATE_TABS.length - 1 ? 'flex-1' : '')}>
                    <button
                      type="button"
                      onClick={() => onTabChange(tab)}
                      className="flex flex-col items-center gap-1 group"
                    >
                      <div className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full text-xs font-black transition-all duration-300 sm:h-9 sm:w-9',
                        isActive
                          ? 'bg-[#c8102e] text-white shadow-lg shadow-red-500/30 scale-110'
                          : isCompleted
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
                      )}>
                        {isCompleted ? (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span>{index + 1}</span>
                        )}
                      </div>
                      <span className={cn(
                        'hidden text-[9px] font-black uppercase tracking-[0.1em] transition-colors whitespace-nowrap sm:block',
                        isActive ? 'text-[#c8102e]' : isCompleted ? 'text-slate-600' : 'text-slate-400'
                      )}>
                        {tab}
                      </span>
                    </button>
                    {index < CREATE_TABS.length - 1 && (
                      <div className={cn(
                        'h-[2px] flex-1 mx-2 rounded-full transition-all duration-500 mb-4',
                        index < activeIndex ? 'bg-slate-900' : 'bg-slate-200'
                      )} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── TAB CONTENT ── */}
          <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            {error && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>}

            {/* CUSTOMER TAB */}
            {activeTab === 'Customer' && (
              <div className="grid gap-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Field label="Customer Name" required>
                      <Input value={form.customerName} onChange={(event) => onChange('customerName', event.target.value)} className={INPUT_STYLE} placeholder="Full legal name" />
                    </Field>
                  </div>
                  <Field label="Mobile Number" required>
                    <div className="flex gap-2">
                      <Input
                        value={form.countryCode}
                        onChange={(event) => onChange('countryCode', event.target.value)}
                        className={cn(INPUT_STYLE, 'w-[72px] flex-shrink-0 text-center font-black px-2')}
                        placeholder="+91"
                      />
                      <Input
                        value={form.customerPhone}
                        onChange={(event) => onChange('customerPhone', event.target.value)}
                        className={cn(INPUT_STYLE, 'flex-1')}
                        placeholder="10-digit mobile"
                        type="tel"
                      />
                    </div>
                  </Field>
                  <Field label="Customer Email" required>
                    <Input value={form.customerEmailId} onChange={(event) => onChange('customerEmailId', event.target.value)} className={INPUT_STYLE} placeholder="customer@email.com" type="email" />
                  </Field>
                </div>
              </div>
            )}

            {/* VEHICLE TAB */}
            {activeTab === 'Vehicle' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Model" required>
                  <Select value={form.model} onValueChange={(val) => { onChange('model', val); onChange('variant', '') }}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Model" /></SelectTrigger>
                    <SelectContent>
                      {(modelOptions.length > 0 ? modelOptions : ['CARENS', 'CARNIVAL', 'EV6', 'SELTOS', 'SONET', 'SYROS']).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {masterLoading && <p className="mt-1 text-xs font-bold text-slate-500">Loading latest KIA price master...</p>}
                </Field>
                <Field label="Variant" required>
                  <SearchableVariantSelect value={form.variant} onChange={(val) => onChange('variant', val)} options={variantOptions} />
                </Field>
                <Field label="Year" required>
                  <Select value={form.year} onValueChange={(val) => onChange('year', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Year" /></SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Fuel Type">
                  <Select value={form.fuelType} onValueChange={(val) => onChange('fuelType', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Fuel Type" /></SelectTrigger>
                    <SelectContent>
                      {FUEL_TYPES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Colour" required>
                  <Select value={form.color} onValueChange={(val) => onChange('color', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Colour" /></SelectTrigger>
                    <SelectContent>
                      {COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Stock Status" required>
                  <Select value={form.status} onValueChange={(val) => onChange('status', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Stock Status" /></SelectTrigger>
                    <SelectContent>
                      {STOCK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Waiting Period">
                  <Input value={form.waitingPeriod} onChange={(event) => onChange('waitingPeriod', event.target.value)} className={INPUT_STYLE} placeholder="e.g. 4–6 weeks" />
                </Field>
              </div>
            )}

            {/* SALES TEAM TAB */}
            {activeTab === 'Sales Team' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Manager Name" required>
                  <Select value={form.managerName} onValueChange={(val) => onChange('managerName', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Manager" /></SelectTrigger>
                    <SelectContent>
                      {MANAGERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Team Leader" required>
                  <Select value={form.tlName} onValueChange={(val) => onChange('tlName', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Team Leader" /></SelectTrigger>
                    <SelectContent>
                      {TLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Consultant Name" required>
                  <Select value={form.consultantName} onValueChange={(val) => onChange('consultantName', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Consultant" /></SelectTrigger>
                    <SelectContent>
                      {CONSULTANTS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Lead Source" required>
                  <Select value={form.leadSource} onValueChange={(val) => onChange('leadSource', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Lead Source" /></SelectTrigger>
                    <SelectContent>
                      {LEAD_SOURCES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}

            {/* PAYMENT TAB */}
            {activeTab === 'Payment' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Booking Amount" required><Input type="number" value={form.bookingAmount} onChange={(event) => onChange('bookingAmount', event.target.value)} className={INPUT_STYLE} placeholder="₹" /></Field>
                <Field label="Booking Date" required><Input type="date" value={form.bookingDate} onChange={(event) => onChange('bookingDate', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Payment Source" required><Input value={form.pmtSource} onChange={(event) => onChange('pmtSource', event.target.value)} className={INPUT_STYLE} placeholder="Cash / Cheque / UPI..." /></Field>
                <Field label="Payment Amount" required><Input type="number" value={form.paymentAmount} onChange={(event) => onChange('paymentAmount', event.target.value)} className={INPUT_STYLE} placeholder="₹" /></Field>
                <Field label="Payment Received Against Booking" required><Input value={form.paymentReceived} onChange={(event) => onChange('paymentReceived', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Cost Sheet" required><Input value={form.costSheet} onChange={(event) => onChange('costSheet', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Bank / Finance" required>
                  <Select value={form.bankFinance} onValueChange={(val) => onChange('bankFinance', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Bank / Finance" /></SelectTrigger>
                    <SelectContent>
                      {BANKS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}

            {/* DELIVERY TAB */}
            {activeTab === 'Delivery' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Estimated Delivery Date" required><Input type="date" value={form.expectedDeliveryDate} onChange={(event) => onChange('expectedDeliveryDate', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Promise Date" required><Input type="date" value={form.promiseDate} onChange={(event) => onChange('promiseDate', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Commitment With Customer" required>
                  <Textarea value={form.commitment} onChange={(event) => onChange('commitment', event.target.value)} className="min-h-24 rounded-2xl border-slate-200 bg-white text-sm font-semibold text-slate-800" placeholder="Any special commitments made..." />
                </Field>
                <Field label="Other Dealer Details" required><Input value={form.otherDealerDetails} onChange={(event) => onChange('otherDealerDetails', event.target.value)} className={INPUT_STYLE} /></Field>
              </div>
            )}
          </div>

          {/* ── FOOTER: Back/Next + Submit on last step ── */}
          <DialogFooter className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6">
            <Button
              type="button"
              variant="outline"
              className="h-10 min-w-[90px] rounded-2xl bg-white text-xs font-black sm:text-sm"
              onClick={() => {
                if (isFirstStep) {
                  onOpenChange(false)
                } else {
                  onTabChange(CREATE_TABS[activeIndex - 1])
                }
              }}
            >
              {isFirstStep ? 'Cancel' : '← Back'}
            </Button>
            <div className="flex items-center gap-2">
              <span className="hidden text-[10px] font-black uppercase tracking-widest text-slate-400 sm:block">
                Step {activeIndex + 1} of {CREATE_TABS.length}
              </span>
              {!isLastStep ? (
                <Button
                  type="button"
                  className="h-10 min-w-[90px] rounded-2xl bg-slate-950 text-xs font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800 sm:text-sm"
                  onClick={() => onTabChange(CREATE_TABS[activeIndex + 1])}
                >
                  Next →
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="h-10 min-w-[130px] rounded-2xl bg-[#c8102e] text-xs font-black text-white shadow-lg shadow-red-500/20 hover:bg-red-700 sm:text-sm"
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {isSubmitting ? 'Creating...' : 'Create Booking'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2 flex flex-col">
      <Label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
        {label}
        {required && <span className="text-red-500 ml-1 font-bold">*</span>}
      </Label>
      <div className="relative rounded-2xl transition-all duration-200 focus-within:shadow-md focus-within:shadow-red-500/5">
        {children}
      </div>
    </div>
  )
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_42%,#eef2f7_100%)] p-3 sm:space-y-5 sm:p-6">
      <SkeletonBlock className="h-40 w-full rounded-[2rem]" />
      <SkeletonBlock className="h-20 w-full rounded-[1.75rem]" />
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonBlock className="h-48 rounded-[1.75rem]" />
        <SkeletonBlock className="h-48 rounded-[1.75rem]" />
      </div>
      <SkeletonBlock className="h-72 rounded-[1.75rem]" />
    </div>
  )
}

function BookingDrawer({
  detail,
  currentUserRole,
  testPersona,
  canUseTestPersona,
  matchingVehicles,
  matchingLoading,
  actionLoading,
  actionMessage,
  onAction,
  onAllot,
  onOpenTransfer,
  onPaymentNotReceived,
  onStatusChange,
}: {
  detail: BookingDetailPayload
  currentUserRole: string
  testPersona: TestPersona
  canUseTestPersona: boolean
  matchingVehicles: MatchingVehicle[]
  matchingLoading: boolean
  actionLoading: boolean
  actionMessage: string
  onAction: (action: 'proforma' | 'finance' | 'payment' | 'release' | 'deliver' | 'cancel' | 'transfer') => void
  onAllot: (vinNumber: string) => void
  onOpenTransfer: (vehicle?: MatchingVehicle | null) => void
  onPaymentNotReceived: () => void
  onStatusChange: (status: string) => void
}) {
  const router = useRouter()
  const { booking, allocation, proforma, financeOrder, activities, transfers } = detail
  const proformaApproved = proforma?.status === 'APPROVED'
  const effectivePersona = canUseTestPersona ? testPersona : 'actual'
  const canActAsSalesPerson = effectivePersona === 'actual' ? roleCanActAsSalesPerson(currentUserRole) : effectivePersona === 'sales_person'
  const canActAsSalesManager = effectivePersona === 'actual' ? roleCanActAsSalesManager(currentUserRole) : effectivePersona === 'sales_manager'
  const canActAsAccounts = effectivePersona === 'actual' ? roleCanActAsAccounts(currentUserRole) : effectivePersona === 'accounts'
  const canActOnStock = canActAsSalesPerson || normalizeRole(currentUserRole) === 'super_admin'
  const personaNote = canUseTestPersona && effectivePersona !== 'actual'
    ? `Testing as ${TEST_PERSONA_LABELS[effectivePersona]}. Server permissions still use your Super Admin account; this only stages the UI controls.`
    : null
  const nextStep = (() => {
    if (!proforma) {
      return {
        label: 'Stage 1 · Sales Person',
        title: 'Generate the proforma next',
        body: 'The booking is ready. The next owner is the sales person, who should generate and submit the proforma for manager approval.',
        actionLabel: canActAsSalesPerson ? 'Generate Proforma' : null,
        onAction: canActAsSalesPerson ? () => onAction('proforma') : null,
      }
    }
    if (!proformaApproved) {
      return {
        label: 'Stage 2 · Sales Manager',
        title: 'Waiting for approval',
        body: canActAsSalesManager
          ? 'Open Pending Approval and either approve or decline this proforma. Once approved, the workflow moves to Stock for VIN allotment.'
          : 'The proforma is in the approval queue. Sales can monitor it from All Proforma Details while managers review it in Pending Approval.',
        actionLabel: canActAsSalesManager ? 'Open Pending Approval' : 'Open All Proformas',
        onAction: () => router.push(
          canActAsSalesManager
            ? `/brands/kia/proforma/pending-approval?search=${proforma.number}`
            : `/brands/kia/proforma/all-proforma-details?search=${proforma.number}`,
        ),
      }
    }
    if (!allocation) {
      return {
        label: 'Stage 3 · Stock',
        title: 'Allot or transfer a vehicle',
        body: 'Approval is complete. The sales person should now match a VIN from stock, allot it, or initiate a transfer if the unit belongs to another outlet.',
        actionLabel: null,
        onAction: null,
      }
    }
    if (booking.status === 'vehicle_allocated' || booking.status === 'transfer_requested') {
      return {
        label: 'Stage 4 · Accounts',
        title: 'Payment confirmation pending',
        body: 'The VIN is reserved for 72 hours. Accounts must confirm payment before the timer expires; otherwise the reservation should be released and the booking moves on hold.',
        actionLabel: canActAsAccounts ? 'Confirm Payment' : null,
        onAction: canActAsAccounts ? () => onAction('payment') : null,
      }
    }
    if (booking.status === 'ready_delivery') {
      return {
        label: 'Stage 5 · Delivery',
        title: 'Ready to deliver',
        body: 'Payment is confirmed and the VIN is no longer available to anyone else. The final action is delivery completion.',
        actionLabel: canActAsAccounts ? 'Mark Delivered' : null,
        onAction: canActAsAccounts ? () => onAction('deliver') : null,
      }
    }
    return {
      label: 'Workflow complete',
      title: 'Booking completed',
      body: 'All workflow stages are complete for this booking.',
      actionLabel: null,
      onAction: null,
    }
  })()
  return (
    <>
      <div className="relative overflow-hidden border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,#dbeafe,transparent_34%),radial-gradient(circle_at_10%_0%,#fee2e2,transparent_24%),linear-gradient(135deg,#ffffff,#f8fafc_56%,#eef2f7)] p-4 sm:p-6">
        <div className="absolute -right-24 -top-28 h-64 w-64 rounded-full bg-white/70 blur-3xl" />
        <div className="absolute -bottom-32 left-8 h-56 w-56 rounded-full bg-slate-200/60 blur-3xl" />
        <div className="relative">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <Badge variant="outline" className="rounded-full border-slate-200 bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm">
                Booking Detail
              </Badge>
              <h2 className="mt-3 break-words text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{booking.bookingNumber}</h2>
              <p className="mt-1 text-sm font-black leading-5 text-slate-700 sm:text-base">{booking.customerName}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500 sm:text-sm">{booking.customerPhone} · {booking.model || 'Vehicle NA'} · {booking.dealerCode || 'Dealer NA'}</p>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <StatusBadge status={booking.status} />
              {canUseTestPersona && (
                <div className="rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600 shadow-sm">
                  {TEST_PERSONA_LABELS[effectivePersona]}
                </div>
              )}
              {canUseTestPersona && (
              <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white/85 p-1.5 shadow-sm">
                <span className="pl-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Manual</span>
                <Select value={booking.status} onValueChange={onStatusChange} disabled={actionLoading}>
                  <SelectTrigger className="h-8 w-40 rounded-xl border border-slate-200 bg-white px-2 py-0 text-xs font-black text-slate-700 shadow-none hover:bg-slate-50">
                    <SelectValue placeholder="Override status" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(STATUS_LABELS).map((status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white/80 p-3 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Proforma</p>
              <p className="mt-1 truncate text-sm font-black text-slate-950">{proforma?.number || 'Not generated'}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/80 p-3 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">VIN</p>
              <p className="mt-1 truncate font-mono text-xs font-black text-slate-950">{allocation?.vinNumber || 'Not allocated'}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/80 p-3 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Delivery</p>
              <p className="mt-1 text-sm font-black text-slate-950">{formatDate(booking.expectedDeliveryDate)}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_36%,#eef2f7_100%)] p-3 sm:space-y-5 sm:p-5">
        <Stepper status={booking.status} />
        {personaNote && <div className="rounded-2xl border border-sky-100 bg-white p-3 text-xs font-bold leading-5 text-sky-800 shadow-sm sm:text-sm">{personaNote}</div>}
        <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.03]">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{nextStep.label}</p>
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-950">{nextStep.title}</h3>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{nextStep.body}</p>
            </div>
            {nextStep.actionLabel && nextStep.onAction ? (
              <Button className="h-10 rounded-2xl bg-slate-950 px-4 text-xs font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800 sm:text-sm" onClick={nextStep.onAction}>
                {nextStep.actionLabel}
              </Button>
            ) : null}
          </div>
        </section>
        {actionMessage && <div className="rounded-2xl border border-emerald-100 bg-white p-3 text-sm font-bold text-emerald-800 shadow-sm">{actionMessage}</div>}
        {(() => {
          const meta = (booking.metadata || {}) as Record<string, unknown>
          const paymentConfirmation = (meta.paymentConfirmation || {}) as Record<string, unknown>
          return (
            <div className="grid gap-4 lg:grid-cols-2">
              <InfoCard title="Customer" icon={UserRound} items={[
                ['Name', booking.customerName],
                ['Country Code', String(meta.countryCode || '91')],
                ['Phone', booking.customerPhone],
                ['Email', booking.customerEmail || String(meta.customerEmailId || '-')],
                ['Address', booking.customerAddress || '-'],
              ]} />
              <InfoCard title="Vehicle" icon={Car} items={[
                ['DealerCode', booking.dealerCode],
                ['Model', booking.model],
                ['Variant', booking.variant],
                ['Color', booking.colorPreference || String(meta.color || '-')],
                ['Year', String(meta.year || '-')],
                ['Fuel Type', booking.fuelType || String(meta.fuelType || '-')],
                ['Stock Status', String(meta.status || '-')],
                ['Waiting Period', String(meta.waitingPeriod || '-')],
              ]} />
              <InfoCard title="Sales Team" icon={ClipboardList} items={[
                ['Manager Name', String(meta.managerName || '-')],
                ['TL Name', String(meta.tlName || '-')],
                ['Consultant Name', booking.consultantName],
                ['Lead Source', booking.source || String(meta.leadSource || '-')],
              ]} />
              <InfoCard title="Payment & Delivery" icon={BadgeIndianRupee} items={[
                ['Booking Amount', String(meta.bookingAmount || '-')],
                ['Booking Date', String(meta.bookingDate || '-')],
                ['Pmt Source', String(meta.pmtSource || '-')],
                ['Payment Amount', String(meta.paymentAmount || '-')],
                ['Payment Received', String(meta.paymentReceived || '-')],
                ['Cost Sheet', String(meta.costSheet || '-')],
                ['Bank Finance', booking.bankName || String(meta.bankFinance || '-')],
                ['Invoice Upload', String(paymentConfirmation.invoiceDocumentName || '-')],
                ['Estimated Delivery', booking.expectedDeliveryDate || String(meta.expectedDeliveryDate || '-')],
                ['Promise Date', String(meta.promiseDate || '-')],
                ['Other Dealer Details', String(meta.otherDealerDetails || '-')],
                ['Commitment', String(meta.commitment || '-')],
              ]} />
              <ActionCard
                title="Proforma"
                icon={FileText}
                value={proforma?.number || 'Not generated'}
                status={proforma?.status || '-'}
                action={proforma ? (canActAsSalesManager ? 'Open Pending Proforma' : 'View Proforma Details') : 'Generate Proforma'}
                disabled={actionLoading || (!proforma && !canActAsSalesPerson)}
                onClick={() => {
                  if (proforma) {
                    router.push(
                      canActAsSalesManager
                        ? `/brands/kia/proforma/pending-approval?search=${proforma.number}`
                        : `/brands/kia/proforma/all-proforma-details?search=${proforma.number}`,
                    )
                  } else {
                    onAction('proforma')
                  }
                }}
              />
              <ActionCard title="Payment Confirmation" icon={ShieldCheck} value={allocation ? allocation.vinNumber : 'No active VIN'} status={booking.status === 'ready_delivery' || booking.status === 'delivered' ? 'Confirmed' : 'Pending Accounts'} action="Confirm Payment" disabled={actionLoading || !canActAsAccounts || !allocation || booking.status === 'ready_delivery' || booking.status === 'delivered'} onClick={() => onAction('payment')} />
            </div>
          )
        })()}

        <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-3 shadow-[0_18px_55px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.03] sm:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
                <Car className="h-5 w-5" />
              </div>
              <div>
              <h3 className="text-base font-black tracking-tight text-slate-950 sm:text-lg">Vehicle Allocation</h3>
              <p className="text-xs font-semibold leading-5 text-slate-500 sm:text-sm">
                {proformaApproved ? 'Matchable VINs exclude local Retail and active allocations.' : 'Allocation unlocks after Sales Manager / Manager approval.'}
              </p>
              </div>
            </div>
            {allocation && (
              <Button variant="outline" className="h-10 rounded-2xl border-slate-200 bg-white text-xs font-black shadow-sm sm:text-sm" disabled={actionLoading || !canActOnStock} onClick={() => onAction('release')}>
                {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />} Release VIN
              </Button>
            )}
          </div>
          {allocation ? (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ecfdf5,#ffffff)] p-3 shadow-inner sm:p-4">
              <p className="break-all font-mono text-xs font-black text-emerald-900 sm:text-sm">{allocation.vinNumber}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-emerald-700 sm:text-sm">{allocation.model} · {allocation.variant} · {allocation.color || 'Color NA'}</p>
              <p className="mt-3 inline-flex rounded-full border border-emerald-100 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-emerald-800 shadow-sm sm:text-xs sm:tracking-[0.12em]">
                Accounts payment window: {formatTimeRemaining(allocation.expiresAt)}
              </p>
            </div>
          ) : !proformaApproved ? (
            <p className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-amber-50/80 p-3 text-xs font-bold leading-5 text-amber-800 sm:p-4 sm:text-sm">
              Generate the proforma and get senior approval before checking stock or allotting a vehicle.
            </p>
          ) : matchingLoading ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SkeletonBlock className="h-24" />
              <SkeletonBlock className="h-24" />
            </div>
          ) : matchingVehicles.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-3 text-xs font-semibold text-slate-500 sm:p-4 sm:text-sm">No matching vehicles available for this booking.</p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {matchingVehicles.slice(0, 6).map((vehicle) => (
                <div key={vehicle.vinNumber} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 shadow-sm sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="break-all font-mono text-xs font-black text-slate-950">{vehicle.vinNumber}</p>
                      <p className="mt-1 text-sm font-bold text-slate-700">{vehicle.model} · {vehicle.variant}</p>
                      <p className="text-xs font-semibold text-slate-500">{vehicle.dealerCode} · {vehicle.color || 'Color NA'} · {vehicle.source === 'bbnd' ? 'BBND snapshot' : vehicle.stockStatus || 'DMS'}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button size="sm" className="rounded-xl bg-slate-950 font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800" disabled={actionLoading || !canActOnStock} onClick={() => onAllot(vehicle.vinNumber)}>
                        Allot Vehicle
                      </Button>
                      <Button size="sm" variant="outline" className="rounded-xl border-slate-200 bg-white font-black text-slate-700 shadow-sm hover:bg-slate-50" disabled={actionLoading || !canActOnStock} onClick={() => onOpenTransfer(vehicle)}>
                        Transfer Vehicle
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-3 shadow-[0_18px_55px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.03] sm:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <ClipboardList className="h-5 w-5" />
              </div>
              <h3 className="text-base font-black tracking-tight text-slate-950 sm:text-lg">Timeline</h3>
            </div>
            <div className="mt-4 space-y-3">
              {activities.length === 0 ? <p className="text-sm font-semibold text-slate-500">No activity yet.</p> : activities.map((activity) => (
                <div key={activity.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                  <p className="text-sm font-black text-slate-900">{activity.message}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{activity.actorName || 'System'} · {formatDate(activity.createdAt)}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-3 shadow-[0_18px_55px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.03] sm:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                <Truck className="h-5 w-5" />
              </div>
              <h3 className="text-base font-black tracking-tight text-slate-950 sm:text-lg">Delivery & Transfers</h3>
            </div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Expected Delivery</p>
                <p className="mt-1 text-sm font-black text-slate-950">{formatDate(booking.expectedDeliveryDate)}</p>
              </div>
              {transfers.slice(0, 4).map((transfer) => (
                <div key={transfer.id} className="rounded-2xl border border-slate-100 bg-white p-3 text-sm font-semibold text-slate-600 shadow-sm">
                  {transfer.vinNumber} · {transfer.fromDealerCode || '-'} <ArrowRight className="inline h-3 w-3" /> {transfer.toDealerCode || '-'} · {transfer.status}
                </div>
              ))}
              <Button variant="outline" className="h-10 rounded-2xl border-slate-200 bg-white text-xs font-black shadow-sm sm:text-sm" disabled={actionLoading || !canActOnStock} onClick={() => onAction('transfer')}>
                Request Transfer
              </Button>
              <Button className="h-10 rounded-2xl bg-emerald-600 text-xs font-black text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 sm:text-sm" disabled={actionLoading || !canActAsAccounts || booking.status !== 'ready_delivery'} onClick={() => onAction('deliver')}>
                <CalendarCheck className="h-4 w-4" /> Mark Delivered
              </Button>
              <Button variant="outline" className="h-10 rounded-2xl border-amber-200 bg-white text-xs font-black text-amber-700 shadow-sm hover:bg-amber-50 sm:text-sm" disabled={actionLoading || !canActAsAccounts || !allocation || (booking.status !== 'vehicle_allocated' && booking.status !== 'transfer_requested')} onClick={onPaymentNotReceived}>
                Payment not received
              </Button>
              <Button variant="outline" className="h-10 rounded-2xl border-rose-100 bg-white text-xs font-black text-rose-700 shadow-sm hover:bg-rose-50 sm:text-sm" disabled={actionLoading || (!canUseTestPersona && booking.status === 'delivered')} onClick={() => onAction('cancel')}>
                Cancel Booking
              </Button>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

function InfoCard({ title, icon: Icon, items }: { title: string; icon: typeof ShieldCheck; items: Array<[string, string]> }) {
  return (
    <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-3 shadow-[0_18px_55px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.03] sm:p-5">
      <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-950/15 sm:h-10 sm:w-10"><Icon className="h-4 w-4 sm:h-5 sm:w-5" /></div>
        <h3 className="text-base font-black tracking-tight text-slate-950 sm:text-lg">{title}</h3>
      </div>
      <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5 sm:p-3">
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400 sm:text-[10px] sm:tracking-[0.16em]">{label}</p>
            <p className="mt-1 break-words text-xs font-black leading-5 text-slate-800 sm:text-sm">{value}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function ActionCard({ title, icon: Icon, value, status, action, disabled, onClick }: { title: string; icon: typeof ShieldCheck; value: string; status: string; action: string; disabled: boolean; onClick: () => void }) {
  return (
    <section className="rounded-[1.75rem] border border-white/80 bg-white/95 p-3 shadow-[0_18px_55px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.03] sm:p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#c8102e]/10 text-[#c8102e] ring-1 ring-[#c8102e]/10 sm:h-10 sm:w-10"><Icon className="h-4 w-4 sm:h-5 sm:w-5" /></div>
        <div>
          <h3 className="text-base font-black tracking-tight text-slate-950 sm:text-lg">{title}</h3>
          <p className="mt-0.5 text-xs font-bold text-slate-500">{status}</p>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
        <p className="break-words text-lg font-black leading-6 text-slate-950 sm:text-xl">{value}</p>
      </div>
      <Button className="mt-3 h-10 w-full rounded-2xl bg-slate-950 text-xs font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800 sm:mt-4 sm:text-sm" disabled={disabled} onClick={onClick}>
        {disabled && <Loader2 className="h-4 w-4 animate-spin" />} {action}
      </Button>
    </section>
  )
}

interface EmailQuoteForm {
  customerName: string
  customerPhone: string
  customerEmail: string
  model: string
  variant: string
  price: string
}

const EMPTY_QUOTE_FORM: EmailQuoteForm = {
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  model: '',
  variant: '',
  price: '',
}

function EmailQuoteDialog({
  open,
  onOpenChange,
  modelOptions,
  trims,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelOptions: string[]
  trims: { model: string; trim_description: string }[]
}) {
  const [form, setForm] = useState<EmailQuoteForm>(EMPTY_QUOTE_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const update = <K extends keyof EmailQuoteForm>(key: K, value: EmailQuoteForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }

  const validate = () => {
    const nextErrors: Record<string, string> = {}
    if (!form.customerName.trim()) nextErrors.customerName = 'Customer Name is required'
    
    if (!form.customerPhone.trim()) {
      nextErrors.customerPhone = 'Mobile number is required'
    } else if (!/^\d{10}$/.test(form.customerPhone.replace(/\D/g, ''))) {
      nextErrors.customerPhone = 'Mobile number must be 10 digits'
    }

    if (!form.customerEmail.trim()) {
      nextErrors.customerEmail = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim())) {
      nextErrors.customerEmail = 'Enter a valid email address'
    }

    if (!form.model) nextErrors.model = 'Please select a model'
    if (!form.variant) nextErrors.variant = 'Please select a variant'

    if (!form.price.trim()) {
      nextErrors.price = 'Price is required'
    } else if (isNaN(Number(form.price.replace(/,/g, '')))) {
      nextErrors.price = 'Enter a valid number'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!validate()) return
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/brands/kia/proforma/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          customerPhone: form.customerPhone.replace(/\D/g, ''),
          price: Number(form.price.replace(/,/g, '')),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit quote')

      const pdfBytesStr = data.pdf
      const filename = data.filename || 'AM-KIA-Quotation.pdf'
      const binaryString = atob(pdfBytesStr)
      const len = binaryString.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      window.URL.revokeObjectURL(url)

      alert('Quote generated, saved in database, and downloaded successfully!')
      setForm(EMPTY_QUOTE_FORM)
      onOpenChange(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  const vehicles = modelOptions.length > 0 ? modelOptions : ['CARENS', 'CARNIVAL', 'EV6', 'SELTOS', 'SONET', 'SYROS']
  const quoteVariantOptions = useMemo(() => {
    return Array.from(new Set(trims
      .filter((trim) => !form.model || trim.model === form.model)
      .map((trim) => trim.trim_description)
      .filter(Boolean)))
  }, [form.model, trims])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-2xl overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <DialogHeader className="relative overflow-hidden border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,#e0f2fe,transparent_35%),linear-gradient(135deg,#ffffff,#f8fafc)] p-4 sm:p-7">
            <div className="absolute -left-20 -top-24 h-56 w-56 rounded-full bg-cyan-200/30 blur-3xl" />
            <Badge variant="outline" className="relative mb-3 w-fit rounded-full border-cyan-100 bg-cyan-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-700 sm:mb-4">Indicative Quote</Badge>
            <DialogTitle className="relative text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Create Price Quotation</DialogTitle>
            <DialogDescription className="relative mt-2 text-xs font-semibold leading-5 text-slate-500 sm:text-sm">Send a simple quote PDF. It is not a proforma and does not allocate stock.</DialogDescription>
          </DialogHeader>
          
          <div className="max-h-[65dvh] space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-3 sm:max-h-none sm:space-y-5 sm:overflow-visible sm:p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Customer Name <span className="text-red-500 font-bold">*</span></Label>
                <Input className="mt-1.5 h-11 rounded-2xl border-slate-200 bg-slate-50/50 font-bold focus:border-[#c8102e] focus:bg-white focus:ring-2 focus:ring-[#c8102e]/10 transition-all" value={form.customerName} onChange={(e) => update('customerName', e.target.value)} placeholder="e.g. John Doe" />
                {errors.customerName && <p className="mt-1 text-xs font-semibold text-red-500">{errors.customerName}</p>}
              </div>

              <div>
                <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Mobile Number <span className="text-red-500 font-bold">*</span></Label>
                <Input className="mt-1.5 h-11 rounded-2xl border-slate-200 bg-slate-50/50 font-bold focus:border-[#c8102e] focus:bg-white focus:ring-2 focus:ring-[#c8102e]/10 transition-all" inputMode="numeric" maxLength={10} value={form.customerPhone} onChange={(e) => update('customerPhone', e.target.value.replace(/\D/g, ''))} placeholder="10-digit mobile number" />
                {errors.customerPhone && <p className="mt-1 text-xs font-semibold text-red-500">{errors.customerPhone}</p>}
              </div>
            </div>

            <div>
              <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Customer Email <span className="text-red-500 font-bold">*</span></Label>
              <Input className="mt-1.5 h-11 rounded-2xl border-slate-200 bg-slate-50/50 font-bold focus:border-[#c8102e] focus:bg-white focus:ring-2 focus:ring-[#c8102e]/10 transition-all" type="email" value={form.customerEmail} onChange={(e) => update('customerEmail', e.target.value)} placeholder="name@domain.com" />
              {errors.customerEmail && <p className="mt-1 text-xs font-semibold text-red-500">{errors.customerEmail}</p>}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Model <span className="text-red-500 font-bold">*</span></Label>
                <Select value={form.model} onValueChange={(val) => { update('model', val); update('variant', '') }}>
                <SelectTrigger className="mt-1.5 h-11 rounded-2xl border-slate-200 bg-white font-bold focus:border-slate-950 focus:bg-white focus:ring-2 focus:ring-slate-950/10 transition-all"><SelectValue placeholder="Select vehicle model" /></SelectTrigger>
                <SelectContent>
                  {vehicles.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
                {errors.model && <p className="mt-1 text-xs font-semibold text-red-500">{errors.model}</p>}
              </div>
              <div>
                <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Variant <span className="text-red-500 font-bold">*</span></Label>
                <SearchableVariantSelect value={form.variant} onChange={(val) => update('variant', val)} options={quoteVariantOptions} />
                {errors.variant && <p className="mt-1 text-xs font-semibold text-red-500">{errors.variant}</p>}
              </div>
            </div>

            <div>
              <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Vehicle Price <span className="text-red-500 font-bold">*</span></Label>
              <Input className="mt-1.5 h-11 rounded-2xl border-slate-200 bg-white font-bold focus:border-slate-950 focus:bg-white focus:ring-2 focus:ring-slate-950/10 transition-all" inputMode="numeric" value={form.price} onChange={(e) => update('price', e.target.value)} placeholder="Indicative ex-showroom / quote amount" />
              {errors.price && <p className="mt-1 text-xs font-semibold text-red-500">{errors.price}</p>}
            </div>
          </div>

          <DialogFooter className="grid gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:flex sm:p-4">
            <Button type="button" variant="outline" className="h-10 rounded-xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 sm:text-sm" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" className="h-10 rounded-xl bg-slate-950 text-xs font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800 sm:text-sm" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Generate & Download Quote
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
