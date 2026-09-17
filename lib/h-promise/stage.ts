/**
 * Where a vehicle is in its life, and what needs attention — DERIVED from the facts, never stored.
 * Client-safe and pure.
 *
 * ⚠️ Stored stages drift: the sheet had a booking column, a sale column and an approval column, and nothing
 * kept them agreeing. Here the stage is computed from the same columns every time, so it cannot disagree
 * with them.
 */

import { SOLD_VEHICLE_REQUIRED_DOCS, type FileKind } from './constants'

export type VehicleStage = 'in_stock' | 'booked' | 'sold' | 'deleted'

export const STAGE_LABELS: Record<VehicleStage, string> = {
  in_stock: 'In stock',
  booked: 'Booked',
  sold: 'Sold',
  deleted: 'Deleted',
}

/**
 * A vehicle counts as sold once a sale is recorded and not refused. A rejected sale puts it back on the
 * floor (or back to "booked" if a booking is still live).
 */
export function deriveStage(input: {
  deletedAt: string | Date | null | undefined
  saleStatus: string | null | undefined
  hasActiveBooking: boolean
}): VehicleStage {
  if (input.deletedAt) return 'deleted'
  if (input.saleStatus === 'pending' || input.saleStatus === 'approved') return 'sold'
  if (input.hasActiveBooking) return 'booked'
  return 'in_stock'
}

// ── Dates (YYYY-MM-DD strings, as Drizzle returns `date` columns) ───────────────────────────────

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

function ymdToUtcMs(ymd: string): number | null {
  const match = YMD.exec(ymd)
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(ms) ? ms : null
}

/** Whole days from `from` to `to`. Null when either date is missing or malformed. */
export function daysBetweenYmd(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null
  const a = ymdToUtcMs(from)
  const b = ymdToUtcMs(to)
  if (a === null || b === null) return null
  return Math.round((b - a) / 86_400_000)
}

/** Days the vehicle has been (or was) with us: purchase → sale, or purchase → today while unsold. */
export function daysInStock(purchaseDate: string | null | undefined, saleDate: string | null | undefined, todayYmd: string): number | null {
  const days = daysBetweenYmd(purchaseDate, saleDate || todayYmd)
  return days === null ? null : Math.max(0, days)
}

export type AgingBucket = '0-15' | '16-30' | '31-60' | '60+'
export const AGING_BUCKETS: readonly AgingBucket[] = ['0-15', '16-30', '31-60', '60+']

export function agingBucket(days: number): AgingBucket {
  if (days <= 15) return '0-15'
  if (days <= 30) return '16-30'
  if (days <= 60) return '31-60'
  return '60+'
}

/** The sheet's "long aging" threshold. */
export const LONG_AGING_DAYS = 60

export type InsuranceState = 'expired' | 'due7' | 'due15' | 'due30' | 'ok' | 'unknown'

export const INSURANCE_STATE_LABELS: Record<InsuranceState, string> = {
  expired: 'Insurance expired',
  due7: 'Insurance due in 7 days',
  due15: 'Insurance due in 15 days',
  due30: 'Insurance due in 30 days',
  ok: 'Insurance valid',
  unknown: 'Insurance date not recorded',
}

export function insuranceState(endYmd: string | null | undefined, todayYmd: string): InsuranceState {
  const days = daysBetweenYmd(todayYmd, endYmd)
  if (days === null) return 'unknown'
  if (days < 0) return 'expired'
  if (days <= 7) return 'due7'
  if (days <= 15) return 'due15'
  if (days <= 30) return 'due30'
  return 'ok'
}

// ── Attention flags ──────────────────────────────────────────────────────────────────────────────

export type FlagInput = {
  deletedAt: string | Date | null | undefined
  purchaseDate: string | null | undefined
  expectedSaleDate?: string | null | undefined
  purchaseStatus: string | null | undefined
  saleStatus: string | null | undefined
  saleDate: string | null | undefined
  soldTo: string | null | undefined
  insuranceEndDate: string | null | undefined
  hasActiveBooking: boolean
  /** The file kinds currently attached to the vehicle. */
  presentFiles: ReadonlySet<FileKind>
}

export type VehicleFlags = {
  stage: VehicleStage
  purchasePending: boolean
  purchaseRejected: boolean
  salePending: boolean
  saleRejected: boolean
  /** A sale is recorded but no payment ledger has been uploaded. */
  ledgerPending: boolean
  /** Sold, but RC, seller Aadhaar, seller PAN or insurance is missing (the sheet's rule). */
  docsMissing: boolean
  missingDocs: FileKind[]
  /** Sold to a broker, and no RC transfer proof yet. */
  brokerRcPending: boolean
  /** Only meaningful for vehicles still with us — a sold car's insurance is the buyer's concern. */
  insurance: InsuranceState | null
  daysInStock: number | null
  longAging: boolean
  /** Active stock that has breached the target sale date committed at purchase. */
  saleOverdue: boolean
  daysOverdue: number | null
}

export function deriveFlags(input: FlagInput, todayYmd: string): VehicleFlags {
  const stage = deriveStage(input)
  const sold = stage === 'sold'
  const missingDocs = sold ? SOLD_VEHICLE_REQUIRED_DOCS.filter((kind) => !input.presentFiles.has(kind)) : []
  const days = daysInStock(input.purchaseDate, sold ? input.saleDate : null, todayYmd)
  const active = stage === 'in_stock' || stage === 'booked'
  const isOverdue = Boolean(active && input.expectedSaleDate && input.expectedSaleDate < todayYmd)
  const daysOverdue = isOverdue && input.expectedSaleDate ? daysBetweenYmd(input.expectedSaleDate, todayYmd) : null

  return {
    stage,
    purchasePending: stage !== 'deleted' && input.purchaseStatus === 'pending',
    purchaseRejected: stage !== 'deleted' && input.purchaseStatus === 'rejected',
    salePending: stage !== 'deleted' && input.saleStatus === 'pending',
    saleRejected: stage !== 'deleted' && input.saleStatus === 'rejected',
    ledgerPending: sold && !input.presentFiles.has('payment_ledger'),
    docsMissing: missingDocs.length > 0,
    missingDocs,
    brokerRcPending: sold && input.soldTo === 'BROKER' && !input.presentFiles.has('rc_transfer'),
    insurance: active ? insuranceState(input.insuranceEndDate, todayYmd) : null,
    daysInStock: days,
    longAging: active && days !== null && days >= LONG_AGING_DAYS,
    saleOverdue: isOverdue,
    daysOverdue,
  }
}
