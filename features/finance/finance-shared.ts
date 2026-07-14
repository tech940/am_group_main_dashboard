export type FinanceStatus = 'pending' | 'in_progress' | 'delayed' | 'completed'

export interface ApprovalQueueRow {
  id: string
  proformaDate: string | null
  customerName: string | null
  mobileNumber: string | null
  customerEmail: string | null
  customerAddress: string | null
  customerType: string | null
  modelName: string | null
  trimDescription: string | null
  fuelType: string | null
  vehicleColor: string | null
  vehicleStatus: string | null
  bankName: string | null
  bankBranch: string | null
  loanAmount: string | number | null
  exShowroom: string | number | null
  tcsValue: string | number | null
  registrationCharges: string | number | null
  insuranceValue: string | number | null
  fastagValue: string | number | null
  accessoriesKit: string | number | null
  extWarranty: string | number | null
  cashDiscount: string | number | null
  exchangeValue: string | number | null
  bookingAmount: string | number | null
  govtEmployeeDiscount: string | number | null
  additionalDiscount: string | number | null
  totalCustomerCost: string | number | null
  grandTotalCost: string | number | null
  consultant: string | null
  location: string | null
  approvalStatus: string | null
  financeStatus: string | null
  insuranceCompany: string | null
  // Booking fallbacks
  bookingId?: string | null
  bookingNumber?: string | null
  bookingStatus?: string | null
  bookingCustomerName?: string | null
  bookingCustomerPhone?: string | null
  bookingCustomerEmail?: string | null
  bookingCustomerAddress?: string | null
  bookingModel?: string | null
  bookingVariant?: string | null
  bookingColor?: string | null
  bookingFuelType?: string | null
  bookingConsultant?: string | null
  bookingBankName?: string | null
  bookingLoanAmount?: string | number | null
  importMetadata?: Record<string, unknown> | null
  bookingMetadata?: Record<string, unknown> | null
}

export interface ProcessingRow {
  processingId: string
  proformaId: string
  financeStatus: FinanceStatus
  startedAt: string
  expectedCompletionDate: string
  completedAt: string | null
  currentBankName: string | null
  currentBankBranch: string | null
  currentBankStatus: string | null
  delayCount: number
  customerName: string | null
  modelName: string | null
  trimDescription: string | null
  consultant: string | null
  location: string | null
}

export interface QueueResponse { approvalQueue: ApprovalQueueRow[]; processing: ProcessingRow[] }

export interface Remark { id: string; remark: string; createdByName: string; createdByRole: string; createdAt: string }
export interface BankAttempt {
  id: string; attemptNo: number; bankName: string; bankBranch: string; status: string
  rejectionReason: string | null; submittedAt: string | null; resolvedAt: string | null
  createdByName: string; createdByRole: string; createdAt: string
}
export interface ActivityEntry {
  id: string; activityType: string; title: string; description: string | null
  beforeValue: unknown; afterValue: unknown; actorName: string; actorRole: string; createdAt: string
}
export interface ProcessingDetailRow {
  id: string; proformaId: string; bookingId: string | null; financeStatus: FinanceStatus
  startedAt: string; expectedCompletionDate: string; baseHours: number; delayCount: number
  lastDelayReasonCategory: string | null; lastDelayReason: string | null
  currentBankName: string | null; currentBankBranch: string | null; currentBankStatus: string | null
  completedAt: string | null; completedByName: string | null; completedByRole: string | null
  createdAt: string; updatedAt: string
}
export interface DetailResponse {
  processing: ProcessingDetailRow
  proforma: Record<string, unknown>
  booking: { bookingNumber: string | null; status: string | null; deliveredAt: string | null; paymentReceived: boolean; dealerCode: string | null; financeRequired: boolean | null } | null
  remarks: Remark[]
  bankAttempts: BankAttempt[]
  activity: ActivityEntry[]
}

// Delay reason preset list (from the spec). "Other" reveals a required custom-text input.
export const DELAY_REASONS = [
  'Document Issue',
  'CIBIL Score Issue',
  'Delayed by Bank',
  'Bank Holiday',
  'Customer Not Reachable',
  'Customer Documents Pending',
  'Customer Requested Extension',
  'Awaiting Co-Applicant Documents',
  'Loan Amount Revision',
  'Internal Processing Delay',
  'Other',
] as const

export function num(value: unknown): number {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function str(value: unknown): string {
  return value == null ? '' : String(value)
}

export function formatCurrency(value: unknown): string {
  const n = num(value)
  const r = Math.round(Math.abs(n))
  const sign = n < 0 ? '-' : ''
  if (r >= 10000000) return `${sign}₹${(r / 10000000).toFixed(2)}Cr`
  if (r >= 100000) return `${sign}₹${(r / 100000).toFixed(2)}L`
  return `${sign}₹${r.toLocaleString('en-IN')}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso))
  } catch { return '—' }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso))
  } catch { return '—' }
}

export function roleLabel(role: string | null | undefined): string {
  return str(role).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '—'
}

export function statusMeta(status: FinanceStatus): { label: string; className: string } {
  switch (status) {
    case 'completed': return { label: 'Completed', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    case 'delayed': return { label: 'Delayed', className: 'bg-amber-50 text-amber-700 border-amber-200' }
    case 'in_progress': return { label: 'In Progress', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' }
    default: return { label: 'Pending', className: 'bg-slate-50 text-slate-600 border-slate-200' }
  }
}

export function bankStatusMeta(status: string | null | undefined): string {
  const s = str(status).toLowerCase()
  if (s === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (s === 'rejected') return 'bg-rose-50 text-rose-700 border-rose-200'
  return 'bg-amber-50 text-amber-700 border-amber-200'
}

// Live remaining-time formatter for the completion countdown.
export function formatCountdown(target: string | null | undefined, now: number): { label: string; overdue: boolean } {
  if (!target) return { label: '—', overdue: false }
  const end = new Date(target).getTime()
  if (!Number.isFinite(end)) return { label: '—', overdue: false }
  let diff = end - now
  const overdue = diff < 0
  diff = Math.abs(diff)
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  const seconds = Math.floor((diff % 60_000) / 1000)
  const parts = days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m ${seconds}s`
  return { label: overdue ? `Overdue by ${parts}` : parts, overdue }
}
