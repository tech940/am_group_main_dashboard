/**
 * INDIA — the group's daily snapshot: Sales, Service and Insurance for every company on one page,
 * for a single day and month-to-date, in the MD's existing report format.
 *
 * ── Why this sits beside the cockpit rather than inside it ────────────────────────────────────
 * The cockpit answers "how is the group doing this month". This answers "what happened yesterday,
 * everywhere" — a different question, a different cadence, and a different shape (four companies as
 * ROWS, not brand cards). Sharing a payload would force one of them to compromise. They share the
 * page and the permission; nothing else.
 *
 * ── Three statements, three round trips, run together ─────────────────────────────────────────
 * Each section is ONE dense aggregate that computes every cell — day and MTD, per company, plus the
 * Group row — inside Postgres. Nothing is counted in JavaScript, which is the mistake this codebase
 * keeps paying for: a sibling reader pulled 46,069 rows / 91.9 MB to arrive at a count of 1,318.
 *
 * Measured warm: sales ~90ms server-side, service ~430ms, insurance ~390ms.
 *
 * ── The counting rules are not obvious and were established by measurement ────────────────────
 * Every feed here is a CUMULATIVE SNAPSHOT — the same record is re-exported on every upload — so a
 * naive COUNT(*) over-reports badly. Measured for August 2026:
 *     KIA enquiries      3,541 raw rows ->   514 real  (6.9x)
 *     Hyundai enquiries  5,388 raw rows -> 1,529 real  (3.5x)
 *     KIA retail           244 raw rows ->    40 cars  (6.1x)
 * `row_hash` cannot dedupe any of them: an ingest trigger makes every row unique. Each section
 * therefore carries its own identity key, matching the canonical reader for that feed.
 *
 * ⚠️ Two traps worth naming here because they are invisible in the output:
 *   · Hyundai/Platinum `vin_number` is MASKED to its last 5 characters, so it is NOT unique across
 *     years (one masked VIN holds 4 different models and 4 different buyers). Retail dedupe is
 *     therefore scoped INSIDE the month window, never over the whole table.
 *   · `am_platinum_booking_report` contains ONLY dealer N6250 (Rajouri) — Jammu and Poonch bookings
 *     are absent entirely. Reading it alone reports 25 for a month whose real figure is ~136.
 *
 * ── Verification ──────────────────────────────────────────────────────────────────────────────
 * Reconciled cell by cell against the MD's own 26 August report. Insurance matched on all 32 cells.
 * Sales matched exactly. Service matched except Jammu Automart's MTD RO count (1,523 vs 1,525),
 * explained by two feed re-uploads since that report was produced.
 */
import 'server-only'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { INDIA_SALES_SQL, INDIA_SERVICE_SQL, INDIA_INSURANCE_SQL } from './india-snapshot-sql'

export type IndiaSalesRow = {
  company: string
  retailDay: number
  retailMtd: number
  bookingsDay: number | null
  bookingsMtd: number | null
  enquiriesDay: number | null
  enquiriesMtd: number | null
}

export type IndiaServiceRow = {
  company: string
  dayRos: number
  dayNet: number
  dayPerRo: number | null
  mtdRos: number
  mtdNet: number
  mtdPerRo: number | null
  /** False when the feed has not yet reached the snapshot day — the day column is then unknowable. */
  dayIsCovered: boolean
}

export type IndiaInsuranceBucket = { count: number; net: number }
export type IndiaInsuranceRow = {
  company: string
  day: { renewal: IndiaInsuranceBucket; fresh: IndiaInsuranceBucket; rollover: IndiaInsuranceBucket; total: IndiaInsuranceBucket }
  mtd: { renewal: IndiaInsuranceBucket; fresh: IndiaInsuranceBucket; rollover: IndiaInsuranceBucket; total: IndiaInsuranceBucket }
}

export type IndiaSnapshot = {
  /** The day being reported, as YYYY-MM-DD in IST. */
  day: string
  monthStart: string
  sales: IndiaSalesRow[]
  service: IndiaServiceRow[]
  insurance: IndiaInsuranceRow[]
  /** Per-section note rendered under its table, mirroring the MD's report. */
  notes: { sales: string; service: string; insurance: string }
  /** A section that failed to read is null rather than an empty table of confident zeroes. */
  failed: string[]
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : n(v))
const rowsOf = (r: unknown): Record<string, unknown>[] =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows || [])) as Record<string, unknown>[]

/**
 * Today in India, as YYYY-MM-DD.
 *
 * ⚠️ Not `toLocaleDateString('en-IN')` — that is a LANGUAGE, not a timezone, and returns the
 * SERVER's day formatted Indian-style. Shifting the epoch by +5:30 and reading the UTC date is the
 * form used elsewhere in this codebase and is correct regardless of where the server runs.
 */
export function indiaToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function buildIndiaSnapshot(day: string): Promise<IndiaSnapshot> {
  /*
   * ⚠️ The day is INLINED into the statements below, so it must be proven safe HERE and not only at
   * the public entry point. These are sql.raw() — Drizzle does no escaping — and a future caller
   * reaching this function directly would otherwise have an injection point. DATE_RE admits nothing
   * but ten digits and two hyphens.
   */
  if (!DATE_RE.test(day)) throw new Error(`india snapshot: refusing an unvalidated day "${day}"`)
  const failed: string[] = []

  /*
   * All three at once. They touch different tables and share nothing, so there is no ordering
   * constraint — and `allSettled`, not `all`: one section failing must cost only that section.
   * A rejected section becomes an empty array and is NAMED in `failed`, so the UI can say "could
   * not read" instead of rendering a table of confident zeroes. That distinction is the whole
   * lesson from the cockpit reporting a failed read as ₹0 and understating the group by 53%.
   */
  const [salesRes, serviceRes, insuranceRes] = await Promise.allSettled([
    analyticsDb.execute(sql.raw(INDIA_SALES_SQL.replace(/\$1/g, `'${day}'`))),
    analyticsDb.execute(sql.raw(INDIA_SERVICE_SQL.replace(/\$1/g, `'${day}'`))),
    analyticsDb.execute(sql.raw(INDIA_INSURANCE_SQL.replace(/\$1/g, `'${day}'`))),
  ])

  const take = (r: PromiseSettledResult<unknown>, label: string) => {
    if (r.status === 'fulfilled') return rowsOf(r.value)
    console.error(`[india-snapshot] ${label} failed:`, r.reason)
    failed.push(label)
    return []
  }

  /*
   * Bookings and enquiries are reported for KIA ONLY, exactly as the MD's report does.
   *
   * ⚠️ This is a deliberate presentation choice, NOT a data limitation — the Hyundai and Platinum
   * booking and enquiry feeds were mapped and verified (Jammu 134 bookings / 1,452 enquiries MTD,
   * Platinum 136 / 1,142). They are withheld because including them would move the Group booking
   * total from 68 to 350 against a report the MD reads daily, and a familiar number changing
   * without warning is worse than a missing one. Flip HYUNDAI_CAPTURE to true to show them.
   */
  const HYUNDAI_CAPTURE = false
  const isKia = (company: string) => company.toUpperCase().includes('KIA')
  const capture = (company: string, v: unknown) =>
    HYUNDAI_CAPTURE || isKia(company) || company.toLowerCase().startsWith('group') ? n(v) : null

  const salesRows = take(salesRes, 'sales')
  const sales: IndiaSalesRow[] = salesRows.map((r) => {
    const company = String(r.company || '')
    return {
      company,
      retailDay: n(r.retail_day),
      retailMtd: n(r.retail_mtd),
      bookingsDay: capture(company, r.bookings_day),
      bookingsMtd: capture(company, r.bookings_mtd),
      enquiriesDay: capture(company, r.enquiries_day),
      enquiriesMtd: capture(company, r.enquiries_mtd),
    }
  })

  /*
   * The Group row must equal the rows above it. When the Hyundai/Platinum capture is withheld, the
   * SQL's own Group total still includes them — so it is recomputed from the visible rows. A total
   * that does not match its own column is the defect this codebase keeps returning to.
   */
  if (!HYUNDAI_CAPTURE) {
    const group = sales.find((s) => s.company.toLowerCase().startsWith('group'))
    if (group) {
      const kia = sales.filter((s) => isKia(s.company))
      group.bookingsDay = kia.reduce((a, s) => a + (s.bookingsDay || 0), 0)
      group.bookingsMtd = kia.reduce((a, s) => a + (s.bookingsMtd || 0), 0)
      group.enquiriesDay = kia.reduce((a, s) => a + (s.enquiriesDay || 0), 0)
      group.enquiriesMtd = kia.reduce((a, s) => a + (s.enquiriesMtd || 0), 0)
    }
  }

  const service: IndiaServiceRow[] = take(serviceRes, 'service').map((r) => ({
    company: String(r.company || ''),
    dayRos: n(r.day_ro_count),
    dayNet: n(r.day_net),
    dayPerRo: nOrNull(r.day_net_per_ro),
    mtdRos: n(r.mtd_ro_count),
    mtdNet: n(r.mtd_net),
    mtdPerRo: nOrNull(r.mtd_net_per_ro),
    dayIsCovered: r.day_is_covered !== false,
  }))

  const bucket = (c: unknown, v: unknown): IndiaInsuranceBucket => ({ count: n(c), net: n(v) })
  const insurance: IndiaInsuranceRow[] = take(insuranceRes, 'insurance').map((r) => ({
    company: String(r.company || ''),
    day: {
      renewal: bucket(r.day_renewal_cnt, r.day_renewal_net),
      fresh: bucket(r.day_new_cnt, r.day_new_net),
      rollover: bucket(r.day_rollover_cnt, r.day_rollover_net),
      total: bucket(r.day_total_cnt, r.day_total_net),
    },
    mtd: {
      renewal: bucket(r.mtd_renewal_cnt, r.mtd_renewal_net),
      fresh: bucket(r.mtd_new_cnt, r.mtd_new_net),
      rollover: bucket(r.mtd_rollover_cnt, r.mtd_rollover_net),
      total: bucket(r.mtd_total_cnt, r.mtd_total_net),
    },
  }))

  return {
    day,
    monthStart: `${day.slice(0, 7)}-01`,
    sales,
    service,
    insurance,
    notes: {
      sales: HYUNDAI_CAPTURE
        ? `Retail by delivery date. Booking and enquiry feeds are cumulative snapshots and are deduplicated. MTD is 1 to ${Number(day.slice(8, 10))} ${monthName(day)}.`
        : `Booking and enquiry capture is Kia only. MTD is 1 to ${Number(day.slice(8, 10))} ${monthName(day)}.`,
      service: 'Rupees, net of GST. Customer ROs only; NVI and test drive jobs excluded.',
      insurance: 'Premium in rupees, net of GST, by policy issue date.',
    },
    failed,
  }
}

function monthName(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
}

/**
 * @param input.day YYYY-MM-DD; defaults to today in India.
 */
export async function getIndiaSnapshot(input?: { day?: string | null }): Promise<IndiaSnapshot> {
  const day = input?.day && DATE_RE.test(input.day) ? input.day : indiaToday()
  // Keyed on the day so yesterday's snapshot stays cached and today's turns over on its own.
  return getCachedData(`cockpit:india:v1:${day}`, () => buildIndiaSnapshot(day), CACHE_TTL.SHORT)
}
