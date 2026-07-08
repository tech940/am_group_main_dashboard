'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Banknote,
  CalendarDays,
  ClipboardCheck,
  Download,
  Edit3,
  FileText,
  LayoutDashboard,
  Loader2,
  Maximize2,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type CurrentUser = {
  id: string
  role: string
  fullName: string
  email: string
}

type AmFinancePermissions = {
  view: boolean
  create: boolean
  edit: boolean
  audit: boolean
}

type AmFinanceRow = {
  id: number
  rowHash: string
  deliveryDate: string | null
  customerName: string | null
  mobileNo: string | null
  model: string | null
  salesExecutive: string | null
  mainDealer: string | null
  location: string | null
  tl: string | null
  hyp: string | null
  branch: string | null
  loanAmount: number
  panNumber: string | null
  payoutStatus: string | null
  reasonIfOuthouse: string | null
  dealerPayoutPercent: string | null
  payoutAmount: number
  status: string | null
  dsePayoutStatus: string | null
  dealerPayoutStatus: string | null
  paymentReceivedDate: string | null
  amountReceived: number
  invoiceNumber: string | null
  bankVisitScheduled: string | null
  dateOfBankVisit: string | null
  visitedBy: string | null
  bankerRemarks: string | null
  vehicleRegistrationNumberToSale: string | null
  hypAsPerRc: string | null
  startTime: string | null
  endTime: string | null
  loginUser: string | null
  bankIntRate: number | null
  bankLogin: string | null
  bankInProforma: string | null
  uploadedAt: string | null
}

type BreakdownRow = {
  label: string
  cases: number
  loanAmount: number
  payoutAmount: number
  amountReceived: number
}

type AmFinancePayload = {
  rows: AmFinanceRow[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  summary: {
    totalCases: number
    totalLoanAmount: number
    totalPayoutAmount: number
    totalAmountReceived: number
    pendingAmount: number
    receivedCases: number
    pendingCases: number
    noPayoutCases: number
  }
  breakdowns: {
    payoutStatus: BreakdownRow[]
    paymentStatus: BreakdownRow[]
    dealerPerformance: BreakdownRow[]
    locationPerformance: BreakdownRow[]
    bankPerformance: BreakdownRow[]
  }
  filterOptions: Record<FilterOptionKey, string[]>
  coverage: {
    minDeliveryDate: string | null
    maxDeliveryDate: string | null
    latestUploadedAt: string | null
    rowCount: number
  }
  permissions?: AmFinancePermissions
  source?: {
    table: string
    mode: string
  }
}

type AuditRow = {
  id: string
  financeSheetId: number
  action: string
  fieldName: string | null
  fieldLabel: string | null
  oldValue: string | null
  newValue: string | null
  performedByName: string | null
  userRole: string
  createdAt: string | null
}

type DuplicateRow = Pick<AmFinanceRow, 'id' | 'deliveryDate' | 'customerName' | 'mobileNo' | 'model' | 'mainDealer' | 'location' | 'hyp' | 'status' | 'uploadedAt'>

type Filters = {
  startDate: string
  endDate: string
  mainDealer: string
  location: string
  tl: string
  salesExecutive: string
  hyp: string
  branch: string
  payoutStatus: string
  status: string
  bankLogin: string
  bankInProforma: string
  bankerRemarks: string
  reasonIfOuthouse: string
}

type FilterOptionKey =
  | 'mainDealers'
  | 'locations'
  | 'tls'
  | 'salesExecutives'
  | 'hyps'
  | 'branches'
  | 'payoutStatuses'
  | 'statuses'
  | 'bankLogins'
  | 'bankInProformas'

type SortKey =
  | 'deliveryDate'
  | 'customerName'
  | 'mainDealer'
  | 'location'
  | 'hyp'
  | 'loanAmount'
  | 'payoutAmount'
  | 'amountReceived'
  | 'status'
  | 'payoutStatus'
  | 'paymentReceivedDate'
  | 'uploadedAt'

type AnalyticsSectionKey =
  | 'overview'
  | 'payout-status'
  | 'hyp-bank-analysis'
  | 'team-performance'
  | 'monthly-matrix'
  | 'operations-compliance'
  | 'proforma-details'
  | 'register'

type FinanceMetricRow = {
  label: string
  totalCase: number
  contribution: number
  loanAmount: number
  avgTicketSize: number
  avgPayout: number
  inhouseCount: number
  inHousePercent: number
  dsePayoutStatus: number
  dealerPayoutStatus: number
  payoutAmount: number
  amountReceived: number
  bankIntRate: number | null
}

type SbiPendingSummary = {
  totalCase: number
  loanAmount: number
  payoutAmount: number
  amountReceived: number
  pendingAmount: number
  targetPercent?: number
  filteredTotalCases?: number
  targetCases?: number
  actualSbiCases?: number
  pendingCases?: number
  targetMet?: boolean
}

type MonthHypMetricRow = FinanceMetricRow & {
  month: string
  hyp: string
  status: string
}

type OperationsDealerRow = {
  label: string
  totalCase: number
  contribution: number
  bankScheduleVisit: number
  visited: number
  vehicleRegistrationCount: number
  hypAsPerRcCount: number
  hypMismatchCount: number
}

type RankingRow = {
  label: string
  totalCase: number
  contribution: number
}

type ProformaPivot = {
  title: string
  dealer: string
  months: Array<{ key: string; label: string }>
  rows: Array<{
    bank: string
    values: Record<string, number>
    grandTotal: number
  }>
  grandTotalRow: {
    bank: string
    values: Record<string, number>
    grandTotal: number
  }
  locationRows: FinanceMetricRow[]
}

type FinanceAnalyticsPayload = {
  section: AnalyticsSectionKey | 'all'
  summary: AmFinancePayload['summary'] & {
    avgTicketSize: number
    inhouseCount: number
    inHousePercent: number
  }
  data: {
    overview?: {
      payoutStatusRows: FinanceMetricRow[]
      paymentStatusRows: FinanceMetricRow[]
      dealerRows: FinanceMetricRow[]
      locationRows: FinanceMetricRow[]
      hypRows: FinanceMetricRow[]
      monthRows: FinanceMetricRow[]
    }
    payoutStatus?: {
      payoutStatusRows: FinanceMetricRow[]
      paymentStatusRows: FinanceMetricRow[]
      dealerRows: FinanceMetricRow[]
    }
    hypBankAnalysis?: {
      hypRows: FinanceMetricRow[]
      locationRows: FinanceMetricRow[]
      sbiPendingTarget: number
      sbiPendingSummary?: SbiPendingSummary
    }
    teamPerformance?: {
      salesExecutiveRows: FinanceMetricRow[]
      hypRows: FinanceMetricRow[]
    }
    monthlyMatrix?: {
      monthRows: FinanceMetricRow[]
      monthHypRows: MonthHypMetricRow[]
    }
    operationsCompliance?: {
      dealerOpsRows: OperationsDealerRow[]
      bankerRemarksRows: RankingRow[]
      reasonIfOuthouseRows: RankingRow[]
    }
    proformaDetails?: {
      pivots: ProformaPivot[]
    }
  }
  filterOptions: Record<FilterOptionKey, string[]>
  coverage: AmFinancePayload['coverage']
  sbiPendingTarget: number
  sbiPendingSummary?: SbiPendingSummary
  permissions?: AmFinancePermissions
  source?: {
    table: string
    analyticsSource: string
    mode: string
  }
}

type ReportColumn<T> = {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  className?: string
  value: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number | null | undefined
  heat?: (row: T) => boolean
  filter?: (row: T) => TableFilter | null
}

type TableFilter = {
  key: keyof Filters | 'month'
  value: string
  label?: string
}

const ANALYTICS_TABS: Array<{ key: AnalyticsSectionKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'payout-status', label: 'Payout & Status', icon: TrendingUp },
  { key: 'hyp-bank-analysis', label: 'HYP / Bank Analysis', icon: Banknote },
  { key: 'team-performance', label: 'Team Performance', icon: Users },
  { key: 'monthly-matrix', label: 'Monthly Matrix', icon: BarChart3 },
  { key: 'operations-compliance', label: 'Operations / Compliance', icon: ShieldCheck },
  { key: 'proforma-details', label: 'Proforma Details', icon: ClipboardCheck },
  { key: 'register', label: 'Register', icon: Table2 },
]

const STATUS_CHART_COLORS: Record<string, string> = {
  'IN HOUSE': '#8b6f5f',
  'OUT HOUSE': '#b7c77d',
  CASH: '#ff6f70',
  STAFF: '#66c7d5',
  PENDING: '#8b6f5f',
  'NO PAYOUT': '#b7c77d',
  Received: '#ff6f70',
}

const CHART_FALLBACK_COLORS = ['#8b6f5f', '#b7c77d', '#ff6f70', '#66c7d5', '#4f8f9f', '#e0a458', '#7a9e7e', '#cf6f85']

const FINANCE_SOLID_BUTTON_CLASS = 'border border-[color-mix(in_srgb,var(--dashboard-action-bg)_72%,transparent)] bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)] shadow-sm hover:bg-[var(--dashboard-action-hover)] hover:text-[var(--dashboard-action-fg)] disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none'
const FINANCE_SOLID_SOFT_BUTTON_CLASS = 'border border-[color-mix(in_srgb,var(--dashboard-primary)_60%,transparent)] bg-[linear-gradient(135deg,var(--dashboard-primary)_0%,var(--dashboard-action-bg)_100%)] text-white shadow-sm hover:bg-[var(--dashboard-action-hover)] hover:text-white disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none'
const FINANCE_TABLE_HEAD_CLASS = 'bg-[linear-gradient(135deg,var(--dashboard-action-bg)_0%,var(--dashboard-action-hover)_100%)] text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.18)]'

const EMPTY_FILTERS: Filters = {
  startDate: '',
  endDate: '',
  mainDealer: 'all',
  location: 'all',
  tl: 'all',
  salesExecutive: 'all',
  hyp: 'all',
  branch: 'all',
  payoutStatus: 'all',
  status: 'all',
  bankLogin: 'all',
  bankInProforma: 'all',
  bankerRemarks: 'all',
  reasonIfOuthouse: 'all',
}

const DETAIL_FIELDS: Array<{ key: keyof AmFinanceRow; label: string; format?: 'currency' | 'date' | 'datetime' | 'number' }> = [
  { key: 'deliveryDate', label: 'Delivery Date', format: 'date' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'mobileNo', label: 'Mobile No' },
  { key: 'model', label: 'Model' },
  { key: 'salesExecutive', label: 'Sales Executive' },
  { key: 'mainDealer', label: 'Main Dealer' },
  { key: 'location', label: 'Location' },
  { key: 'tl', label: 'TL' },
  { key: 'hyp', label: 'HYP' },
  { key: 'branch', label: 'Branch' },
  { key: 'loanAmount', label: 'Loan Amount', format: 'currency' },
  { key: 'panNumber', label: 'PAN Number' },
  { key: 'payoutStatus', label: 'Payout Status' },
  { key: 'reasonIfOuthouse', label: 'Reason If Outhouse' },
  { key: 'dealerPayoutPercent', label: 'Dealer Payout Percent' },
  { key: 'payoutAmount', label: 'Payout Amount', format: 'currency' },
  { key: 'status', label: 'Status' },
  { key: 'dsePayoutStatus', label: 'DSE Payout Status' },
  { key: 'dealerPayoutStatus', label: 'Dealer Payout Status' },
  { key: 'paymentReceivedDate', label: 'Payment Received Date', format: 'date' },
  { key: 'amountReceived', label: 'Amount Received', format: 'currency' },
  { key: 'invoiceNumber', label: 'Invoice Number' },
  { key: 'bankVisitScheduled', label: 'Bank Visit Scheduled' },
  { key: 'dateOfBankVisit', label: 'Date Of Bank Visit', format: 'date' },
  { key: 'visitedBy', label: 'Visited By' },
  { key: 'bankerRemarks', label: 'Banker Remarks' },
  { key: 'vehicleRegistrationNumberToSale', label: 'Vehicle Registration Number To Sale' },
  { key: 'hypAsPerRc', label: 'HYP As Per RC' },
  { key: 'startTime', label: 'Start Time' },
  { key: 'endTime', label: 'End Time' },
  { key: 'loginUser', label: 'Login User' },
  { key: 'bankIntRate', label: 'Bank Interest Rate', format: 'number' },
  { key: 'bankLogin', label: 'Bank Login' },
  { key: 'bankInProforma', label: 'Bank In Proforma' },
  { key: 'uploadedAt', label: 'Uploaded At', format: 'datetime' },
]

type FinanceFormKey =
  | 'deliveryDate'
  | 'customerName'
  | 'mobileNo'
  | 'model'
  | 'salesExecutive'
  | 'mainDealer'
  | 'location'
  | 'tl'
  | 'hyp'
  | 'branch'
  | 'loanAmount'
  | 'panNumber'
  | 'payoutStatus'
  | 'reasonIfOuthouse'
  | 'dealerPayoutPercent'
  | 'payoutAmount'
  | 'status'
  | 'dsePayoutStatus'
  | 'dealerPayoutStatus'
  | 'paymentReceivedDate'
  | 'amountReceived'
  | 'invoiceNumber'
  | 'bankVisitScheduled'
  | 'dateOfBankVisit'
  | 'visitedBy'
  | 'bankerRemarks'
  | 'vehicleRegistrationNumberToSale'
  | 'hypAsPerRc'
  | 'startTime'
  | 'bankIntRate'
  | 'bankLogin'
  | 'bankInProforma'

type FinanceFormState = Record<FinanceFormKey, string>

type FinanceFormField = {
  key: FinanceFormKey
  label: string
  section: 'Customer and Vehicle' | 'Dealer and Team' | 'Bank, Loan, and Branch' | 'Payout and Payment' | 'Bank Visit and RC Details' | 'Metadata'
  input?: 'date' | 'number' | 'textarea'
  optionsKey?: FilterOptionKey
  required?: boolean
}

const REQUIRED_FORM_KEYS = new Set<FinanceFormKey>([
  'deliveryDate',
  'customerName',
  'mobileNo',
  'model',
  'salesExecutive',
  'mainDealer',
  'location',
  'hyp',
  'branch',
  'loanAmount',
  'payoutStatus',
  'status',
])

const FINANCE_FORM_FIELDS: FinanceFormField[] = [
  { key: 'deliveryDate', label: 'Delivery Date', section: 'Customer and Vehicle', input: 'date', required: true },
  { key: 'customerName', label: 'Customer Name', section: 'Customer and Vehicle', required: true },
  { key: 'mobileNo', label: 'Mobile No', section: 'Customer and Vehicle', required: true },
  { key: 'model', label: 'Model', section: 'Customer and Vehicle', required: true },
  { key: 'vehicleRegistrationNumberToSale', label: 'Vehicle Registration Number To Sale', section: 'Customer and Vehicle' },
  { key: 'salesExecutive', label: 'Sales Executive', section: 'Dealer and Team', optionsKey: 'salesExecutives', required: true },
  { key: 'mainDealer', label: 'Main Dealer', section: 'Dealer and Team', optionsKey: 'mainDealers', required: true },
  { key: 'location', label: 'Location', section: 'Dealer and Team', optionsKey: 'locations', required: true },
  { key: 'tl', label: 'TL', section: 'Dealer and Team', optionsKey: 'tls' },
  { key: 'hyp', label: 'HYP Bank', section: 'Bank, Loan, and Branch', optionsKey: 'hyps', required: true },
  { key: 'branch', label: 'Branch', section: 'Bank, Loan, and Branch', optionsKey: 'branches', required: true },
  { key: 'loanAmount', label: 'Loan Amount', section: 'Bank, Loan, and Branch', input: 'number', required: true },
  { key: 'panNumber', label: 'PAN Number', section: 'Bank, Loan, and Branch' },
  { key: 'hypAsPerRc', label: 'HYP As Per RC', section: 'Bank, Loan, and Branch' },
  { key: 'bankIntRate', label: 'Bank Interest Rate', section: 'Bank, Loan, and Branch', input: 'number' },
  { key: 'bankLogin', label: 'Bank Login', section: 'Bank, Loan, and Branch', optionsKey: 'bankLogins' },
  { key: 'bankInProforma', label: 'Bank In Proforma', section: 'Bank, Loan, and Branch', optionsKey: 'bankInProformas' },
  { key: 'payoutStatus', label: 'Payout Status', section: 'Payout and Payment', optionsKey: 'payoutStatuses', required: true },
  { key: 'reasonIfOuthouse', label: 'Reason If Outhouse', section: 'Payout and Payment', input: 'textarea' },
  { key: 'dealerPayoutPercent', label: 'Dealer Payout Percent', section: 'Payout and Payment' },
  { key: 'payoutAmount', label: 'Payout Amount', section: 'Payout and Payment', input: 'number' },
  { key: 'status', label: 'Payment Status', section: 'Payout and Payment', optionsKey: 'statuses', required: true },
  { key: 'dsePayoutStatus', label: 'DSE Payout Status', section: 'Payout and Payment' },
  { key: 'dealerPayoutStatus', label: 'Dealer Payout Status', section: 'Payout and Payment' },
  { key: 'paymentReceivedDate', label: 'Payment Received Date', section: 'Payout and Payment', input: 'date' },
  { key: 'amountReceived', label: 'Amount Received', section: 'Payout and Payment', input: 'number' },
  { key: 'invoiceNumber', label: 'Invoice Number', section: 'Payout and Payment' },
  { key: 'bankVisitScheduled', label: 'Bank Visit Scheduled', section: 'Bank Visit and RC Details' },
  { key: 'dateOfBankVisit', label: 'Date Of Bank Visit', section: 'Bank Visit and RC Details', input: 'date' },
  { key: 'visitedBy', label: 'Visited By', section: 'Bank Visit and RC Details' },
  { key: 'bankerRemarks', label: 'Banker Remarks', section: 'Bank Visit and RC Details', input: 'textarea' },
  { key: 'startTime', label: 'Start Time', section: 'Metadata' },
]

const FORM_SECTIONS: FinanceFormField['section'][] = [
  'Customer and Vehicle',
  'Dealer and Team',
  'Bank, Loan, and Branch',
  'Payout and Payment',
  'Bank Visit and RC Details',
  'Metadata',
]

const EMPTY_FORM_STATE: FinanceFormState = {
  deliveryDate: '',
  customerName: '',
  mobileNo: '',
  model: '',
  salesExecutive: '',
  mainDealer: '',
  location: '',
  tl: '',
  hyp: '',
  branch: '',
  loanAmount: '',
  panNumber: '',
  payoutStatus: 'IN HOUSE',
  reasonIfOuthouse: '',
  dealerPayoutPercent: '',
  payoutAmount: '',
  status: 'PENDING',
  dsePayoutStatus: '',
  dealerPayoutStatus: '',
  paymentReceivedDate: '',
  amountReceived: '',
  invoiceNumber: '',
  bankVisitScheduled: '',
  dateOfBankVisit: '',
  visitedBy: '',
  bankerRemarks: '',
  vehicleRegistrationNumberToSale: '',
  hypAsPerRc: '',
  startTime: '',
  bankIntRate: '',
  bankLogin: '',
  bankInProforma: '',
}

const TABLE_COLUMNS: Array<{ key: SortKey; label: string; className?: string; value: (row: AmFinanceRow) => React.ReactNode }> = [
  { key: 'deliveryDate', label: 'Delivery', value: (row) => formatDate(row.deliveryDate) },
  { key: 'customerName', label: 'Customer', className: 'min-w-[210px]', value: (row) => (
    <div className="min-w-0">
      <p className="truncate font-black text-slate-950">{row.customerName || '-'}</p>
      <p className="mt-0.5 truncate text-[11px] font-bold text-slate-500">{row.mobileNo || '-'}</p>
    </div>
  ) },
  { key: 'mainDealer', label: 'Dealer', className: 'min-w-[170px]', value: (row) => row.mainDealer || '-' },
  { key: 'location', label: 'Location', className: 'min-w-[190px]', value: (row) => row.location || '-' },
  { key: 'hyp', label: 'Bank', className: 'min-w-[160px]', value: (row) => row.hyp || '-' },
  { key: 'loanAmount', label: 'Loan', value: (row) => formatCurrency(row.loanAmount) },
  { key: 'payoutAmount', label: 'Payout', value: (row) => formatCurrency(row.payoutAmount) },
  { key: 'amountReceived', label: 'Received', value: (row) => formatCurrency(row.amountReceived) },
  { key: 'status', label: 'Status', value: (row) => <StatusBadge value={row.status} /> },
  { key: 'payoutStatus', label: 'Payout Type', value: (row) => row.payoutStatus || '-' },
  { key: 'paymentReceivedDate', label: 'Paid On', value: (row) => formatDate(row.paymentReceivedDate) },
]

function formatCurrency(value: number | null | undefined) {
  const amount = Number(value || 0)
  return `Rs ${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString('en-IN')}`
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function formatPlainNumber(value: number | null | undefined, maximumFractionDigits = 0) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount.toLocaleString('en-IN', { maximumFractionDigits }) : '-'
}

function formatPercent(value: number | null | undefined, maximumFractionDigits = 1) {
  const amount = Number(value || 0)
  return `${Number.isFinite(amount) ? amount.toFixed(maximumFractionDigits) : '0'}%`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function displayStatus(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return 'Unassigned'
  if (normalized === 'RECEVIED' || normalized === 'RECEIVED') return 'Received'
  if (normalized === 'NO PAYOUT') return 'No Payout'
  return normalized.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
}

function isRealFilterValue(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase()
  return Boolean(normalized && normalized !== 'grand total' && normalized !== 'unspecified' && normalized !== 'unassigned' && normalized !== '-')
}

function tableFilter(key: TableFilter['key'], value: string | null | undefined, label?: string): TableFilter | null {
  if (!isRealFilterValue(value)) return null
  return { key, value: String(value).trim(), label }
}

function getMonthDateRange(label: string) {
  const [monthName, yearText] = label.trim().split(/\s+/)
  const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    .findIndex((month) => month.toLowerCase() === String(monthName || '').slice(0, 3).toLowerCase())
  const year = Number(yearText)
  if (monthIndex < 0 || !Number.isInteger(year) || year < 1900) return null
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 0)
  return {
    startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`,
    endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
  }
}

function displayReportLabel(value: string | null | undefined) {
  const text = String(value || '').trim()
  const normalized = text.toUpperCase()
  if (!text) return 'Unassigned'
  if (['RECEVIED', 'RECEIVED', 'NO PAYOUT', 'PENDING', 'IN HOUSE', 'OUT HOUSE', 'CASH', 'STAFF'].includes(normalized)) {
    return displayStatus(text)
  }
  return text
}

function statusClass(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'RECEVIED' || normalized === 'RECEIVED') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (normalized === 'PENDING') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (normalized === 'NO PAYOUT') return 'border-slate-200 bg-slate-100 text-slate-700'
  return 'border-cyan-200 bg-cyan-50 text-cyan-800'
}

function StatusBadge({ value }: { value: string | null | undefined }) {
  return (
    <Badge className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider shadow-none', statusClass(value))}>
      {displayStatus(value)}
    </Badge>
  )
}

function formatDetailValue(row: AmFinanceRow, field: typeof DETAIL_FIELDS[number]) {
  const value = row[field.key]
  if (field.format === 'currency') return formatCurrency(Number(value || 0))
  if (field.format === 'date') return formatDate(value as string | null)
  if (field.format === 'datetime') return formatDateTime(value as string | null)
  if (field.format === 'number') return formatNumber(value as number | null)
  return value === null || value === undefined || value === '' ? '-' : String(value)
}

function csvEscape(value: unknown) {
  const text = String(value ?? '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(rows: AmFinanceRow[]) {
  const headers = DETAIL_FIELDS.map((field) => field.label)
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => DETAIL_FIELDS
      .map((field) => csvEscape(formatDetailValue(row, field)))
      .join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `am-finance-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function newFormState() {
  return {
    ...EMPTY_FORM_STATE,
    startTime: new Date().toString(),
  }
}

function rowToFormState(row: AmFinanceRow): FinanceFormState {
  return {
    deliveryDate: row.deliveryDate || '',
    customerName: row.customerName || '',
    mobileNo: row.mobileNo || '',
    model: row.model || '',
    salesExecutive: row.salesExecutive || '',
    mainDealer: row.mainDealer || '',
    location: row.location || '',
    tl: row.tl || '',
    hyp: row.hyp || '',
    branch: row.branch || '',
    loanAmount: row.loanAmount ? String(row.loanAmount) : '',
    panNumber: row.panNumber || '',
    payoutStatus: row.payoutStatus || 'IN HOUSE',
    reasonIfOuthouse: row.reasonIfOuthouse || '',
    dealerPayoutPercent: row.dealerPayoutPercent || '',
    payoutAmount: row.payoutAmount ? String(row.payoutAmount) : '',
    status: row.status || 'PENDING',
    dsePayoutStatus: row.dsePayoutStatus || '',
    dealerPayoutStatus: row.dealerPayoutStatus || '',
    paymentReceivedDate: row.paymentReceivedDate || '',
    amountReceived: row.amountReceived ? String(row.amountReceived) : '',
    invoiceNumber: row.invoiceNumber || '',
    bankVisitScheduled: row.bankVisitScheduled || '',
    dateOfBankVisit: row.dateOfBankVisit || '',
    visitedBy: row.visitedBy || '',
    bankerRemarks: row.bankerRemarks || '',
    vehicleRegistrationNumberToSale: row.vehicleRegistrationNumberToSale || '',
    hypAsPerRc: row.hypAsPerRc || '',
    startTime: row.startTime || new Date().toString(),
    bankIntRate: row.bankIntRate === null || row.bankIntRate === undefined ? '' : String(row.bankIntRate),
    bankLogin: row.bankLogin || '',
    bankInProforma: row.bankInProforma || '',
  }
}

function parsePayoutMultiplier(value: string) {
  const raw = value.trim()
  if (!raw) return null
  const normalized = raw.endsWith('%') ? raw.slice(0, -1) : raw
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) return null
  return raw.endsWith('%') ? amount / 100 : amount
}

function calculatePayoutPreview(form: FinanceFormState) {
  const loanAmount = Number(form.loanAmount)
  const multiplier = parsePayoutMultiplier(form.dealerPayoutPercent)
  if (!Number.isFinite(loanAmount) || loanAmount < 0 || multiplier === null) return ''
  return String(Math.round(loanAmount * multiplier * 100) / 100)
}

function mergeUniqueOptions(base: string[], additions: string[]) {
  return Array.from(new Set([...base, ...additions].map((value) => value.trim()).filter(Boolean)))
}

function DatalistInput({
  id,
  value,
  options,
  onChange,
  disabled,
  type = 'text',
}: {
  id: string
  value: string
  options: string[]
  onChange: (value: string) => void
  disabled?: boolean
  type?: string
}) {
  const listId = `${id}-options`

  return (
    <>
      <Input
        type={type}
        value={value}
        list={options.length > 0 ? listId : undefined}
        disabled={disabled}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? 'any' : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-lg border-slate-200 bg-white text-xs font-bold shadow-sm disabled:bg-slate-100"
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </>
  )
}

function FinanceFormDialog({
  open,
  mode,
  row,
  currentUser,
  permissions,
  filterOptions,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  mode: 'create' | 'edit'
  row: AmFinanceRow | null
  currentUser: CurrentUser
  permissions: AmFinancePermissions
  filterOptions: AmFinancePayload['filterOptions'] | null
  onOpenChange: (open: boolean) => void
  onSaved: (row: AmFinanceRow) => void
}) {
  const [form, setForm] = useState<FinanceFormState>(newFormState)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [duplicates, setDuplicates] = useState<DuplicateRow[]>([])
  const [duplicateLoading, setDuplicateLoading] = useState(false)
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'developer'

  useEffect(() => {
    if (!open) return
    setErrors({})
    setDuplicates([])
    setForm(mode === 'edit' && row ? rowToFormState(row) : newFormState())
  }, [mode, open, row])

  const calculatedPayout = useMemo(() => calculatePayoutPreview(form), [form])

  useEffect(() => {
    if (!open) return
    if (isAdmin && form.payoutAmount) return
    if (calculatedPayout && form.payoutAmount !== calculatedPayout) {
      setForm((current) => ({ ...current, payoutAmount: calculatedPayout }))
    }
  }, [calculatedPayout, form.payoutAmount, isAdmin, open])

  useEffect(() => {
    if (!open) return
    const mobileDigits = form.mobileNo.replace(/\D/g, '')
    if (mobileDigits.length < 6) {
      setDuplicates([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setDuplicateLoading(true)
      try {
        const params = new URLSearchParams({ mobileNo: form.mobileNo })
        if (mode === 'edit' && row?.id) params.set('excludeId', String(row.id))
        const response = await fetch(`/api/am-finance/duplicates?${params.toString()}`, { signal: controller.signal })
        const data = await response.json()
        if (response.ok) setDuplicates(data.rows || [])
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setDuplicates([])
      } finally {
        setDuplicateLoading(false)
      }
    }, 350)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [form.mobileNo, mode, open, row?.id])

  const setField = (key: FinanceFormKey, value: string) => {
    setErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setForm((current) => ({ ...current, [key]: value }))
  }

  const isFieldDisabled = (key: FinanceFormKey) => {
    if (saving) return true
    if (key === 'payoutAmount' && !isAdmin) return true
    if (mode === 'edit' && !isAdmin && ['dealerPayoutPercent', 'bankIntRate', 'bankLogin'].includes(key)) return true
    return false
  }

  const validateClient = () => {
    const nextErrors: Record<string, string> = {}
    REQUIRED_FORM_KEYS.forEach((key) => {
      if (!form[key].trim()) nextErrors[key] = 'Required'
    })
    if (form.payoutStatus.trim().toUpperCase() === 'OUT HOUSE' && !form.reasonIfOuthouse.trim()) {
      nextErrors.reasonIfOuthouse = 'Required for OUT HOUSE'
    }
    const status = form.status.trim().toUpperCase()
    if ((status === 'RECEIVED' || status === 'RECEVIED') && (!form.paymentReceivedDate || !form.amountReceived)) {
      if (!form.paymentReceivedDate) nextErrors.paymentReceivedDate = 'Required for received cases'
      if (!form.amountReceived) nextErrors.amountReceived = 'Required for received cases'
    }
    return nextErrors
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const clientErrors = validateClient()
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors)
      return
    }

    setSaving(true)
    setErrors({})
    try {
      const response = await fetch('/api/am-finance', {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'create' ? form : { ...form, id: row?.id }),
      })
      const data = await response.json()

      if (!response.ok) {
        if (data?.fields) setErrors(data.fields)
        throw new Error(data?.error || 'Failed to save AM Finance entry')
      }

      onSaved(data.row)
      onOpenChange(false)
    } catch (error) {
      setErrors((current) => ({
        ...current,
        form: error instanceof Error ? error.message : 'Failed to save AM Finance entry',
      }))
    } finally {
      setSaving(false)
    }
  }

  const optionsForField = (field: FinanceFormField) => {
    const source = field.optionsKey && filterOptions ? filterOptions[field.optionsKey] || [] : []
    const defaults = field.key === 'payoutStatus'
      ? ['IN HOUSE', 'OUT HOUSE', 'CASH', 'STAFF']
      : field.key === 'status'
        ? ['PENDING', 'NO PAYOUT', 'RECEVIED', 'RECEIVED']
        : []
    return mergeUniqueOptions(source, defaults)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto rounded-lg border-white/70 bg-white p-0 shadow-2xl">
        <DialogHeader className="border-b border-teal-900/10 bg-gradient-to-br from-slate-950 via-teal-950 to-slate-900 p-6 pr-14 text-white">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
            {mode === 'create' ? 'New Finance Entry' : 'Edit Finance Entry'}
          </p>
          <DialogTitle className="mt-2 text-2xl font-black tracking-tight text-white">
            {mode === 'create' ? 'AM Finance Form' : row?.customerName || `Record #${row?.id}`}
          </DialogTitle>
          <DialogDescription className="mt-2 font-semibold text-white/75">
            {mode === 'create' ? currentUser.fullName : `${row?.mainDealer || '-'} - ${row?.location || '-'}`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5 p-5">
          {errors.form && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
              {errors.form}
            </div>
          )}

          {duplicates.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                Duplicate mobile warning
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {duplicates.map((duplicate) => (
                  <div key={duplicate.id} className="rounded-lg border border-amber-200 bg-white/80 p-3 text-xs font-bold text-slate-700">
                    <p className="font-black text-slate-950">{duplicate.customerName || '-'}</p>
                    <p className="mt-1">{duplicate.model || '-'} - {duplicate.mainDealer || '-'}</p>
                    <p className="mt-1 text-slate-500">{formatDate(duplicate.deliveryDate)} - {displayStatus(duplicate.status)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {duplicateLoading && (
            <div className="flex items-center gap-2 text-xs font-black text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking mobile number
            </div>
          )}

          {FORM_SECTIONS.map((section) => (
            <section key={section} className="rounded-lg border border-slate-200 bg-slate-50/65 p-4">
              <h3 className="text-sm font-black text-slate-950">{section}</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {FINANCE_FORM_FIELDS.filter((field) => field.section === section).map((field) => (
                  <FieldLabel key={field.key} label={`${field.label}${field.required ? ' *' : ''}`}>
                    {field.input === 'textarea' ? (
                      <Textarea
                        value={form[field.key]}
                        disabled={isFieldDisabled(field.key)}
                        onChange={(event) => setField(field.key, event.target.value)}
                        className="min-h-24 rounded-lg border-slate-200 bg-white text-xs font-bold shadow-sm disabled:bg-slate-100"
                      />
                    ) : (
                      <DatalistInput
                        id={`am-finance-${field.key}`}
                        type={field.input || 'text'}
                        value={form[field.key]}
                        options={optionsForField(field)}
                        disabled={isFieldDisabled(field.key)}
                        onChange={(value) => setField(field.key, value)}
                      />
                    )}
                    {errors[field.key] && (
                      <span className="mt-1 block text-[11px] font-black text-rose-600">{errors[field.key]}</span>
                    )}
                  </FieldLabel>
                ))}
              </div>
            </section>
          ))}

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-bold text-slate-500">
              Calculated payout: <span className="font-black text-slate-950">{calculatedPayout ? formatCurrency(Number(calculatedPayout)) : '-'}</span>
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => onOpenChange(false)} className={cn('h-10 rounded-lg px-4 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || (!permissions.create && mode === 'create') || (!permissions.edit && mode === 'edit')}
                className={cn('h-10 rounded-lg px-4 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Banknote
  tone: string
}) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/88 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-2 truncate font-mono text-2xl font-black text-slate-950">{value}</p>
          <p className="mt-1 truncate text-xs font-bold text-slate-500">{detail}</p>
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', tone)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <FieldLabel label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white text-xs font-bold shadow-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[200] rounded-lg border border-slate-200 bg-white shadow-xl">
          <SelectItem value="all">All</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldLabel>
  )
}

function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-full bg-slate-200/80', className)} />
}

function FinancePanelShell({
  title,
  subtitle,
  meta,
  children,
  fullscreenChildren,
  className,
  bodyClassName,
  fullscreenBodyClassName,
}: {
  title: string
  subtitle?: string
  meta?: React.ReactNode
  children: React.ReactNode
  fullscreenChildren?: React.ReactNode
  className?: string
  bodyClassName?: string
  fullscreenBodyClassName?: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <section className={cn('overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--dashboard-primary-border)_70%,transparent)] bg-white shadow-sm shadow-slate-200/70', className)}>
        <div className="flex flex-col gap-3 border-b border-[color-mix(in_srgb,var(--dashboard-primary-border)_55%,transparent)] bg-[linear-gradient(135deg,#ffffff_0%,var(--dashboard-primary-soft)_48%,#ffffff_100%)] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-black text-slate-950">{title}</h2>
            {subtitle && <p className="mt-1 truncate text-xs font-semibold text-slate-500">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {meta}
            <Button
              type="button"
              onClick={() => setExpanded(true)}
              className={cn('h-8 rounded-lg px-2 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}
              aria-label={`Maximize ${title}`}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className={bodyClassName}>{children}</div>
      </section>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] grid-rows-[auto_1fr] overflow-hidden rounded-xl border-white/70 bg-white p-0 shadow-2xl">
          <DialogHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950 p-5 pr-14 text-white">
            <DialogTitle className="text-xl font-black text-white">{title}</DialogTitle>
            <DialogDescription className="font-semibold text-white/70">{subtitle || 'Expanded finance analytics view'}</DialogDescription>
          </DialogHeader>
          <div className={cn('min-h-0 overflow-auto p-4', fullscreenBodyClassName)}>
            {fullscreenChildren || children}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FinanceReportTableSkeleton({
  title = 'Loading report',
  columns = 6,
  rows = 10,
}: {
  title?: string
  columns?: number
  rows?: number
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/70">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div>
          <SkeletonLine className="h-4 w-36" />
          <SkeletonLine className="mt-2 h-3 w-24" />
        </div>
        <SkeletonLine className="h-8 w-8 rounded-lg" />
      </div>
      <div className="overflow-hidden p-4" aria-label={title}>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(90px, 1fr))` }}>
          {Array.from({ length: columns }).map((_, index) => <SkeletonLine key={`head-${index}`} className="h-8 rounded-md bg-slate-200" />)}
          {Array.from({ length: rows * columns }).map((_, index) => <SkeletonLine key={`cell-${index}`} className="h-7 rounded-md bg-slate-100" />)}
        </div>
      </div>
    </section>
  )
}

function FinanceVisualSkeleton() {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/70">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div>
          <SkeletonLine className="h-4 w-40" />
          <SkeletonLine className="mt-2 h-3 w-28" />
        </div>
        <SkeletonLine className="h-8 w-8 rounded-lg" />
      </div>
      <div className="space-y-4 p-4">
        <SkeletonLine className="h-8 w-32 rounded-md" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <div className="flex justify-between">
              <SkeletonLine className="h-3 w-28" />
              <SkeletonLine className="h-3 w-14" />
            </div>
            <SkeletonLine className="h-3 w-full" />
          </div>
        ))}
      </div>
    </section>
  )
}

function FinanceKpiSkeleton() {
  return (
    <div className="rounded-xl border border-white/70 bg-white/85 p-4 shadow-sm shadow-slate-200/70">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <SkeletonLine className="h-3 w-24" />
          <SkeletonLine className="mt-4 h-8 w-32 rounded-md" />
          <SkeletonLine className="mt-3 h-3 w-40" />
        </div>
        <SkeletonLine className="h-10 w-10 rounded-lg" />
      </div>
    </div>
  )
}

function FinanceDashboardSkeleton() {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <FinanceKpiSkeleton key={index} />)}
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <FinanceReportTableSkeleton columns={3} rows={4} />
        <FinanceVisualSkeleton />
        <FinanceReportTableSkeleton columns={6} rows={4} />
        <FinanceVisualSkeleton />
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <FinanceReportTableSkeleton columns={4} rows={6} />
        <FinanceReportTableSkeleton columns={8} rows={7} />
      </section>
    </div>
  )
}

function FinanceRegisterSkeleton() {
  return (
    <FinancePanelShell
      title="Finance Register"
      subtitle="Loading register rows"
      bodyClassName="p-4"
      fullscreenBodyClassName="p-4"
      fullscreenChildren={<FinanceReportTableSkeleton title="Loading register fullscreen" columns={12} rows={16} />}
    >
      <FinanceReportTableSkeleton title="Loading register" columns={12} rows={10} />
    </FinancePanelShell>
  )
}

function compareReportValues(a: string | number | null | undefined, b: string | number | null | undefined, direction: 'asc' | 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1
  if (typeof a === 'number' || typeof b === 'number') {
    return ((Number(a || 0) - Number(b || 0)) || String(a || '').localeCompare(String(b || ''))) * multiplier
  }
  return String(a || '').localeCompare(String(b || '')) * multiplier
}

function FinanceReportTable<T extends object>({
  title,
  subtitle,
  rows,
  columns,
  grandTotal,
  pageSize = 12,
  minWidth = 920,
  labelFilterKey,
  onFilter,
}: {
  title: string
  subtitle?: string
  rows: T[]
  columns: ReportColumn<T>[]
  grandTotal?: T
  pageSize?: number
  minWidth?: number
  labelFilterKey?: TableFilter['key']
  onFilter?: (filter: TableFilter) => void
}) {
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows
    const column = columns.find((item) => item.key === sortKey) || columns[0]
    if (!column) return rows
    return [...rows].sort((a, b) => compareReportValues(column.sortValue?.(a), column.sortValue?.(b), sortDir))
  }, [columns, rows, sortDir, sortKey])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const visibleRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  const changeSort = (column: ReportColumn<T>) => {
    setPage(1)
    if (sortKey === column.key) {
      setSortDir((current) => current === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(column.key)
      setSortDir('desc')
    }
  }

  const getCellFilter = (row: T, column: ReportColumn<T>) => {
    const explicitFilter = column.filter?.(row)
    if (explicitFilter) return explicitFilter
    if (!labelFilterKey || column.key !== 'label') return null
    const label = 'label' in row ? String((row as { label?: unknown }).label || '') : ''
    return tableFilter(labelFilterKey, label)
  }

  const renderCellValue = (row: T, column: ReportColumn<T>) => {
    const value = column.value(row)
    const applyFilter = onFilter
    const filter = applyFilter ? getCellFilter(row, column) : null
    if (!applyFilter || !filter) return value

    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          applyFilter(filter)
        }}
        className="inline-flex max-w-full items-center justify-center rounded-md px-1.5 py-1 text-center font-black text-[var(--dashboard-action-bg)] underline-offset-2 transition hover:bg-[color-mix(in_srgb,var(--dashboard-action-bg)_12%,white)] hover:underline"
        title={`Filter by ${filter.label || filter.value}`}
      >
        <span className="break-words leading-tight">{value}</span>
      </button>
    )
  }

  const renderTable = (isFullscreen = false) => (
    <div className={cn('overflow-auto', isFullscreen && 'max-h-[calc(94vh-150px)]')}>
      <table className="w-full table-fixed border-collapse text-[11px]" style={{ minWidth: isFullscreen ? minWidth : '100%' }}>
        <thead className="sticky top-0 z-20">
          <tr className={FINANCE_TABLE_HEAD_CLASS}>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'border border-slate-300/70 px-2 py-2 text-center align-middle text-[10px] font-black uppercase leading-tight tracking-[0.06em]',
                  column.className
                )}
              >
                <button
                  type="button"
                  onClick={() => changeSort(column)}
                  className={cn(
                    'inline-flex w-full items-center justify-center gap-1 whitespace-normal text-center text-[10px] font-black leading-tight text-white/95 transition hover:text-white'
                  )}
                >
                  <span className="break-words">{column.label}</span>
                  {sortKey === column.key ? (
                    sortDir === 'asc' ? <ArrowUp className="h-3 w-3 shrink-0 text-white" /> : <ArrowDown className="h-3 w-3 shrink-0 text-white" />
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => (
            <tr key={`${safePage}-${index}`} className="group odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)] hover:bg-[color-mix(in_srgb,var(--dashboard-action-bg)_10%,white)]">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'border border-slate-300 px-2 py-1.5 text-center align-middle text-[11px] font-bold leading-tight text-slate-900 transition',
                    column.heat?.(row) && 'bg-rose-100 text-rose-900 ring-1 ring-inset ring-rose-200'
                  )}
                >
                  {renderCellValue(row, column)}
                </td>
              ))}
            </tr>
          ))}
          {visibleRows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-sm font-bold text-slate-500">
                No rows match the selected filters.
              </td>
            </tr>
          )}
        </tbody>
        {grandTotal && (
          <tfoot className="sticky bottom-0 z-10 shadow-[0_-6px_18px_rgba(15,23,42,0.18)]">
            <tr>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'border border-white/20 px-2 py-2 text-center align-middle text-[11px] font-black leading-tight text-[var(--dashboard-action-fg)]'
                  )}
                  style={{
                    background: 'linear-gradient(135deg, var(--dashboard-action-bg) 0%, var(--dashboard-action-hover) 100%)',
                    color: 'var(--dashboard-action-fg)',
                  }}
                >
                  {column.value(grandTotal)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )

  const tableMeta = (
    <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
      <span>{rows.length.toLocaleString('en-IN')} rows</span>
      <Button
        type="button"
        onClick={() => setPage((current) => Math.max(1, current - 1))}
        disabled={safePage <= 1}
        className={cn('h-8 rounded-lg px-2 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}
      >
        Prev
      </Button>
      <span className="min-w-14 text-center font-mono">{safePage} / {totalPages}</span>
      <Button
        type="button"
        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
        disabled={safePage >= totalPages}
        className={cn('h-8 rounded-lg px-2 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}
      >
        Next
      </Button>
    </div>
  )

  return (
    <FinancePanelShell
      title={title}
      subtitle={subtitle}
      meta={tableMeta}
      bodyClassName="bg-white"
      fullscreenBodyClassName="p-0"
      fullscreenChildren={renderTable(true)}
    >
      {renderTable(false)}
    </FinancePanelShell>
  )
}

function FinanceSummaryPanel({
  title,
  rows,
  valueKey = 'totalCase',
  subtitle,
  limit = 8,
}: {
  title: string
  rows: FinanceMetricRow[]
  valueKey?: keyof Pick<FinanceMetricRow, 'totalCase' | 'loanAmount' | 'payoutAmount' | 'amountReceived'>
  subtitle?: string
  limit?: number
}) {
  const data = rows
    .filter((row) => Number(row[valueKey] || 0) > 0)
    .map((row, index) => ({
      name: displayStatus(row.label),
      rawLabel: row.label,
      value: Number(row[valueKey] || 0),
      color: STATUS_CHART_COLORS[row.label] || CHART_FALLBACK_COLORS[index % CHART_FALLBACK_COLORS.length],
    }))
  const total = data.reduce((sum, row) => sum + row.value, 0)
  const visibleRows = data.slice(0, limit)

  const renderSummary = (isFullscreen = false) => (
    <div className={cn('grid gap-4 p-4 lg:grid-cols-[minmax(220px,0.95fr)_minmax(0,1.05fr)]', isFullscreen && 'mx-auto max-w-6xl items-center')}>
      <div className={cn('relative mx-auto h-[280px] w-full min-w-0 max-w-[300px]', isFullscreen && 'h-[430px] max-w-[430px]')}>
        {visibleRows.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={visibleRows}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="84%"
                  paddingAngle={2}
                  cornerRadius={10}
                  stroke="#ffffff"
                  strokeWidth={3}
                >
                  {visibleRows.map((entry) => (
                    <Cell key={entry.rawLabel} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [formatPlainNumber(Number(value)), String(name)]}
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid rgba(148, 163, 184, 0.35)',
                    boxShadow: '0 18px 45px rgba(15, 23, 42, 0.18)',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-[28%] flex flex-col items-center justify-center rounded-full bg-white/90 text-center shadow-[inset_0_0_0_1px_rgba(148,163,184,0.22)]">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Total</p>
              <p className="mt-1 font-mono text-2xl font-black text-slate-950">{formatPlainNumber(total)}</p>
              <p className="mt-1 max-w-[120px] truncate text-[11px] font-black text-[var(--dashboard-primary)]">{visibleRows[0]?.name || '-'}</p>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-500">
            No data
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--dashboard-primary)]">Top Group</p>
            <p className="mt-2 truncate text-lg font-black text-slate-950">{visibleRows[0]?.name || '-'}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Categories</p>
            <p className="mt-2 font-mono text-2xl font-black text-slate-950">{data.length.toLocaleString('en-IN')}</p>
          </div>
        </div>

        {visibleRows.map((entry) => {
          const percent = total > 0 ? (entry.value / total) * 100 : 0
          return (
            <div key={entry.name} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
              <span className="flex min-w-0 items-center gap-2 text-xs font-black text-slate-800">
                <span className="h-3 w-3 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: entry.color }} />
                <span className="truncate">{entry.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-xs font-black text-slate-950">{formatPlainNumber(entry.value)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 font-mono text-[10px] font-black text-slate-600">{formatPercent(percent, 1)}</span>
              </span>
            </div>
          )
        })}
        {visibleRows.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">
            No summary data for the selected filters.
          </div>
        )}
      </div>
    </div>
  )

  return (
    <FinancePanelShell
      title={title}
      subtitle={subtitle || `${data.length.toLocaleString('en-IN')} categories`}
      bodyClassName="bg-white"
      fullscreenChildren={renderSummary(true)}
    >
      {renderSummary(false)}
    </FinancePanelShell>
  )
}

function metricGrandTotal(label: string, rows: FinanceMetricRow[]): FinanceMetricRow {
  const totalCase = rows.reduce((sum, row) => sum + row.totalCase, 0)
  const loanAmount = rows.reduce((sum, row) => sum + row.loanAmount, 0)
  const payoutAmount = rows.reduce((sum, row) => sum + row.payoutAmount, 0)
  const amountReceived = rows.reduce((sum, row) => sum + row.amountReceived, 0)
  const inhouseCount = rows.reduce((sum, row) => sum + row.inhouseCount, 0)
  const dsePayoutStatus = rows.reduce((sum, row) => sum + row.dsePayoutStatus, 0)
  const dealerPayoutStatus = rows.reduce((sum, row) => sum + row.dealerPayoutStatus, 0)
  const avgPayoutWeight = rows.reduce((sum, row) => sum + (row.avgPayout * row.totalCase), 0)
  const bankRateRows = rows.filter((row) => row.bankIntRate !== null && row.totalCase > 0)
  const bankRateWeight = bankRateRows.reduce((sum, row) => sum + ((row.bankIntRate || 0) * row.totalCase), 0)

  return {
    label,
    totalCase,
    contribution: 100,
    loanAmount,
    avgTicketSize: totalCase > 0 ? loanAmount / totalCase : 0,
    avgPayout: totalCase > 0 ? avgPayoutWeight / totalCase : 0,
    inhouseCount,
    inHousePercent: totalCase > 0 ? (inhouseCount / totalCase) * 100 : 0,
    dsePayoutStatus,
    dealerPayoutStatus,
    payoutAmount,
    amountReceived,
    bankIntRate: totalCase > 0 && bankRateRows.length > 0 ? bankRateWeight / bankRateRows.reduce((sum, row) => sum + row.totalCase, 0) : null,
  }
}

function rankingGrandTotal(label: string, rows: RankingRow[]): RankingRow {
  return {
    label,
    totalCase: rows.reduce((sum, row) => sum + row.totalCase, 0),
    contribution: 100,
  }
}

function monthHypGrandTotal(rows: MonthHypMetricRow[]): MonthHypMetricRow {
  return {
    ...metricGrandTotal('Grand total', rows),
    month: 'Grand total',
    hyp: '',
    status: '',
  }
}

function operationsGrandTotal(rows: OperationsDealerRow[]): OperationsDealerRow {
  return {
    label: 'Grand total',
    totalCase: rows.reduce((sum, row) => sum + row.totalCase, 0),
    contribution: 100,
    bankScheduleVisit: rows.reduce((sum, row) => sum + row.bankScheduleVisit, 0),
    visited: rows.reduce((sum, row) => sum + row.visited, 0),
    vehicleRegistrationCount: rows.reduce((sum, row) => sum + row.vehicleRegistrationCount, 0),
    hypAsPerRcCount: rows.reduce((sum, row) => sum + row.hypAsPerRcCount, 0),
    hypMismatchCount: rows.reduce((sum, row) => sum + row.hypMismatchCount, 0),
  }
}

const COMPACT_METRIC_COLUMNS: ReportColumn<FinanceMetricRow>[] = [
  { key: 'label', label: 'Name', value: (row) => displayReportLabel(row.label), sortValue: (row) => row.label, className: 'min-w-[170px]' },
  { key: 'totalCase', label: 'Total Case', align: 'right', value: (row) => formatPlainNumber(row.totalCase), sortValue: (row) => row.totalCase },
  { key: 'contribution', label: 'Contribution', align: 'right', value: (row) => formatPercent(row.contribution, 1), sortValue: (row) => row.contribution },
  { key: 'avgTicketSize', label: 'Avg Ticket Size', align: 'right', value: (row) => formatCurrency(row.avgTicketSize), sortValue: (row) => row.avgTicketSize },
]

const PAYOUT_METRIC_COLUMNS: ReportColumn<FinanceMetricRow>[] = [
  { key: 'label', label: 'Payout Status', value: (row) => displayStatus(row.label), sortValue: (row) => row.label, className: 'min-w-[160px]' },
  { key: 'totalCase', label: 'Total Case', align: 'right', value: (row) => formatPlainNumber(row.totalCase), sortValue: (row) => row.totalCase },
  { key: 'contribution', label: 'Contribution', align: 'right', value: (row) => formatPercent(row.contribution, 2), sortValue: (row) => row.contribution },
]

const PAYMENT_METRIC_COLUMNS: ReportColumn<FinanceMetricRow>[] = [
  { key: 'label', label: 'Status', value: (row) => displayStatus(row.label), sortValue: (row) => row.label, className: 'min-w-[150px]' },
  { key: 'totalCase', label: 'Total Case', align: 'right', value: (row) => formatPlainNumber(row.totalCase), sortValue: (row) => row.totalCase },
  { key: 'contribution', label: 'Contribution', align: 'right', value: (row) => formatPercent(row.contribution, 2), sortValue: (row) => row.contribution },
  { key: 'dsePayoutStatus', label: 'DSE Payout Status', align: 'right', value: (row) => formatCurrency(row.dsePayoutStatus), sortValue: (row) => row.dsePayoutStatus },
  { key: 'dealerPayoutStatus', label: 'Dealer Payout Status', align: 'right', value: (row) => formatCurrency(row.dealerPayoutStatus), sortValue: (row) => row.dealerPayoutStatus },
  { key: 'payoutAmount', label: 'Payout Amount', align: 'right', value: (row) => formatCurrency(row.payoutAmount), sortValue: (row) => row.payoutAmount },
]

const FULL_METRIC_COLUMNS: ReportColumn<FinanceMetricRow>[] = [
  { key: 'label', label: 'Name', value: (row) => displayReportLabel(row.label), sortValue: (row) => row.label, className: 'min-w-[170px]' },
  { key: 'avgPayout', label: 'Avg Payout', align: 'right', value: (row) => formatPercent(row.avgPayout, 1), sortValue: (row) => row.avgPayout },
  { key: 'totalCase', label: 'Total Case', align: 'right', value: (row) => formatPlainNumber(row.totalCase), sortValue: (row) => row.totalCase },
  { key: 'contribution', label: 'Contribution', align: 'right', value: (row) => formatPercent(row.contribution, 1), sortValue: (row) => row.contribution },
  { key: 'inhouseCount', label: 'Inhouse Count', align: 'right', value: (row) => formatPlainNumber(row.inhouseCount), sortValue: (row) => row.inhouseCount },
  {
    key: 'inHousePercent',
    label: 'In House %',
    align: 'right',
    value: (row) => formatPercent(row.inHousePercent, 0),
    sortValue: (row) => row.inHousePercent,
    heat: (row) => row.inHousePercent < 70 && row.totalCase > 0,
  },
  { key: 'dsePayoutStatus', label: 'DSE Payout Status', align: 'right', value: (row) => formatCurrency(row.dsePayoutStatus), sortValue: (row) => row.dsePayoutStatus },
  { key: 'dealerPayoutStatus', label: 'Dealer Payout Status', align: 'right', value: (row) => formatCurrency(row.dealerPayoutStatus), sortValue: (row) => row.dealerPayoutStatus },
  { key: 'payoutAmount', label: 'Payout Amount', align: 'right', value: (row) => formatCurrency(row.payoutAmount), sortValue: (row) => row.payoutAmount },
]

const HYP_COLUMNS: ReportColumn<FinanceMetricRow>[] = [
  { key: 'label', label: 'HYP', value: (row) => displayReportLabel(row.label), sortValue: (row) => row.label, className: 'min-w-[170px]' },
  { key: 'totalCase', label: 'Total Case', align: 'right', value: (row) => formatPlainNumber(row.totalCase), sortValue: (row) => row.totalCase },
  { key: 'contribution', label: 'Contribution', align: 'right', value: (row) => formatPercent(row.contribution, 0), sortValue: (row) => row.contribution },
  { key: 'inhouseCount', label: 'Inhouse Count', align: 'right', value: (row) => formatPlainNumber(row.inhouseCount), sortValue: (row) => row.inhouseCount },
  {
    key: 'inHousePercent',
    label: 'In House %',
    align: 'right',
    value: (row) => formatPercent(row.inHousePercent, 0),
    sortValue: (row) => row.inHousePercent,
    heat: (row) => row.inHousePercent < 70 && row.totalCase > 0,
  },
  { key: 'avgTicketSize', label: 'Avg Ticket Size', align: 'right', value: (row) => formatCurrency(row.avgTicketSize), sortValue: (row) => row.avgTicketSize },
  { key: 'loanAmount', label: 'Loan Amount', align: 'right', value: (row) => formatCurrency(row.loanAmount), sortValue: (row) => row.loanAmount },
  { key: 'bankIntRate', label: 'Bank Int Rate', align: 'right', value: (row) => row.bankIntRate === null ? 'No data' : formatNumber(row.bankIntRate), sortValue: (row) => row.bankIntRate || 0 },
]

const MONTH_COLUMNS: ReportColumn<FinanceMetricRow>[] = [
  { key: 'label', label: 'Month', value: (row) => row.label, sortValue: (row) => row.label, className: 'min-w-[130px]' },
  { key: 'avgPayout', label: 'Avg Payout', align: 'right', value: (row) => formatPercent(row.avgPayout, 1), sortValue: (row) => row.avgPayout },
  { key: 'totalCase', label: 'Total Case', align: 'right', value: (row) => formatPlainNumber(row.totalCase), sortValue: (row) => row.totalCase },
  { key: 'contribution', label: 'Contribution', align: 'right', value: (row) => formatPercent(row.contribution, 0), sortValue: (row) => row.contribution },
  { key: 'inhouseCount', label: 'Inhouse Count', align: 'right', value: (row) => formatPlainNumber(row.inhouseCount), sortValue: (row) => row.inhouseCount },
  {
    key: 'inHousePercent',
    label: 'In House %',
    align: 'right',
    value: (row) => formatPercent(row.inHousePercent, 2),
    sortValue: (row) => row.inHousePercent,
    heat: (row) => row.inHousePercent < 70 && row.totalCase > 0,
  },
  { key: 'dsePayoutStatus', label: 'DSE Payout Status', align: 'right', value: (row) => formatCurrency(row.dsePayoutStatus), sortValue: (row) => row.dsePayoutStatus },
  { key: 'dealerPayoutStatus', label: 'Dealer Payout Status', align: 'right', value: (row) => formatCurrency(row.dealerPayoutStatus), sortValue: (row) => row.dealerPayoutStatus },
]

const MONTH_HYP_COLUMNS: ReportColumn<MonthHypMetricRow>[] = [
  { key: 'month', label: 'Month', value: (row) => row.month, sortValue: (row) => row.month, className: 'min-w-[120px]', filter: (row) => tableFilter('month', row.month) },
  { key: 'status', label: 'Status', value: (row) => displayStatus(row.status), sortValue: (row) => row.status, filter: (row) => tableFilter('status', row.status) },
  { key: 'hyp', label: 'HYP', value: (row) => displayReportLabel(row.hyp), sortValue: (row) => row.hyp, className: 'min-w-[170px]', filter: (row) => tableFilter('hyp', row.hyp) },
  ...FULL_METRIC_COLUMNS.slice(1),
]

const OPERATIONS_COLUMNS: ReportColumn<OperationsDealerRow>[] = [
  { key: 'label', label: 'Main Dealer', value: (row) => row.label, sortValue: (row) => row.label, className: 'min-w-[170px]' },
  { key: 'totalCase', label: 'Total Case', align: 'right', value: (row) => formatPlainNumber(row.totalCase), sortValue: (row) => row.totalCase },
  { key: 'bankScheduleVisit', label: 'Bank Schedule Visit', align: 'right', value: (row) => formatPlainNumber(row.bankScheduleVisit), sortValue: (row) => row.bankScheduleVisit },
  { key: 'visited', label: 'Visited', align: 'right', value: (row) => formatPlainNumber(row.visited), sortValue: (row) => row.visited },
  { key: 'vehicleRegistrationCount', label: 'Vehicle Registration Number To Sale', align: 'right', value: (row) => formatPlainNumber(row.vehicleRegistrationCount), sortValue: (row) => row.vehicleRegistrationCount },
  { key: 'hypAsPerRcCount', label: 'HYP As Per RC', align: 'right', value: (row) => formatPlainNumber(row.hypAsPerRcCount), sortValue: (row) => row.hypAsPerRcCount },
  {
    key: 'hypMismatchCount',
    label: 'Mismatch HYP Vs Sale HYP',
    align: 'right',
    value: (row) => formatPlainNumber(row.hypMismatchCount),
    sortValue: (row) => row.hypMismatchCount,
    heat: (row) => row.hypMismatchCount > 0,
  },
]

const RANKING_COLUMNS: ReportColumn<RankingRow>[] = [
  { key: 'label', label: 'Name', value: (row) => displayReportLabel(row.label), sortValue: (row) => row.label, className: 'min-w-[240px]' },
  { key: 'totalCase', label: 'Total Case', align: 'right', value: (row) => formatPlainNumber(row.totalCase), sortValue: (row) => row.totalCase },
  { key: 'contribution', label: 'Contribution', align: 'right', value: (row) => formatPercent(row.contribution, 1), sortValue: (row) => row.contribution },
]

function FinanceKpiCards({ summary }: { summary: FinanceAnalyticsPayload['summary'] | undefined }) {
  if (!summary) {
    return (
      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <FinanceKpiSkeleton key={index} />)}
      </section>
    )
  }

  return (
    <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Total Cases" value={summary.totalCases.toLocaleString('en-IN')} detail="Filtered finance cases" icon={Users} tone="border-cyan-200 bg-cyan-50 text-cyan-700" />
      <KpiCard label="Loan Amount" value={formatCurrency(summary.totalLoanAmount)} detail={`Avg ticket ${formatCurrency(summary.avgTicketSize)}`} icon={Banknote} tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
      <KpiCard label="Payout Amount" value={formatCurrency(summary.totalPayoutAmount)} detail={`Pending ${formatCurrency(summary.pendingAmount)}`} icon={TrendingUp} tone="border-amber-200 bg-amber-50 text-amber-800" />
      <KpiCard label="In House %" value={formatPercent(summary.inHousePercent, 1)} detail={`${summary.inhouseCount.toLocaleString('en-IN')} in-house cases`} icon={ShieldCheck} tone="border-rose-200 bg-rose-50 text-rose-700" />
    </section>
  )
}

function OverviewAnalytics({
  data,
  onFilter,
}: {
  data?: FinanceAnalyticsPayload['data']['overview']
  onFilter: (filter: TableFilter) => void
}) {
  const payoutRows = data?.payoutStatusRows || []
  const paymentRows = data?.paymentStatusRows || []
  const dealerRows = data?.dealerRows || []

  return (
    <div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.75fr)]">
        <FinanceReportTable title="Main Dealer Contribution" rows={dealerRows} columns={COMPACT_METRIC_COLUMNS} grandTotal={metricGrandTotal('Grand total', dealerRows)} pageSize={8} minWidth={640} labelFilterKey="mainDealer" onFilter={onFilter} />
        <FinanceSummaryPanel title="Dealer Mix Summary" rows={dealerRows} subtitle="Main dealer contribution" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <FinanceReportTable title="Payout Status Split" rows={payoutRows} columns={PAYOUT_METRIC_COLUMNS} grandTotal={metricGrandTotal('Grand total', payoutRows)} pageSize={8} minWidth={620} labelFilterKey="payoutStatus" onFilter={onFilter} />
        <FinanceSummaryPanel title="Payout Status Summary" rows={payoutRows} subtitle="Contribution by payout type" />
        <FinanceReportTable title="Payment Status Split" rows={paymentRows} columns={PAYMENT_METRIC_COLUMNS} grandTotal={metricGrandTotal('Grand total', paymentRows)} pageSize={8} minWidth={860} labelFilterKey="status" onFilter={onFilter} />
        <FinanceSummaryPanel title="Payment Status Summary" rows={paymentRows} subtitle="Pending, no payout, and received split" />
      </section>
    </div>
  )
}

function PayoutStatusAnalytics({ data, onFilter }: { data?: FinanceAnalyticsPayload['data']['payoutStatus']; onFilter: (filter: TableFilter) => void }) {
  const payoutRows = data?.payoutStatusRows || []
  const paymentRows = data?.paymentStatusRows || []
  const dealerRows = data?.dealerRows || []

  return (
    <div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
        <FinanceReportTable title="Payout Status" rows={payoutRows} columns={PAYOUT_METRIC_COLUMNS} grandTotal={metricGrandTotal('Grand total', payoutRows)} pageSize={8} minWidth={620} labelFilterKey="payoutStatus" onFilter={onFilter} />
        <FinanceSummaryPanel title="Payout Status Visual" rows={payoutRows} subtitle="Modern donut contribution view" />
      </section>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
        <FinanceReportTable title="Payment Status" rows={paymentRows} columns={PAYMENT_METRIC_COLUMNS} grandTotal={metricGrandTotal('Grand total', paymentRows)} pageSize={8} minWidth={860} labelFilterKey="status" onFilter={onFilter} />
        <FinanceSummaryPanel title="Payment Status Visual" rows={paymentRows} subtitle="Modern donut contribution view" />
      </section>
      <FinanceReportTable title="Dealer Status Base" rows={dealerRows} columns={FULL_METRIC_COLUMNS} grandTotal={metricGrandTotal('Grand total', dealerRows)} pageSize={10} minWidth={1020} labelFilterKey="mainDealer" onFilter={onFilter} />
    </div>
  )
}

function HypBankAnalytics({
  data,
  target,
  onFilter,
  selectedBank,
  bankRows,
  bankLoading,
  bankError,
  onOpenRow,
}: {
  data?: FinanceAnalyticsPayload['data']['hypBankAnalysis']
  target: SbiPendingSummary
  onFilter: (filter: TableFilter) => void
  selectedBank: string | null
  bankRows: AmFinanceRow[]
  bankLoading: boolean
  bankError: string | null
  onOpenRow: (row: AmFinanceRow) => void
}) {
  const hypRows = data?.hypRows || []
  const pendingCases = target.pendingCases ?? target.totalCase ?? 0
  const targetCases = target.targetCases ?? 0
  const actualSbiCases = target.actualSbiCases ?? 0
  const targetContext = target.targetCases !== undefined && target.actualSbiCases !== undefined
  const targetHelper = targetContext
    ? target.targetMet
      ? `Target met - Target ${formatPlainNumber(targetCases, 1)} | SBI ${formatPlainNumber(actualSbiCases)}`
      : `Target ${formatPlainNumber(targetCases, 1)} | SBI ${formatPlainNumber(actualSbiCases)}`
    : `${formatCurrency(target.pendingAmount)} pending`

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-[1fr_220px]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black text-slate-950">HYP / Bank Analysis</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">Primary bank ranking using finance_sheet.hyp, with in-house ratio heat shading below 70%.</p>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-4 text-center shadow-sm">
          <p className="text-xs font-black text-slate-500">SBI Pending Cases</p>
          <p className={cn('mt-1 font-mono text-3xl font-black', pendingCases > 0 ? 'text-red-500' : 'text-emerald-600')}>
            {formatPlainNumber(pendingCases, 1)}
          </p>
          <p className="mt-1 text-[11px] font-black text-slate-500">{targetHelper}</p>
        </div>
      </section>
      <FinanceReportTable title="HYP Bank Performance" rows={hypRows} columns={HYP_COLUMNS} grandTotal={metricGrandTotal('Grand total', hypRows)} pageSize={18} minWidth={1000} labelFilterKey="hyp" onFilter={onFilter} />
      {selectedBank && (
        <BankProformaRecords
          bank={selectedBank}
          rows={bankRows}
          loading={bankLoading}
          error={bankError}
          onOpenRow={onOpenRow}
        />
      )}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <FinanceReportTable title="Location Performance" rows={data?.locationRows || []} columns={COMPACT_METRIC_COLUMNS} grandTotal={metricGrandTotal('Grand total', data?.locationRows || [])} pageSize={12} minWidth={640} labelFilterKey="location" onFilter={onFilter} />
        <FinanceSummaryPanel title="HYP Mix Summary" rows={hypRows.slice(0, 12)} subtitle="Top banks by case count" />
      </section>
    </div>
  )
}

function TeamPerformanceAnalytics({ data, onFilter }: { data?: FinanceAnalyticsPayload['data']['teamPerformance']; onFilter: (filter: TableFilter) => void }) {
  const salesRows = data?.salesExecutiveRows || []
  const hypRows = data?.hypRows || []

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(360px,0.8fr)]">
      <FinanceReportTable title="Sales Executive Performance" rows={salesRows} columns={FULL_METRIC_COLUMNS} grandTotal={metricGrandTotal('Grand total', salesRows)} pageSize={20} minWidth={1020} labelFilterKey="salesExecutive" onFilter={onFilter} />
      <FinanceReportTable title="HYP Ranking" rows={hypRows} columns={COMPACT_METRIC_COLUMNS} grandTotal={metricGrandTotal('Grand total', hypRows)} pageSize={16} minWidth={620} labelFilterKey="hyp" onFilter={onFilter} />
    </div>
  )
}

function MonthlyMatrixAnalytics({ data, onFilter }: { data?: FinanceAnalyticsPayload['data']['monthlyMatrix']; onFilter: (filter: TableFilter) => void }) {
  const monthRows = data?.monthRows || []
  const monthHypRows = data?.monthHypRows || []

  return (
    <div className="space-y-4">
      <FinanceReportTable title="Monthly Payout Summary" rows={monthRows} columns={MONTH_COLUMNS} grandTotal={metricGrandTotal('Grand total', monthRows)} pageSize={8} minWidth={980} labelFilterKey="month" onFilter={onFilter} />
      <FinanceReportTable title="Month / Status / HYP Matrix" rows={monthHypRows} columns={MONTH_HYP_COLUMNS} grandTotal={monthHypGrandTotal(monthHypRows)} pageSize={24} minWidth={1120} onFilter={onFilter} />
    </div>
  )
}

function OperationsComplianceAnalytics({ data, onFilter }: { data?: FinanceAnalyticsPayload['data']['operationsCompliance']; onFilter: (filter: TableFilter) => void }) {
  const dealerOpsRows = data?.dealerOpsRows || []
  const bankerRemarksRows = data?.bankerRemarksRows || []
  const reasonRows = data?.reasonIfOuthouseRows || []

  return (
    <div className="space-y-4">
      <FinanceReportTable title="Dealer Operations / Compliance" rows={dealerOpsRows} columns={OPERATIONS_COLUMNS} grandTotal={operationsGrandTotal(dealerOpsRows)} pageSize={10} minWidth={980} labelFilterKey="mainDealer" onFilter={onFilter} />
      <FinanceReportTable title="Banker Remarks" rows={bankerRemarksRows} columns={RANKING_COLUMNS} grandTotal={rankingGrandTotal('Grand total', bankerRemarksRows)} pageSize={12} minWidth={620} labelFilterKey="bankerRemarks" onFilter={onFilter} />
      <FinanceReportTable title="Reason If Outhouse" rows={reasonRows} columns={RANKING_COLUMNS} grandTotal={rankingGrandTotal('Grand total', reasonRows)} pageSize={12} minWidth={620} labelFilterKey="reasonIfOuthouse" onFilter={onFilter} />
    </div>
  )
}

function ProformaPivotTable({ pivot, onFilter }: { pivot: ProformaPivot; onFilter: (filter: TableFilter) => void }) {
  const columns: ReportColumn<ProformaPivot['rows'][number]>[] = [
    { key: 'bank', label: 'Bank', value: (row) => row.bank, sortValue: (row) => row.bank, className: 'min-w-[180px]', filter: (row) => tableFilter('hyp', row.bank) },
    ...pivot.months.map((month) => ({
      key: month.key,
      label: month.label,
      align: 'right' as const,
      value: (row: ProformaPivot['rows'][number]) => {
        const value = row.values[month.key] || 0
        return value > 0 ? formatPlainNumber(value) : '-'
      },
      sortValue: (row: ProformaPivot['rows'][number]) => row.values[month.key] || 0,
    })),
    { key: 'grandTotal', label: 'Grand Total', align: 'right', value: (row) => formatPlainNumber(row.grandTotal), sortValue: (row) => row.grandTotal },
  ]

  return (
    <FinanceReportTable
      title={pivot.title}
      subtitle={`${pivot.grandTotalRow.grandTotal.toLocaleString('en-IN')} cases from HYP bank source`}
      rows={pivot.rows}
      columns={columns}
      grandTotal={pivot.grandTotalRow}
      pageSize={10}
      minWidth={820}
      onFilter={onFilter}
    />
  )
}

function ProformaDetailsAnalytics({ data, onFilter }: { data?: FinanceAnalyticsPayload['data']['proformaDetails']; onFilter: (filter: TableFilter) => void }) {
  const pivots = data?.pivots || []

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {pivots.map((pivot) => (
          <ProformaPivotTable key={pivot.dealer} pivot={pivot} onFilter={onFilter} />
        ))}
      </div>
      {pivots.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-500">
          No proforma rows match selected filters.
        </div>
      )}
    </div>
  )
}

function BankProformaRecords({
  bank,
  rows,
  loading,
  error,
  onOpenRow,
}: {
  bank: string
  rows: AmFinanceRow[]
  loading: boolean
  error: string | null
  onOpenRow: (row: AmFinanceRow) => void
}) {
  const columns = useMemo<ReportColumn<AmFinanceRow>[]>(() => [
    {
      key: 'customer',
      label: 'Customer',
      value: (row) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onOpenRow(row)
          }}
          className="font-black text-[var(--dashboard-action-bg)] underline-offset-2 hover:underline"
        >
          {row.customerName || `Record #${row.id}`}
        </button>
      ),
      sortValue: (row) => row.customerName || '',
      className: 'min-w-[170px]',
    },
    { key: 'deliveryDate', label: 'Delivery', value: (row) => formatDate(row.deliveryDate), sortValue: (row) => row.deliveryDate || '' },
    { key: 'model', label: 'Model', value: (row) => row.model || '-', sortValue: (row) => row.model || '' },
    { key: 'mainDealer', label: 'Main Dealer', value: (row) => row.mainDealer || '-', sortValue: (row) => row.mainDealer || '' },
    { key: 'location', label: 'Location', value: (row) => row.location || '-', sortValue: (row) => row.location || '' },
    { key: 'salesExecutive', label: 'Executive', value: (row) => row.salesExecutive || '-', sortValue: (row) => row.salesExecutive || '' },
    { key: 'loanAmount', label: 'Loan', value: (row) => formatCurrency(row.loanAmount), sortValue: (row) => row.loanAmount },
    { key: 'payoutStatus', label: 'Payout', value: (row) => row.payoutStatus || '-', sortValue: (row) => row.payoutStatus || '' },
    { key: 'status', label: 'Payment', value: (row) => displayStatus(row.status), sortValue: (row) => row.status || '' },
  ], [onOpenRow])

  if (loading) {
    return <FinanceReportTableSkeleton title={`Loading ${bank} proforma records`} columns={9} rows={8} />
  }

  if (error) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>
  }

  return (
    <FinanceReportTable
      title={`${bank} Proforma Records`}
      subtitle={`${rows.length.toLocaleString('en-IN')} customer records under current filters`}
      rows={rows}
      columns={columns}
      pageSize={12}
      minWidth={980}
    />
  )
}

function SectionHeading({ label, summary, loading }: { label: string; summary: string; loading?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-xl font-black text-slate-950">{label}</h2>
        <p className="mt-1 text-xs font-semibold text-slate-500">{summary}</p>
      </div>
      {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
    </div>
  )
}

function SortButton({
  column,
  active,
  direction,
  onClick,
  children,
}: {
  column: SortKey
  active: boolean
  direction: 'asc' | 'desc'
  onClick: (column: SortKey) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(column)}
      className="inline-flex min-h-8 w-full items-center justify-center gap-1 whitespace-normal rounded-lg px-1 text-center text-[10px] font-black uppercase leading-tight tracking-[0.06em] text-white/95 transition hover:text-white"
    >
      {children}
      {active ? (
        direction === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
      ) : null}
    </button>
  )
}


export function AmFinancePageContent({
  currentUser,
  permissions,
}: {
  currentUser: CurrentUser
  permissions: AmFinancePermissions
}) {
  const [payload, setPayload] = useState<AmFinancePayload | null>(null)
  const [analyticsPayloads, setAnalyticsPayloads] = useState<Partial<Record<Exclude<AnalyticsSectionKey, 'register'>, FinanceAnalyticsPayload>>>({})
  const [sectionLoading, setSectionLoading] = useState<Partial<Record<Exclude<AnalyticsSectionKey, 'register'>, boolean>>>({})
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<Exclude<AnalyticsSectionKey, 'register'>, string>>>({})
  const [activeSection, setActiveSection] = useState<AnalyticsSectionKey>('overview')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS)
  const [search, setSearch] = useState('')
  const [draftSearch, setDraftSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sortBy, setSortBy] = useState<SortKey>('deliveryDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedRow, setSelectedRow] = useState<AmFinanceRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [formRow, setFormRow] = useState<AmFinanceRow | null>(null)
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [registerEnabled, setRegisterEnabled] = useState(false)
  const [showKpis, setShowKpis] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedBankForProforma, setSelectedBankForProforma] = useState<string | null>(null)
  const [bankProformaRows, setBankProformaRows] = useState<AmFinanceRow[]>([])
  const [bankProformaLoading, setBankProformaLoading] = useState(false)
  const [bankProformaError, setBankProformaError] = useState<string | null>(null)
  const sectionRefs = useRef<Partial<Record<AnalyticsSectionKey, HTMLElement | null>>>({})
  const navShellRef = useRef<HTMLDivElement | null>(null)
  const loadedSectionsRef = useRef<Set<Exclude<AnalyticsSectionKey, 'register'>>>(new Set())
  const loadingSectionsRef = useRef<Set<Exclude<AnalyticsSectionKey, 'register'>>>(new Set())
  const [navPinned, setNavPinned] = useState(false)
  const [pinnedNavRect, setPinnedNavRect] = useState({ left: 0, width: 0 })

  const blankFilterOptions: Record<FilterOptionKey, string[]> = useMemo(() => ({
    mainDealers: [],
    locations: [],
    tls: [],
    salesExecutives: [],
    hyps: [],
    branches: [],
    payoutStatuses: [],
    statuses: [],
    bankLogins: [],
    bankInProformas: [],
  }), [])

  const appendSharedFilters = useCallback((params: URLSearchParams) => {
    if (search.trim()) params.set('search', search.trim())
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all') params.set(key, value)
    })
    return params
  }, [filters, search])

  const buildParams = useCallback((mode?: 'export') => {
    const params = new URLSearchParams({
      page: String(mode === 'export' ? 1 : page),
      pageSize: String(pageSize),
      sortBy,
      sortDir,
    })
    if (mode === 'export') params.set('export', 'true')
    return appendSharedFilters(params)
  }, [appendSharedFilters, page, pageSize, sortBy, sortDir])

  const buildAnalyticsParams = useCallback((section: Exclude<AnalyticsSectionKey, 'register'>) => {
    const params = new URLSearchParams({
      section,
    })
    return appendSharedFilters(params)
  }, [appendSharedFilters])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/am-finance?${buildParams().toString()}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Failed to load AM Finance')
      setPayload(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AM Finance')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  const fetchAnalyticsSection = useCallback(async (section: Exclude<AnalyticsSectionKey, 'register'>, force = false) => {
    if (!force && (loadedSectionsRef.current.has(section) || loadingSectionsRef.current.has(section))) return
    loadingSectionsRef.current.add(section)
    setSectionLoading((current) => ({ ...current, [section]: true }))
    setSectionErrors((current) => ({ ...current, [section]: undefined }))
    try {
      const response = await fetch(`/api/am-finance/analytics?${buildAnalyticsParams(section).toString()}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Failed to load AM Finance analytics')
      setAnalyticsPayloads((current) => ({ ...current, [section]: data }))
      loadedSectionsRef.current.add(section)
    } catch (err) {
      setSectionErrors((current) => ({
        ...current,
        [section]: err instanceof Error ? err.message : 'Failed to load AM Finance analytics',
      }))
    } finally {
      loadingSectionsRef.current.delete(section)
      setSectionLoading((current) => ({ ...current, [section]: false }))
    }
  }, [buildAnalyticsParams])

  useEffect(() => {
    if (!registerEnabled) return
    const timer = window.setTimeout(() => {
      void fetchData()
    }, 220)
    return () => window.clearTimeout(timer)
  }, [fetchData, registerEnabled])

  useEffect(() => {
    setPayload(null)
    setBankProformaRows([])
    setBankProformaError(null)
    setAnalyticsPayloads({})
    loadedSectionsRef.current.clear()
    loadingSectionsRef.current.clear()
    setSectionErrors({})
    setSectionLoading({})
    void fetchAnalyticsSection('overview', true)
  }, [fetchAnalyticsSection, filters, search])

  const analyticsPayloadList = useMemo(() => Object.values(analyticsPayloads).filter(Boolean) as FinanceAnalyticsPayload[], [analyticsPayloads])
  const baseAnalyticsPayload = analyticsPayloads.overview || analyticsPayloadList[0] || null
  const filterOptions = baseAnalyticsPayload?.filterOptions || payload?.filterOptions || blankFilterOptions
  const coverage = baseAnalyticsPayload?.coverage || payload?.coverage
  const summary = baseAnalyticsPayload?.summary
  const coverageText = `${coverage?.minDeliveryDate ? formatDate(coverage.minDeliveryDate) : '-'} to ${coverage?.maxDeliveryDate ? formatDate(coverage.maxDeliveryDate) : '-'}`
  const activeFilterCount = useMemo(() => {
    let count = search.trim() ? 1 : 0
    Object.entries(filters).forEach(([key, value]) => {
      if (key === 'startDate' || key === 'endDate') {
        if (value) count += 1
      } else if (value && value !== 'all') {
        count += 1
      }
    })
    return count
  }, [filters, search])
  const anySectionLoading = Object.values(sectionLoading).some(Boolean)

  const updateFilter = (key: keyof Filters, value: string) => {
    setPage(1)
    setDraftFilters((current) => ({ ...current, [key]: value }))
  }

  const applyFilters = () => {
    setPage(1)
    setSelectedBankForProforma(null)
    setSearch(draftSearch)
    setFilters(draftFilters)
  }

  const resetFilters = () => {
    setPage(1)
    setDraftSearch('')
    setSearch('')
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setSelectedBankForProforma(null)
  }

  const applyTableFilter = useCallback((filter: TableFilter) => {
    if (filter.key === 'month') {
      const range = getMonthDateRange(filter.value)
      if (!range) return
      setPage(1)
      setSelectedBankForProforma(null)
      setDraftSearch('')
      setSearch('')
      setDraftFilters((current) => ({ ...current, startDate: range.startDate, endDate: range.endDate }))
      setFilters((current) => ({ ...current, startDate: range.startDate, endDate: range.endDate }))
      return
    }

    setPage(1)
    setDraftSearch('')
    setSearch('')
    setDraftFilters((current) => ({ ...current, [filter.key]: filter.value }))
    setFilters((current) => ({ ...current, [filter.key]: filter.value }))
    if (filter.key === 'hyp') setSelectedBankForProforma(filter.value)
    if (filter.key !== 'hyp') setSelectedBankForProforma(null)
  }, [])

  const changeSort = (column: SortKey) => {
    setPage(1)
    if (sortBy === column) {
      setSortDir((current) => current === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortDir('desc')
    }
  }

  const exportRows = async () => {
    setExporting(true)
    try {
      const response = await fetch(`/api/am-finance?${buildParams('export').toString()}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Failed to export AM Finance')
      downloadCsv(data.rows || [])
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export AM Finance')
    } finally {
      setExporting(false)
    }
  }

  const openCreateForm = () => {
    setFormMode('create')
    setFormRow(null)
    setFormOpen(true)
  }

  const openEditForm = (row: AmFinanceRow) => {
    setFormMode('edit')
    setFormRow(row)
    setFormOpen(true)
  }

  const loadAuditRows = useCallback(async (rowId: number) => {
    if (!permissions.audit) {
      setAuditRows([])
      setAuditError(null)
      return
    }
    setAuditLoading(true)
    setAuditError(null)
    try {
      const response = await fetch(`/api/am-finance/audit?id=${rowId}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Failed to load audit history')
      setAuditRows(data.rows || [])
    } catch (err) {
      setAuditRows([])
      setAuditError(err instanceof Error ? err.message : 'Failed to load audit history')
    } finally {
      setAuditLoading(false)
    }
  }, [permissions.audit])

  const openRowDetails = (row: AmFinanceRow) => {
    setSelectedRow(row)
    void loadAuditRows(row.id)
  }

  const refreshLoadedAnalytics = useCallback(() => {
    const sections = Array.from(loadedSectionsRef.current)
    const targets = sections.length > 0 ? sections : ['overview' as const]
    targets.forEach((section) => {
      void fetchAnalyticsSection(section, true)
    })
  }, [fetchAnalyticsSection])

  const fetchBankProformaRows = useCallback(async (bank: string) => {
    setBankProformaLoading(true)
    setBankProformaError(null)
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '50',
        sortBy: 'deliveryDate',
        sortDir: 'desc',
      })
      appendSharedFilters(params)
      params.set('hyp', bank)
      const response = await fetch(`/api/am-finance?${params.toString()}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Failed to load bank proforma records')
      setBankProformaRows(data.rows || [])
    } catch (err) {
      setBankProformaRows([])
      setBankProformaError(err instanceof Error ? err.message : 'Failed to load bank proforma records')
    } finally {
      setBankProformaLoading(false)
    }
  }, [appendSharedFilters])

  useEffect(() => {
    if (!selectedBankForProforma) return
    void fetchBankProformaRows(selectedBankForProforma)
  }, [fetchBankProformaRows, selectedBankForProforma])

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const section = entry.target.getAttribute('data-section') as AnalyticsSectionKey | null
        if (!section) return
        setActiveSection(section)
        if (section === 'register') {
          setRegisterEnabled(true)
        } else {
          void fetchAnalyticsSection(section)
        }
      })
    }, { rootMargin: '520px 0px', threshold: 0.05 })

    Object.values(sectionRefs.current).forEach((node) => {
      if (node) observer.observe(node)
    })

    return () => observer.disconnect()
  }, [fetchAnalyticsSection])

  useEffect(() => {
    const navNode = navShellRef.current
    if (!navNode) return

    const updatePinnedNavRect = () => {
      const rect = navNode.getBoundingClientRect()
      setPinnedNavRect({ left: rect.left, width: rect.width })
    }

    const updatePinnedState = () => {
      const rect = navNode.getBoundingClientRect()
      updatePinnedNavRect()
      setNavPinned(rect.bottom <= 0)
    }

    updatePinnedState()

    const observer = new IntersectionObserver(([entry]) => {
      updatePinnedNavRect()
      setNavPinned(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    }, { root: null, threshold: 0 })

    observer.observe(navNode)
    window.addEventListener('resize', updatePinnedNavRect)
    window.addEventListener('scroll', updatePinnedState, true)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePinnedNavRect)
      window.removeEventListener('scroll', updatePinnedState, true)
    }
  }, [])

  const scrollToSection = (section: AnalyticsSectionKey) => {
    setActiveSection(section)
    if (section === 'register') {
      setRegisterEnabled(true)
    } else {
      void fetchAnalyticsSection(section)
    }

    window.requestAnimationFrame(() => {
      const sectionNode = sectionRefs.current[section] || document.querySelector<HTMLElement>(`[data-section="${section}"]`)
      if (!sectionNode) return

      const navHeight = navShellRef.current?.offsetHeight || 66
      const scrollParent = sectionNode.closest('.glass-dashboard-content') as HTMLElement | null
      const parentCanScroll = Boolean(scrollParent && scrollParent.scrollHeight > scrollParent.clientHeight + 4)

      if (scrollParent && parentCanScroll) {
        const sectionRect = sectionNode.getBoundingClientRect()
        const parentRect = scrollParent.getBoundingClientRect()
        const targetTop = scrollParent.scrollTop + sectionRect.top - parentRect.top - navHeight - 18
        scrollParent.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' })
        return
      }

      const documentScrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
      const targetTop = sectionNode.getBoundingClientRect().top + documentScrollTop - navHeight - 18
      window.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' })
    })
  }

  const renderFinanceNavButtons = (mode: 'inline' | 'fixed') => (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-2">
        {ANALYTICS_TABS.map((tab) => {
          const Icon = tab.icon
          const active = tab.key === activeSection
          return (
            <button
              key={`${mode}-${tab.key}`}
              type="button"
              onClick={() => scrollToSection(tab.key)}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-black shadow-sm transition',
                active
                  ? FINANCE_SOLID_BUTTON_CLASS
                  : 'border-[color-mix(in_srgb,var(--dashboard-action-bg)_52%,transparent)] bg-[color-mix(in_srgb,var(--dashboard-action-bg)_18%,var(--dashboard-primary-soft))] text-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-bg)] hover:text-[var(--dashboard-action-fg)]'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )

  const handleSavedRow = (row: AmFinanceRow) => {
    setSelectedRow(row)
    void loadAuditRows(row.id)
    if (registerEnabled) void fetchData()
    refreshLoadedAnalytics()
    if (selectedBankForProforma) void fetchBankProformaRows(selectedBankForProforma)
  }

  const registerMeta = (
    <div className="flex flex-wrap gap-2">
      <Select value={String(pageSize)} onValueChange={(value) => {
        setPage(1)
        setPageSize(Number(value))
      }}>
        <SelectTrigger className="h-9 w-28 rounded-lg border-slate-200 bg-white text-xs font-black shadow-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[200] rounded-lg border border-slate-200 bg-white shadow-xl">
          {[25, 50, 100].map((size) => (
            <SelectItem key={size} value={String(size)}>{size} rows</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={(payload?.pagination.page || 1) <= 1} className={cn('h-9 rounded-lg px-3 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}>
        Previous
      </Button>
      <Button type="button" onClick={() => setPage((current) => Math.min(payload?.pagination.totalPages || 1, current + 1))} disabled={(payload?.pagination.page || 1) >= (payload?.pagination.totalPages || 1)} className={cn('h-9 rounded-lg px-3 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}>
        Next
      </Button>
    </div>
  )

  const renderRegisterTable = (isFullscreen = false) => {
    if (error) return <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">{error}</div>

    return (
      <div className={cn('overflow-auto', isFullscreen && 'max-h-[calc(94vh-150px)]')}>
        <table className="w-full table-fixed border-collapse text-[11px]" style={{ minWidth: isFullscreen ? 1320 : '100%' }}>
          <thead className="sticky top-0 z-20">
            <tr className={FINANCE_TABLE_HEAD_CLASS}>
              {TABLE_COLUMNS.map((column) => (
                <th key={column.key} className={cn('border border-slate-300/70 px-2 py-2 text-center align-middle', column.className)}>
                  <SortButton column={column.key} active={sortBy === column.key} direction={sortDir} onClick={changeSort}>
                    {column.label}
                  </SortButton>
                </th>
              ))}
              <th className="border border-slate-300/70 px-2 py-2 text-center align-middle text-[10px] font-black uppercase leading-tight tracking-[0.06em] text-white/95">Action</th>
            </tr>
          </thead>
          <tbody>
            {(payload?.rows || []).map((row) => (
              <tr key={row.id} className="cursor-pointer odd:bg-white even:bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_38%,white)] transition hover:bg-[color-mix(in_srgb,var(--dashboard-action-bg)_10%,white)]" onClick={() => openRowDetails(row)}>
                {TABLE_COLUMNS.map((column) => (
                  <td key={column.key} className="border border-slate-300 px-2 py-1.5 text-center align-middle text-[11px] font-bold leading-tight text-slate-800">{column.value(row)}</td>
                ))}
                <td className="border border-slate-300 px-2 py-1.5 text-center align-middle">
                  <Button type="button" onClick={(event) => {
                    event.stopPropagation()
                    openRowDetails(row)
                  }} className={cn('h-8 rounded-lg px-3 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}>
                    Open
                  </Button>
                </td>
              </tr>
            ))}
            {(payload?.rows || []).length === 0 && (
              <tr>
                <td colSpan={TABLE_COLUMNS.length + 1} className="px-4 py-16 text-center">
                  <FileText className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-black text-slate-600">No finance cases match selected filters.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  const renderRegisterSection = () => {
    if (loading) return <FinanceRegisterSkeleton />

    return (
      <FinancePanelShell
        title="Finance Register"
        subtitle={`Page ${payload?.pagination.page || 1} of ${payload?.pagination.totalPages || 1} - ${(payload?.pagination.total || 0).toLocaleString('en-IN')} rows`}
        meta={registerMeta}
        bodyClassName="bg-white"
        fullscreenBodyClassName="p-0"
        fullscreenChildren={renderRegisterTable(true)}
      >
        {renderRegisterTable(false)}
      </FinancePanelShell>
    )
  }

  const renderAnalyticsSection = (section: Exclude<AnalyticsSectionKey, 'register'>) => {
    const sectionPayload = analyticsPayloads[section]
    const loadingSection = sectionLoading[section]
    const sectionError = sectionErrors[section]

    if (!sectionPayload && !sectionError) return <FinanceDashboardSkeleton />
    if (loadingSection && !sectionPayload) return <FinanceDashboardSkeleton />
    if (sectionError) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700">{sectionError}</div>

    switch (section) {
      case 'payout-status':
        return <PayoutStatusAnalytics data={sectionPayload?.data.payoutStatus} onFilter={applyTableFilter} />
      case 'hyp-bank-analysis':
        return (
          <HypBankAnalytics
            data={sectionPayload?.data.hypBankAnalysis}
            target={sectionPayload?.data.hypBankAnalysis?.sbiPendingSummary || sectionPayload?.sbiPendingSummary || { totalCase: 0, loanAmount: 0, payoutAmount: 0, amountReceived: 0, pendingAmount: 0 }}
            onFilter={applyTableFilter}
            selectedBank={selectedBankForProforma}
            bankRows={bankProformaRows}
            bankLoading={bankProformaLoading}
            bankError={bankProformaError}
            onOpenRow={openRowDetails}
          />
        )
      case 'team-performance':
        return <TeamPerformanceAnalytics data={sectionPayload?.data.teamPerformance} onFilter={applyTableFilter} />
      case 'monthly-matrix':
        return <MonthlyMatrixAnalytics data={sectionPayload?.data.monthlyMatrix} onFilter={applyTableFilter} />
      case 'operations-compliance':
        return <OperationsComplianceAnalytics data={sectionPayload?.data.operationsCompliance} onFilter={applyTableFilter} />
      case 'proforma-details':
        return <ProformaDetailsAnalytics data={sectionPayload?.data.proformaDetails} onFilter={applyTableFilter} />
      default:
        return <OverviewAnalytics data={sectionPayload?.data.overview} onFilter={applyTableFilter} />
    }
  }

  const renderDashboardSection = (tab: typeof ANALYTICS_TABS[number]) => {
    if (tab.key === 'register') {
      return (
        <section
          key={tab.key}
          ref={(node) => { sectionRefs.current[tab.key] = node }}
          data-section={tab.key}
          className="scroll-mt-24 space-y-3"
        >
          <SectionHeading label={tab.label} loading={loading} summary={payload ? `${payload.pagination.total.toLocaleString('en-IN')} register rows` : 'Register loads when visible'} />
          {registerEnabled ? renderRegisterSection() : <FinanceRegisterSkeleton />}
        </section>
      )
    }

    const sectionPayload = analyticsPayloads[tab.key]
    const sectionSummary = sectionPayload?.summary
    return (
      <section
        key={tab.key}
        ref={(node) => { sectionRefs.current[tab.key] = node }}
        data-section={tab.key}
        className="scroll-mt-24 space-y-3"
      >
        <SectionHeading
          label={tab.key === 'overview' ? 'Overview / Main Dealer' : tab.label}
          loading={Boolean(sectionLoading[tab.key])}
          summary={sectionSummary ? `${sectionSummary.totalCases.toLocaleString('en-IN')} filtered cases - ${formatCurrency(sectionSummary.totalLoanAmount)} loan amount` : 'Loads as this section enters view'}
        />
        {renderAnalyticsSection(tab.key)}
      </section>
    )
  }

  return (
    <MainLayout title="AM Finance" subtitle="Analytics dashboard and finance sheet register">
      <div className="space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[10px] font-black text-teal-700 shadow-none">finance_sheet</Badge>
                <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black text-slate-600 shadow-none">{permissions.create || permissions.edit ? 'Read Write' : 'Read Only'}</Badge>
                <Badge className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[10px] font-black text-cyan-700 shadow-none">{currentUser.role}</Badge>
              </div>
              <h1 className="mt-3 text-3xl font-black text-slate-950">AM Finance</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {(coverage?.rowCount || 0).toLocaleString('en-IN')} source rows - Delivery coverage {coverageText}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                onClick={() => setFiltersOpen((current) => !current)}
                className={cn('h-10 rounded-lg px-4 text-xs font-black', FINANCE_SOLID_SOFT_BUTTON_CLASS)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {filtersOpen ? 'Hide Filters' : 'Add Filters'}
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 font-mono text-[10px] text-white">{activeFilterCount}</span>
                )}
              </Button>
              <Button
                type="button"
                onClick={() => setShowKpis((current) => !current)}
                className={cn('h-10 rounded-lg px-4 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}
              >
                <LayoutDashboard className="h-4 w-4" />
                {showKpis ? 'Hide KPI Cards' : 'Show KPI Cards'}
              </Button>
              {permissions.create && (
                <Button type="button" onClick={openCreateForm} className={cn('h-10 rounded-lg px-4 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}>
                  <Plus className="h-4 w-4" />
                  New Entry
                </Button>
              )}
              <Button type="button" onClick={() => {
                if (registerEnabled) void fetchData()
                refreshLoadedAnalytics()
                if (selectedBankForProforma) void fetchBankProformaRows(selectedBankForProforma)
              }} className={cn('h-10 rounded-lg px-4 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}>
                {loading || anySectionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Refresh
              </Button>
              <Button type="button" onClick={() => void exportRows()} disabled={exporting} className={cn('h-10 rounded-lg px-4 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export CSV
              </Button>
            </div>
          </div>

          {filtersOpen && (
            <div className="mt-5 rounded-xl border border-[var(--dashboard-primary-border)] bg-[color-mix(in_srgb,var(--dashboard-primary-soft)_62%,white)] p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <FieldLabel label="Start Date">
                  <Input type="date" value={draftFilters.startDate} min={coverage?.minDeliveryDate || undefined} max={coverage?.maxDeliveryDate || undefined} onChange={(event) => updateFilter('startDate', event.target.value)} className="h-10 rounded-lg border-slate-200 bg-white text-xs font-bold shadow-sm" />
                </FieldLabel>
                <FieldLabel label="End Date">
                  <Input type="date" value={draftFilters.endDate} min={coverage?.minDeliveryDate || undefined} max={coverage?.maxDeliveryDate || undefined} onChange={(event) => updateFilter('endDate', event.target.value)} className="h-10 rounded-lg border-slate-200 bg-white text-xs font-bold shadow-sm" />
                </FieldLabel>
                <FilterSelect label="Main Dealer" value={draftFilters.mainDealer} options={filterOptions.mainDealers} onChange={(value) => updateFilter('mainDealer', value)} />
                <FilterSelect label="Location" value={draftFilters.location} options={filterOptions.locations} onChange={(value) => updateFilter('location', value)} />
                <FilterSelect label="Payout Status" value={draftFilters.payoutStatus} options={filterOptions.payoutStatuses} onChange={(value) => updateFilter('payoutStatus', value)} />
                <FilterSelect label="Status" value={draftFilters.status} options={filterOptions.statuses} onChange={(value) => updateFilter('status', value)} />
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <FilterSelect label="TL" value={draftFilters.tl} options={filterOptions.tls} onChange={(value) => updateFilter('tl', value)} />
                <FilterSelect label="Sales Executive" value={draftFilters.salesExecutive} options={filterOptions.salesExecutives} onChange={(value) => updateFilter('salesExecutive', value)} />
                <FilterSelect label="HYP Bank" value={draftFilters.hyp} options={filterOptions.hyps} onChange={(value) => updateFilter('hyp', value)} />
                <FilterSelect label="Branch" value={draftFilters.branch} options={filterOptions.branches} onChange={(value) => updateFilter('branch', value)} />
                <FilterSelect label="Bank Login" value={draftFilters.bankLogin} options={filterOptions.bankLogins} onChange={(value) => updateFilter('bankLogin', value)} />
                <FilterSelect label="Bank In Proforma" value={draftFilters.bankInProforma} options={filterOptions.bankInProformas} onChange={(value) => updateFilter('bankInProforma', value)} />
              </div>

              <div className="mt-4 flex flex-col gap-3 lg:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={draftSearch} onChange={(event) => {
                    setPage(1)
                    setDraftSearch(event.target.value)
                  }} placeholder="Search customer, mobile, model, invoice, vehicle, bank, executive" className="h-11 rounded-lg border-slate-200 bg-white pl-10 text-sm font-semibold shadow-sm" />
                </div>
                <Button type="button" onClick={applyFilters} className={cn('h-11 rounded-lg px-4 text-xs font-black', FINANCE_SOLID_SOFT_BUTTON_CLASS)}>Apply Filters</Button>
                <Button type="button" onClick={resetFilters} className={cn('h-11 rounded-lg px-4 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}>Reset</Button>
              </div>
            </div>
          )}

          {showKpis && <FinanceKpiCards summary={summary} />}

        </section>

        <div ref={navShellRef} className="rounded-lg border border-slate-200/80 bg-white/95 p-3 shadow-lg shadow-slate-950/10 backdrop-blur">
          {renderFinanceNavButtons('inline')}
        </div>

        {navPinned && (
          <div
            className="fixed top-0 z-[35] rounded-b-lg border border-t-0 border-slate-200/90 bg-white/95 p-3 shadow-xl shadow-slate-950/15 backdrop-blur"
            style={{
              left: pinnedNavRect.left,
              width: pinnedNavRect.width || undefined,
            }}
          >
            {renderFinanceNavButtons('fixed')}
          </div>
        )}

        <div className="space-y-8">
          {ANALYTICS_TABS.map((tab) => renderDashboardSection(tab))}
        </div>

        <Dialog open={Boolean(selectedRow)} onOpenChange={(open) => !open && setSelectedRow(null)}>
          <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto rounded-lg border-white/70 bg-white p-0 shadow-2xl">
            {selectedRow && (
              <>
                <DialogHeader className="border-b border-teal-900/10 bg-gradient-to-br from-slate-950 via-teal-950 to-slate-900 p-6 pr-14 text-white">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black text-white/65">Finance Sheet Record</p>
                      <DialogTitle className="mt-2 truncate text-2xl font-black text-white">{selectedRow.customerName || `Record #${selectedRow.id}`}</DialogTitle>
                      <DialogDescription className="mt-2 font-semibold text-white/75">{selectedRow.mainDealer || '-'} - {selectedRow.location || '-'} - {formatDate(selectedRow.deliveryDate)}</DialogDescription>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {permissions.edit && (
                        <Button type="button" onClick={() => openEditForm(selectedRow)} className={cn('h-9 rounded-lg px-3 text-xs font-black', FINANCE_SOLID_BUTTON_CLASS)}>
                          <Edit3 className="h-4 w-4" />
                          Edit
                        </Button>
                      )}
                      <StatusBadge value={selectedRow.status} />
                    </div>
                  </div>
                </DialogHeader>

                <div className="grid gap-4 p-5 lg:grid-cols-4">
                  <KpiCard label="Loan Amount" value={formatCurrency(selectedRow.loanAmount)} detail={selectedRow.hyp || 'Bank not set'} icon={Banknote} tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
                  <KpiCard label="Payout Amount" value={formatCurrency(selectedRow.payoutAmount)} detail={selectedRow.payoutStatus || 'Payout status not set'} icon={TrendingUp} tone="border-amber-200 bg-amber-50 text-amber-800" />
                  <KpiCard label="Received" value={formatCurrency(selectedRow.amountReceived)} detail={formatDate(selectedRow.paymentReceivedDate)} icon={CalendarDays} tone="border-cyan-200 bg-cyan-50 text-cyan-700" />
                  <KpiCard label="Pending" value={formatCurrency(Math.max(0, selectedRow.payoutAmount - selectedRow.amountReceived))} detail={displayStatus(selectedRow.status)} icon={FileText} tone="border-violet-200 bg-violet-50 text-violet-700" />
                </div>

                <div className="grid gap-3 border-t border-slate-100 p-5 md:grid-cols-2 xl:grid-cols-3">
                  {DETAIL_FIELDS.map((field) => (
                    <div key={field.key} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                      <p className="text-[10px] font-black text-slate-500">{field.label}</p>
                      <p className="mt-1 break-words text-sm font-black text-slate-950">{formatDetailValue(selectedRow, field)}</p>
                    </div>
                  ))}
                </div>

                {permissions.audit && (
                  <div className="border-t border-slate-100 p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-black text-slate-950">Audit History</h3>
                      {auditLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                    </div>
                    {auditError ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">{auditError}</div>
                    ) : auditRows.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-500">No audit entries yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {auditRows.map((entry) => (
                          <div key={entry.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                              <p className="text-xs font-black text-slate-600">{entry.action === 'create' ? 'Created' : entry.fieldLabel || entry.fieldName || 'Updated'}</p>
                              <p className="text-[11px] font-bold text-slate-500">{entry.performedByName || 'System'} - {formatDateTime(entry.createdAt)}</p>
                            </div>
                            {entry.action !== 'create' && (
                              <p className="mt-2 break-words text-xs font-bold text-slate-700">
                                <span className="text-rose-700">{entry.oldValue || '-'}</span>
                                <span className="px-2 text-slate-400">to</span>
                                <span className="text-emerald-700">{entry.newValue || '-'}</span>
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>

        <FinanceFormDialog open={formOpen} mode={formMode} row={formRow} currentUser={currentUser} permissions={permissions} filterOptions={filterOptions} onOpenChange={setFormOpen} onSaved={handleSavedRow} />
      </div>
    </MainLayout>
  )
}
