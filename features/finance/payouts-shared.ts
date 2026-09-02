import type { Tone } from '@/components/kia/premium'

// Shared types + presentation helpers for the Finance Payouts ledger. Client-safe.
// Mirrors the server shape in lib/finance/payouts.ts — keep them in step.

export type PayoutRow = {
  id: string
  bookingId: string | null
  source: string
  deliveryDate: string | null
  customerName: string | null
  customerPhone: string // already masked server-side by role
  model: string | null
  salesExecutive: string | null
  dealerCode: string | null
  tlName: string | null
  hyp: string | null
  bankBranch: string | null
  loanAmount: string | null
  panNumber: string | null
  vehicleRegistrationNo: string | null
  payoutStatus: string | null
  reasonIfOuthouse: string | null
  dealerPayoutPercent: string | null
  dealerPayoutAmount: string | null
  payoutReceiptStatus: string | null
  dsePayoutAmount: string | null
  dsePayoutStatus: string | null
  dealerPayoutStatus: string | null
  paymentReceivedDate: string | null
  amountReceived: string | null
  invoiceNumber: string | null
  bankVisitScheduled: boolean
  dateOfBankVisit: string | null
  visitedBy: string | null
  bankerRemarks: string | null
  hypAsPerRc: string | null
  loginUser: string | null
  bankInterestRate: string | null
  bankLogin: boolean | null
  bankInProforma: string | null
  createdAt: string
  updatedAt: string
}

export type PayoutKpis = {
  total: number
  pending: number
  received: number
  noPayout: number
  bankVisitDue: number
  payoutTotal: number
  receivedTotal: number
}

export type PayoutListResponse = {
  rows: PayoutRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  /**
   * Payouts a date range is hiding because financing completed before the car was delivered, so they
   * carry no delivery date yet. Zero unless a date filter is applied. NEVER omit this from the
   * screen: a ledger that silently shrinks when you pick a month is how real money stops being
   * chased.
   */
  undatedExcluded?: number
  kpis: PayoutKpis
  canSeeMobile: boolean
  canEdit: boolean
  options: { dealers: string[]; banks: string[] }
}

export type PayoutActivityEntry = {
  id: string
  field: string
  before: unknown
  after: unknown
  actorName: string
  actorRole: string
  createdAt: string
}

export type PayoutDetailResponse = {
  payout: PayoutRow
  activity: PayoutActivityEntry[]
  canEdit: boolean
}

// ── Presentation ────────────────────────────────────────────────────────────────────────────────

export const PAYOUT_STATUS_OPTIONS = [
  { value: 'in_house', label: 'In House' },
  { value: 'out_house', label: 'Out House' },
  { value: 'cash', label: 'Cash' },
  { value: 'staff', label: 'Staff' },
]

export const RECEIPT_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'received', label: 'Received' },
  { value: 'no_payout', label: 'No Payout' },
]

const PAYOUT_TONES: Record<string, Tone> = {
  in_house: 'indigo',
  out_house: 'amber',
  cash: 'teal',
  staff: 'violet',
}

const RECEIPT_TONES: Record<string, Tone> = {
  pending: 'amber',
  received: 'emerald',
  no_payout: 'neutral',
}

const LABELS: Record<string, string> = {
  in_house: 'In House', out_house: 'Out House', cash: 'Cash', staff: 'Staff',
  pending: 'Pending', received: 'Received', no_payout: 'No Payout',
}

export const payoutStatusMeta = (v: string | null) => ({
  label: v ? LABELS[v] || v : '—',
  tone: (v && PAYOUT_TONES[v]) || 'neutral' as Tone,
})

export const receiptStatusMeta = (v: string | null) => ({
  label: v ? LABELS[v] || v : '—',
  tone: (v && RECEIPT_TONES[v]) || 'neutral' as Tone,
})

export const DEALER_LABELS: Record<string, string> = { JK402: 'Jammu', JK501: 'Udhampur' }
export const dealerLabel = (code: string | null) => (code ? DEALER_LABELS[code] || code : '—')

/** Indian-format currency. Blank (not ₹0) when there is no value — 0 and "not recorded" differ. */
export function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export function formatCompactMoney(n: number) {
  if (!Number.isFinite(n)) return '₹0'
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n}`
}

export function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
}

/** camelCase field name → the label the finance team actually uses. Drives the audit timeline. */
export const FIELD_LABELS: Record<string, string> = {
  loanAmount: 'Loan Amount',
  hyp: 'Hypothecation (Bank)',
  bankBranch: 'Bank Branch',
  payoutStatus: 'Payout Status',
  reasonIfOuthouse: 'Reason (Out House)',
  dealerPayoutPercent: 'Dealer Payout %',
  dealerPayoutAmount: 'Dealer Payout Amount',
  payoutReceiptStatus: 'Receipt Status',
  dsePayoutAmount: 'DSE Payout Amount',
  dsePayoutStatus: 'DSE Payout Status',
  dealerPayoutStatus: 'Dealer Payout Status',
  paymentReceivedDate: 'Payment Received Date',
  amountReceived: 'Amount Received',
  invoiceNumber: 'Invoice Number',
  bankVisitScheduled: 'Bank Visit Scheduled',
  dateOfBankVisit: 'Date of Bank Visit',
  visitedBy: 'Visited By',
  bankerRemarks: 'Banker Remarks',
  hypAsPerRc: 'HYP as per RC',
  loginUser: 'Login User',
  bankInterestRate: 'Bank Interest Rate',
  bankLogin: 'Bank Login',
  bankInProforma: 'Bank in Proforma',
  vehicleRegistrationNo: 'Registration No',
}

export const fieldLabel = (f: string) => FIELD_LABELS[f] || f

/** Renders an audit before/after value for display. */
export function auditValue(v: unknown, field?: string): string {
  const raw = v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)
    ? (v as Record<string, unknown>).value
    : v
  if (raw === null || raw === undefined || raw === '') return '—'
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  const s = String(raw)
  if (LABELS[s]) return LABELS[s]
  // ISO timestamp → readable date
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return formatDate(s)
  if (field && ['loanAmount', 'dealerPayoutAmount', 'dsePayoutAmount', 'amountReceived'].includes(field)) {
    return formatMoney(s)
  }
  return s
}
