import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'

export function hyundaiEnquiryCohortCte(year: number) {
  return sql`
  cohort AS MATERIALIZED (
    SELECT
      EXTRACT(MONTH FROM e.enquiry_date)::int AS mo,
      COALESCE(NULLIF(TRIM(e.source_dealer_code::text), ''), NULLIF(TRIM(e.dealer_code::text), ''), 'JAMMU') AS outlet,
      COALESCE(NULLIF(TRIM(e.sub_source::text), ''), NULLIF(TRIM(e.source::text), ''), 'Unspecified') AS source,
      COALESCE(NULLIF(TRIM(e.customer_id::text), ''), 'CUST-' || e.id::text) AS customer_id,
      COALESCE(NULLIF(TRIM(e.model::text), ''), 'Other') AS model,
      (LOWER(TRIM(COALESCE(e.test_drive::text, ''))) IN ('y', 'yes', 'done', 'taken', 'completed')) AS has_td,
      (e.booking_date IS NOT NULL OR (e.order_ref_no IS NOT NULL AND TRIM(e.order_ref_no::text) <> '')) AS has_booking,
      (e.delivery_date IS NOT NULL OR e.retail_date IS NOT NULL) AS has_ret,
      (NULLIF(TRIM(e.lost_reason::text), '') IS NOT NULL OR LOWER(TRIM(COALESCE(e.enquiry_status::text, ''))) LIKE '%cancel%' OR LOWER(TRIM(COALESCE(e.enquiry_status::text, ''))) LIKE '%lost%') AS has_lost,
      COALESCE(NULLIF(TRIM(e.lost_reason::text), ''), 'Customer Mind Change') AS lost_reason,
      (LOWER(TRIM(COALESCE(e.exchange_opted::text, ''))) IN ('y', 'yes', 'true', '1')) AS exch_interested,
      (e.present_car IS NOT NULL OR e.maker_name IS NOT NULL OR e.maker_model IS NOT NULL) AS exch_evaluated,
      COALESCE(NULLIF(TRIM(e.maker_name::text), ''), NULLIF(TRIM(e.present_car::text), ''), 'Other') AS maker_name
    FROM hyundai_enquiry_report e
    WHERE e.enquiry_date IS NOT NULL
      AND EXTRACT(YEAR FROM e.enquiry_date) = ${year}
  ),
  retailed AS MATERIALIZED (
    SELECT
      v.customer_id,
      EXTRACT(MONTH FROM v.retail_date)::int AS mo,
      v.outlet,
      COALESCE(src.source, v.fallback_source, 'Unspecified') AS source
    FROM (
      SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number)))
        COALESCE(NULLIF(TRIM(s.customerid::text), ''), 'CUST-' || s.id::text) AS customer_id,
        COALESCE(s.confirm_date, s.delivery_date) AS retail_date,
        COALESCE(NULLIF(TRIM(s.source_dealer_code::text), ''), NULLIF(TRIM(s.dealer_code::text), ''), 'JAMMU') AS outlet,
        COALESCE(NULLIF(TRIM(s.sub_source::text), ''), NULLIF(TRIM(s.source::text), ''), 'Unspecified') AS fallback_source
      FROM hyundai_sales_report s
      WHERE COALESCE(s.vin_number, '') <> ''
        AND (s.confirm_date IS NOT NULL OR s.delivery_date IS NOT NULL)
        AND EXTRACT(YEAR FROM COALESCE(s.confirm_date, s.delivery_date)) = ${year}
      ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST
    ) v
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(TRIM(e2.sub_source::text), ''), NULLIF(TRIM(e2.source::text), ''), 'Unspecified') AS source
      FROM hyundai_enquiry_report e2
      WHERE COALESCE(NULLIF(TRIM(e2.customer_id::text), ''), '') = v.customer_id
        AND e2.enquiry_date IS NOT NULL
        AND e2.enquiry_date <= v.retail_date
      ORDER BY e2.enquiry_date DESC
      LIMIT 1
    ) src ON TRUE
  )`
}

export type HyundaiConversionRow = {
  key: string
  label: string
  enquiries: number
  testDrives: number
  bookings: number
  retails: number
  e2td: number
  e2bkg: number
  e2ret: number
}

export type HyundaiOutletConversion = {
  outlet: string
  label: string
  total: HyundaiConversionRow
  sources: HyundaiConversionRow[]
}

export type HyundaiMonthlySourceRow = {
  source: string
  outlet: string
  months: HyundaiConversionRow[]
}

export type HyundaiConversionPanel = {
  year: number
  month?: number | null
  monthLabel?: string | null
  outlets: HyundaiOutletConversion[]
  focusSources: HyundaiMonthlySourceRow[]
  outletMonths: HyundaiMonthlySourceRow[]
  notes: string[]
}

export type HyundaiExchangeMonthRow = {
  month: number
  enquiries: number
  interested: number
  evaluated: number
  retailed: number
  interestRatePct: number
  evalRatePct: number
  evalToRetPct: number
}

export type HyundaiExchangePanel = {
  year: number
  combined: {
    months: HyundaiExchangeMonthRow[]
    enquiries: number
    interested: number
    evaluated: number
    retailed: number
    interestRatePct: number
    evalRatePct: number
    evalToRetPct: number
  }
  topMakers: { name: string; count: number }[]
  notes: string[]
}

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

function toRow(key: string, label: string, enq: number, td: number, bkg: number, ret: number): HyundaiConversionRow {
  return {
    key,
    label,
    enquiries: enq,
    testDrives: td,
    bookings: bkg,
    retails: ret,
    e2td: pct(td, enq),
    e2bkg: pct(bkg, enq),
    e2ret: pct(ret, enq),
  }
}

const FOCUS_SOURCES = ['Hyper Local', 'Walkin', 'SC own source', 'Website', 'Showroom Visit']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export async function getHyundaiConversionPanel(year: number, month?: number | null): Promise<HyundaiConversionPanel> {
  const [result, bookingResult] = await Promise.all([
    analyticsDb.execute(sql`
      WITH ${hyundaiEnquiryCohortCte(year)}
      SELECT mo, outlet, source, SUM(enq)::int AS enq, SUM(td)::int AS td, SUM(bkg)::int AS bkg, SUM(ret)::int AS ret
      FROM (
        SELECT c.mo, c.outlet, c.source,
          COUNT(*)::int AS enq,
          COUNT(*) FILTER (WHERE c.has_td)::int AS td,
          COUNT(*) FILTER (WHERE c.has_booking)::int AS bkg,
          0 AS ret
        FROM cohort c GROUP BY c.mo, c.outlet, c.source
        UNION ALL
        SELECT r.mo, r.outlet, r.source, 0, 0, 0, COUNT(*)::int
        FROM retailed r GROUP BY r.mo, r.outlet, r.source
      ) u GROUP BY mo, outlet, source
    `),
    analyticsDb.execute(sql`
      SELECT EXTRACT(MONTH FROM booking_date)::int AS mo,
        COALESCE(NULLIF(TRIM(source_dealer_code::text), ''), NULLIF(TRIM(dealer_code::text), ''), 'JAMMU') AS outlet,
        COUNT(*)::int AS booked
      FROM hyundai_booking_report
      WHERE booking_date IS NOT NULL
        AND EXTRACT(YEAR FROM booking_date) = ${year}
      GROUP BY 1, 2
    `),
  ])

  const raw = rows(result).map((row) => ({
    mo: num(row.mo),
    outlet: String(row.outlet || 'JAMMU').trim().toUpperCase(),
    source: String(row.source || 'Unspecified'),
    enq: num(row.enq), td: num(row.td), bkg: num(row.bkg), ret: num(row.ret),
  }))

  const realBookings = rows(bookingResult).map((row) => ({
    mo: num(row.mo),
    outlet: String(row.outlet || 'JAMMU').trim().toUpperCase(),
    booked: num(row.booked),
  }))

  const realBookingCount = (mo: number, outlet: string): number =>
    realBookings.filter((r) => r.mo === mo && (outlet === 'ALL' || r.outlet === outlet)).reduce((sum, r) => sum + r.booked, 0)

  const monthLabel = month && month >= 1 && month <= 12 ? `${MONTH_NAMES[month - 1]} ${year}` : `CY${year}`

  // Single consolidated group outlet
  const filteredRows = raw.filter((row) => (month ? row.mo === month : true))
  const bySource = new Map<string, { enq: number; td: number; bkg: number; ret: number }>()
  let t = { enq: 0, td: 0, bkg: 0, ret: 0 }
  for (const row of filteredRows) {
    const bucket = bySource.get(row.source) || { enq: 0, td: 0, bkg: 0, ret: 0 }
    bucket.enq += row.enq; bucket.td += row.td; bucket.bkg += row.bkg; bucket.ret += row.ret
    bySource.set(row.source, bucket)
    t = { enq: t.enq + row.enq, td: t.td + row.td, bkg: t.bkg + row.bkg, ret: t.ret + row.ret }
  }

  const outlets: HyundaiOutletConversion[] = [
    {
      outlet: 'ALL',
      label: 'AM Hyundai Group Consolidated',
      total: toRow('ALL', 'AM Hyundai Group Consolidated', t.enq, t.td, t.bkg, t.ret),
      sources: [...bySource.entries()]
        .map(([source, v]) => toRow(`ALL:${source}`, source, v.enq, v.td, v.bkg, v.ret))
        .sort((a, b) => b.enquiries - a.enquiries),
    },
  ]

  const monthlyFor = (predicate: (row: typeof raw[number]) => boolean, label: string) => {
    const months: HyundaiConversionRow[] = Array.from({ length: 12 }, (_, index) => {
      const monthRows = raw.filter((row) => row.mo === index + 1 && predicate(row))
      const total = monthRows.reduce((acc, row) => ({
        enq: acc.enq + row.enq, td: acc.td + row.td, bkg: acc.bkg + row.bkg, ret: acc.ret + row.ret,
      }), { enq: 0, td: 0, bkg: 0, ret: 0 })
      return toRow(`ALL:${label}:${index + 1}`, String(index + 1), total.enq, total.td, total.bkg, total.ret)
    })
    return { source: label, outlet: 'ALL', months }
  }

  const focusSources: HyundaiMonthlySourceRow[] = FOCUS_SOURCES.map((source) =>
    monthlyFor((row) => row.source.toLowerCase() === source.toLowerCase(), source)
  )

  const outletMonths: HyundaiMonthlySourceRow[] = [
    {
      source: 'All sources',
      outlet: 'ALL',
      months: Array.from({ length: 12 }, (_, index) => {
        const mo = index + 1
        const monthRows = raw.filter((row) => row.mo === mo)
        const enq = monthRows.reduce((sum, row) => sum + row.enq, 0)
        const td = monthRows.reduce((sum, row) => sum + row.td, 0)
        const bkg = realBookingCount(mo, 'ALL')
        const ret = monthRows.reduce((sum, row) => sum + row.ret, 0)
        return toRow(`ALL:All sources:${mo}`, String(mo), enq, td, bkg, ret)
      }),
    },
  ]

  return {
    year,
    month: month ?? null,
    monthLabel,
    outlets,
    focusSources,
    outletMonths,
    notes: [
      'Enquiries, Test Drives and Bookings are cohort-based from the DMS enquiry feed.',
      'Retails are matched from the sales confirmed feed attributed back to the customer enquiry channel.',
    ],
  }
}

export async function getHyundaiExchangePanel(year: number): Promise<HyundaiExchangePanel> {
  const [monthlyResult, makersResult] = await Promise.all([
    analyticsDb.execute(sql`
      WITH ${hyundaiEnquiryCohortCte(year)}
      SELECT
        mo,
        COUNT(*)::int AS enq,
        COUNT(*) FILTER (WHERE exch_interested)::int AS interested,
        COUNT(*) FILTER (WHERE exch_evaluated)::int AS evaluated,
        COUNT(*) FILTER (WHERE has_ret)::int AS retailed
      FROM cohort
      GROUP BY 1
      ORDER BY 1
    `),
    analyticsDb.execute(sql`
      WITH ${hyundaiEnquiryCohortCte(year)}
      SELECT maker_name, COUNT(*)::int AS count
      FROM cohort
      WHERE maker_name <> '' AND maker_name <> 'Other'
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `),
  ])

  const monthlyRows = rows(monthlyResult).map((r) => {
    const mo = num(r.mo)
    const enq = num(r.enq)
    const interested = num(r.interested)
    const evaluated = num(r.evaluated)
    const retailed = num(r.retailed)
    return {
      month: mo,
      enquiries: enq,
      interested,
      evaluated,
      retailed,
      interestRatePct: pct(interested, enq),
      evalRatePct: pct(evaluated, interested > 0 ? interested : enq),
      evalToRetPct: pct(retailed, evaluated > 0 ? evaluated : enq),
    } satisfies HyundaiExchangeMonthRow
  })

  const months: HyundaiExchangeMonthRow[] = Array.from({ length: 12 }, (_, index) => {
    const found = monthlyRows.find((r) => r.month === index + 1)
    return found || {
      month: index + 1,
      enquiries: 0,
      interested: 0,
      evaluated: 0,
      retailed: 0,
      interestRatePct: 0,
      evalRatePct: 0,
      evalToRetPct: 0,
    }
  })

  const totEnq = months.reduce((s, m) => s + m.enquiries, 0)
  const totInt = months.reduce((s, m) => s + m.interested, 0)
  const totEval = months.reduce((s, m) => s + m.evaluated, 0)
  const totRet = months.reduce((s, m) => s + m.retailed, 0)

  return {
    year,
    combined: {
      months,
      enquiries: totEnq,
      interested: totInt,
      evaluated: totEval,
      retailed: totRet,
      interestRatePct: pct(totInt, totEnq),
      evalRatePct: pct(totEval, totInt > 0 ? totInt : totEnq),
      evalToRetPct: pct(totRet, totEval > 0 ? totEval : totEnq),
    },
    topMakers: rows(makersResult).map((r) => ({
      name: String(r.maker_name || 'Other'),
      count: num(r.count),
    })),
    notes: [
      'Exchange interest is tracked via the exchange_opted flag on active customer enquiries.',
      'Evaluations track customer vehicles recorded for valuation and trade-in.',
    ],
  }
}
