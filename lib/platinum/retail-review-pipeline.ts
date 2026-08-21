import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { platinumEnquiryCohortCte } from './retail-review-panels'

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

export type PlatinumBookingMonthRow = {
  month: number
  booked: number
  cancelled: number
  retailed: number
  open: number
}

export type PlatinumBookingAging = { d0_30: number; d31_60: number; d61_90: number; d90_plus: number }

export type PlatinumBookingBacklogRow = {
  outlet: string
  label: string
  open: number
  amountReceived: number
  overdue: number
  aging: PlatinumBookingAging
}

export type PlatinumBookingsPanel = {
  year: number
  combined: { months: PlatinumBookingMonthRow[]; booked: number; cancelled: number; cancelRate: number }
  backlog: {
    total: Omit<PlatinumBookingBacklogRow, 'outlet' | 'label'>
    topModels: { model: string; count: number }[]
  }
  notes: string[]
}

export type PlatinumEnquiryMonthRow = {
  month: number
  enquiries: number
  testDrives: number
  tdRatePct: number
}

export type PlatinumEnquiryPanel = {
  year: number
  combined: { months: PlatinumEnquiryMonthRow[]; enquiries: number; testDrives: number; tdRatePct: number }
  topModels: { model: string; count: number; sharePct: number }[]
  topSources: { source: string; count: number; sharePct: number }[]
  notes: string[]
}

export async function getPlatinumBookingsPanel(year: number): Promise<PlatinumBookingsPanel> {
  const [monthlyResult, backlogResult] = await Promise.all([
    analyticsDb.execute(sql`
      SELECT
        EXTRACT(MONTH FROM b.booking_date)::int AS mo,
        COUNT(*)::int AS booked,
        0 AS cancelled,
        0 AS retailed
      FROM am_platinum_booking_report b
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
      FROM am_platinum_booking_report
      WHERE booking_date IS NOT NULL
    `),
  ])

  const topModelsResult = await analyticsDb.execute(sql`
    SELECT
      COALESCE(NULLIF(TRIM(model::text), ''), 'Other') AS model,
      COUNT(*)::int AS n
    FROM am_platinum_booking_report
    WHERE booking_date IS NOT NULL AND EXTRACT(YEAR FROM booking_date) = ${year}
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10
  `)

  const monthMap = new Map<number, { booked: number; cancelled: number; retailed: number }>()
  for (const r of rows(monthlyResult)) {
    monthMap.set(num(r.mo), {
      booked: num(r.booked),
      cancelled: num(r.cancelled),
      retailed: num(r.retailed),
    })
  }

  let runningOpen = 0
  const months: PlatinumBookingMonthRow[] = Array.from({ length: 12 }, (_, i) => {
    const mo = i + 1
    const data = monthMap.get(mo) || { booked: 0, cancelled: 0, retailed: 0 }
    runningOpen += data.booked - data.cancelled - data.retailed
    return {
      month: mo,
      booked: data.booked,
      cancelled: data.cancelled,
      retailed: data.retailed,
      open: Math.max(0, runningOpen),
    }
  })

  const totalBooked = months.reduce((acc, m) => acc + m.booked, 0)
  const totalCancelled = months.reduce((acc, m) => acc + m.cancelled, 0)
  const blRow = rows(backlogResult)[0] || {}

  return {
    year,
    combined: {
      months,
      booked: totalBooked,
      cancelled: totalCancelled,
      cancelRate: pct(totalCancelled, totalBooked),
    },
    backlog: {
      total: {
        open: num(blRow.open_count),
        amountReceived: num(blRow.amount),
        overdue: num(blRow.overdue),
        aging: {
          d0_30: num(blRow.d0_30),
          d31_60: num(blRow.d31_60),
          d61_90: num(blRow.d61_90),
          d90_plus: num(blRow.d90_plus),
        },
      },
      topModels: rows(topModelsResult).map((r) => ({
        model: String(r.model),
        count: num(r.n),
      })),
    },
    notes: [
      'Booking intake and backlog are aggregated from am_platinum_booking_report.',
      'Overdue backlog counts bookings where committed delivery date has passed without invoicing.',
    ],
  }
}

export async function getPlatinumEnquiryPanel(year: number): Promise<PlatinumEnquiryPanel> {
  const [monthlyResult, modelsResult, sourcesResult] = await Promise.all([
    analyticsDb.execute(sql`
      SELECT
        EXTRACT(MONTH FROM e.enquiry_date)::int AS mo,
        COUNT(*)::int AS enquiries,
        COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(e.test_drive::text, ''))) IN ('y', 'yes', 'done', 'taken', 'completed'))::int AS test_drives
      FROM am_platinum_enquiry_report e
      WHERE e.enquiry_date IS NOT NULL AND EXTRACT(YEAR FROM e.enquiry_date) = ${year}
      GROUP BY 1
      ORDER BY 1
    `),
    analyticsDb.execute(sql`
      SELECT
        COALESCE(NULLIF(TRIM(model::text), ''), 'Other') AS model,
        COUNT(*)::int AS n
      FROM am_platinum_enquiry_report
      WHERE enquiry_date IS NOT NULL AND EXTRACT(YEAR FROM enquiry_date) = ${year}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `),
    analyticsDb.execute(sql`
      SELECT
        COALESCE(NULLIF(TRIM(sub_source::text), ''), NULLIF(TRIM(source::text), ''), 'Other') AS source,
        COUNT(*)::int AS n
      FROM am_platinum_enquiry_report
      WHERE enquiry_date IS NOT NULL AND EXTRACT(YEAR FROM enquiry_date) = ${year}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `),
  ])

  const monthMap = new Map<number, { enquiries: number; testDrives: number }>()
  for (const r of rows(monthlyResult)) {
    monthMap.set(num(r.mo), {
      enquiries: num(r.enquiries),
      testDrives: num(r.test_drives),
    })
  }

  const months: PlatinumEnquiryMonthRow[] = Array.from({ length: 12 }, (_, i) => {
    const mo = i + 1
    const data = monthMap.get(mo) || { enquiries: 0, testDrives: 0 }
    return {
      month: mo,
      enquiries: data.enquiries,
      testDrives: data.testDrives,
      tdRatePct: pct(data.testDrives, data.enquiries),
    }
  })

  const totalEnquiries = months.reduce((acc, m) => acc + m.enquiries, 0)
  const totalTestDrives = months.reduce((acc, m) => acc + m.testDrives, 0)

  return {
    year,
    combined: {
      months,
      enquiries: totalEnquiries,
      testDrives: totalTestDrives,
      tdRatePct: pct(totalTestDrives, totalEnquiries),
    },
    topModels: rows(modelsResult).map((r) => ({
      model: String(r.model),
      count: num(r.n),
      sharePct: pct(num(r.n), totalEnquiries),
    })),
    topSources: rows(sourcesResult).map((r) => ({
      source: String(r.source),
      count: num(r.n),
      sharePct: pct(num(r.n), totalEnquiries),
    })),
    notes: [
      'Enquiries and test drives are derived from am_platinum_enquiry_report.',
      'Test drives count records where test_drive is flagged Yes/Done.',
    ],
  }
}
