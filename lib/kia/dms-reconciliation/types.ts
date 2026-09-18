/**
 * KIA DMS reconciliation — shared vocabulary. Client-safe: no database, no server-only imports.
 *
 * The question this feature answers (owner, 2026-09-18): which KIA bookings have already moved on in
 * the DMS — paid for, invoiced, delivered, cancelled — while our Kia Booking workflow has not? And the
 * reverse the owner also asked for: delivered here with no retail in DMS.
 */

/** DMS receipts above this total count as "payment received" — the same line as our own
 *  payment-secured threshold (lib/kia/workflow-access.ts). Owner decision, 2026-09-18. */
export const DMS_PAID_THRESHOLD = 700000

export const RECON_EXCEPTION_TYPES = [
  'dms_delivered',
  'dms_invoiced',
  'dms_paid',
  'dms_cancelled',
  'internal_ahead',
  'unmatched_dms',
] as const
export type ReconExceptionType = typeof RECON_EXCEPTION_TYPES[number]

export type ReconSeverity = 'critical' | 'high' | 'medium'
export type ReconKind = 'exception' | 'review' | 'unmatched_dms'

export const RECON_TYPE_META: Record<ReconExceptionType, {
  label: string
  short: string
  severity: ReconSeverity
  /** What someone has to do about it, in one line. */
  action: string
}> = {
  dms_delivered: {
    label: 'Delivered in DMS, not delivered here',
    short: 'DMS delivered',
    severity: 'critical',
    action: 'Bring the booking up to date: allot the chassis DMS delivered, get Accounts to confirm payment, then mark it delivered.',
  },
  dms_invoiced: {
    label: 'Invoiced in DMS, not progressed here',
    short: 'DMS invoiced',
    severity: 'high',
    action: 'DMS has invoiced a car to this customer. Allot that chassis here and get Accounts to confirm payment.',
  },
  dms_paid: {
    label: 'Paid in DMS, payment not confirmed here',
    short: 'DMS paid',
    severity: 'high',
    action: 'DMS shows the customer has paid. Accounts should confirm the payment against this booking.',
  },
  dms_cancelled: {
    label: 'Cancelled in DMS, still active here',
    short: 'DMS cancelled',
    severity: 'medium',
    action: 'Confirm with the customer. If the booking is cancelled, cancel it here too; if not, correct DMS.',
  },
  internal_ahead: {
    label: 'Delivered here, not retailed in DMS',
    short: 'Not in DMS',
    severity: 'medium',
    action: 'Retail the car in DMS, or check whether this booking was marked delivered by mistake.',
  },
  unmatched_dms: {
    label: 'In DMS with no booking here',
    short: 'Unmatched DMS',
    severity: 'medium',
    action: 'Create the booking here, or check that it was entered under a different mobile number.',
  },
}

/** Our booking's progress, reduced to the steps DMS can be compared against. */
export type OurStage = 'closed' | 'booking' | 'proforma' | 'allotted' | 'paid' | 'delivered' | 'on_hold'

export const OUR_STAGE_LABEL: Record<OurStage, string> = {
  closed: 'Cancelled',
  booking: 'Booking',
  proforma: 'Proforma',
  allotted: 'Allotted',
  paid: 'Paid',
  delivered: 'Delivered',
  on_hold: 'On hold',
}

/** How the internal booking was tied to the DMS booking. Lower is stronger; 5+ is only "possible". */
export const MATCH_TIER_LABEL: Record<number, string> = {
  1: 'Exact — DMS booking no.',
  2: 'Exact — chassis + mobile/PAN',
  3: 'Exact — PAN',
  4: 'Exact — mobile + name',
  5: 'Possible — mobile only',
  6: 'Possible — chassis only',
  7: 'Possible — DMS booking no. only',
}
export const CONFIDENT_MATCH_MAX_TIER = 4

/** One row of the exceptions table, as the API serves it. Phones already masked for the viewer. */
export type ReconListRow = {
  id: string
  kind: ReconKind
  type: ReconExceptionType
  severity: ReconSeverity
  state: 'open' | 'resolved'
  eventDate: string
  eventMonth: string
  /** The month the row is filed under: our booking's date (or the DMS booking date if none here). */
  bookingDate: string | null
  bookingMonth: string | null
  firstSeenAt: string
  resolvedAt: string | null
  ageDays: number
  headline: string
  bookingId: string | null
  bookingNumber: string | null
  customerName: string | null
  mobile: string | null
  dealerCode: string | null
  model: string | null
  variant: string | null
  ourStatus: string | null
  ourStage: OurStage | null
  dmsBookingNo: string | null
  dmsStatus: string | null
  vin: string | null
  invoiceNo: string | null
  deliveryDate: string | null
  dmsReceived: number | null
  paymentReceived: boolean
  matchTier: number | null
  matchLabel: string | null
}

export type ReconSummary = {
  total: number
  byType: Record<ReconExceptionType, number>
  review: number
}

export type ReconListResponse = {
  month: string
  currentMonth: string
  isCurrentMonth: boolean
  rows: ReconListRow[]
  total: number
  page: number
  pageSize: number
  summary: ReconSummary
  canViewPii: boolean
  freshness: ReconFreshness
}

export type ReconFreshness = {
  lastRunAt: string | null
  lastRunMs: number | null
  refreshing: boolean
  feeds: { dmsBookings: string | null; dmsSales: string | null; dmsReceipts: string | null }
  coverage: { ourBookings: number; matched: number; review: number; unmatched: number } | null
  lastError: string | null
}

export function monthKey(date: Date | string): string {
  const value = typeof date === 'string' ? date : date.toISOString()
  return value.slice(0, 7)
}
