import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * VEHICLE ALLOCATION HISTORY — the permanent audit trail for every allocation and release.
 *
 * The trail already exists: `kia_vehicle_allocations` has carried allocated_by / allocated_at /
 * expires_at / released_by / released_at / release_reason since it was created, and rows are only
 * ever UPDATED on release, never deleted. So nothing was being lost — there was simply no way to
 * look at it. This module is the reader; the writers are the allocate and release paths in
 * lib/kia/bookings.ts and the expiry sweep in the KIA maintenance cron.
 *
 * Verified against live data: 56 allocations, all 56 joinable to a booking and to the allocating
 * user; 32 already carry the auto-expiry reason "No payment received within the reservation window".
 *
 * ⚠️ Read-only ON PURPOSE. Nothing here writes, and the route exposes no mutation — an audit trail
 * that the audited party can edit is not an audit trail.
 */

export type AllocationHistoryRow = {
  id: string
  bookingId: string
  bookingNumber: string
  customerName: string
  dealerCode: string
  vin: string
  model: string
  variant: string
  color: string
  engineNo: string
  stockSource: string
  /**
   * The booking amount the customer put down, from the booking's PROFORMA
   * (kia_proformas.booking_amount) — kia_bookings has no such column; it only carries loan_amount.
   *
   * NULL, not 0, when the booking has no proforma yet: 32 of 144 allocations are in that state and
   * rendering them as Rs0 would assert a deposit of zero that nobody recorded. The default on the
   * proforma column is itself '0', so a real 0 and a missing proforma are different facts.
   */
  bookingAmount: number | null
  /**
   * Part payments recorded against THIS allocation (migration 0048) — count and rupee total.
   *
   * Per-allocation, not per-booking, on purpose: the trail's job is to say what happened to THIS
   * reservation of THIS vehicle. A customer whose first car lapsed and who was re-allotted has money
   * against both rows, and rolling it up to the booking would show the same figure twice and make it
   * look like they paid the total on each.
   */
  paymentCount: number
  paymentTotal: number
  /** The booking's running total across every allocation — what the secured test is actually made of. */
  bookingReceivedTotal: number
  /** Set while the reservation clock was suspended because the customer was past the threshold. */
  paymentSecuredAt: string | null
  allocatedBy: string
  allocatedAt: string | null
  expiresAt: string | null
  releasedBy: string | null
  releasedAt: string | null
  releaseReason: string | null
  paymentConfirmedAt: string | null
  allocationStatus: string
  /**
   * Derived: what actually happened to this allocation, in plain words.
   *
   * ⚠️ MUTUALLY EXCLUSIVE, and it has to be. The first version tested `released_at IS NULL` first,
   * so the four allocations that were PAID and are still held read as "Awaiting payment" in the
   * table while simultaneously counting in the "Payment confirmed" card — 20+5+32+5 = 62 buckets
   * over 57 rows. Release reason decides first (it is the whole point of the trail), then payment,
   * then the countdown. Every row lands in exactly one bucket, and the cards sum to the total.
   */
  outcome: 'Awaiting payment' | 'Payment confirmed' | 'Released — no payment' | 'Released — manual' | 'Released'
  /** Minutes the vehicle was held. Null while it is still held. */
  heldMinutes: number | null
  /** Released at or after the countdown expiry — i.e. the reservation window actually ran out. */
  expired: boolean
  /** Still held with the countdown already past. The sweep has not reclaimed it yet. */
  overdue: boolean
}

export type AllocationHistoryFilters = {
  search?: string | null
  outcome?: string | null
  /** A single dealer the USER chose. Narrowing only — never widens `allowedDealers`. */
  dealerCode?: string | null
  /**
   * The branches this user may see. NULL = unrestricted.
   *
   * ⚠️ Must be the FULL pinned list. The route used to collapse it to `allowed[0]`, which hard-
   * pinned every two-branch user to whichever code happened to sort first: an IDT user pinned to
   * 'JK501,JK402' saw 34 of 116 "Released — no payment" with no control to reach the other branch,
   * while the Bookings tab beside it — scoped with inArray over the whole array — showed both.
   */
  allowedDealers?: string[] | null
  startDate?: string | null
  endDate?: string | null
  page?: number
  pageSize?: number
}

const esc = (v: string) => v.replace(/'/g, "''")

/** The auto-expiry reason written by the countdown sweep. Anything else was a human decision. */
const AUTO_EXPIRY_REASON = 'No payment received within the reservation window'

function buildWhere(f: AllocationHistoryFilters): string {
  const c: string[] = ['1=1']

  const search = (f.search || '').trim()
  if (search && /^[A-Za-z0-9 ._\-/]{1,60}$/.test(search)) {
    const t = esc(search)
    c.push(`(
      a.vin_number ILIKE '%${t}%'
      OR b.booking_number ILIKE '%${t}%'
      OR b.customer_name ILIKE '%${t}%'
      OR a.model ILIKE '%${t}%'
      OR a.variant ILIKE '%${t}%'
      OR u.full_name ILIKE '%${t}%'
    )`)
  }

  /*
   * Two independent things, applied in this order:
   *   allowedDealers — the branch boundary. The user cannot widen it.
   *   dealerCode     — a narrowing the user chose, only honoured if inside the boundary.
   */
  const allowed = (f.allowedDealers || [])
    .map((d) => String(d || '').trim().toUpperCase())
    .filter((d) => /^[A-Za-z0-9_-]{1,16}$/.test(d))
  if (f.allowedDealers && allowed.length === 0) {
    // Pinned, but to nothing valid here. Fail CLOSED — showing everything would be the inverse and
    // far worse mistake.
    c.push('1=0')
  } else if (allowed.length) {
    c.push(`UPPER(TRIM(COALESCE(a.dealer_code, ''))) IN (${allowed.map((d) => `'${esc(d)}'`).join(', ')})`)
  }

  const dealer = (f.dealerCode || '').trim()
  if (dealer && dealer !== 'all' && /^[A-Za-z0-9_-]{1,16}$/.test(dealer)) {
    c.push(`UPPER(TRIM(COALESCE(a.dealer_code, ''))) = '${esc(dealer.toUpperCase())}'`)
  }

  // Filters on the ALLOCATION date — the event this trail is about.
  if (f.startDate && /^\d{4}-\d{2}-\d{2}$/.test(f.startDate)) c.push(`a.allocated_at >= '${f.startDate}'::date`)
  if (f.endDate && /^\d{4}-\d{2}-\d{2}$/.test(f.endDate)) c.push(`a.allocated_at < ('${f.endDate}'::date + INTERVAL '1 day')`)

  // Each branch mirrors one label in the outcome derivation below — same order, same exclusivity.
  switch ((f.outcome || '').trim()) {
    case 'active':
      c.push('a.released_at IS NULL AND a.payment_confirmed_at IS NULL')
      break
    case 'paid':
      c.push('a.released_at IS NULL AND a.payment_confirmed_at IS NOT NULL')
      break
    case 'overdue':
      c.push('a.released_at IS NULL AND a.payment_confirmed_at IS NULL AND a.expires_at IS NOT NULL AND a.expires_at < NOW()')
      break
    case 'no_payment':
      c.push(`a.released_at IS NOT NULL AND a.release_reason = '${esc(AUTO_EXPIRY_REASON)}'`)
      break
    case 'manual':
      c.push(`a.released_at IS NOT NULL AND COALESCE(a.release_reason, '') <> '${esc(AUTO_EXPIRY_REASON)}'`)
      break
    default:
      break
  }

  return c.join(' AND ')
}

export async function getAllocationHistory(filters: AllocationHistoryFilters) {
  const pageSize = Math.min(200, Math.max(10, Number(filters.pageSize) || 50))
  const page = Math.max(1, Number(filters.page) || 1)
  const offset = (page - 1) * pageSize
  const where = buildWhere(filters)

  const rowsResult = await db.execute(sql.raw(`
    SELECT
      a.id::text, a.booking_id::text,
      COALESCE(b.booking_number, '') AS booking_number,
      COALESCE(b.customer_name, '') AS customer_name,
      COALESCE(a.dealer_code, '') AS dealer_code,
      COALESCE(a.vin_number, '') AS vin,
      COALESCE(a.model, '') AS model,
      COALESCE(a.variant, '') AS variant,
      COALESCE(a.color, '') AS color,
      COALESCE(a.engine_no, '') AS engine_no,
      COALESCE(a.stock_source, '') AS stock_source,
      -- Deliberately NOT COALESCEd to 0: a missing proforma must stay NULL. See the type comment.
      p.booking_amount AS booking_amount,
      -- Part payments taken against THIS allocation. Reversals carry a negative amount, so a plain
      -- SUM self-corrects and a reversed payment stops inflating the trail.
      COALESCE(pay.entries, 0)::int      AS payment_count,
      COALESCE(pay.total, 0)::float8     AS payment_total,
      COALESCE(b.amount_received, 0)::float8 AS booking_received_total,
      a.payment_secured_at,
      COALESCE(u.full_name, u.email, 'Unknown') AS allocated_by,
      a.allocated_at, a.expires_at,
      COALESCE(r.full_name, r.email) AS released_by,
      a.released_at, a.release_reason, a.payment_confirmed_at,
      COALESCE(a.allocation_status, '') AS allocation_status,
      -- How long the vehicle was actually held out of free stock.
      CASE WHEN a.released_at IS NOT NULL AND a.allocated_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (a.released_at - a.allocated_at)) / 60 END AS held_minutes,
      (a.expires_at IS NOT NULL AND a.released_at IS NOT NULL AND a.released_at >= a.expires_at) AS expired,
      COUNT(*) OVER () AS total_count
    FROM kia_vehicle_allocations a
    LEFT JOIN kia_bookings b ON b.id = a.booking_id
    -- LEFT so an allocation whose booking has no proforma still appears (32 of 144 today).
    -- deleted_at IS NULL is part of the JOIN, not the WHERE: in the WHERE it would turn this
    -- LEFT JOIN into an inner one and silently drop those rows from the trail.
    LEFT JOIN kia_proformas p ON p.id = b.proforma_id AND p.deleted_at IS NULL
    LEFT JOIN users u ON u.id = a.allocated_by
    LEFT JOIN users r ON r.id = a.released_by
    -- One aggregate per allocation rather than a correlated subquery per column: this reader is
    -- paginated and the pooler charges per statement, so the join is the cheap shape.
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE bp.entry_type = 'payment')::int AS entries,
             COALESCE(SUM(bp.amount), 0) AS total
      FROM kia_booking_payments bp
      WHERE bp.allocation_id = a.id
    ) pay ON TRUE
    WHERE ${where}
    ORDER BY a.allocated_at DESC NULLS LAST, a.id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `))

  const raw = (Array.isArray(rowsResult) ? rowsResult : []) as Record<string, unknown>[]
  const total = raw.length ? Number(raw[0].total_count) || 0 : 0
  const str = (v: unknown) => String(v ?? '')
  const iso = (v: unknown) => (v ? String(v) : null)

  const rows: AllocationHistoryRow[] = raw.map((r) => {
    const releasedAt = iso(r.released_at)
    const reason = r.release_reason ? String(r.release_reason) : null
    const paid = iso(r.payment_confirmed_at)
    const outcome: AllocationHistoryRow['outcome'] = releasedAt
      ? reason === AUTO_EXPIRY_REASON
        ? 'Released — no payment'
        : reason
          ? 'Released — manual'
          : 'Released'
      : paid
        ? 'Payment confirmed'
        : 'Awaiting payment'
    const expiresAt = iso(r.expires_at)
    return {
      id: str(r.id),
      bookingId: str(r.booking_id),
      bookingNumber: str(r.booking_number),
      customerName: str(r.customer_name),
      dealerCode: str(r.dealer_code),
      vin: str(r.vin),
      model: str(r.model),
      variant: str(r.variant),
      color: str(r.color),
      engineNo: str(r.engine_no),
      stockSource: str(r.stock_source),
      bookingAmount: r.booking_amount === null || r.booking_amount === undefined
        ? null
        : Number(r.booking_amount),
      paymentCount: Number(r.payment_count || 0),
      paymentTotal: Number(r.payment_total || 0),
      bookingReceivedTotal: Number(r.booking_received_total || 0),
      paymentSecuredAt: iso(r.payment_secured_at),
      allocatedBy: str(r.allocated_by),
      allocatedAt: iso(r.allocated_at),
      expiresAt,
      releasedBy: r.released_by ? String(r.released_by) : null,
      releasedAt,
      releaseReason: reason,
      paymentConfirmedAt: paid,
      allocationStatus: str(r.allocation_status),
      outcome,
      heldMinutes: r.held_minutes === null || r.held_minutes === undefined ? null : Math.round(Number(r.held_minutes)),
      expired: Boolean(r.expired),
      overdue: !releasedAt && !paid && Boolean(expiresAt) && new Date(expiresAt as string).getTime() < Date.now(),
    }
  })

  return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

/** Headline counts over the WHOLE trail, unaffected by paging. */
export async function getAllocationHistorySummary(filters: AllocationHistoryFilters) {
  const where = buildWhere({ ...filters, outcome: null })
  const result = await db.execute(sql.raw(`
    SELECT
      COUNT(*)::int AS total,
      -- Mirrors the exclusive outcome buckets: released decides first, then payment. active + paid +
      -- no_payment + manual + unreasoned releases = total, exactly.
      COUNT(*) FILTER (WHERE a.released_at IS NULL AND a.payment_confirmed_at IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE a.released_at IS NULL AND a.payment_confirmed_at IS NOT NULL)::int AS paid,
      COUNT(*) FILTER (WHERE a.released_at IS NULL AND a.payment_confirmed_at IS NULL
                         AND a.expires_at IS NOT NULL AND a.expires_at < NOW())::int AS overdue,
      COUNT(*) FILTER (WHERE a.released_at IS NOT NULL AND a.release_reason = '${esc(AUTO_EXPIRY_REASON)}')::int AS no_payment,
      COUNT(*) FILTER (WHERE a.released_at IS NOT NULL AND COALESCE(a.release_reason, '') <> '${esc(AUTO_EXPIRY_REASON)}')::int AS manual,
      COUNT(DISTINCT a.vin_number)::int AS vehicles,
      COUNT(DISTINCT a.booking_id)::int AS bookings,
      /*
       * Booking amount across the WHOLE filtered trail, not the visible page.
       *
       * A footer total under a paginated table would describe only the rows on screen while
       * looking like the total — the same shape as the purchase-orders "Showing 1-12 of 42" bug.
       * Summed here, it moves with the filters and ignores paging, which is what a total should do.
       *
       * DISTINCT on booking_id because one booking can hold several allocations over time
       * (allocate -> release -> re-allocate); summing per allocation would multiply one customer's
       * deposit by the number of cars they were ever assigned.
       */
      COALESCE(SUM(DISTINCT_AMT.amt), 0)::float8 AS booking_amount_total,
      COUNT(DISTINCT_AMT.amt)::int AS booking_amount_rows
    FROM kia_vehicle_allocations a
    LEFT JOIN kia_bookings b ON b.id = a.booking_id
    LEFT JOIN users u ON u.id = a.allocated_by
    LEFT JOIN LATERAL (
      -- One amount per BOOKING, attributed to its first allocation row only.
      SELECT p.booking_amount::numeric AS amt
      FROM kia_proformas p
      WHERE p.id = b.proforma_id AND p.deleted_at IS NULL
        AND p.booking_amount::numeric > 0
        AND a.id = (SELECT a2.id FROM kia_vehicle_allocations a2
                    WHERE a2.booking_id = a.booking_id
                    ORDER BY a2.allocated_at NULLS LAST, a2.id LIMIT 1)
    ) DISTINCT_AMT ON TRUE
    WHERE ${where}
  `))
  const r = ((Array.isArray(result) ? result[0] : {}) || {}) as Record<string, unknown>
  const n = (v: unknown) => Number(v) || 0
  return {
    total: n(r.total),
    active: n(r.active),
    paid: n(r.paid),
    noPayment: n(r.no_payment),
    manual: n(r.manual),
    overdue: n(r.overdue),
    vehicles: n(r.vehicles),
    bookings: n(r.bookings),
    /** Total booking amount over the whole filtered trail, deduped per booking. */
    bookingAmountTotal: n(r.booking_amount_total),
    /** How many bookings actually contributed — the rest have no proforma yet. */
    bookingAmountRows: n(r.booking_amount_rows),
  }
}

export { AUTO_EXPIRY_REASON }
