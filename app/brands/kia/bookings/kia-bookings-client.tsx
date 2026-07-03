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
const PRIMARY_SURFACE = 'rounded-[2rem] border border-slate-200 bg-white shadow-sm'
const INPUT_STYLE = 'h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 text-sm font-semibold text-slate-800 transition-all duration-200 focus:bg-white focus:border-[#c8102e] focus:ring-4 focus:ring-red-50 focus:outline-none'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  booking_created: 'Booking Created',
  proforma_generated: 'Proforma Generated',
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

async function fetchJson<T>(url: string, label: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Request failed for ${label}`)
    return await response.json() as T
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
      <div className="border-b border-slate-200 bg-slate-950 px-5 py-4">
        <SkeletonBlock className="h-4 w-44 bg-white/20" />
      </div>
      <div className="space-y-3 p-5">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <SkeletonBlock key={columnIndex} className="h-9" />
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
    <Badge variant="outline" className={cn('rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em]', STATUS_STYLES[status] || STATUS_STYLES.draft)}>
      {statusLabel(status)}
    </Badge>
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
    <div className="grid gap-2 sm:grid-cols-6">
      {steps.map((step, index) => {
        const active = index <= currentIndex || status === 'delivered'
        return (
          <div key={step.key} className={cn('rounded-2xl border px-3 py-2 text-xs font-black uppercase tracking-[0.12em]', active ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50 text-slate-400')}>
            {step.label}
          </div>
        )
      })}
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

export function KiaBookingsClient({ initialSearchParams, embedMode = false }: { initialSearchParams: SearchParamsInput; embedMode?: boolean }) {
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
  const [createTab, setCreateTab] = useState<(typeof CREATE_TABS)[number]>('Customer')
  const [createForm, setCreateForm] = useState<CreateBookingForm>(() => initialCreateForm())
  const [formError, setFormError] = useState('')
  const [actionMessage, setActionMessage] = useState('')

  const selectedBookingId = searchParams.get('bookingId') || ''

  useEffect(() => {
    const query = buildQueryString({ search, dealer_code: dealer, model, status, consultant, page })
    const next = new URLSearchParams(query)
    if (selectedBookingId) next.set('bookingId', selectedBookingId)
    const nextSearch = next.toString() ? `?${next.toString()}` : ''
    const currentSearch = typeof window !== 'undefined' ? window.location.search : ''
    if (nextSearch !== currentSearch) {
      router.replace(`${pathname}${nextSearch}`, { scroll: false })
    }
  }, [consultant, dealer, model, page, pathname, router, search, selectedBookingId, status])

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
  })

  const detailQuery = useQuery({
    queryKey: ['kia-booking-detail', selectedBookingId],
    queryFn: () => fetchJson<BookingDetailPayload>(`/api/brands/kia/bookings/${selectedBookingId}`, 'kia-booking-detail'),
    enabled: Boolean(selectedBookingId),
  })

  const matchingQuery = useQuery({
    queryKey: ['kia-booking-matching-vehicles', selectedBookingId],
    queryFn: () => fetchJson<MatchingVehiclesPayload>(`/api/brands/kia/bookings/${selectedBookingId}/matching-vehicles`, 'kia-booking-matching-vehicles'),
    enabled: Boolean(selectedBookingId) && Boolean(detailQuery.data?.booking),
  })

  const proformaOptionsQuery = useQuery({
    queryKey: ['kia-proforma-options-for-bookings'],
    queryFn: () => fetchJson<ProformaOptionsPayload>('/api/brands/kia/proforma/options', 'kia-proforma-options'),
    staleTime: 5 * 60 * 1000,
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
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      openBooking(created.id)
    },
  })

  const actionMutation = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string; body?: Record<string, string> }) => fetchJson<{ ok: boolean }>(endpoint, 'kia-booking-action', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
    onSuccess: () => {
      setActionMessage('Action completed and timeline refreshed.')
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', selectedBookingId] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-matching-vehicles', selectedBookingId] })
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : 'Action failed'),
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
  const priceTrims = proformaOptionsQuery.data?.trims || []
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

  function openBooking(id: string) {
    const next = new URLSearchParams(searchParams.toString())
    next.set('bookingId', id)
    router.replace(`/brands/kia/bookings?${next.toString()}`, { scroll: false })
  }

  function closeBooking() {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('bookingId')
    router.replace(`/brands/kia/bookings${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false })
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
      ['bankFinance', 'Bank Finance'],
      ['bookingAmount', 'BOOKING AMOUNT'],
      ['bookingDate', 'BOOKING DATE'],
      ['pmtSource', 'PMT SOURCE'],
      ['paymentAmount', 'PAYMENT AMOUNT'],
      ['managerName', 'Manager Name'],
      ['tlName', 'TL Name'],
      ['consultantName', 'Consultant Name'],
      ['color', 'COLOUR'],
      ['leadSource', 'Lead Source'],
      ['status', 'STATUS'],
      ['expectedDeliveryDate', 'Estimated Delivery Date'],
      ['commitment', 'Any Commitment With Customer'],
      ['otherDealerDetails', 'OTHER DEALER DETAILS'],
      ['promiseDate', 'Promise date'],
      ['costSheet', 'COST SHEET'],
      ['paymentReceived', 'Payment Recevied Against Booking'],
      ['waitingPeriod', 'Wating Period'],
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
      const reference = window.prompt('Payment reference / UTR (optional)') || ''
      actionMutation.mutate({
        endpoint: `/api/brands/kia/bookings/${selectedBookingId}/payment`,
        body: { reference },
      })
      return
    }
    if (action === 'release' && !window.confirm('Release this VIN allocation? The vehicle will become matchable again.')) return
    if (action === 'deliver' && !window.confirm('Mark this booking as delivered? This is a final delivery action.')) return
    if (action === 'cancel' && !window.confirm('Cancel this booking?')) return
    if (action === 'transfer') {
      const toDealerCode = window.prompt('Transfer to dealer code')
      if (!toDealerCode) return
      actionMutation.mutate({
        endpoint: `/api/brands/kia/bookings/${selectedBookingId}/transfer`,
        body: { toDealerCode },
      })
      return
    }
    actionMutation.mutate({ endpoint: `/api/brands/kia/bookings/${selectedBookingId}/${action}` })
  }

  function allotVehicle(vinNumber: string) {
    if (!selectedBookingId) return
    actionMutation.mutate({
      endpoint: `/api/brands/kia/bookings/${selectedBookingId}/allot`,
      body: { vinNumber },
    })
  }

  const content = (
    <>
      <div className="space-y-5">
        <section className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
          <div className="border-t-4 border-[#c8102e] bg-gradient-to-br from-white via-slate-50 to-sky-50 p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              {!embedMode ? (
                <div>
                  <Badge variant="outline" className="rounded-full border-sky-100 bg-sky-50 px-4 py-1 text-xs font-black uppercase tracking-[0.18em] text-sky-700">
                    AM Kia Sales
                  </Badge>
                  <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950">Bookings CRM</h1>
                  <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
                    Booking creation, proforma generation, VIN allocation, finance draft, delivery readiness, and full timeline audit in one workspace.
                  </p>
                </div>
              ) : (
                <div>
                  <Badge variant="outline" className="rounded-full border-sky-100 bg-sky-50 px-4 py-1 text-xs font-black uppercase tracking-[0.18em] text-sky-700">
                    AM Kia Sales
                  </Badge>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button className="h-11 rounded-2xl bg-slate-950 px-5 font-black text-white hover:bg-slate-800" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" /> New Booking
                </Button>
                <Button variant="outline" className="h-11 rounded-2xl bg-white px-5 font-black" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
                  <RefreshCw className={cn('h-4 w-4', listQuery.isFetching && 'animate-spin')} /> Refresh
                </Button>
              </div>
            </div>


          </div>
        </section>

        <section className={cn(PRIMARY_SURFACE, 'sticky top-3 z-20 p-4')}>
          <div className="grid gap-3 lg:grid-cols-[1.4fr_repeat(4,minmax(0,0.8fr))_auto]">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search booking, customer, phone, VIN..." className={cn(INPUT_STYLE, 'pl-11')} />
            </div>
            <FilterSelect value={dealer} placeholder="Dealer" values={filters.dealers} onChange={(value) => { setDealer(value); setPage(1) }} />
            <FilterSelect value={model} placeholder="Model" values={filters.models} onChange={(value) => { setModel(value); setPage(1) }} />
            <FilterSelect value={status} placeholder="Status" values={filters.statuses} onChange={(value) => { setStatus(value); setPage(1) }} labeler={statusLabel} />
            <FilterSelect value={consultant} placeholder="Consultant" values={filters.consultants} onChange={(value) => { setConsultant(value); setPage(1) }} />
            <Button variant="outline" className="h-11 rounded-2xl bg-white font-black" onClick={() => { setSearch(''); setDealer(ALL_VALUE); setModel(ALL_VALUE); setStatus(ALL_VALUE); setConsultant(ALL_VALUE); setPage(1) }}>
              Clear
            </Button>
          </div>
        </section>

        {listQuery.isLoading ? (
          <TableSkeleton columns={9} />
        ) : listQuery.isError ? (
          <EmptyState title="Bookings API is not ready yet" description="The UI is wired to the planned API contract. Once the bookings endpoints are implemented, this workspace will populate automatically." />
        ) : rows.length === 0 ? (
          <EmptyState title="No bookings found" description="Create a booking or adjust filters to see the customer journey table." />
        ) : (
          <section className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Bookings Pipeline</p>
                <h2 className="text-lg font-black">{data?.total || 0} records</h2>
              </div>
              {listQuery.isFetching && <Loader2 className="h-5 w-5 animate-spin text-white/70" />}
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  {['Booking', 'Customer', 'Vehicle', 'Consultant', 'Status', 'Finance', 'VIN', 'Updated', 'Action'].map((head) => (
                    <TableHead key={head} className="h-11 px-4 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{head}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer bg-white text-base hover:bg-slate-50" onClick={() => openBooking(row.id)}>
                    <TableCell className="px-4 py-4 font-black text-slate-950 text-base">{row.bookingNumber}</TableCell>
                    <TableCell className="px-4 py-4 text-base">
                      <div className="font-black text-slate-900 text-base">{row.customerName}</div>
                      <div className="text-xs font-semibold text-slate-500">{row.customerPhone}</div>
                    </TableCell>
                    <TableCell className="px-4 py-4 text-base">
                      <div className="font-bold text-slate-900 text-base">{row.model}</div>
                      <div className="text-xs text-slate-500">{row.variant}</div>
                    </TableCell>
                    <TableCell className="px-4 py-4 font-semibold text-slate-600 text-base">{row.consultantName}</TableCell>
                    <TableCell className="px-4 py-4 text-base"><StatusBadge status={row.proformaNumber ? 'proforma_generated' : row.status} /></TableCell>
                    <TableCell className="px-4 py-4 font-semibold text-slate-600 text-base">{row.financeOrderNumber || '-'}</TableCell>
                    <TableCell className="px-4 py-4 font-mono text-xs text-slate-600 text-base">{row.allocatedVin || '-'}</TableCell>
                    <TableCell className="px-4 py-4 text-xs font-semibold text-slate-500 text-base">{formatDate(row.updatedAt)}</TableCell>
                    <TableCell className="px-4 py-4 font-semibold text-slate-600 text-base" onClick={(e) => e.stopPropagation()}>
                      {row.proformaNumber ? (
                        <Link
                          href={`/brands/kia/proforma/all-proforma-details?search=${row.proformaNumber}`}
                          className="inline-flex h-9 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-200 px-3 text-xs font-black text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800"
                        >
                          PROFORMA GENERATED
                        </Link>
                      ) : (
                        <Button
                          size="sm"
                          className="h-9 rounded-xl bg-[#c8102e] text-[12px] font-black text-white hover:bg-red-700 border-none px-4 shadow-sm"
                          onClick={() => {
                            router.push(`/brands/kia/proforma/generate?bookingId=${row.id}`)
                          }}
                        >
                          Generate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-bold text-slate-500">Page {data?.page || page} of {data?.totalPages || 1}</p>
              <div className="flex gap-2">
                <Button variant="outline" className="rounded-2xl bg-white font-black" disabled={page <= 1 || listQuery.isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
                <Button variant="outline" className="rounded-2xl bg-white font-black" disabled={page >= (data?.totalPages || 1) || listQuery.isFetching} onClick={() => setPage((current) => current + 1)}>Next</Button>
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

      <Dialog open={Boolean(selectedBookingId)} onOpenChange={(open) => { if (!open) closeBooking() }}>
        <DialogContent className="max-h-[92dvh] max-w-5xl w-full flex flex-col gap-0 overflow-hidden rounded-[2rem] p-0">
          <DialogTitle className="sr-only">Booking Details</DialogTitle>
          {detailQuery.isLoading ? (
            <DrawerSkeleton />
          ) : detailQuery.isError ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <XCircle className="h-12 w-12 text-rose-500" />
              <h2 className="mt-4 text-2xl font-black text-slate-950">Unable to load booking</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">The detail endpoint may not be implemented yet.</p>
            </div>
          ) : detailQuery.data ? (
            <BookingDrawer
              detail={detailQuery.data}
              matchingVehicles={matchingQuery.data?.rows || []}
              matchingLoading={matchingQuery.isLoading || matchingQuery.isFetching}
              actionLoading={actionMutation.isPending || statusMutation.isPending}
              actionMessage={actionMessage}
              onAction={runAction}
              onAllot={allotVehicle}
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-hidden rounded-[2rem] p-0">
        <form onSubmit={onSubmit} className="flex max-h-[92dvh] flex-col">
          <DialogHeader className="relative border-b border-slate-100 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-6 text-white">
            <div className="absolute bottom-0 left-0 h-[3px] w-full bg-gradient-to-r from-red-600 via-[#c8102e] to-rose-500" />
            <DialogTitle className="text-2xl font-black tracking-tight text-white">Create AM Kia Booking</DialogTitle>
            <DialogDescription className="mt-1 font-semibold text-slate-300/80">Fill in the required customer, vehicle, sales team, payment, and delivery options.</DialogDescription>
          </DialogHeader>
          <div className="border-b border-slate-100 bg-slate-50 p-4">
            <div className="flex flex-wrap gap-1 rounded-2xl bg-slate-200/60 p-1.5 max-w-2xl">
              {CREATE_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onTabChange(tab)}
                  className={cn(
                    'flex-1 rounded-xl py-2.5 px-4 text-xs font-black uppercase tracking-[0.12em] transition-all duration-200',
                    activeTab === tab
                      ? 'bg-white text-slate-950 shadow-sm border border-slate-200/50'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-300/30'
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {error && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}
            {activeTab === 'Customer' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Customer Name" required><Input value={form.customerName} onChange={(event) => onChange('customerName', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Country Code" required><Input value={form.countryCode} onChange={(event) => onChange('countryCode', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Mobile number" required><Input value={form.customerPhone} onChange={(event) => onChange('customerPhone', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Customer Email Id" required><Input value={form.customerEmailId} onChange={(event) => onChange('customerEmailId', event.target.value)} className={INPUT_STYLE} /></Field>
              </div>
            )}
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
                <Field label="YEAR" required>
                  <Select value={form.year} onValueChange={(val) => onChange('year', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Year" /></SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="FUEL TYPE">
                  <Select value={form.fuelType} onValueChange={(val) => onChange('fuelType', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Fuel Type" /></SelectTrigger>
                    <SelectContent>
                      {FUEL_TYPES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="COLOUR" required>
                  <Select value={form.color} onValueChange={(val) => onChange('color', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Colour" /></SelectTrigger>
                    <SelectContent>
                      {COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="STATUS" required>
                  <Select value={form.status} onValueChange={(val) => onChange('status', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Stock Status" /></SelectTrigger>
                    <SelectContent>
                      {STOCK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Wating Period" required><Input value={form.waitingPeriod} onChange={(event) => onChange('waitingPeriod', event.target.value)} className={INPUT_STYLE} /></Field>
              </div>
            )}
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
                <Field label="TL Name" required>
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
            {activeTab === 'Payment' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="BOOKING AMOUNT" required><Input type="number" value={form.bookingAmount} onChange={(event) => onChange('bookingAmount', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="BOOKING DATE" required><Input type="date" value={form.bookingDate} onChange={(event) => onChange('bookingDate', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="PMT SOURCE" required><Input value={form.pmtSource} onChange={(event) => onChange('pmtSource', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="PAYMENT AMOUNT" required><Input type="number" value={form.paymentAmount} onChange={(event) => onChange('paymentAmount', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Payment Recevied Against Booking" required><Input value={form.paymentReceived} onChange={(event) => onChange('paymentReceived', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="COST SHEET" required><Input value={form.costSheet} onChange={(event) => onChange('costSheet', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Bank Finance" required>
                  <Select value={form.bankFinance} onValueChange={(val) => onChange('bankFinance', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Bank/Finance" /></SelectTrigger>
                    <SelectContent>
                      {BANKS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
            {activeTab === 'Delivery' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Estimated Delivery Date" required><Input type="date" value={form.expectedDeliveryDate} onChange={(event) => onChange('expectedDeliveryDate', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Promise date" required><Input type="date" value={form.promiseDate} onChange={(event) => onChange('promiseDate', event.target.value)} className={INPUT_STYLE} /></Field>
                <Field label="Any Commitment With Customer" required><Textarea value={form.commitment} onChange={(event) => onChange('commitment', event.target.value)} className="min-h-24 rounded-2xl border-slate-200 bg-white text-sm font-semibold text-slate-800" /></Field>
                <Field label="OTHER DEALER DETAILS" required><Input value={form.otherDealerDetails} onChange={(event) => onChange('otherDealerDetails', event.target.value)} className={INPUT_STYLE} /></Field>
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-slate-200 bg-slate-50 p-4">
            <Button type="button" variant="outline" className="rounded-2xl bg-white font-black" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="rounded-2xl bg-slate-950 font-black text-white hover:bg-slate-800" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />} Create Booking
            </Button>
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
    <div className="space-y-5 p-6">
      <SkeletonBlock className="h-8 w-72" />
      <SkeletonBlock className="h-14 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonBlock className="h-48" />
        <SkeletonBlock className="h-48" />
      </div>
      <SkeletonBlock className="h-72" />
    </div>
  )
}

function BookingDrawer({
  detail,
  matchingVehicles,
  matchingLoading,
  actionLoading,
  actionMessage,
  onAction,
  onAllot,
  onStatusChange,
}: {
  detail: BookingDetailPayload
  matchingVehicles: MatchingVehicle[]
  matchingLoading: boolean
  actionLoading: boolean
  actionMessage: string
  onAction: (action: 'proforma' | 'finance' | 'payment' | 'release' | 'deliver' | 'cancel' | 'transfer') => void
  onAllot: (vinNumber: string) => void
  onStatusChange: (status: string) => void
}) {
  const router = useRouter()
  const { booking, allocation, proforma, financeOrder, activities, transfers } = detail
  return (
    <>
      <div className="relative border-b border-slate-100 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-6 text-white">
        <div className="absolute bottom-0 left-0 h-[3px] w-full bg-gradient-to-r from-red-600 via-[#c8102e] to-rose-500" />
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Booking Detail</p>
        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-white">{booking.bookingNumber}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-300/80">{booking.customerName} · {booking.customerPhone}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={booking.status} />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Manual:</span>
              <Select value={booking.status} onValueChange={onStatusChange} disabled={actionLoading}>
                <SelectTrigger className="h-7 w-40 rounded-lg border border-white/20 bg-white/10 px-2 py-0 text-xs font-black text-white hover:bg-white/20">
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
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50 p-5">
        <Stepper status={booking.status} />
        {actionMessage && <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700">{actionMessage}</div>}
        {(() => {
          const meta = (booking.metadata || {}) as Record<string, unknown>
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
                action={proforma ? "View Proforma Details" : "Generate Proforma"}
                disabled={actionLoading}
                onClick={() => {
                  if (proforma) {
                    router.push(`/brands/kia/proforma/all-proforma-details?search=${proforma.number}`)
                  } else {
                    onAction('proforma')
                  }
                }}
              />
              <ActionCard title="Payment Confirmation" icon={ShieldCheck} value={allocation ? allocation.vinNumber : 'No active VIN'} status={booking.status === 'ready_delivery' || booking.status === 'delivered' ? 'Confirmed' : 'Pending Accounts'} action="Confirm Payment" disabled={actionLoading || !allocation || booking.status === 'ready_delivery' || booking.status === 'delivered'} onClick={() => onAction('payment')} />
            </div>
          )
        })()}

        <section className={cn(PRIMARY_SURFACE, 'p-5')}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-950">Vehicle Allocation</h3>
              <p className="text-sm font-semibold text-slate-500">Matchable VINs exclude local Retail and active allocations.</p>
            </div>
            {allocation && (
              <Button variant="outline" className="rounded-2xl bg-white font-black" disabled={actionLoading} onClick={() => onAction('release')}>
                {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />} Release VIN
              </Button>
            )}
          </div>
          {allocation ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-mono text-sm font-black text-emerald-800">{allocation.vinNumber}</p>
              <p className="mt-1 text-sm font-semibold text-emerald-700">{allocation.model} · {allocation.variant} · {allocation.color || 'Color NA'}</p>
            </div>
          ) : matchingLoading ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SkeletonBlock className="h-24" />
              <SkeletonBlock className="h-24" />
            </div>
          ) : matchingVehicles.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-500">No matching vehicles available for this booking.</p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {matchingVehicles.slice(0, 6).map((vehicle) => (
                <div key={vehicle.vinNumber} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-black text-slate-950">{vehicle.vinNumber}</p>
                      <p className="mt-1 text-sm font-bold text-slate-700">{vehicle.model} · {vehicle.variant}</p>
                      <p className="text-xs font-semibold text-slate-500">{vehicle.dealerCode} · {vehicle.color || 'Color NA'} · {vehicle.source === 'bbnd' ? 'BBND snapshot' : vehicle.stockStatus || 'DMS'}</p>
                    </div>
                    <Button size="sm" className="rounded-xl bg-slate-950 font-black text-white hover:bg-slate-800" disabled={actionLoading} onClick={() => onAllot(vehicle.vinNumber)}>
                      Allot
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className={cn(PRIMARY_SURFACE, 'p-5')}>
            <h3 className="text-lg font-black text-slate-950">Timeline</h3>
            <div className="mt-4 space-y-3">
              {activities.length === 0 ? <p className="text-sm font-semibold text-slate-500">No activity yet.</p> : activities.map((activity) => (
                <div key={activity.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-black text-slate-900">{activity.message}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{activity.actorName || 'System'} · {formatDate(activity.createdAt)}</p>
                </div>
              ))}
            </div>
          </section>
          <section className={cn(PRIMARY_SURFACE, 'p-5')}>
            <h3 className="text-lg font-black text-slate-950">Delivery & Transfers</h3>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Expected Delivery</p>
                <p className="mt-1 text-sm font-black text-slate-950">{formatDate(booking.expectedDeliveryDate)}</p>
              </div>
              {transfers.slice(0, 4).map((transfer) => (
                <div key={transfer.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-600">
                  {transfer.vinNumber} · {transfer.fromDealerCode || '-'} <ArrowRight className="inline h-3 w-3" /> {transfer.toDealerCode || '-'} · {transfer.status}
                </div>
              ))}
              <Button variant="outline" className="rounded-2xl bg-white font-black" disabled={actionLoading} onClick={() => onAction('transfer')}>
                Request Transfer
              </Button>
              <Button className="rounded-2xl bg-emerald-600 font-black text-white hover:bg-emerald-700" disabled={actionLoading} onClick={() => onAction('deliver')}>
                <CalendarCheck className="h-4 w-4" /> Mark Delivered
              </Button>
              <Button variant="outline" className="rounded-2xl border-rose-200 bg-white font-black text-rose-700 hover:bg-rose-50" disabled={actionLoading} onClick={() => onAction('cancel')}>
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
    <section className={cn(PRIMARY_SURFACE, 'p-5')}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white"><Icon className="h-5 w-5" /></div>
        <h3 className="text-lg font-black text-slate-950">{title}</h3>
      </div>
      <div className="mt-4 grid gap-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function ActionCard({ title, icon: Icon, value, status, action, disabled, onClick }: { title: string; icon: typeof ShieldCheck; value: string; status: string; action: string; disabled: boolean; onClick: () => void }) {
  return (
    <section className={cn(PRIMARY_SURFACE, 'p-5')}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white"><Icon className="h-5 w-5" /></div>
        <div>
          <h3 className="text-lg font-black text-slate-950">{title}</h3>
          <p className="text-xs font-semibold text-slate-500">{status}</p>
        </div>
      </div>
      <p className="mt-5 text-xl font-black text-slate-950">{value}</p>
      <Button className="mt-4 w-full rounded-2xl bg-slate-950 font-black text-white hover:bg-slate-800" disabled={disabled} onClick={onClick}>
        {disabled && <Loader2 className="h-4 w-4 animate-spin" />} {action}
      </Button>
    </section>
  )
}
