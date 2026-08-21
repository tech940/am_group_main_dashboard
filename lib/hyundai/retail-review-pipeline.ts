import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { hyundaiEnquiryCohortCte } from './retail-review-panels'

function rows(result: unknown): Record<string, unknown>[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? [])) as Record<string, unknown>[]
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function pct(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : 0
}

export type HyundaiBookingMonthRow = {
  month: number
  booked: number
  cancelled: number
  retailed: number
  open: number
}

export type HyundaiBookingAging = { d0_30: number; d31_60: number; d61_90: number; d90_plus: number }

export type HyundaiBookingBacklogRow = {
  outlet: string
  label: string
  open: number
  amountReceived: number
  overdue: number
  aging: HyundaiBookingAging
}

export type HyundaiBookingsPanel = {
  year: number
  combined: { months: HyundaiBookingMonthRow[]; booked: number; cancelled: number; cancelRate: number }
  backlog: {
    total: Omit<HyundaiBookingBacklogRow, 'outlet' | 'label'>
    topModels: { model: string; count: number }[]
  }
  notes: string[]
}

export type HyundaiEnquiryMonthRow = {
  month: number
  enquiries: number
  testDrives: number
  tdRatePct: number
}

export type HyundaiEnquiryPanel = {
  year: number
  combined: { months: HyundaiEnquiryMonthRow[]; enquiries: number; testDrives: number; tdRatePct: number }
  topModels: { model: string; count: number; sharePct: number }[]
  topSources: { source: string; count: number; sharePct: number }[]
  notes: string[]
}

export async function getHyundaiBookingsPanel(year: number): Promise<HyundaiBookingsPanel> {
  const [monthlyResult, backlogResult] = await Promise.all([
    analyticsDb.execute(sql`
      SELECT
        EXTRACT(MONTH FROM b.booking_date)::int AS mo,
        COUNT(*)::int AS booked,
        0 AS cancelled,
        0 AS retailed
      FROM hyundai_booking_report b
      WHERE b.booking_date IS NOT NULL AND EXTRACT(YEAR FROM b.booking_date) = ${year}
      GROUP BY 1
      ORDER BY 1
    `),
    analyticsDb.execute(sql`
      SELECT
        COUNT(*)::int AS open_count,
        COALESCE(SUM(amount_received), 0)::float AS amount,
        COUNT(*) FILTER (WHERE committed_delivery_date IS NOT NULL AND committed_delivery_date < CURRENT_DATE)::int AS overdue,
        COUNT(*) FILTER (WHERE booking_date >= CURRENT_DATE - 30)::int AS d0_30,
        COUNT(*) FILTER (WHERE booking_date < CURRENT_DATE - 30 AND booking_date >= CURRENT_DATE - 60)::int AS d31_60,
        COUNT(*) FILTER (WHERE booking_date < CURRENT_DATE - 60 AND booking_date >= CURRENT_DATE - 90)::int AS d61_90,
        COUNT(*) FILTER (WHERE booking_date < CURRENT_DATE - 90 OR booking_date IS NULL)::int AS d90_plus
      FROM hyundai_booking_report
      WHERE booking_date IS NOT NULL
    `),
  ])

  const topModelsResult = await analyticsDb.execute(sql`
    SELECT
      COALESCE(NULLIF(TRIM(model::text), ''), 'Other') AS model,
      COUNT(*)::int AS n
    FROM hyundai_booking_report
    WHERE booking_date IS NOT NULL AND EXTRACT(YEAR FROM booking_date) = ${year}
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10
  `)

  const monthlyMap = new Map<number, number>()
  for (const r of rows(monthlyResult)) {
    monthlyMap.set(num(r.mo), num(r.booked))
  }

  const months: HyundaiBookingMonthRow[] = Array.from({ length: 12 }, (_, index) => {
    const mo = index + 1
    const booked = monthlyMap.get(mo) || 0
    return {
      month: mo,
      booked,
      cancelled: 0,
      retailed: 0,
      open: booked,
    }
  })

  const totBooked = months.reduce((sum, m) => sum + m.booked, 0)
  const bkRow = rows(backlogResult)[0] || {}

  return {
    year,
    combined: {
      months,
      booked: totBooked,
      cancelled: 0,
      cancelRate: 0,
    },
    backlog: {
      total: {
        open: num(bkRow.open_count),
        amountReceived: num(bkRow.amount),
        overdue: num(bkRow.overdue),
        aging: {
          d0_30: num(bkRow.d0_30),
          d31_60: num(bkRow.d31_60),
          d61_90: num(bkRow.d61_90),
          d90_plus: num(bkRow.d90_plus),
        },
      },
      topModels: rows(topModelsResult).map((r) => ({
        model: String(r.model),
        count: num(r.n),
      })),
    },
    notes: [
      'Bookings are sourced directly from the live DMS hyundai_booking_report records.',
      'Backlog and aging track orders with customer advance payments.',
    ],
  }
}

export async function getHyundaiEnquiryPanel(year: number): Promise<HyundaiEnquiryPanel> {
  const [monthlyResult, modelsResult, sourcesResult] = await Promise.all([
    analyticsDb.execute(sql`
      WITH ${hyundaiEnquiryCohortCte(year)}
      SELECT
        mo,
        COUNT(*)::int AS enq,
        COUNT(*) FILTER (WHERE has_td)::int AS td
      FROM cohort
      GROUP BY 1
      ORDER BY 1
    `),
    analyticsDb.execute(sql`
      WITH ${hyundaiEnquiryCohortCte(year)}
      SELECT
        model,
        COUNT(*)::int AS count
      FROM cohort
      WHERE model <> '' AND model <> 'Other'
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `),
    analyticsDb.execute(sql`
      WITH ${hyundaiEnquiryCohortCte(year)}
      SELECT
        source,
        COUNT(*)::int AS count
      FROM cohort
      WHERE source <> '' AND source <> 'Unspecified'
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `),
  ])

  const monthlyRows = rows(monthlyResult).map((r) => ({
    month: num(r.mo),
    enquiries: num(r.enq),
    testDrives: num(r.td),
    tdRatePct: pct(num(r.td), num(r.enq)),
  }))

  const months: HyundaiEnquiryMonthRow[] = Array.from({ length: 12 }, (_, index) => {
    const found = monthlyRows.find((r) => r.month === index + 1)
    return found || {
      month: index + 1,
      enquiries: 0,
      testDrives: 0,
      tdRatePct: 0,
    }
  })

  const totEnq = months.reduce((s, m) => s + m.enquiries, 0)
  const totTd = months.reduce((s, m) => s + m.testDrives, 0)

  return {
    year,
    combined: {
      months,
      enquiries: totEnq,
      testDrives: totTd,
      tdRatePct: pct(totTd, totEnq),
    },
    topModels: rows(modelsResult).map((r) => ({
      model: String(r.model),
      count: num(r.count),
      sharePct: pct(num(r.count), totEnq),
    })),
    topSources: rows(sourcesResult).map((r) => ({
      source: String(r.source),
      count: num(r.count),
      sharePct: pct(num(r.count), totEnq),
    })),
    notes: [
      'Enquiries and completed test drives are cohort-based from the DMS enquiry feed for the selected calendar year.',
    ],
  }
}
