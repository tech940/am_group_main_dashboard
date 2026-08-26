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
      ro.last_service_date
    FROM latest_sales s
    LEFT JOIN latest_insurance ins ON UPPER(BTRIM(ins.vinno)) = UPPER(BTRIM(s.vin_number))
    -- WARNING: kia_sales_report.registration_name is the NAME the vehicle is registered to
    -- ("PRAN JI MANTOO"), NOT a number plate. The only real plate we hold is
    -- ro_billing_report.vehicle_reg_no (5,422 of 5,505 rows populated).
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS service_count, MAX(r.bill_date) AS last_service_date,
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
      BOOL_OR(NOT has_insurance) AS any_without_insurance,
      BOOL_OR(insurance_lapsed) AS any_insurance_lapsed,
      BOOL_OR(last_service_date IS NULL
        OR last_service_date < (CURRENT_DATE - (${serviceGapMonths} || ' months')::interval)) AS any_service_overdue
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
    insurer: string | null
    effectiveDate: string | null
    expiryDate: string | null
    lapsed: boolean
  } | null
  serviceCount: number
  lastServiceDate: string | null
  services: { billDate: string | null; roDate: string | null; model: string | null; registration: string | null }[]
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
      ins.policyno, ins.prev_ic_name, ins.policy_effective_date, ins.policy_expiry_date
    FROM scoped_sales s
    LEFT JOIN LATERAL (
      SELECT vehicle_reg_no FROM ro_billing_report
      WHERE UPPER(BTRIM(vin)) = UPPER(BTRIM(s.vin_number)) AND COALESCE(vehicle_reg_no, '') <> ''
      ORDER BY bill_date DESC NULLS LAST LIMIT 1
    ) ro ON TRUE
    LEFT JOIN LATERAL (
      SELECT policyno, prev_ic_name, policy_effective_date, policy_expiry_date
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
        ins.policyno, ins.prev_ic_name, ins.policy_effective_date, ins.policy_expiry_date
      FROM (SELECT 1) t
      LEFT JOIN LATERAL (
        SELECT policyno, prev_ic_name, policy_effective_date, policy_expiry_date
        FROM kia_insurance WHERE UPPER(BTRIM(vinno)) = ${key.value}
        ORDER BY policy_expiry_date DESC NULLS LAST, uploaded_at DESC NULLS LAST LIMIT 1
      ) ins ON TRUE
    `)
    vehicleRows = rows(fallback)
    notes.push('This vehicle has no sales record with us — it is known only from workshop visits, so purchase details are unavailable.')
  }

  const vins = vehicleRows.map((row) => String(row.vin)).filter(Boolean)

  const [servicesResult, complaintsResult] = vins.length
    ? await Promise.all([
      db.execute(sql`
        SELECT UPPER(BTRIM(vin)) AS vin, bill_date, ro_date, model, vehicle_reg_no
        FROM ro_billing_report
        WHERE UPPER(BTRIM(vin)) IN (${sql.join(vins.map((v) => sql`${v}`), sql`, `)})
        ORDER BY bill_date DESC NULLS LAST
      `),
      db.execute(sql`
        SELECT UPPER(BTRIM(COALESCE(vin_no, ''))) AS vin, complaint_no, complaint_date, close_date, vehicle_model
        FROM kia_call_center_complaints
        WHERE UPPER(BTRIM(COALESCE(vin_no, ''))) IN (${sql.join(vins.map((v) => sql`${v}`), sql`, `)})
        ORDER BY complaint_date DESC NULLS LAST
      `),
    ])
    : [[], []]

  const servicesByVin = new Map<string, Record<string, unknown>[]>()
  for (const row of rows(servicesResult)) {
    const vin = String(row.vin)
    if (!servicesByVin.has(vin)) servicesByVin.set(vin, [])
    servicesByVin.get(vin)!.push(row)
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
          insurer: str(row.prev_ic_name),
          effectiveDate: dateStr(row.policy_effective_date),
          expiryDate: expiry,
          lapsed: Boolean(expiry && expiry < new Date().toISOString().slice(0, 10)),
        }
        : null,
      serviceCount: services.length,
      lastServiceDate: dateStr(services[0]?.bill_date),
      services: services.slice(0, 50).map((s) => ({
        billDate: dateStr(s.bill_date),
        roDate: dateStr(s.ro_date),
        model: str(s.model),
        registration: str(s.vehicle_reg_no),
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

  return { ...summary, enquiries, bookings, vehicles, receipts, notes }
}
