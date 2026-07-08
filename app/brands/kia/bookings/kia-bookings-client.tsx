'use client'

/* eslint-disable react-hooks/set-state-in-effect */

import { toast } from '@/hooks/use-toast'

import { ChangeEvent, createContext, FormEvent, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { canViewKiaCustomerPii, maskKiaPii } from '@/lib/kia/pii'
import {
  ArrowRight,
  BadgeIndianRupee,
  CalendarCheck,
  Car,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Upload,
  UserRound,
  XCircle,
  Eye,
  MoreVertical,
  Download,
  Share2,
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
import {
  AnimatedNumber,
  AnimatePresence,
  AutomotiveLoader,
  Chip,
  FieldValue,
  IconTile,
  InlineLoader,
  InspectorSkeleton,
  Kicker,
  KpiRow,
  LoaderOverlay,
  type LoaderVariant,
  motion,
  PremiumEmptyState,
  Reveal,
  Stagger,
  StaggerItem,
  SuccessOverlay,
  TableSkeleton as PremiumTableSkeleton,
  type Tone,
  toneSoftStyle,
  usePremiumMotion,
} from '@/components/kia/premium'
import {
  canAllotKiaVehicle,
  canApproveKiaProforma,
  canConfirmKiaPayment,
  canCreateKiaBooking,
  canDeliverKiaBooking,
  canVerifyKiaAccounts,
} from '@/lib/kia/workflow-access'

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
  color?: string | null
  consultantName: string
  consultantEmail?: string | null
  status: BookingStatus | string
  proformaNumber?: string | null
  financeOrderNumber?: string | null
  allocatedVin?: string | null
  deliveredAt?: string | null
  createdAt?: string | null
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
  customerType: string
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
  waitingPeriod: string
  dealerCode: string
  notes: string
}

const DEFAULT_PAGE_SIZE = 10
const ALL_VALUE = 'all'

// Customer phone / email are restricted to MD & Super Admin across the CRM. A
// file-local context lets the many presentational sub-components mask PII without
// threading a prop through every one.
const KiaPiiContext = createContext(false)
const useCanViewPii = () => useContext(KiaPiiContext)
const PRIMARY_SURFACE = 'kia-surface'
const INPUT_STYLE = 'h-10 w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-3 text-sm font-semibold text-slate-800 transition-all duration-200 focus:bg-white focus:border-[#c8102e] focus:ring-4 focus:ring-red-50 focus:outline-none sm:h-12 sm:px-4'
const COMPACT_INPUT_STYLE = 'h-9 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-xs font-semibold text-slate-800 transition-all duration-200 focus:bg-white focus:border-[#c8102e] focus:ring-4 focus:ring-red-50 focus:outline-none'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  booking_created: 'Booking Created',
  proforma_generated: 'Proforma Generated',
  on_hold: 'On Hold',
  vehicle_allocated: 'Vehicle Allocated',
  finance_pending: 'Finance Pending',
  payment_confirmed: 'Payment Confirmed',
  ready_delivery: 'Ready Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

// Maps a booking status to a premium chip tone (theme-token driven).
const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  booking_created: 'blue',
  proforma_generated: 'indigo',
  on_hold: 'amber',
  vehicle_allocated: 'sky',
  transfer_requested: 'teal',
  finance_pending: 'amber',
  payment_confirmed: 'blue',
  ready_delivery: 'violet',
  delivered: 'emerald',
  cancelled: 'rose',
}

function dealerCity(code?: string | null) {
  const value = String(code || '').trim().toUpperCase()
  if (value === 'JK402') return 'Jammu'
  if (value === 'JK501') return 'Udhampur'
  return ''
}

function paymentMeta(status: string, deliveredAt?: string | null): { label: string; tone: Tone } {
  const value = String(status || '').trim().toLowerCase()
  if (value === 'cancelled') return { label: 'Cancelled', tone: 'neutral' }
  // A delivered vehicle (or one paid & ready) has cleared payment.
  if (deliveredAt || value === 'delivered' || value === 'ready_delivery') return { label: 'Paid', tone: 'emerald' }
  return { label: 'Pending', tone: 'rose' }
}

// KPI widgets map each pipeline stage to a status filter + tone. Clicking a
// card filters the table to that stage.
const KPI_CONFIG: {
  key: string
  label: string
  icon: typeof ClipboardList
  tone: Tone
  hint: string
  statusFilter: string
}[] = [
  { key: 'today', label: 'Booked Today', icon: ClipboardList, tone: 'blue', hint: 'New bookings today', statusFilter: 'all' },
  { key: 'pendingProforma', label: 'Pending Proforma', icon: FileText, tone: 'indigo', hint: 'Awaiting proforma', statusFilter: 'booking_created' },
  { key: 'waitingAllocation', label: 'Awaiting VIN', icon: Car, tone: 'sky', hint: 'Approved · unallocated', statusFilter: 'proforma_generated' },
  { key: 'financePending', label: 'Payment Pending', icon: BadgeIndianRupee, tone: 'amber', hint: 'Accounts to confirm', statusFilter: 'vehicle_allocated' },
  { key: 'readyDelivery', label: 'Ready to Deliver', icon: Truck, tone: 'violet', hint: 'Paid · deliverable', statusFilter: 'ready_delivery' },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle2, tone: 'emerald', hint: 'Completed', statusFilter: 'delivered' },
  { key: 'cancelled', label: 'Cancelled', icon: XCircle, tone: 'rose', hint: 'Closed / lost', statusFilter: 'cancelled' },
]

const CREATE_TABS = ['Customer', 'Vehicle', 'Sales Team', 'Payment', 'Delivery', 'Review'] as const
const TEST_PERSONA_LABELS: Record<TestPersona, string> = {
  actual: 'Actual Role',
  sales_person: 'Sales Person',
  sales_manager: 'Sales Manager',
  accounts: 'Accounts',
}

function normalizeRole(role?: string | null) {
  return String(role || '').trim().toLowerCase()
}

// Role gating delegates to the shared workflow-access model (same rules the
// backend enforces). Legacy helper names are kept, remapped to the new roles:
//   sales manager  -> proforma approvers (sales_manager / general_manager / md)
//   sales person   -> booking/proforma creators (sales_executive + approvers)
//   "accounts"     -> the finance/accounts payment side (finance + accounts)
function roleCanActAsSalesManager(role?: string | null) {
  return canApproveKiaProforma(role)
}

function roleCanActAsAccounts(role?: string | null) {
  return canConfirmKiaPayment(role) || canVerifyKiaAccounts(role)
}

function roleCanActAsSalesPerson(role?: string | null) {
  return canCreateKiaBooking(role)
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

function TableSkeleton({ columns = 9, rows = 10 }: { columns?: number; rows?: number }) {
  return <PremiumTableSkeleton columns={columns} rows={rows} />
}

function EmptyState({
  title,
  description,
  illustration = 'garage',
  icon,
  action,
}: {
  title: string
  description: string
  illustration?: 'garage' | 'search' | 'road' | 'error'
  icon?: typeof ClipboardList
  action?: React.ReactNode
}) {
  return <PremiumEmptyState title={title} description={description} illustration={illustration} icon={icon} action={action} />
}

function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Chip tone={STATUS_TONE[status] || 'neutral'} dot className={className}>
      {statusLabel(status)}
    </Chip>
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
  const canViewPii = useCanViewPii()
  return (
    <article className="kia-surface-flush kia-lift p-3.5" onClick={() => onOpen(row.id)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Kicker>Booking</Kicker>
          <h3 className="mt-0.5 text-sm font-extrabold leading-5 text-[var(--kia-text)] kia-tnum">{row.bookingNumber}</h3>
          <p className="mt-1 truncate text-xs font-bold text-[var(--kia-text-soft)]">{row.customerName}</p>
          <p className="text-[11px] font-medium text-[var(--kia-text-faint)]">{maskKiaPii(row.customerPhone, canViewPii)}</p>
        </div>
        <StatusBadge status={row.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5 text-xs">
        <FieldValue label="Vehicle" value={<><span className="font-bold text-[var(--kia-text)]">{row.model || '—'}</span><br /><span className="text-[var(--kia-text-soft)]">{row.variant || '—'}</span></>} />
        <FieldValue label="Consultant" value={<>{row.consultantName || '—'}<br /><span className="text-[var(--kia-text-faint)]">{formatDate(row.updatedAt)}</span></>} />
        <FieldValue label="VIN" value={row.allocatedVin || '—'} mono />
        <FieldValue label="Finance" value={row.financeOrderNumber || '—'} />
      </div>
      <div className="mt-3" onClick={(event) => event.stopPropagation()}>
        {row.proformaNumber ? (
          <Link
            href={`/brands/kia/proforma/all-proforma-details?search=${row.proformaNumber}`}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border px-3 text-[11px] font-bold uppercase tracking-[0.06em]"
            style={toneSoftStyle('accent')}
          >
            Proforma ready <ArrowRight className="h-3 w-3" />
          </Link>
        ) : (
          <Button
            size="sm"
            className="h-9 w-full rounded-xl px-3 text-[11px] font-bold"
            onClick={() => router.push(`/brands/kia/proforma/generate?bookingId=${row.id}`)}
          >
            Generate Proforma
          </Button>
        )}
      </div>
    </article>
  )
}

const JOURNEY_STEPS = [
  { key: 'booking_created', label: 'Booking', icon: ClipboardList },
  { key: 'proforma_generated', label: 'Proforma', icon: FileText },
  { key: 'vehicle_allocated', label: 'VIN', icon: Car },
  { key: 'finance_pending', label: 'Payment', icon: BadgeIndianRupee },
  { key: 'ready_delivery', label: 'Ready', icon: ShieldCheck },
  { key: 'delivered', label: 'Delivered', icon: Truck },
] as const

const STEP_ORDER: Record<string, number> = {
  draft: 0,
  booking_created: 0,
  proforma_generated: 1,
  on_hold: 2,
  vehicle_allocated: 2,
  transfer_requested: 2,
  finance_pending: 3,
  ready_delivery: 4,
  delivered: 5,
}

function Stepper({ status }: { status: string }) {
  const animated = usePremiumMotion()
  const cancelled = status === 'cancelled'
  const currentIndex = status === 'delivered' ? 5 : STEP_ORDER[status] ?? 0
  const progress = cancelled ? 0 : currentIndex / (JOURNEY_STEPS.length - 1)
  return (
    <div className="kia-surface-flush px-3 py-4 sm:px-5">
      <div className="relative">
        {/* rail */}
        <div className="absolute left-4 right-4 top-4 h-[3px] rounded-full" style={{ backgroundColor: 'var(--kia-hairline-strong)' }} />
        <motion.div
          className="absolute left-4 top-4 h-[3px] rounded-full"
          style={{ background: 'linear-gradient(90deg, var(--dashboard-action-hover), var(--dashboard-action-bg))', maxWidth: 'calc(100% - 2rem)' }}
          initial={animated ? { width: 0 } : false}
          animate={{ width: `calc(${progress} * (100% - 2rem))` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
        <div className="relative grid grid-cols-6 gap-1">
          {JOURNEY_STEPS.map((step, index) => {
            const done = !cancelled && index < currentIndex
            const current = !cancelled && index === currentIndex
            const StepIcon = step.icon
            return (
              <div key={step.key} className="flex flex-col items-center gap-1.5 text-center">
                <motion.span
                  className="grid h-8 w-8 place-items-center rounded-full border-2"
                  style={{
                    backgroundColor: done || current ? 'var(--dashboard-action-bg)' : 'var(--kia-surface)',
                    borderColor: done || current ? 'var(--dashboard-action-bg)' : 'var(--kia-hairline-strong)',
                    color: done || current ? 'var(--dashboard-action-fg)' : 'var(--kia-text-faint)',
                  }}
                  initial={animated ? { scale: 0.6, opacity: 0 } : false}
                  animate={{ scale: current ? 1.08 : 1, opacity: 1 }}
                  transition={{ delay: index * 0.06, type: 'spring', stiffness: 380, damping: 22 }}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <StepIcon className="h-3.5 w-3.5" />}
                  {current && animated && (
                    <motion.span
                      className="absolute inset-0 rounded-full"
                      style={{ boxShadow: '0 0 0 2px var(--dashboard-action-bg)' }}
                      animate={{ opacity: [0.6, 0], scale: [1, 1.7] }}
                      transition={{ repeat: Infinity, duration: 1.8, ease: 'easeOut' }}
                    />
                  )}
                </motion.span>
                <span
                  className="text-[9px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: done || current ? 'var(--kia-text)' : 'var(--kia-text-faint)' }}
                >
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {cancelled && (
        <p className="mt-3 text-center text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--dashboard-risk-text)' }}>
          Booking cancelled
        </p>
      )}
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
  'ARUN SHARMA',
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
  'NAVAL PREET SINGH',
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
    customerType: 'Regular',
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
    waitingPeriod: '',
    dealerCode: 'JK402',
    notes: '',
  }
}

export function KiaBookingsClient({
  initialSearchParams,
  embedMode = false,
  currentUserRole = 'viewer',
  mode = 'crm',
  priceOptions,
}: {
  initialSearchParams: SearchParamsInput
  embedMode?: boolean
  currentUserRole?: string
  mode?: BookingClientMode
  priceOptions?: ProformaOptionsPayload | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState(firstParam(initialSearchParams, 'search'))
  const [debouncedSearch, setDebouncedSearch] = useState(() => firstParam(initialSearchParams, 'search'))
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
  const [accountsDialogOpen, setAccountsDialogOpen] = useState(false)
  const [accountsInvoiceNumber, setAccountsInvoiceNumber] = useState('')
  const [accountsReference, setAccountsReference] = useState('')
  const [accountsInvoiceFile, setAccountsInvoiceFile] = useState<File | null>(null)
  const [accountsNotes, setAccountsNotes] = useState('')
  const [createTab, setCreateTab] = useState<(typeof CREATE_TABS)[number]>('Customer')
  const [createForm, setCreateForm] = useState<CreateBookingForm>(() => initialCreateForm())
  const [formError, setFormError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [testPersona] = useState<TestPersona>('actual')
  // Which contextual automotive loader to show for the in-flight workflow action.
  const [loaderVariant, setLoaderVariant] = useState<LoaderVariant>('generic')
  const [priceUploading, setPriceUploading] = useState(false)
  const priceInputRef = useRef<HTMLInputElement>(null)
  const [createSuccess, setCreateSuccess] = useState(false)
  const [deliverySuccess, setDeliverySuccess] = useState(false)
  const [allotSuccess, setAllotSuccess] = useState(false)

  async function handlePriceUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setPriceUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/brands/kia/proforma/price-details/upload', { method: 'POST', body: formData })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Failed to import price details')
      const summary = payload.summary
      toast({
        title: 'Price Master Updated',
        description: summary ? `Imported ${summary.importedRows} rows${summary.failedRows ? `, ${summary.failedRows} failed` : ''}.` : 'Prices replaced successfully.',
        variant: 'success',
      })
      queryClient.invalidateQueries({ queryKey: ['kia-proforma-options-for-bookings'] })
    } catch (err) {
      toast({ title: 'Import Failed', description: err instanceof Error ? err.message : 'Failed to import price details', variant: 'error' })
    } finally {
      setPriceUploading(false)
      if (priceInputRef.current) priceInputRef.current.value = ''
    }
  }
  const canUseTestPersona = currentUserRole === 'developer'
  const normalizedCurrentRole = normalizeRole(currentUserRole)
  const canCreateBookings = roleCanActAsSalesPerson(normalizedCurrentRole)
  const canViewPii = canViewKiaCustomerPii(currentUserRole)
  const stockMode = mode === 'stock'
  const animated = usePremiumMotion()

  const selectedBookingId = searchParams.get('bookingId') || ''

  // Debounce search so the bookings list query doesn't refire on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

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
    search: debouncedSearch,
    dealer_code: dealer,
    model,
    status,
    consultant,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  }), [consultant, dealer, debouncedSearch, model, page, status])

  const listQuery = useQuery({
    queryKey: ['kia-bookings', listQueryString],
    queryFn: () => fetchJson<BookingListPayload>(`/api/brands/kia/bookings?${listQueryString}`, 'kia-bookings-list'),
    retry: 2,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    // Keep the current rows on screen while a page/filter change refetches, so the
    // table never flashes an empty skeleton — pagination + search feel instant.
    placeholderData: keepPreviousData,
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
    enabled: !priceOptions,
  })

  const createMutation = useMutation({
    mutationFn: (payload: CreateBookingForm) => fetchJson<{ id: string }>('/api/brands/kia/bookings', 'kia-booking-create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    onSuccess: () => {
      // Play the success celebration; the dialog closes when it finishes.
      setCreateSuccess(true)
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
      if (loaderVariant === 'delivery') setDeliverySuccess(true)
      if (loaderVariant === 'vin-match') setAllotSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', selectedBookingId] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-matching-vehicles', selectedBookingId] })
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : 'Action failed'),
  })

  const paymentMutation = useMutation({
    mutationFn: async ({ bookingId, reference }: { bookingId: string; reference: string }) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)
      try {
        const response = await fetch(`/api/brands/kia/bookings/${bookingId}/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference: reference.trim() || null }),
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
      setActionMessage('Payment confirmed. Sent to Accounts for invoice verification.')
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', selectedBookingId] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-matching-vehicles', selectedBookingId] })
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : 'Payment confirmation failed'),
  })

  const accountsMutation = useMutation({
    mutationFn: async ({ bookingId, invoiceNumber, reference, invoiceFile, notes }: { bookingId: string; invoiceNumber: string; reference: string; invoiceFile: File | null; notes: string }) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)
      try {
        const formData = new FormData()
        formData.append('invoiceNumber', invoiceNumber.trim())
        if (reference.trim()) formData.append('reference', reference.trim())
        if (notes.trim()) formData.append('notes', notes.trim())
        if (invoiceFile) formData.append('invoice', invoiceFile)
        const response = await fetch(`/api/brands/kia/bookings/${bookingId}/accounts-verify`, {
          method: 'POST',
          body: formData,
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null
          throw new Error(payload?.error || 'Failed to verify accounts')
        }
        return await response.json() as { ok: boolean }
      } finally {
        clearTimeout(timeout)
      }
    },
    onSuccess: () => {
      setAccountsDialogOpen(false)
      setAccountsInvoiceNumber('')
      setAccountsReference('')
      setAccountsInvoiceFile(null)
      setAccountsNotes('')
      setActionMessage('Payment released & invoice recorded. Ready for the Sales Executive to deliver.')
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', selectedBookingId] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-matching-vehicles', selectedBookingId] })
    },
    onError: (error) => setActionMessage(error instanceof Error ? error.message : 'Accounts verification failed'),
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
      toast({ title: 'Proforma Generated', description: 'Proforma generated successfully!', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
    },
    onError: (error) => {
      toast({ title: 'Generation Failed', description: error instanceof Error ? error.message : 'Failed to generate proforma', variant: 'error' })
    },
    onSettled: () => {
      setGeneratingId(null)
    },
  })

  const data = listQuery.data
  const priceModels = priceOptions?.models || proformaOptionsQuery.data?.models || []
  const priceTrims = useMemo(() => priceOptions?.trims || proformaOptionsQuery.data?.trims || [], [priceOptions?.trims, proformaOptionsQuery.data?.trims])
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
  const priceBanks = useMemo(() => priceOptions?.banks || proformaOptionsQuery.data?.banks || [], [priceOptions?.banks, proformaOptionsQuery.data?.banks])
  const bookingBankOptions = useMemo(() => {
    const names = priceBanks.map((b) => b.bank_name || '').filter(Boolean)
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
  }, [priceBanks])
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
    // Only the explicit "Create Booking" button on the final Review step may
    // submit — guards against a stray form submission while stepping through.
    if (createTab !== 'Review') return
    setFormError('')
    const requiredFields: Array<[keyof CreateBookingForm, string]> = [
      ['customerName', 'Customer Name'],
      ['countryCode', 'Country Code'],
      ['customerPhone', 'Mobile number'],
      ['customerEmailId', 'Customer Email Id'],
      ['model', 'Model'],
      ['year', 'YEAR'],
      ['variant', 'Variant'],
      ['color', 'Colour'],
      ['status', 'Stock Status'],
      ['managerName', 'Manager Name'],
      ['tlName', 'Team Leader'],
      ['consultantName', 'Consultant Name'],
      ['leadSource', 'Lead Source'],
      ['bookingAmount', 'Booking Amount'],
      ['bookingDate', 'Booking Date'],
      ['pmtSource', 'Payment Source'],
      ['paymentAmount', 'Payment Amount'],
      ['costSheet', 'Cost Sheet'],
      ['bankFinance', 'Bank / Finance'],
      ['expectedDeliveryDate', 'Estimated Delivery Date'],
      ['promiseDate', 'Promise Date'],
    ]
    const missing = requiredFields.find(([key]) => !createForm[key]?.trim())
    if (missing) {
      setFormError(`${missing[1]} is required.`)
      const tabByField: Record<keyof CreateBookingForm, (typeof CREATE_TABS)[number]> = {
        customerName: 'Customer',
        customerType: 'Customer',
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

  function runAction(action: 'proforma' | 'finance' | 'payment' | 'accounts' | 'release' | 'deliver' | 'cancel' | 'transfer') {
    if (!selectedBookingId) return
    if (action === 'proforma') {
      router.push(`/brands/kia/proforma/generate?bookingId=${selectedBookingId}`)
      return
    }
    if (action === 'payment') {
      setPaymentDialogOpen(true)
      return
    }
    if (action === 'accounts') {
      setAccountsDialogOpen(true)
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
    setLoaderVariant(action === 'deliver' ? 'delivery' : 'generic')
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
    setLoaderVariant('transfer')
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
    setLoaderVariant('vin-match')
    actionMutation.mutate({
      endpoint: `/api/brands/kia/bookings/${selectedBookingId}/allot`,
      body: { vinNumber },
    })
  }

  function confirmAllot() {
    if (!selectedBookingId || !allotDialogVehicle) return
    setLoaderVariant('vin-match')
    actionMutation.mutate({
      endpoint: `/api/brands/kia/bookings/${selectedBookingId}/allot`,
      body: { vinNumber: allotDialogVehicle.vinNumber },
    })
  }

  function markPaymentNotReceived() {
    if (!selectedBookingId) return
    setLoaderVariant('generic')
    actionMutation.mutate({
      endpoint: `/api/brands/kia/bookings/${selectedBookingId}/release`,
      body: { reason: 'Payment not received within reservation window' },
    })
  }

  function confirmPayment() {
    if (!selectedBookingId) return
    setLoaderVariant('payment')
    paymentMutation.mutate({
      bookingId: selectedBookingId,
      reference: paymentReference,
    })
  }

  function confirmAccounts() {
    if (!selectedBookingId) return
    if (!accountsInvoiceNumber.trim()) {
      setActionMessage('Invoice number is required.')
      return
    }
    setLoaderVariant('payment')
    accountsMutation.mutate({
      bookingId: selectedBookingId,
      invoiceNumber: accountsInvoiceNumber,
      reference: accountsReference,
      invoiceFile: accountsInvoiceFile,
      notes: accountsNotes,
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

  const headerActions = (
    <>
      {canCreateBookings && !stockMode && (
        <>
          <Button className="h-10 rounded-2xl px-4 text-sm font-bold sm:h-11" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Booking
          </Button>
          <Button variant="outline" className="h-10 rounded-2xl px-4 text-sm font-bold sm:h-11" onClick={() => setQuoteOpen(true)}>
            <FileText className="h-4 w-4" /> Email Quote
          </Button>
          <input
            type="file"
            ref={priceInputRef}
            // Include MIME types alongside extensions — some OS file pickers grey out
            // Excel files when only bare extensions are given.
            accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12"
            onChange={handlePriceUpload}
            className="hidden"
          />
          <Button variant="outline" className="h-10 rounded-2xl px-4 text-sm font-bold sm:h-11" onClick={() => priceInputRef.current?.click()} disabled={priceUploading}>
            {priceUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Replace Prices
          </Button>
        </>
      )}
      <Button variant="outline" className="h-10 rounded-2xl px-4 text-sm font-bold sm:h-11" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
        <RefreshCw className={cn('h-4 w-4', listQuery.isFetching && 'animate-spin')} /> Refresh
      </Button>
    </>
  )

  const content = (
    <KiaPiiContext.Provider value={canViewPii}>
      <div className="kia-premium space-y-5">
        {/* ── Command header ── */}
        {embedMode ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {headerActions}
          </div>
        ) : (
          <Reveal>
            <section className="kia-surface relative overflow-hidden">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-20 -top-24 h-60 w-60 rounded-full"
                style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--dashboard-action-bg) 16%, transparent), transparent 70%)' }}
              />
              <div className="relative p-4 sm:p-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3.5">
                      <IconTile icon={stockMode ? Car : ClipboardList} tone="accent" size="lg" />
                      <div className="min-w-0">
                        <Kicker>{currentHeading.badge}</Kicker>
                        <h1 className="mt-0.5 truncate text-2xl font-extrabold tracking-tight text-[var(--kia-text)] sm:text-[2rem] sm:leading-none">{currentHeading.title}</h1>
                      </div>
                    </div>
                    <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-[var(--kia-text-soft)]">{currentHeading.subtitle}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-2.5">
                    {headerActions}
                  </div>
                </div>
              </div>
            </section>
          </Reveal>
        )}

        {/* ── KPI pipeline (click a card to filter the table) ── */}
        {!stockMode && (
          <KpiRow
            items={KPI_CONFIG.map((cfg) => ({
              key: cfg.key,
              label: cfg.label,
              value: (kpis as Record<string, number>)[cfg.key] ?? 0,
              icon: cfg.icon,
              tone: cfg.tone,
              hint: cfg.hint,
              active: cfg.statusFilter !== 'all' && status === cfg.statusFilter,
            }))}
            onSelect={(key) => {
              const cfg = KPI_CONFIG.find((item) => item.key === key)
              if (!cfg) return
              setPage(1)
              if (cfg.statusFilter === 'all') { setStatus(ALL_VALUE); return }
              setStatus((prev) => (prev === cfg.statusFilter ? ALL_VALUE : cfg.statusFilter))
            }}
          />
        )}

        <AnimatePresence>
          {actionMessage && !selectedBookingId && (
            <motion.div
              initial={animated ? { opacity: 0, y: -6 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold"
              style={toneSoftStyle('success')}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {actionMessage}
            </motion.div>
          )}
        </AnimatePresence>

        {stockSectionHint && (
          <div className="flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold" style={toneSoftStyle('info')}>
            <Car className="h-4 w-4 shrink-0" />
            {stockSectionHint}
          </div>
        )}

        <section className={cn(PRIMARY_SURFACE, 'sticky top-2 z-20 p-2.5 sm:top-3 sm:p-3')}>
          <div className="grid gap-2 sm:gap-2.5 lg:grid-cols-[1.5fr_repeat(4,minmax(0,0.85fr))_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kia-text-faint)]" />
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search booking, customer, phone, VIN…" className={cn(INPUT_STYLE, '!pl-10 sm:!pl-11')} />
            </div>
            <FilterSelect value={dealer} placeholder="Dealer" values={filters.dealers} onChange={(value) => { setDealer(value); setPage(1) }} />
            <FilterSelect value={model} placeholder="Model" values={filters.models} onChange={(value) => { setModel(value); setPage(1) }} />
            <FilterSelect value={status} placeholder="Status" values={filters.statuses} onChange={(value) => { setStatus(value); setPage(1) }} labeler={statusLabel} />
            <FilterSelect value={consultant} placeholder="Consultant" values={filters.consultants} onChange={(value) => { setConsultant(value); setPage(1) }} />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-10 flex-1 gap-1.5 rounded-2xl text-xs font-bold sm:h-11 sm:text-sm"
                onClick={() => {
                  const header = ['Booking ID', 'Customer', 'Phone', 'Vehicle', 'Variant', 'Colour', 'Dealer', 'Status', 'Booking Date', 'Payment']
                  const body = rows.map((r) => [r.bookingNumber, r.customerName, maskKiaPii(r.customerPhone, canViewPii), r.model, r.variant, r.color || '', r.dealerCode, String(r.status), formatDate(r.createdAt || r.updatedAt), paymentMeta(String(r.status), r.deliveredAt).label])
                  const csv = [header, ...body].map((cols) => cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
                  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
                  const link = document.createElement('a')
                  link.href = url
                  link.download = `kia-bookings-${new Date().toISOString().slice(0, 10)}.csv`
                  link.click()
                  URL.revokeObjectURL(url)
                }}
                disabled={rows.length === 0}
              >
                <Download className="h-4 w-4" /> Export
              </Button>
              <Button variant="outline" className="h-10 flex-1 rounded-2xl text-xs font-bold sm:h-11 sm:text-sm" onClick={() => { setSearch(''); setDealer(ALL_VALUE); setModel(ALL_VALUE); setStatus(ALL_VALUE); setConsultant(ALL_VALUE); setPage(1) }}>
                Clear
              </Button>
            </div>
          </div>
        </section>

        {listQuery.isLoading ? (
          <TableSkeleton columns={8} />
        ) : listQuery.isError ? (
          <EmptyState
            illustration="error"
            title="Unable to load bookings"
            description={listQuery.error instanceof Error ? listQuery.error.message : 'The bookings request failed. Refresh to retry or check the server logs if it repeats.'}
            action={(
              <Button variant="outline" className="h-10 rounded-2xl font-bold" onClick={() => listQuery.refetch()}>
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
            )}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            illustration={search || dealer !== ALL_VALUE || model !== ALL_VALUE || status !== ALL_VALUE || consultant !== ALL_VALUE ? 'search' : 'garage'}
            title={currentEmptyState.title}
            description={currentEmptyState.description}
            action={canCreateBookings && !stockMode ? (
              <Button className="h-10 rounded-2xl font-bold" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> New Booking
              </Button>
            ) : undefined}
          />
        ) : (
          <section className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
            <div className="flex items-center justify-between gap-3 border-b border-[var(--kia-hairline)] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl" style={toneSoftStyle('accent')}>
                  <ClipboardList className="h-[1.05rem] w-[1.05rem]" />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--kia-text-faint)]">Bookings</p>
                  <h2 className="text-sm font-extrabold text-[var(--kia-text)]">
                    <AnimatedNumber value={data?.total || 0} /> records
                  </h2>
                </div>
              </div>
              {listQuery.isFetching && <InlineLoader variant="search" size={28} />}
            </div>
            <div className="grid gap-3 p-3 sm:hidden">
              {rows.map((row) => (
                <BookingMobileCard key={row.id} row={row} onOpen={openBooking} />
              ))}
            </div>
            <Table className="hidden sm:table kia-table">
              <TableHeader>
                <TableRow>
                  {['Booking ID', 'Customer', 'Vehicle', 'Dealer', 'Status', 'Booking Date', 'Payment', 'Actions'].map((head) => (
                    <TableHead key={head} className="h-10 whitespace-nowrap px-3">{head}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const pay = paymentMeta(String(row.status), row.deliveredAt)
                  const city = dealerCity(row.dealerCode)
                  const isClosed = row.status === 'delivered' || row.status === 'cancelled'
                  return (
                    <motion.tr
                      key={row.id}
                      className="group cursor-pointer border-b border-[var(--kia-hairline)] text-sm"
                      onClick={() => openBooking(row.id)}
                      initial={animated ? { opacity: 0, y: 6 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: Math.min(index * 0.025, 0.32), ease: [0.16, 1, 0.3, 1] }}
                    >
                      <TableCell className="px-3 py-3 text-xs font-extrabold leading-5 text-[var(--kia-text)]"><span className="kia-tnum">{row.bookingNumber}</span></TableCell>
                      <TableCell className="px-3 py-3">
                        <div className="text-sm font-bold leading-5 text-[var(--kia-text)]">{row.customerName}</div>
                        <div className="text-[11px] font-medium text-[var(--kia-text-soft)]">{maskKiaPii(row.customerPhone, canViewPii)}</div>
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <div className="text-sm font-semibold leading-5 text-[var(--kia-text)]">{row.model}</div>
                        <div className="max-w-[240px] truncate text-[11px] text-[var(--kia-text-soft)]">{[row.variant, row.color].filter(Boolean).join(' · ')}</div>
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <div className="text-xs font-bold text-[var(--kia-text)]">{row.dealerCode || '—'}</div>
                        {city && <div className="text-[11px] font-medium text-[var(--kia-text-soft)]">{city}</div>}
                      </TableCell>
                      <TableCell className="px-3 py-3"><StatusBadge status={row.status} /></TableCell>
                      <TableCell className="px-3 py-3 text-xs font-semibold text-[var(--kia-text-soft)]">{formatDate(row.createdAt || row.updatedAt)}</TableCell>
                      <TableCell className="px-3 py-3"><Chip tone={pay.tone}>{pay.label}</Chip></TableCell>
                      <TableCell className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button type="button" title="View booking" onClick={() => openBooking(row.id)} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--kia-text)]">
                            <Eye className="h-4 w-4" />
                          </button>
                          {row.proformaNumber ? (
                            <Link href={`/brands/kia/proforma/all-proforma-details?search=${row.proformaNumber}`} title="Open proforma" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--dashboard-action-bg)]">
                              <FileText className="h-4 w-4" />
                            </Link>
                          ) : canCreateBookings && !isClosed ? (
                            <button type="button" title="Generate proforma" onClick={() => router.push(`/brands/kia/proforma/generate?bookingId=${row.id}`)} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--dashboard-action-bg)]">
                              <FileText className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="grid h-8 w-8 place-items-center text-[var(--kia-text-faint)]"><FileText className="h-4 w-4 opacity-40" /></span>
                          )}
                          <button type="button" title="Open / act" onClick={() => openBooking(row.id)} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--kia-text)]">
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </div>
                      </TableCell>
                    </motion.tr>
                  )
                })}
              </TableBody>
            </Table>
            <div className="flex flex-col gap-3 border-t border-[var(--kia-hairline)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold text-[var(--kia-text-soft)]">
                Page <span className="kia-tnum font-bold text-[var(--kia-text)]">{data?.page || page}</span> of {data?.totalPages || 1}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="h-9 rounded-xl text-xs font-bold" disabled={page <= 1 || listQuery.isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
                <Button variant="outline" className="h-9 rounded-xl text-xs font-bold" disabled={page >= (data?.totalPages || 1) || listQuery.isFetching} onClick={() => setPage((current) => current + 1)}>Next</Button>
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
        bankOptions={bookingBankOptions}
        masterLoading={proformaOptionsQuery.isLoading}
        error={formError || (createMutation.error instanceof Error ? createMutation.error.message : '')}
        isSubmitting={createMutation.isPending}
        showSuccess={createSuccess}
        onSuccessDone={() => {
          setCreateSuccess(false)
          setCreateOpen(false)
          setCreateForm(initialCreateForm())
          setCreateTab('Customer')
          setActionMessage('Booking created successfully. Open it from the table when you are ready for the next stage.')
        }}
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

      {/* FINANCE stage — confirm payment received only (no invoice) */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="kia-premium max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-xl overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
          <LoaderOverlay show={paymentMutation.isPending} variant="payment" label="Confirming payment…" sublabel="Sending to Accounts for verification" />
          <DialogHeader className="border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,#dcfce7,transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            <Badge variant="outline" className="mb-3 w-fit rounded-full border-emerald-100 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Finance · Payment</Badge>
            <DialogTitle className="text-2xl font-black tracking-tight text-slate-950">Confirm Payment Received</DialogTitle>
            <DialogDescription className="mt-2 text-xs font-semibold leading-5 text-slate-500 sm:text-sm">
              Confirm the customer&apos;s payment has been received. Invoice number and PDF are recorded next by the Accounts team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            <div>
              <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Payment Reference / UTR</Label>
              <Input className={cn(INPUT_STYLE, 'mt-1.5')} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Optional reference / UTR" />
            </div>
          </div>
          <DialogFooter className="grid gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:flex sm:p-4">
            <Button type="button" variant="outline" className="h-10 rounded-xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 sm:text-sm" onClick={() => setPaymentDialogOpen(false)} disabled={paymentMutation.isPending}>Cancel</Button>
            <Button type="button" className="h-10 rounded-xl bg-emerald-600 text-xs font-black text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 sm:text-sm" onClick={confirmPayment} disabled={paymentMutation.isPending}>
              {paymentMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Confirm Payment Received
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ACCOUNTS stage — enter invoice #, upload invoice PDF, verify documents */}
      <Dialog open={accountsDialogOpen} onOpenChange={setAccountsDialogOpen}>
        <DialogContent className="kia-premium max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-xl overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
          <LoaderOverlay show={accountsMutation.isPending} variant="payment" label="Verifying with Accounts…" sublabel="Recording invoice and confirming documents" />
          <DialogHeader className="border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,#ede9fe,transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            <Badge variant="outline" className="mb-3 w-fit rounded-full border-violet-100 bg-violet-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-violet-700">Accounts · Payment &amp; Invoice</Badge>
            <DialogTitle className="text-2xl font-black tracking-tight text-slate-950">Confirm Payment &amp; Record Invoice</DialogTitle>
            <DialogDescription className="mt-2 text-xs font-semibold leading-5 text-slate-500 sm:text-sm">
              Confirm the payment has been released, enter the invoice number, and upload the invoice PDF. Completing this unlocks delivery.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            <div>
              <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Invoice Number <span className="text-red-500">*</span></Label>
              <Input className={cn(INPUT_STYLE, 'mt-1.5')} value={accountsInvoiceNumber} onChange={(event) => setAccountsInvoiceNumber(event.target.value)} placeholder="e.g. INV-2026-0001" />
            </div>
            <div>
              <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Payment Reference / UTR</Label>
              <Input className={cn(INPUT_STYLE, 'mt-1.5')} value={accountsReference} onChange={(event) => setAccountsReference(event.target.value)} placeholder="Optional reference / UTR" />
            </div>
            <div>
              <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Invoice PDF</Label>
              <Input className={cn(INPUT_STYLE, 'mt-1.5 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-xs file:font-black file:text-white')} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => setAccountsInvoiceFile(event.target.files?.[0] || null)} />
              <p className="mt-1 text-[11px] font-semibold text-slate-500">Upload the tax invoice for audit and records.</p>
            </div>
            <div>
              <Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Notes</Label>
              <Textarea className="mt-1.5 min-h-20 rounded-2xl border-slate-200 bg-white text-sm font-semibold text-slate-800" value={accountsNotes} onChange={(event) => setAccountsNotes(event.target.value)} placeholder="Any verification notes…" />
            </div>
          </div>
          <DialogFooter className="grid gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:flex sm:p-4">
            <Button type="button" variant="outline" className="h-10 rounded-xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 sm:text-sm" onClick={() => setAccountsDialogOpen(false)} disabled={accountsMutation.isPending}>Cancel</Button>
            <Button type="button" className="h-10 rounded-xl bg-violet-600 text-xs font-black text-white shadow-lg shadow-violet-600/20 hover:bg-violet-700 sm:text-sm" onClick={confirmAccounts} disabled={accountsMutation.isPending}>
              {accountsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Verify &amp; Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(allotDialogVehicle)} onOpenChange={(open) => !open && setAllotDialogVehicle(null)}>
        <DialogContent className="kia-premium flex flex-col max-h-[90dvh] w-[calc(100vw-0.75rem)] max-w-2xl overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_25px_70px_rgba(15,23,42,0.2)]">
          <LoaderOverlay show={actionMutation.isPending} variant="vin-match" label="Allocating VIN…" sublabel="Reserving the unit for 72 hours" />
          <DialogHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] p-4 sm:p-5">
            <DialogTitle className="text-lg font-black tracking-tight text-slate-950">Allot this car</DialogTitle>
            <DialogDescription className="mt-1 max-w-xl text-xs font-semibold leading-5 text-slate-500">
              Link this VIN to the selected approved booking. Customer details are pulled from the booking and the 72-hour payment clock starts immediately after allotment.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs font-semibold leading-5 text-slate-800">
              <span className="font-bold text-slate-950">{allotDialogVehicle?.model}</span> {allotDialogVehicle?.variant} <span className="text-slate-400">·</span> {allotDialogVehicle?.color || 'Color NA'} <span className="text-slate-400">·</span> {allotDialogVehicle?.stockAge || 0} days on lot <span className="text-slate-400">·</span> <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-[10px]">{allotDialogVehicle?.vinNumber}</code>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Booking ID</Label>
                <Input readOnly value={detailQuery.data?.booking.bookingNumber || ''} className={cn(COMPACT_INPUT_STYLE, 'mt-1 bg-slate-100/50 text-[11px] font-mono tracking-wider')} />
              </div>
              <div>
                <Label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Customer name (from booking)</Label>
                <Input readOnly value={detailQuery.data?.booking.customerName || ''} className={cn(COMPACT_INPUT_STYLE, 'mt-1 bg-slate-100/50')} />
              </div>
              <div>
                <Label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Contact number (from booking)</Label>
                <Input readOnly value={maskKiaPii(detailQuery.data?.booking.customerPhone, canViewPii)} className={cn(COMPACT_INPUT_STYLE, 'mt-1 bg-slate-100/50')} />
              </div>
              <div>
                <Label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Financier</Label>
                <Input readOnly value={detailQuery.data?.booking.bankName || String(((detailQuery.data?.booking.metadata || {}) as Record<string, unknown>).bankFinance || 'Cash / not decided')} className={cn(COMPACT_INPUT_STYLE, 'mt-1 bg-slate-100/50')} />
              </div>
              <div>
                <Label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Manager</Label>
                <Input readOnly value={String(((detailQuery.data?.booking.metadata || {}) as Record<string, unknown>).managerName || '-')} className={cn(COMPACT_INPUT_STYLE, 'mt-1 bg-slate-100/50')} />
              </div>
              <div>
                <Label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Team Leader</Label>
                <Input readOnly value={String(((detailQuery.data?.booking.metadata || {}) as Record<string, unknown>).tlName || '-')} className={cn(COMPACT_INPUT_STYLE, 'mt-1 bg-slate-100/50')} />
              </div>
              <div>
                <Label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Consultant</Label>
                <Input readOnly value={detailQuery.data?.booking.consultantName || '-'} className={cn(COMPACT_INPUT_STYLE, 'mt-1 bg-slate-100/50')} />
              </div>
              <div>
                <Label className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Remarks (optional)</Label>
                <Input readOnly value={String(((detailQuery.data?.booking.metadata || {}) as Record<string, unknown>).commitment || '') || 'Booking details will remain linked in the timeline.'} className={cn(COMPACT_INPUT_STYLE, 'mt-1 bg-slate-100/50')} />
              </div>
            </div>
          </div>
          <DialogFooter className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3 sm:px-5">
            <Button type="button" variant="outline" className="h-9 rounded-xl border-slate-200 bg-white px-4 text-xs font-black" onClick={() => setAllotDialogVehicle(null)} disabled={actionMutation.isPending}>Cancel</Button>
            <Button type="button" className="h-9 rounded-xl bg-slate-950 px-4 text-xs font-black text-white shadow-md shadow-slate-950/15 hover:bg-slate-800" onClick={confirmAllot} disabled={actionMutation.isPending}>
              {actionMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Allot car
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(transferTarget)} onOpenChange={(open) => !open && setTransferTarget(null)}>
        <DialogContent className="kia-premium max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-4xl overflow-hidden rounded-[1.5rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
          <LoaderOverlay show={actionMutation.isPending} variant="transfer" label="Requesting transfer…" sublabel="Moving the VIN between outlets" />
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
          className="kia-premium fixed inset-y-0 !left-0 sm:!left-auto !right-0 !top-0 z-50 !flex min-w-0 h-dvh max-h-dvh w-full max-w-full sm:max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l p-0 shadow-[0_30px_110px_rgba(15,23,42,0.32)] duration-300 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:!w-[min(940px,calc(100vw-2rem))] sm:rounded-l-[2rem]"
          style={{ backgroundColor: 'var(--kia-canvas)', borderColor: 'var(--kia-hairline)' }}
        >
          <DialogTitle className="sr-only">Booking Details</DialogTitle>
          <SuccessOverlay show={deliverySuccess} variant="delivery" label="Vehicle delivered!" sublabel="Handed over to the customer" onDone={() => setDeliverySuccess(false)} />
          <SuccessOverlay show={allotSuccess} variant="generic" label="Vehicle allotted!" sublabel="VIN reserved for this booking" onDone={() => setAllotSuccess(false)} />
          {detailQuery.isLoading ? (
            <DrawerSkeleton />
          ) : detailQuery.isError ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <AutomotiveLoader variant="generic" label={null} size={90} />
              <h2 className="mt-4 text-2xl font-extrabold text-[var(--kia-text)]">Unable to load booking</h2>
              <p className="mt-2 text-sm font-medium text-[var(--kia-text-soft)]">{detailQuery.error instanceof Error ? detailQuery.error.message : 'The booking detail request failed.'}</p>
            </div>
          ) : detailQuery.data ? (
            <BookingDrawer
              detail={detailQuery.data}
              currentUserRole={currentUserRole}
              testPersona={canUseTestPersona ? testPersona : 'actual'}
              canUseTestPersona={canUseTestPersona}
              matchingVehicles={matchingQuery.data?.rows || []}
              matchingLoading={matchingQuery.isLoading || matchingQuery.isFetching}
              actionLoading={actionMutation.isPending || statusMutation.isPending || paymentMutation.isPending || accountsMutation.isPending}
              actionLoaderVariant={loaderVariant}
              actionMessage={actionMessage}
              onAction={runAction}
              onAllot={allotVehicle}
              onOpenTransfer={openTransferDialog}
              onPaymentNotReceived={markPaymentNotReceived}
              onStatusChange={(status) => { setLoaderVariant('generic'); statusMutation.mutate(status) }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </KiaPiiContext.Provider>
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

const BOOKING_DRAFT_KEY = 'kia-booking-draft-v1'

// Returns the first invalid/missing required field for a wizard step, or null.
function getBookingStepError(tab: (typeof CREATE_TABS)[number], form: CreateBookingForm): string | null {
  const req = (key: keyof CreateBookingForm, label: string) => (!String(form[key] || '').trim() ? `${label} is required.` : null)
  if (tab === 'Customer') {
    if (getBookingStepMissing(form, 'customerName')) return 'Customer Name is required.'
    const digits = String(form.customerPhone || '').replace(/\D/g, '')
    if (digits.length !== 10) return 'Mobile Number must be exactly 10 digits.'
    if (!String(form.customerEmailId || '').trim()) return 'Customer Email is required.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmailId.trim())) return 'Enter a valid email address.'
    return req('dealerCode', 'Dealer')
  }
  if (tab === 'Vehicle') return req('model', 'Model') || req('variant', 'Variant') || req('color', 'Colour')
  if (tab === 'Sales Team') return req('managerName', 'Manager') || req('tlName', 'Team Leader') || req('consultantName', 'Consultant') || req('leadSource', 'Lead Source')
  if (tab === 'Payment') return req('bookingAmount', 'Booking Amount') || req('bookingDate', 'Booking Date') || req('pmtSource', 'Payment Source') || req('paymentAmount', 'Payment Amount') || req('costSheet', 'Cost Sheet') || req('bankFinance', 'Bank / Finance')
  if (tab === 'Delivery') return req('expectedDeliveryDate', 'Estimated Delivery Date') || req('promiseDate', 'Promise Date')
  return null
}

function getBookingStepMissing(form: CreateBookingForm, key: keyof CreateBookingForm) {
  return !String(form[key] || '').trim()
}

function BookingReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <span className="max-w-[60%] truncate text-right text-xs font-bold text-slate-800">{value}</span>
    </div>
  )
}

function CreateBookingDialog({
  open,
  form,
  activeTab,
  modelOptions,
  variantOptions,
  bankOptions,
  masterLoading,
  error,
  isSubmitting,
  showSuccess,
  onSuccessDone,
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
  bankOptions: string[]
  masterLoading: boolean
  error: string
  isSubmitting: boolean
  showSuccess: boolean
  onSuccessDone: () => void
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: (typeof CREATE_TABS)[number]) => void
  onChange: <K extends keyof CreateBookingForm>(key: K, value: CreateBookingForm[K]) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const activeIndex = CREATE_TABS.indexOf(activeTab)
  const isLastStep = activeIndex === CREATE_TABS.length - 1
  const isFirstStep = activeIndex === 0

  const [costSheetVerifying, setCostSheetVerifying] = useState(false)
  const [costSheetFile, setCostSheetFile] = useState<File | null>(null)
  const [stockChecking, setStockChecking] = useState(false)
  const [stockCheckResult, setStockCheckResult] = useState<{ available: boolean; count: number } | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const [stepError, setStepError] = useState('')

  // Detect a saved draft whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    try {
      setHasDraft(Boolean(window.localStorage.getItem(BOOKING_DRAFT_KEY)))
    } catch {
      setHasDraft(false)
    }
  }, [open])

  // Clear the saved draft once a booking is successfully created.
  useEffect(() => {
    if (!showSuccess) return
    try {
      window.localStorage.removeItem(BOOKING_DRAFT_KEY)
    } catch {
      // ignore
    }
    setHasDraft(false)
  }, [showSuccess])

  const handleSaveDraft = () => {
    try {
      window.localStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(form))
      setHasDraft(true)
      toast({ title: 'Draft saved', description: 'Your booking progress is saved on this device.', variant: 'success' })
    } catch {
      toast({ title: 'Could not save draft', description: 'Local storage is unavailable in this browser.', variant: 'error' })
    }
  }

  const handleRestoreDraft = () => {
    try {
      const raw = window.localStorage.getItem(BOOKING_DRAFT_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<CreateBookingForm>
      ;(Object.keys(parsed) as (keyof CreateBookingForm)[]).forEach((key) => {
        const value = parsed[key]
        if (value !== undefined) onChange(key, value as CreateBookingForm[typeof key])
      })
      setHasDraft(false)
      toast({ title: 'Draft restored', description: 'Continuing your saved booking draft.', variant: 'success' })
    } catch {
      toast({ title: 'Could not restore draft', description: 'The saved draft could not be read.', variant: 'error' })
    }
  }

  useEffect(() => {
    if (open && form.variant && form.color) {
      setStockChecking(true)
      const controller = new AbortController()
      fetch(`/api/brands/kia/bookings/check-stock?model=${encodeURIComponent(form.model || '')}&variant=${encodeURIComponent(form.variant)}&color=${encodeURIComponent(form.color)}`, {
        signal: controller.signal
      })
        .then((r) => r.json())
        .then((data) => {
          setStockCheckResult(data)
          onChange('status', data.available ? 'IN STOCK' : 'NOT IN STOCK')
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            console.error('Stock check error:', err)
          }
        })
        .finally(() => setStockChecking(false))
      return () => controller.abort()
    } else {
      setStockCheckResult(null)
    }
  }, [open, form.variant, form.color])

  const handleCostSheetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCostSheetVerifying(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/brands/kia/bookings/verify-cost-sheet', {
        method: 'POST',
        body: fd
      })
      if (!res.ok) {
        throw new Error('Verification failed')
      }
      const data = await res.json()
      if (data.valid) {
        setCostSheetFile(file)
        onChange('costSheet', data.url || file.name)
        toast({
          title: 'Document Verified',
          description: `"${file.name}" accepted as a valid vehicle cost sheet.`,
          variant: 'success'
        })
      } else {
        e.target.value = ''
        toast({
          title: 'Invalid Cost Sheet',
          description: 'This is not a valid Vehicle Cost Sheet. Please upload a clear cost sheet image.',
          variant: 'error',
          duration: 6000
        })
      }
    } catch (err) {
      console.error(err)
      toast({
        title: 'Upload Failed',
        description: 'Failed to verify cost sheet. Please try again.',
        variant: 'error'
      })
    } finally {
      setCostSheetVerifying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kia-premium max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-5xl overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
        {/* On the Review step the panel itself is the booking animation, so don't
            cover it with the full-screen overlay — only use the overlay when
            submitting from any other step. */}
        <LoaderOverlay show={isSubmitting && activeTab !== 'Review'} variant="reserve" label="Creating booking…" sublabel="Reserving the customer's vehicle" />
        <SuccessOverlay show={showSuccess} label="Booking created!" sublabel="Reserved for the customer" onDone={onSuccessDone} />
        <form
          onSubmit={onSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
              e.preventDefault()
            }
          }}
          className="flex max-h-[94dvh] flex-col"
        >
          {/* ── HEADER ── */}
          <DialogHeader className="relative overflow-hidden border-b border-white/10 px-5 py-5 text-white sm:px-7 sm:py-6" style={{ background: 'linear-gradient(135deg, var(--dashboard-action-hover), var(--dashboard-action-bg))' }}>
            <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -left-12 bottom-[-3rem] h-40 w-40 rounded-full bg-white/[0.07] blur-2xl" />
            <div className="relative">
              <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                <Car className="h-3 w-3" /> Stepwise Booking
              </span>
              <DialogTitle className="text-xl font-extrabold tracking-tight sm:text-2xl">Create AM Kia Booking</DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-xs font-medium leading-5 text-white/80">Create the booking first, then generate the proforma for manager approval.</DialogDescription>
            </div>
          </DialogHeader>

          {/* ── PROGRESS STEPPER ── */}
          <div className="border-b border-slate-100 px-5 py-3 sm:px-7 sm:py-4" style={{ background: 'color-mix(in srgb, var(--dashboard-action-bg) 4%, #ffffff)' }}>
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
                          ? 'bg-[var(--dashboard-action-bg)] text-white shadow-lg scale-110'
                          : isCompleted
                            ? 'bg-[var(--dashboard-action-hover)] text-white'
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
                        isActive ? 'text-[var(--dashboard-action-bg)]' : isCompleted ? 'text-slate-600' : 'text-slate-400'
                      )}>
                        {tab}
                      </span>
                    </button>
                    {index < CREATE_TABS.length - 1 && (
                      <div className={cn(
                        'h-[2px] flex-1 mx-2 rounded-full transition-all duration-500 mb-4',
                        index < activeIndex ? 'bg-[var(--dashboard-action-bg)]' : 'bg-slate-200'
                      )} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── TAB CONTENT ── */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" style={{ background: 'linear-gradient(180deg, #ffffff, color-mix(in srgb, var(--dashboard-action-bg) 6%, #f6f8ff))' }}>
            {(error || stepError) && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error || stepError}</div>}

            {/* CUSTOMER TAB */}
            {activeTab === 'Customer' && (
              <div className="grid gap-5">
                {hasDraft && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--dashboard-action-bg)]/25 bg-[color-mix(in_srgb,var(--dashboard-action-bg)_7%,#ffffff)] px-4 py-3">
                    <span className="text-xs font-bold text-[var(--dashboard-action-bg)]">You have a saved booking draft on this device.</span>
                    <Button type="button" onClick={handleRestoreDraft} className="h-8 rounded-xl bg-[var(--dashboard-action-bg)] px-3 text-xs font-black text-white hover:opacity-90">Resume Draft</Button>
                  </div>
                )}
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Field label="Customer Name" required>
                      <Input value={form.customerName} onChange={(event) => onChange('customerName', event.target.value)} className={INPUT_STYLE} placeholder="Full legal name" />
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label="Customer Type" required>
                      <select
                        value={form.customerType || 'Regular'}
                        onChange={(event) => onChange('customerType', event.target.value)}
                        className={cn(INPUT_STYLE, 'cursor-pointer appearance-none')}
                      >
                        <option value="Regular">Regular</option>
                        <option value="CSD">CSD</option>
                      </select>
                      {form.customerType === 'CSD' && (
                        <p className="mt-1.5 text-[11px] font-bold text-[var(--dashboard-action-bg)]">CSD bookings get a 5-day payment window after allotment (instead of 72 hours).</p>
                      )}
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
                        onChange={(event) => onChange('customerPhone', event.target.value.replace(/\D/g, '').slice(0, 10))}
                        className={cn(INPUT_STYLE, 'flex-1')}
                        placeholder="10-digit mobile"
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                      />
                    </div>
                    {form.customerPhone.length > 0 && form.customerPhone.length !== 10 && (
                      <p className="mt-1 text-[11px] font-bold text-rose-500">Mobile number must be exactly 10 digits.</p>
                    )}
                  </Field>
                  <Field label="Customer Email" required>
                    <Input value={form.customerEmailId} onChange={(event) => onChange('customerEmailId', event.target.value)} className={INPUT_STYLE} placeholder="customer@email.com" type="email" />
                  </Field>
                  <Field label="Dealer" required>
                    <Select value={form.dealerCode} onValueChange={(val) => onChange('dealerCode', val)}>
                      <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Dealer" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="JK402">JK402 - Jammu</SelectItem>
                        <SelectItem value="JK501">JK501 - Udhampur</SelectItem>
                      </SelectContent>
                    </Select>
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
                <Field label="Stock Status">
                  {stockChecking ? (
                    <div className="h-11 rounded-2xl bg-slate-50 border border-slate-200 flex items-center px-4 text-xs font-semibold text-slate-500">Checking stock...</div>
                  ) : stockCheckResult ? (
                    <div className={`h-11 rounded-2xl border flex items-center px-4 text-xs font-black ${
                      stockCheckResult.available 
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                        : 'bg-rose-50 border-rose-200 text-rose-700'
                    }`}>
                      {stockCheckResult.available 
                        ? `✅ IN STOCK (${stockCheckResult.count} unit${stockCheckResult.count !== 1 ? 's' : ''} available)` 
                        : '❌ NOT IN STOCK'}
                    </div>
                  ) : (
                    <div className="h-11 rounded-2xl bg-slate-50 border border-slate-200 flex items-center px-4 text-xs font-semibold text-slate-400">Select variant & color first</div>
                  )}
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
                <Field label="Payment Source" required>
                  <Select value={form.pmtSource} onValueChange={(val) => onChange('pmtSource', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Payment Source" /></SelectTrigger>
                    <SelectContent>
                      {['CASH', 'CHEQUE', 'UPI', 'NEFT', 'RTGS', 'BANK TRANSFER', 'DD', 'CARD', 'OTHER'].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Payment Amount" required><Input type="number" value={form.paymentAmount} onChange={(event) => onChange('paymentAmount', event.target.value)} className={INPUT_STYLE} placeholder="₹" /></Field>
                <Field label="Cost Sheet" required>
                  <div className="space-y-2">
                    <label className={`flex items-center justify-center gap-3 cursor-pointer h-11 px-4 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:bg-white transition-all ${costSheetVerifying ? 'opacity-60 pointer-events-none' : ''}`}>
                      <input type="file" accept="image/*" onChange={handleCostSheetUpload} className="sr-only" />
                      {costSheetVerifying ? '⏳ Verifying...' : costSheetFile ? `✅ ${costSheetFile.name}` : '📷 Upload Cost Sheet Image'}
                    </label>
                  </div>
                </Field>
                <Field label="Bank / Finance" required>
                  <Select value={form.bankFinance} onValueChange={(val) => onChange('bankFinance', val)}>
                    <SelectTrigger className={INPUT_STYLE}><SelectValue placeholder="Select Bank / Finance" /></SelectTrigger>
                    <SelectContent>
                      {(bankOptions.length > 0 ? bankOptions : BANKS).map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
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
                <Field label="Commitment With Customer">
                  <Textarea value={form.commitment} onChange={(event) => onChange('commitment', event.target.value)} className="min-h-24 rounded-2xl border-slate-200 bg-white text-sm font-semibold text-slate-800" placeholder="Any special commitments made..." />
                </Field>
                <Field label="Other Dealer Details"><Input value={form.otherDealerDetails} onChange={(event) => onChange('otherDealerDetails', event.target.value)} className={INPUT_STYLE} /></Field>
              </div>
            )}

            {/* REVIEW TAB — final summary after all stages */}
            {activeTab === 'Review' && (
              <div className="grid gap-5 lg:grid-cols-2">
                {/* LEFT — booking animation */}
                <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 text-center">
                  <AutomotiveLoader
                    variant="reserve"
                    size={150}
                    label={isSubmitting ? 'Vehicle Getting Booked…' : 'Review & Confirm Booking'}
                    sublabel={isSubmitting ? 'Securing your vehicle, please wait…' : 'Check the details on the right, then create the booking — or save it as a draft.'}
                  />
                  {isSubmitting ? (
                    <>
                      <div className="mt-5 h-1.5 w-full max-w-[240px] overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full w-full rounded-full bg-[var(--dashboard-action-bg)] transition-[width] duration-700 ease-out" />
                      </div>
                      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Securing Your Vehicle · 100%</p>
                    </>
                  ) : (
                    <p className="mt-5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Nothing saved yet · Confirm or Save Draft</p>
                  )}
                </div>

                {/* RIGHT — summary cards */}
                <div className="space-y-3">
                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <p className="mb-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--dashboard-action-bg)]">Booking Summary</p>
                    <div className="grid gap-1.5">
                      <BookingReviewRow label="Customer" value={form.customerName || '—'} />
                      <BookingReviewRow label="Mobile" value={form.customerPhone ? `${form.countryCode} ${form.customerPhone}` : '—'} />
                      <BookingReviewRow label="Dealer" value={form.dealerCode || '—'} />
                      <BookingReviewRow label="Vehicle" value={form.model || '—'} />
                      <BookingReviewRow label="Variant" value={form.variant || '—'} />
                      <BookingReviewRow label="Colour" value={form.color || '—'} />
                      <BookingReviewRow label="Booking Date" value={form.bookingDate || '—'} />
                      <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-2.5">
                        <span className="text-xs font-black uppercase tracking-wide text-slate-500">Booking Amount</span>
                        <span className="text-base font-black text-slate-950">{form.bookingAmount ? `₹${Number(form.bookingAmount).toLocaleString('en-IN')}` : '—'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Cost Sheet (AI Verified)</p>
                      {(costSheetFile || form.costSheet) ? (
                        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 ring-1 ring-inset ring-emerald-200">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          <span className="truncate text-xs font-bold text-emerald-700">Verified · Vehicle Cost Sheet</span>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">Not uploaded yet</div>
                      )}
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Finance Details</p>
                      <div className="grid gap-1.5">
                        <BookingReviewRow label="Bank / Finance" value={form.bankFinance || '—'} />
                        <BookingReviewRow label="Pmt Source" value={form.pmtSource || '—'} />
                        <BookingReviewRow label="Pmt Amount" value={form.paymentAmount ? `₹${Number(form.paymentAmount).toLocaleString('en-IN')}` : '—'} />
                      </div>
                    </div>
                  </div>
                </div>
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
              <Button
                type="button"
                variant="outline"
                className="h-10 min-w-[90px] rounded-2xl bg-white text-xs font-black text-slate-700 hover:bg-slate-100 sm:text-sm"
                onClick={handleSaveDraft}
                disabled={isSubmitting}
              >
                Save Draft
              </Button>
              {!isLastStep ? (
                <Button
                  key="wizard-next"
                  type="button"
                  className="h-10 min-w-[90px] rounded-2xl bg-slate-950 text-xs font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800 sm:text-sm"
                  onClick={() => {
                    const stepError = getBookingStepError(activeTab, form)
                    if (stepError) {
                      setStepError(stepError)
                      toast({ title: 'Please complete this step', description: stepError, variant: 'error' })
                      return
                    }
                    setStepError('')
                    onTabChange(CREATE_TABS[activeIndex + 1])
                  }}
                >
                  Next →
                </Button>
              ) : (
                <Button
                  key="wizard-submit"
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
  return <InspectorSkeleton />
}

function BookingDrawer({
  detail,
  currentUserRole,
  testPersona,
  canUseTestPersona,
  matchingVehicles,
  matchingLoading,
  actionLoading,
  actionLoaderVariant,
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
  actionLoaderVariant: LoaderVariant
  actionMessage: string
  onAction: (action: 'proforma' | 'finance' | 'payment' | 'accounts' | 'release' | 'deliver' | 'cancel' | 'transfer') => void
  onAllot: (vinNumber: string) => void
  onOpenTransfer: (vehicle?: MatchingVehicle | null) => void
  onPaymentNotReceived: () => void
  onStatusChange: (status: string) => void
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [sharingLink, setSharingLink] = useState(false)
  const { booking, allocation, proforma, financeOrder, activities, transfers } = detail

  // Fetch the customer's public tracking URL, copy it to the clipboard, and offer
  // to open the customer's email/share sheet. Staff-only action; the link itself
  // is safe to hand to the customer.
  const shareTrackingLink = async () => {
    if (sharingLink) return
    setSharingLink(true)
    try {
      const response = await fetch(`/api/brands/kia/bookings/${booking.id}/tracking-link`)
      const payload = await response.json()
      if (!response.ok || !payload.url) throw new Error(payload.error || 'Could not generate a tracking link.')
      const url: string = payload.url
      let copied = false
      try {
        await navigator.clipboard.writeText(url)
        copied = true
      } catch {
        copied = false
      }
      toast({
        title: copied ? 'Tracking link copied' : 'Tracking link ready',
        description: copied
          ? 'Share it with the customer so they can follow their order status.'
          : url,
      })
    } catch (error) {
      toast({
        title: 'Unable to share link',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      })
    } finally {
      setSharingLink(false)
    }
  }
  const canViewPii = canViewKiaCustomerPii(currentUserRole)
  const proformaApproved = proforma?.status === 'APPROVED'
  // Delivery date lives in the column when set via edit, else in the create-form metadata.
  const expectedDeliveryValue = booking.expectedDeliveryDate || ((booking.metadata as Record<string, unknown> | null)?.expectedDeliveryDate as string | null | undefined) || null
  const isDelivered = booking.status === 'delivered'
  const isCancelled = booking.status === 'cancelled'
  const isTerminal = isDelivered || isCancelled
  const effectivePersona = canUseTestPersona ? testPersona : 'actual'
  const canActAsSalesPerson = effectivePersona === 'actual' ? roleCanActAsSalesPerson(currentUserRole) : effectivePersona === 'sales_person'
  const canActAsSalesManager = effectivePersona === 'actual' ? roleCanActAsSalesManager(currentUserRole) : effectivePersona === 'sales_manager'
  const canActAsAccounts = effectivePersona === 'actual' ? roleCanActAsAccounts(currentUserRole) : effectivePersona === 'accounts'
  // New role-model gates (backend enforces the same):
  const canActAsAccountsVerify = effectivePersona === 'actual' ? canVerifyKiaAccounts(currentUserRole) : effectivePersona === 'accounts'
  const canDeliver = effectivePersona === 'actual' ? canDeliverKiaBooking(currentUserRole) : effectivePersona === 'sales_person'
  const canActOnStock = effectivePersona === 'actual' ? canAllotKiaVehicle(currentUserRole) : effectivePersona !== 'sales_person'
  // Sales persons (and managers/admin) can edit booking details until the booking is closed.
  const canEditBooking = !isTerminal && (canActAsSalesPerson || canActAsSalesManager)
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
    if (booking.status === 'vehicle_allocated' || booking.status === 'transfer_requested' || booking.status === 'payment_confirmed') {
      return {
        label: 'Stage 4 · Accounts',
        title: 'Payment & invoice pending',
        body: 'The VIN is reserved for 72 hours. Accounts confirms the payment release, records the invoice number, and uploads the invoice PDF; otherwise release the reservation.',
        actionLabel: canActAsAccountsVerify ? 'Confirm Payment & Invoice' : null,
        onAction: canActAsAccountsVerify ? () => onAction('accounts') : null,
      }
    }
    if (booking.status === 'ready_delivery') {
      return {
        label: 'Stage 5 · Delivery',
        title: 'Ready to deliver',
        body: 'Accounts has released payment and verified all documentation. The Sales Executive completes delivery.',
        actionLabel: canDeliver ? 'Mark Delivered' : null,
        onAction: canDeliver ? () => onAction('deliver') : null,
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

  // Stage-based vehicle journey. New workflow (Finance removed):
  // booking -> proforma -> approve -> allot -> accounts (payment + invoice) -> deliver.
  const accountsDone = ['ready_delivery', 'delivered'].includes(String(booking.status)) || isDelivered
  const journeyStages = [
    { key: 'booking', title: 'Booking Created', keywords: ['booking created', 'created'], done: true },
    { key: 'proforma', title: 'Proforma Generated', keywords: ['proforma generated', 'proforma'], done: Boolean(proforma) },
    { key: 'approved', title: 'Approved', keywords: ['approved', 'approval'], done: Boolean(proformaApproved) },
    { key: 'allotted', title: 'Vehicle Allotted', keywords: ['allot', 'allocat', 'vin reserved'], done: Boolean(allocation?.vinNumber) },
    { key: 'accounts', title: 'Payment & Invoice', keywords: ['payment', 'invoice', 'accounts'], done: accountsDone },
    { key: 'delivered', title: 'Delivered', keywords: ['delivered'], done: isDelivered },
  ]
  const journeyFrontier = journeyStages.reduce((acc, stage, index) => (stage.done ? index : acc), 0)
  const journeyComplete = journeyStages[journeyStages.length - 1].done
  const stageActivity = (keywords: string[]) => activities.find((activity) => {
    const message = String(activity.message || '').toLowerCase()
    return keywords.some((keyword) => message.includes(keyword))
  })

  return (
    <>
      <div className="relative shrink-0 overflow-hidden border-b w-full min-w-0" style={{ borderColor: 'var(--kia-hairline)', background: 'linear-gradient(135deg, color-mix(in srgb, var(--dashboard-primary) 9%, var(--kia-surface)), var(--kia-surface))' }}>
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full" style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--dashboard-action-bg) 18%, transparent), transparent 70%)' }} />
        <div className="relative p-4 sm:p-6 w-full min-w-0">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between w-full min-w-0">
            <div className="flex min-w-0 items-start gap-3 w-full">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={toneSoftStyle('accent')}>
                <Car className="h-7 w-7" />
              </span>
              <div className="min-w-0 flex-1">
                <Kicker>Vehicle Journey</Kicker>
                <h2 className="mt-0.5 break-words text-xl font-extrabold tracking-tight text-[var(--kia-text)] sm:text-2xl">
                  {[booking.model, booking.variant].filter(Boolean).join(' ') || booking.bookingNumber}
                </h2>
                <p className="mt-0.5 text-xs font-semibold text-[var(--kia-text-soft)]">
                  {[allocation?.color || booking.color || booking.colorPreference, booking.dealerCode].filter(Boolean).join(' · ') || booking.customerName}
                </p>
                {allocation?.vinNumber && <p className="mt-1 font-mono text-[11px] font-bold text-[var(--kia-text)]">VIN: {allocation.vinNumber}</p>}
                <p className="mt-1 text-[11px] font-medium text-[var(--kia-text-faint)]"><span className="kia-tnum">{booking.bookingNumber}</span> · {booking.customerName}</p>
              </div>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <StatusBadge status={booking.status} />
              <Button
                variant="outline"
                size="sm"
                onClick={shareTrackingLink}
                disabled={sharingLink}
                className="h-8 rounded-xl text-xs font-bold"
              >
                {sharingLink ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Share2 className="mr-1.5 h-3.5 w-3.5" />}
                Share tracking link
              </Button>
              {financeOrder?.number && <Chip tone="info">{financeOrder.number}</Chip>}
              {canUseTestPersona && <Chip tone="warning">{TEST_PERSONA_LABELS[effectivePersona]}</Chip>}
              {canUseTestPersona && (
                <div className="flex items-center gap-1.5 rounded-2xl border p-1.5" style={{ borderColor: 'var(--kia-hairline)', backgroundColor: 'var(--kia-surface)' }}>
                  <span className="pl-1 text-[10px] font-bold uppercase tracking-wider text-[var(--kia-text-faint)]">Manual</span>
                  <Select value={booking.status} onValueChange={onStatusChange} disabled={actionLoading}>
                    <SelectTrigger className="h-8 w-40 rounded-xl border px-2 py-0 text-xs font-bold" style={{ borderColor: 'var(--kia-hairline)' }}>
                      <SelectValue placeholder="Override status" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(STATUS_LABELS).map((status) => (
                        <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 w-full min-w-0">
            {([
              { label: 'Proforma', value: proforma?.number || 'Not generated', icon: FileText, tone: (proforma ? (proformaApproved ? 'success' : 'warning') : 'neutral') as Tone, mono: false },
              { label: 'VIN', value: allocation?.vinNumber || 'Not allocated', icon: Car, tone: (allocation ? 'success' : 'neutral') as Tone, mono: true },
              { label: isDelivered ? 'Delivered' : 'Delivery', value: isDelivered ? 'Delivered' : formatDate(expectedDeliveryValue), icon: CalendarCheck, tone: (isDelivered ? 'success' : 'info') as Tone, mono: false },
            ]).map((stat) => (
              <div key={stat.label} className="kia-surface-flush flex items-center gap-2.5 px-3 py-2.5">
                <IconTile icon={stat.icon} tone={stat.tone} size="sm" />
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--kia-text-faint)]">{stat.label}</p>
                  <p className={cn('truncate text-[13px] font-bold text-[var(--kia-text)]', stat.mono && 'font-mono text-xs')}>{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="kia-scroll relative min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-3 sm:space-y-5 sm:p-5 w-full min-w-0" style={{ background: 'var(--kia-canvas)' }}>
        <LoaderOverlay show={actionLoading} variant={actionLoaderVariant} />
        <Stepper status={booking.status} />
        {personaNote && <div className="rounded-2xl border px-3 py-2.5 text-xs font-semibold leading-5" style={toneSoftStyle('info')}>{personaNote}</div>}
        <section className="kia-surface relative overflow-hidden p-4 sm:p-5" style={{ boxShadow: 'inset 3px 0 0 var(--dashboard-action-bg), var(--kia-elev-2)' }}>
          <Kicker>{nextStep.label}</Kicker>
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-extrabold tracking-tight text-[var(--kia-text)]">{nextStep.title}</h3>
              <p className="mt-1 text-sm font-medium leading-6 text-[var(--kia-text-soft)]">{nextStep.body}</p>
            </div>
            {nextStep.actionLabel && nextStep.onAction ? (
              <Button className="h-10 shrink-0 rounded-2xl px-4 text-sm font-bold" onClick={nextStep.onAction}>
                {nextStep.actionLabel}
              </Button>
            ) : null}
          </div>
        </section>
        {actionMessage && <div className="rounded-2xl border px-3 py-2.5 text-sm font-semibold" style={toneSoftStyle('success')}>{actionMessage}</div>}
        {(() => {
          const meta = (booking.metadata || {}) as Record<string, unknown>
          const paymentConfirmation = (meta.paymentConfirmation || {}) as Record<string, unknown>
          const accountsVerification = (meta.accountsVerification || {}) as Record<string, unknown>
          return (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 w-full min-w-0">
              <InfoCard title="Customer" icon={UserRound} items={[
                ['Name', booking.customerName],
                ['Country Code', String(meta.countryCode || '91')],
                ['Phone', maskKiaPii(booking.customerPhone, canViewPii)],
                ['Email', maskKiaPii(booking.customerEmail || String(meta.customerEmailId || ''), canViewPii)],
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
                ['Payment Ref', String(paymentConfirmation.reference || '-')],
                ['Invoice Number', String(accountsVerification.invoiceNumber || '-')],
                ['Invoice PDF', String(accountsVerification.invoiceDocumentName || '-')],
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
                action={proforma ? (proformaApproved || !canActAsSalesManager ? 'View Proforma Details' : 'Open Pending Proforma') : 'Generate Proforma'}
                disabled={actionLoading || (!proforma && !canActAsSalesPerson)}
                loading={actionLoading}
                onClick={() => {
                  if (proforma) {
                    router.push(
                      proformaApproved || !canActAsSalesManager
                        ? `/brands/kia/proforma/all-proforma-details?search=${proforma.number}`
                        : `/brands/kia/proforma/pending-approval?search=${proforma.number}`,
                    )
                  } else {
                    onAction('proforma')
                  }
                }}
              />
              <ActionCard title="Accounts · Payment & Invoice" icon={ShieldCheck} value={accountsDone ? 'Invoice recorded' : allocation ? allocation.vinNumber : 'No active VIN'} status={accountsDone ? 'Payment released · Verified' : 'Pending Accounts'} action={accountsDone ? 'Completed' : 'Confirm Payment & Invoice'} disabled={actionLoading || !canActAsAccountsVerify || !allocation || accountsDone || !(booking.status === 'vehicle_allocated' || booking.status === 'transfer_requested' || booking.status === 'payment_confirmed')} loading={actionLoading} onClick={() => onAction('accounts')} />
            </div>
          )
        })()}

        <section className="kia-surface p-4 sm:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <IconTile icon={Car} tone="info" />
              <div>
                <h3 className="text-base font-extrabold tracking-tight text-[var(--kia-text)] sm:text-lg">Vehicle Allocation</h3>
                <p className="text-xs font-medium leading-5 text-[var(--kia-text-soft)]">
                  {proformaApproved ? 'Matchable VINs exclude local Retail and active allocations.' : 'Allocation unlocks after Sales Manager / Manager approval.'}
                </p>
              </div>
            </div>
            {allocation && (
              <Button variant="outline" className="h-10 shrink-0 rounded-2xl text-xs font-bold sm:text-sm" disabled={actionLoading || !canActOnStock} onClick={() => onAction('release')}>
                {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />} Release VIN
              </Button>
            )}
          </div>
          {allocation ? (
            <div className="mt-4 rounded-2xl border p-3.5" style={toneSoftStyle('success')}>
              <p className="break-all font-mono text-sm font-extrabold" style={{ color: 'var(--kia-text)' }}>{allocation.vinNumber}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[var(--kia-text-soft)]">{allocation.model} · {allocation.variant} · {allocation.color || 'Color NA'}</p>
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ borderColor: 'var(--kia-hairline)', backgroundColor: 'var(--kia-surface)', color: 'var(--kia-text-soft)' }}>
                <CalendarCheck className="h-3.5 w-3.5" /> Payment window: {formatTimeRemaining(allocation.expiresAt)}
              </span>
            </div>
          ) : !proformaApproved ? (
            <div className="mt-4 rounded-2xl border border-dashed p-4 text-xs font-semibold leading-5" style={toneSoftStyle('warning')}>
              Generate the proforma and get senior approval before checking stock or allotting a vehicle.
            </div>
          ) : matchingLoading ? (
            <div className="mt-4 flex items-center justify-center py-8">
              <AutomotiveLoader variant="vin-match" label="Matching available VINs…" sublabel="Scanning DMS + local stock" size={96} />
            </div>
          ) : matchingVehicles.length === 0 ? (
            <div className="mt-4">
              <PremiumEmptyState illustration="garage" title="No matching vehicles" description="No free-stock or in-transit VIN currently matches this booking. Try a transfer, or check back after the next stock sync." />
            </div>
          ) : (
            <Stagger className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {matchingVehicles.slice(0, 6).map((vehicle) => (
                <StaggerItem key={vehicle.vinNumber}>
                  <div className="kia-surface-flush kia-lift h-full p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all font-mono text-xs font-extrabold text-[var(--kia-text)]">{vehicle.vinNumber}</p>
                        <p className="mt-1 text-sm font-bold text-[var(--kia-text)]">{vehicle.model} · {vehicle.variant}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Chip tone="neutral">{vehicle.dealerCode}</Chip>
                          <Chip tone={vehicle.source === 'bbnd' ? 'warning' : 'info'}>{vehicle.source === 'bbnd' ? 'BBND' : (vehicle.stockStatus || 'DMS')}</Chip>
                          {typeof vehicle.stockAge === 'number' && <Chip tone="neutral">{vehicle.stockAge}d</Chip>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        <Button size="sm" className="rounded-xl text-xs font-bold" disabled={actionLoading || !canActOnStock} onClick={() => onAllot(vehicle.vinNumber)}>Allot</Button>
                        <Button size="sm" variant="outline" className="rounded-xl text-xs font-bold" disabled={actionLoading || !canActOnStock} onClick={() => onOpenTransfer(vehicle)}>Transfer</Button>
                      </div>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 w-full min-w-0">
          <section className="kia-surface p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <IconTile icon={ClipboardList} tone="accent" />
              <h3 className="text-base font-extrabold tracking-tight text-[var(--kia-text)] sm:text-lg">Journey</h3>
            </div>
            <div className="mt-4">
              {journeyStages.map((stage, index) => {
                const done = index < journeyFrontier || (index === journeyFrontier && journeyComplete)
                const current = index === journeyFrontier && !journeyComplete
                const activity = stageActivity(stage.keywords)
                const lineColor = index < journeyFrontier ? '#10b981' : current ? '#3b82f6' : 'var(--kia-hairline-strong)'
                return (
                  <div key={stage.key} className="relative flex gap-3 pb-5 last:pb-0">
                    {index < journeyStages.length - 1 && (
                      <span className="absolute bottom-0 left-[13px] top-7 border-l-2 border-dashed" style={{ borderColor: lineColor }} />
                    )}
                    <span
                      className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full"
                      style={done ? { backgroundColor: '#10b981' } : current ? { backgroundColor: '#3b82f6' } : { border: '2px solid var(--kia-hairline-strong)' }}
                    >
                      {done ? (
                        <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      ) : current ? (
                        <span className="h-2.5 w-2.5 rounded-full bg-white" />
                      ) : (
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--kia-hairline-strong)' }} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className={cn('text-sm font-bold', done || current ? 'text-[var(--kia-text)]' : 'text-[var(--kia-text-soft)]')}>{stage.title}</p>
                      <p className="mt-0.5 text-xs font-medium text-[var(--kia-text-soft)]">
                        {done || current
                          ? (activity ? `${formatDate(activity.createdAt)}${activity.actorName ? ` by ${activity.actorName}` : ''}` : (stage.key === 'booking' ? formatDate(booking.createdAt) : 'Completed'))
                          : 'Pending'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
          <section className="kia-surface p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <IconTile icon={Truck} tone="success" />
              <h3 className="text-base font-extrabold tracking-tight text-[var(--kia-text)] sm:text-lg">Delivery &amp; Transfers</h3>
            </div>
            <div className="mt-4 grid gap-2.5">
              <div className="kia-surface-sunken px-3 py-2.5">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--kia-text-faint)]">{isDelivered ? 'Delivery Status' : 'Expected Delivery'}</p>
                <p className="mt-1 text-sm font-bold text-[var(--kia-text)]">{isDelivered ? `Delivered${expectedDeliveryValue ? ` · planned ${formatDate(expectedDeliveryValue)}` : ''}` : formatDate(expectedDeliveryValue)}</p>
              </div>
              {transfers.slice(0, 4).map((transfer) => (
                <div key={transfer.id} className="flex flex-wrap items-center gap-1.5 rounded-2xl border px-3 py-2.5 text-xs font-semibold text-[var(--kia-text-soft)]" style={{ borderColor: 'var(--kia-hairline)', backgroundColor: 'var(--kia-surface)' }}>
                  <span className="font-mono text-[var(--kia-text)]">{transfer.vinNumber}</span>
                  <span>{transfer.fromDealerCode || '—'}</span> <ArrowRight className="h-3 w-3" /> <span>{transfer.toDealerCode || '—'}</span>
                  <Chip tone="info" className="ml-auto">{transfer.status}</Chip>
                </div>
              ))}
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 w-full min-w-0">
                <Button variant="outline" className="h-10 rounded-2xl text-xs font-bold" disabled={actionLoading || !canActOnStock || isTerminal} onClick={() => onAction('transfer')}>
                  Request Transfer
                </Button>
                <Button className="h-10 rounded-2xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700" disabled={actionLoading || !canDeliver || booking.status !== 'ready_delivery'} onClick={() => onAction('deliver')}>
                  <CalendarCheck className="h-4 w-4" /> Mark Delivered
                </Button>
                <Button variant="outline" className="h-10 rounded-2xl border-amber-200 text-xs font-bold text-amber-700 hover:bg-amber-50" disabled={actionLoading || !canActAsAccounts || !allocation || (booking.status !== 'vehicle_allocated' && booking.status !== 'transfer_requested')} onClick={onPaymentNotReceived}>
                  Payment not received
                </Button>
                {canEditBooking && (
                  <Button variant="outline" className="h-10 rounded-2xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100" disabled={actionLoading} onClick={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" /> Edit Booking
                  </Button>
                )}
                <Button variant="outline" className="h-10 rounded-2xl border-rose-200 text-xs font-bold text-rose-700 hover:bg-rose-50" disabled={actionLoading || isTerminal} onClick={() => onAction('cancel')}>
                  Cancel Booking
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
      <EditBookingDialog booking={booking} open={editOpen} onOpenChange={setEditOpen} />
    </>
  )
}

function EditBookingDialog({ booking, open, onOpenChange }: { booking: BookingDetailPayload['booking']; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()

  const buildForm = () => {
    const meta = (booking.metadata || {}) as Record<string, unknown>
    return {
      customerName: booking.customerName || '',
      customerPhone: booking.customerPhone || '',
      customerEmail: booking.customerEmail || String(meta.customerEmailId || ''),
      customerAddress: booking.customerAddress || booking.address || String(meta.customerAddress || ''),
      model: booking.model || '',
      variant: booking.variant || '',
      color: booking.color || booking.colorPreference || String(meta.color || ''),
      fuelType: booking.fuelType || String(meta.fuelType || 'PETROL'),
      bankName: booking.bankName || String(meta.bankFinance || ''),
      consultantName: booking.consultantName || '',
      notes: booking.notes || String(meta.notes || ''),
    }
  }

  const [form, setForm] = useState(buildForm)

  // Re-prime the form each time the dialog is opened (or a different booking loads).
  useEffect(() => {
    if (open) setForm(buildForm())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking.id])

  const set = (key: keyof ReturnType<typeof buildForm>, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const mutation = useMutation({
    mutationFn: async () => {
      const bankTrimmed = form.bankName.trim()
      const response = await fetch(`/api/brands/kia/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          financeRequired: Boolean(bankTrimmed) && bankTrimmed.toUpperCase() !== 'CASH',
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || 'Failed to update booking')
      }
      return response.json()
    },
    onSuccess: () => {
      toast({ title: 'Booking updated', description: 'Your changes have been saved.', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', booking.id] })
      onOpenChange(false)
    },
    onError: (error) => toast({ title: 'Update failed', description: error instanceof Error ? error.message : 'Failed to update booking', variant: 'error' }),
  })

  const phoneDigits = form.customerPhone.replace(/\D/g, '')
  const phoneInvalid = phoneDigits.length !== 10
  const emailInvalid = form.customerEmail.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim())

  const save = () => {
    if (!form.customerName.trim()) { toast({ title: 'Customer name required', variant: 'error' }); return }
    if (phoneInvalid) { toast({ title: 'Invalid mobile', description: 'Mobile number must be exactly 10 digits.', variant: 'error' }); return }
    if (emailInvalid) { toast({ title: 'Invalid email', description: 'Enter a valid email address.', variant: 'error' }); return }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kia-premium max-h-[88vh] max-w-2xl overflow-y-auto rounded-3xl p-0">
        <div className="relative overflow-hidden p-6 text-white" style={{ background: 'linear-gradient(135deg, var(--dashboard-action-hover), var(--dashboard-action-bg))' }}>
          <DialogHeader className="relative">
            <DialogTitle className="text-2xl font-extrabold tracking-tight text-white">Edit Booking</DialogTitle>
            <DialogDescription className="text-white/80">#{booking.bookingNumber} · update customer, vehicle, and finance details</DialogDescription>
          </DialogHeader>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Customer Name" required><Input value={form.customerName} onChange={(event) => set('customerName', event.target.value)} className={INPUT_STYLE} /></Field>
          </div>
          <Field label="Mobile Number" required>
            <Input value={form.customerPhone} onChange={(event) => set('customerPhone', event.target.value.replace(/\D/g, '').slice(0, 10))} className={INPUT_STYLE} inputMode="numeric" maxLength={10} />
            {form.customerPhone.length > 0 && phoneInvalid && <p className="mt-1 text-[11px] font-bold text-rose-600">Mobile number must be exactly 10 digits.</p>}
          </Field>
          <Field label="Customer Email">
            <Input value={form.customerEmail} onChange={(event) => set('customerEmail', event.target.value)} className={INPUT_STYLE} type="email" />
            {emailInvalid && <p className="mt-1 text-[11px] font-bold text-rose-600">Enter a valid email address.</p>}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address"><Input value={form.customerAddress} onChange={(event) => set('customerAddress', event.target.value)} className={INPUT_STYLE} /></Field>
          </div>
          <Field label="Model"><Input value={form.model} onChange={(event) => set('model', event.target.value)} className={INPUT_STYLE} /></Field>
          <Field label="Variant"><Input value={form.variant} onChange={(event) => set('variant', event.target.value)} className={INPUT_STYLE} /></Field>
          <Field label="Colour"><Input value={form.color} onChange={(event) => set('color', event.target.value)} className={INPUT_STYLE} /></Field>
          <Field label="Fuel Type">
            <select value={form.fuelType} onChange={(event) => set('fuelType', event.target.value)} className={cn(INPUT_STYLE, 'cursor-pointer appearance-none')}>
              {['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'CNG'].map((fuel) => <option key={fuel} value={fuel}>{fuel}</option>)}
            </select>
          </Field>
          <Field label="Bank / Finance"><Input value={form.bankName} onChange={(event) => set('bankName', event.target.value)} className={INPUT_STYLE} placeholder="CASH or bank name" /></Field>
          <Field label="Sales Consultant"><Input value={form.consultantName} onChange={(event) => set('consultantName', event.target.value)} className={INPUT_STYLE} /></Field>
          <div className="sm:col-span-2">
            <Field label="Notes"><Textarea value={form.notes} onChange={(event) => set('notes', event.target.value)} className="min-h-[70px] rounded-2xl border-slate-200 bg-slate-50/50" /></Field>
          </div>
        </div>
        <DialogFooter className="gap-2 border-t border-slate-100 p-4">
          <Button variant="outline" className="h-10 rounded-xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button className="h-10 rounded-xl bg-slate-950 px-5 text-xs font-black text-white hover:bg-slate-800" onClick={save} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InfoCard({ title, icon: Icon, items }: { title: string; icon: typeof ShieldCheck; items: Array<[string, string]> }) {
  return (
    <section className="kia-surface p-4 sm:p-5 min-w-0 w-full">
      <div className="flex items-center gap-3 border-b pb-3 w-full min-w-0" style={{ borderColor: 'var(--kia-hairline)' }}>
        <IconTile icon={Icon} tone="accent" size="sm" />
        <h3 className="text-[15px] font-extrabold tracking-tight text-[var(--kia-text)] sm:text-base truncate">{title}</h3>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 min-w-0 w-full">
        {items.map(([label, value]) => (
          <FieldValue key={label} label={label} value={value && value !== '-' ? value : undefined} />
        ))}
      </div>
    </section>
  )
}

function ActionCard({ title, icon: Icon, value, status, action, disabled, loading, onClick }: { title: string; icon: typeof ShieldCheck; value: string; status: string; action: string; disabled: boolean; loading?: boolean; onClick: () => void }) {
  return (
    <section className="kia-surface flex flex-col p-4 sm:p-5 min-w-0 w-full">
      <div className="flex items-center gap-3 w-full min-w-0">
        <IconTile icon={Icon} tone="accent" size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-extrabold tracking-tight text-[var(--kia-text)] sm:text-base truncate">{title}</h3>
          <p className="mt-0.5 text-xs font-semibold text-[var(--kia-text-soft)] truncate">{status}</p>
        </div>
      </div>
      <div className="kia-surface-sunken mt-4 px-3 py-3 w-full min-w-0">
        <p className="kia-tnum break-all text-lg font-extrabold leading-6 text-[var(--kia-text)]">{value}</p>
      </div>
      <Button className="mt-auto w-full rounded-2xl pt-0 text-sm font-bold sm:mt-3 h-10" disabled={disabled} onClick={onClick}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />} {action}
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

      toast({ title: 'Quotation Generated', description: 'Quote generated, saved in database, and downloaded successfully!', variant: 'success' })
      setForm(EMPTY_QUOTE_FORM)
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Generation Failed', description: err instanceof Error ? err.message : 'Something went wrong', variant: 'error' })
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
      <DialogContent className="kia-premium flex max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-2xl flex-col overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
        <LoaderOverlay show={isSubmitting} variant="proforma" label="Generating quotation…" sublabel="Preparing and stamping the PDF" />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="relative shrink-0 overflow-hidden border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,#e0f2fe,transparent_35%),linear-gradient(135deg,#ffffff,#f8fafc)] p-4 sm:p-7">
            <div className="absolute -left-20 -top-24 h-56 w-56 rounded-full bg-cyan-200/30 blur-3xl" />
            <Badge variant="outline" className="relative mb-3 w-fit rounded-full border-cyan-100 bg-cyan-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-700 sm:mb-4">Indicative Quote</Badge>
            <DialogTitle className="relative text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Create Price Quotation</DialogTitle>
            <DialogDescription className="relative mt-2 text-xs font-semibold leading-5 text-slate-500 sm:text-sm">Send a simple quote PDF. It is not a proforma and does not allocate stock.</DialogDescription>
          </DialogHeader>
          
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-3 sm:space-y-5 sm:p-6">
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

          <DialogFooter className="grid shrink-0 gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:flex sm:p-4">
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
