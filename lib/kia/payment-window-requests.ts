import 'server-only'

import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  kiaBookings,
  kiaPaymentWindowRequests,
  kiaVehicleAllocations,
  users,
} from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import {
  CSD_ALLOCATION_HOURS,
  TEMPORARY_ALLOCATION_HOURS,
  addActivity,
  allocationHoursForBooking,
  type DbTx,
} from '@/lib/kia/bookings'

/**
 * MD-approved extensions to a KIA allocation's payment window.
 *
 * The standard window is 5 days (7 days for CSD), fixed at allotment. A consultant can ask for 1–15 days
 * instead, with a reason. The allotment still proceeds on the DEFAULT window — the request changes
 * nothing until the MD approves it.
 *
 * Two invariants this module exists to protect:
 *
 *  1. **An extension must never SHORTEN a window.** The new deadline runs from approval time (a
 *     product decision), so a small grant approved late could otherwise land earlier than the
 *     deadline the customer was already given. Every path floors at the existing expiry.
 *  2. **An in-transit car has no clock yet.** Its `expires_at` is NULL and only opens when the DMS
 *     reports the car as Free Stock, via startKiaArrivedAllocationCountdowns — which re-derives the
 *     window IN RAW SQL. So approval writes `payment_window_hours` and lets that sweep apply it;
 *     writing only `expires_at` would silently lose the extension.
 */

export const MIN_EXTENSION_DAYS = 1
export const MAX_EXTENSION_DAYS = 15

export type PaymentWindowRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/** Why an extension cannot be applied. Every one of these is a 409 at the API boundary. */
export type PaymentWindowConflict =
  | 'ALREADY_ACTIONED'
  | 'ALLOCATION_RELEASED'
  | 'PAYMENT_ALREADY_CONFIRMED'
  | 'BOOKING_CLOSED'

export const PAYMENT_WINDOW_CONFLICT_MESSAGES: Record<PaymentWindowConflict, string> = {
  ALREADY_ACTIONED: 'This request has already been decided.',
  ALLOCATION_RELEASED: 'The reservation has already lapsed and the vehicle returned to stock, so the payment window can no longer be extended. Re-allot the vehicle instead.',
  PAYMENT_ALREADY_CONFIRMED: 'Payment has already been confirmed for this vehicle, so extending the window would have no effect.',
  BOOKING_CLOSED: 'This booking is no longer active (cancelled or delivered), so the payment window cannot be extended.',
}

export function isValidExtensionDays(value: unknown): value is number {
  return Number.isInteger(value)
    && (value as number) >= MIN_EXTENSION_DAYS
    && (value as number) <= MAX_EXTENSION_DAYS
}

/** The policy default in hours for a booking — 120 for CSD, else 72. Re-exported for the UI copy. */
export function policyWindowHours(booking: { metadata?: unknown } | null | undefined): number {
  return allocationHoursForBooking(booking)
}

export function policyWindowHoursFromCustomerType(customerType: unknown): number {
  return String(customerType ?? '').trim().toLowerCase() === 'csd'
    ? CSD_ALLOCATION_HOURS
    : TEMPORARY_ALLOCATION_HOURS
}

type AllocationState = {
  allocationStatus: string
  expiresAt: Date | null
  releasedAt: Date | null
  paymentConfirmedAt: Date | null
}

type BookingState = {
  status: string
  deletedAt: Date | null
}

export type ExtensionOutcome =
  | { ok: false; conflict: PaymentWindowConflict }
  | {
      ok: true
      /** New deadline to write, or null for an in-transit allocation whose clock has not opened. */
      expiresAt: Date | null
      /** Always written, so the arrival sweep honours the grant for in-transit cars. */
      paymentWindowHours: number
      /** True when the floor kicked in — the grant was shorter than the existing deadline. */
      floored: boolean
      /** True when the clock has not started yet, so the window applies from arrival. */
      startsOnArrival: boolean
    }

/**
 * PURE. Decides what an approval should write. No I/O, so the whole edge-case matrix is verifiable
 * by script — which matters because these branches are hard to reach through the UI.
 */
export function resolvePaymentWindowExtension(input: {
  allocation: AllocationState
  booking: BookingState
  approvedDays: number
  now: Date
}): ExtensionOutcome {
  const { allocation, booking, approvedDays, now } = input

  if (booking.deletedAt || booking.status === 'cancelled' || booking.status === 'delivered') {
    return { ok: false, conflict: 'BOOKING_CLOSED' }
  }
  // Order matters: a released allocation is the more specific, more actionable message, and an
  // expired-then-released row also has payment_confirmed_at NULL.
  if (allocation.releasedAt) return { ok: false, conflict: 'ALLOCATION_RELEASED' }
  if (allocation.paymentConfirmedAt) return { ok: false, conflict: 'PAYMENT_ALREADY_CONFIRMED' }

  const paymentWindowHours = approvedDays * 24

  // In transit: no anchor exists yet. Record the window only; the arrival sweep applies it from the
  // moment the DMS reports the car as Free Stock.
  if (!allocation.expiresAt) {
    return { ok: true, expiresAt: null, paymentWindowHours, floored: false, startsOnArrival: true }
  }

  const granted = new Date(now.getTime() + paymentWindowHours * 60 * 60 * 1000)
  // Never shrink. A "request extra time" control must not be able to bring a deadline forward.
  const floored = granted.getTime() < allocation.expiresAt.getTime()
  return {
    ok: true,
    expiresAt: floored ? allocation.expiresAt : granted,
    paymentWindowHours,
    floored,
    startsOnArrival: false,
  }
}

/** Creates the PENDING request. Called inside the allot transaction so it cannot half-apply. */
export async function createPaymentWindowRequest(tx: DbTx, params: {
  bookingId: string
  allocationId: string
  vinNumber: string
  requestedDays: number
  baseHours: number
  reason: string
  appUser: AppUser
}) {
  if (!isValidExtensionDays(params.requestedDays)) {
    throw new Error(`Extra time must be a whole number of days between ${MIN_EXTENSION_DAYS} and ${MAX_EXTENSION_DAYS}.`)
  }
  const reason = params.reason.trim()
  if (!reason) throw new Error('A reason is required when requesting extra payment time.')

  const [row] = await tx.insert(kiaPaymentWindowRequests).values({
    bookingId: params.bookingId,
    allocationId: params.allocationId,
    vinNumber: params.vinNumber,
    requestedDays: params.requestedDays,
    baseHours: params.baseHours,
    reason,
    requestedBy: params.appUser.id,
    requestedByName: params.appUser.fullName,
  }).returning()

  return row
}

export type PaymentWindowRequestRow = {
  id: string
  bookingId: string
  allocationId: string
  vinNumber: string
  requestedDays: number
  baseHours: number
  reason: string
  status: string
  approvedDays: number | null
  requestedByName: string
  actionByName: string | null
  actionRemarks: string | null
  actionAt: Date | null
  appliedExpiresAt: Date | null
  createdAt: Date
  bookingNumber: string | null
  customerName: string | null
  model: string | null
  variant: string | null
  color: string | null
  dealerCode: string | null
  consultantName: string | null
  bookingStatus: string | null
  allocationStatus: string | null
  expiresAt: Date | null
  allocatedAt: Date | null
  paymentConfirmedAt: Date | null
  releasedAt: Date | null
}

/** The MD queue. Joined to booking + allocation so the reviewer has the full picture in one read. */
export async function listPaymentWindowRequests(options: { status?: string } = {}) {
  const wanted = String(options.status || '').toUpperCase()
  const filter = ['PENDING', 'APPROVED', 'REJECTED'].includes(wanted) ? wanted : null

  const rows = await db
    .select({
      id: kiaPaymentWindowRequests.id,
      bookingId: kiaPaymentWindowRequests.bookingId,
      allocationId: kiaPaymentWindowRequests.allocationId,
      vinNumber: kiaPaymentWindowRequests.vinNumber,
      requestedDays: kiaPaymentWindowRequests.requestedDays,
      baseHours: kiaPaymentWindowRequests.baseHours,
      reason: kiaPaymentWindowRequests.reason,
      status: kiaPaymentWindowRequests.status,
      approvedDays: kiaPaymentWindowRequests.approvedDays,
      requestedByName: kiaPaymentWindowRequests.requestedByName,
      actionByName: kiaPaymentWindowRequests.actionByName,
      actionRemarks: kiaPaymentWindowRequests.actionRemarks,
      actionAt: kiaPaymentWindowRequests.actionAt,
      appliedExpiresAt: kiaPaymentWindowRequests.appliedExpiresAt,
      createdAt: kiaPaymentWindowRequests.createdAt,
      bookingNumber: kiaBookings.bookingNumber,
      customerName: kiaBookings.customerName,
      model: kiaBookings.model,
      variant: kiaBookings.variant,
      color: kiaBookings.color,
      dealerCode: kiaBookings.dealerCode,
      consultantName: kiaBookings.consultantName,
      bookingStatus: kiaBookings.status,
      allocationStatus: kiaVehicleAllocations.allocationStatus,
      expiresAt: kiaVehicleAllocations.expiresAt,
      allocatedAt: kiaVehicleAllocations.allocatedAt,
      paymentConfirmedAt: kiaVehicleAllocations.paymentConfirmedAt,
      releasedAt: kiaVehicleAllocations.releasedAt,
    })
    .from(kiaPaymentWindowRequests)
    .leftJoin(kiaBookings, eq(kiaBookings.id, kiaPaymentWindowRequests.bookingId))
    .leftJoin(kiaVehicleAllocations, eq(kiaVehicleAllocations.id, kiaPaymentWindowRequests.allocationId))
    .where(filter ? eq(kiaPaymentWindowRequests.status, filter) : undefined)
    .orderBy(desc(kiaPaymentWindowRequests.createdAt))
    .limit(300)

  return rows as PaymentWindowRequestRow[]
}

/** Requests attached to one booking — for the requester's own view in the booking drawer. */
export async function listPaymentWindowRequestsForBooking(bookingId: string) {
  return db
    .select()
    .from(kiaPaymentWindowRequests)
    .where(eq(kiaPaymentWindowRequests.bookingId, bookingId))
    .orderBy(desc(kiaPaymentWindowRequests.createdAt))
    .limit(50)
}

export type CompetingBooking = {
  allocationId: string
  bookingId: string
  bookingNumber: string | null
  customerName: string | null
  model: string | null
  variant: string | null
  color: string | null
  dealerCode: string | null
  consultantName: string | null
  bookingStatus: string | null
  createdAt: Date
  isNewerThanAllocation: boolean
  sameDealer: boolean
}

/**
 * Other bookings that could take the same car — the real cost of granting an extension.
 *
 * The car's identity comes from the ALLOCATION's model/variant/color snapshot, taken at allot time,
 * not from kia_stock_management. So the answer cannot change because the DMS feed went stale or the
 * VIN left the feed entirely.
 *
 * Matching transliterates the TS matchers (assertKiaVehicleMatchesBooking / normalizeKiaModel in
 * lib/kia/bookings.ts, and getMatchingBookings in the stock dashboard) into SQL, so the MD sees the
 * same contender set the allot picker would have offered. Colour is part of the match because a
 * booking for a different colour physically cannot take this car.
 *
 * ⚠️ PII: this returns other customers' NAMES. The permission is MD-only by design. If
 * kia.payment_window_requests.view is ever granted below MD, apply redactKiaBookingPii here.
 *
 * ⚠️ Never call this from getKiaBookingDetail — that path is hover-prefetched per booking row
 * against a 4–6 connection pool.
 */
export async function findCompetingBookings(allocationIds: string[]): Promise<Map<string, CompetingBooking[]>> {
  const grouped = new Map<string, CompetingBooking[]>()
  if (!allocationIds.length) return grouped

  // Inlined as a literal list rather than a bound array: Drizzle expands a JS array into separate
  // placeholders ($1, $2, …), which makes `= ANY($1::uuid[])` invalid SQL. The strict UUID filter is
  // what makes inlining safe — anything that is not a canonical UUID never reaches the query.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const safeIds = allocationIds.filter((id) => UUID_RE.test(String(id)))
  if (!safeIds.length) return grouped
  const idList = sql.raw(safeIds.map((id) => `'${id}'`).join(', '))

  // Alphanumeric-only, strip a leading the-new/all-new/new and a trailing fuel suffix. MUST stay
  // identical to normalizeKiaModel in lib/kia/bookings.ts or the MD is shown a different contender
  // set than the picker offered.
  const modelKey = (col: string) => sql.raw(`regexp_replace(regexp_replace(regexp_replace(
    lower(coalesce(${col}, '')), '[^a-z0-9]', '', 'g'), '^(thenew|allnew|new)', ''), '(petrol|diesel|ev|hev|mhev)$', '')`)
  const plainKey = (col: string) => sql.raw(`regexp_replace(lower(coalesce(${col}, '')), '[^a-z0-9]', '', 'g')`)

  const rows = await db.execute(sql`
    WITH target AS (
      SELECT a.id AS allocation_id, a.booking_id, a.dealer_code, a.allocated_at,
             ${modelKey('a.model')} AS model_key,
             ${plainKey('a.variant')} AS variant_key,
             ${plainKey('a.color')} AS color_key
      FROM kia_vehicle_allocations a
      WHERE a.id IN (${idList})
    ),
    candidates AS (
      SELECT b.id, b.booking_number, b.customer_name, b.model, b.variant, b.dealer_code,
             b.consultant_name, b.status, b.created_at,
             coalesce(b.color, b.metadata->>'color') AS color,
             ${modelKey('b.model')} AS model_key,
             ${plainKey('b.variant')} AS variant_key,
             ${plainKey(`coalesce(b.color, b.metadata->>'color')`)} AS color_key
      FROM kia_bookings b
      WHERE b.deleted_at IS NULL
        -- These states cannot receive a vehicle, so they are not contenders. Mirrors the guard in
        -- allotKiaBookingVehicle, plus 'delivered'.
        AND b.status NOT IN ('draft', 'booking_created', 'cancelled', 'delivered')
        -- Already holds a car of its own.
        AND NOT EXISTS (
          SELECT 1 FROM kia_vehicle_allocations x
          WHERE x.booking_id = b.id AND x.released_at IS NULL
        )
    )
    SELECT t.allocation_id, c.id AS booking_id, c.booking_number, c.customer_name,
           c.model, c.variant, c.color, c.dealer_code, c.consultant_name,
           c.status AS booking_status, c.created_at,
           (c.created_at > t.allocated_at) AS is_newer_than_allocation,
           (upper(coalesce(c.dealer_code, '')) = upper(coalesce(t.dealer_code, ''))) AS same_dealer
    FROM target t
    JOIN candidates c
      ON c.id <> t.booking_id
     -- The <> '' guards are load-bearing: LIKE '%%' is always TRUE, so without them a booking with
     -- a blank variant would match every car. Mirrors the !bVar || !rVar early return in the TS
     -- matcher (getMatchingBookings / assertKiaVehicleMatchesBooking).
     AND t.model_key <> '' AND c.model_key <> ''
     AND (c.model_key = t.model_key OR c.model_key LIKE '%' || t.model_key || '%' OR t.model_key LIKE '%' || c.model_key || '%')
     AND t.variant_key <> '' AND c.variant_key <> ''
     AND (c.variant_key = t.variant_key OR c.variant_key LIKE '%' || t.variant_key || '%' OR t.variant_key LIKE '%' || c.variant_key || '%')
     AND t.color_key <> '' AND c.color_key <> ''
     AND (c.color_key = t.color_key OR c.color_key LIKE '%' || t.color_key || '%' OR t.color_key LIKE '%' || c.color_key || '%')
    ORDER BY t.allocation_id, same_dealer DESC, c.created_at DESC
  `)

  for (const raw of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
    const key = String(raw.allocation_id)
    const list = grouped.get(key) || []
    list.push({
      allocationId: key,
      bookingId: String(raw.booking_id),
      bookingNumber: raw.booking_number as string | null,
      customerName: raw.customer_name as string | null,
      model: raw.model as string | null,
      variant: raw.variant as string | null,
      color: raw.color as string | null,
      dealerCode: raw.dealer_code as string | null,
      consultantName: raw.consultant_name as string | null,
      bookingStatus: raw.booking_status as string | null,
      createdAt: new Date(String(raw.created_at)),
      isNewerThanAllocation: Boolean(raw.is_newer_than_allocation),
      sameDealer: Boolean(raw.same_dealer),
    })
    grouped.set(key, list)
  }
  return grouped
}

export type ActOnPaymentWindowResult =
  | { ok: false; conflict: PaymentWindowConflict; message: string }
  | {
      ok: true
      request: typeof kiaPaymentWindowRequests.$inferSelect
      appliedExpiresAt: Date | null
      floored: boolean
      startsOnArrival: boolean
      /** Email context, gathered inside the transaction so the caller needs no second read. */
      notify: {
        requesterEmail: string | null
        requesterName: string
        bookingNumber: string | null
        customerName: string | null
        vinNumber: string
      }
    }

/**
 * Approve or reject. Transactional: the guard, the allocation write and the activity entry either
 * all land or none do.
 */
export async function actOnPaymentWindowRequest(
  requestId: string,
  appUser: AppUser,
  input: { action: 'APPROVE' | 'REJECT'; approvedDays?: number; remarks?: string },
): Promise<ActOnPaymentWindowResult> {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(kiaPaymentWindowRequests)
      .where(eq(kiaPaymentWindowRequests.id, requestId)).limit(1)
    if (!request) throw new Error('Request not found.')

    if (request.status !== 'PENDING') {
      return { ok: false as const, conflict: 'ALREADY_ACTIONED' as const, message: PAYMENT_WINDOW_CONFLICT_MESSAGES.ALREADY_ACTIONED }
    }

    const [allocation] = await tx.select().from(kiaVehicleAllocations)
      .where(eq(kiaVehicleAllocations.id, request.allocationId)).limit(1)
    if (!allocation) throw new Error('The allocation for this request no longer exists.')

    const [booking] = await tx.select().from(kiaBookings)
      .where(eq(kiaBookings.id, request.bookingId)).limit(1)
    if (!booking) throw new Error('The booking for this request no longer exists.')

    const [requester] = await tx.select({ email: users.email }).from(users)
      .where(eq(users.id, request.requestedBy)).limit(1)

    const notify = {
      requesterEmail: requester?.email ?? null,
      requesterName: request.requestedByName,
      bookingNumber: booking.bookingNumber ?? null,
      customerName: booking.customerName ?? null,
      vinNumber: request.vinNumber,
    }

    const now = new Date()
    const remarks = (input.remarks || '').trim() || null

    if (input.action === 'REJECT') {
      const [updated] = await tx.update(kiaPaymentWindowRequests).set({
        status: 'REJECTED',
        actionBy: appUser.id,
        actionByName: appUser.fullName,
        actionRemarks: remarks,
        actionAt: now,
        updatedAt: now,
      }).where(and(
        eq(kiaPaymentWindowRequests.id, requestId),
        eq(kiaPaymentWindowRequests.status, 'PENDING'),
      )).returning()

      // The status guard in the WHERE (not just the read above) makes a concurrent double-decision
      // lose cleanly instead of overwriting the first one.
      if (!updated) {
        return { ok: false as const, conflict: 'ALREADY_ACTIONED' as const, message: PAYMENT_WINDOW_CONFLICT_MESSAGES.ALREADY_ACTIONED }
      }

      await addActivity(tx, {
        bookingId: request.bookingId,
        type: 'extra_time_rejected',
        title: 'Extra payment time rejected',
        description: `${request.requestedDays} day request rejected — the standard window stands.${remarks ? ` Remarks: ${remarks}` : ''}`,
        before: { status: 'PENDING', requestedDays: request.requestedDays },
        after: { status: 'REJECTED' },
        appUser,
      })

      return { ok: true as const, request: updated, appliedExpiresAt: null, floored: false, startsOnArrival: false, notify }
    }

    const approvedDays = input.approvedDays ?? request.requestedDays
    if (!isValidExtensionDays(approvedDays)) {
      throw new Error(`Approved days must be a whole number between ${MIN_EXTENSION_DAYS} and ${MAX_EXTENSION_DAYS}.`)
    }

    const outcome = resolvePaymentWindowExtension({
      allocation: {
        allocationStatus: allocation.allocationStatus,
        expiresAt: allocation.expiresAt,
        releasedAt: allocation.releasedAt,
        paymentConfirmedAt: allocation.paymentConfirmedAt,
      },
      booking: { status: booking.status, deletedAt: booking.deletedAt },
      approvedDays,
      now,
    })

    if (!outcome.ok) {
      return { ok: false as const, conflict: outcome.conflict, message: PAYMENT_WINDOW_CONFLICT_MESSAGES[outcome.conflict] }
    }

    await tx.update(kiaVehicleAllocations).set({
      // For an in-transit allocation expiresAt stays NULL on purpose — the arrival sweep opens it
      // using paymentWindowHours below.
      ...(outcome.expiresAt ? { expiresAt: outcome.expiresAt } : {}),
      paymentWindowHours: outcome.paymentWindowHours,
      updatedAt: now,
    }).where(eq(kiaVehicleAllocations.id, allocation.id))

    const [updated] = await tx.update(kiaPaymentWindowRequests).set({
      status: 'APPROVED',
      approvedDays,
      actionBy: appUser.id,
      actionByName: appUser.fullName,
      actionRemarks: remarks,
      actionAt: now,
      appliedExpiresAt: outcome.expiresAt,
      updatedAt: now,
    }).where(and(
      eq(kiaPaymentWindowRequests.id, requestId),
      eq(kiaPaymentWindowRequests.status, 'PENDING'),
    )).returning()

    if (!updated) {
      return { ok: false as const, conflict: 'ALREADY_ACTIONED' as const, message: PAYMENT_WINDOW_CONFLICT_MESSAGES.ALREADY_ACTIONED }
    }

    await addActivity(tx, {
      bookingId: request.bookingId,
      type: 'extra_time_approved',
      title: `Extra payment time approved — ${approvedDays} day${approvedDays === 1 ? '' : 's'}`,
      description: outcome.startsOnArrival
        ? `Window extended to ${approvedDays} days; it starts when the vehicle reaches Free Stock.${remarks ? ` Remarks: ${remarks}` : ''}`
        : `Payment window now ends ${outcome.expiresAt?.toISOString()}.${outcome.floored ? ' The existing deadline was later, so it was kept.' : ''}${remarks ? ` Remarks: ${remarks}` : ''}`,
      before: { expiresAt: allocation.expiresAt, paymentWindowHours: allocation.paymentWindowHours },
      after: { expiresAt: outcome.expiresAt, paymentWindowHours: outcome.paymentWindowHours },
      appUser,
    })

    return {
      ok: true as const,
      request: updated,
      appliedExpiresAt: outcome.expiresAt,
      floored: outcome.floored,
      startsOnArrival: outcome.startsOnArrival,
      notify,
    }
  })
}

/** Pending count for the tab badge. */
export async function countPendingPaymentWindowRequests() {
  const rows = await db.select({ id: kiaPaymentWindowRequests.id })
    .from(kiaPaymentWindowRequests)
    .where(and(eq(kiaPaymentWindowRequests.status, 'PENDING'), isNull(kiaPaymentWindowRequests.actionAt)))
  return rows.length
}
