import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import {
  hyundaiActiveBillSql,
  hyundaiRoBillingDealerFilter,
  hyundaiRoBillingRoKeySql,
} from '@/lib/hyundai/business-excellence-calculations'

const CANONICAL_CATEGORIES = sql`('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')`
const DEALER_LABELS: Record<string, string> = {
  JAMMU: 'Jammu',
  AKHNOOR: 'Akhnoor',
  KATHUA: 'Kathua',
  RS_PURA: 'RS Pura',
  VIJAYPUR: 'Vijaypur',
  BILLAWAR: 'Billawar',
}
const ALL_DEALER_CODES = ['JAMMU', 'AKHNOOR', 'KATHUA', 'RS_PURA', 'VIJAYPUR', 'BILLAWAR'] as const
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export type WorkshopSplit = { roCount: number; labour: number; parts: number; billing: number }
export type WorkshopLocation = { dealer: string; label: string; billing: number; roCount: number; labour: number; parts: number; growth: number | null }
export type WorkshopTrendPoint = { day: string; cy: number; ly: number }
export type HyundaiWorkshopSummary = {
  meta: { monthLabel: string; startDate: string; endDate: string; throughDay: number; daysInMonth: number; dealerCode: string | null; dataAvailable: boolean }
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

function getMonthStart(dateStr: string) {
  return `${dateStr.slice(0, 7)}-01`
}

function resultRows(result: any) {
  return (result.rows ?? result) as any[]
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function categorySql(column: string) {
  const source = sql.raw(column)
  return sql`
    CASE
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%accident%'
        OR LOWER(COALESCE(${source}::text, '')) LIKE '%bodyshop%' THEN 'Accidental Repair'
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%running%' THEN 'Running Repair'
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%free%' THEN 'Free Service'
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%paid%'
        OR COALESCE(${source}::text, '') ~* '^[0-9]+K$' THEN 'Paid Service'
      ELSE 'Others'
    END
  `
}

function dedupCte(start: string, end: string, dealerCode: string | null) {
  return sql`
    raw AS (
      SELECT
        ${hyundaiRoBillingRoKeySql()} AS jc_key,
        ${categorySql('work_type')} AS service_category,
        COALESCE(labour_amt, 0)::float AS labour_amt,
        COALESCE(part_amt, 0)::float AS part_amt,
        bill_date::date AS report_date,
        uploaded_at,
        id
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${start}::date
        AND bill_date < (${end}::date + INTERVAL '1 day')
        AND ${hyundaiActiveBillSql()}
        ${hyundaiRoBillingDealerFilter(dealerCode)}
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

async function fetchSplit(start: string, end: string, dealerCode: string | null) {
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

async function fetchDailyBilling(start: string, end: string, dealerCode: string | null) {
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

function toLocation(dealer: string, cy: { mechanical: WorkshopSplit; accidental: WorkshopSplit }, lyBilling: number): WorkshopLocation {
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

export async function getHyundaiWorkshopSummary(input: { endDate?: string | null; dealerCode?: string | null }): Promise<HyundaiWorkshopSummary> {
  const dealerCode = input.dealerCode || null
  const nowIst = new Date(Date.now() + 330 * 60_000)
  const end = input.endDate && /^\d{4}-\d{2}-\d{2}$/.test(input.endDate) ? input.endDate : ymd(nowIst)
  const [ey, em, ed] = end.split('-').map(Number)
  const monthStart = getMonthStart(end)
  const daysInMonth = new Date(Date.UTC(ey, em, 0)).getUTCDate()
  const throughDay = Math.min(Math.max(ed, 1), daysInMonth)

  const lyDaysInMonth = new Date(Date.UTC(ey - 1, em, 0)).getUTCDate()
  const lyMonthStart = `${ey - 1}-${pad(em)}-01`
  const lyEnd = `${ey - 1}-${pad(em)}-${pad(Math.min(throughDay, lyDaysInMonth))}`
  const lyMonthEnd = `${ey - 1}-${pad(em)}-${pad(lyDaysInMonth)}`

  const dealersToFetch = dealerCode ? [dealerCode] : ALL_DEALER_CODES

  const [cySplits, lySplits, cyDaily, lyDaily] = await Promise.all([
    Promise.all(dealersToFetch.map(d => fetchSplit(monthStart, end, d))),
    Promise.all(dealersToFetch.map(d => fetchSplit(lyMonthStart, lyEnd, d))),
    fetchDailyBilling(monthStart, end, dealerCode),
    fetchDailyBilling(lyMonthStart, lyMonthEnd, dealerCode),
  ])

  // Combine CY splits
  let cyCombined = cySplits[0]
  for (let i = 1; i < cySplits.length; i++) {
    cyCombined = addSplits(cyCombined, cySplits[i])
  }

  // Combine LY splits
  let lyCombined = lySplits[0]
  for (let i = 1; i < lySplits.length; i++) {
    lyCombined = addSplits(lyCombined, lySplits[i])
  }

  const mechanical = cyCombined.mechanical
  const accidental = cyCombined.accidental
  const totalSplit: WorkshopSplit = {
    roCount: mechanical.roCount + accidental.roCount,
    labour: mechanical.labour + accidental.labour,
    parts: mechanical.parts + accidental.parts,
    billing: mechanical.billing + accidental.billing,
  }

  const lyMechanical = lyCombined.mechanical
  const lyAccidental = lyCombined.accidental
  const lyTotalSplit: WorkshopSplit = {
    roCount: lyMechanical.roCount + lyAccidental.roCount,
    labour: lyMechanical.labour + lyAccidental.labour,
    parts: lyMechanical.parts + lyAccidental.parts,
    billing: lyMechanical.billing + lyAccidental.billing,
  }

  const locations: WorkshopLocation[] = dealersToFetch.map((d, index) => {
    const cy = cySplits[index]
    const ly = lySplits[index]
    return toLocation(d, cy, ly.mechanical.billing + ly.accidental.billing)
  })

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
