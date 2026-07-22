'use client'

/* eslint-disable react-hooks/set-state-in-effect */

import { toast } from '@/hooks/use-toast'

import { ChangeEvent, createContext, FormEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS, DASHBOARD_GC_TIME_MS } from '@/components/providers/query-provider'
import { canViewKiaCustomerPii, maskKiaPii } from '@/lib/kia/pii'
import {
  AlertTriangle,
  ArrowUpDown,
  ArrowRight,
  BadgeIndianRupee,
  Calendar,
  CalendarCheck,
  Car,
  CheckCircle2,
  Clock3,
  ClipboardList,
  FileText,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Upload,
  UserCheck,
  UserRound,
  X,
  XCircle,
  Eye,
  MoreVertical,
  Download,
  Share2,
  MessageSquare,
  Percent,
  Receipt,
  FileCheck,
  Calculator,
  Copy,
  Check,
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import * as XLSX from 'xlsx'

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
  canAllotKiaVehicleToBooking,
  canApproveKiaProforma,
  canConfirmKiaPayment,
  canCreateKiaBooking,
  canDeliverKiaBooking,
  canVerifyKiaAccounts,
} from '@/lib/kia/workflow-access'
import {
  formatWaitingDuration,
  getKiaBookingStageInfo,
  isKiaBookingWaitLong,
} from '@/lib/kia/booking-status-tracking'
import {
  calculateKiaProformaPricing,
  getKiaBankOptions,
  getBranchesForBank,
} from '@/lib/kia-proforma/pricing'

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
  proformaId?: string | null
  proformaNumber?: string | null
  /** The linked proforma's approval status — lets the waiting indicator refine 'proforma_generated'. */
  proformaApprovalStatus?: string | null
  /** True when no stock is available for this booking (allotted VIN gone from DMS, or no free match). */
  stockNotAvailable?: boolean
  /** True when a matching free vehicle IS available to allot (not yet allocated). Opposite of above. */
  stockAvailable?: boolean
  financeOrderNumber?: string | null
  allocatedVin?: string | null
  deliveredAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  idtRemark?: string | null
  notes?: string | null
  managerName?: string | null
  tlName?: string | null
  metadata?: Record<string, unknown> | null
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
  summary?: {
    totalBookings: number
    statusCounts: Record<string, number>
    onHold: number
    activeAllocations: number
    noPayment: number
    notInStock: number
    topModels: { model: string; count: number }[]
    notInStockBreakdown?: { model: string; variant: string; color?: string; count: number }[]
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
  // Set when the allotted VIN disappears from the DMS stock feed (likely sold).
  stockStatus?: string | null
  stockMissingAt?: string | null
  stockLastSeenAt?: string | null
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
  prices: any[]
  insuranceCompanies: string[]
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
  // Customer ID documents (uploaded on the Customer stage). Numbers are read by AI from the
  // PAN/Aadhaar card image and editable by the user. All persist into kia_bookings.metadata.
  panCardUrl: string
  panCardName: string
  panNumber: string
  aadhaarCardUrl: string
  aadhaarCardName: string
  aadhaarNumber: string
  employeeIdUrl: string
  employeeIdName: string
  // Exchange (trade-in): 'Yes' | 'No'. When 'Yes', the old-vehicle name + value are required.
  exchange: string
  exchangeVehicleName: string
  exchangeValue: string
  requestDiscount?: boolean
  discountRequestedAmount?: string
  discountReason?: string
}

const DEFAULT_PAGE_SIZE = 15
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
  // Allotted, but the vehicle is still In transit — the payment window has not started yet.
  transferring: 'Transferring',
  vehicle_allocated: 'Vehicle Allocated',
  transfer_requested: 'Transfer Requested',
  finance_pending: 'Finance Pending',
  payment_confirmed: 'Payment Confirmed',
  ready_delivery: 'Ready Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  not_in_stock: 'Not in Stock',
  in_stock: 'In Stock',
}

// Maps a booking status to a premium chip tone (theme-token driven).
const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  booking_created: 'blue',
  proforma_generated: 'indigo',
  on_hold: 'amber',
  transferring: 'amber',
  vehicle_allocated: 'sky',
  transfer_requested: 'indigo',
  finance_pending: 'amber',
  payment_confirmed: 'teal',
  ready_delivery: 'violet',
  delivered: 'emerald',
  cancelled: 'rose',
  not_in_stock: 'rose',
  in_stock: 'emerald',
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
  { key: 'today', label: 'Booked Today', icon: ClipboardList, tone: 'blue', hint: 'New bookings today', statusFilter: 'today' },
  { key: 'pendingProforma', label: 'Pending Proforma', icon: FileText, tone: 'indigo', hint: 'Awaiting proforma', statusFilter: 'booking_created' },
  { key: 'waitingAllocation', label: 'Awaiting VIN', icon: Car, tone: 'sky', hint: 'Approved · unallocated', statusFilter: 'proforma_generated' },
  { key: 'financePending', label: 'Payment Pending', icon: BadgeIndianRupee, tone: 'amber', hint: 'Accounts to confirm', statusFilter: 'vehicle_allocated' },
  { key: 'readyDelivery', label: 'Ready to Deliver', icon: Truck, tone: 'violet', hint: 'Paid · deliverable', statusFilter: 'ready_delivery' },
  { key: 'delivered', label: 'Delivered', icon: CheckCircle2, tone: 'emerald', hint: 'Completed', statusFilter: 'delivered' },
  { key: 'cancelled', label: 'Cancelled', icon: XCircle, tone: 'rose', hint: 'Closed / lost', statusFilter: 'cancelled' },
  { key: 'notInStock', label: 'Not in Stock', icon: XCircle, tone: 'rose', hint: 'Vehicle not in inventory', statusFilter: 'not_in_stock' },
  { key: 'inStock', label: 'In Stock', icon: CheckCircle2, tone: 'emerald', hint: 'Matching vehicle available', statusFilter: 'in_stock' },
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

function formatDateTime(value?: string | null) {
  if (!value) return 'NA'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const datePart = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
  const timePart = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).format(date)
  return `${datePart}, ${timePart}`
}

function compressImage(file: File, maxWidth = 1200, quality = 0.75): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return Promise.resolve(file)
  }

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(file)
          return
        }

        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file)
              return
            }
            const lastDotIndex = file.name.lastIndexOf('.')
            const baseName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name
            const newName = `${baseName}.jpg`
            const compressedFile = new File([blob], newName, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            })
            resolve(compressedFile)
          },
          'image/jpeg',
          quality
        )
      }
      img.onerror = () => resolve(file)
      img.src = event.target?.result as string
    }
    reader.onerror = () => resolve(file)
    reader.readAsDataURL(file)
  })
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

// Ticks `now` every minute so any "time waiting" derived from it stays live
// without refetching. One interval per mount; the list passes it down to rows.
function useMinuteTick(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

// Compact "Waiting / Pending with" indicator shared by the list rows and the
// detail panel. Shows the current stage, who it's pending with, and how long the
// booking has waited there — but only for non-terminal statuses.
//
// "Time waiting" is derived from the booking's `updatedAt` as the marker for when
// it entered its current stage. APPROXIMATION: every workflow transition stamps
// `updatedAt`, so it closely tracks stage entry, but a non-stage edit (e.g. fixing
// a phone number) also bumps it — so this is a close approximation, not an exact
// stage-entry timestamp.
function BookingWaitingIndicator({
  status,
  approvalStatus,
  updatedAt,
  now,
  align = 'left',
  className,
  onAddOverdueRemark,
  remarksCount = 0,
  latestRemarkText,
}: {
  status: string
  approvalStatus?: string | null
  updatedAt?: string | null
  now: number
  align?: 'left' | 'right'
  className?: string
  onAddOverdueRemark?: () => void
  remarksCount?: number
  latestRemarkText?: string | null
}) {
  const info = getKiaBookingStageInfo(status, approvalStatus)
  const isPending = info.state === 'pending'
  const stale = isPending && isKiaBookingWaitLong(updatedAt, now)
  return (
    <div className={cn('flex flex-col gap-0.5', align === 'right' && 'items-end text-right', className)}>
      <span className="text-[11px] font-bold leading-4 text-[var(--kia-text-soft)]">
        {info.pendingWith ? (
          <>Pending with <span className="text-[var(--kia-text)]">{info.pendingWith}</span></>
        ) : (
          info.stageLabel
        )}
      </span>
      {isPending && (
        <div className="flex flex-wrap items-center gap-1">
          <span className={cn('inline-flex items-center gap-1 text-[11px] font-bold leading-4', stale ? 'text-rose-600 font-extrabold' : 'text-[var(--kia-text-faint)]')}>
            <Clock3 className="h-3 w-3 shrink-0" />
            {formatWaitingDuration(updatedAt, now)}
            {stale ? ' · overdue' : ' waiting'}
          </span>
          {stale && onAddOverdueRemark && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onAddOverdueRemark()
              }}
              className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-700 hover:bg-rose-100 hover:text-rose-900 transition border border-rose-200/80 shadow-2xs cursor-pointer"
              title="Add or view remarks for overdue booking"
            >
              <MessageSquare className="h-2.5 w-2.5" />
              <span>{remarksCount > 0 ? `${remarksCount} Remark${remarksCount > 1 ? 's' : ''}` : '+ Remark'}</span>
            </button>
          )}
        </div>
      )}
      {latestRemarkText && (
        <p className="text-[10px] font-semibold text-slate-500 italic max-w-[200px] truncate" title={latestRemarkText}>
          &quot;{latestRemarkText}&quot;
        </p>
      )}
    </div>
  )
}

// Red flag shown in the CRM booking list when no stock is available for a booking — the allotted
// vehicle left the DMS feed, or there is no free matching vehicle in stock.
function StockUnavailableFlag({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex w-fit items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-700', className)}
      title="No stock available for this booking"
    >
      <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-rose-600" />
      NO STOCK
    </span>
  )
}

function StockAvailableFlag({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex w-fit items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700', className)}
      title="A matching vehicle is in stock and can be allotted"
    >
      <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-600" />
      IN STOCK
    </span>
  )
}

function BookingMobileCard({
  row,
  onOpen,
  now,
  onEdit,
  isSalesPerson,
  normalizedCurrentRole,
  onAddRemark,
}: {
  row: BookingRow
  onOpen: (id: string) => void
  now: number
  onEdit?: (id: string) => void
  isSalesPerson?: boolean
  normalizedCurrentRole?: string
  onAddRemark?: (type: 'overdue' | 'idt' | 'general') => void
}) {
  const router = useRouter()
  const canViewPii = useCanViewPii()

  const metaRemarks = Array.isArray(row.metadata?.remarks) ? (row.metadata?.remarks as any[]) : []
  const remarksList = metaRemarks.length > 0
    ? metaRemarks
    : [
        ...(row.notes ? [{ id: '1', text: row.notes, authorName: 'Staff', createdAt: '' }] : []),
        ...(row.idtRemark ? [{ id: '2', text: row.idtRemark, authorName: 'IDT Team', createdAt: '' }] : [])
      ]
  const remarksCount = remarksList.length
  const latestRemark = remarksList.length > 0 ? remarksList[remarksList.length - 1] : null

  const isRowPending = getKiaBookingStageInfo(row.status, row.proformaApprovalStatus).state === 'pending'
  const isRowOverdue = isRowPending && isKiaBookingWaitLong(row.updatedAt, now)
  const isRemarkEnabled = isRowOverdue || remarksCount > 0 || (row.stockNotAvailable && normalizedCurrentRole === 'idt')

  return (
    <article className="kia-surface-flush kia-lift p-3.5 space-y-3 overflow-hidden" onClick={() => onOpen(row.id)}>
      {/* Top Header Row: Booking Number + Status Badge */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--kia-hairline)] pb-2 min-w-0">
        <div className="min-w-0">
          <Kicker>Booking</Kicker>
          <h3 className="text-sm font-extrabold leading-5 text-[var(--kia-text)] kia-tnum truncate">{row.bookingNumber}</h3>
        </div>
        <StatusBadge status={row.status} className="shrink-0 text-[10px]" />
      </div>

      {/* Customer Info & Pending/Stock Details */}
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold text-[var(--kia-text)] truncate">{row.customerName}</p>
            <p className="text-[11px] font-medium text-[var(--kia-text-faint)] mt-0.5">{maskKiaPii(row.customerPhone, canViewPii)}</p>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0 text-right min-w-0">
            {row.stockNotAvailable && <StockUnavailableFlag className="shrink-0" />}
            {row.stockAvailable && <StockAvailableFlag className="shrink-0" />}
            <BookingWaitingIndicator
              status={row.status}
              approvalStatus={row.proformaApprovalStatus}
              updatedAt={row.updatedAt}
              now={now}
              align="right"
              remarksCount={remarksCount}
              latestRemarkText={latestRemark?.text}
              onAddOverdueRemark={onAddRemark ? () => onAddRemark('overdue') : undefined}
            />
          </div>
        </div>
      </div>

      {/* Vehicle & Consultant Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50/70 p-2.5 rounded-xl border border-slate-150">
        <FieldValue label="Vehicle" value={<><span className="font-bold text-[var(--kia-text)]">{row.model || '—'}</span><br /><span className="text-[var(--kia-text-soft)]">{row.variant || '—'}</span></>} />
        <FieldValue label="Consultant" value={<>{row.consultantName || '—'}<br /><span className="text-[var(--kia-text-faint)]">{formatDate(row.updatedAt)}</span></>} />
        <FieldValue label="VIN" value={row.allocatedVin || '—'} mono />
        <FieldValue label="Finance" value={row.financeOrderNumber || '—'} />
      </div>

      <div className="flex items-center gap-2 pt-0.5" onClick={(event) => event.stopPropagation()}>
        {row.proformaNumber ? (
          <div className="flex gap-2 flex-1">
            {!isSalesPerson ? (
              <Link
                href={`/brands/kia/proforma/all-proforma-details?search=${row.proformaNumber}`}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-[11px] font-bold uppercase tracking-[0.06em]"
                style={toneSoftStyle('accent')}
              >
                Proforma ready <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <span
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500 opacity-80"
              >
                Proforma Ready
              </span>
            )}
            <a
              href={`/api/brands/kia/proforma/${row.proformaId}/preview`}
              target="_blank"
              rel="noopener noreferrer"
              download={`Kia-Proforma-${row.proformaNumber}.pdf`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--dashboard-action-bg)] shrink-0"
              style={toneSoftStyle('accent')}
              title="Download Proforma PDF"
            >
              <Download className="h-4 w-4" />
            </a>
          </div>
        ) : (
          <Button
            size="sm"
            className="h-9 flex-1 rounded-xl px-3 text-[11px] font-bold"
            onClick={() => router.push(`/brands/kia/proforma/generate?bookingId=${row.id}`)}
          >
            Generate Proforma
          </Button>
        )}
        <div className="relative inline-flex items-center shrink-0">
          <Button
            variant="outline"
            size="sm"
            disabled={!isRemarkEnabled}
            title={
              remarksCount > 0
                ? `${remarksCount} Remark${remarksCount > 1 ? 's' : ''}: "${remarksList[remarksList.length - 1]?.text}"`
                : isRowOverdue
                  ? 'Add remark for overdue booking'
                  : 'Add / View remark'
            }
            className={cn(
              "relative h-9 w-9 rounded-xl p-0 shrink-0 border-slate-200 cursor-pointer flex items-center justify-center",
              isRowOverdue
                ? "text-rose-600 hover:bg-rose-100 bg-rose-50 border-rose-200/80 shadow-2xs"
                : remarksCount > 0
                  ? "text-indigo-600 hover:bg-indigo-50 bg-indigo-50/50 border-indigo-200/60"
                  : isRemarkEnabled
                    ? "text-amber-500 hover:bg-amber-50"
                    : "text-slate-300 cursor-not-allowed"
            )}
            onClick={() => {
              if (!onAddRemark) return
              if (isRowOverdue) {
                onAddRemark('overdue')
              } else if (row.stockNotAvailable) {
                onAddRemark('idt')
              } else {
                onAddRemark('general')
              }
            }}
          >
            <MessageSquare className="h-4 w-4" />
            {remarksCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[9px] font-black text-white shadow-xs">
                {remarksCount}
              </span>
            )}
          </Button>
        </div>
        {onEdit && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 rounded-xl p-0 shrink-0 border-slate-200 text-slate-700 hover:bg-slate-50"
            onClick={() => onEdit(row.id)}
            title="Edit booking"
          >
            <Pencil className="h-3.5 w-3.5" />
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

const MANAGERS = ['SANJEEV KOUL', 'MUZAFFAR IQBALL', 'Irshad Ahmed', 'Rahul Bhasin'] as const

const TLS = [
  'MICHAEL DEEP SINGH',
  'NAVAL PREET SINGH',
  'UDHAMPUR',
  'OTHER DEALER',
  'SHIV DEV SINGH',
  'AKASH BHAT'
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

  const selectedDisplay = value || 'Select Variant...'

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
          </div>
        </div>
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
    panCardUrl: '',
    panCardName: '',
    panNumber: '',
    aadhaarCardUrl: '',
    aadhaarCardName: '',
    aadhaarNumber: '',
    employeeIdUrl: '',
    employeeIdName: '',
    exchange: 'No',
    exchangeVehicleName: '',
    exchangeValue: '',
    requestDiscount: false,
    discountRequestedAmount: '',
    discountReason: '',
  }
}

export function KiaBookingsClient({
  initialSearchParams,
  embedMode = false,
  currentUserRole = 'viewer',
  currentUserName = '',
  mode = 'crm',
  priceOptions,
}: {
  initialSearchParams: SearchParamsInput
  embedMode?: boolean
  currentUserRole?: string
  currentUserName?: string
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
  const [startDate, setStartDate] = useState(firstParam(initialSearchParams, 'startDate', ''))
  const [endDate, setEndDate] = useState(firstParam(initialSearchParams, 'endDate', ''))
  const [page, setPage] = useState(Number(firstParam(initialSearchParams, 'page', '1')) || 1)
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>(firstParam(initialSearchParams, 'sort', 'desc') === 'asc' ? 'asc' : 'desc')
  const [notInStockModalOpen, setNotInStockModalOpen] = useState(false)
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
  const [transferType, setTransferType] = useState<'against_payment' | 'against_vehicle' | null>(null)
  const [transferAmountReceived, setTransferAmountReceived] = useState('')
  const [transferVehicleModel, setTransferVehicleModel] = useState('')
  const [transferVehicleVariant, setTransferVehicleVariant] = useState('')
  const [transferVehicleColor, setTransferVehicleColor] = useState('')
  const [crmViewMode, setCrmViewMode] = useState<'list' | 'shortage' | 'discounts'>('list')
  const [activeShortageGroup, setActiveShortageGroup] = useState<{
    model: string
    variant: string
    color: string
    bookings: any[]
  } | null>(null)
  const [shortageActionOpen, setShortageActionOpen] = useState(false)
  const [shortageStatus, setShortageStatus] = useState<'arranged' | 'cannot_arrange' | 'pending'>('pending')
  const [shortageSourceDealer, setShortageSourceDealer] = useState('')
  const [shortageExpectedDate, setShortageExpectedDate] = useState('')
  const [shortageRemarks, setShortageRemarks] = useState('')
  const [shortageSelectedBookingIds, setShortageSelectedBookingIds] = useState<string[]>([])
  const [selectedShortageKeys, setSelectedShortageKeys] = useState<string[]>([])
  const [transferVehiclePrice, setTransferVehiclePrice] = useState('')
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
  const [createSuccess, setCreateSuccess] = useState(false)
  const [deliverySuccess, setDeliverySuccess] = useState(false)
  const [allotSuccess, setAllotSuccess] = useState(false)
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<CreateBookingForm>(() => initialCreateForm())
  const [editTab, setEditTab] = useState<(typeof CREATE_TABS)[number]>('Customer')
  const [editSuccess, setEditSuccess] = useState(false)
  const [editingBookingNumber, setEditingBookingNumber] = useState('')
  const [priceUploading, setPriceUploading] = useState(false)
  const [priceUploadResult, setPriceUploadResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [isReplacePricesOpen, setIsReplacePricesOpen] = useState(false)

  const [invoiceViewerBooking, setInvoiceViewerBooking] = useState<any | null>(null)
  const [invoiceViewerOpen, setInvoiceViewerOpen] = useState(false)
  const [isEmiCalculatorOpen, setIsEmiCalculatorOpen] = useState(false)
  const [emiCalcTarget, setEmiCalcTarget] = useState<{ model?: string; variant?: string; exShowroom?: number } | null>(null)
  const [uploadingInvoiceFile, setUploadingInvoiceFile] = useState<File | null>(null)
  const [isUploadingInvoice, setIsUploadingInvoice] = useState(false)

  async function handleUploadInvoiceDoc(bookingId: string) {
    if (!uploadingInvoiceFile) return
    setIsUploadingInvoice(true)
    try {
      const formData = new FormData()
      formData.append('invoice', uploadingInvoiceFile)
      const meta = (invoiceViewerBooking?.metadata || {}) as Record<string, unknown>
      const accountsVerification = (meta.accountsVerification || {}) as Record<string, unknown>
      if (accountsVerification.invoiceNumber) {
        formData.append('invoiceNumber', String(accountsVerification.invoiceNumber))
      }
      const res = await fetch(`/api/brands/kia/bookings/${bookingId}/accounts-verify`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to upload invoice document.')
      setActionMessage('Invoice PDF document uploaded successfully.')
      listQuery.refetch()
      if (selectedBookingId) detailQuery.refetch()
      setInvoiceViewerBooking(data.booking || null)
      setUploadingInvoiceFile(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setIsUploadingInvoice(false)
    }
  }

  type BookingRemarkItem = {
    id: string
    text: string
    authorName: string
    authorRole?: string
    createdAt: string
    type?: 'overdue' | 'idt' | 'general'
  }

  const [remarkBookingId, setRemarkBookingId] = useState<string | null>(null)
  const [remarkBookingNumber, setRemarkBookingNumber] = useState<string>('')
  const [remarkBookingCustomer, setRemarkBookingCustomer] = useState<string>('')
  const [remarkText, setRemarkText] = useState('')
  const [existingRemarksList, setExistingRemarksList] = useState<BookingRemarkItem[]>([])
  const [remarkType, setRemarkType] = useState<'overdue' | 'idt' | 'general'>('overdue')
  const [remarkOpen, setRemarkOpen] = useState(false)
  const [remarkSubmitting, setRemarkSubmitting] = useState(false)

  const openRemarkDialog = useCallback((row: { id: string; bookingNumber?: string; customerName?: string; notes?: string | null; idtRemark?: string | null; metadata?: Record<string, unknown> | null; stockNotAvailable?: boolean; status?: string; proformaApprovalStatus?: string | null; updatedAt?: string | null }, type: 'overdue' | 'idt' | 'general') => {
    setRemarkBookingId(row.id)
    setRemarkBookingNumber(row.bookingNumber || '')
    setRemarkBookingCustomer(row.customerName || '')
    
    const metaRemarks = Array.isArray(row.metadata?.remarks) ? (row.metadata?.remarks as BookingRemarkItem[]) : []
    let initialList = [...metaRemarks]
    
    if (initialList.length === 0) {
      if (row.notes) {
        initialList.push({
          id: 'legacy-notes',
          text: row.notes,
          authorName: 'Staff',
          authorRole: 'Remark',
          createdAt: row.updatedAt || '',
          type: 'general',
        })
      }
      if (row.idtRemark && !initialList.some(r => r.text === row.idtRemark)) {
        initialList.push({
          id: 'legacy-idt',
          text: row.idtRemark,
          authorName: 'IDT Team',
          authorRole: 'IDT Stock',
          createdAt: row.updatedAt || '',
          type: 'idt',
        })
      }
    }
    
    setExistingRemarksList(initialList)
    setRemarkText('')
    setRemarkType(type)
    setRemarkOpen(true)
  }, [])

  async function handleSaveRemark() {
    if (!remarkBookingId || !remarkText.trim()) return
    setRemarkSubmitting(true)
    try {
      const newRemarkItem: BookingRemarkItem = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        text: remarkText.trim(),
        authorName: currentUserName || 'Team Member',
        authorRole: currentUserRole ? currentUserRole.toUpperCase() : 'Staff',
        createdAt: new Date().toISOString(),
        type: remarkType,
      }

      const updatedRemarks = [...existingRemarksList, newRemarkItem]

      const bodyPayload = remarkType === 'idt'
        ? {
            idtRemark: remarkText.trim(),
            notes: remarkText.trim(),
            metadata: { remarks: updatedRemarks }
          }
        : {
            notes: remarkText.trim(),
            metadata: { remarks: updatedRemarks }
          }

      const response = await fetch(`/api/brands/kia/bookings/${remarkBookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to save remark.')
      }

      setExistingRemarksList(updatedRemarks)
      setRemarkText('')
      setActionMessage('Remark added successfully.')
      listQuery.refetch()
      if (selectedBookingId) {
        detailQuery.refetch()
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save remark.')
    } finally {
      setRemarkSubmitting(false)
    }
  }

  async function uploadPriceMaster(file?: File | null) {
    if (!file) return
    setPriceUploading(true)
    setPriceUploadResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/brands/kia/proforma/price-details/upload', { method: 'POST', body: formData })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Failed to import price details.')
      const summary = payload.summary
      setPriceUploadResult({
        ok: true,
        message: summary
          ? `Imported ${summary.importedRows} rows${summary.failedRows ? `, ${summary.failedRows} failed` : ''} from "${summary.sheetName}".`
          : 'Prices replaced successfully.',
      })
    } catch (uploadError) {
      setPriceUploadResult({ ok: false, message: uploadError instanceof Error ? uploadError.message : 'Failed to import price details.' })
    } finally {
      setPriceUploading(false)
    }
  }

  const handleDownloadPriceTemplate = () => {
    const headers = [
      'Model',
      'Trim Description',
      'Ex-Showroom Price',
      'TCS',
      'Registration Charges',
      'Statutory Charges',
      'Insurance',
      'FASTag',
      'Accessories Kit',
      'Extended Warranty 4th Year',
      'HYP',
      'Bank Branch'
    ]

    const sampleRows = [
      [
        'Seltos',
        'HTX 1.5 Petrol MT',
        '1519000',
        '15190',
        '136710',
        '600',
        '58500',
        '600',
        '25000',
        '19500',
        'HDFC Bank',
        'Kanjurmarg'
      ],
      [
        'Sonet',
        'HTK Plus 1.2 Petrol MT',
        '1049000',
        '10490',
        '94410',
        '600',
        '42500',
        '600',
        '20000',
        '14500',
        'State Bank of India',
        'Thane West'
      ]
    ]

    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'PRICE DETAILS')
    XLSX.writeFile(wb, 'AM_Kia_Price_Master_Template.xlsx')
  }

  const editingDetailQuery = useQuery({
    queryKey: ['kia-booking-detail', editingBookingId],
    queryFn: () => fetchJson<BookingDetailPayload>(`/api/brands/kia/bookings/${editingBookingId}`, 'kia-booking-detail'),
    enabled: Boolean(editingBookingId),
    retry: 1,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // "Replace Prices" (KIA price-master Excel upload) now lives in Admin → System.
  const canUseTestPersona = currentUserRole === 'developer'
  const normalizedCurrentRole = normalizeRole(currentUserRole)
  const canCreateBookings = roleCanActAsSalesPerson(normalizedCurrentRole)
  const canViewPii = canViewKiaCustomerPii(currentUserRole)
  const stockMode = mode === 'stock'
  const shortageMode = crmViewMode === 'shortage'
  const animated = usePremiumMotion()
  // Live minute tick for the "time waiting" indicators on each list row.
  const nowTick = useMinuteTick()

  useEffect(() => {
    if (editingDetailQuery.error && editingBookingId) {
      toast({
        title: 'Error loading booking',
        description: editingDetailQuery.error instanceof Error ? editingDetailQuery.error.message : 'Please try again.',
        variant: 'error',
      })
      setEditingBookingId(null)
    }
  }, [editingDetailQuery.error, editingBookingId])

  useEffect(() => {
    if (editingBookingId && editingDetailQuery.data?.booking) {
      const b = editingDetailQuery.data.booking
      const meta = (b.metadata || {}) as Record<string, unknown>
      setEditForm({
        customerName: b.customerName || '',
        customerType: String(meta.customerType || 'Regular'),
        countryCode: String(meta.countryCode || '91'),
        customerPhone: b.customerPhone || '',
        customerEmailId: b.customerEmail || String(meta.customerEmailId || ''),
        model: b.model || '',
        year: String(meta.year || '2026'),
        fuelType: b.fuelType || String(meta.fuelType || 'PETROL'),
        variant: b.variant || '',
        bankFinance: b.bankName || String(meta.bankFinance || ''),
        bookingAmount: String(meta.bookingAmount || ''),
        bookingDate: String(meta.bookingDate || (b.createdAt ? new Date(b.createdAt).toISOString().split('T')[0] : '')),
        pmtSource: String(meta.pmtSource || ''),
        paymentAmount: String(meta.paymentAmount || ''),
        managerName: String(meta.managerName || 'SANJEEV KOUL'),
        tlName: String(meta.tlName || ''),
        consultantName: b.consultantName || '',
        color: b.color || b.colorPreference || String(meta.color || ''),
        leadSource: String(meta.leadSource || ''),
        status: b.status || 'NOT IN STOCK',
        expectedDeliveryDate: b.expectedDeliveryDate || String(meta.expectedDeliveryDate || ''),
        commitment: String(meta.commitment || ''),
        otherDealerDetails: String(meta.otherDealerDetails || ''),
        promiseDate: String(meta.promiseDate || ''),
        costSheet: String(meta.costSheet || ''),
        waitingPeriod: String(meta.waitingPeriod || ''),
        dealerCode: b.dealerCode || 'JK402',
        notes: b.notes || String(meta.notes || ''),
        panCardUrl: String(meta.panCardUrl || ''),
        panCardName: String(meta.panCardName || ''),
        panNumber: String(meta.panNumber || ''),
        aadhaarCardUrl: String(meta.aadhaarCardUrl || ''),
        aadhaarCardName: String(meta.aadhaarCardName || ''),
        aadhaarNumber: String(meta.aadhaarNumber || ''),
        employeeIdUrl: String(meta.employeeIdUrl || ''),
        employeeIdName: String(meta.employeeIdName || ''),
        exchange: String(meta.exchange || 'No'),
        exchangeVehicleName: String(meta.exchangeVehicleName || ''),
        exchangeValue: String(meta.exchangeValue || ''),
      })
      setEditingBookingNumber(b.bookingNumber || '')
      setEditTab('Customer')
      setIsEditOpen(true)
    }
  }, [editingBookingId, editingDetailQuery.data])

  // Detail-drawer state is LOCAL, seeded once from ?bookingId for deep-links. It used to read the URL
  // live, so opening/closing had to router.replace/push — and in Next 16 each of those is a network RSC
  // round-trip (see the URL-sync note below), which is exactly the "it calls the API again when I close"
  // problem. Local state makes open/close a pure client update: open is a React Query cache hit (the
  // detail is prefetched on pointer-down) and close does ZERO network.
  const [selectedBookingId, setSelectedBookingId] = useState(() => searchParams.get('bookingId') || '')

  // Debounce search so the bookings list query doesn't refire on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Automatically populate consultantName in the form state from the logged-in user context
  useEffect(() => {
    if (createOpen && currentUserName && !createForm.consultantName) {
      updateCreateForm('consultantName', currentUserName)
    }
  }, [createOpen, currentUserName, createForm.consultantName])

  // Mirror the filters into the URL for shareability / the back button.
  //
  // Uses `debouncedSearch`, NOT `search`. With the raw value this fired on EVERY KEYSTROKE — typing
  // "SHARMA" cost six server renders. The list query below was already debounced (see the comment
  // above), so the cheap API call was throttled while the expensive one was not: exactly backwards.
  //
  // DO NOT "optimise" this to window.history.replaceState. That looks like it avoids the RSC
  // round-trip, and the Next docs' "Shallow routing on the client" section reads like it does — but
  // in Next 16 it does not. next/dist/client/components/app-router.js patches replaceState and only
  // bails out for its OWN calls (`if (data?.__NA || data?._N)`); a userland call with data=null
  // falls through to applyUrlFromHistoryPushReplace → ACTION_RESTORE → spawnDynamicRequests, which
  // refetches any route that isn't fully cached. This route reads cookies in its auth guard, so it
  // never is. Tried it, measured it, reverted it — the round-trip is the same, and it can hard-
  // navigate if startPPRNavigation returns null.
  useEffect(() => {
    // `page > 1 ? page : undefined` is load-bearing, not cosmetic. `page` initialises to 1 on a bare
    // load (:1310), but the raw `page` here made buildQueryString emit `page=1` — which never matches
    // the initial URL (it has no `page`), so this effect fired a router.replace on EVERY mount, and in
    // Next 16 a router.replace is a full RSC round-trip (see the long note above). That doubled the
    // render count of the single most-loaded route in the module. Omitting page 1 (the conventional
    // default) makes nextSearch === currentSearch on a clean load, so no replace fires. The list query
    // still sends `page` via its own buildQueryString call below, so pagination is unaffected.
    const query = buildQueryString({ search: debouncedSearch, dealer_code: dealer, model, status, consultant, startDate: startDate || undefined, endDate: endDate || undefined, page: page > 1 ? page : undefined, sort: sortOrder === 'asc' ? 'asc' : undefined })
    const next = new URLSearchParams(query)
    const nextSearch = next.toString() ? `?${next.toString()}` : ''
    const currentSearch = typeof window !== 'undefined' ? window.location.search : ''
    if (nextSearch !== currentSearch) {
      router.replace(`${pathname}${nextSearch}`, { scroll: false })
    }
  }, [pathname, consultant, dealer, model, page, router, debouncedSearch, status, embedMode, sortOrder, startDate, endDate])

  const listQueryString = useMemo(() => buildQueryString({
    search: debouncedSearch,
    dealer_code: dealer,
    model,
    status,
    consultant,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    sort: sortOrder,
  }), [consultant, dealer, debouncedSearch, model, page, status, sortOrder, startDate, endDate])

  const listQuery = useQuery({
    queryKey: ['kia-bookings', listQueryString],
    queryFn: () => fetchJson<BookingListPayload>(`/api/brands/kia/bookings?${listQueryString}`, 'kia-bookings-list'),
    retry: 2,
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_GC_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // Keep the current rows on screen while a page/filter change refetches, so the
    // table never flashes an empty skeleton — pagination + search feel instant.
    placeholderData: keepPreviousData,
  })

  const detailQuery = useQuery({
    queryKey: ['kia-booking-detail', selectedBookingId],
    queryFn: () => fetchJson<BookingDetailPayload>(`/api/brands/kia/bookings/${selectedBookingId}`, 'kia-booking-detail'),
    enabled: Boolean(selectedBookingId),
    retry: 1,
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_GC_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => {
      if (previousData) return previousData
      const row = listQuery.data?.rows?.find((r) => r.id === selectedBookingId) as any
      if (row) {
        return {
          booking: {
            ...row,
            address: row.customerAddress,
            colorPreference: row.color,
            expectedDeliveryDate: row.deliveryTargetDate,
            proformaNumber: row.proformaId ? String(row.proformaId).slice(0, 8).toUpperCase() : null,
            financeOrderNumber: row.financeOrderId ? String(row.financeOrderId).slice(0, 8).toUpperCase() : null,
          },
          activities: [],
          transfers: [],
          allocation: null,
          proforma: null,
          financeOrder: null,
        }
      }
      return undefined
    }
  })

  const matchingQuery = useQuery({
    queryKey: ['kia-booking-matching-vehicles', selectedBookingId],
    queryFn: () => fetchJson<MatchingVehiclesPayload>(`/api/brands/kia/bookings/${selectedBookingId}/matching-vehicles`, 'kia-booking-matching-vehicles'),
    enabled: Boolean(selectedBookingId) && detailQuery.data?.proforma?.status === 'APPROVED',
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const discountsQuery = useQuery({
    queryKey: ['kia-booking-discounts', selectedBookingId],
    queryFn: () => fetchJson<{ success: boolean; discounts: any[] }>(`/api/brands/kia/bookings/${selectedBookingId}/discounts`, 'kia-booking-discounts'),
    enabled: Boolean(selectedBookingId) && !(detailQuery.data as any)?.discounts,
    retry: 1,
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_GC_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    initialData: (detailQuery.data as any)?.discounts ? { success: true, discounts: (detailQuery.data as any).discounts } : undefined,
  })

  const globalDiscountsQuery = useQuery({
    queryKey: ['kia-global-discounts'],
    queryFn: () => fetchJson<{ success: boolean; discounts: any[] }>('/api/brands/kia/bookings/discounts', 'kia-global-discounts'),
    enabled: ['md', 'ceo', 'developer', 'admin', 'sales_manager', 'general_manager'].includes(currentUserRole),
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const proformaOptionsQuery = useQuery({
    queryKey: ['kia-proforma-options-for-bookings'],
    queryFn: () => fetchJson<ProformaOptionsPayload>('/api/brands/kia/proforma/options', 'kia-proforma-options'),
    staleTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
    enabled: !priceOptions,
  })

  const shortageQuery = useQuery({
    queryKey: ['kia-bookings-shortages', listQueryString],
    queryFn: () => fetchJson<BookingListPayload>(`/api/brands/kia/bookings?status=not_in_stock&pageSize=1000`, 'kia-bookings-shortages'),
    enabled: crmViewMode === 'shortage',
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const shortageActionMutation = useMutation({
    mutationFn: async ({ bookingIds, status, sourceDealer, expectedDate, remarks }: {
      bookingIds: string[]
      status: 'arranged' | 'cannot_arrange' | 'pending'
      sourceDealer: string
      expectedDate: string
      remarks: string
    }) => {
      await Promise.all(bookingIds.map(async (id) => {
        const response = await fetch(`/api/brands/kia/bookings/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metadata: {
              idtArrangement: {
                status,
                sourceDealer: status === 'arranged' ? sourceDealer : undefined,
                expectedDate: status === 'arranged' ? expectedDate : undefined,
                remarks: remarks || undefined,
              }
            }
          })
        })
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error || 'Failed to update shortage arrangement.')
        }
      }))
    },
    onSuccess: () => {
      toast({
        title: 'Arrangement saved',
        description: 'Shortage arrangement plan updated successfully.',
      })
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-bookings-shortages'] })
      setSelectedShortageKeys([])
      setShortageActionOpen(false)
    },
    onError: (err) => {
      toast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Failed to save arrangement.',
        variant: 'error',
      })
    }
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

  const editMutation = useMutation({
    mutationFn: (payload: CreateBookingForm) => fetchJson<{ ok: boolean }>(`/api/brands/kia/bookings/${editingBookingId}`, 'kia-booking-update', {
      method: 'PATCH',
      body: JSON.stringify({
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        customerEmail: payload.customerEmailId,
        dealerCode: payload.dealerCode,
        model: payload.model,
        variant: payload.variant,
        color: payload.color,
        fuelType: payload.fuelType,
        consultantName: payload.consultantName,
        source: payload.leadSource,
        bankName: payload.bankFinance,
        financeRequired: payload.bankFinance && payload.bankFinance !== 'CASH',
        loanAmount: payload.bookingAmount || '0',
        notes: payload.notes,
        metadata: payload,
      }),
    }),
    onSuccess: () => {
      setEditSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', editingBookingId] })
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
      setTransferType(null)
      setTransferAmountReceived('')
      setTransferVehicleModel('')
      setTransferVehicleVariant('')
      setTransferVehicleColor('')
      setTransferVehiclePrice('')
      if (loaderVariant === 'delivery') setDeliverySuccess(true)
      if (loaderVariant === 'vin-match') setAllotSuccess(true)
      queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-detail', selectedBookingId] })
      queryClient.invalidateQueries({ queryKey: ['kia-booking-matching-vehicles', selectedBookingId] })
      void listQuery.refetch()
      router.refresh()
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
  const bookingModelOptionsBase = priceModels.length > 0 ? priceModels : filters.models
  // When editing, also ensure the booking's stored model is always present in the list
  const bookingModelOptions = useMemo(() => {
    const base = bookingModelOptionsBase
    const editModel = (editForm.model || '').trim()
    if (editModel && !base.includes(editModel)) return [...base, editModel]
    return base
  }, [bookingModelOptionsBase, editForm.model])
  const bookingVariantOptions = useMemo(() => {
    // Use whichever form is currently active (create or edit) to filter variants
    const modelValue = (createForm.model || editForm.model || '').trim()
    return Array.from(new Set(priceTrims
      .filter((trim) => !modelValue || trim.model === modelValue)
      .map((trim) => trim.trim_description)
      .filter(Boolean)))
  }, [createForm.model, editForm.model, priceTrims])
  const priceBanks = useMemo(() => priceOptions?.banks || proformaOptionsQuery.data?.banks || [], [priceOptions?.banks, proformaOptionsQuery.data?.banks])
  const bookingBankOptions = useMemo(() => {
    const names = priceBanks.map((b) => b.bank_name || '').filter(Boolean)
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
  }, [priceBanks])

  const groupedShortages = useMemo(() => {
    if (!shortageQuery.data?.rows) return []
    const groups: Record<string, {
      model: string
      variant: string
      color: string
      bookings: any[]
    }> = {}

    shortageQuery.data.rows.forEach((row: any) => {
      const modelName = (row.model || '').trim().toUpperCase()
      const variantName = (row.variant || '').trim()
      const colorName = (row.color || '').trim()
      const key = `${modelName}|${variantName}|${colorName}`
      
      if (!groups[key]) {
        groups[key] = {
          model: row.model,
          variant: row.variant,
          color: row.color || '',
          bookings: [],
        }
      }
      groups[key].bookings.push(row)
    })

    return Object.values(groups).sort((a, b) => b.bookings.length - a.bookings.length)
  }, [shortageQuery.data?.rows])
  const kpis = data?.kpis || {
    today: 0,
    pendingProforma: 0,
    waitingAllocation: 0,
    financePending: 0,
    readyDelivery: 0,
    delivered: 0,
    cancelled: 0,
    notInStock: 0,
  }

  // Prefetch the detail on INTENT (hover/focus of a row) rather than eagerly for the first N rows.
  // The eager version fired 8 full booking-detail requests on every list load / filter / invalidation —
  // for records the user usually never opened — and each of those is an expensive endpoint. Hover
  // keeps the instant-open feel while only paying for rows the user actually points at, and the
  // 60s staleTime stops a mouse sweep across the table from refetching the same row repeatedly.
  const prefetchBookingDetail = useCallback((id: string) => {
    queryClient.prefetchQuery({
      queryKey: ['kia-booking-detail', id],
      queryFn: () => fetchJson<BookingDetailPayload>(`/api/brands/kia/bookings/${id}`, 'kia-booking-detail'),
      staleTime: 60_000,
    })
  }, [queryClient])

  // Hover-INTENT, not hover. onMouseEnter fires for every row the pointer merely CROSSES — moving to
  // row 8 traverses rows 1-7 — and each was firing a full 6-query detail request. That is what put
  // bookings/[id] at 740 calls against a 53-row table (each booking fetched ~14x). The 60s staleTime
  // can't help: distinct row ids are distinct cache keys, so a sweep is N misses, not one.
  //
  // A ~180ms timer separates traversal (pointer dwells ~20-60ms, cancelled) from intent (pointer
  // stops on a row, fires). A fast clicker who beats the timer is covered by the onPointerDown path
  // below — pointerdown precedes click by ~80-150ms, so the drawer still opens on a warm/in-flight
  // cache rather than a skeleton. One shared timer for the whole table, not one per row.
  const hoverIntentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleHoverPrefetch = useCallback((id: string) => {
    // Hover-prefetch is OFF in the embedded (proforma) bookings view. There it opens a drawer, not a
    // page, so the instant-open payoff is marginal — and per-row hover in that embed was the dominant
    // source of the /api/brands/kia/bookings/[id] invocation volume seen in production. onPointerDown
    // (below) still warms the cache on a real click, so opening still lands on a warm/in-flight cache.
    if (embedMode) return
    if (hoverIntentTimer.current) clearTimeout(hoverIntentTimer.current)
    // 300ms (was 180ms): only a genuine dwell — settling on a row you intend to open — fires, not the
    // longer reading pauses of someone scanning the list. Fast clicks are covered by onPointerDown.
    hoverIntentTimer.current = setTimeout(() => prefetchBookingDetail(id), 300)
  }, [prefetchBookingDetail, embedMode])
  const cancelHoverPrefetch = useCallback(() => {
    if (hoverIntentTimer.current) { clearTimeout(hoverIntentTimer.current); hoverIntentTimer.current = null }
  }, [])
  useEffect(() => () => { if (hoverIntentTimer.current) clearTimeout(hoverIntentTimer.current) }, [])

  function openBooking(id: string) {
    // Pure client state — no router navigation (each is an RSC round-trip in Next 16). The detail is
    // prefetched on pointer-down, so opening the drawer is a React Query cache hit with no new request.
    setSelectedBookingId(id)
  }

  function closeBooking() {
    // Pure client state — closing does ZERO network. Previously each close was a router.replace/push
    // (an RSC round-trip), which is the "it calls the API again on close" you saw. The detail stays in
    // the React Query cache for the next open.
    setSelectedBookingId('')
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
      ['panCardUrl', 'PAN Card upload'],
      ['panNumber', 'PAN Number'],
      ...(createForm.customerType !== 'Firm' ? [
        ['aadhaarCardUrl', 'Aadhaar Card upload'] as [keyof CreateBookingForm, string],
        ['aadhaarNumber', 'Aadhaar Number'] as [keyof CreateBookingForm, string],
      ] : []),
      ['model', 'Model'],
      ['year', 'YEAR'],
      ['variant', 'Variant'],
      ['color', 'Colour'],
      ['status', 'Stock Status'],
      ['managerName', 'Manager Name'],
      ['tlName', 'Team Leader'],
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
    const missing = requiredFields.find(([key]) => !String(createForm[key] || '').trim())
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
        panCardUrl: 'Customer',
        panCardName: 'Customer',
        panNumber: 'Customer',
        aadhaarCardUrl: 'Customer',
        aadhaarCardName: 'Customer',
        aadhaarNumber: 'Customer',
        employeeIdUrl: 'Customer',
        employeeIdName: 'Customer',
        exchange: 'Customer',
        exchangeVehicleName: 'Customer',
        exchangeValue: 'Customer',
        requestDiscount: 'Review',
        discountRequestedAmount: 'Review',
        discountReason: 'Review',
      }
      setCreateTab(tabByField[missing[0]] || 'Customer')
      return
    }
    // Format checks for the AI-read / user-entered ID numbers (both required).
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(createForm.panNumber.trim().toUpperCase())) {
      setFormError('Enter a valid PAN (e.g. ABCDE1234F).'); setCreateTab('Customer'); return
    }
    if (createForm.customerType !== 'Firm' && createForm.aadhaarNumber.replace(/\D/g, '').length !== 12) {
      setFormError('Enter a valid 12-digit Aadhaar number.'); setCreateTab('Customer'); return
    }
    // Exchange (trade-in): when opted in, the old-vehicle name + value are required.
    if (createForm.exchange === 'Yes') {
      if (!createForm.exchangeVehicleName.trim()) { setFormError('Enter the exchange vehicle name.'); setCreateTab('Customer'); return }
      if (!(Number(createForm.exchangeValue) > 0)) { setFormError('Enter a valid exchange value.'); setCreateTab('Customer'); return }
    }
    // Consultant is always the logged-in user — never chosen in the form — so ownership is accurate.
    createMutation.mutate({ ...createForm, consultantName: currentUserName || createForm.consultantName })
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editTab !== 'Review') return
    setFormError('')
    const requiredFields: Array<[keyof CreateBookingForm, string]> = [
      ['customerName', 'Customer Name'],
      ['countryCode', 'Country Code'],
      ['customerPhone', 'Mobile number'],
      ['customerEmailId', 'Customer Email Id'],
      ['panCardUrl', 'PAN Card upload'],
      ['panNumber', 'PAN Number'],
      ...(editForm.customerType !== 'Firm' ? [
        ['aadhaarCardUrl', 'Aadhaar Card upload'] as [keyof CreateBookingForm, string],
        ['aadhaarNumber', 'Aadhaar Number'] as [keyof CreateBookingForm, string],
      ] : []),
      ['model', 'Model'],
      ['year', 'YEAR'],
      ['variant', 'Variant'],
      ['color', 'Colour'],
      ['status', 'Stock Status'],
      ['managerName', 'Manager Name'],
      ['tlName', 'Team Leader'],
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
    const missing = requiredFields.find(([key]) => !String(editForm[key] || '').trim())
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
        panCardUrl: 'Customer',
        panCardName: 'Customer',
        panNumber: 'Customer',
        aadhaarCardUrl: 'Customer',
        aadhaarCardName: 'Customer',
        aadhaarNumber: 'Customer',
        employeeIdUrl: 'Customer',
        employeeIdName: 'Customer',
        exchange: 'Customer',
        exchangeVehicleName: 'Customer',
        exchangeValue: 'Customer',
        requestDiscount: 'Review',
        discountRequestedAmount: 'Review',
        discountReason: 'Review',
      }
      setEditTab(tabByField[missing[0]] || 'Customer')
      return
    }
    // Format checks
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(editForm.panNumber.trim().toUpperCase())) {
      setFormError('Enter a valid PAN (e.g. ABCDE1234F).'); setEditTab('Customer'); return
    }
    if (editForm.customerType !== 'Firm' && editForm.aadhaarNumber.replace(/\D/g, '').length !== 12) {
      setFormError('Enter a valid 12-digit Aadhaar number.'); setEditTab('Customer'); return
    }
    if (editForm.exchange === 'Yes') {
      if (!editForm.exchangeVehicleName.trim()) { setFormError('Enter the exchange vehicle name.'); setEditTab('Customer'); return }
      if (!(Number(editForm.exchangeValue) > 0)) { setFormError('Enter a valid exchange value.'); setEditTab('Customer'); return }
    }
    editMutation.mutate(editForm)
  }

  function runAction(action: 'proforma' | 'finance' | 'payment' | 'accounts' | 'release' | 'deliver' | 'cancel' | 'transfer' | 'hold' | 'resume') {
    if (!selectedBookingId) return
    if (action === 'proforma') {
      router.push(`/brands/kia/proforma/generate?bookingId=${selectedBookingId}`)
      return
    }
    if (action === 'hold') {
      const reason = window.prompt('Put this booking on hold? Optionally add a reason:', '')
      if (reason === null) return // user cancelled the prompt
      setLoaderVariant('generic')
      actionMutation.mutate({ endpoint: `/api/brands/kia/bookings/${selectedBookingId}/hold`, body: { action: 'hold', reason } })
      return
    }
    if (action === 'resume') {
      if (!window.confirm('Resume this booking from hold?')) return
      setLoaderVariant('generic')
      actionMutation.mutate({ endpoint: `/api/brands/kia/bookings/${selectedBookingId}/hold`, body: { action: 'resume' } })
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
      setTransferType(null)
      setTransferAmountReceived('')
      setTransferVehicleModel('')
      setTransferVehicleVariant('')
      setTransferVehicleColor('')
      setTransferVehiclePrice('')
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
    setTransferType(null)
    setTransferAmountReceived('')
    setTransferVehicleModel('')
    setTransferVehicleVariant('')
    setTransferVehicleColor('')
    setTransferVehiclePrice('')
  }

  function confirmTransfer() {
    if (!selectedBookingId || !transferTarget || !transferToDealerCode || !transferType) return
    setLoaderVariant('transfer')
    actionMutation.mutate({
      endpoint: `/api/brands/kia/bookings/${selectedBookingId}/transfer`,
      body: {
        toDealerCode: transferToDealerCode,
        notes: transferReferenceName,
        vinNumber: transferTarget.vinNumber,
        transferType,
        ...(transferType === 'against_payment' ? { amountReceived: transferAmountReceived } : {}),
        ...(transferType === 'against_vehicle' ? {
          exchangeModel: transferVehicleModel,
          exchangeVariant: transferVehicleVariant,
          exchangeColor: transferVehicleColor,
          priceDifference: transferVehiclePrice,
        } : {}),
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

  const currentHeading = shortageMode
    ? {
        badge: 'IDT Procurement',
        title: 'Shortage & IDT Management',
        subtitle: 'Identify vehicle shortages, log procurement plans, and trace regional transfers.',
      }
    : stockMode
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
      {!stockMode && (
        <div className="flex gap-2">
          <Button
            variant={crmViewMode === 'shortage' ? 'default' : 'outline'}
            className={cn("h-10 rounded-2xl px-4 text-sm font-bold sm:h-11 border-indigo-200/60", crmViewMode === 'shortage' && "bg-indigo-600 hover:bg-indigo-700 text-white")}
            onClick={() => setCrmViewMode(crmViewMode === 'shortage' ? 'list' : 'shortage')}
          >
            {crmViewMode === 'shortage' ? (
              <>
                <ClipboardList className="h-4 w-4" /> Bookings List
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-indigo-500 animate-pulse" /> Manage Shortages
              </>
            )}
          </Button>

          {['md', 'ceo', 'developer', 'admin', 'sales_manager', 'general_manager'].includes(currentUserRole) && (
            <Button
              variant={crmViewMode === 'discounts' ? 'default' : 'outline'}
              className={cn("h-10 rounded-2xl px-4 text-sm font-bold sm:h-11 border-slate-200", crmViewMode === 'discounts' && "bg-slate-950 hover:bg-slate-800 text-white")}
              onClick={() => setCrmViewMode(crmViewMode === 'discounts' ? 'list' : 'discounts')}
            >
              {crmViewMode === 'discounts' ? (
                <>
                  <ClipboardList className="h-4 w-4" /> Bookings List
                </>
              ) : (
                <>
                  <Percent className="h-4 w-4 text-slate-700" /> Manage Discounts
                </>
              )}
            </Button>
          )}
        </div>
      )}
      {canCreateBookings && !stockMode && crmViewMode === 'list' && (
        <>
          <Button className="h-10 rounded-2xl px-4 text-sm font-bold sm:h-11" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Booking
          </Button>
          <Button variant="outline" className="h-10 rounded-2xl px-4 text-sm font-bold sm:h-11" onClick={() => setQuoteOpen(true)}>
            <FileText className="h-4 w-4" /> Email Quote
          </Button>
        </>
      )}
      <Button
        variant="outline"
        className="h-10 rounded-2xl px-4 text-sm font-bold sm:h-11 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100/70 text-indigo-900 flex items-center gap-1.5 shadow-xs"
        onClick={() => {
          setEmiCalcTarget(null)
          setIsEmiCalculatorOpen(true)
        }}
      >
        <Calculator className="h-4 w-4 text-indigo-600" /> EMI Calculator
      </Button>
      <Button variant="outline" className="h-10 rounded-2xl px-4 text-sm font-bold sm:h-11" onClick={() => { listQuery.refetch(); shortageQuery.refetch(); globalDiscountsQuery.refetch() }} disabled={listQuery.isFetching || shortageQuery.isFetching || globalDiscountsQuery.isFetching}>
        <RefreshCw className={cn('h-4 w-4', (listQuery.isFetching || globalDiscountsQuery.isFetching) && 'animate-spin')} /> Refresh
      </Button>
      {['edp', 'developer'].includes(currentUserRole) && (
        <Button
          onClick={() => {
            setPriceUploadResult(null)
            setIsReplacePricesOpen(true)
          }}
          className="h-10 rounded-2xl px-4 text-sm font-bold sm:h-11 bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-1.5"
        >
          <Upload className="h-4 w-4" /> Replace Prices
        </Button>
      )}
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
              if (cfg.statusFilter === 'not_in_stock') {
                setNotInStockModalOpen(true)
              }
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
          <div className="grid gap-2 sm:gap-2.5 lg:grid-cols-[1.2fr_repeat(4,minmax(0,0.85fr))_auto_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kia-text-faint)]" />
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search booking, customer, phone, VIN…" className={cn(INPUT_STYLE, '!pl-10 sm:!pl-11')} />
            </div>
            <FilterSelect value={dealer} placeholder="Dealer" values={filters.dealers} onChange={(value) => { setDealer(value); setPage(1) }} />
            <FilterSelect value={model} placeholder="Model" values={filters.models} onChange={(value) => { setModel(value); setPage(1) }} />
            <FilterSelect value={status} placeholder="Status" values={filters.statuses} onChange={(value) => { setStatus(value); setPage(1) }} labeler={statusLabel} />
            <FilterSelect value={consultant} placeholder="Consultant" values={filters.consultants} onChange={(value) => { setConsultant(value); setPage(1) }} />
            <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200/80 bg-white px-3 py-1 shadow-sm">
              <Calendar className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
                className="h-8 w-28 bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
                title="Start Date"
              />
              <span className="text-xs font-bold text-slate-400">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
                className="h-8 w-28 bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
                title="End Date"
              />
              {(startDate || endDate) && (
                <button
                  type="button"
                  onClick={() => { setStartDate(''); setEndDate(''); setPage(1) }}
                  className="ml-1 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  title="Clear Date Filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className={cn(
                  "h-10 flex-1 gap-1.5 rounded-2xl text-xs font-black sm:h-11 sm:text-sm transition-all shadow-xs",
                  sortOrder === 'desc'
                    ? "bg-slate-900 text-white hover:bg-slate-800 border-slate-900"
                    : "bg-white text-slate-800 hover:bg-slate-50 border-slate-200"
                )}
                title={sortOrder === 'desc' ? 'Showing newest bookings first — click to show oldest first' : 'Showing oldest bookings first — click to show newest first'}
                onClick={() => { setSortOrder((prev) => prev === 'desc' ? 'asc' : 'desc'); setPage(1) }}
              >
                <ArrowUpDown className="h-4 w-4" />
                {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
              </Button>
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
                  link.download = `kia-bookings-${stockMode ? 'stock' : 'crm'}-${new Date().toISOString().slice(0, 10)}.csv`
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

        {crmViewMode === 'discounts' ? (
          <DiscountsDashboard
            query={globalDiscountsQuery}
            currentUserRole={currentUserRole}
            onOpenBooking={(id) => {
              const next = new URLSearchParams(window.location.search)
              next.set('bookingId', id)
              router.push(`${pathname}?${next.toString()}`)
            }}
          />
        ) : shortageMode ? (
          shortageQuery.isLoading ? (
            <TableSkeleton columns={5} />
          ) : shortageQuery.isError ? (
            <EmptyState
              illustration="error"
              title="Unable to load shortages"
              description={shortageQuery.error instanceof Error ? shortageQuery.error.message : 'The shortages request failed.'}
              action={
                <Button variant="outline" className="h-10 rounded-2xl font-bold" onClick={() => shortageQuery.refetch()}>
                  <RefreshCw className="h-4 w-4" /> Retry
                </Button>
              }
            />
          ) : (
            <section className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
              <div className="flex items-center justify-between gap-3 border-b border-[var(--kia-hairline)] px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-50" style={toneSoftStyle('warning')}>
                    <AlertTriangle className="h-[1.05rem] w-[1.05rem] text-indigo-600" />
                  </span>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--kia-text-faint)]">IDT Shortage List</p>
                    <h2 className="text-sm font-extrabold text-[var(--kia-text)]">
                      {groupedShortages.length} shortage models ({shortageQuery.data?.rows?.length || 0} active demands)
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedShortageKeys.length > 0 && (
                    <Button
                      size="sm"
                      className="h-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs"
                      onClick={() => {
                        const selectedGroups = groupedShortages.filter(g =>
                          selectedShortageKeys.includes(`${g.model}|${g.variant}|${g.color}`)
                        )
                        const consolidatedBookings = selectedGroups.flatMap(g => g.bookings)
                        
                        setActiveShortageGroup({
                          model: 'Bulk Vehicles Spec Selection',
                          variant: `${selectedGroups.length} selected specifications`,
                          color: 'Multiple colors',
                          bookings: consolidatedBookings,
                        })
                        setShortageSelectedBookingIds(consolidatedBookings.map(b => b.id))
                        setShortageStatus('pending')
                        setShortageSourceDealer('')
                        setShortageExpectedDate('')
                        setShortageRemarks('')
                        setShortageActionOpen(true)
                      }}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                      Bulk Action ({selectedShortageKeys.length})
                    </Button>
                  )}
                  {shortageQuery.isFetching && <InlineLoader variant="search" size={28} />}
                </div>
              </div>
              
              {groupedShortages.length === 0 ? (
                <div className="flex h-[240px] flex-col items-center justify-center text-center p-6 bg-slate-50/20">
                  <p className="text-sm font-medium text-[var(--kia-text-soft)]">No active vehicle shortages found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="kia-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 px-3">
                          <input
                            type="checkbox"
                            checked={selectedShortageKeys.length === groupedShortages.length && groupedShortages.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedShortageKeys(groupedShortages.map(g => `${g.model}|${g.variant}|${g.color}`))
                              } else {
                                setSelectedShortageKeys([])
                              }
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </TableHead>
                        {['Vehicle Spec', 'Total Demand', 'Arrangement Status', 'Logistics Details', 'Actions'].map((head) => (
                          <TableHead key={head} className="h-10 whitespace-nowrap px-3">{head}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupedShortages.map((group, idx) => {
                        const total = group.bookings.length
                        const arranged = group.bookings.filter(b => b.metadata?.idtArrangement?.status === 'arranged').length
                        const cannot = group.bookings.filter(b => b.metadata?.idtArrangement?.status === 'cannot_arrange').length
                        const pending = total - arranged - cannot
                        
                        const arrangedItems = group.bookings.filter(b => b.metadata?.idtArrangement?.status === 'arranged')
                        const logistics = arrangedItems.map(b => {
                          const dealer = b.metadata?.idtArrangement?.sourceDealer || '—'
                          const date = b.metadata?.idtArrangement?.expectedDate ? new Date(b.metadata?.idtArrangement?.expectedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'
                          return `${dealer} (${date})`
                        }).filter(Boolean)
                        
                        const groupKey = `${group.model}|${group.variant}|${group.color}`
                        const isChecked = selectedShortageKeys.includes(groupKey)
                        
                        return (
                          <tr key={idx} className="group border-b border-[var(--kia-hairline)] text-sm hover:bg-slate-50/40">
                            <TableCell className="px-3 py-3 w-10">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedShortageKeys(prev =>
                                    isChecked ? prev.filter(k => k !== groupKey) : [...prev, groupKey]
                                  )
                                }}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                            </TableCell>
                            <TableCell className="px-3 py-3">
                              <div className="text-sm font-bold text-[var(--kia-text)]">{group.model}</div>
                              <div className="text-[11px] font-medium text-[var(--kia-text-soft)]">
                                {[group.variant, group.color].filter(Boolean).join(' · ')}
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-3 font-semibold text-[var(--kia-text)]">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-black text-slate-800">
                                {total} {total === 1 ? 'Booking' : 'Bookings'}
                              </span>
                            </TableCell>
                            <TableCell className="px-3 py-3">
                              <div className="flex flex-wrap gap-1.5 text-xs font-bold">
                                {arranged > 0 && (
                                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 border border-emerald-100">
                                    Arranged: {arranged}
                                  </span>
                                )}
                                {cannot > 0 && (
                                  <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700 border border-rose-100">
                                    No arrangement: {cannot}
                                  </span>
                                )}
                                {pending > 0 && (
                                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 border border-amber-100 animate-pulse">
                                    Pending: {pending}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-3 text-xs text-[var(--kia-text-soft)] max-w-[200px] truncate">
                              {logistics.length > 0 ? logistics.join(', ') : '—'}
                            </TableCell>
                            <TableCell className="px-3 py-3">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-xl font-bold text-xs hover:bg-indigo-50 border-indigo-200"
                                onClick={() => {
                                  setActiveShortageGroup(group)
                                  setShortageSelectedBookingIds(group.bookings.map(b => b.id))
                                  setShortageStatus('pending')
                                  setShortageSourceDealer('')
                                  setShortageExpectedDate('')
                                  setShortageRemarks('')
                                  setShortageActionOpen(true)
                                }}
                              >
                                Action
                              </Button>
                            </TableCell>
                          </tr>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          )
        ) : listQuery.isLoading ? (
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
              {rows.map((row) => {
                const isClosed = row.status === 'delivered' || row.status === 'cancelled'
                const canEdit = !isClosed && (roleCanActAsSalesPerson(normalizedCurrentRole) || roleCanActAsSalesManager(normalizedCurrentRole))
                return (
                  <BookingMobileCard
                    key={row.id}
                    row={row}
                    onOpen={openBooking}
                    now={nowTick}
                    onEdit={canEdit ? (id) => setEditingBookingId(id) : undefined}
                    isSalesPerson={roleCanActAsSalesPerson(normalizedCurrentRole)}
                    normalizedCurrentRole={normalizedCurrentRole}
                    onAddRemark={(type) => openRemarkDialog(row, type)}
                  />
                )
              })}
            </div>
            <Table className="hidden sm:table kia-table">
              <TableHeader>
                <TableRow>
                  {['Booking ID', 'Customer', 'Vehicle', 'Dealer', 'Manager', 'Team Leader', 'Status', 'Booking Date', 'Payment', 'Actions'].map((head) => (
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
                      // Mouse-hover prefetch REMOVED. On the Vercel dashboard it kept
                      // /api/brands/kia/bookings/[id] at ~150 invocations/hr (each ~190ms Active CPU) for
                      // rows the user merely passed the pointer over. onPointerDown (below) still pre-warms
                      // the cache on real click-intent — ~100ms before the row opens — so opening stays
                      // instant; only the wasted pass-over calls are cut.
                      onMouseLeave={cancelHoverPrefetch}
                      onFocus={(e) => { if (e.target.matches(':focus-visible')) scheduleHoverPrefetch(row.id) }}
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
                      <TableCell className="px-3 py-3">
                        <div className="text-xs font-bold text-[var(--kia-text)]">{row.managerName || (row.metadata && String(row.metadata.managerName || '')) || '—'}</div>
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <div className="text-xs font-bold text-[var(--kia-text)]">{row.tlName || (row.metadata && String(row.metadata.tlName || '')) || '—'}</div>
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <div className="flex flex-col gap-1.5">
                          <StatusBadge status={row.status} />
                          {row.stockNotAvailable && <StockUnavailableFlag />}
          {row.stockAvailable && <StockAvailableFlag />}
                          {(() => {
                            const metaRemarks = Array.isArray(row.metadata?.remarks) ? (row.metadata?.remarks as any[]) : []
                            const remarksList = metaRemarks.length > 0
                              ? metaRemarks
                              : [
                                  ...(row.notes ? [{ id: '1', text: row.notes, authorName: 'Staff', createdAt: '' }] : []),
                                  ...(row.idtRemark ? [{ id: '2', text: row.idtRemark, authorName: 'IDT Team', createdAt: '' }] : [])
                                ]
                            const remarksCount = remarksList.length
                            const latestRemark = remarksList.length > 0 ? remarksList[remarksList.length - 1] : null

                            return (
                              <BookingWaitingIndicator
                                status={row.status}
                                approvalStatus={row.proformaApprovalStatus}
                                updatedAt={row.updatedAt}
                                now={nowTick}
                                remarksCount={remarksCount}
                                latestRemarkText={latestRemark?.text}
                                onAddOverdueRemark={() => openRemarkDialog(row, 'overdue')}
                              />
                            )
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs font-semibold text-[var(--kia-text-soft)]">{formatDate(row.createdAt || row.updatedAt)}</TableCell>
                      <TableCell className="px-3 py-3"><Chip tone={pay.tone}>{pay.label}</Chip></TableCell>
                      <TableCell className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button type="button" title="View booking" onClick={() => openBooking(row.id)} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--kia-text)]">
                            <Eye className="h-4 w-4" />
                          </button>
                          {(() => {
                            const isRowPending = getKiaBookingStageInfo(row.status, row.proformaApprovalStatus).state === 'pending'
                            const isRowOverdue = isRowPending && isKiaBookingWaitLong(row.updatedAt, nowTick)
                            const metaRemarks = Array.isArray(row.metadata?.remarks) ? (row.metadata?.remarks as any[]) : []
                            const remarksList = metaRemarks.length > 0
                              ? metaRemarks
                              : [
                                  ...(row.notes ? [{ id: '1', text: row.notes, authorName: 'Staff', createdAt: '' }] : []),
                                  ...(row.idtRemark ? [{ id: '2', text: row.idtRemark, authorName: 'IDT Team', createdAt: '' }] : [])
                                ]
                            const remarksCount = remarksList.length
                            const isRemarkEnabled = isRowOverdue || remarksCount > 0 || (row.stockNotAvailable && normalizedCurrentRole === 'idt')

                            return (
                              <div className="relative inline-flex items-center">
                                <button
                                  type="button"
                                  title={
                                    remarksCount > 0
                                      ? `${remarksCount} Remark${remarksCount > 1 ? 's' : ''}: "${remarksList[remarksList.length - 1]?.text}"`
                                      : isRowOverdue
                                        ? 'Add remark for overdue booking'
                                        : 'Add / View remark'
                                  }
                                  disabled={!isRemarkEnabled}
                                  onClick={() => {
                                    if (isRowOverdue) {
                                      openRemarkDialog(row, 'overdue')
                                    } else if (row.stockNotAvailable) {
                                      openRemarkDialog(row, 'idt')
                                    } else {
                                      openRemarkDialog(row, 'general')
                                    }
                                  }}
                                  className={cn(
                                    "relative grid h-8 w-8 place-items-center rounded-lg transition-colors cursor-pointer",
                                    isRowOverdue
                                      ? "text-rose-600 hover:bg-rose-100 hover:text-rose-700 bg-rose-50 border border-rose-200/80 shadow-2xs"
                                      : remarksCount > 0
                                        ? "text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 bg-indigo-50/50 border border-indigo-200/60"
                                        : isRemarkEnabled
                                          ? "text-amber-500 hover:bg-amber-50"
                                          : "text-slate-200 dark:text-slate-800 cursor-not-allowed"
                                  )}
                                >
                                  <MessageSquare className="h-4 w-4" />
                                  {remarksCount > 0 && (
                                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[9px] font-black text-white shadow-xs">
                                      {remarksCount}
                                    </span>
                                  )}
                                </button>
                              </div>
                            )
                          })()}
                          {!isClosed && (roleCanActAsSalesPerson(normalizedCurrentRole) || roleCanActAsSalesManager(normalizedCurrentRole)) && (
                            <button
                              type="button"
                              title="Edit booking"
                              onClick={() => setEditingBookingId(row.id)}
                              className="grid h-8 w-8 place-items-center rounded-lg text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--kia-text)]"
                            >
                              {editingBookingId === row.id && editingDetailQuery.isFetching ? (
                                <Loader2 className="h-4 w-4 animate-spin text-[var(--dashboard-action-bg)]" />
                              ) : (
                                <Pencil className="h-4 w-4" />
                              )}
                            </button>
                          )}
                          {row.proformaNumber ? (
                            <div className="flex items-center gap-1">
                              {/* Direct Download Button (Always Visible) */}
                              <a
                                href={`/api/brands/kia/proforma/${row.proformaId}/preview`}
                                target="_blank"
                                rel="noopener noreferrer"
                                download={`Kia-Proforma-${row.proformaNumber}.pdf`}
                                title="Download Proforma PDF"
                                className="grid h-8 w-8 place-items-center rounded-lg text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--dashboard-action-bg)]"
                              >
                                <Download className="h-4 w-4" />
                              </a>
                              {/* Page Link (Hidden for Salespersons to prevent 403s) */}
                              {!(roleCanActAsSalesPerson(normalizedCurrentRole)) && (
                                <Link
                                  href={`/brands/kia/proforma/all-proforma-details?search=${row.proformaNumber}`}
                                  title="Open proforma"
                                  className="grid h-8 w-8 place-items-center rounded-lg text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--dashboard-action-bg)]"
                                >
                                  <FileText className="h-4 w-4" />
                                </Link>
                              )}
                            </div>
                          ) : canCreateBookings && !isClosed ? (
                            <button type="button" title="Generate proforma" onClick={() => router.push(`/brands/kia/proforma/generate?bookingId=${row.id}`)} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--kia-text-soft)] transition-colors hover:bg-[var(--kia-surface-sunken)] hover:text-[var(--dashboard-action-bg)]">
                              <FileText className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="grid h-8 w-8 place-items-center text-[var(--kia-text-faint)]"><FileText className="h-4 w-4 opacity-40" /></span>
                          )}
                          {((row.metadata as any)?.accountsVerification?.invoiceNumber || ['ready_delivery', 'delivered'].includes(String(row.status))) && (
                            <button
                              type="button"
                              title="View Invoice & Accounts Details"
                              onClick={() => {
                                setInvoiceViewerBooking(row)
                                setInvoiceViewerOpen(true)
                              }}
                              className="grid h-8 w-8 place-items-center rounded-lg text-emerald-600 transition-colors hover:bg-emerald-50 shrink-0"
                            >
                              <Receipt className="h-4 w-4" />
                            </button>
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
        currentUserName={currentUserName}
        currentUserRole={currentUserRole}
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
        prefill={detailQuery.data?.booking}
        prices={priceOptions?.prices || proformaOptionsQuery.data?.prices || []}
        banks={priceBanks}
        insuranceCompanies={priceOptions?.insuranceCompanies || proformaOptionsQuery.data?.insuranceCompanies || []}
      />

      {/* ── Not In Stock summary: model / variant demand breakdown ── */}
      <Dialog open={notInStockModalOpen} onOpenChange={setNotInStockModalOpen}>
        <DialogContent className="kia-premium flex max-h-[90dvh] w-[calc(100vw-0.75rem)] max-w-4xl flex-col overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
          <DialogHeader className="shrink-0 border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,#fee2e2,transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            <Badge variant="outline" className="mb-3 w-fit rounded-full border-red-100 bg-red-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-700">
              No Stock Available
            </Badge>
            <DialogTitle className="text-2xl font-black tracking-tight text-slate-950">Demand vs. Stock Gap</DialogTitle>
            <DialogDescription className="mt-2 text-xs font-semibold leading-5 text-slate-500 sm:text-sm">
              Bookings with no matching free stock — grouped by model and variant. Use this to prioritise procurement or transfers.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {(() => {
              const breakdown = data?.summary?.notInStockBreakdown || []
              if (breakdown.length === 0) {
                return (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                    <p className="text-sm font-bold text-slate-600">All bookings have matching stock available.</p>
                    <p className="text-xs font-medium text-slate-400">No unmet demand at this time.</p>
                  </div>
                )
              }
              return (
                <Table className="kia-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 whitespace-nowrap px-3 text-xs font-bold uppercase tracking-wide">#</TableHead>
                      <TableHead className="h-9 whitespace-nowrap px-3 text-xs font-bold uppercase tracking-wide">Model</TableHead>
                      <TableHead className="h-9 whitespace-nowrap px-3 text-xs font-bold uppercase tracking-wide">Variant</TableHead>
                      <TableHead className="h-9 whitespace-nowrap px-3 text-xs font-bold uppercase tracking-wide">Colour</TableHead>
                      <TableHead className="h-9 whitespace-nowrap px-3 text-right text-xs font-bold uppercase tracking-wide">Pending Bookings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakdown.map((row, idx) => (
                      <TableRow
                        key={`${row.model}--${row.variant}--${row.color || ''}--${idx}`}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => {
                          setModel(row.model)
                          setStatus('not_in_stock')
                          setPage(1)
                          setNotInStockModalOpen(false)
                        }}
                      >
                        <TableCell className="px-3 py-2.5 text-xs font-semibold text-slate-400">{idx + 1}</TableCell>
                        <TableCell className="px-3 py-2.5 text-sm font-bold text-slate-800">{row.model}</TableCell>
                        <TableCell className="max-w-[260px] truncate px-3 py-2.5 text-xs font-medium text-slate-600">{row.variant || '—'}</TableCell>
                        <TableCell className="max-w-[150px] truncate px-3 py-2.5 text-xs font-semibold text-slate-600">{row.color || '—'}</TableCell>
                        <TableCell className="px-3 py-2.5 text-right">
                          <span className="inline-flex min-w-[2rem] items-center justify-center rounded-lg bg-red-50 px-2 py-0.5 text-sm font-black text-red-700">
                            {row.count}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            })()}
          </div>

          <DialogFooter className="shrink-0 flex-wrap gap-2 border-t border-slate-100 px-4 py-3 sm:px-6">
            <p className="hidden flex-1 text-xs font-medium text-slate-400 sm:block">Click a row to filter. Export for sharing.</p>
            {/* ── Excel export ── */}
            <Button
              variant="outline"
              className="h-9 gap-1.5 rounded-xl text-xs font-bold text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300"
              disabled={(data?.summary?.notInStockBreakdown || []).length === 0}
              onClick={() => {
                const breakdown = data?.summary?.notInStockBreakdown || []
                import('xlsx').then((XLSX) => {
                  const wsData = [
                    ['#', 'Model', 'Variant', 'Colour', 'Pending Bookings'],
                    ...breakdown.map((r, i) => [i + 1, r.model, r.variant || '', r.color || '—', r.count]),
                  ]
                  const ws = XLSX.utils.aoa_to_sheet(wsData)
                  // Column widths
                  ws['!cols'] = [{ wch: 4 }, { wch: 20 }, { wch: 50 }, { wch: 20 }, { wch: 18 }]
                  // Bold header row
                  const headerCells = ['A1', 'B1', 'C1', 'D1', 'E1']
                  headerCells.forEach((cell) => {
                    if (ws[cell]) ws[cell].s = { font: { bold: true } }
                  })
                  const wb = XLSX.utils.book_new()
                  XLSX.utils.book_append_sheet(wb, ws, 'Not In Stock')
                  XLSX.writeFile(wb, `kia-not-in-stock-${new Date().toISOString().slice(0, 10)}.xlsx`)
                })
              }}
            >
              <Download className="h-3.5 w-3.5" /> Excel
            </Button>
            {/* ── PDF export via print ── */}
            <Button
              variant="outline"
              className="h-9 gap-1.5 rounded-xl text-xs font-bold text-rose-700 hover:bg-rose-50 hover:border-rose-300"
              disabled={(data?.summary?.notInStockBreakdown || []).length === 0}
              onClick={() => {
                const breakdown = data?.summary?.notInStockBreakdown || []
                const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                const rows = breakdown.map((r, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td><strong>${r.model}</strong></td>
                    <td>${r.variant || '—'}</td>
                    <td>${r.color || '—'}</td>
                    <td style="text-align:right;color:#b91c1c;font-weight:800">${r.count}</td>
                  </tr>`).join('')
                const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
                  <title>Kia – Not In Stock Report</title>
                  <style>
                    *{box-sizing:border-box;margin:0;padding:0}
                    body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#0f172a;padding:32px}
                    h1{font-size:20px;font-weight:900;margin-bottom:4px}
                    .sub{font-size:11px;color:#64748b;margin-bottom:20px}
                    table{width:100%;border-collapse:collapse}
                    th{background:#0f172a;color:#fff;text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
                    th:last-child{text-align:right}
                    td{padding:7px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}
                    tr:nth-child(even) td{background:#f8fafc}
                    .num{text-align:right;color:#b91c1c;font-weight:800}
                    .footer{margin-top:18px;font-size:10px;color:#94a3b8}
                  </style>
                </head><body>
                  <h1>Demand vs. Stock Gap</h1>
                  <p class="sub">AM Kia · Not In Stock Report · Generated ${date}</p>
                  <table>
                    <thead><tr><th>#</th><th>Model</th><th>Variant</th><th>Colour</th><th style="text-align:right">Pending</th></tr></thead>
                    <tbody>${rows}</tbody>
                  </table>
                  <p class="footer">Total variants/colours: ${breakdown.length} &nbsp;·&nbsp; Total pending bookings: ${breakdown.reduce((s, r) => s + r.count, 0)}</p>
                </body></html>`
                const win = window.open('', '_blank', 'width=900,height=700')
                if (win) {
                  win.document.write(html)
                  win.document.close()
                  win.focus()
                  setTimeout(() => { win.print(); win.close() }, 400)
                }
              }}
            >
              <FileText className="h-3.5 w-3.5" /> PDF
            </Button>
            <Button variant="outline" className="h-9 rounded-xl text-xs font-bold" onClick={() => setNotInStockModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


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

      {/* EDP Price Master Excel Replace Dialog */}
      <Dialog open={isReplacePricesOpen} onOpenChange={setIsReplacePricesOpen}>
        <DialogContent className="kia-premium max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-lg overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
          <DialogHeader className="border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,#ffedd5,transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            <DialogTitle className="text-2xl font-black tracking-tight text-slate-950">KIA Price Master · Replace Prices</DialogTitle>
            <DialogDescription className="mt-2 text-xs font-semibold leading-5 text-slate-500 sm:text-sm">
              Upload the KIA price workbook to replace the current price master (only the PRICE DETAILS sheet is imported).
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 space-y-4">
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleDownloadPriceTemplate}
                variant="outline"
                className="h-10 rounded-xl text-xs font-bold border-slate-200 hover:bg-slate-50 flex items-center justify-center gap-1.5 w-full"
              >
                <Download className="h-4 w-4" /> Download Template (Excel)
              </Button>
              <div className="text-[10px] text-slate-400 font-semibold text-center uppercase tracking-wider">or</div>
              <label className={cn('inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 w-full', priceUploading && 'pointer-events-none opacity-60')}>
                {priceUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {priceUploading ? 'Replacing prices…' : 'Replace Prices (Excel)'}
                <input
                  type="file"
                  accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12"
                  className="hidden"
                  disabled={priceUploading}
                  onChange={(event) => { void uploadPriceMaster(event.target.files?.[0]); event.target.value = '' }}
                />
              </label>
            </div>
            {priceUploadResult && (
              <p className={cn('rounded-xl border px-3 py-2 text-sm font-medium', priceUploadResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700')}>
                {priceUploadResult.message}
              </p>
            )}
          </div>

          <DialogFooter className="grid gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:flex sm:p-4">
            <Button variant="outline" className="h-10 rounded-2xl font-bold w-full sm:w-auto" onClick={() => setIsReplacePricesOpen(false)}>
              Close
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

      <Dialog open={Boolean(transferTarget)} onOpenChange={(open) => { if (!open) { setTransferTarget(null); setTransferType(null) } }}>
        <DialogContent className="kia-premium max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-4xl overflow-hidden rounded-[1.5rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
          <LoaderOverlay show={actionMutation.isPending} variant="transfer" label="Requesting transfer…" sublabel="Moving the VIN between outlets" />
          <DialogHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] p-5 sm:p-8">
            <DialogTitle className="text-2xl font-black tracking-tight text-slate-950 sm:text-4xl">Transfer this car</DialogTitle>
            <DialogDescription className="mt-2 max-w-3xl text-sm font-semibold leading-7 text-slate-500 sm:text-[17px]">
              Move the VIN into a transfer workflow for this booking. The unit leaves the sellable pool here while the transfer request remains active.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 p-5 sm:p-8">
            {/* Vehicle Info */}
            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 px-5 py-4 text-lg font-semibold leading-8 text-slate-800">
              <span className="font-black text-slate-950">{transferTarget?.model}</span> {transferTarget?.variant} · {transferTarget?.color || 'Color NA'} · {transferTarget?.vinNumber}
            </div>

            {/* Step 1: Transfer Type Selection */}
            {!transferType ? (
              <div>
                <p className="mb-4 text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Choose Transfer Type</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setTransferType('against_payment')}
                    className="group flex flex-col items-start gap-3 rounded-2xl border-2 border-slate-200 bg-white p-5 text-left transition-all hover:border-emerald-400 hover:bg-emerald-50/50 hover:shadow-md"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 group-hover:bg-emerald-200">
                      <BadgeIndianRupee className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-base font-black text-slate-950">Against Payment</div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">Customer pays a cash amount. Enter the amount received for this vehicle transfer.</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransferType('against_vehicle')}
                    className="group flex flex-col items-start gap-3 rounded-2xl border-2 border-slate-200 bg-white p-5 text-left transition-all hover:border-sky-400 hover:bg-sky-50/50 hover:shadow-md"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100 text-sky-600 group-hover:bg-sky-200">
                      <Car className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-base font-black text-slate-950">Against Vehicle</div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">Customer exchanges their vehicle. Enter the exchange vehicle details and price difference.</div>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Transfer Type Badge + Back */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setTransferType(null)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50"
                  >
                    ← Back
                  </button>
                  <span className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.1em]',
                    transferType === 'against_payment'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-sky-100 text-sky-700'
                  )}>
                    {transferType === 'against_payment' ? '💰 Against Payment' : '🚗 Against Vehicle'}
                  </span>
                </div>

                {/* Against Payment fields */}
                {transferType === 'against_payment' && (
                  <div>
                    <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Amount Received (₹)</Label>
                    <Input
                      type="number"
                      value={transferAmountReceived}
                      onChange={(e) => setTransferAmountReceived(e.target.value)}
                      placeholder="e.g. 50000"
                      className={cn(INPUT_STYLE, 'mt-2')}
                    />
                  </div>
                )}

                {/* Against Vehicle fields */}
                {transferType === 'against_vehicle' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Exchange Vehicle Model</Label>
                      <Input value={transferVehicleModel} onChange={(e) => setTransferVehicleModel(e.target.value)} placeholder="e.g. SONET" className={cn(INPUT_STYLE, 'mt-2')} />
                    </div>
                    <div>
                      <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Exchange Vehicle Variant</Label>
                      <Input value={transferVehicleVariant} onChange={(e) => setTransferVehicleVariant(e.target.value)} placeholder="e.g. HTK Plus Diesel" className={cn(INPUT_STYLE, 'mt-2')} />
                    </div>
                    <div>
                      <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Exchange Vehicle Color</Label>
                      <Input value={transferVehicleColor} onChange={(e) => setTransferVehicleColor(e.target.value)} placeholder="e.g. Gravity Grey" className={cn(INPUT_STYLE, 'mt-2')} />
                    </div>
                    <div>
                      <Label className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Price Difference (₹)</Label>
                      <Input type="number" value={transferVehiclePrice} onChange={(e) => setTransferVehiclePrice(e.target.value)} placeholder="e.g. 25000" className={cn(INPUT_STYLE, 'mt-2')} />
                    </div>
                  </div>
                )}

                {/* Common fields */}
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
              </>
            )}
          </div>
          <DialogFooter className="grid gap-2 border-t border-slate-100 bg-slate-50 p-4 sm:flex sm:justify-end sm:p-6">
            <Button type="button" variant="outline" className="h-12 rounded-2xl border-slate-200 bg-white px-6 text-base font-black" onClick={() => setTransferTarget(null)} disabled={actionMutation.isPending}>Cancel</Button>
            {transferType && (
              <Button type="button" className="h-12 rounded-2xl bg-slate-950 px-6 text-base font-black text-white shadow-lg shadow-slate-950/15 hover:bg-slate-800" onClick={confirmTransfer} disabled={actionMutation.isPending || !transferToDealerCode}>
                {actionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Transfer
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedBookingId)} onOpenChange={(open) => { if (!open) closeBooking() }}>
        <DialogContent
          className="kia-premium fixed inset-y-0 !left-0 sm:!left-auto !right-0 !top-0 z-50 !flex min-w-0 h-dvh max-h-dvh w-full max-w-full sm:max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l p-0 shadow-[0_30px_110px_rgba(15,23,42,0.32)] duration-300 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:!w-[min(940px,calc(100vw-2rem))] sm:rounded-l-[2rem]"
          style={{ backgroundColor: 'var(--kia-canvas)', borderColor: 'var(--kia-hairline)' }}
        >
          <DialogTitle className="sr-only">Booking Details</DialogTitle>
          <SuccessOverlay
            show={deliverySuccess}
            variant="delivery"
            label="Vehicle delivered!"
            sublabel="Handed over to the customer"
            onDone={() => {
              setDeliverySuccess(false)
              closeBooking()
              queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
              void listQuery.refetch()
              router.refresh()
            }}
          />
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
              onEdit={() => setEditingBookingId(detailQuery.data.booking.id)}
              discounts={discountsQuery.data?.discounts || []}
              onRefreshDiscounts={() => discountsQuery.refetch()}
              onOpenInvoiceViewer={(b) => {
                setInvoiceViewerBooking(b)
                setInvoiceViewerOpen(true)
              }}
              onOpenEmiCalculator={(target) => {
                setEmiCalcTarget(target)
                setIsEmiCalculatorOpen(true)
              }}
              onOpenOverdueRemark={(target) => {
                openRemarkDialog(target, 'overdue')
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {editingBookingId && editingDetailQuery.data?.booking && (
        <CreateBookingDialog
          isEdit
          bookingNumber={editingBookingNumber}
          open={isEditOpen}
          form={editForm}
          currentUserName={currentUserName}
          currentUserRole={currentUserRole}
          activeTab={editTab}
          modelOptions={bookingModelOptions}
          variantOptions={bookingVariantOptions}
          bankOptions={bookingBankOptions}
          masterLoading={proformaOptionsQuery.isLoading}
          error={formError || (editMutation.error instanceof Error ? editMutation.error.message : '')}
          isSubmitting={editMutation.isPending}
          showSuccess={editSuccess}
          onSuccessDone={() => {
            setEditSuccess(false)
            setIsEditOpen(false)
            setEditingBookingId(null)
            setEditingBookingNumber('')
            setActionMessage('Booking updated successfully.')
          }}
          onOpenChange={(open) => {
            setIsEditOpen(open)
            if (!open) setEditingBookingId(null)
          }}
          onTabChange={setEditTab}
          onChange={(key, value) => setEditForm((current) => ({ ...current, [key]: value }))}
          onSubmit={submitEdit}
        />
      )}

      {activeShortageGroup && (
        <Dialog open={shortageActionOpen} onOpenChange={setShortageActionOpen}>
          <DialogContent className="sm:max-w-[480px] p-6 rounded-2xl bg-white border border-slate-100">
            <DialogHeader>
              <DialogTitle className="text-lg font-black text-slate-800 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-indigo-500" />
                Manage Shortage Plan
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400 font-medium">
                Update the arrangement plan for bookings of <span className="font-extrabold text-slate-700">{activeShortageGroup.model}</span> (Color: {activeShortageGroup.color}).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-4">
              {/* Selected Bookings Checklist */}
              <div className="space-y-2 border border-slate-100 bg-slate-50/50 p-3 rounded-2xl max-h-[160px] overflow-y-auto">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Apply action to bookings:</p>
                {activeShortageGroup.bookings.map((booking) => {
                  const hasArrangement = booking.metadata?.idtArrangement
                  const isChecked = shortageSelectedBookingIds.includes(booking.id)
                  return (
                    <div key={booking.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 last:border-0">
                      <label className="flex items-center gap-2 font-bold text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setShortageSelectedBookingIds(prev =>
                              isChecked ? prev.filter(id => id !== booking.id) : [...prev, booking.id]
                            )
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>{booking.bookingNumber} ({booking.customerName})</span>
                      </label>
                      <div className="text-[10px] text-slate-400 font-medium">
                        {hasArrangement ? (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded-full font-bold",
                            booking.metadata.idtArrangement.status === 'arranged' && "bg-emerald-50 text-emerald-700",
                            booking.metadata.idtArrangement.status === 'cannot_arrange' && "bg-rose-50 text-rose-700"
                          )}>
                            {booking.metadata.idtArrangement.status === 'arranged' ? `Arranged: ${booking.metadata.idtArrangement.sourceDealer}` : 'No arrangement'}
                          </span>
                        ) : (
                          <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">Pending</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Status selection */}
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400">Arrangement Status</label>
                <select
                  value={shortageStatus}
                  onChange={(e) => setShortageStatus(e.target.value as any)}
                  className="mt-1 block w-full rounded-xl border-slate-200 bg-white text-sm font-bold h-11"
                >
                  <option value="pending">Pending</option>
                  <option value="arranged">Arranged from other Dealer / Supplier</option>
                  <option value="cannot_arrange">Will not arrange at this time</option>
                </select>
              </div>

              {/* Dealer Code & Date */}
              {shortageStatus === 'arranged' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Source Dealer Code</label>
                    <Input
                      type="text"
                      value={shortageSourceDealer}
                      onChange={(e) => setShortageSourceDealer(e.target.value)}
                      placeholder="e.g. JK402, JK501"
                      className="mt-1 block w-full rounded-xl border-slate-200 bg-white text-sm font-bold h-11"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Expected Received Date</label>
                    <Input
                      type="date"
                      value={shortageExpectedDate}
                      onChange={(e) => setShortageExpectedDate(e.target.value)}
                      className="mt-1 block w-full rounded-xl border-slate-200 bg-white text-sm font-bold h-11"
                    />
                  </div>
                </div>
              )}

              {/* Remarks */}
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400">Remarks</label>
                <Textarea
                  value={shortageRemarks}
                  onChange={(e) => setShortageRemarks(e.target.value)}
                  placeholder="Procurement notes, transfer dispatch details, etc."
                  rows={2}
                  className="mt-1 block w-full rounded-xl border-slate-200 bg-white text-sm font-bold p-3"
                />
              </div>
            </div>

            <DialogFooter className="flex gap-2">
              <Button
                variant="outline"
                className="h-10 rounded-xl text-xs font-bold sm:h-11 sm:text-sm"
                onClick={() => setShortageActionOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="h-10 rounded-xl text-xs font-bold sm:h-11 sm:text-sm bg-indigo-600 hover:bg-indigo-700 text-white"
                disabled={shortageSelectedBookingIds.length === 0 || shortageActionMutation.isPending}
                onClick={() => {
                  shortageActionMutation.mutate({
                    bookingIds: shortageSelectedBookingIds,
                    status: shortageStatus,
                    sourceDealer: shortageSourceDealer,
                    expectedDate: shortageExpectedDate,
                    remarks: shortageRemarks,
                  })
                }}
              >
                {shortageActionMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save Arrangement
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Booking Remark Dialog (Timeline List + Add Remark) */}
      <Dialog open={remarkOpen} onOpenChange={setRemarkOpen}>
        <DialogContent className="max-w-md w-full rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[85vh]">
          <DialogHeader className="shrink-0 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-3">
              {remarkType === 'overdue' ? (
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 border border-rose-200 text-rose-600 shrink-0">
                  <Clock3 className="h-5 w-5" />
                </span>
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 border border-indigo-200 text-indigo-600 shrink-0">
                  <MessageSquare className="h-5 w-5" />
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <DialogTitle className="text-lg font-black text-slate-900 truncate">
                    {remarkType === 'overdue' ? 'Overdue Booking Remarks' : 'Booking Remarks & History'}
                  </DialogTitle>
                  <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-[10px] font-black text-indigo-700 shrink-0">
                    {existingRemarksList.length} {existingRemarksList.length === 1 ? 'Remark' : 'Remarks'}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-500 truncate mt-0.5">
                  #{remarkBookingNumber || '—'} · {remarkBookingCustomer}
                </p>
              </div>
            </div>
          </DialogHeader>

          {/* Remarks History List */}
          <div className="flex-1 overflow-y-auto my-4 pr-1 space-y-3 min-h-[140px] max-h-[320px]">
            {existingRemarksList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50/80 rounded-2xl border border-dashed border-slate-200 p-4">
                <MessageSquare className="h-8 w-8 text-slate-300 mb-2" />
                <p className="text-xs font-bold text-slate-600">No remarks added yet</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Type a remark below to update the team on this booking.</p>
              </div>
            ) : (
              existingRemarksList.map((r, idx) => {
                const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
                return (
                  <div key={r.id || idx} className="rounded-2xl border border-slate-150 bg-slate-50/70 p-3 space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-extrabold uppercase">
                          {(r.authorName || 'U').charAt(0)}
                        </span>
                        <span className="text-xs font-extrabold text-slate-900">{r.authorName || 'Team Member'}</span>
                        {r.authorRole && (
                          <span className="text-[9px] font-black uppercase tracking-wider bg-slate-200/80 text-slate-700 px-1.5 py-0.5 rounded">
                            {r.authorRole}
                          </span>
                        )}
                      </div>
                      {dateStr && <span className="text-[10px] font-semibold text-slate-400">{dateStr}</span>}
                    </div>
                    <p className="text-xs font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap pl-7">
                      {r.text}
                    </p>
                  </div>
                )
              })
            )}
          </div>

          {/* Add New Remark Box */}
          <div className="shrink-0 border-t border-slate-100 pt-3 space-y-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Add New Remark</label>
              <Textarea
                placeholder="Type your remark here (e.g. Customer delay reason, financier status, follow-up notes)..."
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                className="min-h-[80px] w-full rounded-2xl border-slate-200 font-medium text-xs p-3 mt-1 text-slate-900 focus:border-indigo-500 focus:ring-indigo-500"
                maxLength={500}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRemarkOpen(false)}
                className="h-10 rounded-xl px-4 text-xs font-bold"
              >
                Close
              </Button>
              <Button
                type="button"
                onClick={handleSaveRemark}
                disabled={remarkSubmitting || !remarkText.trim()}
                className={cn(
                  "h-10 rounded-xl px-5 text-xs font-black text-white shadow-md transition",
                  remarkType === 'overdue' ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"
                )}
              >
                {remarkSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                Add Remark
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Invoice Viewer & Details Dialog */}
      <Dialog open={invoiceViewerOpen} onOpenChange={setInvoiceViewerOpen}>
        <DialogContent className="max-w-2xl rounded-[28px] border-slate-200 bg-white p-6 shadow-2xl">
          {invoiceViewerBooking && (() => {
            const meta = (invoiceViewerBooking.metadata || {}) as Record<string, unknown>
            const accountsVerification = (meta.accountsVerification || {}) as Record<string, unknown>
            const paymentConfirmation = (meta.paymentConfirmation || {}) as Record<string, unknown>
            const invoiceNumber = String(accountsVerification.invoiceNumber || invoiceViewerBooking.proformaNumber || 'REC-INV-DONE')
            const invoiceUrl = accountsVerification.invoiceDocumentUrl ? String(accountsVerification.invoiceDocumentUrl) : null
            const invoiceName = String(accountsVerification.invoiceDocumentName || 'Vehicle_Invoice.pdf')
            const verifiedBy = String(accountsVerification.verifiedBy || 'Accounts Team')
            const verifiedAt = accountsVerification.verifiedAt ? new Date(String(accountsVerification.verifiedAt)).toLocaleString('en-IN') : '-'

            return (
              <div className="space-y-5">
                <DialogHeader>
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 shrink-0">
                      <Receipt className="h-6 w-6" />
                    </span>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        Accounts Verified · Tax Invoice
                      </span>
                      <DialogTitle className="text-2xl font-black text-slate-950 mt-1">
                        Invoice #{invoiceNumber}
                      </DialogTitle>
                    </div>
                  </div>
                </DialogHeader>

                {/* Summary Info Grid */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-xs space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Customer</span>
                      <p className="font-extrabold text-slate-900 text-sm">{invoiceViewerBooking.customerName}</p>
                      <p className="text-slate-500 font-semibold">{invoiceViewerBooking.customerPhone}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Vehicle & VIN</span>
                      <p className="font-extrabold text-slate-900 text-sm">{invoiceViewerBooking.model} {invoiceViewerBooking.variant}</p>
                      <p className="text-indigo-600 font-mono font-bold">{invoiceViewerBooking.allocatedVin || 'VIN Verified'}</p>
                    </div>
                  </div>
                  <div className="border-t border-slate-200/80 pt-2.5 grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Accounts Verified By</span>
                      <p className="font-bold text-slate-800">{verifiedBy}</p>
                      <p className="text-[10px] text-slate-400">{verifiedAt}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Payment Reference</span>
                      <p className="font-mono font-bold text-slate-800">{String(paymentConfirmation.reference || 'RELEASED')}</p>
                    </div>
                  </div>
                </div>

                {/* Document Action Box */}
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <FileText className="h-6 w-6 text-indigo-600 shrink-0" />
                      <div>
                        <h4 className="text-sm font-extrabold text-slate-900">Tax Invoice PDF Document</h4>
                        <p className="text-xs text-slate-500 font-semibold">{invoiceUrl ? invoiceName : 'No PDF document attached yet'}</p>
                      </div>
                    </div>
                    {invoiceUrl && (
                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={invoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-xs hover:bg-indigo-50"
                        >
                          <Eye className="h-3.5 w-3.5" /> View PDF
                        </a>
                        <a
                          href={invoiceUrl}
                          download={invoiceName}
                          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Upload / Re-attach PDF */}
                  <div className="pt-3 border-t border-indigo-100/80">
                    <Label className="text-xs font-extrabold text-slate-800">
                      {invoiceUrl ? 'Re-upload / Replace Invoice PDF' : 'Upload Tax Invoice PDF'}
                    </Label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={(e) => setUploadingInvoiceFile(e.target.files?.[0] || null)}
                        className="text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-slate-900 file:px-2.5 file:py-1 file:text-xs file:font-bold file:text-white"
                      />
                      {uploadingInvoiceFile && (
                        <Button
                          size="sm"
                          disabled={isUploadingInvoice}
                          onClick={() => handleUploadInvoiceDoc(invoiceViewerBooking.id)}
                          className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white shrink-0"
                        >
                          {isUploadingInvoice ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Upload File'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <DialogFooter className="flex items-center justify-between pt-2">
                  <Button variant="outline" onClick={() => setInvoiceViewerOpen(false)} className="rounded-xl font-bold">
                    Close
                  </Button>
                  {invoiceUrl && (
                    <a
                      href={invoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-slate-800"
                    >
                      <FileCheck className="h-4 w-4 text-emerald-400" /> Open Full Document
                    </a>
                  )}
                </DialogFooter>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      <EmiCalculatorDialog
        open={isEmiCalculatorOpen}
        onClose={() => setIsEmiCalculatorOpen(false)}
        initialModel={emiCalcTarget?.model}
        initialVariant={emiCalcTarget?.variant}
        initialExShowroom={emiCalcTarget?.exShowroom}
        optionsData={priceOptions || proformaOptionsQuery.data}
        prices={priceOptions?.prices || proformaOptionsQuery.data?.prices || []}
        modelOptions={bookingModelOptions}
        priceTrims={priceTrims}
      />
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
    const dealerErr = req('dealerCode', 'Dealer')
    if (dealerErr) return dealerErr
    // PAN + Aadhaar are mandatory (upload + a valid number). Employee ID is optional.
    if (!String(form.panCardUrl || '').trim()) return 'Please upload the PAN card.'
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(form.panNumber || '').trim().toUpperCase())) return 'Enter a valid PAN number (e.g. ABCDE1234F).'
    if (form.customerType !== 'Firm') {
      if (!String(form.aadhaarCardUrl || '').trim()) return 'Please upload the Aadhaar card.'
      if (String(form.aadhaarNumber || '').replace(/\D/g, '').length !== 12) return 'Enter a valid 12-digit Aadhaar number.'
    }
    if (form.exchange === 'Yes') {
      if (!String(form.exchangeVehicleName || '').trim()) return 'Enter the exchange vehicle name.'
      if (!(Number(form.exchangeValue) > 0)) return 'Enter a valid exchange value.'
    }
    return null
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

function IdDocUploadButton({ label, uploading, fileName, onSelect }: {
  label: string
  uploading: boolean
  fileName?: string
  onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className={cn(
      'flex h-11 cursor-pointer items-center gap-2 rounded-2xl border border-dashed px-3 text-xs font-bold transition-colors',
      fileName ? 'border-emerald-300 bg-emerald-50/50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400',
      uploading && 'pointer-events-none opacity-70',
    )}>
      {uploading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Upload className="h-4 w-4 shrink-0 text-slate-400" />}
      <span className="min-w-0 flex-1 truncate">{uploading ? 'Reading…' : fileName || label}</span>
      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onSelect} disabled={uploading} />
    </label>
  )
}

function CreateBookingDialog({
  open,
  form,
  currentUserName,
  currentUserRole = '',
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
  isEdit = false,
  bookingNumber = '',
}: {
  open: boolean
  form: CreateBookingForm
  currentUserName: string
  currentUserRole?: string
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
  isEdit?: boolean
  bookingNumber?: string
}) {
  const isSalesExec = String(currentUserRole || '').trim().toLowerCase() === 'sales_executive'
  const activeIndex = CREATE_TABS.indexOf(activeTab)
  const isLastStep = activeIndex === CREATE_TABS.length - 1
  const isFirstStep = activeIndex === 0

  const [costSheetVerifying, setCostSheetVerifying] = useState(false)
  const [costSheetFile, setCostSheetFile] = useState<File | null>(null)
  const [idDocUploading, setIdDocUploading] = useState<'pan' | 'aadhaar' | 'employee_id' | null>(null)
  const [stockChecking, setStockChecking] = useState(false)
  const [stockCheckResult, setStockCheckResult] = useState<{ available: boolean; count: number } | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const [stepError, setStepError] = useState('')

  // Detect a saved draft whenever the dialog opens.
  useEffect(() => {
    if (!open || isEdit) return
    try {
      setHasDraft(Boolean(window.localStorage.getItem(BOOKING_DRAFT_KEY)))
    } catch {
      setHasDraft(false)
    }
  }, [open, isEdit])

  // Clear the saved draft once a booking is successfully created.
  useEffect(() => {
    if (!showSuccess || isEdit) return
    try {
      window.localStorage.removeItem(BOOKING_DRAFT_KEY)
    } catch {
      // ignore
    }
    setHasDraft(false)
  }, [showSuccess, isEdit])

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
      const compressedFile = await compressImage(file)
      const fd = new FormData()
      fd.append('file', compressedFile)
      const res = await fetch('/api/brands/kia/bookings/verify-cost-sheet', {
        method: 'POST',
        body: fd
      })
      if (!res.ok) {
        throw new Error('Verification failed')
      }
      const data = await res.json()
      if (data.valid) {
        setCostSheetFile(compressedFile)
        onChange('costSheet', data.url || compressedFile.name)
        toast({
          title: 'Document Verified',
          description: `"${compressedFile.name}" accepted as a valid vehicle cost sheet.`,
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

  // Upload a customer ID document, and for PAN/Aadhaar images let the AI pre-fill the number
  // (editable). The number field stays user-correctable; PDFs are stored but not OCR'd.
  const handleIdDocUpload = async (docType: 'pan' | 'aadhaar' | 'employee_id', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIdDocUploading(docType)
    try {
      const compressedFile = await compressImage(file)
      const fd = new FormData()
      fd.append('file', compressedFile)
      fd.append('docType', docType)
      const res = await fetch('/api/brands/kia/bookings/extract-id-document', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Upload failed')
      const urlKey: keyof CreateBookingForm = docType === 'pan' ? 'panCardUrl' : docType === 'aadhaar' ? 'aadhaarCardUrl' : 'employeeIdUrl'
      const nameKey: keyof CreateBookingForm = docType === 'pan' ? 'panCardName' : docType === 'aadhaar' ? 'aadhaarCardName' : 'employeeIdName'
      onChange(urlKey, data.url || compressedFile.name)
      onChange(nameKey, compressedFile.name)
      if (docType === 'pan' && data.number) onChange('panNumber', data.number)
      if (docType === 'aadhaar' && data.number) onChange('aadhaarNumber', data.number)
      toast({
        title: 'Document uploaded',
        description: data.pdfManual
          ? 'PDF stored — please type the number manually.'
          : data.number
            ? `Read the ${docType === 'pan' ? 'PAN' : 'Aadhaar'} number automatically — please verify it.`
            : docType === 'employee_id'
              ? `"${compressedFile.name}" attached.`
              : 'Uploaded — could not read the number, please type it manually.',
        variant: 'success',
      })
    } catch (err) {
      e.target.value = ''
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Please try again.', variant: 'error' })
    } finally {
      setIdDocUploading(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kia-premium max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-5xl overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
        {/* On the Review step the panel itself is the booking animation, so don't
            cover it with the full-screen overlay — only use the overlay when
            submitting from any other step. */}
        <LoaderOverlay show={isSubmitting && activeTab !== 'Review'} variant="reserve" label={isEdit ? "Updating booking…" : "Creating booking…"} sublabel={isEdit ? "Saving booking changes" : "Reserving the customer's vehicle"} />
        <SuccessOverlay show={showSuccess} label={isEdit ? "Booking updated!" : "Booking created!"} sublabel={isEdit ? "Changes saved successfully" : "Reserved for the customer"} onDone={onSuccessDone} />
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
              <DialogTitle className="text-xl font-extrabold tracking-tight sm:text-2xl">{isEdit ? `Edit Booking — ${bookingNumber}` : "Create AM Kia Booking"}</DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-xs font-medium leading-5 text-white/80">{isEdit ? "Review and update the booking details across all stages." : "Create the booking first, then generate the proforma for manager approval."}</DialogDescription>
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

            {/* Quick Discount Banner on All Stages (except Review stage where we render a detailed checkbox) */}
            {activeTab !== 'Review' && (
              <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-200/60">
                      <Percent className="h-4 w-4 text-slate-800" />
                    </span>
                    <div>
                      <span className="text-xs font-black text-slate-900 block">Apply for Booking Discount</span>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                        Requires MD Approval
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">Apply:</span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={form.requestDiscount}
                      onClick={() => onChange('requestDiscount', !form.requestDiscount)}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        form.requestDiscount ? "bg-slate-950" : "bg-slate-200"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          form.requestDiscount ? "translate-x-4" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>
                </div>

                {form.requestDiscount && (
                  <div className="mt-3.5 pt-3.5 border-t border-slate-200/60 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Discount Amount (INR)</label>
                      <Input
                        type="number"
                        placeholder="e.g. 15000"
                        value={form.discountRequestedAmount || ''}
                        onChange={(e) => onChange('discountRequestedAmount', e.target.value)}
                        className="h-9 rounded-xl border-slate-200/80 bg-white px-3 text-xs font-bold text-slate-800"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Reason / Remarks</label>
                      <Input
                        type="text"
                        placeholder="Why is this discount needed?"
                        value={form.discountReason || ''}
                        onChange={(e) => onChange('discountReason', e.target.value)}
                        className="h-9 rounded-xl border-slate-200/80 bg-white px-3 text-xs font-semibold text-slate-800"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Quick Customer Info Bar */}
            {activeTab !== 'Customer' && (form.customerName || form.customerPhone || form.customerEmailId) && (
              <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-2.5 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur-sm dark:border-white/5 dark:bg-slate-900/40">
                {form.customerName && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Customer:</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">{form.customerName}</span>
                  </span>
                )}
                {form.customerPhone && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-slate-350 dark:text-slate-700">|</span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Mobile:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{form.countryCode || '+91'} {form.customerPhone}</span>
                  </span>
                )}
                {form.customerEmailId && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-slate-350 dark:text-slate-700">|</span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Email:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{form.customerEmailId}</span>
                  </span>
                )}
              </div>
            )}

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
                        <option value="Firm">Firm</option>
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

                  {/* Customer identity documents — PAN & Aadhaar required (AI reads the number). */}
                  <div className="md:col-span-2 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Customer Documents</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="PAN Card" required>
                        <IdDocUploadButton label="Upload PAN (image / PDF)" uploading={idDocUploading === 'pan'} fileName={form.panCardName} onSelect={(e) => handleIdDocUpload('pan', e)} />
                      </Field>
                      <Field label="PAN Number" required>
                        <Input value={form.panNumber} onChange={(e) => onChange('panNumber', e.target.value.toUpperCase().slice(0, 10))} className={INPUT_STYLE} placeholder="ABCDE1234F" maxLength={10} />
                      </Field>
                      <Field label="Aadhaar Card" required={form.customerType !== 'Firm'}>
                        <IdDocUploadButton label="Upload Aadhaar (image / PDF)" uploading={idDocUploading === 'aadhaar'} fileName={form.aadhaarCardName} onSelect={(e) => handleIdDocUpload('aadhaar', e)} />
                      </Field>
                      <Field label="Aadhaar Number" required={form.customerType !== 'Firm'}>
                        <Input value={form.aadhaarNumber} onChange={(e) => onChange('aadhaarNumber', e.target.value.replace(/\D/g, '').slice(0, 12))} className={INPUT_STYLE} placeholder="12-digit number" inputMode="numeric" maxLength={12} />
                      </Field>
                      <Field label="Employee ID Card (optional)">
                        <IdDocUploadButton label="Upload Employee ID" uploading={idDocUploading === 'employee_id'} fileName={form.employeeIdName} onSelect={(e) => handleIdDocUpload('employee_id', e)} />
                      </Field>
                    </div>
                    <p className="text-[11px] font-semibold text-slate-400">PAN &amp; Aadhaar numbers are read automatically from the uploaded card — please verify them. Accepts JPG, PNG or PDF (numbers on PDFs must be typed in).</p>
                  </div>

                  {/* Exchange / trade-in */}
                  <div className="md:col-span-2 grid gap-4 md:grid-cols-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <Field label="Exchange / Trade-in" required>
                      <select value={form.exchange || 'No'} onChange={(e) => onChange('exchange', e.target.value)} className={cn(INPUT_STYLE, 'cursor-pointer appearance-none')}>
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    </Field>
                    {form.exchange === 'Yes' && (
                      <>
                        <Field label="Exchange Vehicle Name" required>
                          <Input value={form.exchangeVehicleName} onChange={(e) => onChange('exchangeVehicleName', e.target.value)} className={INPUT_STYLE} placeholder="e.g. Maruti Swift 2019" />
                        </Field>
                        <Field label="Exchange Value (₹)" required>
                          <Input type="number" min={0} value={form.exchangeValue} onChange={(e) => onChange('exchangeValue', e.target.value)} className={INPUT_STYLE} placeholder="Model / exchange value" />
                        </Field>
                      </>
                    )}
                  </div>
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
                <Field label="Consultant">
                  <Input readOnly value={form.consultantName || currentUserName || 'You'} className={cn(INPUT_STYLE, 'bg-slate-100/60')} title="Automatically set to the logged-in user" />
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
                <Field label="Booking Amount" required>
                  <Input
                    type="number"
                    value={form.bookingAmount}
                    onChange={(event) => onChange('bookingAmount', event.target.value)}
                    className={INPUT_STYLE}
                    placeholder="₹"
                  />
                </Field>
                <Field label="Booking Date" required>
                  <Input
                    type="date"
                    value={form.bookingDate}
                    onChange={(event) => onChange('bookingDate', event.target.value)}
                    disabled={isSalesExec}
                    className={cn(INPUT_STYLE, isSalesExec && "bg-slate-100 text-slate-500 cursor-not-allowed opacity-80")}
                  />
                </Field>
                <Field label="Payment Source" required>
                  <Select value={form.pmtSource} onValueChange={(val) => onChange('pmtSource', val)}>
                    <SelectTrigger className={INPUT_STYLE}>
                      <SelectValue placeholder="Select Payment Source" />
                    </SelectTrigger>
                    <SelectContent>
                      {['CASH', 'CHEQUE', 'UPI', 'NEFT', 'RTGS', 'BANK TRANSFER', 'DD', 'CARD', 'OTHER'].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Payment Amount" required>
                  <Input
                    type="number"
                    value={form.paymentAmount}
                    onChange={(event) => onChange('paymentAmount', event.target.value)}
                    className={INPUT_STYLE}
                    placeholder="₹"
                  />
                </Field>
                <Field label="Cost Sheet" required>
                  <div className="space-y-2">
                    <label className={`flex items-center justify-center gap-3 cursor-pointer h-11 px-4 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:bg-white transition-all ${costSheetVerifying ? 'opacity-60 pointer-events-none' : ''}`}>
                      <input type="file" accept="image/*,application/pdf" onChange={handleCostSheetUpload} className="sr-only" />
                      {costSheetVerifying ? '⏳ Verifying...' : costSheetFile ? `✅ ${costSheetFile.name}` : form.costSheet ? `✅ ${form.costSheet.split('/').pop()}` : '📷 Upload Cost Sheet (Image or PDF)'}
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
                  {/* Discount Request Summary / Form Checkbox */}
                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-900 flex items-center gap-1.5">
                        <Percent className="h-3.5 w-3.5 text-slate-700" /> Discount Request (MD Approval)
                      </p>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={form.requestDiscount}
                        onClick={() => onChange('requestDiscount', !form.requestDiscount)}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                          form.requestDiscount ? "bg-slate-950" : "bg-slate-200"
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            form.requestDiscount ? "translate-x-4" : "translate-x-0"
                          )}
                        />
                      </button>
                    </div>

                    {form.requestDiscount ? (
                      <div className="grid gap-2.5 mt-3 pt-3 border-t border-slate-100">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 font-bold uppercase block">Discount Amount (INR)</span>
                          <Input
                            type="number"
                            placeholder="e.g. 15000"
                            value={form.discountRequestedAmount || ''}
                            onChange={(e) => onChange('discountRequestedAmount', e.target.value)}
                            className="h-8 w-36 rounded-lg border-slate-200/80 bg-white px-2.5 text-xs font-bold text-slate-800 text-right"
                          />
                        </div>
                        <div className="text-xs">
                          <span className="text-slate-500 font-bold uppercase block mb-1">Reason / Remarks</span>
                          <textarea
                            placeholder="Please state why this discount is required..."
                            value={form.discountReason || ''}
                            onChange={(e) => onChange('discountReason', e.target.value)}
                            className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white p-2 text-xs font-semibold focus:outline-none"
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs font-semibold text-slate-500 italic mt-1.5">
                        No discount requested. Toggle switch to add discount.
                      </p>
                    )}
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
              {!isEdit && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 min-w-[90px] rounded-2xl bg-white text-xs font-black text-slate-700 hover:bg-slate-100 sm:text-sm"
                  onClick={handleSaveDraft}
                  disabled={isSubmitting}
                >
                  Save Draft
                </Button>
              )}
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
                  {isSubmitting ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Booking')}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, required, children, error }: { label: string; required?: boolean; children: React.ReactNode; error?: string }) {
  return (
    <div className="space-y-2 flex flex-col">
      <Label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
        {label}
        {required && <span className="text-red-500 ml-1 font-bold">*</span>}
      </Label>
      <div className="relative rounded-2xl transition-all duration-200 focus-within:shadow-md focus-within:shadow-red-500/5">
        {children}
      </div>
      {error && <p className="text-[10px] font-bold text-red-500">{error}</p>}
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
  onEdit,
  discounts = [],
  onRefreshDiscounts,
  onOpenInvoiceViewer,
  onOpenEmiCalculator,
  onOpenOverdueRemark,
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
  onAction: (action: 'proforma' | 'finance' | 'payment' | 'accounts' | 'release' | 'deliver' | 'cancel' | 'transfer' | 'hold' | 'resume') => void
  onAllot: (vinNumber: string) => void
  onOpenTransfer: (vehicle?: MatchingVehicle | null) => void
  onPaymentNotReceived: () => void
  onStatusChange: (status: string) => void
  onEdit?: () => void
  discounts?: any[]
  onRefreshDiscounts?: () => void
  onOpenInvoiceViewer?: (booking: any) => void
  onOpenEmiCalculator?: (target: { model?: string; variant?: string; exShowroom?: number }) => void
  onOpenOverdueRemark?: (target: { id: string; bookingNumber?: string; customerName?: string; notes?: string | null }) => void
}) {
  const router = useRouter()
  const [sharingLink, setSharingLink] = useState(false)
  const [isDiscountDialogOpen, setIsDiscountDialogOpen] = useState(false)
  const [discountAmount, setDiscountAmount] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [isSubmittingDiscount, setIsSubmittingDiscount] = useState(false)

  const handleRequestDiscount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!discountAmount || isNaN(Number(discountAmount)) || Number(discountAmount) <= 0) {
      toast({ title: 'Invalid amount', description: 'Please enter a valid positive discount amount.', variant: 'error' })
      return
    }
    setIsSubmittingDiscount(true)
    try {
      const response = await fetch(`/api/brands/kia/bookings/${booking.id}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(discountAmount), reason: discountReason }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit discount request.')
      toast({ title: 'Discount requested', description: `Requested discount of INR ${Number(discountAmount).toLocaleString('en-IN')}` })
      setIsDiscountDialogOpen(false)
      setDiscountAmount('')
      setDiscountReason('')
      if (onRefreshDiscounts) onRefreshDiscounts()
    } catch (err) {
      toast({ title: 'Request failed', description: err instanceof Error ? err.message : 'Something went wrong', variant: 'error' })
    } finally {
      setIsSubmittingDiscount(false)
    }
  }

  const { booking, allocation, proforma, financeOrder, activities, transfers } = detail
  const idtArrangement = booking.metadata?.idtArrangement as any
  // Live minute tick for the detail panel's "time waiting" indicator.
  const now = useMinuteTick()

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
  // The test personas (sales_person / sales_manager / accounts) predate the CRM and IDT roles and
  // cannot stand in for them, so they resolve to false for these two actions. Moot in practice —
  // testPersona has no setter, so effectivePersona is always 'actual'.
  const isIdtRole = normalizeRole(currentUserRole) === 'idt'
  const canDeliver = (effectivePersona === 'actual' ? canDeliverKiaBooking(currentUserRole) : false) && !isIdtRole
  const canAllotVehicle = effectivePersona === 'actual' ? canAllotKiaVehicleToBooking(currentUserRole) : false
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
    if (booking.status === 'transferring') {
      return {
        label: 'Stage 4 · In Transit',
        title: 'Vehicle in transit',
        body: 'The VIN is reserved for this booking, but the vehicle is still in transit. The payment window has NOT started — it opens automatically once the vehicle reaches Free Stock. Accounts can still record a payment early.',
        actionLabel: canActAsAccountsVerify ? 'Confirm Payment & Invoice' : null,
        onAction: canActAsAccountsVerify ? () => onAction('accounts') : null,
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
              {/* Waiting / Pending with — refined by the linked proforma's approval state. */}
              <BookingWaitingIndicator
                status={booking.status}
                approvalStatus={proforma?.status}
                updatedAt={booking.updatedAt}
                now={now}
                align="right"
              />
              <div className="flex gap-2 flex-wrap">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDiscountDialogOpen(true)}
                  className="h-8 rounded-xl text-xs font-bold border-slate-200 hover:bg-slate-100 text-slate-800"
                >
                  <Percent className="mr-1.5 h-3.5 w-3.5 text-slate-700" />
                  Apply Discount
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (onOpenEmiCalculator) {
                      onOpenEmiCalculator({
                        model: booking.model,
                        variant: booking.variant,
                      })
                    }
                  }}
                  className="h-8 rounded-xl text-xs font-bold border-indigo-200 hover:bg-indigo-50 text-indigo-700 bg-indigo-50/50"
                >
                  <Calculator className="mr-1.5 h-3.5 w-3.5 text-indigo-600" />
                  Calculate EMI
                </Button>
                {Boolean(isKiaBookingWaitLong(booking.updatedAt)) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (onOpenOverdueRemark) {
                        onOpenOverdueRemark({
                          id: booking.id,
                          bookingNumber: booking.bookingNumber,
                          customerName: booking.customerName,
                          notes: booking.notes,
                        })
                      }
                    }}
                    className="h-8 rounded-xl text-xs font-bold border-rose-300 hover:bg-rose-100 text-rose-800 bg-rose-50"
                  >
                    <MessageSquare className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                    {booking.notes ? 'Edit Overdue Remark' : '+ Add Overdue Remark'}
                  </Button>
                )}
              </div>
              {Boolean((booking.metadata as Record<string, unknown> | null)?.vehicleNotInStock) && (
                <Chip tone="warning">Vehicle not in stock</Chip>
              )}
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
        {allocation?.stockStatus === 'sold' && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-black text-amber-800">
              <XCircle className="h-4 w-4" /> Allotted vehicle no longer in DMS stock
            </p>
            <p className="mt-1 text-xs font-semibold text-amber-700">
              VIN {allocation.vinNumber} has disappeared from the DMS stock list{allocation.stockMissingAt ? ` (detected ${new Date(allocation.stockMissingAt).toLocaleDateString('en-IN')})` : ''} — it was likely sold. Please verify and update its status.
            </p>
          </div>
        )}
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
                ['PAN', maskKiaPii(String(meta.panNumber || ''), canViewPii)],
                ['Aadhaar', maskKiaPii(String(meta.aadhaarNumber || ''), canViewPii)],
                ['Exchange', String(meta.exchange || 'No')],
                ...(String(meta.exchange || '') === 'Yes'
                  ? ([['Exchange Vehicle', String(meta.exchangeVehicleName || '-')], ['Exchange Value', String(meta.exchangeValue || '-')]] as Array<[string, string]>)
                  : []),
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
              <ActionCard
                title="Accounts · Payment & Invoice"
                icon={ShieldCheck}
                value={accountsDone ? (accountsVerification.invoiceNumber ? `Invoice #${accountsVerification.invoiceNumber}` : 'Invoice recorded') : allocation ? allocation.vinNumber : 'No active VIN'}
                status={accountsDone ? 'Payment released · Verified' : 'Pending Accounts'}
                action={accountsDone ? (accountsVerification.invoiceDocumentUrl ? 'View Invoice PDF' : 'View Invoice Details') : 'Confirm Payment & Invoice'}
                disabled={actionLoading || (!accountsDone && (!canActAsAccountsVerify || !allocation || !(booking.status === 'vehicle_allocated' || booking.status === 'transferring' || booking.status === 'transfer_requested' || booking.status === 'payment_confirmed')))}
                loading={actionLoading}
                onClick={() => {
                  if (accountsDone) {
                    if (onOpenInvoiceViewer) onOpenInvoiceViewer(booking)
                  } else {
                    onAction('accounts')
                  }
                }}
              />
            </div>
          )
        })()}

        {/* Discount Requests Section */}
        <section className="kia-surface p-4 sm:p-5">
          <div className="flex items-center justify-between border-b pb-3 mb-4" style={{ borderColor: 'var(--kia-hairline)' }}>
            <div className="flex items-center gap-3">
              <IconTile icon={Percent} tone="accent" size="sm" />
              <h3 className="text-[15px] font-extrabold tracking-tight text-[var(--kia-text)]">Discount Requests</h3>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDiscountDialogOpen(true)}
              className="h-8 rounded-xl text-xs font-bold border-indigo-200 text-indigo-600 hover:bg-indigo-50/50"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Apply Discount
            </Button>
          </div>
          {discounts && discounts.length > 0 ? (
            <div className="space-y-3.5">
              {discounts.map((discount: any) => {
                const isPending = discount.status === 'PENDING'
                const isApproved = discount.status === 'APPROVED'
                const isRejected = discount.status === 'REJECTED'
                return (
                  <div 
                    key={discount.id} 
                    className={cn(
                      "rounded-2xl p-4 border transition-all",
                      isPending && "bg-amber-50/40 border-amber-200/60 shadow-sm shadow-amber-50/10",
                      isApproved && "bg-emerald-50/40 border-emerald-200/60 shadow-sm shadow-emerald-50/10",
                      isRejected && "bg-red-50/40 border-red-200/60 shadow-sm shadow-red-50/10"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Requested Amount</p>
                        <p className="text-lg font-black text-slate-950">INR {Number(discount.requestedAmount).toLocaleString('en-IN')}</p>
                      </div>
                      <span 
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider uppercase",
                          isPending && "bg-amber-100 text-amber-800",
                          isApproved && "bg-emerald-100 text-emerald-800",
                          isRejected && "bg-red-100 text-red-800"
                        )}
                      >
                        {discount.status}
                      </span>
                    </div>

                    {discount.reason && (
                      <div className="mt-2 text-xs text-slate-600">
                        <span className="font-bold text-slate-700">Reason:</span> {discount.reason}
                      </div>
                    )}

                    <div className="mt-2.5 flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
                      <span>Requested by {discount.requestedByName}</span>
                      <span>•</span>
                      <span>{new Date(discount.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    {/* MD Action remarks */}
                    {!isPending && (
                      <div className="mt-3.5 pt-3 border-t border-dashed border-slate-200/70">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-bold text-slate-700">
                            {isApproved ? 'Approved' : 'Rejected'} by {discount.actionByName}
                          </span>
                          {isApproved && discount.approvedAmount && (
                            <span className="font-black text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-lg">
                              Approved: INR {Number(discount.approvedAmount).toLocaleString('en-IN')}
                            </span>
                          )}
                        </div>
                        {discount.actionRemarks && (
                          <p className="text-xs italic text-slate-500">"{discount.actionRemarks}"</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed p-6 text-center text-xs font-semibold text-slate-400">
              No discount requests have been made for this booking yet.
            </div>
          )}
        </section>

        {/* Uploaded ID documents — links gated to PII-authorized viewers (MD / Super Admin / Finance Head). */}
        {(() => {
          const meta = (booking.metadata || {}) as Record<string, unknown>
          const docs = [
            { label: 'PAN Card', url: String(meta.panCardUrl || '') },
            { label: 'Aadhaar Card', url: String(meta.aadhaarCardUrl || '') },
            { label: 'Employee ID', url: String(meta.employeeIdUrl || '') },
          ].filter((d) => d.url)
          if (!docs.length || !canViewPii) return null
          return (
            <section className="kia-surface p-4 sm:p-5">
              <div className="flex items-center gap-3 border-b pb-3" style={{ borderColor: 'var(--kia-hairline)' }}>
                <IconTile icon={FileText} tone="accent" size="sm" />
                <h3 className="text-[15px] font-extrabold tracking-tight text-[var(--kia-text)]">Customer Documents</h3>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {docs.map((d) => (
                  <a key={d.label} href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold text-[var(--kia-text-soft)] transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--kia-hairline)' }}>
                    <FileText className="h-4 w-4" /> {d.label}
                  </a>
                ))}
              </div>
            </section>
          )
        })()}

        <section className="kia-surface p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <IconTile icon={Car} tone="info" />
            <h3 className="text-base font-extrabold tracking-tight text-[var(--kia-text)] sm:text-lg">Vehicle Allocation</h3>
            <p className="text-xs font-medium leading-5 text-[var(--kia-text-soft)]">
              Matchable VINs exclude local Retail and active allocations.
            </p>
          </div>
          {allocation ? (
            <div className="mt-4 rounded-2xl border p-3.5" style={toneSoftStyle('success')}>
              <p className="break-all font-mono text-sm font-extrabold" style={{ color: 'var(--kia-text)' }}>{allocation.vinNumber}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[var(--kia-text-soft)]">{allocation.model} · {allocation.variant} · {allocation.color || 'Color NA'}</p>
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ borderColor: 'var(--kia-hairline)', backgroundColor: 'var(--kia-surface)', color: 'var(--kia-text-soft)' }}>
                <CalendarCheck className="h-3.5 w-3.5" /> Payment window: {formatTimeRemaining(allocation.expiresAt)}
              </span>
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
                        <Button size="sm" className="rounded-xl text-xs font-bold" disabled={actionLoading || !canAllotVehicle} onClick={() => onAllot(vehicle.vinNumber)}>Allot</Button>
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
                          ? (activity ? `${formatDateTime(activity.createdAt)}${activity.actorName ? ` by ${activity.actorName}` : ''}` : (stage.key === 'booking' ? formatDateTime(booking.createdAt) : 'Completed'))
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
              {idtArrangement && (
                <div className="kia-surface-sunken border border-indigo-100 bg-indigo-50/20 px-3 py-2.5 rounded-xl">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-indigo-500">IDT Shortage Arrangement Plan</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">
                    Status: <span className={cn(
                      "capitalize font-extrabold",
                      idtArrangement.status === 'arranged' ? "text-emerald-600" : "text-rose-600"
                    )}>{idtArrangement.status?.replace('_', ' ')}</span>
                  </p>
                  {idtArrangement.status === 'arranged' && (
                    <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block uppercase">Source Dealer</span>
                        <span className="text-slate-800 font-extrabold">{idtArrangement.sourceDealer || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block uppercase">Expected Received</span>
                        <span className="text-slate-800 font-extrabold">
                          {idtArrangement.expectedDate ? new Date(idtArrangement.expectedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </span>
                      </div>
                    </div>
                  )}
                  {idtArrangement.remarks && (
                    <div className="mt-2 pt-1.5 border-t border-indigo-50 text-xs font-medium text-slate-500 italic">
                      Remarks: "{idtArrangement.remarks}"
                    </div>
                  )}
                </div>
              )}
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
                  <Button variant="outline" className="h-10 rounded-2xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100" disabled={actionLoading} onClick={() => onEdit?.()}>
                    <Pencil className="h-4 w-4" /> Edit Booking
                  </Button>
                )}
                {(canActAsSalesManager || canActAsAccounts) && !isTerminal && (
                  booking.status === 'on_hold' ? (
                    <Button variant="outline" className="h-10 rounded-2xl border-sky-200 text-xs font-bold text-sky-700 hover:bg-sky-50" disabled={actionLoading} onClick={() => onAction('resume')}>
                      <PlayCircle className="h-4 w-4" /> Resume Booking
                    </Button>
                  ) : (
                    <Button variant="outline" className="h-10 rounded-2xl border-amber-200 text-xs font-bold text-amber-700 hover:bg-amber-50" disabled={actionLoading} onClick={() => onAction('hold')}>
                      <PauseCircle className="h-4 w-4" /> Put on Hold
                    </Button>
                  )
                )}
                <Button variant="outline" className="h-10 rounded-2xl border-rose-200 text-xs font-bold text-rose-700 hover:bg-rose-50" disabled={actionLoading || isTerminal || isIdtRole} onClick={() => onAction('cancel')}>
                  Cancel Booking
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Apply Discount Request Dialog */}
      <Dialog open={isDiscountDialogOpen} onOpenChange={setIsDiscountDialogOpen}>
        <DialogContent className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl duration-200">
          <DialogTitle className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <Percent className="h-5 w-5 text-slate-900" /> Request Booking Discount
          </DialogTitle>
          <form onSubmit={handleRequestDiscount} className="mt-4 space-y-4">
            <div className="space-y-2">
              <label htmlFor="discount-amount" className="text-xs font-black uppercase tracking-wider text-slate-500 block">
                Discount Amount (INR) <span className="text-red-500">*</span>
              </label>
              <Input
                id="discount-amount"
                type="number"
                required
                placeholder="e.g. 15000"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                className="h-11 rounded-xl border-slate-200 bg-white font-bold"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="discount-reason" className="text-xs font-black uppercase tracking-wider text-slate-500 block">
                Reason / Remarks <span className="text-red-500">*</span>
              </label>
              <textarea
                id="discount-reason"
                required
                placeholder="Please explain why this discount is required..."
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                className="w-full min-h-[100px] rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold focus:border-slate-950 focus:outline-none"
              />
            </div>
            <DialogFooter className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDiscountDialogOpen(false)}
                disabled={isSubmittingDiscount}
                className="h-10 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmittingDiscount}
                className="h-10 rounded-xl bg-slate-950 text-white hover:bg-slate-800"
              >
                {isSubmittingDiscount ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting
                  </>
                ) : (
                  'Submit Request'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
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

function asNumber(value: unknown): number {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: unknown) {
  return `Rs ${Math.round(asNumber(value)).toLocaleString('en-IN')}`
}

interface EmailQuoteForm {
  customerType: string
  proformaDate: string
  customerName: string
  customerPhone: string
  customerAddress: string
  customerEmail: string
  modelName: string
  trimDescription: string
  fuelType: string
  vehicleColor: string
  bankName: string
  bankBranch: string
  loanAmount: string
  insuranceCompany: string
  exShowroom: string
  tcsValue: string
  registrationCharges: string
  insuranceValue: string
  fastagValue: string
  accessoriesKit: string
  extWarranty: string
  cashDiscount: string
  exchangeValue: string
  bookingAmount: string
  govtEmployeeDiscount: string
  additionalDiscount: string
}

const EMPTY_QUOTE_FORM: EmailQuoteForm = {
  customerType: 'Customer',
  proformaDate: new Date().toISOString().slice(0, 10),
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  customerAddress: '',
  modelName: '',
  trimDescription: '',
  fuelType: 'DIESEL',
  vehicleColor: '',
  bankName: 'CASH',
  bankBranch: '',
  insuranceCompany: '',
  loanAmount: '',
  exShowroom: '0',
  tcsValue: '0',
  registrationCharges: '0',
  insuranceValue: '0',
  fastagValue: '0',
  accessoriesKit: '0',
  extWarranty: '0',
  cashDiscount: '0',
  exchangeValue: '0',
  bookingAmount: '0',
  govtEmployeeDiscount: '0',
  additionalDiscount: '0',
}

function EmailQuoteDialog({
  open,
  onOpenChange,
  modelOptions,
  trims,
  prefill,
  prices = [],
  banks = [],
  insuranceCompanies = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelOptions: string[]
  trims: { model: string; trim_description: string }[]
  prefill?: any
  prices?: any[]
  banks?: any[]
  insuranceCompanies?: string[]
}) {
  const [form, setForm] = useState<EmailQuoteForm>(EMPTY_QUOTE_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const update = (key: keyof EmailQuoteForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (errors[key]) {
      setErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }

  useEffect(() => {
    if (open) {
      if (prefill) {
        const meta = (prefill.metadata || {}) as Record<string, any>
        setForm({
          customerType: meta.customerType || 'Customer',
          proformaDate: new Date().toISOString().slice(0, 10),
          customerName: prefill.customerName || '',
          customerPhone: prefill.customerPhone || '',
          customerEmail: prefill.customerEmail || '',
          customerAddress: prefill.customerAddress || '',
          modelName: prefill.model || '',
          trimDescription: prefill.variant || '',
          fuelType: prefill.fuelType || meta.fuelType || 'PETROL',
          vehicleColor: prefill.color || meta.color || '',
          bankName: prefill.bankName || 'CASH',
          bankBranch: meta.bankBranch || '',
          insuranceCompany: meta.insuranceCompany || '',
          loanAmount: String(prefill.loanAmount || '0'),
          exShowroom: '0',
          tcsValue: '0',
          registrationCharges: '0',
          insuranceValue: '0',
          fastagValue: '0',
          accessoriesKit: '0',
          extWarranty: '0',
          cashDiscount: '0',
          exchangeValue: '0',
          bookingAmount: String(meta.bookingAmount || '0'),
          govtEmployeeDiscount: '0',
          additionalDiscount: '0',
        })
      } else {
        setForm(EMPTY_QUOTE_FORM)
      }
      setErrors({})
    }
  }, [open, prefill])

  const pricing = useMemo(() => {
    return calculateKiaProformaPricing(form, prices, banks)
  }, [form, prices, banks])

  const totals = pricing.totals
  const bankOptions = useMemo(() => getKiaBankOptions(banks), [banks])
  const filteredBranches = pricing.branchOptions
  const isCashPayment = form.bankName.toUpperCase() === 'CASH'
  const filteredTrims = useMemo(() => {
    return trims.filter((t) => !form.modelName || t.model === form.modelName).map((t) => t.trim_description)
  }, [form.modelName, trims])

  const [lastPrefilledTrim, setLastPrefilledTrim] = useState<string | null>(null)
  useEffect(() => {
    if (pricing.prefill && pricing.canonicalTrim !== lastPrefilledTrim) {
      setLastPrefilledTrim(pricing.canonicalTrim)
      setForm((current) => ({
        ...current,
        exShowroom: pricing.prefill!.exShowroom,
        tcsValue: pricing.prefill!.tcsValue,
        registrationCharges: pricing.prefill!.registrationCharges,
        insuranceValue: pricing.prefill!.insuranceValue,
        fastagValue: pricing.prefill!.fastagValue,
        accessoriesKit: pricing.prefill!.accessoriesKit,
        extWarranty: pricing.prefill!.extWarranty,
        insuranceCompany: pricing.prefill!.insuranceCompany,
      }))
    }
  }, [pricing.prefill, pricing.canonicalTrim, lastPrefilledTrim])

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

    if (!form.modelName) nextErrors.modelName = 'Please select a model'
    if (!form.trimDescription) nextErrors.trimDescription = 'Please select a variant'
    if (!isCashPayment && !form.bankName) nextErrors.bankName = 'Bank name is required'

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          totalCustomerCost: totals.totalCustomerCost,
          grandTotalCost: totals.grandTotalCost,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit quote')

      const link = document.createElement('a')
      link.href = `data:application/pdf;base64,${data.pdf}`
      link.download = data.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast({ title: 'Quotation Generated', description: 'Quote generated, saved in database, and downloaded successfully!', variant: 'success' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Quote Generation Failed', description: err instanceof Error ? err.message : 'Error generating quote', variant: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kia-premium flex max-h-[94dvh] w-[calc(100vw-0.75rem)] max-w-4xl flex-col overflow-hidden rounded-[1.25rem] border-0 bg-white p-0 shadow-[0_30px_90px_rgba(15,23,42,0.28)] sm:rounded-[2rem]">
        <LoaderOverlay show={isSubmitting} variant="proforma" label="Generating quotation…" sublabel="Preparing and stamping the PDF" />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="relative shrink-0 overflow-hidden border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,#e0f2fe,transparent_35%),linear-gradient(135deg,#ffffff,#f8fafc)] p-4 sm:p-7">
            <div className="absolute -left-20 -top-24 h-56 w-56 rounded-full bg-cyan-200/30 blur-3xl" />
            <Badge variant="outline" className="relative mb-3 w-fit rounded-full border-cyan-100 bg-cyan-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-700 sm:mb-4">Indicative Quote</Badge>
            <DialogTitle className="relative text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Create Price Quotation</DialogTitle>
            <DialogDescription className="relative mt-2 text-xs font-semibold leading-5 text-slate-500 sm:text-sm">Send a quotation PDF looking like a proforma with bank/validity restrictions.</DialogDescription>
          </DialogHeader>
          
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-4 sm:p-6">
            {/* Customer Details */}
            <div className="rounded-2xl border border-slate-100 bg-white/60 p-4 shadow-sm">
              <h4 className="text-xs font-black uppercase tracking-[0.16em] text-slate-800 mb-3">Customer Details</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Customer Type">
                  <Select value={form.customerType} onValueChange={(val) => update('customerType', val)}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['Customer', 'CSD', 'Bharat Series'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Customer Name" error={errors.customerName}>
                  <Input className="h-11 rounded-xl border-slate-200 bg-white font-bold" value={form.customerName} onChange={(e) => update('customerName', e.target.value)} placeholder="e.g. John Doe" />
                </Field>
                <Field label="Mobile Number" error={errors.customerPhone}>
                  <Input className="h-11 rounded-xl border-slate-200 bg-white font-bold" inputMode="numeric" maxLength={10} value={form.customerPhone} onChange={(e) => update('customerPhone', e.target.value.replace(/\D/g, ''))} placeholder="10-digit mobile" />
                </Field>
                <Field label="Customer Email" error={errors.customerEmail}>
                  <Input className="h-11 rounded-xl border-slate-200 bg-white font-bold" type="email" value={form.customerEmail} onChange={(e) => update('customerEmail', e.target.value)} placeholder="name@domain.com" />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Customer Address">
                    <Input className="h-11 rounded-xl border-slate-200 bg-white font-bold" value={form.customerAddress} onChange={(e) => update('customerAddress', e.target.value)} placeholder="Full Customer Address" />
                  </Field>
                </div>
              </div>
            </div>

            {/* Vehicle & Financer */}
            <div className="rounded-2xl border border-slate-100 bg-white/60 p-4 shadow-sm">
              <h4 className="text-xs font-black uppercase tracking-[0.16em] text-slate-800 mb-3">Vehicle & Bank details</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Model" error={errors.modelName}>
                  <Select value={form.modelName} onValueChange={(val) => { update('modelName', val); update('trimDescription', '') }}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white"><SelectValue placeholder="Select Model" /></SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Variant / Trim" error={errors.trimDescription}>
                  <SearchableVariantSelect value={form.trimDescription} onChange={(val) => update('trimDescription', val)} options={filteredTrims} />
                </Field>
                <Field label="Vehicle Color">
                  <Input className="h-11 rounded-xl border-slate-200 bg-white font-bold" value={form.vehicleColor} onChange={(e) => update('vehicleColor', e.target.value)} placeholder="e.g. Gravity Grey" />
                </Field>
                <Field label="Fuel Type">
                  <Select value={form.fuelType} onValueChange={(val) => update('fuelType', val)}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['DIESEL', 'PETROL', 'ELECTRIC'].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Bank / Financer" error={errors.bankName}>
                  <Select value={form.bankName} onValueChange={(val) => { update('bankName', val); update('bankBranch', ''); if (val === 'CASH') update('loanAmount', '0') }}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {bankOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                {!isCashPayment && (
                  <Field label="Bank Branch">
                    <Select value={form.bankBranch} onValueChange={(val) => update('bankBranch', val)}>
                      <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white"><SelectValue placeholder="Select Branch" /></SelectTrigger>
                      <SelectContent>
                        {filteredBranches.map((br) => <SelectItem key={br} value={br}>{br}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <Field label="Loan Amount">
                  <Input className="h-11 rounded-xl border-slate-200 bg-white font-bold" type="number" disabled={isCashPayment} value={form.loanAmount} onChange={(e) => update('loanAmount', e.target.value)} />
                </Field>
                <Field label="Insurance Company">
                  <Select value={form.insuranceCompany} onValueChange={(val) => update('insuranceCompany', val)}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white"><SelectValue placeholder="Select Insurance" /></SelectTrigger>
                    <SelectContent>
                      {insuranceCompanies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>

            {/* Price Details */}
            <div className="rounded-2xl border border-slate-100 bg-white/60 p-4 shadow-sm">
              <h4 className="text-xs font-black uppercase tracking-[0.16em] text-slate-800 mb-3">Price Particulars</h4>
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  ['exShowroom', 'Ex-Showroom'],
                  ['tcsValue', 'TCS'],
                  ['registrationCharges', 'RTO / Registration'],
                  ['insuranceValue', 'Insurance (Approx)'],
                  ['fastagValue', 'Fastag / Number Plate'],
                  ['accessoriesKit', 'Accessories Kit'],
                  ['extWarranty', 'Extended Warranty'],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <Input className="h-11 rounded-xl border-slate-200 bg-white font-bold" type="number" value={form[key as keyof EmailQuoteForm]} onChange={(e) => update(key as keyof EmailQuoteForm, e.target.value)} />
                  </Field>
                ))}
              </div>
            </div>

            {/* Discounts */}
            <div className="rounded-2xl border border-slate-100 bg-white/60 p-4 shadow-sm">
              <h4 className="text-xs font-black uppercase tracking-[0.16em] text-slate-800 mb-3">Discounts & Deductions</h4>
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  ['cashDiscount', 'Consumer / Cash Offer'],
                  ['exchangeValue', 'Exchange Bonus'],
                  ['bookingAmount', 'Booking Amount'],
                  ['govtEmployeeDiscount', 'Corporate / Govt Discount'],
                  ['additionalDiscount', 'Dealer / Additional Adjustment'],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <Input className="h-11 rounded-xl border-slate-200 bg-white font-bold" type="number" value={form[key as keyof EmailQuoteForm]} onChange={(e) => update(key as keyof EmailQuoteForm, e.target.value)} />
                  </Field>
                ))}
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-100/50 p-4 border border-slate-100">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">To Be Borne By Customer</p>
                  <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">
                    {formatCurrency(totals.totalCustomerCost)}
                  </p>
                </div>
                <div className="rounded-2xl border p-4 border-slate-200 bg-slate-950">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Grand Total</p>
                  <p className="mt-1 text-2xl font-extrabold tracking-tight text-white">
                    {formatCurrency(totals.grandTotalCost)}
                  </p>
                </div>
              </div>
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

interface DiscountsDashboardProps {
  query: any
  currentUserRole: string
  onOpenBooking: (id: string) => void
}

function DiscountsDashboard({ query, currentUserRole, onOpenBooking }: DiscountsDashboardProps) {
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING')
  const [searchQuery, setSearchQuery] = useState('')
  
  // MD Action states
  const [activeActionRequest, setActiveActionRequest] = useState<any | null>(null)
  const [approvedAmount, setApprovedAmount] = useState('')
  const [actionRemarks, setActionRemarks] = useState('')
  const [isSubmittingAction, setIsSubmittingAction] = useState(false)

  // Initialize approved amount when selecting a request
  useEffect(() => {
    if (activeActionRequest) {
      setApprovedAmount(String(activeActionRequest.requestedAmount))
      setActionRemarks('')
    }
  }, [activeActionRequest])

  const handleMDAction = async (action: 'APPROVE' | 'REJECT') => {
    if (!activeActionRequest) return
    setIsSubmittingAction(true)
    try {
      const response = await fetch(`/api/brands/kia/bookings/discounts/${activeActionRequest.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          approvedAmount: action === 'APPROVE' ? (approvedAmount ? Number(approvedAmount) : Number(activeActionRequest.requestedAmount)) : undefined,
          remarks: actionRemarks,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to complete action.')
      toast({ 
        title: `Discount ${action === 'APPROVE' ? 'Approved' : 'Rejected'}`, 
        description: `Successfully ${action === 'APPROVE' ? 'approved' : 'rejected'} discount of INR ${Number(activeActionRequest.requestedAmount).toLocaleString('en-IN')}` 
      })
      setActiveActionRequest(null)
      query.refetch()
    } catch (err) {
      toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Something went wrong', variant: 'error' })
    } finally {
      setIsSubmittingAction(false)
    }
  }

  if (query.isLoading) {
    return <TableSkeleton columns={7} />
  }

  if (query.isError) {
    return (
      <EmptyState
        illustration="error"
        title="Unable to load discount requests"
        description={query.error instanceof Error ? query.error.message : 'The request failed.'}
        action={
          <Button variant="outline" className="h-10 rounded-2xl font-bold" onClick={() => query.refetch()}>
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        }
      />
    )
  }

  const discounts = query.data?.discounts || []
  
  // Filter logic
  const filteredDiscounts = discounts.filter((d: any) => {
    const matchesStatus = statusFilter === 'ALL' || d.status === statusFilter
    const matchesSearch = 
      !searchQuery ||
      String(d.bookingNumber || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(d.customerName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(d.model || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(d.requestedByName || '').toLowerCase().includes(searchQuery.toLowerCase())
    return matchesStatus && matchesSearch
  })

  const pendingCount = discounts.filter((d: any) => d.status === 'PENDING').length

  return (
    <div className="space-y-4">
      {/* Search and Status tabs */}
      <section className={cn(PRIMARY_SURFACE, 'sticky top-2 z-20 p-2.5 sm:top-3 sm:p-3')}>
        <div className="grid gap-4 md:grid-cols-[1.5fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kia-text-faint)]" />
            <Input 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              placeholder="Search by booking, customer, model, consultant…" 
              className={cn(INPUT_STYLE, '!pl-10 sm:!pl-11')} 
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto rounded-xl bg-slate-100/50 p-1 border border-slate-100">
            {[
              { key: 'PENDING', label: `Pending (${pendingCount})` },
              { key: 'APPROVED', label: 'Approved' },
              { key: 'REJECTED', label: 'Rejected' },
              { key: 'ALL', label: 'All Requests' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key as any)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                  statusFilter === tab.key 
                    ? "bg-slate-950 text-white shadow-sm" 
                    : "text-slate-600 hover:bg-slate-100/80"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Main Table */}
      <section className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
        <div className="flex items-center justify-between border-b px-4 py-3 border-[var(--kia-hairline)]">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-100" style={toneSoftStyle('accent')}>
              <Percent className="h-[1.05rem] w-[1.05rem] text-slate-800" />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--kia-text-faint)]">Approvals Queue</p>
              <h2 className="text-sm font-extrabold text-[var(--kia-text)]">
                {filteredDiscounts.length} discount requests listed ({pendingCount} pending)
              </h2>
            </div>
          </div>
          {query.isFetching && <InlineLoader variant="search" size={28} />}
        </div>

        {filteredDiscounts.length === 0 ? (
          <div className="flex h-[240px] flex-col items-center justify-center text-center p-6 bg-slate-50/20">
            <p className="text-sm font-medium text-[var(--kia-text-soft)]">No matching discount requests found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="kia-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 py-3 text-left">Booking</TableHead>
                  <TableHead className="px-4 py-3 text-left">Customer</TableHead>
                  <TableHead className="px-4 py-3 text-left">Vehicle Details</TableHead>
                  <TableHead className="px-4 py-3 text-left">Requested By</TableHead>
                  <TableHead className="px-4 py-3 text-right">Discount (INR)</TableHead>
                  <TableHead className="px-4 py-3 text-center">Status</TableHead>
                  <TableHead className="px-4 py-3 text-center">Requested At</TableHead>
                  <TableHead className="px-4 py-3 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDiscounts.map((discount: any) => {
                  const isPending = discount.status === 'PENDING'
                  const isApproved = discount.status === 'APPROVED'
                  const isRejected = discount.status === 'REJECTED'
                  
                  return (
                    <TableRow 
                      key={discount.id}
                      className="hover:bg-slate-50/50 cursor-pointer"
                      onClick={() => onOpenBooking(discount.bookingId)}
                    >
                      <TableCell className="px-4 py-3 font-mono font-bold text-xs text-[var(--kia-text)]">
                        {discount.bookingNumber}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <p className="text-xs font-black text-slate-800">{discount.customerName}</p>
                        <p className="text-[10px] text-slate-400 font-semibold">{discount.dealerCode}</p>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-xs font-semibold text-slate-600">
                        {discount.model} · {discount.variant}
                        {discount.color && <span className="text-slate-400 block text-[10px]">{discount.color}</span>}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-xs font-bold text-slate-700">
                        {discount.requestedByName}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        <p className="text-xs font-black text-slate-900">
                          {Number(discount.requestedAmount).toLocaleString('en-IN')}
                        </p>
                        {isApproved && discount.approvedAmount && (
                          <span className="text-[10px] text-emerald-600 font-bold block">
                            Approved: {Number(discount.approvedAmount).toLocaleString('en-IN')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-center">
                        <span 
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[9px] font-black tracking-wider uppercase",
                            isPending && "bg-amber-100 text-amber-800",
                            isApproved && "bg-emerald-100 text-emerald-800",
                            isRejected && "bg-red-100 text-red-800"
                          )}
                        >
                          {discount.status}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-center text-[10px] font-semibold text-slate-400">
                        {new Date(discount.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {isPending && ['md', 'ceo', 'developer', 'admin'].includes(currentUserRole) ? (
                          <Button
                            size="sm"
                            className="h-8 rounded-xl bg-slate-950 text-white font-extrabold text-xs shadow-md shadow-slate-950/10 hover:bg-slate-800"
                            onClick={() => setActiveActionRequest(discount)}
                          >
                            Review
                          </Button>
                        ) : discount.actionRemarks ? (
                          <span className="text-[10px] text-slate-400 font-medium italic block max-w-[120px] truncate" title={discount.actionRemarks}>
                            "{discount.actionRemarks}"
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 font-medium">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* MD Action Dialog */}
      <Dialog open={Boolean(activeActionRequest)} onOpenChange={(open) => { if (!open) setActiveActionRequest(null) }}>
        <DialogContent className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl duration-200">
          <DialogTitle className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <Percent className="h-5 w-5 text-slate-900" /> Review Discount Request
          </DialogTitle>
          
          {activeActionRequest && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-2 border border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase block">Booking</span>
                  <span className="text-slate-950 font-black">{activeActionRequest.bookingNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase block">Customer</span>
                  <span className="text-slate-950 font-black">{activeActionRequest.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase block">Vehicle</span>
                  <span className="text-slate-950 font-black">{activeActionRequest.model} · {activeActionRequest.variant}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-bold uppercase block">Requested By</span>
                  <span className="text-slate-950 font-black">{activeActionRequest.requestedByName}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200">
                  <span className="text-slate-400 font-bold uppercase block">Requested Discount</span>
                  <span className="text-slate-950 font-extrabold">INR {Number(activeActionRequest.requestedAmount).toLocaleString('en-IN')}</span>
                </div>
                {activeActionRequest.reason && (
                  <div className="pt-2 border-t border-slate-200 text-slate-600">
                    <span className="text-[10px] text-slate-400 font-bold block uppercase mb-0.5">Reason</span>
                    <p className="font-semibold italic">"{activeActionRequest.reason}"</p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="approved-amount" className="text-xs font-black uppercase tracking-wider text-slate-500 block">
                    Approved Discount Amount (INR)
                  </label>
                  <Input
                    id="approved-amount"
                    type="number"
                    value={approvedAmount}
                    onChange={(e) => setApprovedAmount(e.target.value)}
                    className="h-11 rounded-xl border-slate-200 bg-white font-bold"
                    placeholder="e.g. 15000"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="action-remarks" className="text-xs font-black uppercase tracking-wider text-slate-500 block">
                    MD Remarks / Feedback
                  </label>
                  <textarea
                    id="action-remarks"
                    value={actionRemarks}
                    onChange={(e) => setActionRemarks(e.target.value)}
                    className="w-full min-h-[80px] rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold focus:border-slate-950 focus:outline-none"
                    placeholder="Provide any comments or instructions..."
                  />
                </div>
              </div>

              <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveActionRequest(null)}
                  disabled={isSubmittingAction}
                  className="h-10 rounded-xl w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => handleMDAction('REJECT')}
                  disabled={isSubmittingAction}
                  className="h-10 rounded-xl bg-rose-600 text-white hover:bg-rose-700 w-full sm:w-auto"
                >
                  Reject Request
                </Button>
                <Button
                  type="button"
                  onClick={() => handleMDAction('APPROVE')}
                  disabled={isSubmittingAction || !approvedAmount || isNaN(Number(approvedAmount)) || Number(approvedAmount) < 0}
                  className="h-10 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 w-full sm:w-auto"
                >
                  {isSubmittingAction ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing
                    </>
                  ) : (
                    'Approve Request'
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmiCalculatorDialog({
  open,
  onClose,
  initialModel,
  initialVariant,
  initialExShowroom,
  optionsData,
  prices = [],
  modelOptions = [],
  priceTrims = [],
}: {
  open: boolean
  onClose: () => void
  initialModel?: string
  initialVariant?: string
  initialExShowroom?: number
  optionsData?: ProformaOptionsPayload
  prices?: any[]
  modelOptions?: string[]
  priceTrims?: Array<{ model: string; trim_description: string }>
}) {
  const [selectedModel, setSelectedModel] = useState(initialModel || '')
  const [selectedVariant, setSelectedVariant] = useState(initialVariant || '')
  const [roi, setRoi] = useState<number>(8.5)
  const [tenureYears, setTenureYears] = useState<number>(5)
  const [downPaymentType, setDownPaymentType] = useState<'percent' | 'amount'>('percent')
  const [downPaymentPercent, setDownPaymentPercent] = useState<number>(20)
  const [downPaymentAmountInput, setDownPaymentAmountInput] = useState<string>('')
  const [priceMode, setPriceMode] = useState<'on_road' | 'ex_showroom' | 'custom'>('on_road')
  const [customPriceInput, setCustomPriceInput] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const activePrices = useMemo(() => {
    return prices.length > 0 ? prices : (optionsData?.prices || [])
  }, [prices, optionsData?.prices])

  const models = useMemo(() => {
    if (modelOptions.length > 0) return modelOptions
    const fromOptions = optionsData?.models || []
    const fromPrices = activePrices.map((p) => p.model).filter(Boolean)
    const all = Array.from(new Set([...fromOptions, ...fromPrices]))
    return all.length > 0 ? all : ['CARENS', 'CARNIVAL', 'EV6', 'SELTOS', 'SONET', 'SYROS']
  }, [modelOptions, optionsData?.models, activePrices])

  useEffect(() => {
    if (open) {
      if (initialModel) {
        const match = models.find((m) => m.trim().toLowerCase() === initialModel.trim().toLowerCase())
        setSelectedModel(match || initialModel)
      } else if (!selectedModel && models.length > 0) {
        setSelectedModel(models[0])
      }
      if (initialVariant) setSelectedVariant(initialVariant)
    }
  }, [open, initialModel, initialVariant, models, selectedModel])

  const variantOptions = useMemo(() => {
    if (!selectedModel) return []
    const norm = selectedModel.trim().toLowerCase()
    const allTrims = priceTrims.length > 0 ? priceTrims : (optionsData?.trims || [])

    const filteredFromTrims = allTrims
      .filter((t) => String(t.model || '').trim().toLowerCase() === norm)
      .map((t) => t.trim_description)
      .filter(Boolean)

    const filteredFromPrices = activePrices
      .filter((p) => String(p.model || '').trim().toLowerCase() === norm)
      .map((p) => p.trimDescription)
      .filter(Boolean)

    return Array.from(new Set([...filteredFromTrims, ...filteredFromPrices]))
  }, [selectedModel, priceTrims, optionsData?.trims, activePrices])

  useEffect(() => {
    if (variantOptions.length > 0 && (!selectedVariant || !variantOptions.includes(selectedVariant))) {
      setSelectedVariant(variantOptions[0])
    }
  }, [selectedModel, variantOptions, selectedVariant])

  const priceDetail = useMemo(() => {
    if (!activePrices.length) return null

    const normVariant = (selectedVariant || '').trim().toLowerCase()
    const normModel = (selectedModel || '').trim().toLowerCase()

    if (!normVariant && !normModel) return null

    // 1. Try matching trimDescription first (exact match, since trim descriptions like 'Seltos G1.5T iMT HTE (O)' are unique in DB)
    if (normVariant) {
      const exactTrimMatch = activePrices.find(
        (p) => String(p.trimDescription || '').trim().toLowerCase() === normVariant
      )
      if (exactTrimMatch) return exactTrimMatch
    }

    // 2. Try model + trim partial match
    if (normModel && normVariant) {
      const modelAndTrimMatch = activePrices.find((p) => {
        const pModel = String(p.model || '').trim().toLowerCase()
        const pTrim = String(p.trimDescription || '').trim().toLowerCase()
        const modelMatches = normModel.includes(pModel) || pModel.includes(normModel)
        const trimMatches = normVariant.includes(pTrim) || pTrim.includes(normVariant)
        return modelMatches && trimMatches
      })
      if (modelAndTrimMatch) return modelAndTrimMatch
    }

    // 3. Fallback to model match only
    if (normModel) {
      const firstModelMatch = activePrices.find((p) => {
        const pModel = String(p.model || '').trim().toLowerCase()
        return normModel.includes(pModel) || pModel.includes(normModel)
      })
      if (firstModelMatch) return firstModelMatch
    }

    return null
  }, [activePrices, selectedModel, selectedVariant])

  const exShowroom = useMemo(() => {
    if (priceMode === 'custom' && customPriceInput) {
      return Number(customPriceInput) || 0
    }
    if (priceDetail) {
      const priceVal = Number(
        (priceDetail as any).exShowroomPrice ??
        (priceDetail as any).exShowroom ??
        (priceDetail as any).newExShowroomPrice ??
        0
      )
      if (priceVal > 0) return priceVal
    }
    if (initialExShowroom) return initialExShowroom
    return 0
  }, [priceMode, customPriceInput, priceDetail, initialExShowroom])

  const onRoadPrice = useMemo(() => {
    if (!priceDetail) return exShowroom
    const p = priceDetail as any
    const reg = Number(p.registrationCharges || p.registration || 0) + Number(p.statutoryCharges || p.statutoryTaxes || 0)
    const ins = Number(p.insurance || 0)
    const tcs = Number(p.tcs || 0)
    const fastag = Number(p.fastag || 0)
    const acc = Number(p.accessoriesKit || p.accessories || 0)
    const ew = Number(p.extendedWarranty4thYear || p.extendedWarranty || 0)
    const totalOnRoad = exShowroom + reg + ins + tcs + fastag + acc + ew
    return totalOnRoad > 0 ? totalOnRoad : exShowroom
  }, [priceDetail, exShowroom])

  const effectiveVehiclePrice = priceMode === 'on_road' ? onRoadPrice : exShowroom

  const downPayment = useMemo(() => {
    if (downPaymentType === 'percent') {
      return Math.round((effectiveVehiclePrice * (downPaymentPercent || 0)) / 100)
    }
    return Math.min(Number(downPaymentAmountInput) || 0, effectiveVehiclePrice)
  }, [effectiveVehiclePrice, downPaymentType, downPaymentPercent, downPaymentAmountInput])

  const loanAmount = Math.max(0, effectiveVehiclePrice - downPayment)

  const { emi, totalInterest, totalPayable } = useMemo(() => {
    if (!loanAmount || loanAmount <= 0 || !tenureYears || tenureYears <= 0) {
      return { emi: 0, totalInterest: 0, totalPayable: 0 }
    }
    const r = (roi || 0) / 12 / 100
    const n = tenureYears * 12

    if (r === 0) {
      const emiVal = Math.round(loanAmount / n)
      return { emi: emiVal, totalInterest: 0, totalPayable: loanAmount }
    }

    const emiVal = Math.round((loanAmount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1))
    const payable = emiVal * n
    const interest = Math.max(0, payable - loanAmount)

    return { emi: emiVal, totalInterest: interest, totalPayable: payable }
  }, [loanAmount, roi, tenureYears])

  const formatINR = (val: number) => `₹ ${val.toLocaleString('en-IN')}`

  const copySummaryText = () => {
    const summary = `🚗 *KIA EMI & Finance Summary*
Model: ${selectedModel || 'N/A'}
Variant: ${selectedVariant || 'N/A'}
Vehicle Price (${priceMode === 'on_road' ? 'On-Road' : 'Ex-Showroom'}): ${formatINR(effectiveVehiclePrice)}
Down Payment: ${formatINR(downPayment)} (${downPaymentType === 'percent' ? `${downPaymentPercent}%` : 'Lump-sum'})
------------------------------------------
Loan Amount: ${formatINR(loanAmount)}
Interest Rate: ${roi}% p.a.
Tenure: ${tenureYears} Years (${tenureYears * 12} Months)
------------------------------------------
👉 *Monthly EMI: ${formatINR(emi)} / month*
Total Interest: ${formatINR(totalInterest)}
Total Amount Payable: ${formatINR(totalPayable)}`

    navigator.clipboard.writeText(summary)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl w-full rounded-3xl border border-slate-100 shadow-2xl bg-white p-0 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="bg-slate-900 text-white p-6 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black text-white">KIA Vehicle EMI Calculator</DialogTitle>
              <p className="text-xs text-slate-400 mt-0.5">Calculate monthly EMI, interest, and loan breakdown for Indian auto loans</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">1. Select Vehicle & Variant</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Model</label>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger className="mt-1 h-10 rounded-xl bg-white border-slate-200 font-bold text-slate-800">
                    <SelectValue placeholder="Choose Model..." />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Variant / Trim</label>
                <div className="mt-1">
                  <SearchableVariantSelect
                    value={selectedVariant}
                    onChange={setSelectedVariant}
                    options={variantOptions}
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-slate-200/60 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setPriceMode('on_road')}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition", priceMode === 'on_road' ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:text-slate-900")}
                >
                  On-Road Price
                </button>
                <button
                  type="button"
                  onClick={() => setPriceMode('ex_showroom')}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition", priceMode === 'ex_showroom' ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:text-slate-900")}
                >
                  Ex-Showroom Price
                </button>
                <button
                  type="button"
                  onClick={() => setPriceMode('custom')}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition", priceMode === 'custom' ? "bg-slate-900 text-white shadow-xs" : "text-slate-600 hover:text-slate-900")}
                >
                  Custom Amount
                </button>
              </div>

              {priceMode === 'custom' ? (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">Enter Price (₹):</label>
                  <Input
                    type="number"
                    value={customPriceInput}
                    onChange={(e) => setCustomPriceInput(e.target.value)}
                    placeholder="e.g. 1500000"
                    className="h-9 w-40 rounded-xl border-slate-200 font-bold"
                  />
                </div>
              ) : (
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase text-slate-400">Total Vehicle Price</p>
                  <p className="text-lg font-black text-slate-900">{formatINR(effectiveVehiclePrice)}</p>
                </div>
              )}
            </div>

            {priceDetail && priceMode === 'on_road' && (
              <div className="text-[11px] text-slate-500 grid grid-cols-2 md:grid-cols-4 gap-2 pt-1 border-t border-slate-100 font-medium">
                <span>Ex-Showroom: {formatINR(Number(priceDetail.exShowroomPrice || 0))}</span>
                <span>Reg & Tax: {formatINR(Number(priceDetail.registrationCharges || 0) + Number(priceDetail.statutoryCharges || 0))}</span>
                <span>Insurance: {formatINR(Number(priceDetail.insurance || 0))}</span>
                <span>Acc & EW: {formatINR(Number(priceDetail.accessoriesKit || 0) + Number(priceDetail.extendedWarranty4thYear || 0))}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Down Payment</p>
                <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setDownPaymentType('percent')}
                    className={cn("px-2 py-0.5 rounded", downPaymentType === 'percent' ? "bg-white text-slate-900 shadow-xs" : "text-slate-500")}
                  >
                    % Percent
                  </button>
                  <button
                    type="button"
                    onClick={() => setDownPaymentType('amount')}
                    className={cn("px-2 py-0.5 rounded", downPaymentType === 'amount' ? "bg-white text-slate-900 shadow-xs" : "text-slate-500")}
                  >
                    ₹ Amount
                  </button>
                </div>
              </div>

              {downPaymentType === 'percent' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">{downPaymentPercent}% of Price</span>
                    <span className="text-sm font-black text-slate-900">{formatINR(downPayment)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="80"
                    step="5"
                    value={downPaymentPercent}
                    onChange={(e) => setDownPaymentPercent(Number(e.target.value))}
                    className="w-full accent-slate-900 cursor-pointer"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {[10, 15, 20, 25, 30, 40, 50].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setDownPaymentPercent(pct)}
                        className={cn("px-2 py-1 rounded-lg text-xs font-bold transition border", downPaymentPercent === pct ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400">Enter Lump-sum Down Payment (₹)</label>
                  <Input
                    type="number"
                    value={downPaymentAmountInput}
                    onChange={(e) => setDownPaymentAmountInput(e.target.value)}
                    placeholder="e.g. 250000"
                    className="h-10 rounded-xl border-slate-200 font-bold"
                  />
                  <p className="text-[11px] text-slate-500 font-semibold">Calculated Down Payment: <span className="font-bold text-slate-800">{formatINR(downPayment)}</span></p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">Interest Rate & Tenure</p>
              
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase text-slate-400">Interest Rate (% p.a.)</label>
                  <span className="text-xs font-black text-indigo-600">{roi}%</span>
                </div>
                <Input
                  type="number"
                  step="0.1"
                  value={roi}
                  onChange={(e) => setRoi(Number(e.target.value))}
                  className="mt-1 h-9 rounded-xl border-slate-200 font-bold text-slate-800"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[7.5, 8.0, 8.1, 8.5, 9.0, 9.5, 10.0].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setRoi(rate)}
                      className={cn("px-2 py-0.5 rounded-lg text-xs font-bold transition border", roi === rate ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")}
                    >
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-slate-400">Loan Tenure (Years)</label>
                <div className="grid grid-cols-6 gap-1 mt-1">
                  {[1, 2, 3, 4, 5, 7].map((yrs) => (
                    <button
                      key={yrs}
                      type="button"
                      onClick={() => setTenureYears(yrs)}
                      className={cn("py-1.5 rounded-xl text-xs font-bold text-center transition border", tenureYears === yrs ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")}
                    >
                      {yrs} {yrs === 1 ? 'Yr' : 'Yrs'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-950 p-6 text-white shadow-xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Calculated Monthly EMI</span>
                <p className="text-3xl md:text-4xl font-black text-white mt-0.5">{formatINR(emi)} <span className="text-sm font-semibold text-indigo-200">/ month</span></p>
              </div>

              <Button
                type="button"
                onClick={copySummaryText}
                className={cn("h-11 rounded-2xl px-4 text-xs font-bold transition shadow-lg", copied ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-white text-slate-900 hover:bg-indigo-50")}
              >
                {copied ? <Check className="mr-1.5 h-4 w-4 text-white" /> : <Copy className="mr-1.5 h-4 w-4 text-indigo-600" />}
                {copied ? 'Copied Summary!' : 'Copy Summary (WhatsApp)'}
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4 border-t border-white/10">
              <div className="rounded-2xl bg-white/5 p-3 border border-white/10">
                <span className="text-[9px] font-black uppercase text-indigo-300">Loan Amount</span>
                <p className="text-base font-bold text-white mt-0.5">{formatINR(loanAmount)}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3 border border-white/10">
                <span className="text-[9px] font-black uppercase text-indigo-300">Down Payment</span>
                <p className="text-base font-bold text-white mt-0.5">{formatINR(downPayment)}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3 border border-white/10">
                <span className="text-[9px] font-black uppercase text-amber-300">Total Interest</span>
                <p className="text-base font-bold text-amber-200 mt-0.5">{formatINR(totalInterest)}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3 border border-white/10">
                <span className="text-[9px] font-black uppercase text-emerald-300">Total Payable</span>
                <p className="text-base font-bold text-emerald-200 mt-0.5">{formatINR(totalPayable)}</p>
              </div>
            </div>

            {totalPayable > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[10px] font-bold text-indigo-200">
                  <span>Principal: {Math.round((loanAmount / totalPayable) * 100)}%</span>
                  <span>Interest: {Math.round((totalInterest / totalPayable) * 100)}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden flex">
                  <div style={{ width: `${(loanAmount / totalPayable) * 100}%` }} className="bg-indigo-400 h-full" />
                  <div style={{ width: `${(totalInterest / totalPayable) * 100}%` }} className="bg-amber-400 h-full" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0 flex justify-end">
          <Button variant="outline" onClick={onClose} className="rounded-xl h-10 px-6 font-bold">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

