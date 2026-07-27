'use client'

/* eslint-disable react-hooks/set-state-in-effect */

import { toast } from '@/hooks/use-toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams, useRouter } from 'next/navigation'
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS, DASHBOARD_GC_TIME_MS } from '@/components/providers/query-provider'
import Link from 'next/link'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Columns3,
  FileText,
  Filter,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Upload,
  WalletCards,
  X,
} from 'lucide-react'
import { KiaBookingsClient } from '@/app/brands/kia/bookings/kia-bookings-client'
import { KiaStockManagementDashboard } from './kia-stock-management-dashboard'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { canViewKiaCustomerPii, maskKiaPii } from '@/lib/kia/pii'
import { kiaApprovalStage, KIA_APPROVAL_STAGE_LABELS, kiaStageActorLabel, pendingStageOf } from '@/lib/kia-proforma/approval'
import { calculateKiaProformaPricing, getKiaBankOptions, getBranchesForBank } from '@/lib/kia-proforma/pricing'
import {
  AnimatedNumber,
  Chip,
  FieldValue,
  IconTile,
  Kicker,
  LoaderOverlay,
  motion,
  PremiumEmptyState,
  Reveal,
  TableSkeleton as PremiumTableSkeleton,
  type Tone,
  toneSoftStyle,
} from '@/components/kia/premium'

export type KiaProformaSection =
  | 'bookings'
  | 'stock'
  | 'generate'
  | 'all'
  | 'finance-remarks'
  | 'pending-approval'
  | 'analytics'
  | 'insights'

type CurrentUser = {
  id: string
  email: string
  fullName: string
  role: string
  isApprover: boolean
}

type KiaProfile = {
  id: string
  email: string
  consultantName: string
  dealerLocation: string | null
  employeeCode: string | null
  status: string
  approver: boolean
  settings?: Record<string, unknown> | null
  lastActivityAt?: string | null
}

type PriceRow = {
  model: string
  trimDescription: string
  hyp?: string | null
  bankName?: string | null
  bankBranch?: string | null
  exShowroomPrice: string | number
  tcs: string | number
  registrationCharges: string | number
  statutoryCharges: string | number
  insurance: string | number
  fastag: string | number
  accessoriesKit: string | number
  extendedWarranty4thYear: string | number
  insuranceCompany?: string | null
}

type KiaProformaRow = {
  id: string
  linkedBookingId?: string | null
  linkedBookingNumber?: string | null
  linkedBookingStatus?: string | null
  entryTime: string
  proformaDate: string
  customerType: string
  customerName: string
  mobileNumber: string
  customerAddress: string
  customerEmail: string
  modelName: string
  trimDescription: string
  fuelType: string
  vehicleColor: string
  bankName: string
  bankBranch: string | null
  vehicleStatus: string
  loanAmount: string | number
  insuranceCompany: string | null
  exShowroom: string | number
  tcsValue: string | number
  registrationCharges: string | number
  insuranceValue: string | number
  fastagValue: string | number
  accessoriesKit: string | number
  extWarranty: string | number
  cashDiscount: string | number
  exchangeValue: string | number
  bookingAmount: string | number
  govtEmployeeDiscount: string | number
  additionalDiscount: string | number
  totalCustomerCost: string | number
  grandTotalCost: string | number
  loginEmail: string
  consultant: string
  location: string | null
  empCode: string | null
  approvalStatus: string
  approvedBy: string | null
  linkPreview: string | null
  financeStatus: string | null
  financeRemarks: string | null
  financeUpdatedTime: string | null
  addDiscApproval?: Record<string, unknown> | null
  importMetadata?: Record<string, unknown> | null
}

type OptionsPayload = {
  currentUser: CurrentUser
  profile: KiaProfile
  prices: PriceRow[]
  models: string[]
  trims: { model: string; trim_description: string }[]
  banks: { bank_name: string; bank_branch: string | null }[]
  insuranceCompanies: string[]
}

type PriceImportSummary = {
  sheetName: string
  totalRowsProcessed: number
  importedRows: number
  failedRows: number
  failures: { rowNumber: number; reason: string }[]
  durationMs: number
}

type FormState = {
  customerType: string
  proformaDate: string
  customerName: string
  mobileNumber: string
  customerAddress: string
  customerEmail: string
  modelName: string
  trimDescription: string
  fuelType: string
  vehicleColor: string
  bankName: string
  bankBranch: string
  vehicleStatus: string
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

type VerifyState = Record<string, { status: string; reason: string }>

const FINANCE_STATUS_OPTIONS = ['Pending', 'Cancelled', 'Stock not available', 'Duplicate', 'Current month', 'Converted']
const FIELD_VERIFY = [
  ['cashDiscount', 'CASH DISCOUNT'],
  ['exchangeValue', 'EXCHANGE VALUE'],
  ['bookingAmount', 'BOOKING AMOUNT'],
  ['govtEmployeeDiscount', 'GOVT EMPLOYEE DISCOUNT'],
  ['additionalDiscount', 'ADDITIONAL DISCOUNT'],
  ['insuranceValue', 'INSURANCE VALUE'],
  ['extWarranty', 'EXT WARRANTY'],
] as const

const EMPTY_FORM: FormState = {
  customerType: 'Customer',
  proformaDate: new Date().toISOString().slice(0, 10),
  customerName: '',
  mobileNumber: '',
  customerAddress: '',
  customerEmail: '',
  modelName: '',
  trimDescription: '',
  fuelType: 'PETROL',
  vehicleColor: '',
  bankName: '',
  bankBranch: '',
  vehicleStatus: 'IN HOUSE',
  loanAmount: '',
  insuranceCompany: '',
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

const TABLE_COLUMNS: { key: keyof KiaProformaRow | 'index'; label: string; numeric?: boolean }[] = [
  { key: 'index', label: '#' },
  { key: 'entryTime', label: 'Entry Time' },
  { key: 'proformaDate', label: 'Proforma Date' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'mobileNumber', label: 'Mobile Number' },
  { key: 'customerAddress', label: 'Customer Address' },
  { key: 'customerEmail', label: 'Customer Email' },
  { key: 'modelName', label: 'Model Name' },
  { key: 'trimDescription', label: 'Trim Description' },
  { key: 'bankName', label: 'Bank Name' },
  { key: 'bankBranch', label: 'Bank Branch' },
  { key: 'fuelType', label: 'Fuel Type' },
  { key: 'vehicleColor', label: 'Vehicle Color' },
  { key: 'exShowroom', label: 'Ex Showroom', numeric: true },
  { key: 'tcsValue', label: 'TCS Value', numeric: true },
  { key: 'registrationCharges', label: 'Registration Charges', numeric: true },
  { key: 'insuranceValue', label: 'Insurance Value', numeric: true },
  { key: 'insuranceCompany', label: 'Insurance Company' },
  { key: 'fastagValue', label: 'Fastag Value', numeric: true },
  { key: 'accessoriesKit', label: 'Accessories Kit', numeric: true },
  { key: 'extWarranty', label: 'Ext Warranty', numeric: true },
  { key: 'cashDiscount', label: 'Cash Discount', numeric: true },
  { key: 'exchangeValue', label: 'Exchange Value', numeric: true },
  { key: 'bookingAmount', label: 'Booking Amount', numeric: true },
  { key: 'govtEmployeeDiscount', label: 'Govt Employee Discount', numeric: true },
  { key: 'additionalDiscount', label: 'Additional Discount', numeric: true },
  { key: 'totalCustomerCost', label: 'Total Customer Cost', numeric: true },
  { key: 'grandTotalCost', label: 'Grand Total Cost', numeric: true },
  { key: 'loginEmail', label: 'Login Email' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'location', label: 'Location' },
  { key: 'empCode', label: 'Emp Code' },
  { key: 'approvalStatus', label: 'Approval Status' },
]

const CHART_COLORS = ['#8a1552', '#2563eb', '#f59e0b', '#ef4444', '#14b8a6', '#64748b', '#7c3aed']
const proformaPrimaryButton = 'kia-proforma-primary-action'
const proformaOutlineButton = 'kia-proforma-outline-action'
const PROFORMA_LIST_PAGE_SIZE = 1000
const PROFORMA_TABLE_PAGE_SIZE = 10

function asNumber(value: unknown) {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: unknown) {
  return `Rs ${Math.round(asNumber(value)).toLocaleString('en-IN')}`
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} IST`
}

function dateKey(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function monthKey(value?: string | null) {
  const key = dateKey(value)
  return key ? key.slice(0, 7) : ''
}

function monthLabel(value: string) {
  const date = new Date(`${value}-01T00:00:00+05:30`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

function yearKey(value?: string | null) {
  return dateKey(value).slice(0, 4)
}

// The stored `location` is a mix of dealer codes (JK402/JK501) and city names
// (JAMMU/UDHAMPUR), plus legacy sentinels ("all"/"kia"). Normalize to the branch
// city: JK501/Udhampur -> Udhampur; everything else (JK402, Jammu, all, null) ->
// Jammu (the primary dealer). This replaces the raw "All" shown before.
function formatKiaLocation(value?: string | null) {
  const v = String(value || '').trim().toUpperCase()
  if (v === 'JK501' || v.startsWith('UDHAMPUR')) return 'Udhampur'
  return 'Jammu'
}

function proformaColumnValue(row: KiaProformaRow, column: string) {
  if (column === 'index') return ''
  const value = row[column as keyof KiaProformaRow]
  if (column === 'entryTime') return formatDateTime(String(value || ''))
  if (column === 'proformaDate' || column === 'financeUpdatedTime') return formatDate(String(value || ''))
  if (column === 'location') return formatKiaLocation(value as string | null)
  return String(value ?? '-')
}

function approvalTone(value?: string | null): Tone {
  const status = String(value || '').toLowerCase()
  if (status.includes('approved') && !status.includes('not')) return 'emerald'
  if (status.includes('not') || status.includes('cancel') || status.includes('decline')) return 'rose'
  if (status.includes('converted')) return 'blue'
  return 'amber'
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--kia-text-faint)]">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs font-semibold" style={{ color: 'var(--dashboard-risk-text)' }}>{error}</span>}
    </label>
  )
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <Input {...props} className={cn('h-11 rounded-xl font-semibold', props.className)} />
}

function DataListInput({
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  listId,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  options: string[]
  placeholder?: string
  listId: string
  disabled?: boolean
}) {
  const uniqueOptions = useMemo(() => {
    const seen = new Set<string>()
    return options.filter((option) => {
      const normalized = option.trim().toLowerCase()
      if (!normalized || seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
  }, [options])

  return (
    <>
      <TextInput list={listId} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} placeholder={placeholder} disabled={disabled} />
      <datalist id={listId}>
        {uniqueOptions.map((option) => <option key={`${listId}-${option}`} value={option} />)}
      </datalist>
    </>
  )
}

function FormSection({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: typeof ClipboardList; children: React.ReactNode }) {
  return (
    <div className="kia-surface p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-3 border-b pb-3" style={{ borderColor: 'var(--kia-hairline)' }}>
        {icon && <IconTile icon={icon} tone="accent" size="sm" />}
        <div>
          <Kicker>{title}</Kicker>
          {subtitle && <p className="mt-0.5 text-xs font-medium text-[var(--kia-text-soft)]">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

// Backed by React Query (was a raw useEffect fetch with no cache, so EVERY section mount re-hit
// /api/brands/kia/proforma/options — an endpoint that resolves the user profile + the whole price/bank
// master list). Inherits the global 30-min staleTime, so switching sections now costs nothing; the
// payload only changes on a price-details import, and `reload()` still forces a refresh explicitly.
// ONE options query for the whole page. The `lite` param used to fork this into two cache keys
// (['kia-proforma-options', true|false]) — so moving between the 'generate' section (full) and any
// other section (lite) fired a SECOND network fetch that could never hit the first's cache. That
// traded a whole ~36ms invocation to avoid serializing ~2ms of the price array — net negative, and
// the payload is already Redis-cached server-side. One key, fetched once per session.
function useOptions() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['kia-proforma-options'],
    queryFn: async () => {
      const response = await fetch('/api/brands/kia/proforma/options')
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || `Failed to load Kia Proforma options (${response.status})`)
      }
      return (await response.json()) as OptionsPayload
    },
  })
  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['kia-proforma-options'] })
  }, [queryClient])
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : '',
    reload,
  }
}

function useProformas(mode: string, enabled = true) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(timer)
  }, [search])
  const [page, setPage] = useState(1)
  const [financeStatus, setFinanceStatus] = useState('all')

  const queryKey = useMemo(
    () => ['kia-proforma-list', mode, debouncedSearch, financeStatus],
    [mode, debouncedSearch, financeStatus]
  )

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: String(PROFORMA_LIST_PAGE_SIZE), mode })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (financeStatus !== 'all') params.set('financeStatus', financeStatus)
      const response = await fetch(`/api/brands/kia/proforma?${params}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || `Failed to load proformas (${response.status})`)
      }
      return (await response.json()) as { rows: KiaProformaRow[]; pagination: { page: number; totalPages: number; totalRows: number } }
    },
    enabled,
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_GC_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  })

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['kia-proforma-list'] })
  }, [queryClient])

  return {
    rows: query.data?.rows || [],
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : '',
    search,
    setSearch,
    page,
    setPage,
    pagination: query.data?.pagination || { page: 1, totalPages: 1, totalRows: 0 },
    financeStatus,
    setFinanceStatus,
    reload,
  }
}

const PROFORMA_NAV_ITEMS: { section: KiaProformaSection; label: string; href: string; approverOnly?: boolean; hideFromNav?: boolean }[] = [
  { section: 'bookings', label: 'Booking CRM', href: '/brands/kia/proforma/bookings' },
  { section: 'pending-approval', label: 'Pending Proforma', href: '/brands/kia/proforma/pending-approval', approverOnly: true },
  { section: 'stock', label: 'Stock', href: '/brands/kia/proforma/stock' },
  { section: 'generate', label: 'Generate Proforma', href: '/brands/kia/proforma/generate', hideFromNav: true },
  { section: 'all', label: 'Proformas', href: '/brands/kia/proforma/all-proforma-details' },
  { section: 'finance-remarks', label: 'Finance Remarks', href: '/brands/kia/proforma/finance-remarks', hideFromNav: true },
]

function canSeeBookingsNav(role: string) {
  return String(role || '').trim().toLowerCase() !== 'manager'
}

// Sales Executives are limited to the Booking CRM + Generate Proforma only —
// no Stock, All Proforma Details, Finance Remarks, Pending Approval or analytics.
function isKiaSalesPersonOnly(role: string) {
  return String(role || '').trim().toLowerCase() === 'sales_executive'
}

// Finance roles (finance_head / finance_team) now do the final proforma approval from the dedicated
// Finance section (/finance), NOT from the Proforma "Pending Proforma" tab — so exclude them here.
// Stage-1 approvers (sales_manager / general_manager) + MD/admin/developer keep the tab.
function isKiaFinanceApprovalRole(role: string) {
  const r = String(role || '').trim().toLowerCase()
  return r === 'finance_head' || r === 'finance_team'
}

function canAccessKiaSection(section: KiaProformaSection, role: string, isApprover: boolean) {
  if (isKiaSalesPersonOnly(role)) return section === 'bookings' || section === 'generate'
  if (section === 'pending-approval') return isApprover && !isKiaFinanceApprovalRole(role)
  return true
}

function PriceDetailsUploadPanel({ onImported }: { onImported: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [summary, setSummary] = useState<PriceImportSummary | null>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) return

    setUploading(true)
    setError('')
    setSummary(null)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      const response = await fetch('/api/brands/kia/proforma/price-details/upload', {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Failed to import price details')
      
      setSummary(payload.summary)
      if (fileInputRef.current) fileInputRef.current.value = ''
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import price details')
    } finally {
      setUploading(false)
    }
  }

  const triggerFileSelect = () => {
    fileInputRef.current?.click()
  }

  return (
    <section className="kia-surface-flush relative overflow-hidden p-3 sm:p-4">
      <LoaderOverlay show={uploading} variant="proforma" label="Replacing price master…" sublabel="Importing the PRICE DETAILS sheet" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={Upload} tone="accent" />
          <div className="min-w-0">
            <Kicker>Price Master Upload</Kicker>
            <p className="mt-0.5 text-xs font-medium leading-5 text-[var(--kia-text-soft)] sm:text-sm">Imports only the <span className="font-bold text-[var(--kia-text)]">PRICE DETAILS</span> sheet and replaces the current KIA price master.</p>
          </div>
        </div>
        <div className="shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            accept=".xlsx,.xls,.xlsm"
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
          <Button type="button" onClick={triggerFileSelect} disabled={uploading} className="h-11 rounded-2xl px-5 text-[13px] font-bold">
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Replacing…
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Replace Prices
              </>
            )}
          </Button>
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-xl border px-3 py-2 text-xs font-semibold" style={toneSoftStyle('danger')}>
          {error}
        </p>
      )}
      {summary && (
        <div className="mt-3 grid gap-2 rounded-2xl border p-3 text-xs font-semibold md:grid-cols-4" style={toneSoftStyle('success')}>
          <span>Sheet: {summary.sheetName}</span>
          <span>Processed: {summary.totalRowsProcessed}</span>
          <span>Imported: {summary.importedRows}</span>
          <span>Failed: {summary.failedRows} · {(summary.durationMs / 1000).toFixed(1)}s</span>
        </div>
      )}
    </section>
  )
}

function ModuleHeader({
  section,
  profile,
  isApprover,
  currentUserRole,
  onPricesImported,
}: {
  section: KiaProformaSection
  profile?: KiaProfile | null
  isApprover: boolean
  currentUserRole: string
  onPricesImported: () => void
}) {
  const titles: Record<KiaProformaSection, { title: string; subtitle: string; icon: typeof ClipboardList }> = {
    bookings: { title: 'Booking CRM', subtitle: 'Manage customer bookings, stock allocations, and finance workflows.', icon: ClipboardList },
    stock: { title: 'Stock', subtitle: 'Approved bookings, stock matching, VIN reservation, and accounts payment follow-up.', icon: ClipboardList },
    generate: { title: 'Generate Proforma', subtitle: 'Create Kia customer proformas with pricing, discounts, and approval queue.', icon: FileText },
    all: { title: 'Proformas', subtitle: 'Search, filter, audit, and open approved proforma records.', icon: Columns3 },
    'finance-remarks': { title: 'Finance Remarks', subtitle: 'Update finance status and remarks against every proforma.', icon: WalletCards },
    'pending-approval': { title: 'Pending Proforma', subtitle: 'Verify discounts and cost fields before approval.', icon: ShieldCheck },
    analytics: { title: 'Hyp / Ins Analytics', subtitle: 'Pivot view for bank, insurance, and status performance.', icon: BarChart3 },
    insights: { title: 'Business Insights', subtitle: 'Operational charts for approvals, status, address integrity, model and fuel mix.', icon: BarChart3 },
  }
  const current = titles[section]
  const navItems = PROFORMA_NAV_ITEMS
    .filter((item) => !item.hideFromNav && canAccessKiaSection(item.section, currentUserRole, isApprover))
    .filter((item) => item.section !== 'bookings' || canSeeBookingsNav(currentUserRole))
  return (
    <Reveal>
      <section className="kia-surface relative overflow-hidden p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--dashboard-action-bg) 16%, transparent), transparent 70%)' }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <IconTile icon={current.icon} tone="accent" size="lg" />
            <div>
              <Kicker>Kia Proforma</Kicker>
              <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-[var(--kia-text)]">{current.title}</h1>
              <p className="mt-1 max-w-3xl text-sm font-medium text-[var(--kia-text-soft)]">{current.subtitle}</p>
            </div>
          </div>
        </div>
        <nav className="kia-segment relative mt-5 flex gap-1 overflow-x-auto p-1">
          {navItems.map((item) => {
            const activeTab = item.section === section
            return (
              <Link
                key={item.section}
                href={item.href}
                // prefetch={false}: these tabs sit above the fold, so the default auto-prefetch
                // fires an RSC request for EVERY tab on EVERY page load — 3-4 server invocations
                // before the user clicks anything. The target is dynamic (it reads cookies via the
                // auth guard) so nothing is cacheable and the prefetch buys no speed, only Vercel
                // Fluid invocations. Same call the sidebar already made — see
                // components/layout/sidebar-cascading-nav.tsx.
                prefetch={false}
                className="relative shrink-0 rounded-xl px-4 py-2 text-xs font-bold transition-colors"
                style={{ color: activeTab ? 'var(--dashboard-action-fg)' : 'var(--kia-text-soft)' }}
              >
                {activeTab && (
                  <motion.span
                    layoutId="proforma-nav-pill"
                    className="absolute inset-0 rounded-xl"
                    style={{ background: 'linear-gradient(135deg, var(--dashboard-action-hover), var(--dashboard-action-bg))', boxShadow: 'var(--kia-elev-2)' }}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </section>
    </Reveal>
  )
}

type BookingPrefill = {
  bookingId: string
  bookingNumber?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  model?: string
  variant?: string
  color?: string
  consultantName?: string
  bankName?: string | null
  bankBranch?: string | null
  bookingAmount?: string | null
  /** True when the booking is a CASH payment (no bank finance) — bank/branch are then optional. */
  isCash?: boolean
}

function GenerateProforma({ options, onSaved, bookingPrefill }: { options: OptionsPayload; onSaved: () => void; bookingPrefill?: BookingPrefill | null }) {
  const [form, setForm] = useState<FormState>(() => {
    if (!bookingPrefill) return EMPTY_FORM
    // Map booking fields to proforma FormState
    const prefilled: FormState = {
      ...EMPTY_FORM,
      customerName: bookingPrefill.customerName || '',
      mobileNumber: (bookingPrefill.customerPhone || '').replace(/\D/g, '').slice(0, 10),
      customerEmail: bookingPrefill.customerEmail || '',
      modelName: bookingPrefill.model || '',
      trimDescription: bookingPrefill.variant || '',
      vehicleColor: bookingPrefill.color || '',
      bankName: bookingPrefill.bankName || '',
      bankBranch: bookingPrefill.bankBranch || '',
      bookingAmount: bookingPrefill.bookingAmount || '',
    }
    return prefilled
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  // Pending duplicate data returned from the server — used to show the warning dialog.
  const [duplicateWarning, setDuplicateWarning] = useState<{
    existingId: string
    existingDate: string | null
    customerName: string
    matchedOn: string
  } | null>(null)
  const editablePrices = form.customerType === 'CSD' || form.customerType === 'Bharat Series'
  const filteredTrims = useMemo(() => {
    return options.trims.filter((trim) => !form.modelName || trim.model === form.modelName).map((trim) => trim.trim_description)
  }, [form.modelName, options.trims])
  const pricing = useMemo(() => {
    return calculateKiaProformaPricing(form, options.prices, options.banks)
  }, [form, options.banks, options.prices])
  const filteredBranches = pricing.branchOptions
  const bankOptions = useMemo(() => getKiaBankOptions(options.banks), [options.banks])
  // CASH bookings (or an explicit CASH bank) don't require bank/branch on the proforma.
  const isCashPayment = Boolean(bookingPrefill?.isCash) || form.bankName.trim().toUpperCase() === 'CASH'
  const prefillExShowroom = pricing.prefill?.exShowroom
  const prefillTcsValue = pricing.prefill?.tcsValue
  const prefillRegistrationCharges = pricing.prefill?.registrationCharges
  const prefillInsuranceValue = pricing.prefill?.insuranceValue
  const prefillFastagValue = pricing.prefill?.fastagValue
  const prefillAccessoriesKit = pricing.prefill?.accessoriesKit
  const prefillExtWarranty = pricing.prefill?.extWarranty
  const prefillInsuranceCompany = pricing.prefill?.insuranceCompany
  const stablePrefill = useMemo(() => (
    prefillExShowroom === undefined
      ? null
      : {
          exShowroom: prefillExShowroom,
          tcsValue: prefillTcsValue || '0',
          registrationCharges: prefillRegistrationCharges || '0',
          insuranceValue: prefillInsuranceValue || '0',
          fastagValue: prefillFastagValue || '0',
          accessoriesKit: prefillAccessoriesKit || '0',
          extWarranty: prefillExtWarranty || '0',
          insuranceCompany: prefillInsuranceCompany || '',
        }
  ), [
    prefillAccessoriesKit,
    prefillExShowroom,
    prefillExtWarranty,
    prefillFastagValue,
    prefillInsuranceCompany,
    prefillInsuranceValue,
    prefillRegistrationCharges,
    prefillTcsValue,
  ])
  const lockedFields = useMemo(() => ({
    customerName: Boolean(bookingPrefill?.customerName),
    mobileNumber: Boolean(bookingPrefill?.customerPhone),
    customerEmail: Boolean(bookingPrefill?.customerEmail),
    modelName: Boolean(bookingPrefill?.model),
    trimDescription: Boolean(bookingPrefill?.variant),
    vehicleColor: Boolean(bookingPrefill?.color),
    bankName: false,
    bankBranch: false,
    bookingAmount: Boolean(bookingPrefill?.bookingAmount),
    insuranceCompany: Boolean(prefillInsuranceCompany),
  }), [bookingPrefill, prefillInsuranceCompany])

  useEffect(() => {
    const prefill = stablePrefill
    if (!prefill) return
    setForm((current) => {
      const next = {
        ...current,
        exShowroom: prefill.exShowroom,
        tcsValue: prefill.tcsValue,
        registrationCharges: prefill.registrationCharges,
        insuranceValue: prefill.insuranceValue,
        fastagValue: prefill.fastagValue,
        accessoriesKit: prefill.accessoriesKit,
        extWarranty: prefill.extWarranty,
        insuranceCompany: prefill.insuranceCompany,
      }
      return Object.keys(next).every((key) => next[key as keyof FormState] === current[key as keyof FormState])
        ? current
        : next
    })
  }, [stablePrefill])

  const totals = pricing.totals

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function canonicalizeTrim() {
    setForm((current) => {
      const result = calculateKiaProformaPricing(current, options.prices, options.banks)
      if (!result.canonicalTrim || current.trimDescription === result.canonicalTrim) return current
      return { ...current, trimDescription: result.canonicalTrim, modelName: result.price?.model || current.modelName }
    })
  }

  function canonicalizeBank() {
    setForm((current) => {
      const result = calculateKiaProformaPricing(current, options.prices, options.banks)
      if (!current.bankName.trim()) return current
      if (!result.bankIsValid) return { ...current, bankName: '', bankBranch: '' }
      return {
        ...current,
        bankName: result.canonicalBank,
        bankBranch: result.branchIsValid ? current.bankBranch : '',
      }
    })
  }

  function canonicalizeBranch() {
    setForm((current) => {
      const result = calculateKiaProformaPricing(current, options.prices, options.banks)
      if (!current.bankBranch.trim()) return current
      // Manual entry is allowed: a typed branch that isn't in the DB list is KEPT as-is. Only snap
      // to the canonical spelling when it matches a known branch for the selected bank.
      if (!result.branchIsValid) return current
      return { ...current, bankBranch: result.canonicalBranch }
    })
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!form.customerName.trim()) next.customerName = 'Customer name is required'
    if (!/^\d{10}$/.test(form.mobileNumber)) next.mobileNumber = 'Mobile number must be 10 digits'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail)) next.customerEmail = 'Valid email is required'
    const requiredKeys: (keyof FormState)[] = ['customerAddress', 'modelName', 'trimDescription', 'fuelType', 'vehicleColor', 'vehicleStatus']
    // Bank and Branch are required only for finance bookings; a CASH payment leaves bank + branch optional.
    if (!isCashPayment) {
      requiredKeys.push('bankName')
      requiredKeys.push('bankBranch')
    }
    requiredKeys.forEach((key) => {
      if (!String(form[key] || '').trim()) next[key] = 'Required'
    })
    if (form.trimDescription.trim() && !pricing.trimIsValid) next.trimDescription = 'Select a valid trim'
    if (form.bankName.trim() && !pricing.bankIsValid) next.bankName = 'Select a valid bank'
    // Bank Branch accepts manual entry (not restricted to the DB dropdown), so no validity gate here.
    if (Number(form.insuranceValue || 0) < 3000) next.insuranceValue = 'Value must be greater than 3000'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const router = useRouter()

  async function submit(forceSave = false) {
    if (!validate()) return
    // A negative grand total means discounts exceed the price — never save it.
    if (asNumber(totals.grandTotalCost) < 0) {
      toast({
        title: 'Invalid Grand Total',
        description: 'Grand Total is negative — discounts/deductions exceed the vehicle price. Adjust the values before saving.',
        variant: 'error',
      })
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        totalCustomerCost: totals.totalCustomerCost,
        grandTotalCost: totals.grandTotalCost,
        bookingId: bookingPrefill?.bookingId || undefined,
        paymentMode: isCashPayment ? 'cash' : 'finance',
        forceSave,
      }
      const response = await fetch('/api/brands/kia/proforma', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      // Duplicate found — surface warning dialog instead of throwing.
      if (response.status === 409) {
        const dup = await response.json().catch(() => null) as {
          duplicate?: boolean
          existingId?: string
          existingDate?: string
          customerName?: string
          matchedOn?: string
        } | null
        if (dup?.duplicate) {
          setDuplicateWarning({
            existingId: dup.existingId || '',
            existingDate: dup.existingDate || null,
            customerName: dup.customerName || form.customerName,
            matchedOn: dup.matchedOn || 'details',
          })
          return
        }
      }
      if (!response.ok) throw new Error('Failed to save proforma')
      const saved = await response.json().catch(() => null) as { row?: { id?: string } } | null
      setForm(EMPTY_FORM)
      onSaved()
      toast({ title: 'Proforma Saved', description: 'Proforma saved and sent to approval queue.', variant: 'success' })
      if (bookingPrefill && saved?.row?.id) {
        router.push(`/brands/kia/proforma/all-proforma-details?search=${String(saved.row.id).slice(0, 8).toUpperCase()}`)
      } else if (bookingPrefill) {
        router.push(`/brands/kia/proforma/all-proforma-details?search=${bookingPrefill.bookingNumber || bookingPrefill.customerName || ''}`)
      }
    } catch (error) {
      toast({ title: 'Save Failed', description: error instanceof Error ? error.message : 'Failed to save proforma', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }


  return (
    <section className="kia-surface relative overflow-hidden p-5">
      <LoaderOverlay show={saving} variant="proforma" label="Preparing proforma…" sublabel="Calculating pricing and queuing for approval" />
      {bookingPrefill && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border px-4 py-3" style={toneSoftStyle('info')}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white" style={{ background: 'var(--dashboard-support-1)' }}>
            <ArrowLeft className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em]">Pre-filled from Booking</p>
            <p className="mt-0.5 text-sm font-semibold">
              {bookingPrefill.bookingNumber ? `#${bookingPrefill.bookingNumber} · ` : ''}{bookingPrefill.customerName || 'Customer'} · {bookingPrefill.model || 'Vehicle'}
            </p>
            <p className="mt-0.5 text-xs font-medium opacity-80">Review the pre-filled fields, complete any missing information, then save the proforma.</p>
          </div>
        </div>
      )}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <Kicker>Customer Proforma</Kicker>
          <h2 className="mt-0.5 text-xl font-extrabold tracking-tight text-[var(--kia-text)]">Pricing and customer details</h2>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => void submit()} disabled={saving} className="h-11 rounded-xl px-5 font-bold">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Proforma
          </Button>
        </div>
      </div>

      {/* ── Duplicate Warning Dialog ────────────────────────────────────── */}
      <Dialog open={!!duplicateWarning} onOpenChange={(open) => { if (!open) setDuplicateWarning(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Duplicate Proforma Detected
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm">
              A proforma already exists for <strong>{duplicateWarning?.customerName}</strong> matched on <strong>{duplicateWarning?.matchedOn}</strong>.
              {duplicateWarning?.existingId && (
                <span className="mt-1 block text-xs text-slate-500">
                  Existing Proforma ID: <code className="rounded bg-slate-100 px-1 font-mono text-xs">{duplicateWarning.existingId.slice(0, 8).toUpperCase()}</code>
                  {duplicateWarning.existingDate && (
                    <> · {new Date(duplicateWarning.existingDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</>
                  )}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setDuplicateWarning(null)}>Cancel</Button>
            <Button
              className="rounded-xl bg-amber-600 text-white hover:bg-amber-700"
              onClick={() => {
                setDuplicateWarning(null)
                void submit(true)
              }}
            >
              Save Anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <FormSection title="Customer Details" subtitle="">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Customer Type"><Select value={form.customerType} onValueChange={(value) => update('customerType', value)}><SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue /></SelectTrigger><SelectContent>{['Customer', 'CSD', 'Bharat Series'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Proforma Date"><TextInput type="date" value={form.proformaDate} onChange={(event) => update('proformaDate', event.target.value)} /></Field>
            <Field label="Customer Name" error={errors.customerName}><TextInput value={form.customerName} onChange={(event) => update('customerName', event.target.value)} readOnly={lockedFields.customerName} /></Field>
            <Field label="Mobile Number" error={errors.mobileNumber}><TextInput inputMode="numeric" maxLength={10} value={form.mobileNumber} onChange={(event) => update('mobileNumber', event.target.value.replace(/\D/g, '').slice(0, 10))} readOnly={lockedFields.mobileNumber} /></Field>
            <Field label="Customer Email" error={errors.customerEmail}><TextInput type="email" value={form.customerEmail} onChange={(event) => update('customerEmail', event.target.value)} readOnly={lockedFields.customerEmail} /></Field>
            <div className="md:col-span-2">
              <Field label="Customer Address" error={errors.customerAddress}><Textarea value={form.customerAddress} onChange={(event) => update('customerAddress', event.target.value)} className="min-h-20 rounded-xl border-[var(--dashboard-primary-border)] bg-white font-semibold shadow-sm focus:border-[var(--dashboard-primary-light)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--dashboard-primary-light)_18%,transparent)]" /></Field>
            </div>
          </div>
        </FormSection>

        <FormSection title="Vehicle & Bank Insurance" subtitle="">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Model" error={errors.modelName}><DataListInput listId="kia-models" value={form.modelName} onChange={(value) => { update('modelName', value); update('trimDescription', '') }} options={options.models} disabled={lockedFields.modelName} /></Field>
            <Field label="Variant / Trim" error={errors.trimDescription}><DataListInput listId="kia-trims" value={form.trimDescription} onChange={(value) => update('trimDescription', value)} onBlur={canonicalizeTrim} options={filteredTrims} disabled={lockedFields.trimDescription} /></Field>
            <Field label="Vehicle Color" error={errors.vehicleColor}><TextInput value={form.vehicleColor} onChange={(event) => update('vehicleColor', event.target.value)} readOnly={lockedFields.vehicleColor} /></Field>
            <Field label="Fuel Type"><Select value={form.fuelType} onValueChange={(value) => update('fuelType', value)}><SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue /></SelectTrigger><SelectContent>{['DIESEL', 'PETROL', 'ELECTRIC'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Bank" error={errors.bankName}><DataListInput listId="kia-banks" value={form.bankName} onChange={(value) => setForm((current) => ({ ...current, bankName: value, bankBranch: '', loanAmount: value.toUpperCase() === 'CASH' ? '0' : current.loanAmount }))} onBlur={canonicalizeBank} options={bankOptions} disabled={lockedFields.bankName} /></Field>
            {form.bankName && form.bankName.toUpperCase() !== 'CASH' && (
              <Field label="Bank Branch" error={errors.bankBranch}><DataListInput listId="kia-bank-branches" value={form.bankBranch} onChange={(value) => update('bankBranch', value)} onBlur={canonicalizeBranch} options={filteredBranches} disabled={lockedFields.bankBranch} /></Field>
            )}
            {/* Loan Amount is disabled for CASH payments (nothing is financed). */}
            <Field label="Loan Amount"><TextInput type="number" value={form.loanAmount} disabled={form.bankName.toUpperCase() === 'CASH'} onChange={(event) => update('loanAmount', event.target.value)} /></Field>
            <Field label="Insurance Company"><DataListInput listId="kia-insurance" value={form.insuranceCompany} onChange={(value) => update('insuranceCompany', value)} options={options.insuranceCompanies} disabled={lockedFields.insuranceCompany} /></Field>
            <Field label="Vehicle Status"><Select value={form.vehicleStatus} onValueChange={(value) => update('vehicleStatus', value)}><SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue /></SelectTrigger><SelectContent>{['IN HOUSE', 'OUT HOUSE'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
          </div>
        </FormSection>

        <FormSection title="Price Details" subtitle={pricing.price ? `Auto-fetched from price sheet · ${pricing.canonicalTrim || form.trimDescription}` : 'No matching price in the sheet — enter values manually'}>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ['exShowroom', 'Ex-Showroom'],
              ['tcsValue', 'TCS'],
              ['registrationCharges', 'RTO / Registration'],
              ['insuranceValue', 'Insurance'],
              ['fastagValue', 'Fastag / Number Plate'],
              ['accessoriesKit', 'Accessories'],
              ['extWarranty', 'Extended Warranty'],
            ].map(([key, label]) => (
              <Field key={key} label={key === 'insuranceValue' ? `${label} (editable)` : label} error={errors[key]}>
                {/* Auto-fetched from the price sheet by model + variant and locked. Editable only
                    for CSD / Bharat Series, as a fallback when the DB has no matching price row
                    (so the form is never a dead-end), or for Insurance — which is quote-dependent
                    and can always be overridden manually. */}
                <TextInput type="number" value={form[key as keyof FormState]} disabled={key !== 'insuranceValue' && !editablePrices && Boolean(pricing.price)} onChange={(event) => update(key as keyof FormState, event.target.value)} />
              </Field>
            ))}
          </div>
        </FormSection>

        <FormSection title="Discounts & Deductions" subtitle="">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ['cashDiscount', 'Consumer / Cash Offer'],
              ['exchangeValue', 'Exchange Bonus'],
              ['bookingAmount', 'Booking Amount'],
              ['govtEmployeeDiscount', 'Corporate / Govt Discount'],
              ['additionalDiscount', 'Dealer / Additional Adjustment'],
            ].map(([key, label]) => (
              <Field key={key} label={label}><TextInput type="number" value={form[key as keyof FormState]} onChange={(event) => update(key as keyof FormState, event.target.value)} readOnly={key === 'bookingAmount' && lockedFields.bookingAmount} /></Field>
            ))}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="kia-surface-sunken p-4">
              <Kicker>To Be Borne By Customer</Kicker>
              <p className="mt-2 text-2xl font-extrabold tracking-tight text-[var(--kia-text)]">
                <AnimatedNumber value={asNumber(totals.totalCustomerCost)} format={(v) => formatCurrency(v)} />
              </p>
            </div>
            <div className="rounded-2xl border p-4" style={{ backgroundColor: 'color-mix(in srgb, var(--dashboard-action-bg) 8%, var(--kia-surface))', borderColor: 'color-mix(in srgb, var(--dashboard-action-bg) 30%, transparent)' }}>
              <p className="kia-kicker">Grand Total</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight text-[var(--kia-text)]">
                <AnimatedNumber value={asNumber(totals.grandTotalCost)} format={(v) => formatCurrency(v)} />
              </p>
            </div>
          </div>
        </FormSection>
        </div>
    </section>
  )
}

function FilterBar({
  rows,
  search,
  setSearch,
  mode,
  selectedColumn,
  setSelectedColumn,
  selectedValues,
  setSelectedValues,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  financeDate,
  setFinanceDate,
  bankFilter,
  setBankFilter,
  financeStatus,
  onClear,
}: {
  rows: KiaProformaRow[]
  search: string
  setSearch: (value: string) => void
  mode: 'all' | 'finance-remarks' | 'pending-approval'
  selectedColumn: string
  setSelectedColumn: (value: string) => void
  selectedValues: Set<string>
  setSelectedValues: (value: Set<string>) => void
  startDate: string
  setStartDate: (value: string) => void
  endDate: string
  setEndDate: (value: string) => void
  financeDate?: string
  setFinanceDate?: (value: string) => void
  bankFilter?: string
  setBankFilter?: (value: string) => void
  financeStatus?: string
  onClear: () => void
}) {
  const values = useMemo(() => {
    if (!selectedColumn) return []
    return Array.from(new Set(rows.map((row) => proformaColumnValue(row, selectedColumn) || '-'))).sort()
  }, [rows, selectedColumn])
  const banks = useMemo(() => Array.from(new Set(rows.map((row) => row.bankName).filter(Boolean))).sort(), [rows])
  const toggleSet = (set: Set<string>, value: string, setter: (value: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  // Local state for calendar picker view and pending selections
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [monthPickerView, setMonthPickerView] = useState(() => new Date())
  const [pendingStartDate, setPendingStartDate] = useState(startDate)
  const [pendingEndDate, setPendingEndDate] = useState(endDate)

  // Sync pending selection when parent values change (e.g. on clear)
  useEffect(() => {
    setPendingStartDate(startDate)
    setPendingEndDate(endDate)
  }, [startDate, endDate])

  const today = new Date()
  const todayMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const todayDateKey = `${todayMonthKey}-${String(today.getDate()).padStart(2, '0')}`

  const monthPickerViewLabel = monthPickerView.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  
  const monthPickerGridStart = (() => {
    const monthStart = new Date(monthPickerView.getFullYear(), monthPickerView.getMonth(), 1)
    const gridStart = new Date(monthStart)
    gridStart.setDate(monthStart.getDate() - monthStart.getDay())
    return gridStart
  })()
  
  const monthPickerDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(monthPickerGridStart)
    date.setDate(monthPickerGridStart.getDate() + index)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return {
      date,
      dateKey: `${monthKey}-${String(date.getDate()).padStart(2, '0')}`,
      monthKey,
      inCurrentMonth: date.getMonth() === monthPickerView.getMonth(),
      isAvailable: true,
    }
  })

  const hasCompleteCustomRange = startDate && endDate
  const customRangeLabel = startDate && endDate 
    ? (startDate === endDate ? formatDate(startDate) : `${formatDate(startDate)} - ${formatDate(endDate)}`) 
    : null

  const selectedRangeStart = hasCompleteCustomRange && startDate <= endDate ? startDate : endDate
  const selectedRangeEnd = hasCompleteCustomRange && startDate <= endDate ? endDate : startDate

  function handleCalendarDateClick(dateKey: string) {
    if (!pendingStartDate || (pendingStartDate && pendingEndDate)) {
      setPendingStartDate(dateKey)
      setPendingEndDate('')
    } else {
      const start = pendingStartDate <= dateKey ? pendingStartDate : dateKey
      const end = pendingStartDate <= dateKey ? dateKey : pendingStartDate
      setPendingStartDate(start)
      setPendingEndDate(end)
    }
  }

  function applyCustomDateRange() {
    if (pendingStartDate && pendingEndDate) {
      setStartDate(pendingStartDate)
      setEndDate(pendingEndDate)
      setMonthPickerOpen(false)
    }
  }

  function clearCustomDateRange() {
    setPendingStartDate('')
    setPendingEndDate('')
    setStartDate('')
    setEndDate('')
    setMonthPickerOpen(false)
  }

  return (
    <div className="kia-surface space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kia-text-faint)]" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={mode === 'pending-approval' ? 'Search customer name or mobile number...' : 'Search customer, bank, insurance, mobile, branch, model, email...'} className="h-11 rounded-2xl border-slate-200 bg-white pl-10 font-semibold" />
        </div>
        {mode === 'finance-remarks' && setFinanceDate && (
          <Input type="date" value={financeDate || ''} onChange={(event) => setFinanceDate(event.target.value)} className="h-11 w-44 rounded-2xl border-slate-200 bg-white font-bold" />
        )}
        
        {true && (
          <DropdownMenu
            open={monthPickerOpen}
            onOpenChange={(open) => {
              setMonthPickerOpen(open)
              if (open) {
                setPendingStartDate(startDate)
                setPendingEndDate(endDate)
                const anchorDate = endDate || startDate
                const parsedAnchor = anchorDate ? new Date(`${anchorDate}T00:00:00`) : null
                setMonthPickerView(new Date(
                  parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
                    ? parsedAnchor.getFullYear()
                    : today.getFullYear(),
                  parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
                    ? parsedAnchor.getMonth()
                    : today.getMonth(),
                  1,
                ))
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className={cn('h-11 justify-between rounded-2xl border-slate-200 bg-white px-4 text-xs font-black shadow-sm text-slate-800 hover:bg-slate-50 min-w-[200px]', proformaOutlineButton)}>
                <span className="inline-flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-slate-400" />
                  {customRangeLabel || 'All Dates'}
                </span>
                <ChevronDown className="ml-1 h-4 w-4 text-slate-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[340px] rounded-[1.5rem] border border-[#d8e2ec] bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)] z-50">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-[#c8102e]/35 hover:text-[#c8102e]"
                    onClick={() => setMonthPickerView((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="text-center">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Select date range</p>
                    <p className="mt-1 text-[15px] font-black text-slate-950">{monthPickerViewLabel}</p>
                  </div>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-[#c8102e]/35 hover:text-[#c8102e]"
                    onClick={() => setMonthPickerView((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                    <div key={`${day}-${index}`} className="py-1">{day}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {monthPickerDays.map((day) => {
                    const hasPendingRange = pendingStartDate && pendingEndDate
                    const pendingRangeStart = hasPendingRange && pendingStartDate <= pendingEndDate ? pendingStartDate : pendingEndDate
                    const pendingRangeEnd = hasPendingRange && pendingStartDate <= pendingEndDate ? pendingEndDate : pendingStartDate
                    
                    const isSelected = hasPendingRange
                      ? day.dateKey === pendingRangeStart || day.dateKey === pendingRangeEnd
                      : !hasCompleteCustomRange
                        ? day.dateKey === pendingStartDate
                        : day.dateKey === selectedRangeStart || day.dateKey === selectedRangeEnd
                    
                    const isInSelectedRange = hasPendingRange
                      ? day.dateKey > pendingRangeStart && day.dateKey < pendingRangeEnd
                      : hasCompleteCustomRange && day.dateKey > selectedRangeStart && day.dateKey < selectedRangeEnd
                    
                    const isToday = day.dateKey === todayDateKey
                    
                    return (
                      <button
                        key={day.dateKey}
                        type="button"
                        className={cn(
                          'flex h-10 items-center justify-center rounded-xl text-[12px] font-black transition',
                          day.inCurrentMonth ? 'text-slate-700' : 'text-slate-300',
                          'hover:bg-slate-100 hover:text-slate-900',
                          isInSelectedRange && 'bg-red-50 text-[#c8102e]',
                          isToday && 'ring-2 ring-[#c8102e]/50 ring-offset-2',
                          isSelected && 'bg-[#c8102e] text-white shadow-[0_10px_18px_rgba(200,16,46,0.18)] hover:bg-[#c8102e] hover:text-white'
                        )}
                        onClick={() => handleCalendarDateClick(day.dateKey)}
                      >
                        {day.date.getDate()}
                      </button>
                    )
                  })}
                </div>

                <div className="space-y-2">
                  <div className="rounded-[1.1rem] border border-slate-100 bg-slate-50/50 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                      {pendingStartDate && !pendingEndDate ? 'Pick end date' : 'Date range'}
                    </p>
                    <p className="mt-1 text-[13px] font-semibold text-slate-700">
                      {pendingStartDate && pendingEndDate
                        ? `${formatDate(pendingStartDate)} – ${formatDate(pendingEndDate)}`
                        : pendingStartDate
                          ? `Start: ${formatDate(pendingStartDate)}`
                          : 'Click a start day, then an end day.'}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 rounded-full border px-3 py-1 text-[11px] font-black shadow-none border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      onClick={() => {
                        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
                        setPendingStartDate(todayStr)
                        setPendingEndDate(todayStr)
                      }}
                    >
                      Today
                    </Button>
                    {(pendingStartDate || pendingEndDate || startDate || endDate) && (
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full border border-rose-200 bg-white px-3 py-1 text-[11px] font-black text-rose-500 shadow-none hover:bg-rose-50"
                        onClick={clearCustomDateRange}
                      >
                        Clear
                      </Button>
                    )}
                    <Button
                      type="button"
                      disabled={!(pendingStartDate && pendingEndDate)}
                      className={cn(
                        'rounded-full px-4 py-1 text-[11px] font-black shadow-none',
                        pendingStartDate && pendingEndDate
                          ? 'bg-[#c8102e] text-white hover:bg-red-700'
                          : 'cursor-not-allowed bg-slate-200 text-slate-400'
                      )}
                      onClick={applyCustomDateRange}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Select value={selectedColumn || 'none'} onValueChange={(value) => { setSelectedColumn(value === 'none' ? '' : value); setSelectedValues(new Set()) }}>
          <SelectTrigger className={cn('h-11 w-56 rounded-2xl', proformaOutlineButton)}><Filter className="mr-2 h-4 w-4" /><SelectValue placeholder="Filter By Column" /></SelectTrigger>
          <SelectContent>{[{ key: 'none', label: 'Filter By Column' }, ...TABLE_COLUMNS.filter((col) => col.key !== 'index')].map((col) => <SelectItem key={String(col.key)} value={String(col.key)}>{col.label}</SelectItem>)}</SelectContent>
        </Select>
        {mode === 'finance-remarks' && financeStatus === 'Current month' && setBankFilter && (
          <Select value={bankFilter || 'all'} onValueChange={(value) => setBankFilter(value === 'all' ? '' : value)}>
            <SelectTrigger className={cn('h-11 w-52 rounded-2xl', proformaOutlineButton)}><SelectValue placeholder="Bank Name" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Banks</SelectItem>{banks.map((bank) => <SelectItem key={bank} value={bank}>{bank}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Button variant="outline" className={cn('h-11 rounded-2xl', proformaOutlineButton)} onClick={onClear}>
          <RotateCcw className="mr-2 h-4 w-4" />Clear All
        </Button>
      </div>
      {selectedColumn && <ChecklistPanel title="Column values" items={values.map((value) => ({ value, label: value }))} selected={selectedValues} onToggle={(value) => toggleSet(selectedValues, value, setSelectedValues)} />}
    </div>
  )
}

function ChecklistPanel({ title, items, selected, onToggle }: { title: string; items: { value: string; label: string }[]; selected: Set<string>; onToggle: (value: string) => void }) {
  return (
    <div className="max-h-32 overflow-auto rounded-2xl border p-2" style={{ borderColor: 'var(--kia-hairline)', backgroundColor: 'var(--kia-surface)' }}>
      <p className="px-2 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--kia-text-faint)]">{title}</p>
      {items.length === 0 ? <p className="px-2 py-1 text-xs font-semibold text-[var(--kia-text-faint)]">No values</p> : items.map((item) => (
        <label key={item.value} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--kia-text-soft)] hover:bg-[var(--kia-surface-sunken)]">
          <Checkbox checked={selected.has(item.value)} onCheckedChange={() => onToggle(item.value)} />
          {item.label}
        </label>
      ))}
    </div>
  )
}

function ProformaTable({
  rows,
  hiddenColumns,
  setHiddenColumns,
  extra,
  action,
  hideEmptyColumns = false,
  onRowClick,
  canViewPii = false,
}: {
  rows: KiaProformaRow[]
  hiddenColumns: Set<string>
  setHiddenColumns: (value: Set<string>) => void
  extra?: (row: KiaProformaRow) => React.ReactNode
  action?: (row: KiaProformaRow) => React.ReactNode
  hideEmptyColumns?: boolean
  onRowClick?: (row: KiaProformaRow) => void
  canViewPii?: boolean
}) {
  const [showColumnManager, setShowColumnManager] = useState(false)
  const visibleColumns = TABLE_COLUMNS.filter((column) => {
    if (hiddenColumns.has(String(column.key))) return false
    if (!hideEmptyColumns || column.key === 'index' || column.key === 'customerName') return true
    return rows.some((row) => {
      const value = row[column.key as keyof KiaProformaRow]
      return value !== null && value !== undefined && String(value).trim() !== ''
    })
  })
  // Freeze the index + customer columns only from `sm` up. On mobile the table
  // scrolls normally with no sticky columns (per product requirement).
  const stickyClass = (key: string) => {
    if (key === 'index') return 'w-12 min-w-12 sm:sticky sm:left-0 sm:z-20'
    if (key === 'customerName') return 'min-w-[190px] sm:sticky sm:left-12 sm:z-20 sm:shadow-[8px_0_14px_rgba(15,23,42,0.05)]'
    return ''
  }
  const stickyBg = (key: string): React.CSSProperties => (key === 'index' || key === 'customerName') ? { backgroundColor: 'var(--kia-surface)' } : {}
  return (
    <div className="kia-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3" style={{ borderColor: 'var(--kia-hairline)' }}>
        <div className="flex items-center gap-3">
          <IconTile icon={Columns3} tone="accent" size="sm" />
          <div>
            <Kicker>Proforma Register</Kicker>
            <p className="text-xs font-semibold text-[var(--kia-text-soft)]">{rows.length} record{rows.length === 1 ? '' : 's'} on this page</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className={cn('h-9 rounded-xl', proformaOutlineButton)} onClick={() => setShowColumnManager((value) => !value)}>
            <Columns3 className="mr-2 h-4 w-4" />Manage Columns
          </Button>
          <Select onValueChange={(value) => {
            const next = new Set(hiddenColumns)
            next.add(value)
            setHiddenColumns(next)
          }}>
            <SelectTrigger className={cn('h-9 w-44 rounded-xl', proformaOutlineButton)}><Columns3 className="mr-2 h-4 w-4" /><SelectValue placeholder="Hide column" /></SelectTrigger>
            <SelectContent>{visibleColumns.filter((col) => col.key !== 'index').map((column) => <SelectItem key={String(column.key)} value={String(column.key)}>{column.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" className={cn('h-9 rounded-xl', proformaOutlineButton)} onClick={() => setHiddenColumns(new Set())}><RotateCcw className="mr-2 h-4 w-4" />Restore</Button>
        </div>
      </div>
      {showColumnManager && (
        <div className="grid max-h-48 gap-2 overflow-auto border-b p-3 sm:grid-cols-2 lg:grid-cols-4" style={{ borderColor: 'var(--kia-hairline)', backgroundColor: 'var(--kia-surface-sunken)' }}>
          {TABLE_COLUMNS.filter((column) => column.key !== 'index').map((column) => {
            const key = String(column.key)
            return (
              <label key={key} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold text-[var(--kia-text-soft)]" style={{ borderColor: 'var(--kia-hairline)', backgroundColor: 'var(--kia-surface)' }}>
                <Checkbox checked={!hiddenColumns.has(key)} onCheckedChange={(checked) => {
                  const next = new Set(hiddenColumns)
                  if (checked) next.delete(key)
                  else next.add(key)
                  setHiddenColumns(next)
                }} />
                {column.label}
              </label>
            )
          })}
        </div>
      )}
      <div className="kia-scroll max-h-[620px] overflow-auto">
        <table className="kia-table w-max min-w-full table-auto border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              {visibleColumns.map((column) => (
                <th key={String(column.key)} className={cn('whitespace-nowrap border-r border-white/10 px-3 py-2.5 text-left', stickyClass(String(column.key)))}>
                  <span className="inline-flex items-center gap-2">
                    {column.label}
                    {column.key !== 'index' && (
                      <button
                        type="button"
                        title={`Hide ${column.label}`}
                        className="rounded-md border border-white/20 px-1 text-[10px] text-white/75 hover:bg-white/10 hover:text-white"
                        onClick={() => {
                          const next = new Set(hiddenColumns)
                          next.add(String(column.key))
                          setHiddenColumns(next)
                        }}
                      >
                        −
                      </button>
                    )}
                  </span>
                </th>
              ))}
              {extra && <th className="whitespace-nowrap px-3 py-2.5 text-left">Finance</th>}
              {action && <th className="whitespace-nowrap px-3 py-2.5 text-left sm:sticky sm:right-0">Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + (extra ? 1 : 0) + (action ? 1 : 0)} className="p-0">
                  <PremiumEmptyState illustration="search" title="No proformas match this view" description="Adjust the filters, date range, or search to reveal records here." className="border-0 shadow-none" />
                </td>
              </tr>
            ) : rows.map((row, index) => {
              const isPending = !['APPROVED', 'DECLINED', 'NOT APPROVED'].includes(String(row.approvalStatus).toUpperCase())
              return (
                <tr
                  key={row.id}
                  className={cn('align-top', onRowClick && 'cursor-pointer transition-colors hover:bg-[var(--kia-surface-hover,rgba(99,102,241,0.04))]')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleColumns.map((column, colIdx) => {
                    const raw = column.key === 'index' ? index + 1 : row[column.key]
                    const value = column.numeric ? formatCurrency(raw) : column.key === 'entryTime' ? formatDateTime(String(raw)) : column.key === 'proformaDate' || column.key === 'financeUpdatedTime' ? formatDate(String(raw)) : column.key === 'location' ? formatKiaLocation(raw as string | null) : (column.key === 'mobileNumber' || column.key === 'customerEmail') ? maskKiaPii(raw == null ? '' : String(raw), canViewPii) : String(raw ?? '-')
                    return (
                      <td
                        key={String(column.key)}
                        className={cn('whitespace-nowrap px-3 py-2.5 text-xs font-semibold leading-tight text-[var(--kia-text)]', column.numeric && 'kia-tnum', stickyClass(String(column.key)))}
                        style={{
                          borderRight: '1px solid var(--kia-hairline)',
                          borderBottom: '1px solid var(--kia-hairline)',
                          ...stickyBg(String(column.key)),
                          ...(isPending && colIdx === 0 ? { boxShadow: 'inset 4px 0 0 var(--dashboard-warning)' } : {}),
                        }}
                      >
                        {column.key === 'approvalStatus' ? (
                          <Chip tone={approvalTone(row.approvalStatus)}>{row.approvalStatus}</Chip>
                        ) : value}
                      </td>
                    )
                  })}
                  {extra && <td className="min-w-[320px] px-3 py-2.5 text-xs" onClick={(e) => e.stopPropagation()} style={{ borderRight: '1px solid var(--kia-hairline)', borderBottom: '1px solid var(--kia-hairline)' }}>{extra(row)}</td>}
                  {action && <td className="whitespace-nowrap px-3 py-2.5 text-xs sm:sticky sm:right-0 sm:shadow-[-10px_0_18px_rgba(15,23,42,0.05)]" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--kia-surface)', borderBottom: '1px solid var(--kia-hairline)' }}>{action(row)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DetailsView({ options, mode }: { options: OptionsPayload; mode: 'all' | 'finance-remarks' | 'pending-approval' }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const queryMode = mode === 'pending-approval' ? 'pending-approval' : 'all'
  const { rows, loading, error, search, setSearch, page, setPage, financeStatus, setFinanceStatus, reload } = useProformas(queryMode, true)
  const [selectedColumn, setSelectedColumn] = useState('')
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set())
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [financeDate, setFinanceDate] = useState('')
  const [bankFilter, setBankFilter] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const columnStorageKey = `kia-proforma:hidden-columns:${options.currentUser.id}:${mode}`
  const [hiddenColumns, setHiddenColumnsState] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const parsed = JSON.parse(window.localStorage.getItem(columnStorageKey) || '[]')
      return new Set(Array.isArray(parsed) ? parsed : [])
    } catch {
      return new Set()
    }
  })
  const [verifying, setVerifying] = useState<KiaProformaRow | null>(null)
  const [verifyState, setVerifyState] = useState<VerifyState>({})
  const [financeDrafts, setFinanceDrafts] = useState<Record<string, { status: string; remarks: string }>>({})
  const [previewRow, setPreviewRow] = useState<KiaProformaRow | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [editingRow, setEditingRow] = useState<KiaProformaRow | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  // Only the General Manager may edit an approved proforma in-place (server enforces the same).
  const isGmRole = options.currentUser.role === 'general_manager'
  const canViewPii = canViewKiaCustomerPii(options.currentUser.role)
  const verifyStage = verifying ? pendingStageOf(verifying.approvalStatus) : 'approval'
  // Stage 1 (Sales Manager / GM): the Sales Manager sees the discount-verification checklist and
  // the General Manager sees the lighter approve/decline screen; approving hands off to Finance.
  // Stage 2 (Finance Head / Finance Team): a simple approve/decline that finalizes the proforma.
  const useChecklistUi = verifyStage === 'approval' && String(options.currentUser.role || '').toLowerCase() !== 'general_manager'
  const isFinalApprovalStage = verifyStage === 'finance'
  const isFinance = mode === 'finance-remarks'

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      // Finance (stage 2) approval lives EXCLUSIVELY in the dedicated /finance section, so a proforma
      // awaiting Finance is never shown or actionable in the Proforma module's Pending queue — a
      // client-side guard alongside the server-side getKiaProformaPendingApprovalFilter.
      if (mode === 'pending-approval' && pendingStageOf(row.approvalStatus) === 'finance') return false
      if (selectedColumn && selectedValues.size > 0 && !selectedValues.has(proformaColumnValue(row, selectedColumn) || '-')) return false
      const rowDate = dateKey(row.proformaDate)
      if (startDate && rowDate < startDate) return false
      if (endDate && rowDate > endDate) return false
      if (isFinance && financeDate && rowDate !== financeDate) return false
      if (isFinance && financeStatus === 'Current month' && bankFilter && row.bankName !== bankFilter) return false
      return true
    })
  }, [bankFilter, financeDate, financeStatus, isFinance, mode, rows, selectedColumn, selectedValues, startDate, endDate])
  const totalClientPages = Math.max(1, Math.ceil(filteredRows.length / PROFORMA_TABLE_PAGE_SIZE))
  const currentClientPage = Math.min(page, totalClientPages)
  const pagedRows = filteredRows.slice((currentClientPage - 1) * PROFORMA_TABLE_PAGE_SIZE, currentClientPage * PROFORMA_TABLE_PAGE_SIZE)

  function clearFilters() {
    setSearch('')
    setSelectedColumn('')
    setSelectedValues(new Set())
    setStartDate('')
    setEndDate('')
    setFinanceDate('')
    setBankFilter('')
    if (isFinance) setFinanceStatus('all')
    setPage(1)
  }

  async function setHiddenColumns(value: Set<string>) {
    setHiddenColumnsState(value)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(value)))
    }
  }

  async function saveFinance(row: KiaProformaRow) {
    const draft = financeDrafts[row.id] || { status: row.financeStatus || 'Pending', remarks: row.financeRemarks || '' }
    const response = await fetch(`/api/brands/kia/proforma/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'finance', financeStatus: draft.status, financeRemarks: draft.remarks }),
    })
    if (!response.ok) {
      toast({ title: 'Error', description: 'Failed to save finance remarks', variant: 'error' })
      return
    }
    await reload()
  }

  async function approveCurrent(opts: { decision?: 'approve' | 'decline'; allApproved?: boolean } = {}) {
    if (!verifying) return
    const stage = pendingStageOf(verifying.approvalStatus)
    const isDecline = opts.decision === 'decline'
    if (isDecline) setIsSaving(true)
    else setIsApproving(true)
    try {
      const payload: Record<string, unknown> = { action: 'approval' }
      if (useChecklistUi) {
        const checks = { ...verifyState }
        if (opts.allApproved) FIELD_VERIFY.forEach(([key]) => { checks[key] = { status: 'APPROVED', reason: '' } })
        payload.checks = checks
      } else {
        payload.decision = opts.decision || 'approve'
        if (isDecline) payload.declineReason = declineReason.trim()
      }
      const response = await fetch(`/api/brands/kia/proforma/${verifying.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null) as { error?: string } | null
        toast({ title: 'Error', description: err?.error || 'Failed to save approval', variant: 'error' })
        return
      }
      const result = await response.json().catch(() => null) as { row?: { approvalStatus?: string } } | null
      const fullyApproved = kiaApprovalStage(result?.row?.approvalStatus) === 'approved'
      const declinedNow = kiaApprovalStage(result?.row?.approvalStatus) === 'declined'
      const approvedBookingId = verifying.linkedBookingId || null
      setVerifying(null)
      setVerifyState({})
      setDeclineReason('')
      toast({
        title: declinedNow ? 'Proforma declined' : fullyApproved ? 'Proforma approved' : 'Approval recorded',
        description: declinedNow
          ? 'The proforma was sent back as Not Approved.'
          : fullyApproved
            ? 'Fully approved — the vehicle is now ready for allotment.'
            : `Approved at ${kiaStageActorLabel(stage)} — sent to the next approver.`,
        variant: declinedNow ? 'warning' : 'success',
      })
      await reload()
      // Only a fully-approved proforma is allotment-ready; refetch stock + route there.
      if (fullyApproved) {
        queryClient.invalidateQueries({ queryKey: ['kia-approved-bookings-for-allot'] })
        queryClient.invalidateQueries({ queryKey: ['kia-proforma-stock'] })
        if (approvedBookingId) router.push(`/brands/kia/proforma/stock?bookingId=${approvedBookingId}`)
      }
    } catch (err) {
      console.error(err)
      toast({ title: 'Error', description: 'Something went wrong during approval', variant: 'error' })
    } finally {
      setIsApproving(false)
      setIsSaving(false)
    }
  }

  const financeExtra = isFinance ? (row: KiaProformaRow) => {
    const draft = financeDrafts[row.id] || { status: row.financeStatus || 'Pending', remarks: row.financeRemarks || '' }
    return (
      <div className="grid min-w-[420px] gap-2 md:grid-cols-[180px_1fr_auto]">
        <Select value={draft.status} onValueChange={(value) => setFinanceDrafts((current) => ({ ...current, [row.id]: { ...draft, status: value } }))}>
          <SelectTrigger className={cn('h-10 rounded-xl', proformaOutlineButton)}><SelectValue /></SelectTrigger>
          <SelectContent>{FINANCE_STATUS_OPTIONS.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={draft.remarks} onChange={(event) => setFinanceDrafts((current) => ({ ...current, [row.id]: { ...draft, remarks: event.target.value } }))} placeholder="Finance remarks" className="h-10 rounded-xl border-[var(--dashboard-primary-border)] bg-white font-semibold shadow-sm" />
        <Button onClick={() => saveFinance(row)} className={cn('h-10 rounded-xl', proformaPrimaryButton)}>Save</Button>
        <p className="md:col-span-3 text-[11px] font-bold text-slate-500">Updated: {formatDateTime(row.financeUpdatedTime)}</p>
      </div>
    )
  } : undefined

  return (
    <div className="space-y-4">
      {isFinance && (
        <div className="flex flex-wrap gap-2">
          {['Pending', 'Cancelled', 'Stock not available', 'Duplicate', 'Current month', 'Converted', 'all'].map((status) => (
            <Button key={status} variant="outline" className={cn('rounded-xl', financeStatus === status ? proformaPrimaryButton : proformaOutlineButton)} onClick={() => setFinanceStatus(status)}>
              {status === 'all' ? 'Show All' : status}
            </Button>
          ))}
        </div>
      )}
      <FilterBar
        rows={rows}
        search={search}
        setSearch={(value) => { setSearch(value); setPage(1) }}
        mode={mode}
        selectedColumn={selectedColumn}
        setSelectedColumn={setSelectedColumn}
        selectedValues={selectedValues}
        setSelectedValues={setSelectedValues}
        startDate={startDate}
        setStartDate={(value) => { setStartDate(value); setPage(1) }}
        endDate={endDate}
        setEndDate={(value) => { setEndDate(value); setPage(1) }}
        financeDate={financeDate}
        setFinanceDate={setFinanceDate}
        bankFilter={bankFilter}
        setBankFilter={setBankFilter}
        financeStatus={financeStatus}
        onClear={clearFilters}
      />
      {error && !loading ? (
        <PremiumEmptyState
          illustration="error"
          title="Couldn't load proformas"
          description={error}
          action={<Button variant="outline" className={cn('h-10 rounded-xl', proformaOutlineButton)} onClick={reload}>Retry</Button>}
        />
      ) : loading ? <PremiumTableSkeleton rows={8} columns={9} /> : (
        <ProformaTable
          rows={pagedRows}
          hiddenColumns={hiddenColumns}
          setHiddenColumns={setHiddenColumns}
          extra={financeExtra}
          hideEmptyColumns={mode === 'pending-approval'}
          onRowClick={setPreviewRow}
          canViewPii={canViewPii}
          action={(row) => (
            <div className="flex gap-2">
              {mode === 'pending-approval' &&
                String(row.approvalStatus).toUpperCase() !== 'NOT APPROVED' &&
                String(row.approvalStatus).toUpperCase() !== 'DECLINED' && (
                  <Button className={cn('rounded-xl', proformaPrimaryButton)} onClick={() => setVerifying(row)}>
                    VERIFY
                  </Button>
                )}
              {row.approvalStatus === 'APPROVED' && row.linkPreview && (
                <Button
                  className="rounded-xl bg-indigo-600 px-4 text-xs font-black text-white hover:bg-indigo-700 h-8"
                  onClick={() => window.open(row.linkPreview!, '_blank')}
                >
                  Open ↗
                </Button>
              )}
              {isGmRole && (
                <Button
                  variant="outline"
                  className="h-8 rounded-xl border-slate-300 px-3 text-xs font-bold text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
                  onClick={() => setEditingRow(row)}
                >
                  <Pencil className="mr-1.5 h-3 w-3" /> Edit
                </Button>
              )}
            </div>
          )}
        />
      )}
      <div className="kia-surface flex flex-wrap items-center justify-between gap-3 p-3">
        <p className="text-sm font-semibold text-[var(--kia-text-soft)]">
          Showing {filteredRows.length === 0 ? 0 : ((currentClientPage - 1) * PROFORMA_TABLE_PAGE_SIZE) + 1}-{Math.min(currentClientPage * PROFORMA_TABLE_PAGE_SIZE, filteredRows.length)} of {filteredRows.length} records
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className={cn('rounded-xl', proformaOutlineButton)} disabled={currentClientPage <= 1} onClick={() => setPage(currentClientPage - 1)}>Prev</Button>
          {Array.from({ length: totalClientPages }).slice(0, 7).map((_, index) => {
            const pageNumber = index + 1
            return (
              <Button key={pageNumber} variant="outline" className={cn('h-9 min-w-9 rounded-xl px-3', currentClientPage === pageNumber ? proformaPrimaryButton : proformaOutlineButton)} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </Button>
            )
          })}
          {totalClientPages > 7 && <span className="px-1 text-xs font-black text-slate-500">...</span>}
          <Button variant="outline" className={cn('rounded-xl', proformaOutlineButton)} disabled={currentClientPage >= totalClientPages} onClick={() => setPage(currentClientPage + 1)}>Next</Button>
        </div>
      </div>

      <Dialog open={Boolean(verifying)} onOpenChange={(open) => !open && setVerifying(null)}>
        <DialogContent className="kia-premium max-h-[88vh] max-w-5xl overflow-hidden rounded-3xl p-0 flex flex-col">
          <LoaderOverlay show={isApproving || isSaving} variant="approval" label={isApproving ? 'Approving proforma…' : 'Saving verification…'} sublabel="Applying the approval decision" />
          <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="relative overflow-hidden p-6 text-white" style={{ background: 'linear-gradient(135deg, var(--dashboard-action-hover), var(--dashboard-action-bg))' }}>
              <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
              <DialogHeader className="relative">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15"><ShieldCheck className="h-5 w-5" /></span>
                  <div>
                    <DialogTitle className="text-2xl font-extrabold tracking-tight">{useChecklistUi ? 'Verify Proforma' : 'Approve Proforma'}</DialogTitle>
                    <DialogDescription className="text-white/80">{verifying?.customerName} · {verifying?.modelName}</DialogDescription>
                  </div>
                </div>
                <div className="relative mt-3 inline-flex w-fit items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-black uppercase tracking-wide">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
                  Stage: {KIA_APPROVAL_STAGE_LABELS[verifyStage]}
                </div>
              </DialogHeader>
            </div>
            {useChecklistUi ? (
              <div className="grid gap-3 p-6">
                <p className="text-xs font-semibold text-[var(--kia-text-soft)]">Verify the discount fields, then approve. This sends the proforma to Finance for final approval.</p>
                {FIELD_VERIFY.map(([key, label]) => {
                  const decision = verifyState[key]?.status
                  return (
                    <div key={key} className="kia-surface-sunken grid gap-3 p-3 md:grid-cols-[220px_180px_1fr]" style={decision === 'NOT APPROVED' ? toneSoftStyle('danger') : decision === 'APPROVED' ? toneSoftStyle('success') : undefined}>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--kia-text-faint)]">{label}</p>
                        <p className="mt-1 text-lg font-extrabold text-[var(--kia-text)] kia-tnum">{formatCurrency(verifying?.[key as keyof KiaProformaRow])}</p>
                      </div>
                      <Select value={verifyState[key]?.status || 'blank'} onValueChange={(value) => setVerifyState((current) => ({ ...current, [key]: { ...(current[key] || { reason: '' }), status: value === 'blank' ? '' : value } }))}>
                        <SelectTrigger className="rounded-xl bg-white"><SelectValue placeholder="Status" /></SelectTrigger>
                        <SelectContent>{['blank', 'APPROVED', 'NOT APPROVED'].map((value) => <SelectItem key={value} value={value}>{value === 'blank' ? 'Blank' : value}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input value={verifyState[key]?.reason || ''} onChange={(event) => setVerifyState((current) => ({ ...current, [key]: { ...(current[key] || { status: '' }), reason: event.target.value } }))} placeholder="Reason if not approved" className="rounded-xl bg-white" />
                    </div>
                  )
                })}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className={cn('h-10 rounded-xl', proformaOutlineButton)}
                    disabled={isApproving || isSaving}
                    onClick={() => approveCurrent({})}
                  >
                    {isSaving ? 'Saving…' : 'Save Verification'}
                  </Button>
                  <Button
                    className={cn('h-10 rounded-xl', proformaPrimaryButton)}
                    disabled={isApproving || isSaving}
                    onClick={() => approveCurrent({ allApproved: true })}
                  >
                    {isApproving ? 'Approving…' : 'Approve & Send to Finance'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 p-6">
                <p className="text-xs font-semibold text-[var(--kia-text-soft)]">{isFinalApprovalStage
                  ? 'Finance Head / Finance Team approval — this is the final approval. Approving it makes the vehicle ready for allotment, or decline with a reason.'
                  : 'Sales Manager / General Manager approval — approve to send the proforma to Finance for final approval, or decline with a reason.'}</p>
                <div className="kia-surface-sunken grid gap-3 p-4 sm:grid-cols-2">
                  <FieldValue label="Ex-Showroom" value={formatCurrency(verifying?.exShowroom)} />
                  <FieldValue label="Grand Total" value={formatCurrency(verifying?.grandTotalCost)} />
                  <FieldValue label="Cash Discount" value={formatCurrency(verifying?.cashDiscount)} />
                  <FieldValue label="Additional Discount" value={formatCurrency(verifying?.additionalDiscount)} />
                  <FieldValue label="Exchange Value" value={formatCurrency(verifying?.exchangeValue)} />
                  <FieldValue label="Booking Amount" value={formatCurrency(verifying?.bookingAmount)} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--kia-text-faint)]">Decline reason (required to decline)</label>
                  <Textarea value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} placeholder="Add a reason if you are declining this proforma…" className="mt-1 rounded-xl bg-white" rows={2} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className={cn('h-10 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50')}
                    disabled={isApproving || isSaving || !declineReason.trim()}
                    onClick={() => approveCurrent({ decision: 'decline' })}
                  >
                    {isSaving ? 'Declining…' : 'Decline'}
                  </Button>
                  <Button
                    className={cn('h-10 rounded-xl', proformaPrimaryButton)}
                    disabled={isApproving || isSaving}
                    onClick={() => approveCurrent({ decision: 'approve' })}
                  >
                    {isApproving ? 'Approving…' : isFinalApprovalStage ? 'Approve (Final)' : 'Approve & Send to Finance'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ProformaPreviewDrawer
        row={previewRow}
        mode={mode}
        canViewPii={canViewPii}
        onClose={() => setPreviewRow(null)}
        onVerify={(row) => { setPreviewRow(null); setVerifying(row) }}
      />

      {/* ── GM Edit Dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!editingRow} onOpenChange={(open) => { if (!open) setEditingRow(null) }}>
        <DialogContent className="kia-premium max-h-[92vh] max-w-4xl overflow-y-auto rounded-3xl p-0 [&>button]:hidden">
          <LoaderOverlay show={isSavingEdit} variant="proforma" label="Saving edits…" sublabel="Updating proforma and resetting approval to PENDING" />
          {editingRow && (
            <GMEditForm
              row={editingRow}
              models={options.models}
              trims={options.trims}
              banks={options.banks}
              onClose={() => setEditingRow(null)}
              onSaved={async () => {
                setEditingRow(null)
                await reload()
                toast({ title: 'Proforma Updated', description: 'Proforma has been updated and reset to PENDING for re-approval.', variant: 'success' })
              }}
              isSaving={isSavingEdit}
              setIsSaving={setIsSavingEdit}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// KIA colour options for the GM edit form's Colour dropdown (mirrors the booking form list).
const KIA_COLORS = [
  'SNOW WHITE PEARL', 'GRAVITY GREY', 'AURORA BLACK PEARL', 'GLACIER WHITE PEARL', 'PEWTER OLIVE',
  'INTENSE RED (B) WITH AURORA BLACK PEARL (R)', 'IMPERIAL BLUE', 'CLEAR WHITE', 'FROST BLUE',
  'FUSION BLACK', 'INTENSE RED', 'SPARKLING SILVER', 'MATTE GRAPHITE', 'Metalic', 'Two Tone',
  'Morning Haze', 'Magma Red', 'Forst Blue', 'Ivory Silver gloss', 'Piter olive', 'Imperial blue',
  'Gravity grey', 'Aurora black pearl', 'Glacier white pearl', 'Mattee Graphite',
]

// ── GM Edit Form ──────────────────────────────────────────────────────────────
// Renders a pre-filled proforma form inside the GM Edit Dialog. On save it
// PATCHes `action: 'edit'` which resets approval to PENDING.
type ProformaDocForm = {
  panCardUrl: string; panCardName: string; panNumber: string
  aadhaarCardUrl: string; aadhaarCardName: string; aadhaarNumber: string
  employeeIdUrl: string; employeeIdName: string
  exchange: string; exchangeVehicleName: string
}
const EMPTY_PROFORMA_DOCS: ProformaDocForm = {
  panCardUrl: '', panCardName: '', panNumber: '',
  aadhaarCardUrl: '', aadhaarCardName: '', aadhaarNumber: '',
  employeeIdUrl: '', employeeIdName: '', exchange: 'No', exchangeVehicleName: '',
}
// Pull the known document keys out of a metadata blob (booking.metadata or proforma.importMetadata).
function pickProformaDocs(source: Record<string, unknown> | null | undefined): Partial<ProformaDocForm> {
  const m = (source || {}) as Record<string, unknown>
  const keys: (keyof ProformaDocForm)[] = ['panCardUrl', 'panCardName', 'panNumber', 'aadhaarCardUrl', 'aadhaarCardName', 'aadhaarNumber', 'employeeIdUrl', 'employeeIdName', 'exchange', 'exchangeVehicleName']
  const out: Partial<ProformaDocForm> = {}
  for (const k of keys) { const v = m[k]; if (v !== null && v !== undefined && v !== '') out[k] = String(v) }
  return out
}
function ProformaDocUpload({ label, uploading, fileName, onSelect }: { label: string; uploading: boolean; fileName?: string; onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className={`flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 text-xs font-bold transition-colors ${fileName ? 'border-emerald-300 bg-emerald-50/60 text-emerald-700' : 'border-[var(--dashboard-primary-border)] bg-white text-[var(--kia-text-soft)] hover:border-slate-400'} ${uploading ? 'pointer-events-none opacity-70' : ''}`}>
      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 shrink-0 opacity-70" />}
      <span className="min-w-0 flex-1 truncate">{uploading ? 'Reading…' : fileName || label}</span>
      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onSelect} disabled={uploading} />
    </label>
  )
}

function GMEditForm({
  row,
  models,
  trims,
  banks,
  onClose,
  onSaved,
  isSaving,
  setIsSaving,
}: {
  row: KiaProformaRow
  models: string[]
  trims: { model: string; trim_description: string }[]
  banks: { bank_name: string; bank_branch: string | null }[]
  onClose: () => void
  onSaved: () => Promise<void>
  isSaving: boolean
  setIsSaving: (v: boolean) => void
}) {
  const rowToForm = (r: KiaProformaRow): FormState => ({
    customerType: r.customerType || 'Customer',
    proformaDate: r.proformaDate ? new Date(r.proformaDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : new Date().toISOString().slice(0, 10),
    customerName: r.customerName || '',
    mobileNumber: r.mobileNumber || '',
    customerAddress: r.customerAddress || '',
    customerEmail: r.customerEmail || '',
    modelName: r.modelName || '',
    trimDescription: r.trimDescription || '',
    fuelType: r.fuelType || 'PETROL',
    vehicleColor: r.vehicleColor || '',
    bankName: r.bankName || '',
    bankBranch: r.bankBranch || '',
    vehicleStatus: r.vehicleStatus || 'IN HOUSE',
    loanAmount: String(r.loanAmount || '0'),
    insuranceCompany: r.insuranceCompany || '',
    exShowroom: String(r.exShowroom || '0'),
    tcsValue: String(r.tcsValue || '0'),
    registrationCharges: String(r.registrationCharges || '0'),
    insuranceValue: String(r.insuranceValue || '0'),
    fastagValue: String(r.fastagValue || '0'),
    accessoriesKit: String(r.accessoriesKit || '0'),
    extWarranty: String(r.extWarranty || '0'),
    cashDiscount: String(r.cashDiscount || '0'),
    exchangeValue: String(r.exchangeValue || '0'),
    bookingAmount: String(r.bookingAmount || '0'),
    govtEmployeeDiscount: String(r.govtEmployeeDiscount || '0'),
    additionalDiscount: String(r.additionalDiscount || '0'),
  })

  const [form, setForm] = useState<FormState>(() => rowToForm(row))
  const [errors, setErrors] = useState<Record<string, string>>({})

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  // Customer documents (PAN / Aadhaar / Employee ID + exchange) live on the booking; the GM can add
  // or edit them here. Seed from the proforma's own snapshot, then override with the linked booking's
  // canonical metadata once fetched.
  const [docForm, setDocForm] = useState<ProformaDocForm>(() => ({
    ...EMPTY_PROFORMA_DOCS,
    ...pickProformaDocs((row.importMetadata as Record<string, unknown> | null)?.customerDocuments as Record<string, unknown> | undefined),
  }))
  const [idDocUploading, setIdDocUploading] = useState<'pan' | 'aadhaar' | 'employee_id' | null>(null)
  const updateDoc = <K extends keyof ProformaDocForm>(key: K, value: ProformaDocForm[K]) => setDocForm((c) => ({ ...c, [key]: value }))
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!row.linkedBookingId) return
    let cancelled = false
    fetchBookingDetailCached(queryClient, row.linkedBookingId)
      .then((data) => {
        if (cancelled || !data) return
        setDocForm((c) => ({ ...c, ...pickProformaDocs((data.booking?.metadata || {}) as Record<string, unknown>) }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [row.linkedBookingId, queryClient])

  async function handleIdDocUpload(docType: 'pan' | 'aadhaar' | 'employee_id', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setIdDocUploading(docType)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('docType', docType)
      const res = await fetch('/api/brands/kia/bookings/extract-id-document', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Upload failed')
      setDocForm((c) => ({
        ...c,
        ...(docType === 'pan' ? { panCardUrl: data.url || file.name, panCardName: file.name } : {}),
        ...(docType === 'aadhaar' ? { aadhaarCardUrl: data.url || file.name, aadhaarCardName: file.name } : {}),
        ...(docType === 'employee_id' ? { employeeIdUrl: data.url || file.name, employeeIdName: file.name } : {}),
        ...(docType === 'pan' && data.number ? { panNumber: data.number } : {}),
        ...(docType === 'aadhaar' && data.number ? { aadhaarNumber: data.number } : {}),
      }))
      toast({
        title: 'Document uploaded',
        description: data.pdfManual ? 'PDF stored — please type the number manually.' : data.number ? 'Read the number automatically — please verify it.' : 'Uploaded.',
        variant: 'success',
      })
    } catch (err) {
      e.target.value = ''
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Please try again.', variant: 'error' })
    } finally {
      setIdDocUploading(null)
    }
  }

  // Cascading dropdown choices (Model → Variant → Colour), like the booking form. Each list
  // always includes the proforma's current value so an existing (possibly legacy) selection
  // never disappears from its dropdown.
  const modelChoices = useMemo(() => {
    const set = new Set(models.filter(Boolean))
    if (form.modelName) set.add(form.modelName)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [models, form.modelName])

  const variantChoices = useMemo(() => {
    const set = new Set(
      trims.filter((trim) => trim.model === form.modelName).map((trim) => trim.trim_description).filter(Boolean)
    )
    if (form.trimDescription) set.add(form.trimDescription)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [trims, form.modelName, form.trimDescription])

  const colorChoices = useMemo(() => {
    const set = new Set<string>(KIA_COLORS)
    if (form.vehicleColor) set.add(form.vehicleColor)
    return Array.from(set)
  }, [form.vehicleColor])

  // Bank + branch dropdowns backed by the DB lookup (kia_price_details + kia_proforma_lookup_options),
  // same source as the create form. Branch list is scoped to the chosen bank; both always include the
  // current value so an existing selection never disappears. Free-typed (manual) entries are allowed.
  const bankChoices = useMemo(() => {
    const set = new Set(getKiaBankOptions(banks))
    if (form.bankName) set.add(form.bankName)
    return Array.from(set)
  }, [banks, form.bankName])

  const branchChoices = useMemo(() => {
    const set = new Set(getBranchesForBank(form.bankName, banks))
    if (form.bankBranch) set.add(form.bankBranch)
    return Array.from(set)
  }, [banks, form.bankName, form.bankBranch])

  function validate() {
    const next: Record<string, string> = {}
    if (!form.customerName.trim()) next.customerName = 'Customer name is required'
    if (!/^\d{10}$/.test(form.mobileNumber)) next.mobileNumber = 'Mobile number must be 10 digits'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail)) next.customerEmail = 'Valid email is required'
    const req: (keyof FormState)[] = ['customerAddress', 'modelName', 'trimDescription', 'fuelType', 'vehicleColor', 'vehicleStatus']
    // Bank and Branch are required only for finance bookings; a CASH payment leaves bank + branch optional.
    if (form.bankName.trim().toUpperCase() !== 'CASH') {
      req.push('bankName')
      req.push('bankBranch')
    }
    req.forEach((key) => {
      if (!String(form[key] || '').trim()) next[key] = 'Required'
    })
    if (Number(form.insuranceValue || 0) < 3000) next.insuranceValue = 'Value must be greater than 3000'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const totals = useMemo(() => {
    const exS = asNumber(form.exShowroom)
    const tcs = asNumber(form.tcsValue)
    const reg = asNumber(form.registrationCharges)
    const ins = asNumber(form.insuranceValue)
    const ftg = asNumber(form.fastagValue)
    const acc = asNumber(form.accessoriesKit)
    const ext = asNumber(form.extWarranty)
    const totalCustomerCost = exS + tcs + reg + ins + ftg + acc + ext
    const disc = asNumber(form.cashDiscount) + asNumber(form.exchangeValue) + asNumber(form.bookingAmount) + asNumber(form.govtEmployeeDiscount) + asNumber(form.additionalDiscount)
    const grandTotalCost = totalCustomerCost - disc
    return { totalCustomerCost: totalCustomerCost.toFixed(2), grandTotalCost: grandTotalCost.toFixed(2) }
  }, [form])

  async function saveEdit() {
    if (!validate()) return
    setIsSaving(true)
    try {
      const payload = {
        action: 'edit',
        ...form,
        ...docForm,
        totalCustomerCost: totals.totalCustomerCost,
        grandTotalCost: totals.grandTotalCost,
      }
      const response = await fetch(`/api/brands/kia/proforma/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null) as { error?: string } | null
        toast({ title: 'Save Failed', description: err?.error || 'Failed to save edits', variant: 'error' })
        return
      }
      await onSaved()
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to save edits', variant: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const numField = (label: string, key: keyof FormState) => (
    <Field label={label} error={errors[key]}>
      <TextInput
        type="number"
        value={String(form[key])}
        onChange={(e) => update(key, e.target.value)}
        className="tabular-nums"
      />
    </Field>
  )

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--kia-text-faint)]">General Manager Edit</p>
          <DialogTitle className="mt-0.5 text-xl font-extrabold tracking-tight text-[var(--kia-text)]">Edit Proforma #{row.id.slice(0, 8).toUpperCase()}</DialogTitle>
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
            <AlertTriangle className="h-3 w-3" /> Saving will reset approval to PENDING
          </div>
        </div>
        <Button variant="outline" className="rounded-xl" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Customer Details */}
        <FormSection title="Customer Details">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Customer Type">
              <Select value={form.customerType} onValueChange={(v) => update('customerType', v)}>
                <SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{['Customer', 'CSD', 'Bharat Series'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Proforma Date"><TextInput type="date" value={form.proformaDate} onChange={(e) => update('proformaDate', e.target.value)} /></Field>
            <Field label="Customer Name" error={errors.customerName}><TextInput value={form.customerName} onChange={(e) => update('customerName', e.target.value)} /></Field>
            <Field label="Mobile Number" error={errors.mobileNumber}><TextInput inputMode="numeric" maxLength={10} value={form.mobileNumber} onChange={(e) => update('mobileNumber', e.target.value.replace(/\D/g, '').slice(0, 10))} /></Field>
            <Field label="Customer Email" error={errors.customerEmail}><TextInput type="email" value={form.customerEmail} onChange={(e) => update('customerEmail', e.target.value)} /></Field>
            <div className="md:col-span-2">
              <Field label="Customer Address" error={errors.customerAddress}>
                <textarea value={form.customerAddress} onChange={(e) => update('customerAddress', e.target.value)} rows={2} className="w-full rounded-xl border border-[var(--dashboard-primary-border)] bg-white px-3 py-2 text-sm font-semibold shadow-sm" />
              </Field>
            </div>
          </div>
        </FormSection>

        {/* Vehicle Details */}
        <FormSection title="Vehicle & Bank">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Model Name" error={errors.modelName}>
              <Select value={form.modelName} onValueChange={(v) => { update('modelName', v); update('trimDescription', '') }}>
                <SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue placeholder="Select model" /></SelectTrigger>
                <SelectContent>{modelChoices.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Trim / Variant" error={errors.trimDescription}>
              <Select value={form.trimDescription} onValueChange={(v) => update('trimDescription', v)} disabled={!form.modelName}>
                <SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue placeholder={form.modelName ? 'Select variant' : 'Select model first'} /></SelectTrigger>
                <SelectContent>
                  {variantChoices.length
                    ? variantChoices.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)
                    : <div className="px-3 py-2 text-xs font-semibold text-slate-400">No variants found for this model</div>}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fuel Type" error={errors.fuelType}>
              <Select value={form.fuelType} onValueChange={(v) => update('fuelType', v)}>
                <SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID'].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Vehicle Color" error={errors.vehicleColor}>
              <Select value={form.vehicleColor} onValueChange={(v) => update('vehicleColor', v)}>
                <SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue placeholder="Select colour" /></SelectTrigger>
                <SelectContent>{colorChoices.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Vehicle Status" error={errors.vehicleStatus}>
              <Select value={form.vehicleStatus} onValueChange={(v) => update('vehicleStatus', v)}>
                <SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{['IN HOUSE', 'IN TRANSIT', 'INDENT'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Bank Name" error={errors.bankName}>
              <DataListInput
                listId="kia-edit-banks"
                value={form.bankName}
                onChange={(value) => setForm((current) => ({ ...current, bankName: value, bankBranch: '' }))}
                options={bankChoices}
              />
            </Field>
            <Field label="Bank Branch">
              <DataListInput
                listId="kia-edit-bank-branches"
                value={form.bankBranch}
                onChange={(value) => update('bankBranch', value)}
                options={branchChoices}
              />
            </Field>
            <Field label="Insurance Company"><TextInput value={form.insuranceCompany} onChange={(e) => update('insuranceCompany', e.target.value)} /></Field>
          </div>
        </FormSection>
      </div>

      {/* Customer Documents — GM can add or edit; saved onto the customer's booking. */}
      <FormSection title="Customer Documents">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="PAN Card">
            <ProformaDocUpload label="Upload PAN (image / PDF)" uploading={idDocUploading === 'pan'} fileName={docForm.panCardName} onSelect={(e) => handleIdDocUpload('pan', e)} />
          </Field>
          <Field label="PAN Number">
            <TextInput value={docForm.panNumber} onChange={(e) => updateDoc('panNumber', e.target.value.toUpperCase().slice(0, 10))} placeholder="ABCDE1234F" maxLength={10} />
          </Field>
          <div className="hidden md:block" />
          <Field label="Aadhaar Card">
            <ProformaDocUpload label="Upload Aadhaar (image / PDF)" uploading={idDocUploading === 'aadhaar'} fileName={docForm.aadhaarCardName} onSelect={(e) => handleIdDocUpload('aadhaar', e)} />
          </Field>
          <Field label="Aadhaar Number">
            <TextInput inputMode="numeric" value={docForm.aadhaarNumber} onChange={(e) => updateDoc('aadhaarNumber', e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="12-digit number" maxLength={12} />
          </Field>
          <Field label="Employee ID (optional)">
            <ProformaDocUpload label="Upload Employee ID" uploading={idDocUploading === 'employee_id'} fileName={docForm.employeeIdName} onSelect={(e) => handleIdDocUpload('employee_id', e)} />
          </Field>
          <Field label="Exchange / Trade-in">
            <Select value={docForm.exchange || 'No'} onValueChange={(v) => updateDoc('exchange', v)}>
              <SelectTrigger className="rounded-xl border-[var(--dashboard-primary-border)] bg-white shadow-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{['No', 'Yes'].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {docForm.exchange === 'Yes' && (
            <Field label="Exchange Vehicle Name">
              <TextInput value={docForm.exchangeVehicleName} onChange={(e) => updateDoc('exchangeVehicleName', e.target.value)} placeholder="e.g. Maruti Swift 2019" />
            </Field>
          )}
        </div>
        <p className="mt-2 text-[11px] font-semibold text-[var(--kia-text-faint)]">PAN &amp; Aadhaar numbers are read from the uploaded card — please verify. Accepts JPG, PNG or PDF (type the number for PDFs). Saved to the customer&apos;s booking.</p>
      </FormSection>

      {/* Pricing */}
      <FormSection title="Pricing & Discounts">
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {numField('Ex-Showroom', 'exShowroom')}
          {numField('TCS Value', 'tcsValue')}
          {numField('Registration Charges', 'registrationCharges')}
          {numField('Insurance Value', 'insuranceValue')}
          {numField('Fastag Value', 'fastagValue')}
          {numField('Accessories Kit', 'accessoriesKit')}
          {numField('Ext Warranty', 'extWarranty')}
          {numField('Cash Discount', 'cashDiscount')}
          {numField('Exchange Value', 'exchangeValue')}
          {numField('Booking Amount', 'bookingAmount')}
          {numField('Govt Employee Discount', 'govtEmployeeDiscount')}
          {numField('Additional Discount', 'additionalDiscount')}
          {numField('Loan Amount', 'loanAmount')}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 rounded-2xl bg-slate-50 p-4 text-sm font-bold">
          <span>Total Customer Cost: <span className="font-extrabold text-[var(--kia-text)]">{formatCurrency(totals.totalCustomerCost)}</span></span>
          <span className={asNumber(totals.grandTotalCost) < 0 ? 'text-rose-600' : ''}>
            Grand Total: <span className="font-extrabold">{formatCurrency(totals.grandTotalCost)}</span>
          </span>
        </div>
      </FormSection>

      {/* Save */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" className="rounded-xl" onClick={onClose}>Cancel</Button>
        <Button
          disabled={isSaving}
          className="rounded-xl bg-indigo-600 px-6 text-white hover:bg-indigo-700"
          onClick={() => void saveEdit()}
        >
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}

function ProformaPreviewDrawer({
  row,
  mode,
  canViewPii = false,
  onClose,
  onVerify,
}: {
  row: KiaProformaRow | null
  mode: 'all' | 'finance-remarks' | 'pending-approval'
  canViewPii?: boolean
  onClose: () => void
  onVerify: (row: KiaProformaRow) => void
}) {
  const [activities, setActivities] = useState<any[]>([])
  const [loadingActivities, setLoadingActivities] = useState(false)
  const queryClient = useQueryClient()

  // Depend on the STABLE id string, never on `row` itself: the row object is re-derived by the
  // parent, so an object-identity dependency refetched the full booking detail on every parent
  // re-render for as long as this panel stayed open — a silent invocation drip that survived every
  // other fix. The cached fetch also makes reopening the same row free for 5 minutes.
  const activitiesBookingId = row ? String(row.linkedBookingId || row.id) : null
  useEffect(() => {
    if (!activitiesBookingId) return
    let cancelled = false
    setLoadingActivities(true)
    fetchBookingDetailCached(queryClient, activitiesBookingId)
      .then((data) => {
        if (!cancelled && data?.activities) {
          setActivities(data.activities)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingActivities(false) })
    return () => { cancelled = true }
  }, [activitiesBookingId, queryClient])

  if (!row || typeof document === 'undefined') return null

  const money = (value: unknown) => formatCurrency(value)
  const upperStatus = String(row.approvalStatus || '').toUpperCase()
  const isNotApproved = upperStatus.includes('NOT APPROVED') || upperStatus.includes('DECLINED')
  const isApproved = upperStatus === 'APPROVED'
  const isPending = !isNotApproved && !isApproved

  const priceFields: { label: string; value: string | number }[] = [
    { label: 'Ex-Showroom', value: row.exShowroom },
    { label: 'TCS', value: row.tcsValue },
    { label: 'Registration', value: row.registrationCharges },
    { label: 'Insurance', value: row.insuranceValue },
    { label: 'FASTag', value: row.fastagValue },
    { label: 'Accessories Kit', value: row.accessoriesKit },
    { label: 'Ext. Warranty', value: row.extWarranty },
    { label: 'Cash Discount', value: row.cashDiscount },
    { label: 'Exchange Value', value: row.exchangeValue },
    { label: 'Booking Amount', value: row.bookingAmount },
    { label: 'Govt. Emp. Discount', value: row.govtEmployeeDiscount },
    { label: 'Additional Discount', value: row.additionalDiscount },
  ]

  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 z-[99998] bg-slate-950/40 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
      />
      <motion.div
        className="kia-premium fixed inset-y-0 right-0 z-[99999] flex h-full w-[480px] max-w-[95vw] flex-col border-l shadow-2xl"
        style={{ backgroundColor: 'var(--kia-canvas)', borderColor: 'var(--kia-hairline)' }}
        initial={{ x: 48, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero */}
        <div className="relative overflow-hidden border-b p-5 text-white" style={{ borderColor: 'var(--kia-hairline)', background: 'linear-gradient(135deg, var(--dashboard-action-hover), var(--dashboard-action-bg))' }}>
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">Proforma Preview</p>
              <p className="mt-1 truncate text-lg font-extrabold tracking-tight">{row.customerName || '—'}</p>
              <p className="mt-0.5 text-xs font-semibold text-white/85">{row.modelName} · {row.trimDescription}</p>
            </div>
            <button
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="relative mt-3">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-black uppercase tracking-wider shadow-sm border',
                isNotApproved
                  ? 'bg-rose-600 text-white border-rose-500'
                  : isApproved
                    ? 'bg-emerald-600 text-white border-emerald-500'
                    : 'bg-amber-500 text-white border-amber-400'
              )}
            >
              {row.approvalStatus}
            </span>
          </div>
        </div>

        <div className="kia-scroll flex-1 space-y-4 overflow-y-auto p-4">
          {/* Approval Chain & Activity Log */}
          <div className="kia-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconTile icon={Activity} tone="accent" size="sm" />
                <h3 className="text-sm font-extrabold tracking-tight text-[var(--kia-text)]">Approval Chain & Activity Log</h3>
              </div>
              <span className="text-[10px] font-bold text-[var(--kia-text-soft)]">{activities.length} events</span>
            </div>
            {loadingActivities ? (
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--kia-text-soft)] py-3">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> Loading audit history...
              </div>
            ) : activities.length === 0 ? (
              <p className="text-xs font-semibold text-[var(--kia-text-faint)] italic py-2">No activity records logged yet for this booking/proforma.</p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {activities.map((act) => (
                  <div key={act.id || act.createdAt} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-slate-900 dark:text-slate-100">{act.title || act.activityType}</span>
                      <span className="text-[10px] font-bold text-slate-400">{formatDateTime(act.createdAt || act.created_at)}</span>
                    </div>
                    {act.description && <p className="mt-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">{act.description}</p>}
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                      <span>By: {act.actorName || act.actor_name || 'System'}</span>
                      {(act.actorRole || act.actor_role) && <span className="uppercase opacity-75">({(act.actorRole || act.actor_role).replace(/_/g, ' ')})</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Customer Details */}
          <div className="kia-surface p-4">
            <div className="mb-3 flex items-center gap-2.5">
              <IconTile icon={ClipboardList} tone="info" size="sm" />
              <h3 className="text-sm font-extrabold tracking-tight text-[var(--kia-text)]">Customer Details</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FieldValue label="Customer" value={row.customerName || '—'} />
              <FieldValue label="Mobile" value={maskKiaPii(row.mobileNumber, canViewPii)} />
              <FieldValue label="Email" value={maskKiaPii(row.customerEmail, canViewPii)} />
              <FieldValue label="Type" value={row.customerType || '—'} />
              <FieldValue label="Proforma Date" value={formatDate(row.proformaDate)} />
              <FieldValue label="Consultant" value={row.consultant || '—'} />
              <div className="col-span-2"><FieldValue label="Address" value={row.customerAddress || '—'} /></div>
            </div>
          </div>

          {/* Bank / Finance Details */}
          <div className="kia-surface p-4">
            <div className="mb-3 flex items-center gap-2.5">
              <IconTile icon={WalletCards} tone="accent" size="sm" />
              <h3 className="text-sm font-extrabold tracking-tight text-[var(--kia-text)]">Bank / Finance Details</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FieldValue label="Bank" value={row.bankName || '—'} />
              <FieldValue label="Branch" value={row.bankBranch || '—'} />
              <FieldValue label="Loan Amount" value={money(row.loanAmount)} />
              <FieldValue label="Insurance Co." value={row.insuranceCompany || '—'} />
              <FieldValue label="Vehicle Status" value={row.vehicleStatus || '—'} />
              <FieldValue label="Finance Status" value={row.financeStatus || '—'} />
              {row.financeRemarks && <div className="col-span-2"><FieldValue label="Finance Remarks" value={row.financeRemarks} /></div>}
            </div>
          </div>

          {/* Vehicle & Price Details */}
          <div className="kia-surface p-4">
            <div className="mb-3 flex items-center gap-2.5">
              <IconTile icon={FileText} tone="violet" size="sm" />
              <h3 className="text-sm font-extrabold tracking-tight text-[var(--kia-text)]">Vehicle & Price Details</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FieldValue label="Model" value={row.modelName || '—'} />
              <FieldValue label="Variant" value={row.trimDescription || '—'} />
              <FieldValue label="Fuel" value={row.fuelType || '—'} />
              <FieldValue label="Colour" value={row.vehicleColor || '—'} />
            </div>
            <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--kia-hairline)' }}>
              <div className="grid grid-cols-2 gap-2">
                {priceFields.map((field) => (
                  <FieldValue key={field.label} label={field.label} value={money(field.value)} />
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3" style={{ borderColor: 'var(--kia-hairline)' }}>
              <div className="rounded-xl px-3 py-2" style={toneSoftStyle('info')}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--kia-text-soft)]">Customer Cost</p>
                <p className="kia-tnum mt-0.5 text-sm font-extrabold text-[var(--kia-text)]">{money(row.totalCustomerCost)}</p>
              </div>
              <div className="rounded-xl px-3 py-2" style={toneSoftStyle('accent')}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--kia-text-soft)]">Grand Total</p>
                <p className="kia-tnum mt-0.5 text-sm font-extrabold text-[var(--kia-text)]">{money(row.grandTotalCost)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions — editing still happens via these, matching the table */}
        <div className="flex items-center justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--kia-hairline)' }}>
          <Button variant="outline" className={cn('h-10 rounded-xl', proformaOutlineButton)} onClick={onClose}>Close</Button>
          {mode === 'pending-approval' && isPending && (
            <Button className={cn('h-10 rounded-xl', proformaPrimaryButton)} onClick={() => onVerify(row)}>VERIFY</Button>
          )}
          {row.approvalStatus === 'APPROVED' && row.linkPreview && (
            <Button className="h-10 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white hover:bg-indigo-700" onClick={() => window.open(row.linkPreview!, '_blank')}>Open ↗</Button>
          )}
        </div>
      </motion.div>
    </>,
    document.body
  )
}

function AnalyticsView({ insights = false, userId }: { insights?: boolean; userId: string }) {
  const [type, setType] = useState<'bank' | 'insurance' | 'status'>('bank')
  const [grouping, setGrouping] = useState<'daily' | 'monthly' | 'yearly'>('monthly')
  const [status, setStatus] = useState('all')
  const [top, setTop] = useState<'all' | '5'>('all')
  const [selectedConsultants, setSelectedConsultants] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const columnStorageKey = `kia-proforma:hidden-columns:${userId}:${insights ? 'business-insights' : 'hyp-ins-analytics'}`
  const [hiddenPeriods, setHiddenPeriods] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const parsed = JSON.parse(window.localStorage.getItem(columnStorageKey) || '[]')
      return new Set(Array.isArray(parsed) ? parsed : [])
    } catch {
      return new Set()
    }
  })
  const [payload, setPayload] = useState<{
    pivot: Record<string, unknown>[]
    chart: Record<string, unknown>[]
    distributions: Record<string, unknown>[]
    consultants: Record<string, unknown>[]
    modelDistribution: Record<string, unknown>[]
    fuelDistribution: Record<string, unknown>[]
    addressIntegrity: Record<string, unknown>[]
  }>({ pivot: [], chart: [], distributions: [], consultants: [], modelDistribution: [], fuelDistribution: [], addressIntegrity: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ type, grouping, status, top })
      if (selectedConsultants.size > 0) params.set('consultants', Array.from(selectedConsultants).join(','))
      const response = await fetch(`/api/brands/kia/proforma/analytics?${params}`)
      if (!response.ok) throw new Error('Failed to load analytics')
      setPayload(await response.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [grouping, selectedConsultants, status, top, type])
  useEffect(() => { reload() }, [reload])

  const periods = Array.from(new Set(payload.pivot.map((row) => String(row.period)))).sort()
  const categories = Array.from(new Set(payload.pivot.map((row) => String(row.category))))
  const pivotRows = categories.map((category) => {
    const items = payload.pivot.filter((row) => row.category === category)
    const record: Record<string, unknown> = { category, grandTotal: items[0]?.grand_total || 0 }
    periods.forEach((period) => { record[period] = items.find((item) => item.period === period)?.value || 0 })
    return record
  })
  const visiblePeriods = periods.filter((period) => !hiddenPeriods.has(period))
  const totalPivotPages = Math.max(1, Math.ceil(pivotRows.length / PROFORMA_TABLE_PAGE_SIZE))
  const currentPivotPage = Math.min(page, totalPivotPages)
  const pagedPivotRows = pivotRows.slice((currentPivotPage - 1) * PROFORMA_TABLE_PAGE_SIZE, currentPivotPage * PROFORMA_TABLE_PAGE_SIZE)
  const setStoredHiddenPeriods = (value: Set<string>) => {
    setHiddenPeriods(value)
    if (typeof window !== 'undefined') window.localStorage.setItem(columnStorageKey, JSON.stringify(Array.from(value)))
  }
  const chartData = periods.map((period) => {
    const record: Record<string, unknown> = { period }
    categories.forEach((category) => {
      record[category] = payload.chart.find((row) => row.period === period && row.category === category)?.value || 0
    })
    return record
  })
  const approvalTotals = payload.distributions.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.approval_status || 'Pending')
    acc[key] = (acc[key] || 0) + Number(row.total || 0)
    return acc
  }, {})
  const approvalDist = Object.entries(approvalTotals).map(([name, value]) => ({ name, value: Number(value) }))
  const statusTotals = payload.distributions.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.vehicle_status || 'Unknown')
    acc[key] = (acc[key] || 0) + Number(row.total || 0)
    return acc
  }, {})
  const statusDist = Object.entries(statusTotals).map(([name, value]) => ({ name, value: Number(value) }))
  const consultants = payload.consultants.map((row) => String(row.consultant || '')).filter(Boolean)
  const toggleConsultant = (consultant: string) => {
    const next = new Set(selectedConsultants)
    if (next.has(consultant)) next.delete(consultant)
    else next.add(consultant)
    setSelectedConsultants(next)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 rounded-3xl border border-slate-200 bg-white p-3">
        <Select value={type} onValueChange={(value: 'bank' | 'insurance' | 'status') => setType(value)}><SelectTrigger className="w-56 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank">By Bank Name</SelectItem><SelectItem value="insurance">By Insurance Company</SelectItem>{!insights && <SelectItem value="status">By Status</SelectItem>}</SelectContent></Select>
        <Select value={grouping} onValueChange={(value: 'daily' | 'monthly' | 'yearly') => setGrouping(value)}><SelectTrigger className="w-44 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent></Select>
        {!insights && <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-44 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="IN HOUSE">In House</SelectItem><SelectItem value="OUT HOUSE">Out House</SelectItem></SelectContent></Select>}
        <Button variant="outline" className={cn('rounded-xl', top === 'all' ? proformaPrimaryButton : proformaOutlineButton)} onClick={() => setTop('all')}>All</Button>
        <Button variant="outline" className={cn('rounded-xl', top === '5' ? proformaPrimaryButton : proformaOutlineButton)} onClick={() => setTop('5')}>TOP 5</Button>
        {!insights && <Button variant="outline" className={cn('rounded-xl', proformaOutlineButton)} onClick={() => { setStatus('all'); setTop('all'); setSelectedConsultants(new Set()); setPage(1) }}>Clear All</Button>}
      </div>
      {!insights && consultants.length > 0 && (
        <ChecklistPanel
          title="Consultants"
          items={consultants.map((consultant) => ({ value: consultant, label: consultant }))}
          selected={selectedConsultants}
          onToggle={toggleConsultant}
        />
      )}
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700 sm:text-sm">
          {error}
        </div>
      )}
      {loading ? <div className="h-80 animate-pulse rounded-[2rem] bg-white/70" /> : insights ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="Category trend">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis /><Tooltip /><Legend />{categories.map((category, index) => <Bar key={category} dataKey={category} stackId="a" fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <PieCard title="Approval status distribution" data={approvalDist} />
          <PieCard title="In House vs Out House" data={statusDist} />
          <PieCard title="Customer address integrity" data={payload.addressIntegrity.map((row) => ({ name: String(row.name), value: Number(row.value || 0) }))} />
          <PieCard title="Model name distribution" data={payload.modelDistribution.map((row) => ({ name: String(row.name), value: Number(row.value || 0) }))} />
          <PieCard title="Fuel type distribution" data={payload.fuelDistribution.map((row) => ({ name: String(row.name), value: Number(row.value || 0) }))} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Column Visibility</span>
            {periods.map((period) => (
              <Button key={period} variant="outline" className={cn('h-8 rounded-xl text-xs', hiddenPeriods.has(period) ? proformaOutlineButton : proformaPrimaryButton)} onClick={() => {
                const next = new Set(hiddenPeriods)
                if (next.has(period)) next.delete(period)
                else next.add(period)
                setStoredHiddenPeriods(next)
              }}>{period}</Button>
            ))}
            <Button variant="outline" className={cn('h-8 rounded-xl text-xs', proformaOutlineButton)} onClick={() => setStoredHiddenPeriods(new Set())}>Reset</Button>
          </div>
          <div className="overflow-auto rounded-[1.75rem] border border-slate-200 bg-white">
            <table className="w-max min-w-full table-auto text-xs">
              <thead className="bg-slate-950 text-white"><tr><th className="whitespace-nowrap px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-widest">Category</th>{visiblePeriods.map((period) => <th key={period} className="whitespace-nowrap px-3 py-2.5 text-right text-[9px] font-black uppercase tracking-widest">{period}</th>)}<th className="whitespace-nowrap px-3 py-2.5 text-right text-[9px] font-black uppercase tracking-widest">Grand Total</th></tr></thead>
              <tbody>
                {pagedPivotRows.map((row) => <tr key={String(row.category)} className="border-b border-slate-200"><td className="whitespace-nowrap px-3 py-2.5 font-black">{String(row.category)}</td>{visiblePeriods.map((period) => <td key={period} className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{Number(row[period] || 0).toLocaleString('en-IN')}</td>)}<td className="whitespace-nowrap px-3 py-2.5 text-right font-black">{Number(row.grandTotal || 0).toLocaleString('en-IN')}</td></tr>)}
                <tr className="bg-slate-100 font-black"><td className="whitespace-nowrap px-3 py-2.5">Grand Total</td>{visiblePeriods.map((period) => <td key={period} className="whitespace-nowrap px-3 py-2.5 text-right">{pivotRows.reduce((sum, row) => sum + Number(row[period] || 0), 0).toLocaleString('en-IN')}</td>)}<td className="whitespace-nowrap px-3 py-2.5 text-right">{pivotRows.reduce((sum, row) => sum + Number(row.grandTotal || 0), 0).toLocaleString('en-IN')}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-bold text-slate-600">Page {currentPivotPage} of {totalPivotPages} / {pivotRows.length} records</p>
            <div className="flex gap-2">
              <Button variant="outline" className={cn('rounded-xl', proformaOutlineButton)} disabled={currentPivotPage <= 1} onClick={() => setPage(currentPivotPage - 1)}>Prev</Button>
              <Button variant="outline" className={cn('rounded-xl', proformaOutlineButton)} disabled={currentPivotPage >= totalPivotPages} onClick={() => setPage(currentPivotPage + 1)}>Next</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="kia-surface p-4"><p className="kia-kicker mb-3">{title}</p>{children}</div>
}

function PieCard({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} label>{data.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// Shared, cached booking-detail fetch for every proforma surface. Uses the SAME React Query cache
// key as the bookings drawer, so a booking viewed anywhere in the app is fetched once and reused
// for 5 minutes. The raw fetch() calls this replaces bypassed every cache layer (the session
// fetch-cache excludes /bookings paths on purpose) and re-fired on every mount — and in the
// activities panel on every parent render via an object-identity dependency — which held
// /api/brands/kia/bookings/[id] at hundreds of invocations per hour even after the follow-ups
// prefetch storm was fixed. fetchQuery also dedupes concurrent same-key requests.
function fetchBookingDetailCached(queryClient: QueryClient, bookingId: string) {
  return queryClient.fetchQuery({
    queryKey: ['kia-booking-detail', bookingId],
    queryFn: async () => {
      const res = await fetch(`/api/brands/kia/bookings/${bookingId}`)
      if (!res.ok) throw new Error('Failed to load booking detail')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}

function useBookingPrefill(bookingId: string | null) {
  const queryClient = useQueryClient()
  const [prefill, setPrefill] = useState<BookingPrefill | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!bookingId) { setPrefill(null); return }
    setLoading(true)
    fetchBookingDetailCached(queryClient, bookingId)
      .then((data) => {
        if (!data?.booking) return
        const b = data.booking
        const meta = (b.metadata || {}) as Record<string, unknown>
        const bankValue = String(b.bankName || meta.bankFinance || '').trim()
        // Mirror the booking form's own rule (kia-bookings-client): finance is required only when a
        // real bank (not CASH) is named. Anything else — blank or "CASH" — is a cash payment.
        const isCash = !bankValue || bankValue.toUpperCase() === 'CASH'
        setPrefill({
          bookingId,
          bookingNumber: b.bookingNumber,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          customerEmail: b.customerEmail,
          model: b.model,
          variant: b.variant,
          color: b.colorPreference || b.color,
          consultantName: b.consultantName,
          bankName: b.bankName || String(meta.bankFinance || ''),
          bankBranch: String(meta.bankBranch || ''),
          bookingAmount: String(meta.bookingAmount || ''),
          isCash,
        })
      })
      .catch(() => setPrefill(null))
      .finally(() => setLoading(false))
  }, [bookingId, queryClient])
  return { prefill, loading }
}

export function KiaProformaPage({ section }: { section: KiaProformaSection }) {
  const searchParams = useSearchParams()
  const bookingId = searchParams.get('bookingId')
  const clientSearchParams = useMemo<Record<string, string>>(() => Object.fromEntries(searchParams.entries()), [searchParams])
  const { data: options, loading: optionsLoading, error, reload } = useOptions()
  const { prefill: bookingPrefill, loading: prefillLoading } = useBookingPrefill(
    section === 'generate' ? bookingId : null
  )
  const loading = optionsLoading || (Boolean(section === 'generate' && bookingId) && prefillLoading)
  const approverOnly = section === 'pending-approval'
  if (loading) {
    return <MainLayout title="Kia Proforma" subtitle="AM Kia operational proforma system"><div className="kia-premium space-y-4"><div className="kia-skeleton h-32 rounded-[2rem]" /><PremiumTableSkeleton rows={7} columns={9} /></div></MainLayout>
  }
  if (error || !options) {
    return <MainLayout title="Kia Proforma" subtitle="AM Kia operational proforma system"><div className="kia-premium"><PremiumEmptyState illustration="error" title="Unable to load Kia Proforma" description={error || 'Please retry in a moment.'} action={<Button variant="outline" className={cn('h-10 rounded-xl', proformaOutlineButton)} onClick={reload}>Retry</Button>} /></div></MainLayout>
  }
  if (approverOnly && !options.currentUser.isApprover) {
    return <MainLayout title="Kia Proforma" subtitle="AM Kia operational proforma system"><div className="kia-premium"><PremiumEmptyState illustration="road" title="Access required" description="This page is available only for Kia Proforma approvers or manager roles." /></div></MainLayout>
  }
  if (!canAccessKiaSection(section, options.currentUser.role, options.currentUser.isApprover)) {
    return <MainLayout title="Kia Proforma" subtitle="AM Kia operational proforma system"><div className="kia-premium"><PremiumEmptyState illustration="road" title="Access required" description="Sales Executives can access the Booking CRM and Generate Proforma only." /></div></MainLayout>
  }

  return (
    <MainLayout title="Kia Proforma" subtitle="AM Kia operational proforma system">
      <div className="kia-proforma-shell kia-premium space-y-5">
        <ModuleHeader section={section} profile={options.profile} isApprover={options.currentUser.isApprover} currentUserRole={options.currentUser.role} onPricesImported={reload} />
        {/* Hand the already-loaded options down so the bookings client does NOT fire its own second
            /api/brands/kia/proforma/options request (its query is gated on `!priceOptions`). The
            standalone /brands/kia/bookings page passes no prop and keeps fetching for itself. */}
        {section === 'bookings' && <KiaBookingsClient initialSearchParams={clientSearchParams} embedMode={true} priceOptions={options} currentUserRole={options.currentUser.role} currentUserName={options.currentUser.fullName} />}
        {section === 'stock' && <KiaStockManagementDashboard currentUserRole={options.currentUser.role} />}
        {section === 'generate' && <GenerateProforma options={options} onSaved={reload} bookingPrefill={bookingPrefill} />}
        {section === 'all' && <DetailsView options={options} mode="all" />}
        {section === 'finance-remarks' && <DetailsView options={options} mode="finance-remarks" />}
        {section === 'pending-approval' && <DetailsView options={options} mode="pending-approval" />}
      </div>
    </MainLayout>
  )
}
