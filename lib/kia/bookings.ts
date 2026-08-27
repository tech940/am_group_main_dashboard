import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analyticsDb } from '@/lib/analytics/db'
import {
  financeOrderWorkflow,
  financeOrders,
  kiaBookingActivity,
  kiaBookings,
  kiaBookingDiscounts,
  kiaPaymentWindowRequests,
  kiaFinancePayouts,
  kiaLeadFollowups,
  kiaProformas,
  kiaStockLocalStatuses,
  kiaVehicleAllocations,
  kiaBookingPayments,
  kiaVehicleTransfers,
  kiaPriceDetails,
  users,
  kiaUserProfiles,
} from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { normalizeBankName } from '@/lib/kia/bank-utils'
import { canViewKiaCustomerPii, redactKiaBookingPii, stripKiaBookingPiiKeys } from '@/lib/kia/pii'
import { cancelKiaBookingFollowups } from '@/lib/kia/lead-followups'
import { canAllotKiaVehicle,
  canConfirmKiaPayment,
  canDeliverKiaBooking,
  canTransferKiaVehicle,
  canAllotKiaVehicleToBooking,
  canVerifyKiaAccounts,
  canViewAllKiaBookings, KIA_PAYMENT_SECURED_THRESHOLD } from '@/lib/kia/workflow-access'
export { KIA_PAYMENT_SECURED_THRESHOLD }

type JsonRecord = Record<string, unknown>
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
// Exported so lib/kia/payment-window-requests.ts can compute the same policy default instead of
// re-hardcoding 72/120 a fourth time (it already appears here, in the arrival-sweep SQL below, and
// in lib/finance/finance-processing.ts for the separate finance SLA clock).
/*
 * The reservation window after a vehicle is allotted, before the expiry sweep returns it to free
 * stock. Raised from 72h/120h to 120h/168h on the MD's instruction (2026-08-27).
 *
 * ⚠️ Changing these affects NEW allotments only: expires_at and payment_window_hours are STAMPED
 * on the allocation row at allot time, and the sweep releases on the stored expires_at. Cars
 * already on a clock keep the deadline they were allotted under.
 */
export const TEMPORARY_ALLOCATION_HOURS = 120 // 5 days
export const CSD_ALLOCATION_HOURS = 168 // CSD customers get a 7-day payment window


/**
 * DMS stock_status literals from kia_stock_management, lower-cased.
 *
 * The raw feed writes "In transit" (lower-case 't') and "Free Stock" — ALWAYS compare
 * lower(trim(...)); a case-sensitive match on "In Transit" silently never fires. The feed also
 * carries 'allocated', 'invoice' and 'from other dealer', none of which are allottable — the
 * matching list only admits the two below.
 */
const DMS_IN_TRANSIT = 'in transit'
const DMS_FREE_STOCK = 'free stock'

function dmsStockStatus(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Normalises a person's name for matching. Strips case, spacing AND punctuation, because staff names
 * are typed by hand and vary in all three: the same person has appeared as "gulshankumar" and
 * "GULSHAN KUMAR", "akashbhat" and "Akash Bhat". Lower-casing alone is NOT enough — those pairs
 * differ by a space, not a capital.
 */
export function personNameKey(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Resolves a typed consultant name to exactly one active user, or null.
 *
 * Returns null when the name matches NOTHING or matches MORE THAN ONE user — never a guess. This
 * decides who can see a booking, so an ambiguous match must not silently hand a customer to the
 * wrong salesperson.
 */
async function resolveUserByPersonName(tx: DbTx, name: string) {
  const key = personNameKey(name)
  if (!key) return null
  const matches = await tx.select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(and(
      sql`regexp_replace(lower(${users.fullName}), '[^a-z0-9]', '', 'g') = ${key}`,
      eq(users.isActive, true),
      isNull(users.deletedAt),
    ))
    .limit(2)
  return matches.length === 1 ? matches[0] : null
}

// The temporary-allocation payment window depends on the customer type captured
// on the booking form: CSD → 7 days, everyone else → 5 days.
export function allocationHoursForBooking(booking: { metadata?: unknown } | null | undefined): number {
  const meta = (booking?.metadata || {}) as Record<string, unknown>
  const type = String(meta.customerType || '').trim().toLowerCase()
  return type === 'csd' ? CSD_ALLOCATION_HOURS : TEMPORARY_ALLOCATION_HOURS
}

export const KIA_BOOKING_STATUSES = [
  'draft',
  'booking_created',
  'proforma_generated',
  'on_hold',
  // The allotted vehicle is still In transit in the DMS feed. The payment countdown has NOT started;
  // it starts when the feed flips the VIN to Free Stock (startKiaArrivedAllocationCountdowns).
  // Distinct from 'transfer_requested', which is an inter-DEALER stock movement.
  'transferring',
  'vehicle_allocated',
  'transfer_requested',
  'finance_pending',
  'payment_confirmed',
  'ready_delivery',
  'delivered',
  'cancelled',
] as const

export type KiaBookingStatus = typeof KIA_BOOKING_STATUSES[number]

export type BookingListInput = {
  search?: string | null
  dealerCode?: string | null
  model?: string | null
  status?: string | null
  consultant?: string | null
  startDate?: string | null
  endDate?: string | null
  page?: number | null
  pageSize?: number | null
  /** 'asc' = oldest first (createdAt ASC); anything else = newest first (default). */
  sortOrder?: string | null
  // The requesting user — used to scope Sales Executives to their own bookings.
  viewer?: {
    id?: string | null
    email?: string | null
    role?: string | null
    fullName?: string | null
    consultantName?: string | null
  } | null
  // Dealer/branch codes the user is restricted to (null/empty = all branches). A hard boundary
  // applied to the list, KPIs, and filter options — set from the user's dealer scope server-side.
  allowedDealers?: string[] | null
  unallocated?: string | boolean | null
}

export type CreateBookingInput = {
  customerName?: string
  customerPhone?: string
  dealerCode?: string
  model?: string
  variant?: string
  consultantName?: string
  customerEmail?: string | null
  customerAddress?: string | null
  color?: string | null
  fuelType?: string | null
  source?: string | null
  financeRequired?: boolean
  bankName?: string | null
  loanAmount?: string | number | null
  notes?: string | null
  deliveryTargetDate?: string | null
  metadata?: Record<string, unknown> | null
  requestDiscount?: boolean
  discountRequestedAmount?: string | number | null
  discountReason?: string | null
}

export type UpdateBookingInput = Partial<CreateBookingInput> & {
  status?: string | null
  deliveryTargetDate?: string | null
  delivered?: boolean
  idtRemark?: string | null
}

function rows<T extends JsonRecord = JsonRecord>(result: unknown): T[] {
  return Array.isArray(result) ? result as T[] : []
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function nullableText(value: unknown) {
  const normalized = text(value)
  return normalized || null
}

/**
 * KPI-card filters that look like a status but are NOT one — they select a COHORT, and each is
 * handled by its own branch in the filter builder.
 *
 * ⚠️ They must be excluded from the literal `status = ?` branch, because normalizeStatus() falls back
 * to 'booking_created' for anything it does not recognise. Without this, `status=today` quietly
 * became "created today AND status = booking_created": the Booked Today card counted 2 and the list
 * showed 1, because the second booking had already moved to vehicle_allocated. The card and the list
 * disagreeing is the visible symptom; the silent fallback is the cause.
 */
/*
 * ── IST DAY BOUNDARIES ────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ Every date filter in this module used to be written
 *     (<date> AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'
 * which runs the conversion BACKWARDS and puts the boundary 11 hours late.
 *
 * Postgres has two AT TIME ZONE overloads and `date` casts implicitly to BOTH timestamp and
 * timestamptz, so it picks the timestamptz one. Measured:
 *     pg_typeof('2026-08-01'::date AT TIME ZONE 'Asia/Kolkata') = timestamp WITHOUT time zone
 *     ('2026-08-01'::date AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' -> 2026-08-01 05:30+00
 *     correct IST midnight                                                -> 2026-07-31 18:30+00
 * That is not "IST midnight as an instant", it is "this instant read as an IST wall clock".
 *
 * The live symptom: the "Booked Today" card rendered 0 while two bookings existed today (10:29 and
 * 10:34 IST) — the boundary had not been crossed yet at 12:32 IST.
 *
 * Casting to `timestamp` FIRST removes the ambiguity: there is only one overload for timestamp, and
 * it means what we want. created_at is already timestamptz, so no trailing AT TIME ZONE is needed.
 */
const istDayStart = (ymd: string) => sql`((${ymd} || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata')`
/** Exclusive upper bound: the START of the day AFTER `ymd`, so the whole end day is included. */
/*
 * ⚠️ `date + 1`, NOT `date + INTERVAL '1 day'`. Adding an interval promotes the result to a
 * TIMESTAMP, so ::text already carries a time and appending ' 00:00:00' produced
 * "2026-09-01 00:00:00 00:00:00" — a 22007 that aborted the whole query. Adding an integer to a
 * date stays a date.
 */
const istDayEnd = (ymd: string) => sql`(((${ymd}::date + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata')`
/** Midnight IST of the current Indian day, as an instant. */
const istTodayStart = () => sql`((to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata')`

/**
 * DMS stock statuses a vehicle can be allotted from.
 *
 * 'from other dealer' is included: those cars carry the RECEIVING outlet in order_dealer and were
 * measured to have zero commitments (no allocation, transfer, hold, local retail or delivery), yet
 * the Stock tab already labels them Available. Leaving them out of this list is what made 9
 * bookings read "Not in stock" against cars the Stock tab was showing as available on the next tab.
 *
 * ⚠️ 'allocated' is deliberately NOT here. In this feed it means sold in the DMS by someone outside
 * this dashboard — 10 rows, all carrying a DMS cust_name and booking_no, and 9 of the 10 match no
 * booking in this system at all. Folding those into availability would offer other people's sold
 * cars to new customers.
 */
const KIA_ALLOTTABLE_STOCK_STATUSES = ['free stock', 'in transit', 'from other dealer'] as const

/**
 * THE booking-to-stock match. One definition, six call sites.
 *
 * ⚠️ This predicate previously existed as FIVE hand-copied variants in three different strengths,
 * and they disagreed with each other and with the Allot picker:
 *   - four copies ignored COLOUR entirely and treated a blank stock variant as a wildcard, so a
 *     booking for a WHITE Sonet counted as "in stock" against a RED one — 31 of 121 in-flight
 *     bookings were wrongly shown as in-stock;
 *   - a fifth (the in_stock tab filter) already checked colour, so the KPI card and the tab it
 *     opens returned different sets — the card said 65, the tab listed 34;
 *   - none of them modelled the picker's allocation rule, so tightening only model/variant/colour
 *     would have swapped 20 wrong greens for 12 wrong reds instead of fixing the disagreement.
 *
 * Match is STRICT on all three attributes and requires both sides to be populated. Measured cost of
 * the strictness: zero — 0 of 159 bookings and 0 of 72 allottable stock rows have a blank variant or
 * colour, so the old wildcard branch was dead code.
 *
 * Bidirectional ILIKE on each attribute because the booking side may carry an extra token
 * ('SONET PETROL' vs 'SONET'). Measured: 0 non-identical colour pairs match, so the bidirectional
 * colour test creates no false positives.
 *
 * @param model   SQL expression for the booking's model, e.g. 'kb.model'
 * @param variant SQL expression for the booking's variant
 * @param color   SQL expression for the booking's colour
 */
const kiaMatchingStockExists = (model: string, variant: string, color: string) => sql`
  EXISTS (
    SELECT 1 FROM kia_stock_management sm
    LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
    WHERE lower(trim(coalesce(sm.stock_status::text, ''))) IN ${sql`(${sql.join(
      KIA_ALLOTTABLE_STOCK_STATUSES.map((v) => sql`${v}`), sql`, `)})`}
      AND coalesce(ls.local_status, '') NOT IN ('retail', 'hold_customer', 'hold_dealer')
      AND (sm.model ILIKE '%' || ${sql.raw(model)} || '%' OR ${sql.raw(model)} ILIKE '%' || sm.model || '%')
      AND coalesce(sm.variant, '') <> ''
      AND coalesce(${sql.raw(variant)}, '') <> ''
      AND (sm.variant ILIKE '%' || ${sql.raw(variant)} || '%' OR ${sql.raw(variant)} ILIKE '%' || sm.variant || '%')
      AND coalesce(sm.exterior_color_name, '') <> ''
      AND coalesce(${sql.raw(color)}, '') <> ''
      AND (sm.exterior_color_name ILIKE '%' || ${sql.raw(color)} || '%'
           OR ${sql.raw(color)} ILIKE '%' || sm.exterior_color_name || '%')
      /*
       * The SAME allocation rule the Allot picker uses (getKiaBookingMatchingVehicles). A lapsed
       * unpaid hold is still offerable there, so a bare "released_at IS NULL" here would mark a
       * booking "not in stock" against a car the picker would happily offer.
       */
      AND NOT EXISTS (
        SELECT 1 FROM kia_vehicle_allocations aa
        WHERE aa.vin_number = sm.vin_number
          AND aa.released_at IS NULL
          AND (aa.payment_confirmed_at IS NOT NULL OR aa.expires_at IS NULL OR aa.expires_at > now())
      )
      -- ...and not a car we have already handed over; the allocation is released at handover, so
      -- nothing above can see it.
      AND NOT ${sql.raw(kiaDeliveredByUsSql('sm'))}
  )`

/** A booking's colour, with the same column-then-metadata precedence every SQL site uses. */
const bookingColorOf = (b: { color?: unknown; metadata?: unknown }) =>
  text(b.color) || text((b.metadata as Record<string, unknown> | null | undefined)?.color)

const PSEUDO_STATUS_FILTERS = new Set(['today', 'not_in_stock', 'in_stock', 'md_remarks'])

function normalizeStatus(value: unknown): KiaBookingStatus {
  const normalized = text(value).toLowerCase()
  return KIA_BOOKING_STATUSES.includes(normalized as KiaBookingStatus) ? normalized as KiaBookingStatus : 'booking_created'
}

function numericText(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0'
}

function pageParams(input: BookingListInput) {
  const page = Math.max(1, Math.floor(Number(input.page || 1)))
  const pageSize = Math.min(100, Math.max(5, Math.floor(Number(input.pageSize || 15))))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function actor(appUser: AppUser) {
  return {
    actorUserId: appUser.id,
    actorName: appUser.fullName,
    actorRole: appUser.role,
  }
}

// Exported so sibling KIA modules can write booking activity through the same helper. Before this,
// routes outside this file hand-rolled `db.insert(kiaBookingActivity)` (see the discount routes),
// which is how the actor fields and the before/after shape drifted between call sites.
export async function addActivity(tx: DbTx, params: {
  bookingId: string
  type: string
  title: string
  description?: string | null
  before?: JsonRecord | null
  after?: JsonRecord | null
  appUser: AppUser
}) {
  await tx.insert(kiaBookingActivity).values({
    bookingId: params.bookingId,
    activityType: params.type,
    title: params.title,
    description: params.description || null,
    beforeValue: params.before || null,
    afterValue: params.after || null,
    ...actor(params.appUser),
  })
}

async function nextBookingNumber(tx: DbTx, dealerCode: string) {
  const result = await tx.execute(sql<{ seq: string }>`SELECT nextval('public.kia_booking_number_seq')::text AS seq`)
  const rawSeq = parseInt(text(rows<{ seq: string }>(result)[0]?.seq || '0'), 10)
  const seq = String(rawSeq + 120000).padStart(6, '0')
  const cleanDealer = String(dealerCode || 'JK402').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `KIA_${cleanDealer}_${new Date().getFullYear()}_${seq}`
}

/**
 * SQL: has THIS dealership already handed this VIN over?
 *
 * ⚠️ Every other availability signal can miss a delivered car, and all of them did:
 *   - the allocation is RELEASED at handover, so `va.id IS NULL` reads as free
 *   - the DMS feed can still say 'Free Stock' for days afterwards
 *   - `kia_stock_local_statuses.local_status = 'retail'` is only written on the
 *     confirm-payment path, so cars delivered any other way never get it
 *   - `kia_sales_report.delivery_date` only lands once the DMS exports the retail
 *
 * Measured 2026-08-26: 7 cars sat in the Available list and count having ALREADY been delivered to
 * named customers, and readMatchingVehicle would have let a second customer be allotted one.
 *
 * OUR OWN booking status is the only signal that knows immediately, which is why this exists.
 * Returns a bare SQL string so the raw-SQL stock route and the drizzle readers can share one rule.
 */
export function kiaDeliveredByUsSql(alias = 'sm') {
  return `EXISTS (
    SELECT 1
    FROM kia_vehicle_allocations dlv_va
    JOIN kia_bookings dlv_kb
      ON dlv_kb.id = dlv_va.booking_id
     AND dlv_kb.deleted_at IS NULL
     AND dlv_kb.status = 'delivered'
    WHERE UPPER(TRIM(dlv_va.vin_number)) = UPPER(TRIM(${alias}.vin_number))
  )`
}

export async function expireKiaTemporaryAllocations() {
  await db.transaction(async (tx) => {
    // When the 5-day/7-day reservation window lapses with no payment, the vehicle RETURNS TO AVAILABLE
    // STOCK — released_at is stamped, so both availability rules (the matching-list CTE in
    // getKiaBookingMatchingVehicles and the LEFT JOIN in readMatchingVehicle) stop counting the VIN
    // as taken and another booking can have it.
    //
    // The row itself is kept and flagged 'no_payment' (#13 No-payment persistence), so the booking
    // history and the retained vehicleSnapshot still show which vehicle lapsed and why — releasing
    // frees the VIN without erasing the record.
    //
    // Setting released_at also fixes a live disagreement: previously it stayed NULL, which left the
    // VIN visible in the matching list (the CTE's `expires_at > now()` no longer held) while
    // readMatchingVehicle still rejected it as allocated — so the vehicle was offered and then
    // refused with "Vehicle is not available for allocation".
    //
    // Only 'temporary' rows are swept: a 'transferring' allocation has expires_at NULL (its clock
    // hasn't started) and is skipped by the `expires_at IS NOT NULL` predicate anyway.
    //
    // ⚠️ payment_secured_at IS NULL is the WHOLE of the MD's "without putting the vehicle back to
    // free stock" rule. This sweep is the only AUTOMATIC writer of released_at (the other two,
    // releaseKiaBookingVehicle and the transfer release, are human-initiated), so this single
    // predicate is what protects a substantially-paid car. Deleting it silently re-arms the release
    // for every secured vehicle, and nothing else in the codebase would notice.
    await tx.execute(sql`
      WITH expired AS (
        UPDATE kia_vehicle_allocations
        SET
          allocation_status = 'no_payment',
          stock_status = 'no_payment',
          released_at = now(),
          release_reason = 'No payment received within the reservation window',
          updated_at = now()
        WHERE released_at IS NULL
          AND payment_confirmed_at IS NULL
          AND payment_secured_at IS NULL
          AND allocation_status = 'temporary'
          AND expires_at IS NOT NULL
          AND expires_at <= now()
          /*
           * ⚠️ A DELIVERED car must never be un-delivered by a cron.
           *
           * The updated_bookings CTE below rewrites the booking to 'proforma_generated' and this
           * sweep returns the VIN to free stock. Nothing stopped that happening to a booking that
           * was already delivered: the reservation is normally released at handover, but a delivery
           * recorded while the allocation is still 'temporary' leaves the clock running, and the
           * next cron tick then reverts the handover and re-offers a car that is with its owner.
           *
           * Found live on 2026-08-27: KIA_JK402_2026_120099 (LAL CHAND YADAV), delivered 2026-08-26,
           * carried a temporary allocation expiring 2026-08-29 — two days from being silently
           * un-delivered. 'cancelled' is included for the same reason: a cancelled booking has no
           * handover to undo, and rewriting it to 'proforma_generated' would resurrect it.
           */
          AND NOT EXISTS (
            SELECT 1 FROM kia_bookings kb
            WHERE kb.id = kia_vehicle_allocations.booking_id
              AND kb.status IN ('delivered', 'cancelled')
          )
        RETURNING booking_id, vin_number
      ),
      updated_bookings AS (
        UPDATE kia_bookings kb
        SET
          status = 'proforma_generated',
          updated_at = now()
        FROM expired e
        WHERE kb.id = e.booking_id
          AND kb.status NOT IN ('delivered', 'cancelled')
        RETURNING kb.id, e.vin_number
      )
      INSERT INTO kia_booking_activity (
        booking_id,
        activity_type,
        title,
        description,
        actor_name,
        actor_role,
        after_value
      )
      SELECT
        id,
        'no_payment',
        'No payment received — vehicle returned to stock',
        'VIN ' || vin_number || ' — no payment received within the reservation window; the allocation was cancelled and the vehicle returned to available stock',
        'System',
        'system',
        jsonb_build_object('vinNumber', vin_number, 'reason', 'payment window expired', 'status', 'no_payment', 'released', true)
      FROM updated_bookings
    `)
  })
}

/**
 * Starts the payment countdown for allocations whose in-transit vehicle has ARRIVED.
 *
 * Scheduled sweep (POST /api/brands/kia/maintenance). Allotting an In-transit vehicle parks the
 * allocation as 'transferring' with expires_at NULL — no clock. This is the other half: when the DMS
 * feed flips that VIN to Free Stock, the 5-day (7-day CSD) window opens and the booking moves on to
 * 'vehicle_allocated'.
 *
 * This is what "continuously monitor the vehicle status" resolves to. It cannot be event-driven —
 * kia_stock_management is an external DMS feed this app never writes, so arrival is only observable
 * by re-reading it. Runs hourly with the other sweeps; the KIA stock feed refreshes roughly daily,
 * so hourly is far finer-grained than the data it watches.
 *
 * The CSD window is derived in SQL from the same booking metadata as allocationHoursForBooking().
 * Idempotent: once expires_at is set the row no longer matches.
 */
export async function startKiaArrivedAllocationCountdowns() {
  // Freshness gate, same rationale as markKiaSoldAllocations: never act on an empty/partial feed.
  const stockCountRes = await db.execute<{ stock_count: number }>(sql`SELECT count(*)::int AS stock_count FROM kia_stock_management`)
  const stockCount = Number((stockCountRes as unknown as Array<{ stock_count: number }>)[0]?.stock_count || 0)
  if (stockCount === 0) return 0

  const started = await db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      WITH arrived AS (
        SELECT
          va.id,
          va.booking_id,
          va.vin_number,
          -- ::int is REQUIRED. Bound params arrive untyped and Postgres infers text, so
          -- make_interval(hours => …) below fails with "function make_interval(hours => text)
          -- does not exist".
          --
          -- payment_window_hours comes FIRST so an MD-approved extension is honoured for a car that
          -- was still in transit when it was granted. Without this COALESCE the approval was
          -- silently discarded the moment the clock opened here. NULL (every row predating
          -- migration 0035) falls through to the policy default, so old rows behave as before.
          COALESCE(
            va.payment_window_hours,
            CASE
              WHEN lower(trim(coalesce(kb.metadata->>'customerType', ''))) = 'csd'
              THEN ${CSD_ALLOCATION_HOURS}::int
              ELSE ${TEMPORARY_ALLOCATION_HOURS}::int
            END
          )::int AS window_hours
        FROM kia_vehicle_allocations va
        JOIN kia_bookings kb ON kb.id = va.booking_id
        WHERE va.allocation_status = 'transferring'
          AND va.expires_at IS NULL
          AND va.released_at IS NULL
          AND va.payment_confirmed_at IS NULL
          -- ⚠️ A secured car must arrive WITHOUT a countdown. It still needs its booking moved into
          -- the Accounts stage though, which is what securedArrivals below does — so this predicate
          -- excludes it from the clock-opening path only, not from arrival handling altogether.
          AND va.payment_secured_at IS NULL
          AND kb.deleted_at IS NULL
          AND kb.status NOT IN ('delivered', 'cancelled')
          AND EXISTS (
            SELECT 1 FROM kia_stock_management sm
            WHERE upper(trim(sm.vin_number)) = upper(trim(va.vin_number))
              AND lower(trim(coalesce(sm.stock_status::text, ''))) = ${DMS_FREE_STOCK}
          )
      ),
      opened AS (
        UPDATE kia_vehicle_allocations va
        SET
          allocation_status = 'temporary',
          expires_at = now() + make_interval(hours => a.window_hours),
          stock_last_seen_at = now(),
          updated_at = now()
        FROM arrived a
        WHERE va.id = a.id
        RETURNING va.booking_id, va.vin_number, va.expires_at, a.window_hours
      ),
      moved_bookings AS (
        UPDATE kia_bookings kb
        SET status = 'vehicle_allocated', updated_at = now()
        FROM opened o
        WHERE kb.id = o.booking_id
          AND kb.status = 'transferring'
        RETURNING kb.id, o.vin_number, o.expires_at, o.window_hours
      )
      INSERT INTO kia_booking_activity (
        booking_id, activity_type, title, description, actor_name, actor_role, after_value
      )
      SELECT
        id,
        'allocation',
        'Vehicle arrived — payment window started',
        'VIN ' || vin_number || ' reached Free Stock; ' || window_hours::text
          || 'h payment window started, due ' || to_char(expires_at, 'DD Mon YYYY HH24:MI'),
        'System',
        'system',
        jsonb_build_object('vinNumber', vin_number, 'expiresAt', expires_at, 'windowHours', window_hours)
      FROM moved_bookings
      RETURNING booking_id
    `)

    /*
     * SECURED arrivals — the same event, without a clock.
     *
     * A car can be paid for (over the threshold) while it is still on a truck. The query above
     * deliberately skips those rows, but they still have to LEAVE the in-transit state when they
     * land, or the booking sits in 'transferring' forever and never appears in the Accounts stage.
     *
     * So this is the identical arrival handling minus the one thing that must not happen: no
     * expires_at is set. Kept as a second statement rather than more CTEs on an already-large query,
     * because the difference between the two paths is exactly one assignment and that should be
     * readable at a glance.
     */
    const securedRes = await tx.execute(sql`
      WITH secured_arrivals AS (
        SELECT va.id, va.booking_id, va.vin_number
        FROM kia_vehicle_allocations va
        JOIN kia_bookings kb ON kb.id = va.booking_id
        WHERE va.allocation_status = 'transferring'
          AND va.expires_at IS NULL
          AND va.released_at IS NULL
          AND va.payment_confirmed_at IS NULL
          AND va.payment_secured_at IS NOT NULL
          AND kb.deleted_at IS NULL
          AND kb.status NOT IN ('delivered', 'cancelled')
          AND EXISTS (
            SELECT 1 FROM kia_stock_management sm
            WHERE upper(trim(sm.vin_number)) = upper(trim(va.vin_number))
              AND lower(trim(coalesce(sm.stock_status::text, ''))) = ${DMS_FREE_STOCK}
          )
      ),
      opened AS (
        UPDATE kia_vehicle_allocations va
        SET
          allocation_status = 'temporary',
          -- expires_at stays NULL: this vehicle is secured and must never be auto-released.
          stock_last_seen_at = now(),
          updated_at = now()
        FROM secured_arrivals a
        WHERE va.id = a.id
        RETURNING va.booking_id, va.vin_number
      ),
      moved_bookings AS (
        UPDATE kia_bookings kb
        SET status = 'vehicle_allocated', updated_at = now()
        FROM opened o
        WHERE kb.id = o.booking_id
          AND kb.status = 'transferring'
        RETURNING kb.id, o.vin_number
      )
      INSERT INTO kia_booking_activity (
        booking_id, activity_type, title, description, actor_name, actor_role, after_value
      )
      SELECT
        id,
        'allocation',
        'Vehicle arrived — payment already secured',
        'VIN ' || vin_number || ' reached Free Stock. No payment countdown was started because the '
          || 'customer has already paid more than the secured threshold; it waits for Accounts to '
          || 'confirm the balance.',
        'System',
        'system',
        jsonb_build_object('vinNumber', vin_number, 'secured', true, 'expiresAt', null)
      FROM moved_bookings
      RETURNING booking_id
    `)

    return (res as unknown as Array<unknown>).length + (securedRes as unknown as Array<unknown>).length
  })

  return started
}

/** A vehicle whose allotted VIN has vanished from the DMS stock feed (i.e. likely sold elsewhere). */
export type KiaSoldVehicle = {
  id: string // allocation id
  bookingId: string
  vinNumber: string
  bookingNumber: string
  customerName: string
  model: string
  dealerCode: string | null
  createdBy: string | null
}

// Detects allotted vehicles whose VIN has DISAPPEARED from the DMS stock feed (kia_stock_management)
// and flags them 'sold'. Retention itself is already handled by the allocation row's vehicleSnapshot;
// this adds the per-allocation "sold" status + a booking-activity timeline row. Idempotent (the
// stock_missing_at guard). Returns the rows that transitioned to 'sold'.
export async function markKiaSoldAllocations(): Promise<KiaSoldVehicle[]> {
  // 1. Refresh "last seen in stock" for active allocations whose VIN is currently present. A VIN
  //    must have been seen at least once before it can be marked missing (guards against allocations
  //    whose VIN never appears in this feed, and against the very first sweep).
  await db.execute(sql`
    UPDATE kia_vehicle_allocations va
    SET stock_last_seen_at = now(), updated_at = now()
    WHERE va.released_at IS NULL
      AND EXISTS (
        SELECT 1 FROM kia_stock_management sm
        WHERE upper(trim(sm.vin_number)) = upper(trim(va.vin_number))
      )
  `)

  // Freshness gate: never mass-flag when the DMS table is empty (a failed / partial load).
  const stockCountRes = await db.execute<{ stock_count: number }>(sql`SELECT count(*)::int AS stock_count FROM kia_stock_management`)
  const stockCount = Number((stockCountRes as unknown as Array<{ stock_count: number }>)[0]?.stock_count || 0)
  if (stockCount === 0) return []

  // 2. Flag active, non-delivered allocations whose (previously seen) VIN is now gone from stock.
  const soldRes = await db.execute(sql`
    WITH sold AS (
      UPDATE kia_vehicle_allocations va
      SET stock_missing_at = now(), stock_status = 'sold', updated_at = now()
      FROM kia_bookings kb
      WHERE va.booking_id = kb.id
        AND va.released_at IS NULL
        AND va.stock_missing_at IS NULL
        AND va.stock_last_seen_at IS NOT NULL
        -- A No-Payment-Received allocation keeps its own status; don't relabel it 'sold' when its VIN
        -- leaves the DMS feed (its snapshot already retains the vehicle for visibility).
        AND coalesce(va.allocation_status, '') <> 'no_payment'
        AND kb.deleted_at IS NULL
        AND kb.status NOT IN ('delivered', 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM kia_stock_management sm
          WHERE upper(trim(sm.vin_number)) = upper(trim(va.vin_number))
        )
      RETURNING va.id, va.vin_number, va.booking_id, kb.dealer_code, kb.booking_number,
                kb.customer_name, kb.model, kb.created_by
    ),
    -- #15 Mark the BOOKING itself so the UI can badge it "Vehicle not in stock" (the allotted VIN
    -- left the DMS feed). Merged into metadata so no existing field is lost.
    mark_bookings AS (
      UPDATE kia_bookings kb
      SET metadata = coalesce(kb.metadata, '{}'::jsonb)
                     || jsonb_build_object('vehicleNotInStock', true, 'vehicleNotInStockAt', now()),
          updated_at = now()
      FROM sold
      WHERE kb.id = sold.booking_id
    ),
    activity AS (
      INSERT INTO kia_booking_activity (booking_id, activity_type, title, description, actor_name, actor_role, after_value)
      SELECT booking_id, 'stock_missing', 'Allotted vehicle no longer in DMS stock',
             'VIN ' || vin_number || ' disappeared from DMS stock — likely sold',
             'System', 'system',
             jsonb_build_object('vinNumber', vin_number, 'reason', 'absent from kia_stock_management')
      FROM sold
    )
    SELECT id, vin_number, booking_id, dealer_code, booking_number, customer_name, model, created_by FROM sold
  `)

  return (soldRes as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    vinNumber: String(row.vin_number),
    bookingId: String(row.booking_id),
    dealerCode: row.dealer_code ? String(row.dealer_code) : null,
    bookingNumber: String(row.booking_number),
    customerName: String(row.customer_name),
    model: String(row.model),
    createdBy: row.created_by ? String(row.created_by) : null,
  }))
}

// #9 Transfer retention: same primitive as markKiaSoldAllocations but for transferred vehicles. Keeps
// stock_last_seen_at fresh while the transferred VIN is still in the DMS feed, and stamps
// stock_missing_at + stock_status='missing' once it disappears — so the destination dealer keeps
// seeing it from vehicle_snapshot. Guarded by the same freshness gate. Safe no-op if migration 0013
// (the retention columns) has not been applied yet — the caller swallows the missing-column error.
export async function markKiaTransferMissing(): Promise<void> {
  await db.execute(sql`
    UPDATE kia_vehicle_transfers vt
    SET stock_last_seen_at = now(), updated_at = now()
    WHERE LOWER(coalesce(vt.transfer_status, '')) IN ('transferred', 'requested')
      AND vt.vin_number IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM kia_stock_management sm
        WHERE upper(trim(sm.vin_number)) = upper(trim(vt.vin_number))
      )
  `)

  const stockCountRes = await db.execute<{ stock_count: number }>(sql`SELECT count(*)::int AS stock_count FROM kia_stock_management`)
  const stockCount = Number((stockCountRes as unknown as Array<{ stock_count: number }>)[0]?.stock_count || 0)
  if (stockCount === 0) return

  await db.execute(sql`
    UPDATE kia_vehicle_transfers vt
    SET stock_missing_at = now(), stock_status = 'missing', updated_at = now()
    WHERE LOWER(coalesce(vt.transfer_status, '')) IN ('transferred', 'requested')
      AND vt.vin_number IS NOT NULL
      AND vt.stock_missing_at IS NULL
      AND vt.stock_last_seen_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM kia_stock_management sm
        WHERE upper(trim(sm.vin_number)) = upper(trim(vt.vin_number))
      )
  `)
}

// (The debounced read-path self-heal wrappers `maybeSweepSoldAllocations` + `maybeExpireKiaReservations`
// were removed. They ran write transactions + full-table scans inside user reads to burn Vercel Fluid
// CPU on the hottest endpoint, and their module-level debounce was per warm instance anyway. All four
// sweeps — expireKiaTemporaryAllocations, expireKiaStockHolds, markKiaSoldAllocations,
// markKiaTransferMissing — now run ONLY from the scheduled job: POST /api/brands/kia/maintenance
// (`npm run kia:maintenance:scheduler`). Reads are read-only.)

function listFilters(input: BookingListInput) {
  const filters = [isNull(kiaBookings.deletedAt)]
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  if (dealerCode) filters.push(eq(kiaBookings.dealerCode, dealerCode))
  // Branch boundary: a dealer-scoped user can never see another branch's bookings.
  if (input.allowedDealers && input.allowedDealers.length) filters.push(inArray(kiaBookings.dealerCode, input.allowedDealers))
  if (text(input.model) && text(input.model).toLowerCase() !== 'all') filters.push(ilike(kiaBookings.model, text(input.model)))
  
  if (input.unallocated === true || String(input.unallocated).toLowerCase() === 'true') {
    filters.push(sql`
      (
        kia_bookings.status NOT IN ('draft', 'booking_created', 'delivered', 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM kia_vehicle_allocations va
          WHERE va.booking_id = kia_bookings.id AND va.released_at IS NULL
        )
      )
    `)
  }

  if (text(input.status) && text(input.status).toLowerCase() === 'today') {
    /*
     * ⚠️ 'today' is in PSEUDO_STATUS_FILTERS, so it falls through EVERY branch of the else-if chain
     * further down — including the final one that applies ne(status,'delivered') to the active list.
     * The result: Booked Today was the one view in the module with no status exclusion at all, and
     * a booking created and delivered on the same day sat in a work queue with nothing left to do.
     *
     * It surfaced when four August retail sales were backfilled as bookings: created today, already
     * delivered, and every one of them landed in Booked Today.
     *
     * Cancelled is excluded on the same reasoning. The KPI count below carries an identical pair of
     * exclusions — if these two ever disagree the card and the tab disagree.
     */
    filters.push(sql`kia_bookings.created_at >= ${istTodayStart()}`)
    filters.push(sql`kia_bookings.status NOT IN ('delivered', 'cancelled')`)
  }

  if (text(input.status) && text(input.status).toLowerCase() === 'not_in_stock') {
    filters.push(sql`
      (
        kia_bookings.status NOT IN ('draft', 'delivered', 'cancelled')
        /*
         * Same IDT exclusion the KPI subquery applies. A booking whose inter-dealer transfer is
         * already settled ('arranged' / 'cannot_arrange') is no longer an open stock question.
         * Without this the card and the tab it opens disagreed by 5 bookings.
         */
        AND (kia_bookings.metadata->'idtArrangement'->>'status' IS NULL
             OR kia_bookings.metadata->'idtArrangement'->>'status' NOT IN ('arranged', 'cannot_arrange'))
        AND (
          (kia_bookings.metadata->>'vehicleNotInStock')::boolean IS TRUE
          OR
          (
            NOT EXISTS (
              SELECT 1 FROM kia_vehicle_allocations va
              WHERE va.booking_id = kia_bookings.id AND va.released_at IS NULL
            )
            AND NOT ${kiaMatchingStockExists(
              'kia_bookings.model',
              'kia_bookings.variant',
              "coalesce(kia_bookings.color, kia_bookings.metadata->>'color')",
            )}
          )
        )
      )
    `)
  } else if (text(input.status) && text(input.status).toLowerCase() === 'in_stock') {
    filters.push(sql`
      (
        kia_bookings.status NOT IN ('draft', 'delivered', 'cancelled')
        /*
         * Same IDT exclusion the KPI subquery applies. A booking whose inter-dealer transfer is
         * already settled ('arranged' / 'cannot_arrange') is no longer an open stock question.
         * Without this the card and the tab it opens disagreed by 5 bookings.
         */
        AND (kia_bookings.metadata->'idtArrangement'->>'status' IS NULL
             OR kia_bookings.metadata->'idtArrangement'->>'status' NOT IN ('arranged', 'cannot_arrange'))
        AND NOT (
          (kia_bookings.metadata->>'vehicleNotInStock')::boolean IS TRUE
          OR
          (
            NOT EXISTS (
              SELECT 1 FROM kia_vehicle_allocations va
              WHERE va.booking_id = kia_bookings.id AND va.released_at IS NULL
            )
            AND NOT ${kiaMatchingStockExists(
              'kia_bookings.model',
              'kia_bookings.variant',
              "coalesce(kia_bookings.color, kia_bookings.metadata->>'color')",
            )}
          )
        )
      )
    `)
  } else if (text(input.status) && text(input.status).toLowerCase() === 'md_remarks') {
    filters.push(sql`(
      EXISTS (
        SELECT 1 FROM kia_booking_activity act
        WHERE act.booking_id = kia_bookings.id
        AND (
          act.description ILIKE '%[MD%' OR act.description ILIKE '%MD remark%' OR act.description ILIKE '%MD:%' OR act.title ILIKE '%[MD%' OR act.title ILIKE '%MD remark%'
          OR (
            (act.actor_role ILIKE '%md%' OR act.actor_role ILIKE '%management%' OR act.actor_role ILIKE '%developer%' OR act.actor_role ILIKE '%ceo%')
            AND act.title NOT ILIKE 'follow-up%'
            AND act.title NOT ILIKE 'booking%'
            AND act.title NOT ILIKE 'status%'
            AND act.title NOT ILIKE 'quick approved%'
            AND act.title NOT ILIKE 'approved%'
            AND act.title NOT ILIKE 'marked as%'
            AND (act.description IS NOT NULL AND length(trim(coalesce(act.description, ''))) > 3)
          )
        )
      )
      OR (kia_bookings.notes ILIKE '%[MD%' OR kia_bookings.notes ILIKE '%MD remark%' OR kia_bookings.notes ILIKE '%MD:%')
      OR (
        kia_bookings.metadata->'remarks' IS NOT NULL 
        AND (
          kia_bookings.metadata->>'remarks' ILIKE '%"authorRole":"MD"%'
          OR kia_bookings.metadata->>'remarks' ILIKE '%"authorRole":"DEVELOPER"%'
          OR kia_bookings.metadata->>'remarks' ILIKE '%"authorRole":"MANAGEMENT"%'
          OR kia_bookings.metadata->>'remarks' ILIKE '%"authorRole":"CEO"%'
          OR kia_bookings.metadata->>'remarks' ILIKE '%[MD%'
          OR kia_bookings.metadata->>'remarks' ILIKE '%MD remark%'
          OR kia_bookings.metadata->>'remarks' ILIKE '%MD:%'
        )
      )
    )`)
  } else if (text(input.status) && (text(input.status).toLowerCase() === 'vehicle_allocated' || text(input.status).toLowerCase() === 'payment_pending')) {
    filters.push(inArray(kiaBookings.status, ['vehicle_allocated', 'transferring']))
  } else if (
    text(input.status) &&
    !PSEUDO_STATUS_FILTERS.has(text(input.status).toLowerCase()) &&
    text(input.status).toLowerCase() !== 'all' &&
    text(input.status).toLowerCase() !== 'all_with_delivered'
  ) {
    filters.push(eq(kiaBookings.status, normalizeStatus(input.status)))
  } else if (!input.status || text(input.status).toLowerCase() === 'all') {
    // Active CRM list view excludes delivered bookings so delivered bookings reside in the Delivered section tab
    filters.push(ne(kiaBookings.status, 'delivered'))
  }

  /*
   * WHICH DATE the range applies to depends on what is being listed.
   *
   * ⚠️ For the Delivered view it is delivered_at, not created_at. "Delivered · August" means cars
   * that went out in August, not bookings that were RAISED in August and have since been delivered.
   * Measured: 11 vs 3 — and the Delivered CARD counts the former, so keying the list on created_at
   * puts an 11 above a table of 3. That is the card/tab mismatch this module keeps regressing into.
   *
   * Everything else is a pipeline stage, where "when was this booked" is the right question.
   */
  const dateColumn = text(input.status).toLowerCase() === 'delivered'
    ? sql`kia_bookings.delivered_at`
    : sql`kia_bookings.created_at`

  if (text(input.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(text(input.startDate))) {
    filters.push(sql`${dateColumn} >= ${istDayStart(text(input.startDate))}`)
  }
  if (text(input.endDate) && /^\d{4}-\d{2}-\d{2}$/.test(text(input.endDate))) {
    // Strictly-less-than the next IST midnight — the old <= form double-counted a booking sitting
    // exactly on the boundary instant into both adjacent ranges.
    filters.push(sql`${dateColumn} < ${istDayEnd(text(input.endDate))}`)
  }

  if (text(input.consultant) && text(input.consultant).toLowerCase() !== 'all') filters.push(ilike(kiaBookings.consultantName, text(input.consultant)))

  // Sales Executives (and any non-privileged role) only ever see their own
  // bookings — matched by creator id, consultant email, OR consultant name.
  const viewer = input.viewer
  if (viewer && !canViewAllKiaBookings(viewer.role)) {
    const ownFilters = []
    if (viewer.id) ownFilters.push(eq(kiaBookings.createdBy, viewer.id))
    if (viewer.email) ownFilters.push(ilike(kiaBookings.consultantEmail, viewer.email))
    
    // Match by consultant name (using normalized name comparison for robust matching)
    if (viewer.fullName) {
      const normalizedFullName = personNameKey(viewer.fullName)
      if (normalizedFullName) {
        ownFilters.push(
          sql`regexp_replace(lower(coalesce(${kiaBookings.consultantName}, '')), '[^a-z0-9]', '', 'g') = ${normalizedFullName}`
        )
      }
    }
    if (viewer.consultantName) {
      const normalizedConsultantName = personNameKey(viewer.consultantName)
      if (normalizedConsultantName) {
        ownFilters.push(
          sql`regexp_replace(lower(coalesce(${kiaBookings.consultantName}, '')), '[^a-z0-9]', '', 'g') = ${normalizedConsultantName}`
        )
      }
    }

    // If we can't identify the viewer at all, fail closed to no rows.
    filters.push(ownFilters.length ? or(...ownFilters)! : sql`false`)
  }

  const search = text(input.search)
  if (search) {
    const like = `%${search}%`
    filters.push(or(
      ilike(kiaBookings.bookingNumber, like),
      ilike(kiaBookings.customerName, like),
      ilike(kiaBookings.customerPhone, like),
      ilike(kiaBookings.model, like),
      ilike(kiaBookings.variant, like),
      ilike(kiaBookings.allocatedVin, like),
    )!)
  }

  return and(...filters)!
}

export async function getKiaBookingsList(input: BookingListInput) {
  const { page, pageSize, offset } = pageParams(input)
  const where = listFilters(input)
  // Same branch boundary applied to the KPI counts and filter-option lists below.
  const dealerScope = input.allowedDealers && input.allowedDealers.length
    ? sql`AND dealer_code IN ${input.allowedDealers}`
    : sql``
  // Same boundary, but qualified for the allocation join sub-selects (kb.dealer_code).
  const dealerScopeKb = input.allowedDealers && input.allowedDealers.length
    ? sql`AND kb.dealer_code IN ${input.allowedDealers}`
    : sql``

  /*
   * The same window, unaliased, for sub-selects that read kia_bookings directly rather than through
   * a `kb` alias.
   */
  const dateScope = sql`
    ${text(input.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(text(input.startDate)) ? sql`AND created_at >= ${istDayStart(text(input.startDate))}` : sql``}
    ${text(input.endDate) && /^\d{4}-\d{2}-\d{2}$/.test(text(input.endDate)) ? sql`AND created_at < ${istDayEnd(text(input.endDate))}` : sql``}
  `

  /**
   * Delivered is windowed on WHEN THE CAR WENT OUT, never on when the booking was created.
   *
   * Measured for the current month: 11 cars were delivered, but only 3 of those bookings were
   * CREATED this month — so a created_at window under-reports deliveries by 73% and is the reason
   * the Delivered card and the Stock tab told different stories. delivered_at is populated on 33 of
   * 33 delivered rows, so nothing is lost by keying on it.
   */
  const deliveredDateScope = sql`
    ${text(input.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(text(input.startDate)) ? sql`AND delivered_at >= ${istDayStart(text(input.startDate))}` : sql``}
    ${text(input.endDate) && /^\d{4}-\d{2}-\d{2}$/.test(text(input.endDate)) ? sql`AND delivered_at < ${istDayEnd(text(input.endDate))}` : sql``}
  `

  const dateScopeKb = sql`
    ${text(input.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(text(input.startDate)) ? sql`AND kb.created_at >= ${istDayStart(text(input.startDate))}` : sql``}
    ${text(input.endDate) && /^\d{4}-\d{2}-\d{2}$/.test(text(input.endDate)) ? sql`AND kb.created_at < ${istDayEnd(text(input.endDate))}` : sql``}
  `

  // Page load is dominated by pooler round-trip latency (~225ms/query), not the
  // queries themselves. The status counts, filter option lists and today count
  // are all over the same unfiltered table, so fold them into ONE round trip via
  // scalar sub-selects. That drops the list from 7 queries to 3 (count + page +
  // aggregates) — one RTT wave instead of two under the dev pool.
  const isAscSort = text(input.sortOrder).toLowerCase() === 'asc'
  const [totalRows, bookingRows, aggRows] = await Promise.all([
    db.select({ value: count() }).from(kiaBookings).where(where),
    db.select().from(kiaBookings).where(where).orderBy(
      isAscSort ? asc(kiaBookings.createdAt) : desc(kiaBookings.createdAt),
      isAscSort ? asc(kiaBookings.id) : desc(kiaBookings.id),
    ).limit(pageSize).offset(offset),
    db.execute(sql`
      SELECT
        /*
         * The pipeline cards follow the DATE RANGE the user has chosen, which on first load is the
         * current month. They were lifetime totals sitting above a month-scoped table, which is the
         * mismatch being reported.
         *
         * ⚠️ 'delivered' is deliberately EXCLUDED here and counted separately below. This is one
         * GROUP BY over one window, so it can only key on created_at — and for deliveries that is
         * the wrong column (3 vs a true 11 this month).
         *
         * ⚠️ These are WORK QUEUES as well as metrics. Narrowing the range genuinely hides live
         * work: lifetime "Awaiting VIN" is 64 and the current month is 24, and those other 40 are
         * real bookings sales is still chasing. That is what "month-wise" means and it is what was
         * asked for — widen the range to see the rest.
         */
        COALESCE((SELECT jsonb_object_agg(status, cnt) FROM (
          SELECT status, count(*)::int AS cnt FROM kia_bookings
          WHERE deleted_at IS NULL AND status <> 'delivered' ${dealerScope} ${dateScope} GROUP BY status
        ) s), '{}'::jsonb) AS status_counts,
        (SELECT count(*)::int FROM kia_bookings
          WHERE deleted_at IS NULL AND status = 'delivered' ${dealerScope} ${deliveredDateScope}) AS delivered_count,
        COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (
          SELECT DISTINCT dealer_code AS value FROM kia_bookings WHERE deleted_at IS NULL AND dealer_code IS NOT NULL ${dealerScope}
        ) d), '[]'::jsonb) AS dealers,
        COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (
          SELECT DISTINCT model AS value FROM kia_bookings WHERE deleted_at IS NULL AND model IS NOT NULL ${dealerScope}
        ) m), '[]'::jsonb) AS models,
        COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (
          SELECT DISTINCT consultant_name AS value FROM kia_bookings WHERE deleted_at IS NULL AND consultant_name IS NOT NULL ${dealerScope}
        ) c), '[]'::jsonb) AS consultants,
        -- Exclusions mirror the 'today' list filter exactly — see the note there.
        (SELECT count(*)::int FROM kia_bookings WHERE deleted_at IS NULL
           AND created_at >= ${istTodayStart()} AND status NOT IN ('delivered', 'cancelled') ${dealerScope}) AS today_count,
        -- #10 Summary: top models booked + allocation state across all (non-deleted) bookings.
        COALESCE((SELECT jsonb_agg(jsonb_build_object('model', model, 'count', cnt)) FROM (
          SELECT model, count(*)::int AS cnt FROM kia_bookings WHERE deleted_at IS NULL AND model IS NOT NULL ${dealerScope}
          GROUP BY model ORDER BY count(*) DESC, model ASC LIMIT 12
        ) mm), '[]'::jsonb) AS model_counts,
        (SELECT count(*)::int FROM kia_vehicle_allocations va JOIN kia_bookings kb ON kb.id = va.booking_id
          WHERE va.released_at IS NULL AND kb.deleted_at IS NULL ${dealerScopeKb}) AS active_allocations,
        (SELECT count(*)::int FROM kia_vehicle_allocations va JOIN kia_bookings kb ON kb.id = va.booking_id
          WHERE va.released_at IS NULL AND va.allocation_status = 'no_payment' AND kb.deleted_at IS NULL ${dealerScopeKb}) AS no_payment_count,
        (SELECT count(*)::int FROM kia_bookings kb
          WHERE kb.deleted_at IS NULL
            AND kb.status NOT IN ('draft', 'delivered', 'cancelled')
            AND (kb.metadata->'idtArrangement'->>'status' IS NULL OR kb.metadata->'idtArrangement'->>'status' NOT IN ('arranged', 'cannot_arrange'))
            AND (
              -- Path 1: allocated VIN left the DMS (metadata flag set by stock-watcher job)
              (kb.metadata->>'vehicleNotInStock')::boolean IS TRUE
              OR
              -- Path 2: no active allocation AND no matching free stock right now
              (
                NOT EXISTS (
                  SELECT 1 FROM kia_vehicle_allocations va
                  WHERE va.booking_id = kb.id AND va.released_at IS NULL
                )
                AND NOT ${kiaMatchingStockExists(
                  'kb.model', 'kb.variant', "coalesce(kb.color, kb.metadata->>'color')")}
              )
            )
            /*
             * ⚠️ dateScopeKb is REQUIRED here and was missing.
             *
             * eligible_count below carries the date scope, and the In Stock card is computed as
             * eligible_count - not_in_stock_count. Subtracting a LIFETIME not-in-stock from a
             * DATE-SCOPED eligible produced nonsense: on the default current-month load the card
             * rendered "In Stock 5" above a tab that listed 16, and Math.max(0, ...) pinned it to
             * zero on any narrow range.
             */
            ${dealerScopeKb} ${dateScopeKb}) AS not_in_stock_count,
        -- in_stock is the EXACT complement of not_in_stock within the in-flight set (the not-in-stock
        -- predicate is a total boolean per booking), so it is derived as eligible_count - not_in_stock_count
        -- in JS. Computing it here re-ran the whole bidirectional-ILIKE stock scan a second time for no
        -- new information — this cheap count replaces that scan.
        (SELECT count(DISTINCT kb.id)::int FROM kia_bookings kb
          WHERE kb.deleted_at IS NULL
            AND (
              EXISTS (
                SELECT 1 FROM kia_booking_activity act
                WHERE act.booking_id = kb.id
                AND (
                  act.description ILIKE '%[MD%' OR act.description ILIKE '%MD remark%' OR act.description ILIKE '%MD:%' OR act.title ILIKE '%[MD%' OR act.title ILIKE '%MD remark%'
                  OR (
                    (act.actor_role ILIKE '%md%' OR act.actor_role ILIKE '%management%' OR act.actor_role ILIKE '%developer%' OR act.actor_role ILIKE '%ceo%')
                    AND act.title NOT ILIKE 'follow-up%'
                    AND act.title NOT ILIKE 'booking%'
                    AND act.title NOT ILIKE 'status%'
                    AND act.title NOT ILIKE 'quick approved%'
                    AND act.title NOT ILIKE 'approved%'
                    AND act.title NOT ILIKE 'marked as%'
                    AND (act.description IS NOT NULL AND length(trim(coalesce(act.description, ''))) > 3)
                  )
                )
              )
              OR (kb.notes ILIKE '%[MD%' OR kb.notes ILIKE '%MD remark%' OR kb.notes ILIKE '%MD:%')
              OR (
                kb.metadata->'remarks' IS NOT NULL 
                AND (
                  kb.metadata->>'remarks' ILIKE '%"authorRole":"MD"%'
                  OR kb.metadata->>'remarks' ILIKE '%"authorRole":"DEVELOPER"%'
                  OR kb.metadata->>'remarks' ILIKE '%"authorRole":"MANAGEMENT"%'
                  OR kb.metadata->>'remarks' ILIKE '%"authorRole":"CEO"%'
                  OR kb.metadata->>'remarks' ILIKE '%[MD%'
                  OR kb.metadata->>'remarks' ILIKE '%MD remark%'
                  OR kb.metadata->>'remarks' ILIKE '%MD:%'
                )
              )
            )
            ${dealerScopeKb}
            ${dateScopeKb}) AS md_remarks_count,
        (SELECT count(*)::int FROM kia_bookings kb
          WHERE kb.deleted_at IS NULL
            AND kb.status NOT IN ('draft', 'delivered', 'cancelled')
            /*
             * The SAME IDT exclusion not_in_stock_count applies. The In Stock card is
             * eligible_count - not_in_stock_count, so if this set is wider than the one the
             * not-in-stock predicate runs over, the difference is inflated by exactly the bookings
             * the other side excluded — measured at 5, which is why the card read 51 above a tab
             * listing 46.
             */
            AND (kb.metadata->'idtArrangement'->>'status' IS NULL
                 OR kb.metadata->'idtArrangement'->>'status' NOT IN ('arranged', 'cannot_arrange'))
            ${dealerScopeKb}
            ${dateScopeKb}) AS eligible_count,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('model', model, 'variant', variant, 'color', coalesce(color, '—'), 'count', cnt) ORDER BY cnt DESC, model ASC, variant ASC, color ASC) FROM (
          SELECT model, variant, color, count(*)::int AS cnt
          FROM kia_bookings
          WHERE deleted_at IS NULL
            AND status NOT IN ('draft', 'delivered', 'cancelled')
            AND (metadata->'idtArrangement'->>'status' IS NULL OR metadata->'idtArrangement'->>'status' NOT IN ('arranged', 'cannot_arrange'))
            AND (
              (metadata->>'vehicleNotInStock')::boolean IS TRUE
              OR (
                NOT EXISTS (
                  SELECT 1 FROM kia_vehicle_allocations va
                  WHERE va.booking_id = kia_bookings.id AND va.released_at IS NULL
                )
                AND NOT ${kiaMatchingStockExists(
                  'kia_bookings.model',
                  'kia_bookings.variant',
                  "coalesce(kia_bookings.color, kia_bookings.metadata->>'color')",
                )}
              )
            )
            ${dealerScope}
          GROUP BY model, variant, color
        ) ns), '[]'::jsonb) AS not_in_stock_breakdown
    `),
  ])

  const agg = rows<{
    status_counts: Record<string, number> | null
    dealers: string[] | null
    models: string[] | null
    consultants: string[] | null
    today_count: number
    model_counts: { model: string; count: number }[] | null
    active_allocations: number
    no_payment_count: number
    delivered_count: number
    not_in_stock_count: number
    eligible_count: number
    md_remarks_count: number
    not_in_stock_breakdown: { model: string; variant: string; color: string; count: number }[] | null
  }>(aggRows)[0]
  const statusCounts = agg?.status_counts || {}
  const todayCount = Number(agg?.today_count || 0)
  const totalBookings = Number(totalRows[0]?.value || 0)

  // #2 Attach each booking's proforma approval status so the CRM waiting indicator can tell "pending
  // approval" from "approved, awaiting allocation" — both sit at booking status 'proforma_generated'.
  const proformaIds = Array.from(new Set(bookingRows.map((b) => b.proformaId).filter(Boolean))) as string[]
  const approvalByProforma = new Map<string, string | null>()
  // Red-flag bookings whose stock is not available: either the allotted vehicle has left the DMS feed
  // (#15 `vehicleNotInStock` flag) OR the booking has no active allocation AND no free matching vehicle
  // in stock. Computed for the page's in-flight bookings in ONE query (page size is small).
  const mdRemarksByBooking = new Map<string, { count: number; latest: string | null }>()
  const bookingIds = bookingRows.map((b) => b.id)
  const stockFlagMap = new Map<string, boolean>()
  const stockAvailableMap = new Map<string, boolean>()
  const flagCandidates = bookingRows.filter((b) => !['draft', 'delivered', 'cancelled'].includes(String(b.status || '')))

  // #2 (proforma approval status), stock-availability flag, and MD remarks all depend ONLY on
  // bookingRows and are independent of each other — run them concurrently.
  await Promise.all([
    (async () => {
      if (!proformaIds.length) return
      const statuses = await db
        .select({ id: kiaProformas.id, approvalStatus: kiaProformas.approvalStatus })
        .from(kiaProformas)
        .where(inArray(kiaProformas.id, proformaIds))
      for (const s of statuses) approvalByProforma.set(s.id, s.approvalStatus)
    })(),
    (async () => {
      if (!bookingIds.length) return
      const actRows = await db
        .select({
          bookingId: kiaBookingActivity.bookingId,
          description: kiaBookingActivity.description,
          title: kiaBookingActivity.title,
          actorRole: kiaBookingActivity.actorRole,
          actorName: kiaBookingActivity.actorName,
          createdAt: kiaBookingActivity.createdAt,
        })
        .from(kiaBookingActivity)
        .where(inArray(kiaBookingActivity.bookingId, bookingIds))
        .orderBy(desc(kiaBookingActivity.createdAt))

      for (const b of bookingRows) {
        const bActs = actRows.filter((a) => a.bookingId === b.id)
        const remarksList: string[] = []

        // 1. Check metadata.remarks array
        if (b.metadata && Array.isArray((b.metadata as any).remarks)) {
          for (const r of (b.metadata as any).remarks) {
            if (r && typeof r === 'object' && r.text) {
              const textStr = String(r.text).trim()
              const roleStr = String(r.authorRole || '').toLowerCase()
              const nameStr = String(r.authorName || '').toLowerCase()
              if (
                roleStr.includes('md') || roleStr.includes('management') || roleStr.includes('developer') || roleStr.includes('ceo') ||
                nameStr.includes('md') || nameStr.includes('developer') || /\[md/i.test(textStr) || /md remark/i.test(textStr) || /md:/i.test(textStr)
              ) {
                if (textStr && !remarksList.includes(textStr)) remarksList.push(textStr)
              }
            }
          }
        }

        // 2. Check b.notes
        if (b.notes) {
          const textStr = String(b.notes).trim()
          if (/\[md/i.test(textStr) || /md remark/i.test(textStr) || /md:/i.test(textStr)) {
            if (textStr && !remarksList.includes(textStr)) remarksList.push(textStr)
          }
        }

        // 3. Check activity logs
        for (const act of bActs) {
          const textStr = (act.description || act.title || '').trim()
          if (textStr && textStr.length > 3) {
            const roleLower = (act.actorRole || '').toLowerCase()
            const nameLower = (act.actorName || '').toLowerCase()
            if (
              roleLower.includes('md') || roleLower.includes('management') || roleLower.includes('developer') || roleLower.includes('ceo') ||
              nameLower.includes('md') || nameLower.includes('developer') || /\[md/i.test(textStr) || /md remark/i.test(textStr) || /md:/i.test(textStr)
            ) {
              const lower = textStr.toLowerCase()
              const isAutoLog = ['follow-up', 'booking created', 'status set to', 'marked as', 'quick approved', 'approved', 'discount requested', 'proforma generated'].some((p) => lower.startsWith(p))
              if (!isAutoLog && !remarksList.includes(textStr)) {
                remarksList.push(textStr)
              }
            }
          }
        }

        if (remarksList.length > 0) {
          mdRemarksByBooking.set(b.id, { count: remarksList.length, latest: remarksList[0] })
        }
      }
    })(),
    (async () => {
      if (!flagCandidates.length) return
      const tuples = flagCandidates.map((b) => sql`(${b.id}::uuid, ${text(b.model)}::text, ${text(b.variant)}::text, ${bookingColorOf(b)}::text)`)
      const flagRows = await analyticsDb.execute(sql`
      WITH wanted(id, model, variant, color) AS (VALUES ${sql.join(tuples, sql`, `)})
      SELECT w.id::text AS id,
        NOT EXISTS (SELECT 1 FROM kia_vehicle_allocations va WHERE va.booking_id = w.id AND va.released_at IS NULL) AS no_allocation,
        ${kiaMatchingStockExists('w.model', 'w.variant', 'w.color')} AS has_matching_stock
      FROM wanted w
    `)
      for (const r of rows<{ id: string; no_allocation: boolean; has_matching_stock: boolean }>(flagRows)) {
        const noAlloc = Boolean(r.no_allocation)
        // No allocation + no matching free vehicle → "Not in stock". No allocation + a matching free
        // vehicle exists → "In stock" (allottable). Store both so the list can show either indicator.
        stockFlagMap.set(String(r.id), noAlloc && !r.has_matching_stock)
        stockAvailableMap.set(String(r.id), noAlloc && Boolean(r.has_matching_stock))
      }
    })(),
  ])

  // Redact BEFORE the rows leave this function. These list rows are display-only (the edit form is
  // seeded from getKiaBookingDetail, not from here), so masking them cannot corrupt a write-back.
  const canViewPii = canViewKiaCustomerPii(input.viewer?.role)
  const rowsWithApproval = bookingRows.map((b) => redactKiaBookingPii({
    ...(b as unknown as Record<string, unknown>),
    proformaApprovalStatus: b.proformaId ? (approvalByProforma.get(b.proformaId) ?? null) : null,
    stockNotAvailable: Boolean(stockFlagMap.get(b.id)) || Boolean((b.metadata as Record<string, unknown> | null)?.vehicleNotInStock),
    // A matching free vehicle is available to allot (no allocation yet + in-stock match). Mutually
    // exclusive with stockNotAvailable; false once allocated or for terminal bookings.
    stockAvailable: Boolean(stockAvailableMap.get(b.id)),
    mdRemarksCount: mdRemarksByBooking.get(b.id)?.count || 0,
    latestMdRemark: mdRemarksByBooking.get(b.id)?.latest || null,
  }, canViewPii))

  return {
    rows: rowsWithApproval,
    pagination: {
      page,
      pageSize,
      total: totalBookings,
      totalPages: Math.max(1, Math.ceil(totalBookings / pageSize)),
    },
    kpis: {
      today: todayCount,
      pendingProforma: statusCounts.booking_created || 0,
      waitingAllocation: statusCounts.proforma_generated || 0,
      financePending: (statusCounts.vehicle_allocated || 0) + (statusCounts.transferring || 0),
      readyDelivery: statusCounts.ready_delivery || 0,
      // From its own delivered_at-windowed count, not the created_at GROUP BY — see the note above.
      delivered: Number(agg?.delivered_count || 0),
      cancelled: statusCounts.cancelled || 0,
      notInStock: Number(agg?.not_in_stock_count || 0),
      // Exact complement of not-in-stock within the in-flight set (see the SQL note above).
      inStock: Math.max(0, Number(agg?.eligible_count || 0) - Number(agg?.not_in_stock_count || 0)),
      mdRemarks: Number(agg?.md_remarks_count || 0),
    },
    // #10 Bookings & vehicles summary — full status distribution, allocation state, and top models.
    summary: {
      totalBookings,
      statusCounts: { ...statusCounts, delivered: Number(agg?.delivered_count || 0) } as Record<string, number>,
      onHold: statusCounts.on_hold || 0,
      activeAllocations: Number(agg?.active_allocations || 0),
      noPayment: Number(agg?.no_payment_count || 0),
      notInStock: Number(agg?.not_in_stock_count || 0),
      topModels: (agg?.model_counts || []).map((m) => ({ model: text(m.model), count: Number(m.count || 0) })).filter((m) => m.model),
      notInStockBreakdown: (agg?.not_in_stock_breakdown || []).map((r) => ({
        model: text(r.model),
        variant: text(r.variant),
        color: text(r.color),
        count: Number(r.count || 0),
      })).filter((r) => r.model),
    },
    filters: {
      dealers: (agg?.dealers || []).map((value) => text(value)).filter(Boolean),
      models: (agg?.models || []).map((value) => text(value)).filter(Boolean),
      consultants: (agg?.consultants || []).map((value) => text(value)).filter(Boolean),
      statuses: [...KIA_BOOKING_STATUSES, 'not_in_stock', 'in_stock'],
    },
  }
}

export async function createKiaBooking(input: CreateBookingInput, appUser: AppUser) {
  const required = {
    customerName: text(input.customerName),
    customerPhone: text(input.customerPhone),
    dealerCode: normalizeKiaDealerCode(input.dealerCode) || text(input.dealerCode).toUpperCase(),
    model: text(input.model).toUpperCase(),
    // ⚠️ Uppercased to match `model`. It previously was not, so the duplicate check below compared a
    // raw-case variant against stored values and a difference in casing alone defeated it. Live rows
    // carry both 'NEW SELTOS DIESEL' and 'New Seltos Diesel', so case variance is real here, and the
    // unique index in migration 0044 keys on UPPER(BTRIM(...)) — the two must agree or the app check
    // passes and the database then rejects the insert.
    variant: text(input.variant).toUpperCase(),
    consultantName: text(input.consultantName) || appUser.fullName,
  }

  for (const [key, value] of Object.entries(required)) {
    if (!value) throw new Error(`${key} is required`)
  }

  /*
   * Same-day duplicate guard: same customer phone, model and variant on the same IST day.
   *
   * ⚠️ Compared case-insensitively. `required.model` is uppercased but STORED rows are not
   * consistently normalised — the live table holds both 'NEW SELTOS DIESEL' and 'New Seltos Diesel'
   * (the bulk importer writes mixed case). An `eq()` on the raw column therefore missed exactly the
   * duplicates this check exists to stop.
   *
   * ⚠️ This check is NOT atomic — it runs before the transaction below, so two concurrent submits
   * can both pass it. That hole is closed by kia_bookings_same_day_unique_idx (migration 0044),
   * which enforces the identical rule in the database. This check survives because it produces a
   * sentence a user can act on; the index produces a Postgres 23505. Both are needed, and they MUST
   * agree on normalisation — the index keys on UPPER(BTRIM(...)) too.
   */
  const duplicates = await db.select({ id: kiaBookings.id })
    .from(kiaBookings)
    .where(
      and(
        eq(kiaBookings.customerPhone, required.customerPhone),
        sql`UPPER(BTRIM(${kiaBookings.model})) = ${required.model}`,
        sql`UPPER(BTRIM(COALESCE(${kiaBookings.variant}, ''))) = ${required.variant}`,
        isNull(kiaBookings.deletedAt),
        sql`timezone('Asia/Kolkata', ${kiaBookings.createdAt})::date = (now() at time zone 'Asia/Kolkata')::date`
      )
    )
    .limit(1)

  if (duplicates.length > 0) {
    throw new Error('A duplicate booking for this customer and vehicle variant has already been created today.')
  }

  return db.transaction(async (tx) => {
    const bookingNumber = await nextBookingNumber(tx, required.dealerCode)
    const [booking] = await tx.insert(kiaBookings).values({
      bookingNumber,
      status: 'booking_created',
      dealerCode: required.dealerCode,
      customerName: required.customerName,
      customerPhone: required.customerPhone,
      customerEmail: nullableText(input.customerEmail),
      customerAddress: nullableText(input.customerAddress),
      model: required.model,
      variant: required.variant,
      color: nullableText(input.color),
      fuelType: nullableText(input.fuelType),
      consultantName: required.consultantName,
      consultantEmail: appUser.email,
      source: nullableText(input.source),
      financeRequired: Boolean(input.financeRequired),
      bankName: input.bankName ? normalizeBankName(input.bankName) : null,
      loanAmount: numericText(input.loanAmount),
      notes: nullableText(input.notes),
      deliveryTargetDate: nullableText(input.deliveryTargetDate),
      metadata: (input.metadata || {}) as JsonRecord,
      createdBy: appUser.id,
      updatedBy: appUser.id,
    }).returning()

    await addActivity(tx, {
      bookingId: booking.id,
      type: 'created',
      title: 'Booking created',
      description: `${booking.customerName} booked ${booking.model} ${booking.variant}`,
      after: booking as unknown as JsonRecord,
      appUser,
    })

    if (input.requestDiscount && input.discountRequestedAmount) {
      await tx.insert(kiaBookingDiscounts).values({
        bookingId: booking.id,
        requestedAmount: String(input.discountRequestedAmount),
        reason: input.discountReason || 'Requested during booking creation',
        requestedBy: appUser.id,
        requestedByName: appUser.fullName,
        status: 'PENDING',
      })

      await addActivity(tx, {
        bookingId: booking.id,
        type: 'remark',
        title: 'Discount requested',
        description: `Requested discount of INR ${Number(input.discountRequestedAmount).toLocaleString('en-IN')} during booking creation.`,
        appUser,
      })
    }

    // Every booking enters the Booking Follow-ups pipeline the moment it exists — due immediately,
    // so it lands in the CRE's Pending queue rather than waiting for someone to remember.
    //
    // Inserted directly on the tx rather than via createFollowup(), which uses the global `db`: a
    // call to it here would run OUTSIDE this transaction and could leave an orphan follow-up if the
    // booking insert later rolled back. It also (correctly) demands human remarks, which a system
    // enrolment has none of.
    // Resolve assignee for the auto-enrolled follow-up
    let assignedToId: string | null = null
    let assignedName: string | null = null
    let assignedEmail: string | null = null

    const consultantEmail = String(booking.consultantEmail || '').trim().toLowerCase()
    if (consultantEmail) {
      const [byEmail] = await tx.select({ id: users.id, name: users.fullName, email: users.email })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${consultantEmail}`, eq(users.isActive, true), isNull(users.deletedAt)))
        .limit(1)
      if (byEmail) {
        assignedToId = byEmail.id
        assignedName = booking.consultantName || byEmail.name
        assignedEmail = byEmail.email
      }
    }

    if (!assignedToId) {
      const [creator] = await tx.select({ id: users.id, name: users.fullName, email: users.email })
        .from(users)
        .where(and(eq(users.id, booking.createdBy), isNull(users.deletedAt)))
        .limit(1)
      if (creator) {
        assignedToId = creator.id
        assignedName = booking.consultantName || creator.name
        assignedEmail = booking.consultantEmail || creator.email
      }
    }

    await tx.insert(kiaLeadFollowups).values({
      bookingId: booking.id,
      dueAt: new Date(),
      status: 'pending',
      reason: 'general',
      priority: 'normal',
      assignedTo: assignedToId,
      assignedName,
      assignedEmail,
      dealerCode: booking.dealerCode,
      source: 'manual',
      notes: `Auto-enrolled when the booking was created by ${appUser.fullName}.`,
      createdBy: appUser.id,
    })

    return booking
  })
}

export async function getKiaBookingDetail(id: string) {
  // READ-ONLY. The allocation/hold expiry + sold-vehicle sweeps used to run here (awaited + fire-and-
  // forget) — write transactions and full-table scans on the critical path of the app's hottest
  // endpoint. They now run only from the scheduled maintenance job: POST /api/brands/kia/maintenance
  // (npm run kia:maintenance:scheduler).
  // Statement budget matters here more than raw work: this endpoint is hover-prefetched per booking row
  // (kia-bookings-client), so a burst of concurrent detail loads all compete for the small pooler
  // connection budget (DATABASE_POOL_MAX = 4 dev / 6 prod) and each starved query pays a full pooler
  // RTT. The booking + its three 1:1 relations (active allocation, proforma header, finance-order
  // header) are folded into ONE LEFT-JOIN round trip; only the multi-row lists (activity, transfers,
  // follow-up notes) stay a parallel batch. 7 statements → 4 — which is what cuts the burst latency.
  const [head] = await db
    .select({
      booking: kiaBookings,
      // Project the allocation to SCALARS only — the client uses vinNumber/model/variant/color/
      // dealerCode/stockStatus/stockMissingAt/expiresAt and never vehicle_snapshot. Selecting the whole
      // row pulled a full DMS vehicle_snapshot JSONB the driver deserialised and the route re-serialised
      // into every (hover-prefetched) detail response for nothing.
      allocation: {
        id: kiaVehicleAllocations.id,
        bookingId: kiaVehicleAllocations.bookingId,
        vinNumber: kiaVehicleAllocations.vinNumber,
        dealerCode: kiaVehicleAllocations.dealerCode,
        model: kiaVehicleAllocations.model,
        variant: kiaVehicleAllocations.variant,
        color: kiaVehicleAllocations.color,
        engineNo: kiaVehicleAllocations.engineNo,
        stockSource: kiaVehicleAllocations.stockSource,
        allocationStatus: kiaVehicleAllocations.allocationStatus,
        expiresAt: kiaVehicleAllocations.expiresAt,
        paymentConfirmedAt: kiaVehicleAllocations.paymentConfirmedAt,
        paymentReference: kiaVehicleAllocations.paymentReference,
        allocatedAt: kiaVehicleAllocations.allocatedAt,
        releasedAt: kiaVehicleAllocations.releasedAt,
        releaseReason: kiaVehicleAllocations.releaseReason,
        stockLastSeenAt: kiaVehicleAllocations.stockLastSeenAt,
        stockMissingAt: kiaVehicleAllocations.stockMissingAt,
        stockStatus: kiaVehicleAllocations.stockStatus,
        createdAt: kiaVehicleAllocations.createdAt,
        updatedAt: kiaVehicleAllocations.updatedAt,
      },
      proformaId: kiaProformas.id,
      proformaApprovalStatus: kiaProformas.approvalStatus,
      proformaCreatedAt: kiaProformas.createdAt,
      financeOrderId: financeOrders.id,
      financeOrderNumber: financeOrders.orderNumber,
      financeOrderStatus: financeOrders.status,
      financeOrderCreatedAt: financeOrders.createdAt,
    })
    .from(kiaBookings)
    // At most one active allocation per booking (partial unique index on booking_id WHERE released_at
    // IS NULL); proforma/finance-order match by their own id — the join stays 1:1 so LIMIT 1 is exact.
    .leftJoin(kiaVehicleAllocations, and(eq(kiaVehicleAllocations.bookingId, kiaBookings.id), isNull(kiaVehicleAllocations.releasedAt)))
    .leftJoin(kiaProformas, eq(kiaProformas.id, kiaBookings.proformaId))
    .leftJoin(financeOrders, eq(financeOrders.id, kiaBookings.financeOrderId))
    .where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt)))
    .limit(1)

  if (!head?.booking) return null
  const booking = head.booking

  // Projected to EXACTLY the columns the route serializes (see detailPayload in
  // app/api/brands/kia/bookings/[id]/route.ts). A bare `db.select()` here was pulling activity
  // before_value/after_value (whole-booking JSONB snapshots, up to 100 rows) and transfer
  // metadata/vehicle_snapshot JSONB the route discards — deserialising that was the CPU bill.
  const [activity, transfers, followupNotes, discounts, paymentWindowRequests] = await Promise.all([
    db.select({
      id: kiaBookingActivity.id,
      activityType: kiaBookingActivity.activityType,
      title: kiaBookingActivity.title,
      description: kiaBookingActivity.description,
      actorName: kiaBookingActivity.actorName,
      actorRole: kiaBookingActivity.actorRole,
      createdAt: kiaBookingActivity.createdAt,
    }).from(kiaBookingActivity).where(eq(kiaBookingActivity.bookingId, id)).orderBy(desc(kiaBookingActivity.createdAt)).limit(100),
    db.select({
      id: kiaVehicleTransfers.id,
      vinNumber: kiaVehicleTransfers.vinNumber,
      fromDealerCode: kiaVehicleTransfers.fromDealerCode,
      toDealerCode: kiaVehicleTransfers.toDealerCode,
      transferStatus: kiaVehicleTransfers.transferStatus,
      createdAt: kiaVehicleTransfers.createdAt,
    }).from(kiaVehicleTransfers).where(eq(kiaVehicleTransfers.bookingId, id)).orderBy(desc(kiaVehicleTransfers.createdAt)).limit(50),
    db.select({
      id: kiaLeadFollowups.id,
      notes: kiaLeadFollowups.notes,
      assignedName: kiaLeadFollowups.assignedName,
      createdAt: kiaLeadFollowups.createdAt,
      updatedAt: kiaLeadFollowups.updatedAt,
    }).from(kiaLeadFollowups).where(eq(kiaLeadFollowups.bookingId, id)),
    db.select().from(kiaBookingDiscounts).where(eq(kiaBookingDiscounts.bookingId, id)).orderBy(desc(kiaBookingDiscounts.createdAt)).limit(50),
    // Extra-time requests, so the consultant sees the MD's decision without leaving the booking.
    // A plain per-booking SELECT — the competing-bookings query deliberately stays OUT of this path,
    // which is hover-prefetched per row against a small connection pool.
    db.select().from(kiaPaymentWindowRequests).where(eq(kiaPaymentWindowRequests.bookingId, id)).orderBy(desc(kiaPaymentWindowRequests.createdAt)).limit(50),
  ])

  const followupRemarks = (followupNotes || [])
    .filter((f) => f.notes && f.notes.trim())
    .map((f) => ({
      id: `fu-${f.id}`,
      activityType: 'followup_remark',
      title: 'Follow-up Remark',
      description: f.notes,
      actorName: f.assignedName || 'CRE',
      createdAt: f.updatedAt || f.createdAt,
    }))

  const combinedActivity = [...activity, ...followupRemarks].sort(
    (a, b) => new Date(b.createdAt as Date).getTime() - new Date(a.createdAt as Date).getTime()
  )

  return {
    booking,
    // LEFT JOIN yields a null (or all-null) allocation when the booking has no active allocation — a
    // null id means "no allocation". Otherwise it is the same full allocation row as before.
    activeAllocation: head.allocation && head.allocation.id ? head.allocation : null,
    proforma: head.proformaId ? { id: head.proformaId, approvalStatus: head.proformaApprovalStatus, createdAt: head.proformaCreatedAt } : null,
    financeOrder: head.financeOrderId ? { id: head.financeOrderId, orderNumber: head.financeOrderNumber, status: head.financeOrderStatus, createdAt: head.financeOrderCreatedAt } : null,
    transfers,
    activity: combinedActivity,
    discounts: discounts || [],
    paymentWindowRequests: paymentWindowRequests || [],
  }
}

export async function updateKiaBooking(id: string, input: UpdateBookingInput, appUser: AppUser) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!before) throw new Error('Booking not found')

    const updates: Partial<typeof kiaBookings.$inferInsert> = {
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }

    if (input.customerName !== undefined) updates.customerName = text(input.customerName)

    // PII writes are refused for viewers who cannot SEE PII, for two reasons that point the same way.
    // Correctness: those viewers are served a redacted booking (redactKiaBookingPii), the edit form is
    // seeded from it, and an unmodified save would post "••••••" straight over the real number.
    // Security: someone who may not read a customer's phone has no business silently rewriting it.
    // Editing PII stays available to MD / Developer / Finance Head, who are served the real values.
    const [profile] = await tx
      .select()
      .from(kiaUserProfiles)
      .where(eq(kiaUserProfiles.email, appUser.email))
      .limit(1)
    const consultantName = profile?.consultantName || appUser.fullName

    const isOwner = before.createdBy === appUser.id ||
                    (before.consultantEmail && before.consultantEmail.toLowerCase() === appUser.email.toLowerCase()) ||
                    (before.consultantName && personNameKey(before.consultantName) === personNameKey(consultantName))

    const mayWritePii = canViewKiaCustomerPii(appUser.role) || isOwner
    if (mayWritePii) {
      if (input.customerPhone !== undefined) updates.customerPhone = text(input.customerPhone)
      if (input.customerEmail !== undefined) updates.customerEmail = nullableText(input.customerEmail)
    }
    if (input.customerAddress !== undefined) updates.customerAddress = nullableText(input.customerAddress)
    if (input.dealerCode !== undefined) updates.dealerCode = normalizeKiaDealerCode(input.dealerCode) || text(input.dealerCode).toUpperCase()
    if (input.model !== undefined) updates.model = text(input.model).toUpperCase()
    if (input.variant !== undefined) updates.variant = text(input.variant)
    if (input.color !== undefined) updates.color = nullableText(input.color)
    if (input.fuelType !== undefined) updates.fuelType = nullableText(input.fuelType)
    // Reassigning the consultant must actually MOVE the booking to them.
    //
    // A sales_executive only sees bookings where `created_by = them OR consultant_email = them`
    // (see the viewer filter in listFilters). consultant_name plays no part. So changing only the
    // name — which is all this did — renamed the label while the booking stayed invisible to the
    // person it was just handed to, and visible to whoever happened to create it. Re-stamping the
    // email is what makes "assign to X" mean it.
    if (input.consultantName !== undefined) {
      const nextName = text(input.consultantName)
      updates.consultantName = nextName
      const resolved = await resolveUserByPersonName(tx, nextName)
      // Only when it resolves to exactly one user. An unmatched or ambiguous name leaves the
      // existing email alone rather than silently stripping the current owner's access.
      if (resolved) updates.consultantEmail = resolved.email
    }
    if (input.source !== undefined) updates.source = nullableText(input.source)
    if (input.financeRequired !== undefined) updates.financeRequired = Boolean(input.financeRequired)
    if (input.bankName !== undefined) updates.bankName = input.bankName ? normalizeBankName(input.bankName) : null
    if (input.loanAmount !== undefined) updates.loanAmount = numericText(input.loanAmount)
    if (input.notes !== undefined) updates.notes = nullableText(input.notes)
    if (input.idtRemark !== undefined) updates.idtRemark = nullableText(input.idtRemark)
    // Merge (not replace) metadata so edits to extra fields (PAN/Aadhaar, exchange, document URLs)
    // persist without clobbering existing keys like costSheet / accountsVerification.
    // The PII keys are stripped from the INCOMING side for a viewer who cannot see PII (same rule as
    // customerPhone/customerEmail above): they were served a redacted metadata, so letting their save
    // through this shallow merge would write "••••••" over the real PAN/Aadhaar and null the document
    // URLs. Stripping means the merge falls through to `before.metadata` and the originals survive.
    if (input.metadata !== undefined) {
      let incoming = mayWritePii ? (input.metadata || {}) : stripKiaBookingPiiKeys(input.metadata || {})
      if (String(appUser.role || '').trim().toLowerCase() === 'sales_executive' && (before.metadata as Record<string, unknown> | null)?.bookingDate) {
        incoming = { ...incoming, bookingDate: (before.metadata as Record<string, unknown>).bookingDate }
      }
      updates.metadata = { ...(before.metadata || {}), ...incoming } as JsonRecord
    }
    if (input.deliveryTargetDate !== undefined) updates.deliveryTargetDate = input.deliveryTargetDate ? input.deliveryTargetDate : null
    if (input.status !== undefined) updates.status = normalizeStatus(input.status)
    if (input.delivered) {
      // Delivery is the Sales Executive's final step (after Accounts verification).
      if (!canDeliverKiaBooking(appUser.role)) {
        throw new Error('Only the CRM can mark the vehicle delivered.')
      }
      if (before.status !== 'ready_delivery') {
        throw new Error('Delivery is available only after Accounts completes verification.')
      }
      updates.status = 'delivered'
      updates.deliveredAt = new Date()
    }

    const [booking] = await tx.update(kiaBookings).set(updates).where(eq(kiaBookings.id, id)).returning()
    await addActivity(tx, {
      bookingId: id,
      type: input.delivered ? 'delivered' : 'updated',
      title: input.delivered ? 'Vehicle delivered' : 'Booking updated',
      before: before as unknown as JsonRecord,
      after: booking as unknown as JsonRecord,
      appUser,
    })

    // The customer journey ends here: close the follow-up loop so nobody calls a customer whose car
    // has already been handed over, and no reminder email goes out. In the same transaction as the
    // delivery, so it can't half-apply. The pipeline query also filters delivered bookings out —
    // this is what stops the reminder emails, which read the table directly.
    if (input.delivered) {
      await cancelKiaBookingFollowups(tx, id, 'vehicle delivered')
      // …and the FINANCE journey begins: the payout ledger tracks bank/dealer payouts AFTER
      // delivery. This only CREATES a finance record from the booking — it never reads back into
      // booking state, so the payout ledger can never affect a booking's status.
      await createFinancePayoutForDeliveredBooking(tx, booking, appUser)
    }

    return booking
  })
}

/**
 * Opens a Finance Payouts ledger row for a freshly delivered booking, snapshotting what finance
 * needs so nobody re-keys data that already exists.
 *
 * SNAPSHOT, not a live join: a finance ledger records the state AS AT DELIVERY, and later edits to
 * the booking must not silently rewrite finance history. (The imported legacy rows have no booking
 * at all, which is the other reason the payout table owns these columns.)
 *
 * Idempotent via the partial unique index on booking_id — re-delivering, or any retry, updates the
 * snapshot rather than creating a second row. Runs on the delivery `tx` so it rolls back with it.
 */
export async function createFinancePayoutForDeliveredBooking(tx: DbTx, booking: typeof kiaBookings.$inferSelect, appUser: AppUser) {
  const meta = (booking.metadata || {}) as JsonRecord
  const snapshot = {
    bookingId: booking.id,
    source: 'delivery' as const,
    deliveryDate: booking.deliveredAt ?? new Date(),
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    model: [booking.model, booking.variant].filter(Boolean).join(' ') || booking.model,
    salesExecutive: booking.consultantName,
    dealerCode: booking.dealerCode,
    tlName: nullableText(meta.tlName),
    // The booking's finance bank IS the hypothecation for the RC — finance re-confirms it later
    // against the actual RC in `hyp_as_per_rc`.
    hyp: booking.bankName,
    loanAmount: booking.loanAmount,
    panNumber: nullableText(meta.panNumber ?? meta.pan),
    // A cash booking has no payout to chase; anything financed starts life pending.
    payoutReceiptStatus: booking.financeRequired ? 'pending' : 'no_payout',
    payoutStatus: booking.financeRequired ? null : 'cash',
    createdBy: appUser.id,
    updatedBy: appUser.id,
  }

  await tx.insert(kiaFinancePayouts).values(snapshot).onConflictDoUpdate({
    target: kiaFinancePayouts.bookingId,
    // targetWhere is REQUIRED, not decorative: the unique index on booking_id is PARTIAL
    // (WHERE booking_id IS NOT NULL, so legacy imports with no booking don't collide), and Postgres
    // will only match a partial index if ON CONFLICT repeats its predicate. Without this the
    // statement raises "no unique or exclusion constraint matching the ON CONFLICT specification"
    // — which would make marking ANY booking delivered throw.
    targetWhere: sql`${kiaFinancePayouts.bookingId} IS NOT NULL`,
    // Refresh the snapshot only. Deliberately does NOT touch the finance-entered columns — a
    // re-delivery must never wipe a payout amount someone already recorded.
    set: {
      deliveryDate: snapshot.deliveryDate,
      customerName: snapshot.customerName,
      customerPhone: snapshot.customerPhone,
      model: snapshot.model,
      salesExecutive: snapshot.salesExecutive,
      dealerCode: snapshot.dealerCode,
      tlName: snapshot.tlName,
      hyp: snapshot.hyp,
      loanAmount: snapshot.loanAmount,
      panNumber: snapshot.panNumber,
      updatedBy: appUser.id,
      updatedAt: new Date(),
    },
  })
}

export async function generateKiaBookingProforma(id: string, appUser: AppUser) {
  return db.transaction(async (tx) => {
    /*
     * FOR UPDATE is load-bearing, not defensive noise.
     *
     * The idempotency below (`if (booking.proformaId) return booking`) is what stops a second
     * proforma being generated for the same booking. But Postgres runs at READ COMMITTED here, so
     * without a row lock two concurrent calls BOTH read proforma_id as null, both insert, and the
     * second UPDATE silently overwrites the first proforma's id on the booking — leaving an orphan
     * proforma in the approval chain that no booking points at.
     *
     * Locking the booking row serialises the pair: the second caller blocks until the first commits,
     * then reads the now-populated proforma_id and returns without inserting. This is the atomic
     * version of the check that was already intended here.
     */
    const [booking] = await tx.select().from(kiaBookings)
      .where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt)))
      .limit(1)
      .for('update')
    if (!booking) throw new Error('Booking not found')
    if (booking.proformaId) return booking

    const priceDetails = await tx
      .select()
      .from(kiaPriceDetails)
      .where(and(eq(kiaPriceDetails.model, booking.model), eq(kiaPriceDetails.trimDescription, booking.variant)))
      .limit(1)
      .then((rows) => rows[0] || null)

    const isCash = (booking.bankName || '').toUpperCase() === 'CASH'
    const registration = priceDetails
      ? isCash
        ? Number(priceDetails.registrationCharges)
        : Number(priceDetails.registrationCharges) + Number(priceDetails.statutoryCharges)
      : 0

    const exShowroom = priceDetails ? Number(priceDetails.exShowroomPrice) : 0
    const tcsValue = priceDetails ? Number(priceDetails.tcs) : 0
    const insuranceValue = priceDetails ? Number(priceDetails.insurance) : 0
    const fastagValue = priceDetails ? Number(priceDetails.fastag) : 0
    const accessoriesKit = priceDetails ? Number(priceDetails.accessoriesKit) : 0
    const extWarranty = priceDetails ? Number(priceDetails.extendedWarranty4thYear) : 0
    const insuranceCompany = priceDetails ? priceDetails.insuranceCompany || '' : ''

    const meta = (booking.metadata || {}) as Record<string, unknown>
    const bookingAmountVal = String(meta.bookingAmount || '0')

    const totalCustomerCost = exShowroom + tcsValue + registration + insuranceValue + fastagValue + accessoriesKit + extWarranty
    const grandTotalCost = totalCustomerCost - Number(bookingAmountVal)

    const [proforma] = await tx.insert(kiaProformas).values({
      proformaDate: new Date(),
      customerType: String(meta.customerType || 'Individual'),
      customerName: booking.customerName,
      mobileNumber: booking.customerPhone,
      customerAddress: booking.customerAddress || 'Pending',
      customerEmail: booking.customerEmail || `${booking.bookingNumber.toLowerCase()}@example.invalid`,
      modelName: booking.model,
      trimDescription: booking.variant,
      fuelType: booking.fuelType || 'Pending',
      vehicleColor: booking.color || 'Pending',
      bankName: booking.bankName || 'Pending',
      vehicleStatus: booking.allocatedVin ? 'Allocated' : 'Pending',
      loanAmount: booking.loanAmount || '0',
      insuranceCompany: insuranceCompany,
      exShowroom: exShowroom.toFixed(2),
      tcsValue: tcsValue.toFixed(2),
      registrationCharges: registration.toFixed(2),
      insuranceValue: insuranceValue.toFixed(2),
      fastagValue: fastagValue.toFixed(2),
      accessoriesKit: accessoriesKit.toFixed(2),
      extWarranty: extWarranty.toFixed(2),
      totalCustomerCost: totalCustomerCost.toFixed(2),
      grandTotalCost: grandTotalCost.toFixed(2),
      loginEmail: appUser.email,
      consultant: booking.consultantName,
      location: booking.dealerCode,
      empCode: '',
      approvalStatus: 'PENDING',
      financeStatus: booking.financeRequired ? 'Pending' : 'Not Required',
      createdBy: appUser.id,
    }).returning()

    const [updated] = await tx.update(kiaBookings).set({
      proformaId: proforma.id,
      status: 'proforma_generated',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'proforma',
      title: 'Proforma generated',
      description: `Linked proforma ${proforma.id}`,
      after: { proformaId: proforma.id },
      appUser,
    })

    return updated
  })
}

async function readMatchingVehicle(vinNumber: string) {
  // Availability MUST use the exact same source + rule as the stock list, the
  // "N BOOKINGS MATCH" badge and check-stock: a row in kia_stock_management with
  // no active (unreleased) allocation is allottable — regardless of the raw DMS
  // stock_status text. Previously this read kia_stock_report and only accepted
  // 'free stock'/'in transit', so vehicles that showed a badge + Allot button
  // failed with "Vehicle is not available for allocation". Same logic → no gap.
  const vin = String(vinNumber).toUpperCase()
  const result = await analyticsDb.execute(sql`
    SELECT
      sm.vin_number,
      sm.order_dealer AS dealer_code,
      sm.model,
      sm.variant,
      sm.exterior_color_name AS color,
      sm.engine_no,
      sm.stock_status,
      to_jsonb(sm) AS snapshot,
      'dms'::text AS source
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va
      ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
    WHERE upper(sm.vin_number) = ${vin}
      AND va.id IS NULL
      -- Not matchable if retailed or on hold (#12).
      AND coalesce(ls.local_status, '') NOT IN ('retail', 'hold_customer', 'hold_dealer')
      -- ...nor if WE already delivered it. The two tests above both miss that case: the allocation
      -- is released at handover and local_status is only written on one of several delivery paths.
      AND NOT ${sql.raw(kiaDeliveredByUsSql('sm'))}
    ORDER BY sm.id DESC
    LIMIT 1
  `)
  const dmsRow = rows(result)[0]
  if (dmsRow) return dmsRow

  // #8 BBND fallback — a Booked-But-Not-in-DMS vehicle registered in kia_stock_local_statuses. Lets a
  // booking be allotted a VIN that isn't in the DMS feed; the snapshot makes it survive like an allotment.
  const bbnd = await analyticsDb.execute(sql`
    SELECT
      ls.vin_number,
      ls.dealer_code,
      ls.model,
      ls.variant,
      ls.color,
      ls.engine_no,
      coalesce(ls.stock_status_at_mark, 'BBND') AS stock_status,
      ls.vehicle_snapshot AS snapshot,
      'bbnd'::text AS source
    FROM kia_stock_local_statuses ls
    LEFT JOIN kia_vehicle_allocations va
      ON va.vin_number = ls.vin_number AND va.released_at IS NULL
    WHERE upper(ls.vin_number) = ${vin}
      AND ls.local_status = 'bbnd'
      AND va.id IS NULL
    LIMIT 1
  `)
  return rows(bbnd)[0] || null
}

export async function getKiaBookingMatchingVehicles(id: string) {
  // READ-ONLY: the expiry sweep that freed lapsed VINs for matching now runs on the scheduled
  // maintenance job (POST /api/brands/kia/maintenance), not on this read.
  const [booking] = await db.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
  if (!booking) throw new Error('Booking not found')

  const bookingColor = text(booking.color || (booking.metadata as Record<string, unknown> | null)?.color)
  const modelPattern = `%${booking.model}%`
  const variantPattern = `%${booking.variant}%`
  const colorPattern = `%${bookingColor}%`

  return rows(await analyticsDb.execute(sql`
    WITH active_allocations AS (
      SELECT vin_number
      FROM kia_vehicle_allocations
      WHERE released_at IS NULL
        AND (payment_confirmed_at IS NOT NULL OR expires_at IS NULL OR expires_at > now())
    ),
    dms AS (
      SELECT DISTINCT ON (sm.vin_number)
        sm.vin_number,
        sm.order_dealer AS dealer_code,
        sm.model,
        sm.variant,
        sm.exterior_color_name AS color,
        sm.engine_no,
        sm.stock_status,
        sm.stock_location,
        sm.uploaded_at,
        -- stock_age is TEXT in the DMS feed; strip non-digits before casting or one stray
        -- character aborts the whole query.
        COALESCE(NULLIF(regexp_replace(COALESCE(sm.stock_age, ''), '[^0-9]', '', 'g'), ''), '0')::int AS age_days,
        to_jsonb(sm) AS snapshot,
        'dms'::text AS source
      FROM kia_stock_management sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      -- Same allowlist the badge/KPI predicate uses (KIA_ALLOTTABLE_STOCK_STATUSES). Keeping these
      -- two in step is the whole point: a car the badge calls available must be offerable here.
      WHERE lower(trim(coalesce(sm.stock_status::text, ''))) IN ${sql`(${sql.join(
        KIA_ALLOTTABLE_STOCK_STATUSES.map((v) => sql`${v}`), sql`, `)})`}
        AND coalesce(ls.local_status, '') NOT IN ('retail', 'hold_customer', 'hold_dealer')
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = sm.vin_number)
        -- ...and not a car we have already handed over. active_allocations cannot see those (the
        -- allocation is released at handover) and local_status is only written on one delivery path,
        -- so without this a delivered vehicle is offered as a match for the next customer.
        AND NOT ${sql.raw(kiaDeliveredByUsSql('sm'))}
        AND (sm.model ILIKE ${modelPattern} OR ${text(booking.model)} ILIKE '%' || sm.model || '%')
        AND coalesce(sm.variant, '') <> ''
        AND coalesce(${text(booking.variant)}, '') <> ''
        AND (
          sm.variant ILIKE ${variantPattern}
          OR ${text(booking.variant)} ILIKE '%' || sm.variant || '%'
        )
        AND coalesce(sm.exterior_color_name, '') <> ''
        AND coalesce(${text(bookingColor)}, '') <> ''
        AND (
          sm.exterior_color_name ILIKE ${colorPattern}
          OR ${text(bookingColor)} ILIKE '%' || sm.exterior_color_name || '%'
        )
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    ),
    bbnd AS (
      SELECT
        ls.vin_number,
        ls.dealer_code,
        ls.model,
        ls.variant,
        ls.color,
        ls.engine_no,
        coalesce(ls.stock_status_at_mark, 'BBND') AS stock_status,
        ls.stock_location,
        ls.source_uploaded_at AS uploaded_at,
        -- BBND rows carry the original stock row in vehicle_snapshot, so age comes from there.
        COALESCE(NULLIF(regexp_replace(COALESCE(ls.vehicle_snapshot->>'stock_age', ''), '[^0-9]', '', 'g'), ''), '0')::int AS age_days,
        ls.vehicle_snapshot AS snapshot,
        'bbnd'::text AS source
      FROM kia_stock_local_statuses ls
      WHERE ls.local_status = 'bbnd'
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = ls.vin_number)
        AND NOT EXISTS (SELECT 1 FROM dms d WHERE d.vin_number = ls.vin_number)
        AND (ls.model ILIKE ${modelPattern} OR ${text(booking.model)} ILIKE '%' || ls.model || '%')
        AND coalesce(ls.variant, '') <> ''
        AND coalesce(${text(booking.variant)}, '') <> ''
        AND (
          ls.variant ILIKE ${variantPattern}
          OR ${text(booking.variant)} ILIKE '%' || ls.variant || '%'
        )
        AND coalesce(ls.color, '') <> ''
        AND coalesce(${text(bookingColor)}, '') <> ''
        AND (
          ls.color ILIKE ${colorPattern}
          OR ${text(bookingColor)} ILIKE '%' || ls.color || '%'
        )
    )
    SELECT *
    FROM (
      SELECT * FROM dms
      UNION ALL
      SELECT * FROM bbnd
    ) vehicles
    -- #10d: a vehicle that has been transferred (or has a pending transfer) to a branch is only
    -- allocatable from that destination branch. Exclude any vehicle transferred to a dealer OTHER
    -- than this booking's dealer; vehicles transferred TO this dealer (or not transferred) stay.
    WHERE NOT EXISTS (
      SELECT 1 FROM kia_vehicle_transfers vt
      WHERE vt.vin_number = vehicles.vin_number
        AND LOWER(coalesce(vt.transfer_status, '')) IN ('transferred', 'requested')
        AND coalesce(vt.to_dealer_code, '') <> ${text(booking.dealerCode)}
    )
    -- FIFO. This used to order by uploaded_at DESC — NEWEST first — which put the freshest arrival
    -- at the top of the picker and quietly encouraged allotting new stock while older identical
    -- cars aged in the yard. Oldest-first makes the right choice the default one; the exact-variant
    -- match still outranks age so the list stays relevant.
    ORDER BY
      CASE WHEN variant ILIKE ${variantPattern} THEN 0 ELSE 1 END,
      age_days DESC NULLS LAST,
      uploaded_at ASC NULLS LAST
    LIMIT 50
  `))
}

// #1 Guard: the allotted vehicle must be the model AND variant selected on the proforma. Comparison is
// case/punctuation-insensitive (alphanumeric only). Model must match exactly; variant must match with
// either side contained in the other (tolerates DMS vs proforma formatting differences). Empty wanted
// values are not enforced (a proforma with a blank model/variant can't gate).
function alnumKey(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}
function normalizeKiaModel(value: unknown) {
  let str = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  str = str.replace(/^(thenew|allnew|new)/, '')
  str = str.replace(/(petrol|diesel|ev|hev|mhev)$/, '')
  return str.trim()
}
function assertKiaVehicleMatchesBooking(vehicle: JsonRecord, wanted: { model: string; variant: string }) {
  const vehModel = normalizeKiaModel(vehicle.model)
  const wantModel = normalizeKiaModel(wanted.model)
  const vehVariant = alnumKey(vehicle.variant)
  const wantVariant = alnumKey(wanted.variant)

  const modelMatches =
    !wantModel ||
    !vehModel ||
    wantModel === vehModel ||
    vehModel.includes(wantModel) ||
    wantModel.includes(vehModel)

  if (!modelMatches) {
    throw new Error(`This vehicle is a ${text(vehicle.model) || 'different model'} but the booking is for a ${wanted.model}. Only the selected model can be allotted.`)
  }
  if (wantVariant && vehVariant && !(vehVariant.includes(wantVariant) || wantVariant.includes(vehVariant))) {
    throw new Error(`This vehicle's variant (${text(vehicle.variant) || '—'}) does not match the booking variant (${wanted.variant}). Only the selected variant can be allotted.`)
  }
}

/**
 * Allots a VIN to a booking.
 *
 * The payment countdown depends on where the vehicle physically is, per the DMS feed:
 *  - **Free Stock** → the 5-day (7-day CSD) window starts now; booking → 'vehicle_allocated'.
 *  - **In transit** → NO countdown yet (expires_at stays NULL); booking → 'transferring'. The clock
 *    starts when the feed flips the VIN to Free Stock — see startKiaArrivedAllocationCountdowns().
 *    Previously the clock started immediately regardless, so a customer's payment window burned down
 *    while the car was still on a truck.
 *
 * `options.skipRoleGate` is for allotKiaBbndVehicle only, which performs its own (different, wider)
 * role check — booking allotment is IDT-exclusive, BBND allot deliberately is not.
 *
 * `options.extraTime` records an OPTIONAL request for a longer payment window (1–15 days, reason
 * required). It deliberately does NOT change the window applied here — the standard 5-day/7-day still
 * takes effect immediately. The request only becomes real if the MD approves it, which is what
 * lib/kia/payment-window-requests.ts does. Creating it inside this transaction means an allotment
 * can never succeed while its extension request is lost.
 */
export async function allotKiaBookingVehicle(
  id: string,
  vinNumber: string,
  appUser: AppUser,
  options: { skipRoleGate?: boolean; extraTime?: { days: number; reason: string } } = {},
) {
  if (!options.skipRoleGate && !canAllotKiaVehicleToBooking(appUser.role)) {
    throw new Error('Only the IDT can allot vehicles to a booking.')
  }
  const normalizedVin = text(vinNumber).toUpperCase()
  if (!normalizedVin) throw new Error('VIN is required')

  const vehicle = await readMatchingVehicle(normalizedVin)
  if (!vehicle) throw new Error('Vehicle is not available for allocation')

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')

    if (['draft', 'booking_created', 'cancelled'].includes(booking.status)) {
      throw new Error('A vehicle cannot be allotted to a booking without a generated proforma.')
    }

    // #1 Strict model + variant lock: only a vehicle whose model AND variant match the one selected on
    // the booking may be allotted.
    assertKiaVehicleMatchesBooking(vehicle, { model: text(booking.model), variant: text(booking.variant) })

    const [activeVin] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.vinNumber, normalizedVin), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (activeVin) throw new Error('This VIN is already allocated to another active booking')

    const [activeBooking] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (activeBooking) throw new Error('This booking already has an active VIN allocation')

    // The vehicle is still on its way — hold the allocation but don't start the payment clock.
    // expires_at NULL is already understood by both consumers: the expiry sweep skips it
    // (`expires_at IS NOT NULL`), and the availability CTE still counts it as an active allocation,
    // so the VIN stays reserved for this booking rather than leaking back into the matchable list.
    const inTransit = dmsStockStatus(vehicle.stock_status) === DMS_IN_TRANSIT

    // The policy window for this booking, recorded on the row rather than left implicit. The
    // arrival sweep and any MD-approved extension both read it, so the 72/120 rule has one home.
    const policyHours = allocationHoursForBooking(booking)

    const [allocation] = await tx.insert(kiaVehicleAllocations).values({
      bookingId: id,
      vinNumber: normalizedVin,
      dealerCode: nullableText(vehicle.dealer_code),
      model: nullableText(vehicle.model),
      variant: nullableText(vehicle.variant),
      color: nullableText(vehicle.color),
      engineNo: nullableText(vehicle.engine_no),
      stockSource: text(vehicle.source) || 'dms',
      vehicleSnapshot: (vehicle.snapshot || {}) as JsonRecord,
      allocationStatus: inTransit ? 'transferring' : 'temporary',
      expiresAt: inTransit ? null : new Date(Date.now() + policyHours * 60 * 60 * 1000),
      paymentWindowHours: policyHours,
      /*
       * A customer who is ALREADY past the secured threshold stays secured on the new car.
       *
       * Below the threshold a lapsed reservation returns the vehicle to free stock while the money
       * stays on the booking, so the customer can be re-allotted later with a large balance already
       * paid. Without this the fresh allocation row would start at NULL and hand them a brand-new
       * 5-day countdown on money they paid weeks ago - and the sweep could take the second car too.
       */
      paymentSecuredAt: Number(booking.amountReceived) > KIA_PAYMENT_SECURED_THRESHOLD ? new Date() : null,
      allocatedBy: appUser.id,
    }).returning()

    const [updated] = await tx.update(kiaBookings).set({
      allocatedVin: normalizedVin,
      status: inTransit ? 'transferring' : 'vehicle_allocated',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'allocation',
      title: inTransit ? 'VIN allocated — vehicle in transit' : 'VIN allocated',
      description: inTransit
        ? `${normalizedVin} — in transit; the payment window starts when it reaches Free Stock`
        : normalizedVin,
      after: allocation as unknown as JsonRecord,
      appUser,
    })

    // Optional extra-time request. Imported lazily to keep the module graph one-directional —
    // payment-window-requests.ts imports from this file, so a top-level import here would be a
    // cycle.
    if (options.extraTime) {
      const { createPaymentWindowRequest } = await import('@/lib/kia/payment-window-requests')
      await createPaymentWindowRequest(tx, {
        bookingId: id,
        allocationId: allocation.id,
        vinNumber: normalizedVin,
        requestedDays: options.extraTime.days,
        baseHours: policyHours,
        reason: options.extraTime.reason,
        appUser,
      })
      await addActivity(tx, {
        bookingId: id,
        type: 'extra_time_requested',
        title: `Extra payment time requested — ${options.extraTime.days} day${options.extraTime.days === 1 ? '' : 's'}`,
        description: `Standard window of ${policyHours}h applied for now; awaiting MD approval. Reason: ${options.extraTime.reason.trim()}`,
        after: { requestedDays: options.extraTime.days, baseHours: policyHours },
        appUser,
      })
    }

    return updated
  })
}

export async function releaseKiaBookingVehicle(id: string, reason: string | null, appUser: AppUser) {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    const [allocation] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (!allocation) throw new Error('No active allocation found')

    const [released] = await tx.update(kiaVehicleAllocations).set({
      releasedAt: new Date(),
      releasedBy: appUser.id,
      releaseReason: nullableText(reason),
      updatedAt: new Date(),
    }).where(eq(kiaVehicleAllocations.id, allocation.id)).returning()

    const [updated] = await tx.update(kiaBookings).set({
      allocatedVin: null,
      status: booking.proformaId ? 'proforma_generated' : 'booking_created',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'release',
      title: 'VIN released',
      description: reason || allocation.vinNumber,
      after: released as unknown as JsonRecord,
      appUser,
    })
    return updated
  })
}

// Put a booking on hold — pauses its workflow at whatever stage it is in. The pre-hold status is
// remembered in metadata so Resume can restore it. Allotment/transfer rows are left untouched (a
// held booking keeps its VIN); only the workflow status changes.
export async function holdKiaBookingVehicle(id: string, reason: string | null, appUser: AppUser) {
  const cleanReason = text(reason).trim()
  if (!cleanReason) {
    throw new Error('Mandatory hold remarks are required. Please provide a reason for putting this booking on hold.')
  }

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (booking.status === 'on_hold') throw new Error('Booking is already on hold')
    if (booking.status === 'delivered' || booking.status === 'cancelled') {
      throw new Error(`A ${booking.status} booking cannot be put on hold`)
    }
    const meta = (booking.metadata as Record<string, unknown> | null) || {}
    const [updated] = await tx.update(kiaBookings).set({
      status: 'on_hold',
      metadata: { ...meta, heldFromStatus: booking.status, heldReason: cleanReason },
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'hold',
      title: 'Booking put on hold',
      description: cleanReason,
      appUser,
    })
    return updated
  })
}

// Resume a held booking back to the stage it was at (or the natural stage for its progress). If a VIN
// is still actively allocated, resume straight to 'vehicle_allocated'.
export async function resumeKiaBookingVehicle(id: string, appUser: AppUser) {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'on_hold') throw new Error('Booking is not on hold')

    const meta = (booking.metadata as Record<string, unknown> | null) || {}
    const [activeAlloc] = await tx
      .select({ id: kiaVehicleAllocations.id })
      .from(kiaVehicleAllocations)
      .where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt)))
      .limit(1)
    const remembered = typeof meta.heldFromStatus === 'string' && meta.heldFromStatus ? normalizeStatus(meta.heldFromStatus) : null
    const fallback: KiaBookingStatus = booking.proformaId ? 'proforma_generated' : 'booking_created'
    const resumeStatus: KiaBookingStatus = activeAlloc ? 'vehicle_allocated' : (remembered ?? fallback)

    const nextMeta = { ...meta }
    delete nextMeta.heldFromStatus
    delete nextMeta.heldReason

    const [updated] = await tx.update(kiaBookings).set({
      status: resumeStatus,
      metadata: nextMeta,
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'resume',
      title: 'Booking resumed from hold',
      description: `Resumed to ${resumeStatus.replace(/_/g, ' ')}`,
      appUser,
    })
    return updated
  })
}

// Read the latest DMS row for a VIN (for a hold snapshot). Held vehicles are in the DMS feed; the
// snapshot is what keeps them visible if the VIN later drops out.
async function readStockVehicleRow(vin: string) {
  const res = await analyticsDb.execute(sql`
    SELECT sm.vin_number, sm.order_dealer AS dealer_code, sm.model, sm.variant,
           sm.exterior_color_name AS color, sm.engine_no, to_jsonb(sm) AS snapshot
    FROM kia_stock_management sm
    WHERE upper(trim(sm.vin_number)) = ${vin}
    ORDER BY sm.uploaded_at DESC NULLS LAST, sm.id DESC
    LIMIT 1
  `)
  return rows<{ vin_number: string; dealer_code: string | null; model: string | null; variant: string | null; color: string | null; engine_no: string | null; snapshot: JsonRecord }>(res)[0] || null
}

// #12 The hold reservation window: a dealer hold auto-releases back to stock after this many hours
// unless payment is recorded within it (exactly like an unpaid temporary allocation).
export const KIA_HOLD_WINDOW_HOURS = 48

// #12 Put a stock vehicle on HOLD for a dealer. Modelled in kia_stock_local_statuses (local_status
// 'hold_dealer') with a vehicle_snapshot so the hold survives the VIN leaving DMS. A held VIN is
// excluded from the matchable list + allot validator, so no one else can allot it. The hold expires
// KIA_HOLD_WINDOW_HOURS after marked_at UNLESS payment is recorded (stock_status_at_mark = 'PAID') —
// see expireKiaStockHolds / markKiaStockHoldPaymentReceived. (Customer holds were removed by request.)
export async function holdKiaStockVehicle(
  vinNumber: string,
  opts: { notes?: string | null },
  appUser: AppUser,
) {
  if (!canAllotKiaVehicle(appUser.role)) throw new Error('You are not allowed to hold stock vehicles.')
  const vin = text(vinNumber).toUpperCase()
  if (!vin) throw new Error('VIN is required')

  const [activeVin] = await db.select({ id: kiaVehicleAllocations.id }).from(kiaVehicleAllocations)
    .where(and(eq(kiaVehicleAllocations.vinNumber, vin), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
  if (activeVin) throw new Error('This VIN is already allocated to an active booking and cannot be held.')

  const [existing] = await db.select({ localStatus: kiaStockLocalStatuses.localStatus }).from(kiaStockLocalStatuses)
    .where(eq(kiaStockLocalStatuses.vinNumber, vin)).limit(1)
  if (existing?.localStatus === 'retail') throw new Error('This vehicle is already retailed and cannot be held.')

  const vehicle = await readStockVehicleRow(vin)
  const base = {
    localStatus: 'hold_dealer',
    dealerCode: nullableText(vehicle?.dealer_code),
    model: nullableText(vehicle?.model),
    variant: nullableText(vehicle?.variant),
    color: nullableText(vehicle?.color),
    engineNo: nullableText(vehicle?.engine_no),
    vehicleSnapshot: (vehicle?.snapshot || {}) as JsonRecord,
    notes: nullableText(opts.notes),
    // A fresh hold is unpaid — clear any prior PAID marker so the 48h window restarts.
    stockStatusAtMark: null,
    markedBy: appUser.id,
    markedByName: appUser.fullName,
    markedByRole: appUser.role,
    updatedAt: new Date(),
  }
  await db.insert(kiaStockLocalStatuses).values({ vinNumber: vin, ...base, markedAt: new Date() }).onConflictDoUpdate({
    target: kiaStockLocalStatuses.vinNumber,
    // markedAt is the hold-start clock — reset it on a new hold so the 48h window restarts.
    set: { ...base, markedAt: new Date() },
  })
  return { vinNumber: vin, holdFor: 'dealer' }
}

/**
 * Mark a free-stock vehicle BBND — "Build But Not Delivered".
 *
 * ⚠️ The status literal is `bbnd_marked`, NOT `bbnd`. `bbnd` is already taken by a DIFFERENT
 * concept: a Booked-But-Not-in-DMS VIN typed in by hand so it can be allotted before the DMS feed
 * catches up (see allotKiaBbndVehicle and the `bbnd` arms of the matching-vehicle queries). Reusing
 * that literal would make hand-entered VINs and BBND-marked stock indistinguishable.
 *
 * The vehicle DELIBERATELY STAYS IN FREE STOCK (owner decision). That falls out of the free-stock
 * filter in app/api/brands/kia/proforma/stock/route.ts, which excludes only
 * ('hold_customer', 'hold_dealer', 'retail') — `bbnd_marked` is absent from that list, so the row
 * keeps showing and stays allottable. Consequently BBND needs NO expiry or release clock: it is a
 * label, not a reservation.
 *
 * ⚠️ kia_stock_local_statuses is ONE ROW PER VIN, so writing here would clobber a hold. The guard
 * below refuses on any hold/retail state rather than silently releasing it.
 *
 * Remarks are MANDATORY — the whole point is recording WHY the car is built but undelivered.
 */
export async function markKiaStockBbnd(
  vinNumber: string,
  opts: { notes?: string | null },
  appUser: AppUser,
) {
  if (!canAllotKiaVehicle(appUser.role)) throw new Error('You are not allowed to mark vehicles BBND.')
  const vin = text(vinNumber).toUpperCase()
  if (!vin) throw new Error('VIN is required')
  const notes = text(opts.notes ?? '')
  if (!notes) throw new Error('Remarks are required to mark a vehicle BBND.')

  const [activeVin] = await db.select({ id: kiaVehicleAllocations.id }).from(kiaVehicleAllocations)
    .where(and(eq(kiaVehicleAllocations.vinNumber, vin), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
  if (activeVin) throw new Error('This VIN is allocated to an active booking and cannot be marked BBND.')

  const [existing] = await db.select({ localStatus: kiaStockLocalStatuses.localStatus }).from(kiaStockLocalStatuses)
    .where(eq(kiaStockLocalStatuses.vinNumber, vin)).limit(1)
  const blocking = text(existing?.localStatus ?? '')
  if (blocking === 'retail') throw new Error('This vehicle is already retailed and cannot be marked BBND.')
  if (blocking === 'hold_dealer' || blocking === 'hold_customer') {
    throw new Error('This vehicle is on hold. Release the hold before marking it BBND.')
  }

  const vehicle = await readStockVehicleRow(vin)
  const base = {
    localStatus: 'bbnd_marked',
    dealerCode: nullableText(vehicle?.dealer_code),
    model: nullableText(vehicle?.model),
    variant: nullableText(vehicle?.variant),
    color: nullableText(vehicle?.color),
    engineNo: nullableText(vehicle?.engine_no),
    vehicleSnapshot: (vehicle?.snapshot || {}) as JsonRecord,
    notes,
    stockStatusAtMark: null,
    markedBy: appUser.id,
    markedByName: appUser.fullName,
    markedByRole: appUser.role,
    updatedAt: new Date(),
  }
  await db.insert(kiaStockLocalStatuses).values({ vinNumber: vin, ...base, markedAt: new Date() }).onConflictDoUpdate({
    target: kiaStockLocalStatuses.vinNumber,
    set: { ...base, markedAt: new Date() },
  })
  return { vinNumber: vin, localStatus: 'bbnd_marked' }
}

/** Clear a BBND marker. Refuses on any other status so it can never delete a hold. */
export async function clearKiaStockBbnd(vinNumber: string, appUser: AppUser) {
  if (!canAllotKiaVehicle(appUser.role)) throw new Error('You are not allowed to clear BBND.')
  const vin = text(vinNumber).toUpperCase()
  if (!vin) throw new Error('VIN is required')
  const [existing] = await db.select({ localStatus: kiaStockLocalStatuses.localStatus }).from(kiaStockLocalStatuses)
    .where(eq(kiaStockLocalStatuses.vinNumber, vin)).limit(1)
  if (!existing) return { vinNumber: vin, cleared: false }
  const currentStatus = text(existing.localStatus)
  if (currentStatus !== 'bbnd_marked' && currentStatus !== 'bbnd') throw new Error('This vehicle is not marked BBND.')
  await db.delete(kiaStockLocalStatuses).where(eq(kiaStockLocalStatuses.vinNumber, vin))
  return { vinNumber: vin, cleared: true }
}

// Release a dealer hold — deletes the local-status row so the VIN becomes matchable again.
export async function releaseKiaStockHold(vinNumber: string, appUser: AppUser) {
  if (!canAllotKiaVehicle(appUser.role)) throw new Error('You are not allowed to release holds.')
  const vin = text(vinNumber).toUpperCase()
  if (!vin) throw new Error('VIN is required')
  const [existing] = await db.select({ localStatus: kiaStockLocalStatuses.localStatus }).from(kiaStockLocalStatuses)
    .where(eq(kiaStockLocalStatuses.vinNumber, vin)).limit(1)
  if (!existing || (existing.localStatus !== 'hold_dealer' && existing.localStatus !== 'hold_customer')) {
    throw new Error('This vehicle is not on hold.')
  }
  await db.delete(kiaStockLocalStatuses).where(eq(kiaStockLocalStatuses.vinNumber, vin))
  return { vinNumber: vin, released: true }
}

// #12 Record payment against a held vehicle within the 48h window. Marks stock_status_at_mark='PAID'
// so expireKiaStockHolds keeps it (it no longer auto-releases). The vehicle stays held for the dealer.
export async function markKiaStockHoldPaymentReceived(vinNumber: string, appUser: AppUser) {
  if (!canAllotKiaVehicle(appUser.role)) throw new Error('You are not allowed to update holds.')
  const vin = text(vinNumber).toUpperCase()
  if (!vin) throw new Error('VIN is required')
  const [existing] = await db.select({ localStatus: kiaStockLocalStatuses.localStatus }).from(kiaStockLocalStatuses)
    .where(eq(kiaStockLocalStatuses.vinNumber, vin)).limit(1)
  if (!existing || (existing.localStatus !== 'hold_dealer' && existing.localStatus !== 'hold_customer')) {
    throw new Error('This vehicle is not on hold.')
  }
  await db.update(kiaStockLocalStatuses)
    .set({ stockStatusAtMark: 'PAID', updatedAt: new Date() })
    .where(eq(kiaStockLocalStatuses.vinNumber, vin))
  return { vinNumber: vin, paid: true }
}

// #12 Auto-release holds that were NOT paid within the 48h window — the row is deleted so the VIN
// returns to matchable stock, exactly like an unpaid temporary allocation. 'PAID' holds are kept.
export async function expireKiaStockHolds(): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM kia_stock_local_statuses
    WHERE local_status IN ('hold_dealer', 'hold_customer')
      AND coalesce(stock_status_at_mark, '') <> 'PAID'
      AND marked_at IS NOT NULL
      AND marked_at + make_interval(hours => ${KIA_HOLD_WINDOW_HOURS}) <= now()
    RETURNING vin_number
  `)
  return rows(res).length
}

// #8 Allot a BBND (Booked-But-Not-in-DMS) vehicle: register the manually-entered VIN in
// kia_stock_local_statuses (local_status='bbnd', with a snapshot), then allot it to the booking via
// the normal flow (readMatchingVehicle now has a BBND branch). Persists durably like an allotment.
export async function allotKiaBbndVehicle(
  bookingId: string,
  details: { vinNumber: string; model?: string | null; variant?: string | null; color?: string | null; engineNo?: string | null; dealerCode?: string | null },
  appUser: AppUser,
) {
  if (!canAllotKiaVehicle(appUser.role)) throw new Error('You are not allowed to allot vehicles.')
  const vin = text(details.vinNumber).toUpperCase()
  if (!vin) throw new Error('VIN is required')

  const snapshot: JsonRecord = {
    vin_number: vin,
    model: nullableText(details.model),
    variant: nullableText(details.variant),
    color: nullableText(details.color),
    engine_no: nullableText(details.engineNo),
    dealer_code: nullableText(details.dealerCode),
    source: 'bbnd',
  }
  const base = {
    localStatus: 'bbnd' as const,
    dealerCode: nullableText(details.dealerCode),
    model: nullableText(details.model),
    variant: nullableText(details.variant),
    color: nullableText(details.color),
    engineNo: nullableText(details.engineNo),
    vehicleSnapshot: snapshot,
    markedBy: appUser.id,
    markedByName: appUser.fullName,
    markedByRole: appUser.role,
    updatedAt: new Date(),
  }
  await db.insert(kiaStockLocalStatuses).values({ vinNumber: vin, ...base }).onConflictDoUpdate({
    target: kiaStockLocalStatuses.vinNumber,
    set: base,
  })

  // skipRoleGate: this function already ran its own canAllotKiaVehicle check above. BBND allot keeps
  // the wider "anyone except the Sales Executive" rule by design — only allotting from DMS stock is
  // IDT-exclusive. Without this flag the IDT gate inside allotKiaBookingVehicle would silently
  // narrow BBND allot too.
  return allotKiaBookingVehicle(bookingId, vin, appUser, { skipRoleGate: true })
}

/** Statuses from which Accounts may record or confirm money. Mirrors verifyKiaAccountsPayment. */
const PAYABLE_BOOKING_STATUSES = ['vehicle_allocated', 'transferring', 'transfer_requested', 'payment_confirmed']

/** Rupee amounts arrive from a form as text with separators. One coercion, used by both writers. */
function toPaymentAmount(value: unknown, label: string): number {
  const parsed = Number(String(value ?? '').replace(/[,\s]/g, ''))
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number`)
  if (parsed <= 0) throw new Error(`${label} must be greater than zero`)
  // A cap, not a business rule: it catches a fat-fingered extra zero before it reaches the ledger,
  // where the only remedy is a reversal row that then stays visible forever.
  if (parsed > 100000000) throw new Error(`${label} looks wrong - it exceeds Rs 10 crore`)
  return Math.round(parsed * 100) / 100
}

/**
 * Re-evaluates whether an allocation is SECURED, given the booking's new running total.
 *
 * Called after every ledger write, in both directions:
 *   - crossing above the threshold stamps payment_secured_at, which is what takes the vehicle out of
 *     expireKiaTemporaryAllocations
 *   - a reversal dropping back to or below it clears the stamp and RE-ARMS the clock
 *
 * The clock is re-armed as now() + payment_window_hours, NOT by restoring the old expires_at. A car
 * secured for two weeks would otherwise come back already overdue and be swept within the hour - the
 * customer would lose the vehicle as a direct result of someone correcting a typo.
 */
async function reconcileAllocationSecured(
  tx: DbTx,
  allocation: { id: string; expiresAt: Date | null; paymentWindowHours: number | null; paymentSecuredAt: Date | null },
  booking: { metadata?: unknown },
  totalReceived: number,
) {
  const shouldBeSecured = totalReceived > KIA_PAYMENT_SECURED_THRESHOLD
  if (shouldBeSecured === Boolean(allocation.paymentSecuredAt)) return { changed: false, secured: shouldBeSecured }

  if (shouldBeSecured) {
    await tx.update(kiaVehicleAllocations)
      .set({ paymentSecuredAt: new Date(), updatedAt: new Date() })
      .where(eq(kiaVehicleAllocations.id, allocation.id))
    return { changed: true, secured: true }
  }

  // Un-securing. Only re-arm a clock that was actually running: an in-transit allocation has
  // expires_at NULL by design and must keep it, or the countdown starts while the car is still on a
  // truck - the exact bug allotKiaBookingVehicle's in-transit branch exists to prevent.
  const windowHours = allocation.paymentWindowHours ?? allocationHoursForBooking(booking)
  await tx.update(kiaVehicleAllocations)
    .set({
      paymentSecuredAt: null,
      ...(allocation.expiresAt ? { expiresAt: new Date(Date.now() + windowHours * 60 * 60 * 1000) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(kiaVehicleAllocations.id, allocation.id))
  return { changed: true, secured: false }
}

/**
 * Records ONE part payment against a booking, WITHOUT advancing the workflow.
 *
 * This is the whole point of the feature: the money is recorded, the vehicle STAYS with Accounts, and
 * they keep adding receipts until someone marks the balance received (confirmKiaBookingPayment).
 * The booking status is deliberately never touched here.
 *
 * Crossing KIA_PAYMENT_SECURED_THRESHOLD stops the reservation clock - see reconcileAllocationSecured.
 */
export async function recordKiaBookingPartialPayment(
  id: string,
  input: {
    amount: unknown
    paymentMode?: string | null
    reference?: string | null
    receivedOn?: string | null
    notes?: string | null
  },
  appUser: AppUser,
) {
  if (!canConfirmKiaPayment(appUser.role)) {
    throw new Error('Only Accounts or an admin can record a payment.')
  }
  const amount = toPaymentAmount(input.amount, 'Amount')

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings)
      .where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (!PAYABLE_BOOKING_STATUSES.includes(booking.status)) {
      throw new Error(`This booking is '${booking.status}' - payments can only be recorded while it is awaiting payment.`)
    }

    const [allocation] = await tx.select().from(kiaVehicleAllocations)
      .where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (!allocation) throw new Error('No active allocation found - allot a vehicle before recording payment.')

    // Atomic increment, and the RETURNING is what makes it safe: two simultaneous submissions each
    // read back their own post-increment total, so neither can overwrite the other with a stale sum.
    const [updatedBooking] = await tx.update(kiaBookings)
      .set({ amountReceived: sql`${kiaBookings.amountReceived} + ${amount.toFixed(2)}::numeric`, updatedAt: new Date() })
      .where(eq(kiaBookings.id, id))
      .returning({ amountReceived: kiaBookings.amountReceived })
    const totalAfter = Number(updatedBooking.amountReceived)

    const [entry] = await tx.insert(kiaBookingPayments).values({
      bookingId: id,
      allocationId: allocation.id,
      vinNumber: allocation.vinNumber,
      entryType: 'payment',
      amount: amount.toFixed(2),
      totalAfter: totalAfter.toFixed(2),
      paymentMode: nullableText(input.paymentMode),
      reference: nullableText(input.reference),
      receivedOn: nullableText(input.receivedOn),
      notes: nullableText(input.notes),
      recordedBy: appUser.id,
      recordedByName: appUser.fullName,
    }).returning()

    const secured = await reconcileAllocationSecured(tx, allocation, booking, totalAfter)

    await addActivity(tx, {
      bookingId: id,
      type: 'payment',
      title: 'Part payment recorded',
      description: `Rs ${amount.toLocaleString('en-IN')} received`
        + (input.paymentMode ? ` by ${input.paymentMode}` : '')
        + (input.reference ? ` (ref ${input.reference})` : '')
        + `. Total received so far Rs ${totalAfter.toLocaleString('en-IN')}.`
        + (secured.changed && secured.secured ? ' Payment countdown stopped - the vehicle will no longer be auto-released.' : ''),
      after: { amount, totalAfter, secured: secured.secured } as unknown as JsonRecord,
      appUser,
    })

    return { entry, totalReceived: totalAfter, secured: secured.secured, securedChanged: secured.changed }
  })
}

/**
 * Reverses one previously recorded payment. Append-only: the original row is never edited or deleted,
 * a mirrored negative row is added beside it. That is how a typo stays distinguishable from a genuine
 * refund, which a destructive edit would erase.
 */
export async function reverseKiaBookingPayment(
  id: string,
  input: { paymentId: string; reason?: string | null },
  appUser: AppUser,
) {
  if (!canConfirmKiaPayment(appUser.role)) {
    throw new Error('Only Accounts or an admin can reverse a payment.')
  }

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings)
      .where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')

    const [original] = await tx.select().from(kiaBookingPayments)
      .where(and(eq(kiaBookingPayments.id, input.paymentId), eq(kiaBookingPayments.bookingId, id))).limit(1)
    if (!original) throw new Error('Payment not found on this booking')
    if (original.entryType !== 'payment') throw new Error('Only a payment can be reversed, not a reversal')

    // The DB has a partial unique index on reverses_id, so a double-click loses the race rather than
    // halving the total twice. Checked here too, to fail with a sentence instead of a constraint name.
    const [already] = await tx.select({ id: kiaBookingPayments.id }).from(kiaBookingPayments)
      .where(eq(kiaBookingPayments.reversesId, original.id)).limit(1)
    if (already) throw new Error('That payment has already been reversed')

    const amount = Number(original.amount)
    const [updatedBooking] = await tx.update(kiaBookings)
      .set({ amountReceived: sql`${kiaBookings.amountReceived} - ${amount.toFixed(2)}::numeric`, updatedAt: new Date() })
      .where(eq(kiaBookings.id, id))
      .returning({ amountReceived: kiaBookings.amountReceived })
    const totalAfter = Number(updatedBooking.amountReceived)

    const [entry] = await tx.insert(kiaBookingPayments).values({
      bookingId: id,
      allocationId: original.allocationId,
      vinNumber: original.vinNumber,
      entryType: 'reversal',
      amount: (-amount).toFixed(2),
      reversesId: original.id,
      totalAfter: totalAfter.toFixed(2),
      notes: nullableText(input.reason),
      recordedBy: appUser.id,
      recordedByName: appUser.fullName,
    }).returning()

    // The allocation may have been released since the payment was taken; only reconcile a live one.
    const [allocation] = await tx.select().from(kiaVehicleAllocations)
      .where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    const secured = allocation
      ? await reconcileAllocationSecured(tx, allocation, booking, totalAfter)
      : { changed: false, secured: false }

    await addActivity(tx, {
      bookingId: id,
      type: 'payment',
      title: 'Payment reversed',
      description: `Rs ${amount.toLocaleString('en-IN')} reversed`
        + (input.reason ? `: ${input.reason}` : '')
        + `. Total received now Rs ${totalAfter.toLocaleString('en-IN')}.`
        + (secured.changed && !secured.secured ? ' The payment countdown has restarted.' : ''),
      before: original as unknown as JsonRecord,
      after: { totalAfter, secured: secured.secured } as unknown as JsonRecord,
      appUser,
    })

    return { entry, totalReceived: totalAfter, secured: secured.secured, securedChanged: secured.changed }
  })
}

/** The ledger for one booking, newest first. Read-only. */
export async function getKiaBookingPayments(id: string) {
  return db.select().from(kiaBookingPayments)
    .where(eq(kiaBookingPayments.bookingId, id))
    .orderBy(desc(kiaBookingPayments.createdAt))
    .limit(100)
}

export async function confirmKiaBookingPayment(
  id: string,
  input: {
    reference?: string | null
  },
  appUser: AppUser,
) {
  // Payment confirmation (Stock dashboard "Payment received"): Accounts / admin.
  // This advances the vehicle to Paid · To Deliver; the invoice number / PDF are
  // captured separately in the Accounts verification step in the Bookings CRM.
  if (!canConfirmKiaPayment(appUser.role)) {
    throw new Error('Only Accounts or an admin can confirm payment received.')
  }

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    const [allocation] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (!allocation) throw new Error('No active allocation found')

    // Status precondition, matching verifyKiaAccountsPayment. Without it a booking already in
    // ready_delivery (or on_hold, or finance_pending) could be pushed through again purely because
    // an unreleased allocation row still existed.
    if (!PAYABLE_BOOKING_STATUSES.includes(booking.status)) {
      throw new Error(`This booking is '${booking.status}' - payment can only be confirmed while it is awaiting payment.`)
    }

    const [confirmed] = await tx.update(kiaVehicleAllocations).set({
      allocationStatus: 'final',
      paymentConfirmedAt: new Date(),
      paymentConfirmedBy: appUser.id,
      paymentReference: nullableText(input.reference),
      updatedAt: new Date(),
    }).where(eq(kiaVehicleAllocations.id, allocation.id)).returning()

    if (allocation.vinNumber) {
      await tx.insert(kiaStockLocalStatuses).values({
        vinNumber: allocation.vinNumber,
        localStatus: 'retail',
        dealerCode: allocation.dealerCode,
        model: allocation.model,
        variant: allocation.variant,
        color: allocation.color,
        engineNo: allocation.engineNo,
        stockStatusAtMark: 'Retail after accounts payment confirmation',
        bookingNo: booking.bookingNumber,
        customerName: booking.customerName,
        vehicleSnapshot: (allocation.vehicleSnapshot || {}) as JsonRecord,
        notes: input.reference ? `Payment confirmed: ${input.reference}` : 'Payment confirmed by Accounts',
        markedBy: appUser.id,
        markedByName: appUser.fullName,
        markedByRole: appUser.role,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: kiaStockLocalStatuses.vinNumber,
        set: {
          localStatus: 'retail',
          dealerCode: allocation.dealerCode,
          model: allocation.model,
          variant: allocation.variant,
          color: allocation.color,
          engineNo: allocation.engineNo,
          stockStatusAtMark: 'Retail after accounts payment confirmation',
          bookingNo: booking.bookingNumber,
          customerName: booking.customerName,
          vehicleSnapshot: (allocation.vehicleSnapshot || {}) as JsonRecord,
          notes: input.reference ? `Payment confirmed: ${input.reference}` : 'Payment confirmed by Accounts',
          markedBy: appUser.id,
          markedByName: appUser.fullName,
          markedByRole: appUser.role,
          markedAt: new Date(),
          updatedAt: new Date(),
        },
      })
    }

    const [updated] = await tx.update(kiaBookings).set({
      // Payment confirmed -> vehicle is Paid · To Deliver. Advancing straight to
      // ready_delivery is what makes the stock row leave the "N h to pay" window
      // and show "Paid · To Deliver" (the legacy 'payment_confirmed' status was
      // not recognised by the stock list, so the row appeared stuck as ALLOTTED).
      status: 'ready_delivery',
      metadata: {
        ...((booking.metadata || {}) as JsonRecord),
        paymentConfirmation: {
          reference: nullableText(input.reference),
          confirmedAt: new Date().toISOString(),
          confirmedBy: appUser.fullName,
          confirmedByRole: appUser.role,
        },
      },
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'payment',
      title: 'Payment confirmed',
      description: input.reference ? `Reference: ${input.reference}` : 'Payment confirmed by Accounts',
      after: confirmed as unknown as JsonRecord,
      appUser,
    })

    return updated
  })
}

export async function verifyKiaAccountsPayment(
  id: string,
  input: {
    reference?: string | null
    invoiceNumber?: string | null
    invoiceDocumentUrl?: string | null
    invoiceDocumentPath?: string | null
    invoiceDocumentName?: string | null
    notes?: string | null
  },
  appUser: AppUser,
) {
  // Single ACCOUNTS stage (Finance removed): confirm payment release, record the
  // invoice number + PDF, then advance the booking straight to ready_delivery.
  if (!canVerifyKiaAccounts(appUser.role)) {
    throw new Error('Only the Accounts team can confirm payment and verify documentation.')
  }
  const invoiceNumber = text(input.invoiceNumber).trim()
  if (!invoiceNumber) throw new Error('Invoice number is required.')

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    // 'transferring' is allowed so Accounts can record an EARLY payment — one made while the vehicle
    // is still in transit and its countdown hasn't started. Payment sets payment_confirmed_at +
    // allocation_status='final', which takes the row out of both the arrival sweep and the expiry
    // sweep, so the clock simply never opens. Blocking it would force Accounts to sit on a real
    // payment until the truck arrives.
    if (
      booking.status !== 'vehicle_allocated'
      && booking.status !== 'transferring'
      && booking.status !== 'transfer_requested'
      && booking.status !== 'payment_confirmed'
    ) {
      throw new Error('Payment & invoice verification is available after the vehicle is allotted.')
    }

    const [allocation] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (!allocation) throw new Error('No active allocation found')

    await tx.update(kiaVehicleAllocations).set({
      allocationStatus: 'final',
      paymentConfirmedAt: new Date(),
      paymentConfirmedBy: appUser.id,
      paymentReference: nullableText(input.reference),
      updatedAt: new Date(),
    }).where(eq(kiaVehicleAllocations.id, allocation.id))

    if (allocation.vinNumber) {
      await tx.insert(kiaStockLocalStatuses).values({
        vinNumber: allocation.vinNumber,
        localStatus: 'retail',
        dealerCode: allocation.dealerCode,
        model: allocation.model,
        variant: allocation.variant,
        color: allocation.color,
        engineNo: allocation.engineNo,
        stockStatusAtMark: 'Retail after accounts payment confirmation',
        bookingNo: booking.bookingNumber,
        customerName: booking.customerName,
        vehicleSnapshot: (allocation.vehicleSnapshot || {}) as JsonRecord,
        notes: `Invoice ${invoiceNumber} verified by Accounts`,
        markedBy: appUser.id,
        markedByName: appUser.fullName,
        markedByRole: appUser.role,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: kiaStockLocalStatuses.vinNumber,
        set: {
          localStatus: 'retail',
          dealerCode: allocation.dealerCode,
          model: allocation.model,
          variant: allocation.variant,
          color: allocation.color,
          engineNo: allocation.engineNo,
          stockStatusAtMark: 'Retail after accounts payment confirmation',
          bookingNo: booking.bookingNumber,
          customerName: booking.customerName,
          vehicleSnapshot: (allocation.vehicleSnapshot || {}) as JsonRecord,
          notes: `Invoice ${invoiceNumber} verified by Accounts`,
          markedBy: appUser.id,
          markedByName: appUser.fullName,
          markedByRole: appUser.role,
          markedAt: new Date(),
          updatedAt: new Date(),
        },
      })
    }

    const [updated] = await tx.update(kiaBookings).set({
      // Payment released + invoice recorded -> ready for the Sales Executive to deliver.
      status: 'ready_delivery',
      metadata: {
        ...((booking.metadata || {}) as JsonRecord),
        paymentConfirmation: {
          reference: nullableText(input.reference),
          confirmedAt: new Date().toISOString(),
          confirmedBy: appUser.fullName,
          confirmedByRole: appUser.role,
        },
        accountsVerification: {
          invoiceNumber,
          invoiceDocumentUrl: nullableText(input.invoiceDocumentUrl),
          invoiceDocumentPath: nullableText(input.invoiceDocumentPath),
          invoiceDocumentName: nullableText(input.invoiceDocumentName),
          notes: nullableText(input.notes),
          verifiedAt: new Date().toISOString(),
          verifiedBy: appUser.fullName,
          verifiedByRole: appUser.role,
        },
      },
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    if (!updated) throw new Error('Booking already moved to another stage')

    await addActivity(tx, {
      bookingId: id,
      type: 'accounts',
      title: 'Payment released & invoice verified',
      description: `Invoice ${invoiceNumber} recorded by Accounts`,
      after: updated as unknown as JsonRecord,
      appUser,
    })

    return updated
  })
}

export async function requestKiaVehicleTransfer(
  id: string,
  input: { toDealerCode?: string | null; notes?: string | null; vinNumber?: string | null },
  appUser: AppUser,
) {
  if (!canTransferKiaVehicle(appUser.role)) {
    throw new Error('The Sales Executive cannot request transfers.')
  }
  const normalizedVin = text(input.vinNumber).toUpperCase()
  const vehicle = normalizedVin ? await readMatchingVehicle(normalizedVin) : null

  return db.transaction(async (tx) => {
    const isDirectStockTransfer = !id || id === 'none' || id === 'system' || id === 'undefined' || id === 'null'

    const toDealerCode = normalizeKiaDealerCode(input.toDealerCode) || text(input.toDealerCode).toUpperCase()
    if (!toDealerCode) throw new Error('Target dealer is required')

    if (isDirectStockTransfer) {
      if (!normalizedVin) throw new Error('Pick a VIN before requesting a transfer.')
      if (!vehicle) throw new Error('Vehicle not found for transfer')

      // Insert transfer record. booking_id is nullable at the DB level for
      // direct (booking-less) stock transfers, though the schema types it as
      // required — cast through unknown rather than `any`.
      const [transfer] = await tx.insert(kiaVehicleTransfers).values({
        bookingId: null as unknown as string,
        vinNumber: normalizedVin,
        fromDealerCode: nullableText(vehicle.dealer_code),
        toDealerCode,
        transferStatus: 'Transferred',
        notes: nullableText(input.notes),
        requestedBy: appUser.id,
        // Retention snapshot (#9): keeps the vehicle visible under the destination dealer even if the
        // VIN later leaves the DMS feed. Seed stock_last_seen_at since it is in stock right now.
        vehicleSnapshot: (vehicle.snapshot || {}) as JsonRecord,
        stockLastSeenAt: new Date(),
        metadata: { source: 'direct_stock_transfer' },
      }).returning()

      // NOTE: We intentionally do NOT update order_dealer here. The vehicle is still physically
      // at the source dealer — only a transfer *request* has been recorded. Changing order_dealer
      // would immediately hide the vehicle from the origin dealer's scoped view. The vehicle
      // remains visible in stock (shown as "Transferred → toDealerCode" via the vt join) until
      // the DMS feed reflects the physical move.
      // The full transfer record in kia_vehicle_transfers is the source of truth.

      return { id: transfer.id, toDealerCode, vinNumber: normalizedVin }
    }

    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (!booking.proformaId) throw new Error('Generate the proforma before requesting a transfer.')

    const [proforma] = await tx
      .select({ approvalStatus: kiaProformas.approvalStatus })
      .from(kiaProformas)
      .where(eq(kiaProformas.id, booking.proformaId))
      .limit(1)
    if (text(proforma?.approvalStatus).toUpperCase() !== 'APPROVED') {
      throw new Error('Transfer opens only after Sales Manager / Manager approval.')
    }

    let [allocation] = await tx
      .select()
      .from(kiaVehicleAllocations)
      .where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt)))
      .limit(1)

    if (!allocation) {
      if (!normalizedVin) throw new Error('Pick a VIN before requesting a transfer.')

      const [activeVin] = await tx
        .select()
        .from(kiaVehicleAllocations)
        .where(and(eq(kiaVehicleAllocations.vinNumber, normalizedVin), isNull(kiaVehicleAllocations.releasedAt)))
        .limit(1)
      if (activeVin) throw new Error('This VIN is already allocated to another active booking')

      if (!vehicle) throw new Error('Vehicle is not available for transfer')

      const [createdAllocation] = await tx
        .insert(kiaVehicleAllocations)
        .values({
          bookingId: id,
          vinNumber: normalizedVin,
          dealerCode: nullableText(vehicle.dealer_code),
          model: nullableText(vehicle.model),
          variant: nullableText(vehicle.variant),
          color: nullableText(vehicle.color),
          engineNo: nullableText(vehicle.engine_no),
          stockSource: text(vehicle.source) || 'dms',
          vehicleSnapshot: (vehicle.snapshot || {}) as JsonRecord,
          allocationStatus: 'temporary',
          expiresAt: new Date(Date.now() + allocationHoursForBooking(booking) * 60 * 60 * 1000),
          allocatedBy: appUser.id,
        })
        .returning()

      allocation = createdAllocation

      await tx
        .update(kiaBookings)
        .set({
          allocatedVin: normalizedVin,
          status: 'vehicle_allocated',
          updatedBy: appUser.id,
          updatedAt: new Date(),
        })
        .where(eq(kiaBookings.id, id))

      await addActivity(tx, {
        bookingId: id,
        type: 'allocation',
        title: 'VIN reserved for transfer',
        description: normalizedVin,
        after: createdAllocation as unknown as JsonRecord,
        appUser,
      })
    }

    const [transfer] = await tx.insert(kiaVehicleTransfers).values({
      bookingId: id,
      vinNumber: allocation?.vinNumber || booking.allocatedVin,
      fromDealerCode: allocation?.dealerCode || booking.dealerCode,
      toDealerCode,
      notes: nullableText(input.notes),
      requestedBy: appUser.id,
      // Retention snapshot (#9) — reuse the allocation's snapshot (or the freshly matched vehicle).
      vehicleSnapshot: (allocation?.vehicleSnapshot || vehicle?.snapshot || {}) as JsonRecord,
      stockLastSeenAt: new Date(),
      metadata: {
        source: allocation?.stockSource || 'booking',
        requestedFromStatus: booking.status,
      },
    }).returning()

    const [updated] = await tx.update(kiaBookings).set({
      status: 'transfer_requested',
      allocatedVin: allocation?.vinNumber || booking.allocatedVin,
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'transfer',
      title: 'Transfer requested',
      description: `${allocation?.dealerCode || booking.dealerCode || 'Current outlet'} to ${toDealerCode}`,
      after: transfer as unknown as JsonRecord,
      appUser,
    })
    return updated
  })
}

export async function createKiaBookingFinanceDraft(id: string, appUser: AppUser) {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (booking.financeOrderId) return booking

    const orderNumber = `KIA-FIN-${booking.bookingNumber}`
    const [order] = await tx.insert(financeOrders).values({
      orderNumber,
      currentStage: 'finance_head_submission',
      status: 'draft',
      totalPayoutReceived: '0',
      invoiceNumber: booking.bookingNumber,
      paymentReceivedDate: new Date(),
      dsePayout: '0',
      hypBankName: booking.bankName || 'Pending',
      dseName: booking.consultantName,
      dealer: booking.dealerCode,
      createdBy: appUser.id,
    }).onConflictDoNothing().returning()

    const [existingOrder] = order ? [order] : await tx.select().from(financeOrders).where(eq(financeOrders.orderNumber, orderNumber)).limit(1)

    if (existingOrder) {
      await tx.insert(financeOrderWorkflow).values({
        financeOrderId: existingOrder.id,
        action: 'draft_created',
        stage: 'finance_head_submission',
        performedBy: appUser.id,
        userRole: appUser.role,
        remarks: `Created from booking ${booking.bookingNumber}`,
        newStatus: 'draft',
        metadata: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
      }).onConflictDoNothing()
    }

    const [updated] = await tx.update(kiaBookings).set({
      financeOrderId: existingOrder?.id || null,
      status: 'finance_pending',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'finance',
      title: 'Finance draft created',
      description: existingOrder?.orderNumber || orderNumber,
      after: { financeOrderId: existingOrder?.id || null },
      appUser,
    })

    return updated
  })
}

export async function releaseKiaStockTransfer(vinNumber: string, appUser: AppUser) {
  if (!canAllotKiaVehicle(appUser.role)) {
    throw new Error('You are not allowed to release transfers.')
  }
  const normalizedVin = text(vinNumber).toUpperCase()
  if (!normalizedVin) throw new Error('VIN is required')

  return db.transaction(async (tx) => {
    // 1. Find the active transfer for this VIN (status is Transferred or requested)
    const [activeTransfer] = await tx
      .select()
      .from(kiaVehicleTransfers)
      .where(
        and(
          eq(kiaVehicleTransfers.vinNumber, normalizedVin),
          inArray(kiaVehicleTransfers.transferStatus, ['Transferred', 'requested', 'Transferred', 'requested']) // handle potential case mismatch
        )
      )
      .limit(1)

    if (!activeTransfer) {
      throw new Error('No active transfer found for this VIN.')
    }

    // 2. Update the transfer status to 'Cancelled' (so it's no longer active)
    await tx
      .update(kiaVehicleTransfers)
      .set({
        transferStatus: 'Cancelled',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(kiaVehicleTransfers.id, activeTransfer.id))

    // 3. If there is a booking linked to this transfer, revert its allocation and status
    if (activeTransfer.bookingId) {
      // Find the booking
      const [booking] = await tx
        .select()
        .from(kiaBookings)
        .where(eq(kiaBookings.id, activeTransfer.bookingId))
        .limit(1)

      if (booking) {
        // Release the VIN allocation from this booking
        await tx
          .update(kiaVehicleAllocations)
          .set({
            releasedAt: new Date(),
            releasedBy: appUser.id,
            releaseReason: 'Transfer cancelled/released',
          })
          .where(
            and(
              eq(kiaVehicleAllocations.bookingId, activeTransfer.bookingId),
              eq(kiaVehicleAllocations.vinNumber, normalizedVin),
              isNull(kiaVehicleAllocations.releasedAt)
            )
          )

        // Reset the booking's allocated VIN and revert status to 'proforma_generated'
        await tx
          .update(kiaBookings)
          .set({
            allocatedVin: null,
            status: 'proforma_generated', // Return to waiting allocation
            updatedBy: appUser.id,
            updatedAt: new Date(),
          })
          .where(eq(kiaBookings.id, activeTransfer.bookingId))

        // Log activity
        await addActivity(tx, {
          bookingId: activeTransfer.bookingId,
          type: 'transfer',
          title: 'Transfer cancelled & VIN released',
          description: `Transfer to ${activeTransfer.toDealerCode} was cancelled. VIN ${normalizedVin} is released.`,
          appUser,
        })
      }
    }

    return { vinNumber: normalizedVin, transferId: activeTransfer.id }
  })
}
