import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'

export function platinumEnquiryCohortCte(year: number) {
  return sql`
  cohort AS MATERIALIZED (
    SELECT
      EXTRACT(MONTH FROM e.enquiry_date)::int AS mo,
      COALESCE(NULLIF(TRIM(e.source_dealer_code::text), ''), NULLIF(TRIM(e.dealer_code::text), ''), 'N5211') AS outlet,
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
    FROM am_platinum_enquiry_report e
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
        COALESCE(NULLIF(TRIM(s.source_dealer_code::text), ''), NULLIF(TRIM(s.dealer_code::text), ''), 'N5211') AS outlet,
        COALESCE(NULLIF(TRIM(s.sub_source::text), ''), NULLIF(TRIM(s.source::text), ''), 'Unspecified') AS fallback_source
      FROM am_platinum_sales_report s
      WHERE COALESCE(s.vin_number, '') <> ''
        AND (s.confirm_date IS NOT NULL OR s.delivery_date IS NOT NULL)
        AND EXTRACT(YEAR FROM COALESCE(s.confirm_date, s.delivery_date)) = ${year}
      ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST
    ) v
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(TRIM(e2.sub_source::text), ''), NULLIF(TRIM(e2.source::text), ''), 'Unspecified') AS source
      FROM am_platinum_enquiry_report e2
      WHERE COALESCE(NULLIF(TRIM(e2.customer_id::text), ''), '') = v.customer_id
        AND e2.enquiry_date IS NOT NULL
        AND e2.enquiry_date <= v.retail_date
      ORDER BY e2.enquiry_date DESC
      LIMIT 1
    ) src ON TRUE
  )`
}

export type PlatinumConversionRow = {
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

export type PlatinumOutletConversion = {
  outlet: string
  label: string
  total: PlatinumConversionRow
  sources: PlatinumConversionRow[]
}

export type PlatinumMonthlySourceRow = {
  source: string
  outlet: string
  months: PlatinumConversionRow[]
}

export type PlatinumConversionPanel = {
  year: number
  month?: number | null
  monthLabel?: string | null
  outlets: PlatinumOutletConversion[]
  focusSources: PlatinumMonthlySourceRow[]
  outletMonths: PlatinumMonthlySourceRow[]
  notes: string[]
}

export type PlatinumExchangeMonthRow = {
  month: number
  enquiries: number
  interested: number
  evaluated: number
  retailed: number
  interestRatePct: number
  evalRatePct: number
  evalToRetPct: number
}

export type PlatinumExchangeMakerRow = {
  maker: string
  evaluations: number
  retails: number
  sharePct: number
  conversionPct: number
}

export type PlatinumExchangePanel = {
  year: number
  months: PlatinumExchangeMonthRow[]
  topMakers: PlatinumExchangeMakerRow[]
  notes: string[]
}

const toInt = (val: unknown) => {
  const n = Number(val)
  return Number.isFinite(n) ? n : 0
}

const safePct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0)

export async function getPlatinumConversionPanel(year: number, month?: number | null): Promise<PlatinumConversionPanel> {
  const cte = platinumEnquiryCohortCte(year)
  const monthFilter = month && month >= 1 && month <= 12 ? sql`WHERE mo = ${month}` : sql``

  const [sourceRows, monthlySourceRows, monthlyOutletRows] = await Promise.all([
    analyticsDb.execute(sql`
      WITH ${cte},
      enq_agg AS (
        SELECT
          c.source,
          COUNT(*)::int AS enquiries,
          COUNT(*) FILTER (WHERE c.has_td)::int AS test_drives,
          COUNT(*) FILTER (WHERE c.has_booking)::int AS bookings
        FROM cohort c
        ${monthFilter}
        GROUP BY c.source
      ),
      ret_agg AS (
        SELECT
          r.source,
          COUNT(*)::int AS retails
        FROM retailed r
        ${monthFilter}
        GROUP BY r.source
      )
      SELECT
        COALESCE(e.source, r.source) AS source,
        COALESCE(e.enquiries, 0)::int AS enquiries,
        COALESCE(e.test_drives, 0)::int AS test_drives,
        COALESCE(e.bookings, 0)::int AS bookings,
        COALESCE(r.retails, 0)::int AS retails
      FROM enq_agg e
      FULL OUTER JOIN ret_agg r ON e.source = r.source
      ORDER BY enquiries DESC, retails DESC
    `),
    analyticsDb.execute(sql`
      WITH ${cte},
      enq_agg AS (
        SELECT
          c.source,
          c.mo,
          COUNT(*)::int AS enquiries,
          COUNT(*) FILTER (WHERE c.has_td)::int AS test_drives,
          COUNT(*) FILTER (WHERE c.has_booking)::int AS bookings
        FROM cohort c
        GROUP BY c.source, c.mo
      ),
      ret_agg AS (
        SELECT
          r.source,
          r.mo,
          COUNT(*)::int AS retails
        FROM retailed r
        GROUP BY r.source, r.mo
      )
      SELECT
        COALESCE(e.source, r.source) AS source,
        COALESCE(e.mo, r.mo) AS mo,
        COALESCE(e.enquiries, 0)::int AS enquiries,
        COALESCE(e.test_drives, 0)::int AS test_drives,
        COALESCE(e.bookings, 0)::int AS bookings,
        COALESCE(r.retails, 0)::int AS retails
      FROM enq_agg e
      FULL OUTER JOIN ret_agg r ON e.source = r.source AND e.mo = r.mo
      ORDER BY source, mo
    `),
    analyticsDb.execute(sql`
      WITH ${cte},
      enq_agg AS (
        SELECT
          c.mo,
          COUNT(*)::int AS enquiries,
          COUNT(*) FILTER (WHERE c.has_td)::int AS test_drives,
          COUNT(*) FILTER (WHERE c.has_booking)::int AS bookings
        FROM cohort c
        GROUP BY c.mo
      ),
      ret_agg AS (
        SELECT
          r.mo,
          COUNT(*)::int AS retails
        FROM retailed r
        GROUP BY r.mo
      )
      SELECT
        COALESCE(e.mo, r.mo) AS mo,
        COALESCE(e.enquiries, 0)::int AS enquiries,
        COALESCE(e.test_drives, 0)::int AS test_drives,
        COALESCE(e.bookings, 0)::int AS bookings,
        COALESCE(r.retails, 0)::int AS retails
      FROM enq_agg e
      FULL OUTER JOIN ret_agg r ON e.mo = r.mo
      ORDER BY mo
    `),
  ])

  const sRows = (Array.isArray(sourceRows) ? sourceRows : (sourceRows as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>
  const sources: PlatinumConversionRow[] = sRows.map((r) => {
    const enq = toInt(r.enquiries)
    const td = toInt(r.test_drives)
    const bkg = toInt(r.bookings)
    const ret = toInt(r.retails)
    return {
      key: String(r.source || 'Other'),
      label: String(r.source || 'Other'),
      enquiries: enq,
      testDrives: td,
      bookings: bkg,
      retails: ret,
      e2td: safePct(td, enq),
      e2bkg: safePct(bkg, enq),
      e2ret: safePct(ret, enq),
    }
  })

  const totalEnq = sources.reduce((s, r) => s + r.enquiries, 0)
  const totalTd = sources.reduce((s, r) => s + r.testDrives, 0)
  const totalBkg = sources.reduce((s, r) => s + r.bookings, 0)
  const totalRet = sources.reduce((s, r) => s + r.retails, 0)

  const groupTotal: PlatinumConversionRow = {
    key: 'TOTAL',
    label: 'All Sources Total',
    enquiries: totalEnq,
    testDrives: totalTd,
    bookings: totalBkg,
    retails: totalRet,
    e2td: safePct(totalTd, totalEnq),
    e2bkg: safePct(totalBkg, totalEnq),
    e2ret: safePct(totalRet, totalEnq),
  }

  const outlets: PlatinumOutletConversion[] = [
    {
      outlet: 'ALL',
      label: 'All Locations',
      total: groupTotal,
      sources,
    },
  ]

  const mSRows = (Array.isArray(monthlySourceRows) ? monthlySourceRows : (monthlySourceRows as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>
  const focusMap = new Map<string, PlatinumConversionRow[]>()
  for (const r of mSRows) {
    const src = String(r.source || 'Other')
    if (!focusMap.has(src)) {
      focusMap.set(
        src,
        Array.from({ length: 12 }, (_, i) => ({
          key: String(i + 1),
          label: String(i + 1),
          enquiries: 0,
          testDrives: 0,
          bookings: 0,
          retails: 0,
          e2td: 0,
          e2bkg: 0,
          e2ret: 0,
        }))
      )
    }
    const mo = toInt(r.mo)
    if (mo >= 1 && mo <= 12) {
      const arr = focusMap.get(src)!
      const enq = toInt(r.enquiries)
      const td = toInt(r.test_drives)
      const bkg = toInt(r.bookings)
      const ret = toInt(r.retails)
      arr[mo - 1] = {
        key: String(mo),
        label: String(mo),
        enquiries: enq,
        testDrives: td,
        bookings: bkg,
        retails: ret,
        e2td: safePct(td, enq),
        e2bkg: safePct(bkg, enq),
        e2ret: safePct(ret, enq),
      }
    }
  }

  const focusSources: PlatinumMonthlySourceRow[] = Array.from(focusMap.entries())
    .map(([source, months]) => ({
      source,
      outlet: 'All Outlets',
      months,
    }))
    .slice(0, 10)

  const mORows = (Array.isArray(monthlyOutletRows) ? monthlyOutletRows : (monthlyOutletRows as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>
  const outletMonthArr: PlatinumConversionRow[] = Array.from({ length: 12 }, (_, i) => ({
    key: String(i + 1),
    label: String(i + 1),
    enquiries: 0,
    testDrives: 0,
    bookings: 0,
    retails: 0,
    e2td: 0,
    e2bkg: 0,
    e2ret: 0,
  }))

  for (const r of mORows) {
    const mo = toInt(r.mo)
    if (mo >= 1 && mo <= 12) {
      const enq = toInt(r.enquiries)
      const td = toInt(r.test_drives)
      const bkg = toInt(r.bookings)
      const ret = toInt(r.retails)
      outletMonthArr[mo - 1] = {
        key: String(mo),
        label: String(mo),
        enquiries: enq,
        testDrives: td,
        bookings: bkg,
        retails: ret,
        e2td: safePct(td, enq),
        e2bkg: safePct(bkg, enq),
        e2ret: safePct(ret, enq),
      }
    }
  }

  const outletMonths: PlatinumMonthlySourceRow[] = [
    {
      source: 'All Sources',
      outlet: 'All Outlets',
      months: outletMonthArr,
    },
  ]

  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return {
    year,
    month: month || null,
    monthLabel: month && month >= 1 && month <= 12 ? `${monthNames[month]} ${year}` : `Full Year ${year}`,
    outlets,
    focusSources,
    outletMonths,
    notes: [
      'Conversion rates: E2TD = Test Drives / Enquiries, E2BKG = Bookings / Enquiries, E2RET = Retails / Enquiries.',
      'Retails are matched from the sales confirmed feed attributed back to the customer enquiry channel.',
    ],
  }
}

export async function getPlatinumExchangePanel(year: number): Promise<PlatinumExchangePanel> {
  const cte = platinumEnquiryCohortCte(year)

  const [monthlyRows, makerRows] = await Promise.all([
    analyticsDb.execute(sql`
      WITH ${cte}
      SELECT
        mo,
        COUNT(*)::int AS enquiries,
        COUNT(*) FILTER (WHERE exch_interested)::int AS interested,
        COUNT(*) FILTER (WHERE exch_evaluated)::int AS evaluated,
        COUNT(*) FILTER (WHERE has_ret)::int AS retailed
      FROM cohort
      GROUP BY mo
      ORDER BY mo
    `),
    analyticsDb.execute(sql`
      WITH ${cte}
      SELECT
        maker_name,
        COUNT(*)::int AS evaluations,
        COUNT(*) FILTER (WHERE has_ret)::int AS retails
      FROM cohort
      WHERE exch_evaluated
      GROUP BY maker_name
      ORDER BY evaluations DESC
      LIMIT 10
    `),
  ])

  const mRows = (Array.isArray(monthlyRows) ? monthlyRows : (monthlyRows as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>
  const months: PlatinumExchangeMonthRow[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    enquiries: 0,
    interested: 0,
    evaluated: 0,
    retailed: 0,
    interestRatePct: 0,
    evalRatePct: 0,
    evalToRetPct: 0,
  }))

  for (const r of mRows) {
    const mo = toInt(r.mo)
    if (mo >= 1 && mo <= 12) {
      const enq = toInt(r.enquiries)
      const int = toInt(r.interested)
      const ev = toInt(r.evaluated)
      const ret = toInt(r.retailed)
      months[mo - 1] = {
        month: mo,
        enquiries: enq,
        interested: int,
        evaluated: ev,
        retailed: ret,
        interestRatePct: safePct(int, enq),
        evalRatePct: safePct(ev, int > 0 ? int : enq),
        evalToRetPct: safePct(ret, ev),
      }
    }
  }

  const mkRows = (Array.isArray(makerRows) ? makerRows : (makerRows as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>
  const totalEval = mkRows.reduce((s, r) => s + toInt(r.evaluations), 0)
  const topMakers: PlatinumExchangeMakerRow[] = mkRows.map((r) => {
    const ev = toInt(r.evaluations)
    const ret = toInt(r.retails)
    return {
      maker: String(r.maker_name || 'Other'),
      evaluations: ev,
      retails: ret,
      sharePct: safePct(ev, totalEval),
      conversionPct: safePct(ret, ev),
    }
  })

  return {
    year,
    months,
    topMakers,
    notes: [
      'Exchange interest captured from exchange_opted flag in am_platinum_enquiry_report.',
      'Evaluations identified from present vehicle records.',
    ],
  }
}
