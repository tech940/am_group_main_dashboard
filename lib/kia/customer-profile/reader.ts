import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  classifySearchTerm,
  phone10Sql,
  serializeCustomerKey,
  type KiaCustomerKey,
} from './identity'

/**
 * KIA Customer Profile — data reader.
 *
 * ⚠️ EVERY GAP IS COMPUTED OVER LIFETIME HISTORY, NEVER THE FILTERED WINDOW.
 *
 * This is not a style preference. app/api/insurance/vehicles/route.ts:47-51 measured the
 * consequence of getting it wrong: with a year filter applied, ~70% of the vehicles on screen
 * were repeat customers whose earlier history the filter had erased, so "two in three rows
 * would answer *did they come back?* with a false no."
 *
 * Filters therefore select WHICH customers appear. They never enter a gap predicate.
 *
 * ⚠️ Reads go through `db` (drizzle), not `analyticsDb`. They are the same pool today, but
 * lib/analytics/table-map.ts does NOT map the KIA sales tables, so anything built on
 * analyticsDb silently breaks the moment ANALYTICS_READ_SOURCE is set to bigquery.
 */

const DEFAULT_SERVICE_GAP_MONTHS = 12

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? result as Record<string, unknown>[] : []
}

function str(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text ? text : null
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * A money value, or null when we genuinely hold no price.
 *
 * ⚠️ Zero is treated as ABSENT, and that is measured rather than assumed: ro_billing_report.total_amt
 * has ZERO nulls across all 5,711 rows, and the 2,398 visits that were never billed store a literal
 * 0. So an `IS NULL` test never fires, and a naive render shows 2,398 real visits as a confident
 * "Rs 0" — which reads as "we serviced them free" and quietly destroys trust in every other figure
 * on the screen.
 *
 * The conversion happens HERE, once, so no call site downstream has to know the feed's convention.
 *
 * ⚠️ Do NOT reuse this for kia_ew_report.kin_amt: on the "Free 4th & 5th Year" scheme rows a 0 there
 * means genuinely free, the exact opposite convention.
 */
function money(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

/**
 * NVI is the dealership's own new-vehicle inspection before handover, not a customer visit.
 * 964 rows, billed on 0 of them.
 */
function isNvi(workType: string | null): boolean {
  return String(workType || '').trim().toUpperCase() === 'NVI'
}

/**
 * Attach "km since the previous visit" to each workshop row.
 *
 * ── Why the reader does this and not the client ───────────────────────────────────────────────
 * The services array handed to the client is TRUNCATED to 50 rows. A delta computed there would be
 * measured against whatever row happened to survive the cut, so on a heavy vehicle the oldest shown
 * visit would report a gap that silently spans everything trimmed off. Computed here, over the full
 * set, every delta means the same thing.
 *
 * ⚠️ Rows arrive newest-first; deltas are only meaningful oldest-first, so this sorts a copy and
 * writes the answer back onto the original rows.
 *
 * ⚠️ NULL, never 0, when either end has no reading. Roughly a third of billed visits carry no
 * odometer, and printing "+0 km" for those would claim the car had not moved.
 *
 * ⚠️ A NEGATIVE gap is discarded rather than shown. 26 of 1,686 consecutive readings run backwards
 * (a replaced cluster, a re-used registration, a typo); "-30,000 km" on a service history reads as
 * a system fault, and the honest answer is that this pair cannot be read.
 */
function withMileageDeltas<T extends Record<string, unknown>>(rows: T[]): T[] {
  const dated = rows
    .map((row, index) => ({ row, index, when: dateStr(row.ro_date) || dateStr(row.bill_date) }))
    .filter((r) => r.when)
    .sort((a, b) => String(a.when).localeCompare(String(b.when)) || a.index - b.index)

  let previous: number | null = null
  for (const { row } of dated) {
    const km = Number(row.mileage)
    const current = Number.isFinite(km) && km > 0 ? km : null
    ;(row as Record<string, unknown>).__mileageSinceLast =
      current !== null && previous !== null && current > previous ? current - previous : null
    if (current !== null) previous = current
  }
  return rows
}

/** Postgres DATE arrives as a JS Date through this driver — String().slice() would give "Thu Jul 30". */
function dateStr(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value).trim()
  return text ? text.slice(0, 10) : null
}

export type KiaCustomerGaps = {
  enquiryNoBooking: boolean
  bookingNoInsurance: boolean
  noRecentService: boolean
  openComplaint: boolean
  insuranceLapsed: boolean
  bookedNotDelivered: boolean
}

export type KiaCustomerSummary = {
  key: string
  kind: 'customer' | 'vehicle'
  customerId: string | null
  name: string | null
  phone: string | null
  email: string | null
  city: string | null
  dealerCode: string | null
  enquiryCount: number
  bookingCount: number
  vehicleCount: number
  serviceCount: number
  lastActivityDate: string | null
  /*
   * ── WHAT THE DIRECTORY CARD SHOWS ────────────────────────────────────────────────────────────
   *
   * The card used to carry counts alone — ENQ / BOOK / CARS / SVC — which is an inventory of records
   * rather than anything about the customer. These five answer "when did we last see them, what are
   * they worth, and is anything about to lapse", which is what someone scanning the list is for.
   *
   * ⚠️ Every one is an aggregate over CTEs the directory statement ALREADY runs; none adds a join.
   * That matters because this single statement serves the whole directory.
   */
  /** Last REAL workshop visit — excludes NVI, our own pre-delivery inspection. */
  lastServiceDate: string | null
  /** Lifetime workshop spend, tax-inclusive. 0 is a real answer: they came in and were not billed. */
  serviceSpend: number | null
  /** Soonest expiry among policies still in force. Null when every policy has lapsed. */
  nextPolicyExpiry: string | null
  /** Latest expiry on record, so a lapsed customer can still say when. */
  latestPolicyExpiry: string | null
  /** Most recently delivered model, to name the car on the card. */
  primaryModel: string | null
  gaps: KiaCustomerGaps
  gapCount: number
}

export type KiaCustomerListResult = {
  rows: KiaCustomerSummary[]
  total: number
  page: number
  pageSize: number
  gapCounts: Record<keyof KiaCustomerGaps, number>
  totalCustomers: number
}

export type KiaCustomerListFilters = {
  search?: string | null
  dealerCode?: string | null
  /**
   * The branches the SIGNED-IN USER may see. NULL = unrestricted.
   *
   * Distinct from `dealerCode`, which is a filter the user chose. This one they cannot widen: it is
   * applied on top, so a pinned user narrowing to a branch they do not hold gets nothing rather than
   * someone else's customers.
   */
  dealerScope?: string[] | null
  gap?: keyof KiaCustomerGaps | null
  serviceGapMonths?: number | null
  page?: number
  pageSize?: number
}

/**
 * The customer directory.
 *
 * Two populations, unioned:
 *   1. SALES customers — keyed on the DMS `customer_id`, sourced from the deduped enquiry feed.
 *   2. SERVICE-ONLY vehicles — a VIN that appears in the workshop feeds but belongs to no
 *      `customer_id`. These people never bought from us (or bought before the DMS era) and have
 *      no party key at all. They are a real and very actionable outreach population; dropping
 *      them because they lack an id would quietly hide them from the section forever.
 */
/**
 * @param scope when opening a single profile, restrict the base CTEs to that one key.
 *   Without it the directory builds all ~10k rows just to return one, which cost ~4s per
 *   profile open. Pushing the predicate into the CTEs rather than filtering at the end keeps
 *   ONE definition of the gap logic — the list and the profile can never disagree.
 */
function directoryCte(
  serviceGapMonths: number,
  scope: KiaCustomerKey | null = null,
  dealerScope: string[] | null = null,
) {
  const isCustomerScope = scope?.kind === 'customer'
  const isVehicleScope = scope?.kind === 'vehicle'

  /*
   * The BRANCH the signed-in user is pinned to, as a predicate rather than a rejection.
   *
   * ⚠️ This section has no branch selector, so the usual enforceDealerScope backstop -- which 403s
   * when `dealer_code` is absent because absent means "give me every branch" -- rejected every
   * request from a pinned user. 27 of 30 active KIA branch-pinned users saw a red error instead of
   * their own customers. Scoping the query is the correct shape here: a branch user sees their
   * branch, which is exactly what they should see.
   *
   * NULL means unrestricted (MD, developer, unpinned). An EMPTY array would mean "no branches at
   * all" and is never produced -- getUserDealerScope returns DEALER_SCOPE_NONE for a stale pin,
   * which is a real sentinel value and correctly matches nothing.
   */
  const outletIn = (prefix: string) => {
    if (!dealerScope || !dealerScope.length) return sql``
    const codes = dealerScope.map((c) => c.trim().toUpperCase()).filter(Boolean)
    if (!codes.length) return sql``
    const expr = sql.raw(
      `UPPER(BTRIM(COALESCE(NULLIF(BTRIM(${prefix}dealer_code_2), ''), NULLIF(BTRIM(${prefix}dealer_code), ''), '')))`,
    )
    return sql`AND ${expr} IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`
  }

  // The outlet half of the party key. Without it a profile opened by customer_id alone still shows
  // every person who shares that id -- see the KiaCustomerKey comment in identity.ts.
  const keyOutlet = isCustomerScope ? String((scope as { outlet?: string }).outlet || '').trim().toUpperCase() : ''
  const keyOutletIn = (prefix: string) => {
    if (!keyOutlet) return sql``
    const expr = sql.raw(
      `UPPER(BTRIM(COALESCE(NULLIF(BTRIM(${prefix}dealer_code_2), ''), NULLIF(BTRIM(${prefix}dealer_code), ''), '')))`,
    )
    return sql`AND ${expr} = ${keyOutlet}`
  }

  // Sales-side rows are irrelevant when the key is a service-only vehicle, and vice versa.
  const enquiryScope = !scope
    ? outletIn('')
    : isCustomerScope
      ? sql`AND customer_id = ${scope.value} ${keyOutletIn('')} ${outletIn('')}`
      : sql`AND FALSE`
  const salesScope = !scope
    ? outletIn('')
    : isCustomerScope
      ? sql`AND UPPER(BTRIM(COALESCE(customerid, ''))) = ${scope.value} ${keyOutletIn('')} ${outletIn('')}`
      : sql`AND UPPER(BTRIM(vin_number)) = ${scope.value} ${outletIn('')}`
  const orphanScope = !scope
    ? outletIn('r.')
    : isVehicleScope
      ? sql`AND UPPER(BTRIM(r.vin)) = ${scope.value} ${outletIn('r.')}`
      : sql`AND FALSE`

  return sql`
  -- Narrow column lists, deliberately. These mirror the shared CTEs in identity.ts but select
  -- only what the directory needs: a SELECT * dedupe pulls 78 columns across 88,319 enquiry
  -- rows before discarding 87% of them, which cost ~6s on its own. The wide CTEs are still
  -- used by the single-customer profile queries, where the row set is already tiny.
  -- ⚠️ The dedupe keys and ORDER BY must match KIA_SNAPSHOT_DEDUPE_KEYS in identity.ts.
  -- verify:kia-customer-profile asserts the resulting totals against the raw feeds, so drift
  -- here fails the build rather than quietly inflating every figure on the page.
  latest_enquiry AS MATERIALIZED (
    SELECT DISTINCT ON (customer_id, enquiry_no)
      customer_id, enquiry_no, booking_no, enquiry_date, booking_date, delivery_date,
      name_of_the_customer, contact_number, customer_email, city, dealer_code, uploaded_at,
      -- The outlet this row belongs to. dealer_code_2 FIRST — see kiaOutletSql in identity.ts;
      -- reading dealer_code first credits every Udhampur row to Jammu.
      UPPER(BTRIM(COALESCE(NULLIF(BTRIM(dealer_code_2), ''), NULLIF(BTRIM(dealer_code), ''), ''))) AS outlet
    FROM kia_enquiry_report
    WHERE COALESCE(customer_id, '') <> '' ${enquiryScope}
    ORDER BY customer_id, enquiry_no, uploaded_at DESC NULLS LAST
  ),
  latest_sales AS MATERIALIZED (
    SELECT DISTINCT ON (UPPER(BTRIM(vin_number)))
      vin_number, customerid, model, registration_name, invoice_date, delivery_date,
      -- Identity of last resort for a buyer with no enquiry row - see sales_only_identity.
      contact_num1,
      -- Projected so vehicle_state can derive the outlet: a car must attach to the person who
      -- bought it at THAT outlet, not to whoever else shares the customer_id elsewhere.
      dealer_code_2, dealer_code
    FROM kia_sales_report
    WHERE COALESCE(vin_number, '') <> '' ${salesScope}
    ORDER BY UPPER(BTRIM(vin_number)), uploaded_at DESC NULLS LAST
  ),
  latest_insurance AS MATERIALIZED (
    SELECT DISTINCT ON (UPPER(BTRIM(vinno))) vinno, policy_expiry_date
    FROM kia_insurance
    WHERE COALESCE(vinno, '') <> ''
    ORDER BY UPPER(BTRIM(vinno)), policy_expiry_date DESC NULLS LAST, uploaded_at DESC NULLS LAST
  ),

  -- Vehicles owned per customer, with their service and insurance state. Lifetime scoped.
  vehicle_state AS MATERIALIZED (
    SELECT
      UPPER(BTRIM(s.vin_number)) AS vin,
      UPPER(BTRIM(COALESCE(s.customerid, ''))) AS customer_id,
      -- WARNING: the party column here is customerid (NO underscore) - kia_sales_report is the only
      -- table spelling it that way, and getting it wrong yields a silent zero-row join.
      -- (No backticks in SQL comments: they terminate the enclosing template literal.)
      UPPER(BTRIM(COALESCE(NULLIF(BTRIM(s.dealer_code_2), ''), NULLIF(BTRIM(s.dealer_code), ''), ''))) AS outlet,
      s.model,
      ro.vehicle_reg_no AS registration_name,
      s.invoice_date,
      s.delivery_date,
      ins.policy_expiry_date,
      (ins.vinno IS NOT NULL) AS has_insurance,
      (ins.policy_expiry_date IS NOT NULL AND ins.policy_expiry_date < CURRENT_DATE) AS insurance_lapsed,
      ro.service_count,
      ro.last_service_date,
      ro.last_customer_service_date,
      ro.service_spend
    FROM latest_sales s
    LEFT JOIN latest_insurance ins ON UPPER(BTRIM(ins.vinno)) = UPPER(BTRIM(s.vin_number))
    -- WARNING: kia_sales_report.registration_name is the NAME the vehicle is registered to
    -- ("PRAN JI MANTOO"), NOT a number plate. The only real plate we hold is
    -- ro_billing_report.vehicle_reg_no (5,422 of 5,505 rows populated).
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS service_count, MAX(r.bill_date) AS last_service_date,
             /*
              * Lifetime workshop spend. Free on this statement: the lateral already scans exactly
              * these rows for the count and the last date.
              *
              * ⚠️ total_amt is NEVER NULL — an unbilled visit stores a literal 0 — so SUM is safe
              * and needs no COALESCE. It is tax-inclusive.
              */
             SUM(r.total_amt) AS service_spend,
             -- The last REAL visit. NVI is the dealership's own pre-delivery inspection (964 rows,
             -- billed on none of them), and counting it as a service visit hid 126 sold vehicles
             -- from the never-serviced gap: their only workshop row was our own paperwork, stamped
             -- on delivery day, which made them look recently serviced for a year.
             MAX(r.bill_date) FILTER (WHERE UPPER(BTRIM(COALESCE(r.work_type, ''))) <> 'NVI') AS last_customer_service_date,
             (ARRAY_AGG(r.vehicle_reg_no ORDER BY r.bill_date DESC NULLS LAST)
                FILTER (WHERE COALESCE(r.vehicle_reg_no, '') <> ''))[1] AS vehicle_reg_no
      FROM ro_billing_report r
      WHERE UPPER(BTRIM(r.vin)) = UPPER(BTRIM(s.vin_number))
    ) ro ON TRUE
  ),

  -- Per-customer rollup of the vehicle side.
  customer_vehicles AS MATERIALIZED (
    SELECT
      customer_id, outlet,
      COUNT(*)::int AS vehicle_count,
      COALESCE(SUM(service_count), 0)::int AS service_count,
      MAX(last_service_date) AS last_service_date,
      /*
       * Everything the directory card needs, rolled up here rather than fetched per row. The card
       * renders 12,654 profiles from ONE statement, so each of these must be an aggregate over CTEs
       * that already run — not a new join.
       */
      COALESCE(SUM(service_spend), 0) AS service_spend,
      -- The last visit that was a real customer visit, not our own pre-delivery inspection.
      MAX(last_customer_service_date) AS last_customer_service_date,
      /*
       * The SOONEST policy still in force is what an employee acts on; MAX would show the furthest
       * expiry and hide a car expiring next week behind one covered until 2029.
       */
      MIN(policy_expiry_date) FILTER (WHERE policy_expiry_date >= CURRENT_DATE) AS next_policy_expiry,
      -- ...and the latest expiry overall, so a fully-lapsed customer can still say when it lapsed.
      MAX(policy_expiry_date) AS latest_policy_expiry,
      -- The most recently delivered car, to name the customer's vehicle on the card.
      (ARRAY_AGG(model ORDER BY delivery_date DESC NULLS LAST))[1] AS primary_model,
      BOOL_OR(NOT has_insurance) AS any_without_insurance,
      BOOL_OR(insurance_lapsed) AS any_insurance_lapsed,
      -- Judged on the last CUSTOMER visit, never on an NVI row — see the note in the lateral.
      BOOL_OR(last_customer_service_date IS NULL
        OR last_customer_service_date < (CURRENT_DATE - (${serviceGapMonths} || ' months')::interval)) AS any_service_overdue
    FROM vehicle_state
    WHERE customer_id <> ''
    -- Per (customer_id, outlet): a car bought at JK402 must not appear under the different person
    -- who happens to share that customer_id at JK501.
    GROUP BY customer_id, outlet
  ),

  -- Enquiry rollup. booking_no on the enquiry row IS the funnel: 1,146/1,146 resolve to a booking.
  customer_enquiry AS MATERIALIZED (
    SELECT
      customer_id, outlet,
      COUNT(*)::int AS enquiry_count,
      COUNT(*) FILTER (WHERE COALESCE(booking_no, '') <> '')::int AS booking_count,
      BOOL_OR(COALESCE(booking_no, '') <> '' AND delivery_date IS NULL) AS booked_not_delivered,
      MAX(GREATEST(
        COALESCE(enquiry_date, '1900-01-01'::date),
        COALESCE(booking_date, '1900-01-01'::date),
        COALESCE(delivery_date, '1900-01-01'::date)
      )) AS last_sales_activity
    FROM latest_enquiry
    -- Per (customer_id, outlet), matching customer_identity. Grouping by customer_id alone gave
    -- BOTH people behind a shared id the combined enquiry and booking counts.
    GROUP BY customer_id, outlet
  ),

  -- Identity fields from the most recent enquiry row.
  -- ⚠️ 2,318 of 8,110 customer_ids (29%) carry more than one distinct phone across snapshot
  -- rows. Take the latest upload, never an aggregate, or the profile shows a stale number.
  /*
   * ⚠️ Keyed on (customer_id, outlet), NOT customer_id alone.
   *
   * customer_id is a per-DMS-instance sequence, not a group party key. Measured 2026-08-26: of
   * 8,371 distinct customer_ids, 2,411 (28.8%) resolve to MORE THAN ONE PERSON — C2025020002 is
   * 'ANAND' at JK402 and 'MILANPANDEY' at JK501. DISTINCT ON (customer_id) picked whichever name
   * was uploaded last and showed that person the other's enquiries, bookings, spend and contact
   * details. Qualifying by outlet resolves 2,396 of the 2,411 (99.4%); the surviving 15 stay SPLIT
   * rather than merged, because showing less history is a far smaller error than showing someone
   * else's.
   */
  customer_identity AS MATERIALIZED (
    SELECT DISTINCT ON (customer_id, outlet)
      customer_id, outlet, name_of_the_customer, contact_number, customer_email, city, dealer_code
    FROM latest_enquiry
    ORDER BY customer_id, outlet, uploaded_at DESC NULLS LAST, enquiry_date DESC NULLS LAST
  ),

  /*
   * Buyers with NO enquiry row at all.
   *
   * Identity is normally taken from the enquiry feed, which is richer. But a walk-in who bought
   * without an enquiry ever being logged has no row there — and dropping them means a customer who
   * gave us money does not exist in the customer section. Measured: 1 today (Rahuljeet Singh
   * Jasrotia, C2024120003 @ JK402). One is enough: the failure is silent and grows with every
   * unlogged walk-in.
   *
   * kia_sales_report carries registration_name and contact_num1, so the fallback is real data, not
   * a placeholder. city and email are genuinely absent and stay NULL rather than being invented.
   */
  sales_only_identity AS MATERIALIZED (
    SELECT DISTINCT ON (customer_id, outlet) * FROM (
      SELECT
        UPPER(BTRIM(COALESCE(s.customerid, ''))) AS customer_id,
        UPPER(BTRIM(COALESCE(NULLIF(BTRIM(s.dealer_code_2), ''), NULLIF(BTRIM(s.dealer_code), ''), ''))) AS outlet,
        s.registration_name AS name_of_the_customer,
        s.contact_num1 AS contact_number,
        NULL::text AS customer_email,
        NULL::text AS city,
        s.dealer_code
      FROM latest_sales s
      WHERE COALESCE(s.customerid, '') <> ''
    ) t
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_identity ci
      WHERE ci.customer_id = t.customer_id AND ci.outlet = t.outlet
    )
  ),

  all_identity AS MATERIALIZED (
    SELECT customer_id, outlet, name_of_the_customer, contact_number, customer_email, city, dealer_code
    FROM customer_identity
    UNION ALL
    SELECT customer_id, outlet, name_of_the_customer, contact_number, customer_email, city, dealer_code
    FROM sales_only_identity
  ),

  -- Complaints attach by VIN (95% of complaint VINs resolve), so they roll up per customer.
  customer_complaints AS MATERIALIZED (
    SELECT v.customer_id, v.outlet,
      COUNT(*)::int AS complaint_count,
      COUNT(*) FILTER (WHERE c.close_date IS NULL)::int AS open_complaints
    FROM kia_call_center_complaints c
    JOIN vehicle_state v ON UPPER(BTRIM(v.vin)) = UPPER(BTRIM(COALESCE(c.vin_no, '')))
    WHERE v.customer_id <> ''
    GROUP BY v.customer_id, v.outlet
  ),

  -- Population 1: everyone with a DMS party key.
  sales_directory AS (
    SELECT
      'customer'::text AS kind,
      i.customer_id AS key_value,
      i.outlet AS key_outlet,
      i.customer_id,
      i.name_of_the_customer AS name,
      i.contact_number AS phone,
      i.customer_email AS email,
      i.city,
      i.dealer_code,
      COALESCE(e.enquiry_count, 0) AS enquiry_count,
      COALESCE(e.booking_count, 0) AS booking_count,
      COALESCE(v.vehicle_count, 0) AS vehicle_count,
      COALESCE(v.service_count, 0) AS service_count,
      GREATEST(COALESCE(e.last_sales_activity, '1900-01-01'::date),
               COALESCE(v.last_service_date, '1900-01-01'::date)) AS last_activity_date,
      v.last_customer_service_date,
      v.service_spend,
      v.next_policy_expiry,
      v.latest_policy_expiry,
      v.primary_model,
      (COALESCE(e.booking_count, 0) = 0) AS gap_enquiry_no_booking,
      COALESCE(v.any_without_insurance, FALSE) AS gap_no_insurance,
      COALESCE(v.any_service_overdue, FALSE) AS gap_no_recent_service,
      (COALESCE(c.open_complaints, 0) > 0) AS gap_open_complaint,
      COALESCE(v.any_insurance_lapsed, FALSE) AS gap_insurance_lapsed,
      COALESCE(e.booked_not_delivered, FALSE) AS gap_booked_not_delivered
    FROM all_identity i
    LEFT JOIN customer_enquiry e ON e.customer_id = i.customer_id AND e.outlet = i.outlet
    -- INNER, not LEFT: no purchased vehicle means not a customer. This one word is the whole
    -- buyers-only rule; making it LEFT again silently restores the 12,654-row prospect list.
    JOIN customer_vehicles v ON v.customer_id = i.customer_id AND v.outlet = i.outlet
    LEFT JOIN customer_complaints c ON c.customer_id = i.customer_id AND c.outlet = i.outlet
  ),

  -- Population 2: vehicles seen only in the workshop, with no owning customer_id.
  -- Identity comes from kia_psf_yearly, NOT ro_billing_report: that table's mobile_no is
  -- masked on 3,780 of 5,505 rows ("XXXXXX6149") and customer_name is null on 941. It is a
  -- vehicle-and-money table, not a customer table.
  orphan_vehicles AS MATERIALIZED (
    SELECT
      UPPER(BTRIM(r.vin)) AS vin,
      COUNT(*)::int AS service_count,
      MAX(r.bill_date) AS last_service_date
    FROM ro_billing_report r
    WHERE COALESCE(r.vin, '') <> '' ${orphanScope}
      AND NOT EXISTS (SELECT 1 FROM vehicle_state v WHERE v.vin = UPPER(BTRIM(r.vin)))
    GROUP BY UPPER(BTRIM(r.vin))
  ),

  service_directory AS (
    SELECT
      'vehicle'::text AS kind,
      o.vin AS key_value,
      ''::text AS key_outlet,
      NULL::text AS customer_id,
      COALESCE(p.name, MAX_RO.customer_name) AS name,
      p.mobile AS phone,
      p.e_mail AS email,
      p.city,
      COALESCE(p.ro_dealer, MAX_RO.dealer_code) AS dealer_code,
      0 AS enquiry_count,
      0 AS booking_count,
      1 AS vehicle_count,
      o.service_count,
      o.last_service_date AS last_activity_date,
      FALSE AS gap_enquiry_no_booking,
      -- Deliberately FALSE. The gap is "we sold them a car and hold no policy for it"; a
      -- vehicle we never sold cannot have that gap, and flagging it would swamp the count
      -- (1,853 service-only vehicles against 76 genuinely-uninsured sold ones). A lapsed
      -- policy on a vehicle we service is still surfaced, below — that one IS actionable.
      FALSE AS gap_no_insurance,
      (o.last_service_date IS NULL
        OR o.last_service_date < (CURRENT_DATE - (${serviceGapMonths} || ' months')::interval)) AS gap_no_recent_service,
      EXISTS (SELECT 1 FROM kia_call_center_complaints c
              WHERE UPPER(BTRIM(COALESCE(c.vin_no, ''))) = o.vin AND c.close_date IS NULL) AS gap_open_complaint,
      EXISTS (SELECT 1 FROM latest_insurance li WHERE UPPER(BTRIM(li.vinno)) = o.vin
              AND li.policy_expiry_date < CURRENT_DATE) AS gap_insurance_lapsed,
      FALSE AS gap_booked_not_delivered
    FROM orphan_vehicles o
    LEFT JOIN LATERAL (
      SELECT DISTINCT ON (UPPER(BTRIM(vin))) name, mobile, e_mail, city, ro_dealer
      FROM kia_psf_yearly WHERE UPPER(BTRIM(vin)) = o.vin
      ORDER BY UPPER(BTRIM(vin)), uploaded_at DESC NULLS LAST
    ) p ON TRUE
    LEFT JOIN LATERAL (
      SELECT DISTINCT ON (UPPER(BTRIM(vin))) customer_name, dealer_code
      FROM ro_billing_report WHERE UPPER(BTRIM(vin)) = o.vin
      ORDER BY UPPER(BTRIM(vin)), bill_date DESC NULLS LAST
    ) MAX_RO ON TRUE
  ),

  /*
   * BUYERS ONLY — people who actually bought a vehicle from us.
   *
   * The directory used to union three populations: buyers, enquiry-only prospects, and service-only
   * VINs with no party key at all. That made it a 12,654-row prospect list. Per the MD it is a
   * CUSTOMER list: 889 people who took delivery of one of our 914 cars.
   *
   * The restriction is the INNER JOIN to customer_vehicles below — that CTE is derived from
   * kia_sales_report, so joining it is exactly "appears in the sales report". service_directory
   * (1,884 orphan VINs seen only in the workshop) is dropped for the same reason: they are real
   * relationships, but we did not sell them the car and they carry no party key to hang a
   * purchase history on.
   */
  directory AS MATERIALIZED (
    SELECT * FROM sales_directory
  )
  `
}

function mapSummary(row: Record<string, unknown>): KiaCustomerSummary {
  const kind = String(row.kind) === 'vehicle' ? 'vehicle' as const : 'customer' as const
  const gaps: KiaCustomerGaps = {
    enquiryNoBooking: Boolean(row.gap_enquiry_no_booking),
    bookingNoInsurance: Boolean(row.gap_no_insurance),
    noRecentService: Boolean(row.gap_no_recent_service),
    openComplaint: Boolean(row.gap_open_complaint),
    insuranceLapsed: Boolean(row.gap_insurance_lapsed),
    bookedNotDelivered: Boolean(row.gap_booked_not_delivered),
  }
  // The outlet is part of the party key — see KiaCustomerKey. Without it the link opens a profile
  // that merges everyone sharing this customer_id.
  const outlet = String(row.key_outlet || '').trim().toUpperCase()
  const key: KiaCustomerKey = kind === 'customer'
    ? { kind: 'customer', value: String(row.key_value), outlet: outlet || undefined }
    : { kind: 'vehicle', value: String(row.key_value) }
  const lastActivity = dateStr(row.last_activity_date)

  return {
    key: serializeCustomerKey(key),
    kind,
    customerId: str(row.customer_id),
    name: str(row.name),
    phone: str(row.phone),
    email: str(row.email),
    city: str(row.city),
    dealerCode: str(row.dealer_code),
    enquiryCount: num(row.enquiry_count),
    bookingCount: num(row.booking_count),
    vehicleCount: num(row.vehicle_count),
    serviceCount: num(row.service_count),
    // '1900-01-01' is the GREATEST() sentinel for "no activity at all".
    lastActivityDate: lastActivity && lastActivity > '1900-01-01' ? lastActivity : null,
    lastServiceDate: dateStr(row.last_customer_service_date),
    /*
     * ⚠️ Zero is kept as zero, not turned into null. A customer with visits but no bills has
     * genuinely spent nothing with the workshop, which is a different fact from "we hold no
     * figure" — and 2,398 of 5,711 visits are unbilled, so this is the common case, not the edge.
     */
    serviceSpend: row.service_spend === null || row.service_spend === undefined
      ? null
      : Number(row.service_spend),
    nextPolicyExpiry: dateStr(row.next_policy_expiry),
    latestPolicyExpiry: dateStr(row.latest_policy_expiry),
    primaryModel: str(row.primary_model),
    gaps,
    gapCount: Object.values(gaps).filter(Boolean).length,
  }
}

const GAP_COLUMN: Record<keyof KiaCustomerGaps, string> = {
  enquiryNoBooking: 'gap_enquiry_no_booking',
  bookingNoInsurance: 'gap_no_insurance',
  noRecentService: 'gap_no_recent_service',
  openComplaint: 'gap_open_complaint',
  insuranceLapsed: 'gap_insurance_lapsed',
  bookedNotDelivered: 'gap_booked_not_delivered',
}

export async function listKiaCustomers(
  filters: KiaCustomerListFilters = {},
): Promise<KiaCustomerListResult> {
  const dealerScope = filters.dealerScope ?? null
  const page = Math.max(1, Number(filters.page) || 1)
  const pageSize = Math.min(100, Math.max(10, Number(filters.pageSize) || 25))
  const offset = (page - 1) * pageSize
  const serviceGapMonths = Math.min(60, Math.max(1, Number(filters.serviceGapMonths) || DEFAULT_SERVICE_GAP_MONTHS))

  const term = classifySearchTerm(filters.search)
  const conditions = [sql`TRUE`]

  if (term) {
    const matchers = []
    // A DMS party key typed straight in. Cheap, exact, and one of the search inputs the section is
    // expected to accept; without it "C2025020002" fell through to the name scan and matched nothing.
    if (term.customerId) matchers.push(sql`UPPER(BTRIM(d.customer_id)) = ${term.customerId}`)
    if (term.phone) matchers.push(sql`${phone10Sql(sql.raw('d.phone'))} = ${term.phone}`)
    if (term.vin) matchers.push(sql`EXISTS (SELECT 1 FROM vehicle_state v WHERE v.vin = ${term.vin}
      AND (v.customer_id = d.customer_id OR d.key_value = ${term.vin}))`)
    if (term.vin) matchers.push(sql`d.key_value = ${term.vin}`)
    if (term.registration) {
      // Matches the real number plate from the workshop feed (vehicle_state.registration_name
      // is populated from ro_billing_report.vehicle_reg_no — see the note in vehicle_state).
      matchers.push(sql`EXISTS (SELECT 1 FROM vehicle_state v
        WHERE UPPER(regexp_replace(COALESCE(v.registration_name, ''), '[^A-Za-z0-9]', '', 'g')) = ${term.registration}
          AND (v.customer_id = d.customer_id OR d.key_value = v.vin))`)
      matchers.push(sql`EXISTS (SELECT 1 FROM ro_billing_report r
        WHERE UPPER(regexp_replace(COALESCE(r.vehicle_reg_no, ''), '[^A-Za-z0-9]', '', 'g')) = ${term.registration}
          AND UPPER(BTRIM(r.vin)) = d.key_value)`)
    }
    // Name is a search input only, never an identity — see identity.ts.
    if (!term.isExact) matchers.push(sql`d.name ILIKE ${'%' + term.raw + '%'}`)
    if (matchers.length) conditions.push(sql`(${sql.join(matchers, sql` OR `)})`)
  }

  if (filters.dealerCode) {
    conditions.push(sql`UPPER(BTRIM(COALESCE(d.dealer_code, ''))) = ${String(filters.dealerCode).toUpperCase()}`)
  }
  if (filters.gap && GAP_COLUMN[filters.gap]) {
    conditions.push(sql`d.${sql.raw(GAP_COLUMN[filters.gap])} = TRUE`)
  }

  const where = sql.join(conditions, sql` AND `)

  const result = await db.execute(sql`
    WITH ${directoryCte(serviceGapMonths, null, dealerScope)}
    SELECT d.*,
      COUNT(*) OVER ()::int AS total_rows,
      (SELECT COUNT(*) FROM directory)::int AS total_customers,
      (SELECT COUNT(*) FROM directory WHERE gap_enquiry_no_booking)::int AS c_enquiry_no_booking,
      (SELECT COUNT(*) FROM directory WHERE gap_no_insurance)::int AS c_no_insurance,
      (SELECT COUNT(*) FROM directory WHERE gap_no_recent_service)::int AS c_no_recent_service,
      (SELECT COUNT(*) FROM directory WHERE gap_open_complaint)::int AS c_open_complaint,
      (SELECT COUNT(*) FROM directory WHERE gap_insurance_lapsed)::int AS c_insurance_lapsed,
      (SELECT COUNT(*) FROM directory WHERE gap_booked_not_delivered)::int AS c_booked_not_delivered
    FROM directory d
    WHERE ${where}
    ORDER BY d.last_activity_date DESC NULLS LAST, d.name ASC NULLS LAST
    LIMIT ${pageSize} OFFSET ${offset}
  `)

  const raw = rows(result)
  const first = raw[0] || {}

  return {
    rows: raw.map(mapSummary),
    total: num(first.total_rows),
    page,
    pageSize,
    totalCustomers: num(first.total_customers),
    gapCounts: {
      enquiryNoBooking: num(first.c_enquiry_no_booking),
      bookingNoInsurance: num(first.c_no_insurance),
      noRecentService: num(first.c_no_recent_service),
      openComplaint: num(first.c_open_complaint),
      insuranceLapsed: num(first.c_insurance_lapsed),
      bookedNotDelivered: num(first.c_booked_not_delivered),
    },
  }
}

/* ------------------------------------------------------------------------------------ *
 * Single profile
 * ------------------------------------------------------------------------------------ */

export type KiaProfileVehicle = {
  vin: string
  model: string | null
  registration: string | null
  invoiceDate: string | null
  deliveryDate: string | null
  insurance: {
    policyNo: string | null
    /**
     * The company that ACTUALLY covers the vehicle.
     *
     * ⚠️ Read from `insurancecompany` (1,438 of 1,438 rows), NOT `prev_ic_name`. That column is the
     * PREVIOUS insurer — populated on just 44 rows, all of them renewals — so using it left the
     * insurer blank on 97% of policies and, on the 44 it did fill, named the company the customer
     * had LEFT: the profile said "ICICI Lombard" for a vehicle now covered by Cholamandalam MS.
     */
    insurer: string | null
    /** Who they were with before, on a renewal. Genuinely useful, but only present on 3% of rows. */
    previousInsurer: string | null
    /** 'New' or 'Renewal' — whether this customer has ever renewed with us before. */
    policyType: string | null
    /** 17 policies are cancelled and were previously rendered as live cover. */
    cancelled: boolean
    /** What the customer paid, inclusive of tax. Present on 100% of policies we hold. */
    grossPremium: number | null
    netPremium: number | null
    effectiveDate: string | null
    expiryDate: string | null
    lapsed: boolean
  } | null
  serviceCount: number
  lastServiceDate: string | null
  services: {
    roNo?: string | null
    billNo?: string | null
    billDate: string | null
    roDate: string | null
    model: string | null
    registration: string | null
    /** Free Service / Paid Service / Running Repair / Accidental Repair / NVI / Test Drive. */
    workType: string | null
    advisor: string | null
    /*
     * The DMS collection status, VERBATIM (including its own misspelling, 'Partial Paymant
     * Received' - matching a corrected spelling matches nothing). There is NO amount-received or
     * balance column anywhere in the feed, so nothing downstream may ever state an amount owed:
     * the only honest sentence is "bill of Rs X, marked <status>".
     */
    billStatus: string | null
    /*
     * NULL means "this visit was never billed" — 2,398 of 5,711 rows. The feed stores that as a
     * literal 0, which is converted to null HERE, once, so no call site downstream has to know the
     * difference between an unbilled visit and a free one. Tax-inclusive.
     */
    amount: number | null
    labour: number | null
    parts: number | null
    tax: number | null
    discount: number | null
    /**
     * Odometer at this visit, from kia_psf_yearly. Null when that feed holds no reading for the RO
     * — roughly a third of billed visits, so the UI must render an absence, never a 0.
     */
    mileage: number | null
    /**
     * Kilometres covered since the PREVIOUS visit on this vehicle. Null on the first visit, and
     * null whenever either end is missing a reading — never 0, which would claim the car did not
     * move. Computed in the reader so the client cannot re-derive it against a truncated list.
     */
    mileageSinceLast: number | null
  }[]
  /** Sum of billed visits only, and how many visits carry no price. Never coerce these together. */
  serviceSpend: number | null
  servicesBilled: number
  servicesUnbilled: number
  /**
   * True when every workshop row for this vehicle is NVI — our own pre-delivery inspection.
   * Such a vehicle has a service COUNT but has never actually been in for a customer visit.
   */
  nviOnly: boolean
  /** Accessory counter sales for this VIN — deduplicated, retail-only, cancelled bills excluded. */
  accessories: {
    billNo: string | null
    billDate: string | null
    description: string | null
    qty: number | null
    /** Line total including tax. */
    amount: number | null
  }[]
  accessoriesSpend: number | null
  /**
   * Bills the DMS marks 'Payment Not Received' or 'Partial Paymant Received'. The total is the
   * BILLED value of those bills — the outstanding amount is not recorded anywhere in the feed and
   * must never be presented as such.
   */
  unpaidCount: number
  unpaidBilledTotal: number | null
  complaints: { complaintNo: string | null; date: string | null; closeDate: string | null; model: string | null }[]
}

export type KiaCustomerProfile = KiaCustomerSummary & {
  enquiries: {
    enquiryNo: string | null
    enquiryDate: string | null
    model: string | null
    status: string | null
    source: string | null
    consultant: string | null
    testDriveDate: string | null
    bookingNo: string | null
    bookingDate: string | null
    deliveryDate: string | null
    lostDate: string | null
  }[]
  bookings: {
    bookingNo: string | null
    bookingDate: string | null
    model: string | null
    consultant: string | null
    committedDeliveryDate: string | null
  }[]
  vehicles: KiaProfileVehicle[]
  receipts: { receiptDate: string | null; model: string | null }[]
  /** Repair orders open in the workshop right now, filtered of already-closed rows. */
  liveRos: {
    vin: string | null
    registration: string | null
    model: string | null
    roNo: string | null
    roDate: string | null
    workType: string | null
    subStatus: string | null
    advisor: string | null
    estimate: number | null
    /** Verbatim from the feed (text, often date-only). Displayed, never parsed. */
    promisedOn: string | null
    delayReason: string | null
    /** When the snapshot feed was last uploaded — the strip states it. */
    asOf: string | null
  }[]
  /** Present when a figure could not be produced the intended way. Never hide these. */
  notes: string[]
}

export async function getKiaCustomerProfile(
  key: KiaCustomerKey,
  options: { serviceGapMonths?: number | null; dealerScope?: string[] | null } = {},
): Promise<KiaCustomerProfile | null> {
  // The same branch pin the directory applies. A pinned user must not be able to open a customer
  // from another branch by pasting the key straight into the URL.
  const dealerScope = options.dealerScope ?? null
  const serviceGapMonths = Math.min(60, Math.max(1, Number(options.serviceGapMonths) || DEFAULT_SERVICE_GAP_MONTHS))
  const isCustomer = key.kind === 'customer'
  /*
   * The outlet half of the party key. customer_id alone is shared by more than one person on 2,411
   * of 8,371 KIA ids, so a profile filtered on it shows one person another person's history.
   *
   * A legacy link (cid:C2025020002, no outlet) still resolves to the OLD merged behaviour rather
   * than 404-ing - the directory only ever emits composite keys now, so this is reachable only from
   * an old bookmark, and the profile header names the outlet so the merge is at least visible.
   */
  const outlet = isCustomer ? String((key as { outlet?: string }).outlet || '').trim().toUpperCase() : ''
  /**
   * @param hasDealerCode2 whether this table carries dealer_code_2.
   *
   * NOT every KIA feed has it: enquiry, booking and sales do, kia_receipt_report has only
   * dealer_code. Assuming it everywhere threw 42703 at runtime, not at compile time - the SQL here
   * is a template string, so a wrong column name is invisible until the query runs.
   */
  const outletFilter = (hasDealerCode2 = true) => {
    if (!outlet) return sql``
    const expr = hasDealerCode2
      ? sql.raw("COALESCE(NULLIF(BTRIM(dealer_code_2), ''), NULLIF(BTRIM(dealer_code), ''), '')")
      : sql.raw("COALESCE(NULLIF(BTRIM(dealer_code), ''), '')")
    return sql`AND UPPER(BTRIM(${expr})) = ${outlet}`
  }

  // ⚠️ Round trips, not query cost, dominate here: a trivial statement costs ~250ms against
  // the pooler (`prepare: false`, 2 RTT/statement) and a cold connection ~1.8s. The five
  // independent queries below therefore run as ONE parallel group rather than a sequence —
  // only services/complaints have to wait, because they need the VIN list.
  //
  // NB Promise.all does NOT pipeline inside a transaction, but these are not in one.
  const [summaryResult, vehiclesResult, enquiryResult, bookingResult, receiptResult] = await Promise.all([
    db.execute(sql`
      WITH ${directoryCte(serviceGapMonths, key, dealerScope)}
      SELECT d.* FROM directory d
      WHERE d.kind = ${key.kind} AND d.key_value = ${key.value}
      LIMIT 1
    `),
    // Vehicles — for a customer key, everything they own; for a vehicle key, just that VIN.
    db.execute(sql`
    WITH scoped_sales AS (
      SELECT DISTINCT ON (UPPER(BTRIM(vin_number)))
        vin_number, model, registration_name, invoice_date, delivery_date
      FROM kia_sales_report
      WHERE COALESCE(vin_number, '') <> ''
        AND ${isCustomer
          ? sql`UPPER(BTRIM(COALESCE(customerid, ''))) = ${key.value} ${outletFilter()}`
          : sql`UPPER(BTRIM(vin_number)) = ${key.value}`}
      ORDER BY UPPER(BTRIM(vin_number)), uploaded_at DESC NULLS LAST
    )
    SELECT
      UPPER(BTRIM(s.vin_number)) AS vin, s.model,
      -- The number plate comes from the workshop feed; registration_name is the owner's name.
      ro.vehicle_reg_no AS registration_name,
      s.registration_name AS registered_owner,
      s.invoice_date, s.delivery_date,
      ins.policyno, ins.prev_ic_name, ins.insurancecompany, ins.policytype, ins.cancelled,
      ins.policy_effective_date, ins.policy_expiry_date,
      ins.grosspremium, ins.netpremium
    FROM scoped_sales s
    LEFT JOIN LATERAL (
      SELECT vehicle_reg_no FROM ro_billing_report
      WHERE UPPER(BTRIM(vin)) = UPPER(BTRIM(s.vin_number)) AND COALESCE(vehicle_reg_no, '') <> ''
      ORDER BY bill_date DESC NULLS LAST LIMIT 1
    ) ro ON TRUE
    LEFT JOIN LATERAL (
      SELECT policyno, prev_ic_name, insurancecompany, policytype, cancelled,
             policy_effective_date, policy_expiry_date,
             grosspremium, netpremium
      FROM kia_insurance
      WHERE UPPER(BTRIM(vinno)) = UPPER(BTRIM(s.vin_number))
      ORDER BY policy_expiry_date DESC NULLS LAST, uploaded_at DESC NULLS LAST
      LIMIT 1
    ) ins ON TRUE
    ORDER BY s.invoice_date DESC NULLS LAST
  `),
    // Sales-side history exists only for a party key. ⚠️ The customer filter goes INSIDE each
    // dedupe: deduping the whole 88,319-row enquiry feed and filtering afterwards cost ~3s.
    isCustomer
      ? db.execute(sql`
        SELECT DISTINCT ON (enquiry_no)
               enquiry_no, enquiry_date, model, enquiry_status, enquiry_source, consultant_name,
               test_drive_date, booking_no, booking_date, delivery_date, lost_date
        FROM kia_enquiry_report
        WHERE customer_id = ${key.value} ${outletFilter()}
        ORDER BY enquiry_no, uploaded_at DESC NULLS LAST
      `)
      : Promise.resolve([]),
    isCustomer
      ? db.execute(sql`
        SELECT DISTINCT ON (booking_no)
               booking_no, booking_date, model, consultant_name, committed_delivery_date
        FROM kia_booking_report
        WHERE customer_id = ${key.value} ${outletFilter()}
        ORDER BY booking_no, uploaded_at DESC NULLS LAST
      `)
      : Promise.resolve([]),
    isCustomer
      ? db.execute(sql`
        SELECT DISTINCT ON (receipt_date, model) receipt_date, model
        FROM kia_receipt_report WHERE customer_id = ${key.value} ${outletFilter(false)}
        ORDER BY receipt_date DESC NULLS LAST, model
      `)
      : Promise.resolve([]),
  ])

  const summaryRow = rows(summaryResult)[0]
  if (!summaryRow) return null
  const summary = mapSummary(summaryRow)
  const notes: string[] = []

  let vehicleRows = rows(vehiclesResult)

  // A service-only vehicle has no sales row at all — synthesise one from the workshop feed.
  if (!vehicleRows.length && !isCustomer) {
    const fallback = await db.execute(sql`
      SELECT ${key.value}::text AS vin,
        (SELECT model FROM ro_billing_report WHERE UPPER(BTRIM(vin)) = ${key.value}
         ORDER BY bill_date DESC NULLS LAST LIMIT 1) AS model,
        (SELECT vehicle_reg_no FROM ro_billing_report WHERE UPPER(BTRIM(vin)) = ${key.value}
         ORDER BY bill_date DESC NULLS LAST LIMIT 1) AS registration_name,
        NULL::date AS invoice_date, NULL::date AS delivery_date,
        ins.policyno, ins.prev_ic_name, ins.insurancecompany, ins.policytype, ins.cancelled,
        ins.policy_effective_date, ins.policy_expiry_date,
        ins.grosspremium, ins.netpremium
      FROM (SELECT 1) t
      LEFT JOIN LATERAL (
        SELECT policyno, prev_ic_name, insurancecompany, policytype, cancelled,
               policy_effective_date, policy_expiry_date,
               grosspremium, netpremium
        FROM kia_insurance WHERE UPPER(BTRIM(vinno)) = ${key.value}
        ORDER BY policy_expiry_date DESC NULLS LAST, uploaded_at DESC NULLS LAST LIMIT 1
      ) ins ON TRUE
    `)
    vehicleRows = rows(fallback)
    notes.push('This vehicle has no sales record with us — it is known only from workshop visits, so purchase details are unavailable.')
  }

  const vins = vehicleRows.map((row) => String(row.vin)).filter(Boolean)

  /*
   * The live-RO match. VIN is exact; the customer-id fallback exists because two thirds of open ROs
   * sit on VINs we did not sell — but a bare customer_id is shared by DIFFERENT PEOPLE across
   * outlets (2,411 of 8,371 ids), so the id-based match also requires the servicing outlet to be
   * the profile's outlet. Showing this customer a stranger's car on the ramp would be worse than
   * missing one of their own.
   */
  const profileOutlet = isCustomer ? String(key.outlet || '').trim().toUpperCase() : ''
  const liveRoCustomerMatch = isCustomer && profileOutlet
    ? sql`OR (UPPER(BTRIM(COALESCE(o.customer_id, ''))) = ${key.value}
          AND UPPER(BTRIM(COALESCE(NULLIF(BTRIM(o.dealer_code_2), ''), o.dealer_code, ''))) = ${profileOutlet})`
    : sql``

  const [servicesResult, complaintsResult, accessoriesResult, liveRoResult] = vins.length
    ? await Promise.all([
      db.execute(sql`
        /*
         * The money columns ride along on a statement that already runs, so per-visit pricing costs
         * nothing extra against the pooler.
         *
         * ⚠️ total_amt is NEVER NULL — measured 0 nulls across all 5,711 rows. An unbilled visit
         * stores a literal 0, so the "we do not hold a price" test is greater-than-zero, NOT IS NULL.
         * A null
         * check here would never fire and 2,398 visits would render as a confident Rs 0.
         *
         * ⚠️ total_amt is TAX-INCLUSIVE. labour + parts + other reconciles on 0 of 3,313 billed
         * rows; labour + parts + labour_tax + part_tax reconciles on 3,300. So the tax line must be
         * shown alongside any labour/parts split or the figures visibly fail to add up.
         *
         * other_amt is deliberately not selected: it is 0 on all 5,711 rows.
         *
         * work_type is selected because NVI is our own pre-delivery inspection, not a customer
         * visit - see the note on nvi_only below.
         */
        SELECT UPPER(BTRIM(b.vin)) AS vin, b.ro_no, b.bill_no, b.bill_date, b.ro_date, b.model,
               b.vehicle_reg_no, b.work_type, b.service_advisor, b.bill_status,
               b.total_amt, b.labour_amt, b.part_amt, b.labour_tax, b.part_tax, b.total_disc,
               psf.mileage
        FROM ro_billing_report b
        /*
         * THE ODOMETER. ro_billing_report has no mileage column at all; the reading lives in
         * kia_psf_yearly, a separate feed sharing (vin, ro_no). 3,938 of 3,984 PSF rows match a bill.
         *
         * ⚠️ AGGREGATED BEFORE THE JOIN, deliberately. Joining the raw feed fans out — 23 PSF rows
         * match more than one bill (max 3) — and a fan-out here would silently multiply serviceSpend,
         * because the money is summed over these same rows. MAX() per (vin, ro_no) cannot fan out.
         * A vehicle booked in twice on one day genuinely has two readings; the higher is the later.
         *
         * ⚠️ mileage > 0: the feed's minimum is 46 km and no row is 0, so a 0 is a blank written as
         * a number, not a brand-new car.
         */
        /*
         * THREE FEEDS, one reading. kia_psf_yearly alone covered 3,946 of 5,757 billed visits (68.5%);
         * adding the other two takes it to 4,352 (75.6%).
         *
         * ⚠️ kia_demo_job_cards is NOT only demo cars, despite the name — it is the same DMS job-card
         * export landing in a second table, and it carries 406 readings PSF does not. 409 of the 479
         * it recovers are on vehicles present in kia_sales_report, i.e. cars we actually sold.
         * Verified against PSF where both describe the same (vin, ro_no): 1,050 overlapping rows,
         * 1,020 identical, and the 30 that differ differ by at most 149 km — a revised reading on one
         * job card, not a different vehicle.
         *
         * ⚠️ kia_open_ro_yearly recovers only 5. It stays because it is the feed for cars ON THE RAMP
         * NOW, which is exactly where the freshest reading appears, and it costs one scan of 236 rows.
         *
         * ⚠️ MAX over the union, so a revised reading wins and — as before — the aggregate cannot fan
         * out. Fan-out here would multiply serviceSpend, which is summed over these same rows.
         *
         * Sources deliberately NOT used: v_upgrade_tenure_pool (a Hyundai view, 0 KIA matches, km
         * null) and hyundai_warranty_claim_list (17,511 readings, but Hyundai only — there is no KIA
         * warranty table).
         */
        LEFT JOIN (
          SELECT vin, ro_no, MAX(mileage) AS mileage
          FROM (
            SELECT UPPER(BTRIM(vin)) AS vin, UPPER(BTRIM(ro_no)) AS ro_no, mileage
            FROM kia_psf_yearly
            WHERE mileage > 0 AND COALESCE(BTRIM(vin), '') <> '' AND COALESCE(BTRIM(ro_no), '') <> ''
            UNION ALL
            SELECT UPPER(BTRIM(vin)), UPPER(BTRIM(r_o_no)), mileage
            FROM kia_demo_job_cards
            WHERE mileage > 0 AND COALESCE(BTRIM(vin), '') <> '' AND COALESCE(BTRIM(r_o_no), '') <> ''
            UNION ALL
            SELECT UPPER(BTRIM(vin)), UPPER(BTRIM(r_o_no)), mileage
            FROM kia_open_ro_yearly
            WHERE mileage > 0 AND COALESCE(BTRIM(vin), '') <> '' AND COALESCE(BTRIM(r_o_no), '') <> ''
          ) odo
          GROUP BY vin, ro_no
        ) psf ON psf.vin = UPPER(BTRIM(b.vin)) AND psf.ro_no = UPPER(BTRIM(b.ro_no))
        WHERE UPPER(BTRIM(b.vin)) IN (${sql.join(vins.map((v) => sql`${v}`), sql`, `)})
        ORDER BY b.bill_date DESC NULLS LAST
      `),
      db.execute(sql`
        SELECT UPPER(BTRIM(COALESCE(vin_no, ''))) AS vin, complaint_no, complaint_date, close_date, vehicle_model
        FROM kia_call_center_complaints
        WHERE UPPER(BTRIM(COALESCE(vin_no, ''))) IN (${sql.join(vins.map((v) => sql`${v}`), sql`, `)})
        ORDER BY complaint_date DESC NULLS LAST
      `),
      db.execute(sql`
        /*
         * Accessory counter sales, DEDUPLICATED. The feed is a cumulative snapshot: 8,082 raw rows
         * are only ~4,400 real lines, so summing raw rows near-doubles a customer's accessory
         * spend. The DISTINCT ON key is the line itself (bill no + item + amount + qty).
         * Cancelled bills are excluded, and so are B2B lines - those are corporate/fleet counter
         * sales that happen to share a VIN, not this retail customer's purchases.
         * customer_name and customer_mobile exist on this table and are deliberately NOT selected.
         */
        SELECT DISTINCT ON (UPPER(BTRIM(a.vin)), a.csr_bill_no, BTRIM(a.accessories_description), a.accessory_taxable_amount, a.accessories_qty)
          UPPER(BTRIM(a.vin)) AS vin,
          a.csr_bill_no,
          -- Both dates are 100% populated today; the COALESCE guards a future partial upload,
          -- because an undated bill would vanish from the timeline while its money stayed in the
          -- vehicle-card total.
          COALESCE(a.csr_bill_date, a.csr_date) AS csr_bill_date,
          BTRIM(a.accessories_description) AS description,
          a.accessories_qty,
          a.accessory_taxable_amount,
          a.tax_amount
        FROM kia_accessories_counter_sales_report a
        WHERE UPPER(BTRIM(a.vin)) IN (${sql.join(vins.map((v) => sql`${v}`), sql`, `)})
          AND a.bill_status <> 'Cancel'
          AND COALESCE(a.type_of_party, '') <> 'B2B'
      `),
      db.execute(sql`
        /*
         * Repair orders open RIGHT NOW — and proving "right now" takes three filters, because this
         * feed APPENDS a small daily batch and NEVER re-uploads or updates a row (0 of 227 ROs
         * appear in more than one batch). A July row that simply stopped being current still sits
         * here looking open forever.
         *
         *   1. Not since billed: an RO with a bill in ro_billing_report is a finished job. This one
         *      check retires 201 of 227 rows - without it the strip showed cars delivered weeks ago
         *      as "on a ramp right now".
         *   2. No closing timestamp / not sub-status Closed or Work Ended.
         *   3. Not cancelled.
         *
         * uploaded_at still travels with the row so the strip states when the snapshot was taken.
         */
        SELECT UPPER(BTRIM(o.vin)) AS vin, o.reg_no, o.model, o.r_o_no, o.ro_date, o.work_type,
               o.ro_sub_status, o.service_adv, o.estimate_amt, o.promise_date_time, o.delay_reason,
               o.uploaded_at
        FROM kia_open_ro_yearly o
        WHERE (UPPER(BTRIM(o.vin)) IN (${sql.join(vins.map((v) => sql`${v}`), sql`, `)})
               ${liveRoCustomerMatch})
          AND COALESCE(BTRIM(o.closing_date_time), '') = ''
          AND COALESCE(BTRIM(o.cancel_date), '') = ''
          AND UPPER(BTRIM(COALESCE(o.ro_sub_status, ''))) NOT IN ('CLOSED', 'WORK ENDED')
          AND NOT EXISTS (
            -- Same RO number AND same vehicle: ro_no is reused across VINs in the billing feed
            -- (537 numbers carry multiple bills, some on two different VINs), and an unqualified
            -- match would let a number collision hide a genuinely open RO. Verified to change
            -- nothing today (the shown set stays 23) - this closes the latent edge only.
            SELECT 1 FROM ro_billing_report rb
            WHERE UPPER(BTRIM(rb.ro_no)) = UPPER(BTRIM(o.r_o_no))
              AND UPPER(BTRIM(rb.vin)) = UPPER(BTRIM(o.vin))
          )
        ORDER BY o.ro_date DESC NULLS LAST
        LIMIT 5
      `),
    ])
    : [[], [], [], []]

  const servicesByVin = new Map<string, Record<string, unknown>[]>()
  for (const row of rows(servicesResult)) {
    const vin = String(row.vin)
    if (!servicesByVin.has(vin)) servicesByVin.set(vin, [])
    servicesByVin.get(vin)!.push(row)
  }
  const accessoriesByVin = new Map<string, Record<string, unknown>[]>()
  for (const row of rows(accessoriesResult)) {
    const vin = String(row.vin)
    if (!accessoriesByVin.has(vin)) accessoriesByVin.set(vin, [])
    accessoriesByVin.get(vin)!.push(row)
  }

  const complaintsByVin = new Map<string, Record<string, unknown>[]>()
  for (const row of rows(complaintsResult)) {
    const vin = String(row.vin)
    if (!complaintsByVin.has(vin)) complaintsByVin.set(vin, [])
    complaintsByVin.get(vin)!.push(row)
  }

  const vehicles: KiaProfileVehicle[] = vehicleRows.map((row) => {
    const vin = String(row.vin)
    const services = servicesByVin.get(vin) || []
    const expiry = dateStr(row.policy_expiry_date)
    return {
      vin,
      model: str(row.model),
      registration: str(row.registration_name),
      invoiceDate: dateStr(row.invoice_date),
      deliveryDate: dateStr(row.delivery_date),
      insurance: row.policyno || expiry
        ? {
          // The feed prefixes policy numbers with a stray backtick.
          policyNo: str(row.policyno)?.replace(/^`+/, '') ?? null,
          insurer: str(row.insurancecompany),
          previousInsurer: str(row.prev_ic_name),
          policyType: str(row.policytype),
          cancelled: String(row.cancelled ?? '').trim().toUpperCase() === 'YES',
          grossPremium: money(row.grosspremium),
          netPremium: money(row.netpremium),
          effectiveDate: dateStr(row.policy_effective_date),
          expiryDate: expiry,
          lapsed: Boolean(expiry && expiry < new Date().toISOString().slice(0, 10)),
        }
        : null,
      serviceCount: services.length,
      lastServiceDate: dateStr(services[0]?.bill_date),
      /*
       * Billed visits only. Summing the zeros would be harmless for the total but would silently
       * halve any average, and it would let the UI claim a complete price history it does not have —
       * so the count of unpriced visits travels alongside the money and is rendered with it.
       */
      serviceSpend: (() => {
        // Cancelled bills carry real amounts (22 rows, Rs 4.85L) and are NOT revenue.
        const billed = services
          .filter((s) => str(s.bill_status) !== 'Cancel')
          .map((s) => money(s.total_amt))
          .filter((v): v is number => v !== null)
        return billed.length ? billed.reduce((a, b) => a + b, 0) : null
      })(),
      servicesBilled: services.filter((s) => money(s.total_amt) !== null && str(s.bill_status) !== 'Cancel').length,
      servicesUnbilled: services.filter((s) => money(s.total_amt) === null || str(s.bill_status) === 'Cancel').length,
      /*
       * Billed value of bills the DMS says were never fully collected. The literals are matched
       * exactly as the DMS spells them — including 'Paymant'.
       */
      ...((() => {
        const flagged = services.filter((s) =>
          str(s.bill_status) === 'Payment Not Received' || str(s.bill_status) === 'Partial Paymant Received')
        const total = flagged.map((s) => money(s.total_amt)).filter((v): v is number => v !== null)
          .reduce((a, b) => a + b, 0)
        return { unpaidCount: flagged.length, unpaidBilledTotal: total > 0 ? total : null }
      })()),
      ...((() => {
        const lines = accessoriesByVin.get(vin) || []
        const mapped = lines
          .map((a) => ({
            billNo: str(a.csr_bill_no),
            billDate: dateStr(a.csr_bill_date),
            description: str(a.description),
            qty: (() => {
              const q = Number(a.accessories_qty)
              return Number.isFinite(q) && q > 0 ? q : null
            })(),
            amount: (money(a.accessory_taxable_amount) ?? 0) + (money(a.tax_amount) ?? 0) > 0
              ? (money(a.accessory_taxable_amount) ?? 0) + (money(a.tax_amount) ?? 0)
              : null,
          }))
          .sort((a, b) => String(b.billDate ?? '').localeCompare(String(a.billDate ?? '')))
        const spend = mapped.map((a) => a.amount).filter((v): v is number => v !== null)
          .reduce((a, b) => a + b, 0)
        return { accessories: mapped.slice(0, 40), accessoriesSpend: spend > 0 ? spend : null }
      })()),
      // Every row is our own pre-delivery inspection: a service count with no real customer visit.
      nviOnly: services.length > 0 && services.every((s) => isNvi(str(s.work_type))),
      services: withMileageDeltas(services).slice(0, 50).map((s) => ({
        roNo: str(s.ro_no),
        billNo: str(s.bill_no),
        billDate: dateStr(s.bill_date),
        roDate: dateStr(s.ro_date),
        model: str(s.model),
        registration: str(s.vehicle_reg_no),
        workType: str(s.work_type),
        advisor: str(s.service_advisor),
        amount: money(s.total_amt),
        // The odometer at this visit, and the distance since the previous one. See withMileageDeltas.
        mileage: money(s.mileage),
        mileageSinceLast: money(s.__mileageSinceLast),
        billStatus: str(s.bill_status),
        labour: money(s.labour_amt),
        parts: money(s.part_amt),
        tax: (() => {
          const l = money(s.labour_tax) ?? 0
          const p = money(s.part_tax) ?? 0
          return l + p > 0 ? l + p : null
        })(),
        discount: money(s.total_disc),
      })),
      complaints: (complaintsByVin.get(vin) || []).map((c) => ({
        complaintNo: str(c.complaint_no),
        date: dateStr(c.complaint_date),
        closeDate: dateStr(c.close_date),
        model: str(c.vehicle_model),
      })),
    }
  })

  // Sales-side history only exists for a party key; these resolved in the parallel group above.
  const enquiries: KiaCustomerProfile['enquiries'] = rows(enquiryResult).map((row) => ({
    enquiryNo: str(row.enquiry_no),
    enquiryDate: dateStr(row.enquiry_date),
    model: str(row.model),
    status: str(row.enquiry_status),
    source: str(row.enquiry_source),
    consultant: str(row.consultant_name),
    testDriveDate: dateStr(row.test_drive_date),
    bookingNo: str(row.booking_no),
    bookingDate: dateStr(row.booking_date),
    deliveryDate: dateStr(row.delivery_date),
    lostDate: dateStr(row.lost_date),
  })).sort((a, b) => String(b.enquiryDate ?? '').localeCompare(String(a.enquiryDate ?? '')))

  const bookings: KiaCustomerProfile['bookings'] = rows(bookingResult).map((row) => ({
    bookingNo: str(row.booking_no),
    bookingDate: dateStr(row.booking_date),
    model: str(row.model),
    consultant: str(row.consultant_name),
    committedDeliveryDate: dateStr(row.committed_delivery_date),
  })).sort((a, b) => String(b.bookingDate ?? '').localeCompare(String(a.bookingDate ?? '')))

  const receipts: KiaCustomerProfile['receipts'] = rows(receiptResult).map((row) => ({
    receiptDate: dateStr(row.receipt_date),
    model: str(row.model),
  }))

  if (summary.gaps.bookingNoInsurance) {
    notes.push('“No insurance” means we hold no policy for this vehicle. The customer may be insured elsewhere.')
  }
  if (summary.gaps.noRecentService) {
    notes.push(`No billed service in the last ${serviceGapMonths} months on at least one vehicle. They may be using another workshop.`)
  }

  const liveRos: KiaCustomerProfile['liveRos'] = rows(liveRoResult).map((row) => ({
    vin: str(row.vin),
    registration: str(row.reg_no),
    model: str(row.model),
    roNo: str(row.r_o_no),
    roDate: dateStr(row.ro_date),
    workType: str(row.work_type),
    subStatus: str(row.ro_sub_status),
    advisor: str(row.service_adv),
    estimate: money(row.estimate_amt),
    promisedOn: str(row.promise_date_time),
    delayReason: str(row.delay_reason),
    asOf: dateStr(row.uploaded_at),
  }))

  return { ...summary, enquiries, bookings, vehicles, receipts, liveRos, notes }
}
