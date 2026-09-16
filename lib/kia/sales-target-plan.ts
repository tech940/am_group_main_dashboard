import 'server-only'

import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analyticsDb } from '@/lib/analytics/db'
import { kiaSalesCommitments, kiaSalesTargets } from '@/lib/db/schema'
import { getSalesStockSource } from '@/lib/brands/sales-stock-sources'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { INDIA_TIME_ZONE } from '@/lib/date-time'

/**
 * Sales Target Plan — the month's plan against what actually happened, per consultant.
 *
 * ── What this replaces ───────────────────────────────────────────────────────────────────────────
 * "KIA JAMMU SALES TARGET PLG.xlsx": 36 sheets, 19 of them the same ~90-column monthly grid, holding
 * 864 cells that currently evaluate to an error (139 in the current month, 64 of them #REF! that have
 * killed every weekly total from column AA onward).
 *
 * Measured against this feed, roughly 95% of that workbook is ACTUALS being re-typed from the DMS
 * export the dashboard already reads each morning. For September 2026, Jammu's 13 consultants:
 *
 *     enquiries sheet 244 ·  feed 255
 *     test drv  sheet 135 ·  feed 145
 *
 * The small gaps are typing lag, not different data.
 *
 * ── The shape of the thing (owner decision, 2026-09-16) ──────────────────────────────────────────
 * A COMMITMENT IS DAILY and it is the only thing anyone types — `kia_sales_daily_commitments`, one
 * row per consultant per day. The month's commitment is SUM(days), derived here and stored nowhere.
 *
 * WHAT WAS ACHIEVED IS NEVER TYPED. It is read from the same DMS report feeds the Sales Report
 * section reads, so the two cannot disagree by construction.
 *
 * ⚠️ Do not reconcile the achievement figures against the workbook cell-for-cell. Its "27 bookings"
 * sits under "Current Month Enquiry" — it counts September-COHORT enquiries that converted, not
 * bookings taken in September (38). They answer different questions and matching them would mean
 * breaking one of them.
 *
 * ── The four rules this module exists to hold ────────────────────────────────────────────────────
 *
 * 1. ⚠️ THE OUTLET IS `dealer_code_2` FIRST. On 2026-07-22 the KIA feed changed shape: `dealer_code`
 *    became the parent code JK402 on EVERY row and the real outlet moved into `dealer_code_2`.
 *    Because `dealer_code` is never empty, a COALESCE that reads it first never reaches the real
 *    value. This was live in lib/kia/sales-performance.ts until 2026-09-16 and it read, for
 *    September, Jammu 106 bookings / 68 deliveries and Udhampur ZERO — against a true 78/28 and
 *    38/30. A no-op before Jul-2026 (the column is NULL on 100% of those rows).
 *
 * 2. ⚠️ ONE ENQUIRY IS NOT ONE ROW. `kia_enquiry_report` re-exports the whole book on every upload:
 *    56,925 rows carry 10,328 distinct enquiries. COUNT(*) counts UPLOADS — September reads 3,009
 *    enquiries instead of 314, a 9.6× inflation that would flatter every conversion rate computed
 *    against it. One canonical row per enquiry is picked FIRST, then filtered: COUNT(DISTINCT …)
 *    fixes a total but breaks every breakdown, because duplicates that disagree about consultant
 *    count once in each group. See [[hyundai-enquiry-duplicates]] — same defect, different feed.
 *
 *    ⚠️ AND THE KEY IS (OUTLET, ENQUIRY NUMBER), NOT THE NUMBER ALONE. KIA's DMS issues enquiry
 *    numbers PER DEALER: 1,821 numbers are in use at BOTH JK402 and JK501 as different customers.
 *    Partitioning on the number alone collapsed those pairs and dropped the loser — September Jammu
 *    read 229 enquiries against a true 255. Sales Report namespaces every dedupe key by dealer for
 *    exactly this reason.
 *
 *    ⚠️ The date filter is deliberately OUTSIDE the window. Duplicates can disagree about
 *    `enquiry_date`; filtering inside would let a stale copy win the ROW_NUMBER and change the month
 *    an enquiry lands in.
 *
 * 3. ⚠️ BOOKINGS AND RETAILS COME FROM THE SAME PLACE THE REST OF THE DASHBOARD READS THEM — the
 *    booking feed (deduped on booking_no, cancellations excluded) and the sales feed (retail =
 *    `delivery_date`, deduped on VIN). NOT from this enquiry table's own booking_date/retail_date
 *    columns, which are close but not equal: counting those gives 39 bookings for September where
 *    the booking feed gives 27, because a cancelled booking keeps its date here. A planning screen
 *    that disagrees with Sales Report is a screen nobody trusts twice.
 *
 *    ⚠️ RETAIL = delivery_date, never invoice_date — the latter is TEXT in 'DD/MM/YYYY' and matched
 *    the MD's own deck in 1 of 14 outlet-months against delivery_date's 12.
 *
 * 4. ⚠️ PACE EXCLUDES SUNDAYS, because the showroom does. The workbook writes "SUNDAY" across those
 *    rows in its day-wise sheets rather than expecting nil against a target. Judging a consultant on
 *    day 15 of 30 against 50% of target, when 4 of the elapsed 15 were Sundays, invents a shortfall.
 */

const SALES_TABLE = getSalesStockSource('kia')!.tables.sales

export const KIA_PLAN_OUTLETS = [
  { code: 'ALL', label: 'All Outlets (Both Dealers)' },
  { code: 'JK402', label: 'Jammu (JK402)' },
  { code: 'JK501', label: 'Udhampur (JK501)' },
] as const

export type KiaPlanOutlet = (typeof KIA_PLAN_OUTLETS)[number]['code']

export function isPlanOutlet(value: unknown): value is KiaPlanOutlet {
  return KIA_PLAN_OUTLETS.some((o) => o.code === value)
}

/**
 * Rule 1. `alias` is the table alias the caller used, or '' for an unaliased table.
 *
 * ⚠️ TWO COLUMNS, NOT THREE. Other readers add a `main_dealer_code` fallback, which is unreachable —
 * `dealer_code` is never empty, so the COALESCE always stops one term earlier — and it does not even
 * exist under that name on all three feeds: kia_enquiry_report and kia_sales_report have
 * `main_dealer_code`, kia_booking_report has `main_dealer`. Naming it here 42703s the whole query on
 * the booking feed. The two columns that carry the answer are the two that are read.
 */
function outletSql(alias: string) {
  const p = alias ? `${alias}.` : ''
  return sql.raw(`UPPER(BTRIM(COALESCE(
    NULLIF(BTRIM(${p}dealer_code_2), ''),
    NULLIF(BTRIM(${p}dealer_code), ''),
    ''
  )))`)
}

export type PlanMetricKey = 'enquiries' | 'testDrives' | 'bookings' | 'retails'

export const PLAN_METRICS: { key: PlanMetricKey; label: string; short: string }[] = [
  { key: 'enquiries', label: 'Enquiries', short: 'Enq' },
  { key: 'testDrives', label: 'Test Drives', short: 'TD' },
  { key: 'bookings', label: 'Bookings', short: 'Bkg' },
  { key: 'retails', label: 'Retails', short: 'Retail' },
]

export type PlanCell = {
  actual: number
  /** The month's commitment: the SUM of the days committed inside it. */
  target: number
  /**
   * The commitment for the days that have actually happened. This is what `actual` is judged
   * against — not a straight-line share of the month.
   */
  committedToDate: number
  /** actual ÷ target, or null when nothing is committed — never 0, which would read as "failing". */
  achievement: number | null
  /**
   * actual − committedToDate. Positive is ahead. Null when nothing has been committed, because
   * there is then nothing to be behind.
   *
   * ⚠️ NOT a straight-line pace estimate. Once commitments are daily, "where you should be today" is
   * a number somebody actually wrote down, so the gap is exact — no assumption about how the month
   * is meant to be spread, and Sundays need no special case because nobody commits to one.
   */
  gap: number | null
}

export type PlanConsultantRow = {
  consultant: string
  teamLeader: string | null
  enquiries: PlanCell
  testDrives: PlanCell
  bookings: PlanCell
  retails: PlanCell
  /** The single number the table sorts on: the retail gap, then the booking gap. */
  worstGap: number | null
  hasAnyTarget: boolean
  /** How many days of this month this consultant has a DAY commitment recorded for. */
  committedDays: number
  /**
   * Which kind of commitment the month figure came from.
   * 'month' — somebody signed up to a monthly number (it wins).
   * 'days'  — only day commitments exist; the month figure is their sum.
   * 'none'  — nothing has been committed.
   */
  commitmentBasis: 'month' | 'days' | 'none'
  /** The monthly retail commitment, when one was made. Null when only days exist. */
  monthCommitted: number | null
  /** The retails planned across the days so far. Null when no day has been committed. */
  daysPlanned: number | null
  /**
   * This person leads a team. They still carry their own numbers — three of Jammu's four leaders have
   * never filed an enquiry, but Akash Bhat sold 626 of them before moving up, and a leader who sells
   * must be counted like anyone else.
   */
  isTeamLeader: boolean
  /** The DMS employee id this row was resolved to, or null when the feed left it blank. */
  employeeId: string | null
}

/**
 * One day, both sides of it.
 *
 * The bare metric keys are what ACTUALLY happened, read from the DMS feeds. `committed` is what was
 * promised for that day. ⚠️ `hasCommitment` is separate from the numbers on purpose: a day committed
 * as zero and a day nobody filled in both read `retails: 0`, and only one of them is a decision.
 */
export type PlanDay = {
  /** ISO date, IST calendar day. */
  date: string
  day: number
  isSunday: boolean
  isFuture: boolean
  enquiries: number
  testDrives: number
  bookings: number
  retails: number
  committed: { enquiries: number; testDrives: number; bookings: number; retails: number }
  hasCommitment: boolean
}

export type PlanTeamRow = {
  teamLeader: string
  consultants: number
  enquiries: PlanCell
  testDrives: PlanCell
  bookings: PlanCell
  retails: PlanCell
}

export type SalesTargetPlanPayload = {
  context: {
    year: number
    month: number
    label: string
    outlet: KiaPlanOutlet
    outletLabel: string
    /** Calendar days in the month. */
    monthDays: number
    /** Days of the month already gone, in IST. Equals monthDays for a past month. */
    daysElapsed: number
    /** Sundays excluded — see rule 4. */
    workingDays: number
    workingDaysElapsed: number
    /** workingDaysElapsed ÷ workingDays. 0..1. */
    elapsedShare: number
    isCurrentMonth: boolean
  }
  totals: {
    enquiries: PlanCell
    testDrives: PlanCell
    bookings: PlanCell
    retails: PlanCell
  }
  consultants: PlanConsultantRow[]
  teams: PlanTeamRow[]
  daily: PlanDay[]
  availableMonths: { year: number; month: number; label: string }[]
  /** When the DMS feed was last uploaded. The screen must show it — these are yesterday's numbers
   *  until this morning's export lands, and a figure without its as-of time invites the wrong call. */
  dataAsOf: string | null
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : []
}
function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
function nameKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: INDIA_TIME_ZONE })
    .format(new Date(Date.UTC(year, month - 1, 1)))
}

/** Today's calendar date in IST, as {year, month, day}. */
function istToday(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const [y, m, d] = parts.split('-').map((v) => parseInt(v, 10))
  return { year: y, month: m, day: d }
}

/**
 * Working days in [1..throughDay] of the month, Sundays excluded (rule 4).
 * Uses UTC date maths on a Y/M/D triple, so it never drifts with the server's own timezone.
 */
function workingDaysUpTo(year: number, month: number, throughDay: number): number {
  let count = 0
  for (let day = 1; day <= throughDay; day++) {
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 0) count++
  }
  return count
}

/**
 * ⚠️ `hasCommitment` is a separate argument from the numbers on purpose. A consultant who committed
 * ZERO retails every day this month has a plan and is meeting it; a consultant nobody has asked has
 * no plan. Both have target 0, and they must not share a colour — the second is not behind.
 */
function cell(actual: number, target: number, committedToDate: number, hasCommitment: boolean): PlanCell {
  if (!hasCommitment) {
    return { actual, target: 0, committedToDate: 0, achievement: null, gap: null }
  }
  return {
    actual,
    target,
    committedToDate,
    achievement: target > 0 ? actual / target : null,
    gap: Math.round((actual - committedToDate) * 10) / 10,
  }
}

type Counts = { enquiries: number; testDrives: number; bookings: number; retails: number }
const zero = (): Counts => ({ enquiries: 0, testDrives: 0, bookings: 0, retails: 0 })

/**
 * ⚠️ CACHED WRAPPER — call this, not the builder.
 *
 * Four aggregate queries plus a targets read on a ~170 ms-RTT link. SHORT ttl because this is an
 * operational figure people watch move during the day; getCachedData serves the stale entry while
 * refreshing behind it, so the wait is paid once rather than per viewer.
 *
 * ⚠️ BUMP THE VERSION IN THIS KEY whenever the payload shape or any counting rule changes. A shape
 * change served from a v-N entry looks exactly like the change not working.
 */
export async function getSalesTargetPlan(input: {
  year?: number | null
  month?: number | null
  outlet?: string | null
}): Promise<SalesTargetPlanPayload> {
  const outlet: KiaPlanOutlet = isPlanOutlet(input.outlet) ? input.outlet : 'JK402'
  const today = istToday()
  const year = input.year && Number.isFinite(input.year) ? Math.floor(input.year) : today.year
  const month = input.month && Number.isFinite(input.month) && input.month >= 1 && input.month <= 12
    ? Math.floor(input.month)
    : today.month
  const key = `kia:sales-target-plan:v7-scope:${outlet}:${year}-${String(month).padStart(2, '0')}`
  return getCachedData(key, () => buildSalesTargetPlan({ year, month, outlet }), CACHE_TTL.SHORT)
}

async function buildSalesTargetPlan(input: {
  year: number
  month: number
  outlet: KiaPlanOutlet
}): Promise<SalesTargetPlanPayload> {
  const { year, month, outlet } = input
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  // month is 1-based and Date.UTC's month arg is 0-based, so (year, month, 1) is the 1st of the NEXT month.
  const endExclusive = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate()

  const today = istToday()
  const isCurrentMonth = today.year === year && today.month === month
  const isFutureMonth = year > today.year || (year === today.year && month > today.month)
  const daysElapsed = isFutureMonth ? 0 : isCurrentMonth ? today.day : monthDays

  const workingDays = workingDaysUpTo(year, month, monthDays)
  const workingDaysElapsed = workingDaysUpTo(year, month, daysElapsed)
  const elapsedShare = workingDays > 0 ? workingDaysElapsed / workingDays : 0

  const outletE = outletSql('c')
  const isAll = outlet === 'ALL'
  const outletFilter = isAll ? sql`TRUE` : sql`outlet = ${outlet}`
  const outletEFilter = isAll ? sql`TRUE` : sql`${outletE} = ${outlet}`

  const [enquiryRes, bookingRes, retailRes, monthsRes, freshnessRes, identityRes, commitmentRows, teamRows] = await Promise.all([
    /*
     * Enquiries and test drives, from ONE pass over the canonical rows (rule 2). Both metrics live on
     * the same table but hang off different date columns, so each is counted with its own FILTER and
     * its own day number rather than in two queries.
     */
    analyticsDb.execute(sql`
      WITH canon AS (
        SELECT
          c.consultant_name,
          c.enquiry_date,
          c.test_drive_date,
          ${outletE} AS outlet,
          /*
           * ⚠️ PARTITIONED BY OUTLET **AND** ENQUIRY NUMBER. KIA's DMS issues enquiry numbers PER
           * DEALER, so E202604793 exists at BOTH JK402 and JK501 as two different customers —
           * measured: 1,821 numbers are in use at both outlets. Partitioning on the number alone
           * collapsed those pairs into one row and silently dropped the loser: September Jammu read
           * 229 enquiries against a true 255. Sales Report namespaces every dedupe key by dealer for
           * exactly this reason (see buildDeduplicationKey in lib/kia/sales-report.ts).
           */
          ROW_NUMBER() OVER (
            PARTITION BY ${outletE}, UPPER(BTRIM(c.enquiry_no))
            ORDER BY c.uploaded_at DESC, c.id DESC
          ) AS rn
        FROM kia_enquiry_report c
        WHERE c.enquiry_no IS NOT NULL AND BTRIM(c.enquiry_no) <> ''
      )
      SELECT
        BTRIM(consultant_name) AS name,
        EXTRACT(DAY FROM enquiry_date)::int    AS enquiry_day,
        EXTRACT(DAY FROM test_drive_date)::int AS td_day,
        COUNT(*) FILTER (WHERE enquiry_date    >= ${start}::date AND enquiry_date    < ${endExclusive}::date)::int AS enquiries,
        COUNT(*) FILTER (WHERE test_drive_date >= ${start}::date AND test_drive_date < ${endExclusive}::date)::int AS test_drives
      FROM canon
      WHERE rn = 1
        AND ${outletFilter}
        AND consultant_name IS NOT NULL AND BTRIM(consultant_name) <> ''
        AND (
          (enquiry_date    >= ${start}::date AND enquiry_date    < ${endExclusive}::date)
          OR (test_drive_date >= ${start}::date AND test_drive_date < ${endExclusive}::date)
        )
      GROUP BY 1, 2, 3
    `),

    /*
     * Bookings — the same definition Sales Performance uses (rule 3): one row per booking_no,
     * cancellations excluded. DISTINCT ON does in SQL what that reader does by pulling every row.
     */
    analyticsDb.execute(sql`
      WITH one_per_booking AS (
        SELECT DISTINCT ON (UPPER(BTRIM(c.booking_no)))
          BTRIM(c.consultant_name) AS name,
          EXTRACT(DAY FROM c.booking_date)::int AS day
        FROM kia_booking_report c
        WHERE c.booking_date >= ${start}::date AND c.booking_date < ${endExclusive}::date
          AND c.booking_no IS NOT NULL AND BTRIM(c.booking_no) <> ''
          AND c.consultant_name IS NOT NULL AND BTRIM(c.consultant_name) <> ''
          AND UPPER(BTRIM(COALESCE(c.status, ''))) NOT IN ('BOOKING CANCEL', 'INVOICE CANCEL')
          AND ${outletEFilter}
        ORDER BY UPPER(BTRIM(c.booking_no)), c.booking_date DESC
      )
      SELECT name, day, COUNT(*)::int AS bookings FROM one_per_booking GROUP BY 1, 2
    `),

    /*
     * Retails — delivery_date, deduped on VIN (rule 3). ⚠️ NOT on invoice_no: KIA reuses invoice
     * numbers (16 numbers across 32 distinct VINs), and an invoice-keyed dedupe silently drops the
     * earlier retail. One car is one VIN.
     */
    analyticsDb.execute(sql`
      WITH one_per_car AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(UPPER(BTRIM(c.vin_number)), ''), 'INV:' || UPPER(BTRIM(COALESCE(c.invoice_no, '')))))
          BTRIM(c.consultant_name) AS name,
          EXTRACT(DAY FROM c.delivery_date)::int AS day
        FROM ${sql.raw(SALES_TABLE)} c
        WHERE c.delivery_date >= ${start}::date AND c.delivery_date < ${endExclusive}::date
          AND c.consultant_name IS NOT NULL AND BTRIM(c.consultant_name) <> ''
          AND ${outletEFilter}
        ORDER BY COALESCE(NULLIF(UPPER(BTRIM(c.vin_number)), ''), 'INV:' || UPPER(BTRIM(COALESCE(c.invoice_no, '')))), c.delivery_date DESC
      )
      SELECT name, day, COUNT(*)::int AS retails FROM one_per_car GROUP BY 1, 2
    `),

    analyticsDb.execute(sql`
      SELECT DISTINCT
        EXTRACT(YEAR FROM c.enquiry_date)::int AS year,
        EXTRACT(MONTH FROM c.enquiry_date)::int AS month
      FROM kia_enquiry_report c
      WHERE c.enquiry_date IS NOT NULL
      ORDER BY 1 DESC, 2 DESC
      LIMIT 24
    `),

    analyticsDb.execute(sql`SELECT MAX(uploaded_at) AS as_of FROM kia_enquiry_report`),

    /*
     * ⚠️ WHO IS WHO. The DMS spells the same person more than one way: EJK4020138 files enquiries as
     * both "NEERAJ" and "NEERAJS", and EJK4020022 as both "AKASH BHAT" and "AKASH BHATS". Keyed on
     * the name, one person becomes two rows on the screen — September showed NEERAJS with 31
     * enquiries and NEERAJ with 0 beside it, and neither number was that person's month.
     *
     * `kec_employee_id` is the identity, and it is present on 38,646 of 38,839 rows. Measured: NO
     * name maps to more than one id, so collapsing names onto an id can never merge two real people.
     *
     * ⚠️ ONLY kia_enquiry_report CARRIES THE ID. The booking and sales feeds have a name and nothing
     * else, so this doubles as the alias map that merges their rows too — and every name in both of
     * those feeds is known here, so nothing is stranded.
     */
    analyticsDb.execute(sql`
      SELECT UPPER(BTRIM(c.consultant_name)) AS name_key,
             BTRIM(c.kec_employee_id) AS employee_id,
             BTRIM(c.consultant_name) AS display,
             MAX(c.enquiry_date) AS last_seen,
             COUNT(*) AS rows
      FROM kia_enquiry_report c
      WHERE c.consultant_name IS NOT NULL AND BTRIM(c.consultant_name) <> ''
        AND c.kec_employee_id IS NOT NULL AND BTRIM(c.kec_employee_id) <> ''
        AND ${outletEFilter}
      GROUP BY 1, 2, 3
    `),

    /*
     * ⚠️ THE COMMITMENT IS DAILY. Every row in the month is read and summed here; the month total is
     * never stored. Reading a stored monthly figure alongside these would be two sources of truth
     * that drift the first time somebody edits one day.
     */
    db.select().from(kiaSalesCommitments).where(and(
      ...(isAll ? [] : [eq(kiaSalesCommitments.dealerCode, outlet)]),
      gte(kiaSalesCommitments.commitmentDate, start),
      lt(kiaSalesCommitments.commitmentDate, endExclusive),
    )),

    /* kia_sales_targets now carries ONLY the team a consultant reports to, per month. */
    db.select().from(kiaSalesTargets).where(and(
      ...(isAll ? [] : [eq(kiaSalesTargets.dealerCode, outlet)]),
      eq(kiaSalesTargets.year, year),
      eq(kiaSalesTargets.month, month),
    )),
  ])

  /*
   * ── Who is who ────────────────────────────────────────────────────────────────────────────────
   * `idOf` maps a spelling to the employee id behind it; `resolve` turns any spelling into the key
   * everything else is grouped by. A name with no id resolves to itself, which is the right answer
   * for the 0.5% of rows the DMS leaves blank — it keeps them visible as their own row rather than
   * folding them onto somebody arbitrary.
   */
  const idOf = new Map<string, string>()
  const canonicalName = new Map<string, { name: string; rows: number }>()
  for (const r of rowsOf(identityRes)) {
    const nk = String(r.name_key ?? '').trim().toUpperCase()
    const id = String(r.employee_id ?? '').trim()
    if (!nk || !id) continue
    idOf.set(nk, id)
    /*
     * ⚠️ THE DISPLAY NAME IS THE SPELLING USED MOST, NOT THE MOST RECENT ONE. Most-recent elevates a
     * typo: EJK4020022 filed 626 enquiries as "AKASH BHAT" and then 30 as "AKASH BHATS", so the
     * newest spelling is the wrong one and the screen read "AKASH BHATS" beside a team labelled
     * "AKASH BHAT" — the same person, looking like two.
     */
    const rows = num(r.rows)
    const current = canonicalName.get(id)
    if (!current || rows > current.rows) canonicalName.set(id, { name: String(r.display ?? nk).trim(), rows })
  }
  const resolve = (name: unknown): string => {
    const nk = nameKey(name)
    if (!nk) return ''
    return idOf.get(nk) || nk
  }
  const nameFor = (key: string, fallback: string) => canonicalName.get(key)?.name || fallback

  // ── Fold every source into one map keyed on that resolved identity ─────────────────────────────
  const counts = new Map<string, Counts>()
  const display = new Map<string, string>()
  const daily = new Map<number, Counts>()

  const bump = (name: unknown, day: number | null, metric: keyof Counts, by: number) => {
    if (by <= 0) return
    const key = resolve(name)
    if (!key) return
    if (!display.has(key)) display.set(key, nameFor(key, String(name).trim()))
    const c = counts.get(key) || zero()
    c[metric] += by
    counts.set(key, c)
    if (day && day >= 1 && day <= monthDays) {
      const d = daily.get(day) || zero()
      d[metric] += by
      daily.set(day, d)
    }
  }

  for (const r of rowsOf(enquiryRes)) {
    bump(r.name, num(r.enquiry_day) || null, 'enquiries', num(r.enquiries))
    bump(r.name, num(r.td_day) || null, 'testDrives', num(r.test_drives))
  }
  for (const r of rowsOf(bookingRes)) bump(r.name, num(r.day) || null, 'bookings', num(r.bookings))
  for (const r of rowsOf(retailRes)) bump(r.name, num(r.day) || null, 'retails', num(r.retails))

  /*
   * ── Commitments ───────────────────────────────────────────────────────────────────────────────
   * The month's commitment is the SUM of the days committed inside it. Nothing stores a monthly
   * figure, so a day edited in week 3 moves the month total immediately and there is nothing to
   * re-sync.
   *
   * ⚠️ A consultant who has committed but done nothing MUST still appear. They are the row the
   * morning meeting exists for, and keying the table off activity alone makes the person doing
   * nothing the one who vanishes from the screen.
   *
   * ⚠️ `committedDays` counts ROWS, not the numbers on them. A day committed as zero — "no retail
   * today, the stock is not here" — is a decision somebody stood behind; a day nobody filled in is
   * not. The two must not both read as 0.
   */
  type Committed = { enquiries: number; testDrives: number; bookings: number; retails: number }
  /** The month figure somebody signed up to, when one exists. At most one row per person. */
  const monthCommitment = new Map<string, Committed>()
  /** The days added up — the plan for reaching it. */
  const daySum = new Map<string, Committed>()
  const toDate = new Map<string, Committed>()
  const committedDays = new Map<string, number>()
  const dailyCommitted = new Map<number, Committed>()

  for (const c of commitmentRows) {
    const key = resolve(c.consultantName)
    if (!key) continue
    if (!display.has(key)) display.set(key, nameFor(key, c.consultantName.trim()))
    if (!counts.has(key)) counts.set(key, zero())

    /*
     * ⚠️ A MONTH COMMITMENT IS NOT A DAY. It is held apart and never added to the day sum — folding
     * them together would double-count a month whose days are also filled in, and the two answer
     * different questions ("what did you sign up to" vs "how do you plan to get there").
     */
    if (c.scope === 'month') {
      monthCommitment.set(key, {
        enquiries: c.enquiries, testDrives: c.testDrives, bookings: c.bookings, retails: c.retails,
      })
      continue
    }

    const acc = daySum.get(key) || zero()
    acc.enquiries += c.enquiries
    acc.testDrives += c.testDrives
    acc.bookings += c.bookings
    acc.retails += c.retails
    daySum.set(key, acc)
    committedDays.set(key, (committedDays.get(key) || 0) + 1)

    /* commitmentDate is a `date`, so drizzle hands back 'YYYY-MM-DD' — take the day off the text
     * rather than constructing a Date, which would re-introduce the timezone shift 0067 avoids. */
    const dayNo = Number(String(c.commitmentDate).slice(8, 10))

    /* Only days that have happened count toward the baseline today's actuals are judged against. */
    if (dayNo <= daysElapsed) {  // eslint-disable-line no-lone-blocks
      const td = toDate.get(key) || zero()
      td.enquiries += c.enquiries
      td.testDrives += c.testDrives
      td.bookings += c.bookings
      td.retails += c.retails
      toDate.set(key, td)
    }
    if (dayNo >= 1 && dayNo <= monthDays) {
      const d = dailyCommitted.get(dayNo) || zero()
      d.enquiries += c.enquiries
      d.testDrives += c.testDrives
      d.bookings += c.bookings
      d.retails += c.retails
      dailyCommitted.set(dayNo, d)
    }
  }

  /* kia_sales_targets is now only "which team does this person report to", per month. */
  const teamOf = new Map<string, string | null>()
  for (const t of teamRows) {
    const key = resolve(t.consultantName)
    if (!key) continue
    if (!display.has(key)) display.set(key, nameFor(key, t.consultantName.trim()))
    teamOf.set(key, t.teamLeader?.trim() || null)
    if (!counts.has(key)) counts.set(key, zero())
  }

  /*
   * ⚠️ TEAM LEADERS ARE PEOPLE TOO, and they get their own row.
   *
   * Three of the four Jammu leaders have never filed an enquiry — they lead rather than sell — so
   * nothing in the feeds would ever put them on this screen. Akash Bhat DID sell (626 enquiries, 64
   * retails) right up to 2026-06-29 and then stopped, which is what moving to team leader looks like
   * in this data. Either way the row belongs here: a leader with no sales of their own reads as zero
   * against no commitment, which is the truth, and a leader who does sell has it counted.
   */
  for (const leader of new Set([...teamOf.values()].filter((v): v is string => Boolean(v)))) {
    const key = resolve(leader)
    if (!key) continue
    /*
     * ⚠️ A TYPED LEADER NAME OVERRIDES THE FEED'S SPELLING. Somebody wrote "AKASH BHAT" deliberately;
     * the feed's own most-used spelling is a fallback for people nobody has named. Without this the
     * leader's row and the team heading disagree about what he is called.
     */
    display.set(key, leader)
    if (!counts.has(key)) counts.set(key, zero())
    /* A leader belongs to their own team, so the team total is leader + members. */
    if (!teamOf.has(key)) teamOf.set(key, leader)
  }

  /*
   * ── THE PRECEDENCE RULE, STATED ONCE ──────────────────────────────────────────────────────────
   *
   * A MONTH COMMITMENT WINS over the sum of the days inside it.
   *
   * Both are real and staff make both, so the screen shows both — but only one can be the number the
   * month is scored against, and it has to be the one somebody signed up to. Part-way through a month
   * the days will always add to less than the month (nobody has filled in the rest yet), so scoring
   * against the day sum would quietly flatter everyone who is behind on their planning.
   *
   * ⚠️ THE BASELINE FOR "BEHIND BY" IS DIFFERENT AGAIN, and deliberately so:
   *   · days committed for the days that have HAPPENED, when there are any — exact, no assumptions;
   *   · otherwise a working-day pro-rata of the month commitment — an estimate, and labelled as one.
   * A month figure alone cannot say what today was supposed to look like; spreading it evenly is the
   * least-wrong reading and the screen says that is what it did.
   */
  type Targets = Committed & { teamLeader: string | null; basis: 'month' | 'days' | 'none' }
  const targets = new Map<string, Targets>()
  for (const key of new Set([...monthCommitment.keys(), ...daySum.keys(), ...teamOf.keys()])) {
    const monthly = monthCommitment.get(key)
    const days = daySum.get(key)
    const figure = monthly || days || zero()
    targets.set(key, {
      ...figure,
      teamLeader: teamOf.get(key) ?? null,
      basis: monthly ? 'month' : days ? 'days' : 'none',
    })
  }

  /* Working days gone, as a share — only used to pro-rata a month figure that has no days behind it. */
  const monthShare = workingDays > 0 ? workingDaysElapsed / workingDays : 0

  /* Resolved once, so the per-row check is a lookup rather than a scan of every team name. */
  const leaderKeys = new Set(
    [...teamOf.values()].filter((v): v is string => Boolean(v)).map((v) => resolve(v)).filter(Boolean),
  )

  const consultants: PlanConsultantRow[] = []
  for (const [key, c] of counts.entries()) {
    const t = targets.get(key) || { enquiries: 0, testDrives: 0, bookings: 0, retails: 0, teamLeader: null, basis: 'none' as const }
    const days = daySum.get(key)
    const dayDays = committedDays.get(key) || 0
    const monthly = monthCommitment.get(key)
    /*
     * The baseline for "where should you be today". Days win when they exist because they are a
     * decision; otherwise the month figure is spread across working days, which is an estimate.
     */
    const td = dayDays > 0
      ? (toDate.get(key) || zero())
      : monthly
        ? {
            enquiries: monthly.enquiries * monthShare,
            testDrives: monthly.testDrives * monthShare,
            bookings: monthly.bookings * monthShare,
            retails: monthly.retails * monthShare,
          }
        : zero()
    const committed = dayDays > 0 || Boolean(monthly)
    const row: PlanConsultantRow = {
      consultant: display.get(key) || key,
      teamLeader: t.teamLeader,
      enquiries: cell(c.enquiries, t.enquiries, td.enquiries, committed),
      testDrives: cell(c.testDrives, t.testDrives, td.testDrives, committed),
      bookings: cell(c.bookings, t.bookings, td.bookings, committed),
      retails: cell(c.retails, t.retails, td.retails, committed),
      worstGap: null,
      /*
       * ⚠️ Having COMMITTED is not the same as having committed a non-zero number. A consultant who
       * committed zero retails every day this month has a plan; treating them as unplanned would sort
       * them to the bottom with the people nobody has asked.
       */
      hasAnyTarget: committed,
      committedDays: dayDays,
      commitmentBasis: t.basis,
      monthCommitted: monthly ? monthly.retails : null,
      daysPlanned: days ? days.retails : null,
      isTeamLeader: leaderKeys.has(key),
      employeeId: canonicalName.has(key) ? key : null,
    }
    /* Retail is what the month is judged on; bookings decide it when no retail target is set. */
    row.worstGap = row.retails.gap ?? row.bookings.gap ?? row.enquiries.gap
    consultants.push(row)
  }

  /*
   * ⚠️ Sorted by who is FURTHEST BEHIND, not alphabetically and not by who is winning. This screen
   * exists for the morning meeting, and the row that needs the conversation belongs at the top.
   * Consultants with no target at all sort last — they are not behind, they are unplanned.
   */
  consultants.sort((a, b) => {
    if (a.hasAnyTarget !== b.hasAnyTarget) return a.hasAnyTarget ? -1 : 1
    const ag = a.worstGap ?? Number.POSITIVE_INFINITY
    const bg = b.worstGap ?? Number.POSITIVE_INFINITY
    if (ag !== bg) return ag - bg
    return a.consultant.localeCompare(b.consultant)
  })

  // ── Teams ─────────────────────────────────────────────────────────────────────────────────────
  const teamAgg = new Map<string, { n: number; actual: Counts; target: Counts; toDate: Counts; committed: boolean }>()
  for (const row of consultants) {
    if (!row.teamLeader) continue
    const t = teamAgg.get(row.teamLeader) || { n: 0, actual: zero(), target: zero(), toDate: zero(), committed: false }
    t.n += 1
    /* A team counts as committed if ANY of its people have. Otherwise one unplanned member would
     * make the whole team read as unplanned. */
    if (row.hasAnyTarget) t.committed = true
    for (const m of PLAN_METRICS) {
      t.actual[m.key] += row[m.key].actual
      t.target[m.key] += row[m.key].target
      t.toDate[m.key] += row[m.key].committedToDate
    }
    teamAgg.set(row.teamLeader, t)
  }
  const teams: PlanTeamRow[] = [...teamAgg.entries()]
    .map(([teamLeader, t]) => ({
      teamLeader,
      consultants: t.n,
      enquiries: cell(t.actual.enquiries, t.target.enquiries, t.toDate.enquiries, t.committed),
      testDrives: cell(t.actual.testDrives, t.target.testDrives, t.toDate.testDrives, t.committed),
      bookings: cell(t.actual.bookings, t.target.bookings, t.toDate.bookings, t.committed),
      retails: cell(t.actual.retails, t.target.retails, t.toDate.retails, t.committed),
    }))
    .sort((a, b) => (a.retails.gap ?? 0) - (b.retails.gap ?? 0))

  // ── Totals ────────────────────────────────────────────────────────────────────────────────────
  const totalActual = zero()
  const totalTarget = zero()
  const totalToDate = zero()
  let anyCommitted = false
  for (const row of consultants) {
    if (row.hasAnyTarget) anyCommitted = true
    for (const m of PLAN_METRICS) {
      totalActual[m.key] += row[m.key].actual
      totalTarget[m.key] += row[m.key].target
      totalToDate[m.key] += row[m.key].committedToDate
    }
  }

  // ── Daily series — every day of the month, including the ones with nothing in them ────────────
  const days: PlanDay[] = []
  for (let day = 1; day <= monthDays; day++) {
    const d = daily.get(day) || zero()
    const c = dailyCommitted.get(day)
    days.push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      isSunday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0,
      isFuture: day > daysElapsed,
      ...d,
      committed: c ? { ...c } : zero(),
      hasCommitment: c !== undefined,
    })
  }

  const availableMonths = rowsOf(monthsRes)
    .map((r) => ({ year: num(r.year), month: num(r.month) }))
    .filter((r) => r.year > 0 && r.month >= 1 && r.month <= 12)
    .map((r) => ({ ...r, label: monthLabel(r.year, r.month) }))

  const asOfRaw = rowsOf(freshnessRes)[0]?.as_of
  const asOf = asOfRaw instanceof Date
    ? asOfRaw.toISOString()
    : asOfRaw
      ? new Date(String(asOfRaw)).toISOString()
      : null

  const outletLabel = KIA_PLAN_OUTLETS.find((o) => o.code === outlet)?.label || outlet

  return {
    context: {
      year, month, label: monthLabel(year, month), outlet, outletLabel,
      monthDays, daysElapsed, workingDays, workingDaysElapsed, elapsedShare, isCurrentMonth,
    },
    totals: {
      enquiries: cell(totalActual.enquiries, totalTarget.enquiries, totalToDate.enquiries, anyCommitted),
      testDrives: cell(totalActual.testDrives, totalTarget.testDrives, totalToDate.testDrives, anyCommitted),
      bookings: cell(totalActual.bookings, totalTarget.bookings, totalToDate.bookings, anyCommitted),
      retails: cell(totalActual.retails, totalTarget.retails, totalToDate.retails, anyCommitted),
    },
    consultants,
    teams,
    daily: days,
    availableMonths,
    dataAsOf: asOf,
  }
}
