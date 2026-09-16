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

export const DEFAULT_PLAN_MODELS = ['SONET', 'NEW SELTOS', 'CARENS', 'SYROS', 'SORENTO'] as const

export function normalizeModelName(raw: string): string {
  const u = String(raw || '').trim().toUpperCase()
  if (!u) return 'OTHER'
  if (u.includes('SONET')) return 'SONET'
  if (u.includes('SELTOS')) return 'NEW SELTOS'
  if (u.includes('CARENS')) return 'CARENS'
  if (u.includes('SYROS')) return 'SYROS'
  if (u.includes('SORENTO')) return 'SORENTO'
  if (u.includes('CARNIVAL')) return 'CARNIVAL'
  if (u.includes('EV6')) return 'EV6'
  if (u.includes('EV9')) return 'EV9'
  return u
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
  /** The month's commitment */
  target: number
  /**
   * The commitment for the days that have actually happened.
   */
  committedToDate: number
  /** actual ÷ target, or null when nothing is committed — never 0 */
  achievement: number | null
  /**
   * actual − committedToDate. Positive is ahead.
   */
  gap: number | null
}

export type PlanModelItem = {
  model: string
  target: number
  bookings: number
  retails: number
  achievement: number | null
  gap: number | null
}

export type PlanWeek = {
  weekNumber: number
  scope: 'week_1' | 'week_2' | 'week_3' | 'week_4'
  label: string
  dateRange: string
  startDate: string
  endDate: string
  startDay: number
  endDay: number
  daysCount: number
  workingDays: number
  workingDaysElapsed: number
  isCurrent: boolean
  isPast: boolean
  isFuture: boolean
  enquiries: PlanCell
  testDrives: PlanCell
  bookings: PlanCell
  retails: PlanCell
}

export type PlanConsultantRow = {
  consultant: string
  teamLeader: string | null
  enquiries: PlanCell
  testDrives: PlanCell
  bookings: PlanCell
  retails: PlanCell
  /** Weekly breakdown for this consultant (Week 1 to Week 4) */
  weeks: PlanWeek[]
  /** Model-wise targets and actuals for this consultant */
  models: PlanModelItem[]
  modelTargets: Record<string, number>
  /** The single number the table sorts on: the retail gap, then the booking gap. */
  worstGap: number | null
  hasAnyTarget: boolean
  committedDays: number
  /**
   * Which kind of commitment the month figure came from.
   */
  commitmentBasis: 'month' | 'weeks' | 'days' | 'none'
  monthCommitted: number | null
  daysPlanned: number | null
  /**
   * This person leads a team.
   */
  isTeamLeader: boolean
  /** The DMS employee id this row was resolved to, or null when the feed left it blank. */
  employeeId: string | null
}

/**
 * One day, both sides of it.
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
  models: PlanModelItem[]
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
  /** Weekly breakdown across the entire outlet (Weeks 1 to 4) */
  weeks: PlanWeek[]
  /** Model breakdown across the entire outlet */
  models: PlanModelItem[]
  allModels: string[]
  consultants: PlanConsultantRow[]
  teams: PlanTeamRow[]
  daily: PlanDay[]
  availableMonths: { year: number; month: number; label: string }[]
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
 * ⚠️ BUMP THE VERSION IN THIS KEY whenever the payload shape or any counting rule changes.
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
  const key = `kia:sales-target-plan:v9-model-w4:${outlet}:${year}-${String(month).padStart(2, '0')}`
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
     * Bookings — one row per booking_no, cancellations excluded, with model.
     */
    analyticsDb.execute(sql`
      WITH one_per_booking AS (
        SELECT DISTINCT ON (UPPER(BTRIM(c.booking_no)))
          BTRIM(c.consultant_name) AS name,
          EXTRACT(DAY FROM c.booking_date)::int AS day,
          COALESCE(BTRIM(c.model), '') AS model
        FROM kia_booking_report c
        WHERE c.booking_date >= ${start}::date AND c.booking_date < ${endExclusive}::date
          AND c.booking_no IS NOT NULL AND BTRIM(c.booking_no) <> ''
          AND c.consultant_name IS NOT NULL AND BTRIM(c.consultant_name) <> ''
          AND UPPER(BTRIM(COALESCE(c.status, ''))) NOT IN ('BOOKING CANCEL', 'INVOICE CANCEL')
          AND ${outletEFilter}
        ORDER BY UPPER(BTRIM(c.booking_no)), c.booking_date DESC
      )
      SELECT name, day, model, COUNT(*)::int AS bookings FROM one_per_booking GROUP BY 1, 2, 3
    `),

    /*
     * Retails — delivery_date, deduped on VIN (rule 3), with model.
     */
    analyticsDb.execute(sql`
      WITH one_per_car AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(UPPER(BTRIM(c.vin_number)), ''), 'INV:' || UPPER(BTRIM(COALESCE(c.invoice_no, '')))))
          BTRIM(c.consultant_name) AS name,
          EXTRACT(DAY FROM c.delivery_date)::int AS day,
          COALESCE(BTRIM(c.model), '') AS model
        FROM ${sql.raw(SALES_TABLE)} c
        WHERE c.delivery_date >= ${start}::date AND c.delivery_date < ${endExclusive}::date
          AND c.consultant_name IS NOT NULL AND BTRIM(c.consultant_name) <> ''
          AND ${outletEFilter}
        ORDER BY COALESCE(NULLIF(UPPER(BTRIM(c.vin_number)), ''), 'INV:' || UPPER(BTRIM(COALESCE(c.invoice_no, '')))), c.delivery_date DESC
      )
      SELECT name, day, model, COUNT(*)::int AS retails FROM one_per_car GROUP BY 1, 2, 3
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

    /* Commitments */
    db.select().from(kiaSalesCommitments).where(and(
      ...(isAll ? [] : [eq(kiaSalesCommitments.dealerCode, outlet)]),
      gte(kiaSalesCommitments.commitmentDate, start),
      lt(kiaSalesCommitments.commitmentDate, endExclusive),
    )),

    /* kia_sales_targets: team assignments per month */
    db.select().from(kiaSalesTargets).where(and(
      ...(isAll ? [] : [eq(kiaSalesTargets.dealerCode, outlet)]),
      eq(kiaSalesTargets.year, year),
      eq(kiaSalesTargets.month, month),
    )),
  ])

  // ── Who is who ────────────────────────────────────────────────────────────────────────────────
  const idOf = new Map<string, string>()
  const canonicalName = new Map<string, { name: string; rows: number }>()
  for (const r of rowsOf(identityRes)) {
    const nk = String(r.name_key ?? '').trim().toUpperCase()
    const id = String(r.employee_id ?? '').trim()
    if (!nk || !id) continue
    idOf.set(nk, id)
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

  // ── Fold every source into one map keyed on resolved identity ─────────────────────────────────
  const counts = new Map<string, Counts>()
  const display = new Map<string, string>()
  const daily = new Map<number, Counts>()
  const consultantDailyCounts = new Map<string, Map<number, Counts>>()
  const consultantModelCounts = new Map<string, Map<string, { bookings: number; retails: number }>>()
  const allDiscoveredModels = new Set<string>()

  const bump = (name: unknown, day: number | null, metric: keyof Counts, by: number, rawModel?: string) => {
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

      let cdMap = consultantDailyCounts.get(key)
      if (!cdMap) {
        cdMap = new Map<number, Counts>()
        consultantDailyCounts.set(key, cdMap)
      }
      const cd = cdMap.get(day) || zero()
      cd[metric] += by
      cdMap.set(day, cd)
    }

    if (rawModel && (metric === 'bookings' || metric === 'retails')) {
      const norm = normalizeModelName(rawModel)
      allDiscoveredModels.add(norm)
      let mGroup = consultantModelCounts.get(key)
      if (!mGroup) {
        mGroup = new Map<string, { bookings: number; retails: number }>()
        consultantModelCounts.set(key, mGroup)
      }
      const mStats = mGroup.get(norm) || { bookings: 0, retails: 0 }
      if (metric === 'bookings') mStats.bookings += by
      if (metric === 'retails') mStats.retails += by
      mGroup.set(norm, mStats)
    }
  }

  for (const r of rowsOf(enquiryRes)) {
    bump(r.name, num(r.enquiry_day) || null, 'enquiries', num(r.enquiries))
    bump(r.name, num(r.td_day) || null, 'testDrives', num(r.test_drives))
  }
  for (const r of rowsOf(bookingRes)) {
    bump(r.name, num(r.day) || null, 'bookings', num(r.bookings), String(r.model || ''))
  }
  for (const r of rowsOf(retailRes)) {
    bump(r.name, num(r.day) || null, 'retails', num(r.retails), String(r.model || ''))
  }

  // ── Commitments ───────────────────────────────────────────────────────────────────────────────
  type Committed = { enquiries: number; testDrives: number; bookings: number; retails: number }
  const monthCommitment = new Map<string, Committed>()
  const consultantModelTargets = new Map<string, Record<string, number>>()
  const daySum = new Map<string, Committed>()
  const toDate = new Map<string, Committed>()
  const committedDays = new Map<string, number>()
  const dailyCommitted = new Map<number, Committed>()

  for (const c of commitmentRows) {
    const key = resolve(c.consultantName)
    if (!key) continue
    if (!display.has(key)) display.set(key, nameFor(key, c.consultantName.trim()))
    if (!counts.has(key)) counts.set(key, zero())

    if (c.scope === 'month') {
      monthCommitment.set(key, {
        enquiries: c.enquiries, testDrives: c.testDrives, bookings: c.bookings, retails: c.retails,
      })
      if (c.modelTargets && typeof c.modelTargets === 'object') {
        const mt = c.modelTargets as Record<string, unknown>
        const parsed: Record<string, number> = {}
        for (const [mk, mv] of Object.entries(mt)) {
          const mNorm = normalizeModelName(mk)
          const nVal = Number(mv) || 0
          if (nVal > 0) {
            parsed[mNorm] = (parsed[mNorm] || 0) + nVal
            allDiscoveredModels.add(mNorm)
          }
        }
        consultantModelTargets.set(key, parsed)
      }
      continue
    }

    // Daily commitment
    const acc = daySum.get(key) || zero()
    acc.enquiries += c.enquiries
    acc.testDrives += c.testDrives
    acc.bookings += c.bookings
    acc.retails += c.retails
    daySum.set(key, acc)
    committedDays.set(key, (committedDays.get(key) || 0) + 1)

    const dayNo = Number(String(c.commitmentDate).slice(8, 10))

    if (dayNo <= daysElapsed) {
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

  /* Team mappings */
  const teamOf = new Map<string, string | null>()
  for (const t of teamRows) {
    const key = resolve(t.consultantName)
    if (!key) continue
    if (!display.has(key)) display.set(key, nameFor(key, t.consultantName.trim()))
    teamOf.set(key, t.teamLeader?.trim() || null)
    if (!counts.has(key)) counts.set(key, zero())
  }

  for (const leader of new Set([...teamOf.values()].filter((v): v is string => Boolean(v)))) {
    const key = resolve(leader)
    if (!key) continue
    display.set(key, leader)
    if (!counts.has(key)) counts.set(key, zero())
    if (!teamOf.has(key)) teamOf.set(key, leader)
  }

  // ── 4 Fixed Weeks Partitioning ────────────────────────────────────────────────────────────────
  // Week 1: Day 1–7, Week 2: Day 8–14, Week 3: Day 15–21, Week 4: Day 22–monthDays
  const weekConfigs: { weekNumber: number; scope: 'week_1' | 'week_2' | 'week_3' | 'week_4'; startDay: number; endDay: number }[] = [
    { weekNumber: 1, scope: 'week_1', startDay: 1, endDay: 7 },
    { weekNumber: 2, scope: 'week_2', startDay: 8, endDay: 14 },
    { weekNumber: 3, scope: 'week_3', startDay: 15, endDay: 21 },
    { weekNumber: 4, scope: 'week_4', startDay: 22, endDay: monthDays },
  ]

  const weekMeta = weekConfigs.map((w) => {
    const wWorkingDays = workingDaysUpTo(year, month, w.endDay) - workingDaysUpTo(year, month, w.startDay - 1)
    const wWorkingDaysElapsed = daysElapsed >= w.startDay
      ? workingDaysUpTo(year, month, Math.min(w.endDay, daysElapsed)) - workingDaysUpTo(year, month, w.startDay - 1)
      : 0
    const isCurrent = isCurrentMonth && daysElapsed >= w.startDay && daysElapsed <= w.endDay
    const isPast = daysElapsed > w.endDay
    const isFuture = daysElapsed < w.startDay

    return {
      ...w,
      label: `Week ${w.weekNumber} (Day ${w.startDay}–${w.endDay})`,
      dateRange: `${year}-${String(month).padStart(2, '0')}-${String(w.startDay).padStart(2, '0')} to ${year}-${String(month).padStart(2, '0')}-${String(w.endDay).padStart(2, '0')}`,
      startDate: `${year}-${String(month).padStart(2, '0')}-${String(w.startDay).padStart(2, '0')}`,
      endDate: `${year}-${String(month).padStart(2, '0')}-${String(w.endDay).padStart(2, '0')}`,
      daysCount: w.endDay - w.startDay + 1,
      workingDays: wWorkingDays,
      workingDaysElapsed: wWorkingDaysElapsed,
      isCurrent,
      isPast,
      isFuture,
    }
  })

  // ── Month Precedence Rules ───────────────────────────────────────────────────────────────────
  type Targets = Committed & { teamLeader: string | null; basis: 'month' | 'weeks' | 'days' | 'none' }
  const targets = new Map<string, Targets>()
  const allKeys = new Set([
    ...monthCommitment.keys(),
    ...daySum.keys(),
    ...teamOf.keys(),
  ])

  for (const key of allKeys) {
    const monthly = monthCommitment.get(key)
    const days = daySum.get(key)
    const figure = monthly || days || zero()
    const basis: 'month' | 'weeks' | 'days' | 'none' = monthly
      ? 'month'
      : days
        ? 'days'
        : 'none'

    targets.set(key, {
      ...figure,
      teamLeader: teamOf.get(key) ?? null,
      basis,
    })
  }

  // ── Model Registry ────────────────────────────────────────────────────────────────────────────
  // Default models first, then any extra discovered models sorted alphabetically
  const allModels: string[] = [...DEFAULT_PLAN_MODELS]
  const extraModels = [...allDiscoveredModels]
    .filter((m) => !allModels.includes(m as any) && m !== 'OTHER')
    .sort()
  allModels.push(...extraModels)
  if (allDiscoveredModels.has('OTHER') && !allModels.includes('OTHER')) {
    allModels.push('OTHER')
  }

  const monthShare = workingDays > 0 ? workingDaysElapsed / workingDays : 0
  const leaderKeys = new Set(
    [...teamOf.values()].filter((v): v is string => Boolean(v)).map((v) => resolve(v)).filter(Boolean),
  )

  const consultants: PlanConsultantRow[] = []
  for (const [key, c] of counts.entries()) {
    const t = targets.get(key) || { enquiries: 0, testDrives: 0, bookings: 0, retails: 0, teamLeader: null, basis: 'none' as const }
    const days = daySum.get(key)
    const dayDays = committedDays.get(key) || 0
    const monthly = monthCommitment.get(key)
    const mTargets = consultantModelTargets.get(key) || {}
    const mCounts = consultantModelCounts.get(key) || new Map<string, { bookings: number; retails: number }>()

    // 1. Weekly target division from monthly target
    // We compute targets for W1, W2, W3, and W4 takes the remainder so sum equals monthly target exactly.
    const w1WorkingShare = workingDays > 0 ? weekMeta[0].workingDays / workingDays : 0.25
    const w2WorkingShare = workingDays > 0 ? weekMeta[1].workingDays / workingDays : 0.25
    const w3WorkingShare = workingDays > 0 ? weekMeta[2].workingDays / workingDays : 0.25

    const w1Tgt: Committed = {
      enquiries: Math.round(t.enquiries * w1WorkingShare),
      testDrives: Math.round(t.testDrives * w1WorkingShare),
      bookings: Math.round(t.bookings * w1WorkingShare),
      retails: Math.round(t.retails * w1WorkingShare),
    }
    const w2Tgt: Committed = {
      enquiries: Math.round(t.enquiries * w2WorkingShare),
      testDrives: Math.round(t.testDrives * w2WorkingShare),
      bookings: Math.round(t.bookings * w2WorkingShare),
      retails: Math.round(t.retails * w2WorkingShare),
    }
    const w3Tgt: Committed = {
      enquiries: Math.round(t.enquiries * w3WorkingShare),
      testDrives: Math.round(t.testDrives * w3WorkingShare),
      bookings: Math.round(t.bookings * w3WorkingShare),
      retails: Math.round(t.retails * w3WorkingShare),
    }
    const w4Tgt: Committed = {
      enquiries: Math.max(0, t.enquiries - (w1Tgt.enquiries + w2Tgt.enquiries + w3Tgt.enquiries)),
      testDrives: Math.max(0, t.testDrives - (w1Tgt.testDrives + w2Tgt.testDrives + w3Tgt.testDrives)),
      bookings: Math.max(0, t.bookings - (w1Tgt.bookings + w2Tgt.bookings + w3Tgt.bookings)),
      retails: Math.max(0, t.retails - (w1Tgt.retails + w2Tgt.retails + w3Tgt.retails)),
    }
    const weekTargets = [w1Tgt, w2Tgt, w3Tgt, w4Tgt]

    // Weekly calculations for this consultant
    const consultantWeeks: PlanWeek[] = weekMeta.map((wm, wIdx) => {
      // Actuals in this week
      const cdMap = consultantDailyCounts.get(key)
      const wAct = zero()
      if (cdMap) {
        for (let d = wm.startDay; d <= wm.endDay; d++) {
          const cd = cdMap.get(d)
          if (cd) {
            wAct.enquiries += cd.enquiries
            wAct.testDrives += cd.testDrives
            wAct.bookings += cd.bookings
            wAct.retails += cd.retails
          }
        }
      }

      const wTarget = weekTargets[wIdx]
      let wToDate: Committed = zero()

      if (wm.isPast) {
        wToDate = wTarget
      } else if (wm.isCurrent) {
        const share = wm.workingDays > 0 ? wm.workingDaysElapsed / wm.workingDays : 0
        wToDate = {
          enquiries: Math.round(wTarget.enquiries * share * 10) / 10,
          testDrives: Math.round(wTarget.testDrives * share * 10) / 10,
          bookings: Math.round(wTarget.bookings * share * 10) / 10,
          retails: Math.round(wTarget.retails * share * 10) / 10,
        }
      }

      const weekHasTarget = t.basis !== 'none'

      return {
        weekNumber: wm.weekNumber,
        scope: wm.scope,
        label: wm.label,
        dateRange: wm.dateRange,
        startDate: wm.startDate,
        endDate: wm.endDate,
        startDay: wm.startDay,
        endDay: wm.endDay,
        daysCount: wm.daysCount,
        workingDays: wm.workingDays,
        workingDaysElapsed: wm.workingDaysElapsed,
        isCurrent: wm.isCurrent,
        isPast: wm.isPast,
        isFuture: wm.isFuture,
        enquiries: cell(wAct.enquiries, wTarget.enquiries, wToDate.enquiries, weekHasTarget),
        testDrives: cell(wAct.testDrives, wTarget.testDrives, wToDate.testDrives, weekHasTarget),
        bookings: cell(wAct.bookings, wTarget.bookings, wToDate.bookings, weekHasTarget),
        retails: cell(wAct.retails, wTarget.retails, wToDate.retails, weekHasTarget),
      }
    })

    // 2. Model Breakdown for this consultant
    const consultantModels: PlanModelItem[] = allModels.map((mName) => {
      const mTgt = mTargets[mName] || 0
      const actuals = mCounts.get(mName) || { bookings: 0, retails: 0 }
      const hasTgt = mTgt > 0
      const committedToDate = hasTgt ? mTgt * monthShare : 0
      return {
        model: mName,
        target: mTgt,
        bookings: actuals.bookings,
        retails: actuals.retails,
        achievement: hasTgt ? actuals.retails / mTgt : null,
        gap: hasTgt ? Math.round((actuals.retails - committedToDate) * 10) / 10 : null,
      }
    })

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

    const committed = dayDays > 0 || Boolean(monthly) || t.basis !== 'none'
    const row: PlanConsultantRow = {
      consultant: display.get(key) || key,
      teamLeader: t.teamLeader,
      enquiries: cell(c.enquiries, t.enquiries, td.enquiries, committed),
      testDrives: cell(c.testDrives, t.testDrives, td.testDrives, committed),
      bookings: cell(c.bookings, t.bookings, td.bookings, committed),
      retails: cell(c.retails, t.retails, td.retails, committed),
      weeks: consultantWeeks,
      models: consultantModels,
      modelTargets: mTargets,
      worstGap: null,
      hasAnyTarget: committed,
      committedDays: dayDays,
      commitmentBasis: t.basis,
      monthCommitted: monthly ? monthly.retails : null,
      daysPlanned: days ? days.retails : null,
      isTeamLeader: leaderKeys.has(key),
      employeeId: canonicalName.has(key) ? key : null,
    }
    row.worstGap = row.retails.gap ?? row.bookings.gap ?? row.enquiries.gap
    consultants.push(row)
  }

  consultants.sort((a, b) => {
    if (a.hasAnyTarget !== b.hasAnyTarget) return a.hasAnyTarget ? -1 : 1
    const ag = a.worstGap ?? Number.POSITIVE_INFINITY
    const bg = b.worstGap ?? Number.POSITIVE_INFINITY
    if (ag !== bg) return ag - bg
    return a.consultant.localeCompare(b.consultant)
  })

  // ── Teams ─────────────────────────────────────────────────────────────────────────────────────
  const teamAgg = new Map<string, {
    n: number
    actual: Counts
    target: Counts
    toDate: Counts
    committed: boolean
    models: Map<string, { target: number; bookings: number; retails: number }>
  }>()

  for (const row of consultants) {
    if (!row.teamLeader) continue
    let t = teamAgg.get(row.teamLeader)
    if (!t) {
      t = {
        n: 0,
        actual: zero(),
        target: zero(),
        toDate: zero(),
        committed: false,
        models: new Map(),
      }
      teamAgg.set(row.teamLeader, t)
    }
    t.n += 1
    if (row.hasAnyTarget) t.committed = true
    for (const m of PLAN_METRICS) {
      t.actual[m.key] += row[m.key].actual
      t.target[m.key] += row[m.key].target
      t.toDate[m.key] += row[m.key].committedToDate
    }
    for (const mItem of row.models) {
      const existing = t.models.get(mItem.model) || { target: 0, bookings: 0, retails: 0 }
      existing.target += mItem.target
      existing.bookings += mItem.bookings
      existing.retails += mItem.retails
      t.models.set(mItem.model, existing)
    }
  }

  const teams: PlanTeamRow[] = [...teamAgg.entries()]
    .map(([teamLeader, t]) => {
      const teamModels: PlanModelItem[] = allModels.map((mName) => {
        const tm = t.models.get(mName) || { target: 0, bookings: 0, retails: 0 }
        const hasTgt = tm.target > 0
        const committedToDate = hasTgt ? tm.target * monthShare : 0
        return {
          model: mName,
          target: tm.target,
          bookings: tm.bookings,
          retails: tm.retails,
          achievement: hasTgt ? tm.retails / tm.target : null,
          gap: hasTgt ? Math.round((tm.retails - committedToDate) * 10) / 10 : null,
        }
      })

      return {
        teamLeader,
        consultants: t.n,
        enquiries: cell(t.actual.enquiries, t.target.enquiries, t.toDate.enquiries, t.committed),
        testDrives: cell(t.actual.testDrives, t.target.testDrives, t.toDate.testDrives, t.committed),
        bookings: cell(t.actual.bookings, t.target.bookings, t.toDate.bookings, t.committed),
        retails: cell(t.actual.retails, t.target.retails, t.toDate.retails, t.committed),
        models: teamModels,
      }
    })
    .sort((a, b) => (a.retails.gap ?? 0) - (b.retails.gap ?? 0))

  // ── Totals ────────────────────────────────────────────────────────────────────────────────────
  const totalActual = zero()
  const totalTarget = zero()
  const totalToDate = zero()
  let anyCommitted = false
  const totalModelMap = new Map<string, { target: number; bookings: number; retails: number }>()

  for (const row of consultants) {
    if (row.hasAnyTarget) anyCommitted = true
    for (const m of PLAN_METRICS) {
      totalActual[m.key] += row[m.key].actual
      totalTarget[m.key] += row[m.key].target
      totalToDate[m.key] += row[m.key].committedToDate
    }
    for (const mItem of row.models) {
      const existing = totalModelMap.get(mItem.model) || { target: 0, bookings: 0, retails: 0 }
      existing.target += mItem.target
      existing.bookings += mItem.bookings
      existing.retails += mItem.retails
      totalModelMap.set(mItem.model, existing)
    }
  }

  // ── Outlet-Wide Models ────────────────────────────────────────────────────────────────────────
  const outletModels: PlanModelItem[] = allModels.map((mName) => {
    const tm = totalModelMap.get(mName) || { target: 0, bookings: 0, retails: 0 }
    const hasTgt = tm.target > 0
    const committedToDate = hasTgt ? tm.target * monthShare : 0
    return {
      model: mName,
      target: tm.target,
      bookings: tm.bookings,
      retails: tm.retails,
      achievement: hasTgt ? tm.retails / tm.target : null,
      gap: hasTgt ? Math.round((tm.retails - committedToDate) * 10) / 10 : null,
    }
  })

  // ── Weeks Totals ──────────────────────────────────────────────────────────────────────────────
  const weeks: PlanWeek[] = weekMeta.map((wm, wIdx) => {
    const wAct = zero()
    const wTgt = zero()
    const wToDate = zero()
    let wAnyCommitted = false

    for (const row of consultants) {
      const cw = row.weeks[wIdx]
      if (!cw) continue
      for (const m of PLAN_METRICS) {
        wAct[m.key] += cw[m.key].actual
        wTgt[m.key] += cw[m.key].target
        wToDate[m.key] += cw[m.key].committedToDate
        if (cw[m.key].target > 0 || cw[m.key].committedToDate > 0) wAnyCommitted = true
      }
    }

    return {
      weekNumber: wm.weekNumber,
      scope: wm.scope,
      label: wm.label,
      dateRange: wm.dateRange,
      startDate: wm.startDate,
      endDate: wm.endDate,
      startDay: wm.startDay,
      endDay: wm.endDay,
      daysCount: wm.daysCount,
      workingDays: wm.workingDays,
      workingDaysElapsed: wm.workingDaysElapsed,
      isCurrent: wm.isCurrent,
      isPast: wm.isPast,
      isFuture: wm.isFuture,
      enquiries: cell(wAct.enquiries, wTgt.enquiries, wToDate.enquiries, wAnyCommitted),
      testDrives: cell(wAct.testDrives, wTgt.testDrives, wToDate.testDrives, wAnyCommitted),
      bookings: cell(wAct.bookings, wTgt.bookings, wToDate.bookings, wAnyCommitted),
      retails: cell(wAct.retails, wTgt.retails, wToDate.retails, wAnyCommitted),
    }
  })

  // ── Daily series — every day of the month ─────────────────────────────────────────────────────
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
    weeks,
    models: outletModels,
    allModels,
    consultants,
    teams,
    daily: days,
    availableMonths,
    dataAsOf: asOf,
  }
}

