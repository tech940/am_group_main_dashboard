import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import type { KiaDealerCode } from '@/lib/kia/dealer-branch'
import {
  activeBillStatusSql,
  getMonthStart,
  numberValue,
  numericText,
  resultRows,
  roBillingDealerFilter,
  serviceCategoryExpression,
} from '@/lib/kia/service-dashboard-metrics'

// Single-page Workshop Summary for AM Kia Business Excellence. Reuses the EXACT canonical RO-billing
// calc used everywhere else (bill de-dup by bill_no→ro_no→id keeping the largest absolute billed
// value; active-bill filter; the Free/Paid/Running/Accidental service-category expression) so the
// numbers match the RO Billing report. Accidental = 'Accidental Repair'; Mechanical = the other
// three categories. All figures are Month-To-Date for the selected month/dealer.

const CANONICAL_CATEGORIES = sql`('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')`
const DEALER_LABELS: Record<string, string> = { JK402: 'Jammu', JK501: 'Udhampur' }
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export type WorkshopSplit = { roCount: number; labour: number; parts: number; billing: number }
export type WorkshopLocation = { dealer: string; label: string; billing: number; roCount: number; labour: number; parts: number; growth: number | null }
export type WorkshopTrendPoint = { day: string; cy: number; ly: number }
export type KiaWorkshopSummary = {
  meta: { monthLabel: string; startDate: string; endDate: string; throughDay: number; daysInMonth: number; dealerCode: KiaDealerCode | null; dataAvailable: boolean }
  total: WorkshopSplit & { avgBilling: number }
  mechanical: WorkshopSplit
  accidental: WorkshopSplit
  lyTotal: WorkshopSplit & { avgBilling: number }
  lyMechanical: WorkshopSplit
  lyAccidental: WorkshopSplit
  locations: WorkshopLocation[]
  trend: WorkshopTrendPoint[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

// The shared dedup CTE — identical ranking to lib/kia/ro-billing-kpis.ts and the RO Billing route.
function dedupCte(start: string, end: string, dealerCode: KiaDealerCode | null) {
  return sql`
    raw AS (
      SELECT
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        ${serviceCategoryExpression('work_type', 'service_type')} AS service_category,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt,
        bill_date::date AS report_date,
        uploaded_at,
        id
      FROM kia_ro_billing_report
      WHERE bill_date >= ${start}::date
        AND bill_date < (${end}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY jc_key
        ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC, uploaded_at DESC NULLS LAST, id DESC
      ) AS row_rank
      FROM raw
    ),
    dedup AS (SELECT * FROM ranked WHERE row_rank = 1)`
}

function emptySplit(): WorkshopSplit { return { roCount: 0, labour: 0, parts: 0, billing: 0 } }

// Per-category (deduped) counts + labour + parts, bucketed into mechanical vs accidental.
async function fetchSplit(start: string, end: string, dealerCode: KiaDealerCode | null) {
  const result = await db.execute(sql`
    WITH ${dedupCte(start, end, dealerCode)}
    SELECT service_category,
      COUNT(*)::int AS ro_count,
      COALESCE(SUM(labour_amt), 0)::float AS labour,
      COALESCE(SUM(part_amt), 0)::float AS parts
    FROM dedup
    WHERE service_category IN ${CANONICAL_CATEGORIES}
    GROUP BY service_category`)

  const mechanical = emptySplit()
  const accidental = emptySplit()
  for (const row of resultRows(result)) {
    const bucket = String(row.service_category || '') === 'Accidental Repair' ? accidental : mechanical
    const count = numberValue(row.ro_count)
    const labour = numberValue(row.labour)
    const parts = numberValue(row.parts)
    bucket.roCount += count
    bucket.labour += labour
    bucket.parts += parts
    bucket.billing += labour + parts
  }
  return { mechanical, accidental }
}

// Per-day deduped total billing (labour + parts) for the trend line.
async function fetchDailyBilling(start: string, end: string, dealerCode: KiaDealerCode | null) {
  const result = await db.execute(sql`
    WITH ${dedupCte(start, end, dealerCode)}
    SELECT report_date::text AS date, COALESCE(SUM(labour_amt + part_amt), 0)::float AS billing
    FROM dedup
    WHERE service_category IN ${CANONICAL_CATEGORIES}
    GROUP BY report_date`)
  const byDay = new Map<number, number>()
  for (const row of resultRows(result)) {
    const dateStr = String(row.date || '')
    const day = Number(dateStr.slice(8, 10))
    if (day >= 1) byDay.set(day, (byDay.get(day) || 0) + numberValue(row.billing))
  }
  return byDay
}

function addSplits(a: { mechanical: WorkshopSplit; accidental: WorkshopSplit }, b: { mechanical: WorkshopSplit; accidental: WorkshopSplit }) {
  const add = (x: WorkshopSplit, y: WorkshopSplit): WorkshopSplit => ({
    roCount: x.roCount + y.roCount, labour: x.labour + y.labour, parts: x.parts + y.parts, billing: x.billing + y.billing,
  })
  return { mechanical: add(a.mechanical, b.mechanical), accidental: add(a.accidental, b.accidental) }
}

function toLocation(dealer: KiaDealerCode, cy: { mechanical: WorkshopSplit; accidental: WorkshopSplit }, lyBilling: number): WorkshopLocation {
  const billing = cy.mechanical.billing + cy.accidental.billing
  const growth = lyBilling > 0 ? Math.round(((billing - lyBilling) / lyBilling) * 1000) / 10 : null
  return {
    dealer, label: DEALER_LABELS[dealer] || dealer, billing,
    roCount: cy.mechanical.roCount + cy.accidental.roCount,
    labour: cy.mechanical.labour + cy.accidental.labour,
    parts: cy.mechanical.parts + cy.accidental.parts,
    growth,
  }
}

export async function getKiaWorkshopSummary(input: { endDate?: string | null; dealerCode?: KiaDealerCode | null }): Promise<KiaWorkshopSummary> {
  const dealerCode = input.dealerCode || null
  // Anchor month/day from endDate (default: today, in IST so "today" matches the dealership's day).
  const nowIst = new Date(Date.now() + 330 * 60_000)
  const end = input.endDate && /^\d{4}-\d{2}-\d{2}$/.test(input.endDate) ? input.endDate : ymd(nowIst)
  const [ey, em, ed] = end.split('-').map(Number)
  const monthStart = getMonthStart(end)
  const daysInMonth = new Date(Date.UTC(ey, em, 0)).getUTCDate()
  const throughDay = Math.min(Math.max(ed, 1), daysInMonth)

  // Last-year same-month windows: LY through-day for MTD growth, full LY month for the trend line.
  const lyDaysInMonth = new Date(Date.UTC(ey - 1, em, 0)).getUTCDate()
  const lyMonthStart = `${ey - 1}-${pad(em)}-01`
  const lyEnd = `${ey - 1}-${pad(em)}-${pad(Math.min(throughDay, lyDaysInMonth))}`
  const lyMonthEnd = `${ey - 1}-${pad(em)}-${pad(lyDaysInMonth)}`

  const wantJammu = !dealerCode || dealerCode === 'JK402'
  const wantUdhampur = !dealerCode || dealerCode === 'JK501'

  const [jammuCy, jammuLy, udhampurCy, udhampurLy, cyDaily, lyDaily] = await Promise.all([
    wantJammu ? fetchSplit(monthStart, end, 'JK402') : Promise.resolve({ mechanical: emptySplit(), accidental: emptySplit() }),
    wantJammu ? fetchSplit(lyMonthStart, lyEnd, 'JK402') : Promise.resolve({ mechanical: emptySplit(), accidental: emptySplit() }),
    wantUdhampur ? fetchSplit(monthStart, end, 'JK501') : Promise.resolve({ mechanical: emptySplit(), accidental: emptySplit() }),
    wantUdhampur ? fetchSplit(lyMonthStart, lyEnd, 'JK501') : Promise.resolve({ mechanical: emptySplit(), accidental: emptySplit() }),
    fetchDailyBilling(monthStart, end, dealerCode),
    fetchDailyBilling(lyMonthStart, lyMonthEnd, dealerCode),
  ])

  // Summary = the selected dealer, or both summed (KIA has exactly JK402 + JK501).
  const combined = dealerCode === 'JK402' ? jammuCy
    : dealerCode === 'JK501' ? udhampurCy
    : addSplits(jammuCy, udhampurCy)
  const mechanical = combined.mechanical
  const accidental = combined.accidental
  const totalSplit: WorkshopSplit = {
    roCount: mechanical.roCount + accidental.roCount,
    labour: mechanical.labour + accidental.labour,
    parts: mechanical.parts + accidental.parts,
    billing: mechanical.billing + accidental.billing,
  }

  // Last-year combined splits
  const combinedLy = dealerCode === 'JK402' ? jammuLy
    : dealerCode === 'JK501' ? udhampurLy
    : addSplits(jammuLy, udhampurLy)
  const lyMechanical = combinedLy.mechanical
  const lyAccidental = combinedLy.accidental
  const lyTotalSplit: WorkshopSplit = {
    roCount: lyMechanical.roCount + lyAccidental.roCount,
    labour: lyMechanical.labour + lyAccidental.labour,
    parts: lyMechanical.parts + lyAccidental.parts,
    billing: lyMechanical.billing + lyAccidental.billing,
  }

  const locations: WorkshopLocation[] = []
  if (wantJammu) locations.push(toLocation('JK402', jammuCy, jammuLy.mechanical.billing + jammuLy.accidental.billing))
  if (wantUdhampur) locations.push(toLocation('JK501', udhampurCy, udhampurLy.mechanical.billing + udhampurLy.accidental.billing))

  // Daily trend for all days of the month: cy = this-year daily billing (0 for days with no bills /
  // future days), ly = last-year same day. Same shape/labels the RO Billing "Day Wise Trend" uses.
  const trend: WorkshopTrendPoint[] = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    const dow = DOW[new Date(Date.UTC(ey, em - 1, day)).getUTCDay()]
    return { day: `${pad(day)} ${dow}`, cy: Math.round(cyDaily.get(day) || 0), ly: Math.round(lyDaily.get(day) || 0) }
  })

  const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
    .format(new Date(Date.UTC(ey, em - 1, 1)))

  return {
    meta: { monthLabel, startDate: monthStart, endDate: end, throughDay, daysInMonth, dealerCode, dataAvailable: totalSplit.roCount > 0 },
    total: { ...totalSplit, avgBilling: totalSplit.roCount > 0 ? totalSplit.billing / totalSplit.roCount : 0 },
    mechanical,
    accidental,
    lyTotal: { ...lyTotalSplit, avgBilling: lyTotalSplit.roCount > 0 ? lyTotalSplit.billing / lyTotalSplit.roCount : 0 },
    lyMechanical,
    lyAccidental,
    locations,
    trend,
  }
}
