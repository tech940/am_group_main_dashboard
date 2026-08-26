import 'server-only'
import { sql } from 'drizzle-orm'
import { analyticsExecute } from '@/lib/analytics/db'
import type { BrandConfig } from './brands'
import type {
  KiaCustomerGaps, KiaCustomerListFilters, KiaCustomerListResult, KiaCustomerProfile, KiaCustomerSummary,
} from '@/lib/kia/customer-profile/reader'
import { parseCustomerKey, type KiaCustomerKey } from '@/lib/kia/customer-profile/identity'

/**
 * CUSTOMER 360 — the reader for brands whose sales feed is masked at source (Hyundai, Platinum).
 *
 * It deliberately returns the SAME shape as the KIA reader so the page renders one component for
 * every brand. What differs is honesty about absence: the arrays this brand cannot populate come
 * back EMPTY, and the brand's `capabilities` (see brands.ts) tell the UI to render them as "not
 * linked" rather than as "none". An empty array and an unavailable feed look identical in JSON and
 * mean opposite things to the person reading the screen.
 *
 * See brands.ts for the measurements behind the masking, and for the last-5-VIN join that was
 * tested and rejected at a 30.5% false-match rate.
 */

/** The zero-gap set. These brands cannot compute a gap, so none is asserted. */
const NO_GAPS: KiaCustomerGaps = {
  enquiryNoBooking: false,
  bookingNoInsurance: false,
  noRecentService: false,
  openComplaint: false,
  insuranceLapsed: false,
  bookedNotDelivered: false,
}

const ZERO_GAP_COUNTS: Record<keyof KiaCustomerGaps, number> = {
  enquiryNoBooking: 0,
  bookingNoInsurance: 0,
  noRecentService: 0,
  openComplaint: 0,
  insuranceLapsed: 0,
  bookedNotDelivered: 0,
}

/*
 * Dates arrive as DD/MM/YYYY text. Day-first, NOT month-first: these are Indian DMS feeds, and
 * reading 03/04/2026 as March moves the sale a month without ever looking wrong. Anything that does
 * not match a known shape becomes NULL rather than a guess.
 *
 * ⚠️ The ::text cast is load-bearing, not defensive tidiness. Within ONE of these tables the date
 * columns have DIFFERENT types: invoice_date is text holding 'DD/MM/YYYY' while delivery_date,
 * booking_date and confirm_date are real Postgres date columns. Without the cast, BTRIM(date) fails
 * the whole statement with 42883 "function btrim(date) does not exist" — which is what made the
 * profile dialog open completely empty. A real date casts to 'YYYY-MM-DD' and is caught by the
 * second branch, so one expression now serves both column types.
 *
 * No backticks in SQL comments: they terminate the surrounding template literal.
 */
const dateSql = (col: string) => sql.raw(
  `CASE WHEN NULLIF(BTRIM(${col}::text), '') ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}'
          THEN to_date(LEFT(BTRIM(${col}::text), 10), 'DD/MM/YYYY')
        WHEN NULLIF(BTRIM(${col}::text), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN to_date(LEFT(BTRIM(${col}::text), 10), 'YYYY-MM-DD')
   END`,
)

/** dealer_code_2 first, dealer_code as the fallback — the precedence the KIA outlet key already uses. */
const OUTLET = sql.raw(
  "UPPER(BTRIM(COALESCE(NULLIF(BTRIM(s.dealer_code_2), ''), NULLIF(BTRIM(s.dealer_code), ''), '')))",
)

const CUST = sql.raw('UPPER(BTRIM(s.customerid))')

function scopePredicate(dealerScope: string[] | null) {
  if (!dealerScope) return sql`TRUE`
  /*
   * Fail CLOSED. An empty scope array means "pinned, but to nothing valid here" and must show
   * nothing rather than everything. The inverse mistake — treating an empty pin as unrestricted —
   * is what silently widened another section to every branch.
   */
  if (!dealerScope.length) return sql`FALSE`
  const codes = dealerScope.map((code) => sql`${code.trim().toUpperCase()}`)
  return sql`${OUTLET} IN (${sql.join(codes, sql`, `)})`
}

/**
 * The buyer directory for a masked brand.
 *
 * Keyed on (customerid, outlet) exactly as KIA is: a DMS party id is reused across outlets, and
 * collapsing on the id alone shows one person another person's purchases.
 *
 * Buyers only, by construction — this reads the sales feed, so every row is a completed purchase.
 */
export async function listSalesOnlyCustomers(
  config: BrandConfig,
  filters: KiaCustomerListFilters = {},
): Promise<KiaCustomerListResult> {
  const page = Math.max(1, Number(filters.page) || 1)
  const pageSize = Math.min(100, Math.max(10, Number(filters.pageSize) || 25))
  const offset = (page - 1) * pageSize
  const table = sql.raw(config.salesTable)

  const search = String(filters.search || '').trim().toUpperCase()
  const searchPredicate = search
    ? sql`(UPPER(BTRIM(s.registration_name)) LIKE ${`%${search}%`}
        OR ${CUST} = ${search}
        OR UPPER(BTRIM(s.vin_number)) LIKE ${`%${search}%`}
        OR UPPER(BTRIM(s.model)) LIKE ${`%${search}%`})`
    : sql`TRUE`

  const chosenDealer = String(filters.dealerCode || '').trim().toUpperCase()
  const dealerPredicate = chosenDealer ? sql`${OUTLET} = ${chosenDealer}` : sql`TRUE`

  const list = await analyticsExecute<Record<string, unknown>>(sql`
    WITH base AS (
      SELECT
        ${CUST} AS customer_id,
        ${OUTLET} AS outlet,
        MAX(BTRIM(s.registration_name)) AS name,
        MAX(NULLIF(BTRIM(s.city), '')) AS city,
        COUNT(DISTINCT NULLIF(UPPER(BTRIM(s.vin_number)), ''))::int AS vehicle_count,
        MAX(${dateSql('s.invoice_date')}) AS last_invoice
      FROM ${table} s
      WHERE COALESCE(BTRIM(s.customerid), '') <> ''
        AND COALESCE(BTRIM(s.vin_number), '') <> ''
        AND ${scopePredicate(filters.dealerScope ?? null)}
        AND ${dealerPredicate}
        AND ${searchPredicate}
      GROUP BY 1, 2
    )
    SELECT base.*, COUNT(*) OVER ()::int AS total_rows
    FROM base
    ORDER BY last_invoice DESC NULLS LAST, name ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `)

  const total = list.length ? Number(list[0].total_rows) || 0 : 0

  const rows: KiaCustomerSummary[] = list.map((row) => ({
    key: `cid:${String(row.outlet || '')}:${String(row.customer_id || '')}`,
    kind: 'customer' as const,
    customerId: String(row.customer_id || '') || null,
    name: (row.name as string) || null,
    // Masked at source. Forwarding the mask would only paint a row of asterisks in the UI; NULL lets
    // the client render the honest "not in this feed" state instead.
    phone: null,
    email: null,
    city: (row.city as string) || null,
    dealerCode: String(row.outlet || '') || null,
    enquiryCount: 0,
    bookingCount: 0,
    vehicleCount: Number(row.vehicle_count) || 0,
    serviceCount: 0,
    lastActivityDate: row.last_invoice ? String(row.last_invoice).slice(0, 10) : null,
    gaps: { ...NO_GAPS },
    gapCount: 0,
  }))

  return {
    rows,
    total,
    page,
    pageSize,
    /*
     * All zero, and the UI hides the gap panel entirely for these brands. A gap panel reading "0
     * needing attention" would be read as "nothing needs attention" when the truth is "we cannot
     * tell" — the single most misleading thing this section could say.
     */
    gapCounts: { ...ZERO_GAP_COUNTS },
    totalCustomers: total,
  }
}

/** One buyer's purchases. Everything past the sale is unavailable for these brands — see brands.ts. */
export async function getSalesOnlyCustomerProfile(
  config: BrandConfig,
  rawKey: string | KiaCustomerKey,
  options: { dealerScope?: string[] | null } = {},
): Promise<KiaCustomerProfile | null> {
  const key = typeof rawKey === 'string' ? parseCustomerKey(rawKey) : rawKey
  if (!key || key.kind !== 'customer') return null

  const table = sql.raw(config.salesTable)
  const outlet = String(key.outlet || '').trim().toUpperCase()
  const outletPredicate = outlet ? sql`AND ${OUTLET} = ${outlet}` : sql`AND TRUE`

  const list = await analyticsExecute<Record<string, unknown>>(sql`
    SELECT
      ${CUST} AS customer_id,
      ${OUTLET} AS outlet,
      BTRIM(s.registration_name) AS name,
      NULLIF(BTRIM(s.city), '') AS city,
      UPPER(BTRIM(s.vin_number)) AS vin,
      NULLIF(BTRIM(s.model), '') AS model,
      NULLIF(BTRIM(s.variant), '') AS variant,
      ${dateSql('s.invoice_date')} AS invoice_date,
      ${dateSql('s.delivery_date')} AS delivery_date
    FROM ${table} s
    WHERE ${CUST} = ${String(key.value).toUpperCase()}
      ${outletPredicate}
      AND COALESCE(BTRIM(s.vin_number), '') <> ''
      AND ${scopePredicate(options.dealerScope ?? null)}
    ORDER BY ${dateSql('s.invoice_date')} DESC NULLS LAST
  `)

  if (!list.length) return null

  const first = list[0]
  const iso = (value: unknown) => (value ? String(value).slice(0, 10) : null)

  return {
    key: `cid:${String(first.outlet || '')}:${String(first.customer_id || '')}`,
    kind: 'customer',
    customerId: String(first.customer_id || '') || null,
    name: (first.name as string) || null,
    phone: null,
    email: null,
    city: (first.city as string) || null,
    dealerCode: String(first.outlet || '') || null,
    enquiryCount: 0,
    bookingCount: 0,
    vehicleCount: list.length,
    serviceCount: 0,
    lastActivityDate: iso(first.invoice_date),
    gaps: { ...NO_GAPS },
    gapCount: 0,
    enquiries: [],
    bookings: [],
    receipts: [],
    // No workshop link for this brand, so there is nothing that could be on a ramp.
    liveRos: [],
    vehicles: list.map((row) => ({
      // The masked VIN is passed through exactly as stored. It is what the feed holds, and the real
      // stored value is more useful to somebody reconciling against the DMS than a blank would be.
      vin: String(row.vin || ''),
      model: [row.model, row.variant].filter(Boolean).join(' ') || null,
      registration: null,
      invoiceDate: iso(row.invoice_date),
      deliveryDate: iso(row.delivery_date),
      insurance: null,
      serviceCount: 0,
      lastServiceDate: null,
      /*
       * Zero and empty here mean "this brand has no workshop link at all", not "this customer never
       * came in". The capability flags in brands.ts are what the UI reads to tell those apart —
       * `capabilities.service` is false for these brands, so the client renders "not linked" rather
       * than a figure. Never render these values directly for a sales-only brand.
       */
      serviceSpend: null,
      servicesBilled: 0,
      servicesUnbilled: 0,
      nviOnly: false,
      accessories: [],
      accessoriesSpend: null,
      unpaidCount: 0,
      unpaidBilledTotal: null,
      services: [],
      complaints: [],
    })),
    // Surfaced in the UI, never hidden: this is the reason every panel below the purchase is empty.
    notes: config.salesOnly ? [config.salesOnly] : [],
  }
}
