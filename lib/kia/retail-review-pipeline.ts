import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { canonicalKiaModel, KIA_RETAIL_OUTLETS } from '@/lib/kia/retail-review'
import { enquiryCohortCte } from '@/lib/kia/retail-review-panels'

/**
 * KIA Retail Review — the Bookings and Enquiries panels (additions beyond the MD's original
 * 10-slide deck, requested for the same review).
 *
 * Shared rules with the other retail-review modules — repeated because getting any wrong yields a
 * plausible number rather than an error:
 *
 * ⚠️ OUTLET = `dealer_code_2` first (feed changed shape 2026-07-22; `dealer_code` is the parent).
 * ⚠️ Every KIA feed is a CUMULATIVE SNAPSHOT. Bookings dedupe on (customer_id, booking_no) taking
 *    the latest upload (measured: 1,351 raw rows → 588 real 2026 bookings). The latest row carries
 *    the booking's CURRENT status: Booking → Assignment/Invoice → Retail, or a Cancel state.
 */

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? result as Record<string, unknown>[] : []
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function pct(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : 0
}

function jsonArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }
  return []
}

/* ------------------------------------------------------------------------------------ *
 * Bookings — monthly intake, cancellations, and the open-order backlog
 * ------------------------------------------------------------------------------------ */

function bookingLatestCte() {
  return sql`
  latest AS MATERIALIZED (
    SELECT DISTINCT ON (UPPER(BTRIM(COALESCE(b.customer_id, ''))), UPPER(BTRIM(COALESCE(b.booking_no, ''))))
      b.booking_date,
      UPPER(BTRIM(COALESCE(
        NULLIF(BTRIM(b.dealer_code_2), ''), NULLIF(BTRIM(b.dealer_code), ''), ''
      ))) AS outlet,
      UPPER(BTRIM(COALESCE(b.status, ''))) AS status,
      COALESCE(b.amount_received, 0)::float AS amount_received,
      b.committed_delivery_date,
      UPPER(BTRIM(COALESCE(b.model, ''))) AS model
    FROM kia_booking_report b
    WHERE COALESCE(b.booking_no, '') <> ''
    ORDER BY UPPER(BTRIM(COALESCE(b.customer_id, ''))), UPPER(BTRIM(COALESCE(b.booking_no, ''))), b.uploaded_at DESC NULLS LAST
  )`
}

export type KiaBookingMonthRow = {
  month: number
  booked: number
  cancelled: number
  retailed: number
  /** booked − cancelled − retailed: still open from that month's intake. */
  open: number
}

export type KiaBookingAging = { d0_30: number; d31_60: number; d61_90: number; d90_plus: number }

export type KiaBookingBacklogRow = {
  outlet: string
  label: string
  open: number
  /** Customer money sitting on open bookings — the number the MD asks about first. */
  amountReceived: number
  /** Open bookings whose committed delivery date has already passed. */
  overdue: number
  aging: KiaBookingAging
}

export type KiaBookingsPanel = {
  year: number
  byOutlet: { outlet: string; label: string; months: KiaBookingMonthRow[]; booked: number; cancelled: number; cancelRate: number }[]
  combined: { months: KiaBookingMonthRow[]; booked: number; cancelled: number; cancelRate: number }
  backlog: {
    outlets: KiaBookingBacklogRow[]
    total: Omit<KiaBookingBacklogRow, 'outlet' | 'label'>
    topModels: { model: string; count: number }[]
  }
  notes: string[]
}

export async function getKiaBookingsPanel(year: number): Promise<KiaBookingsPanel> {
  const [monthlyResult, backlogResult] = await Promise.all([
    db.execute(sql`
      WITH ${bookingLatestCte()}
      SELECT EXTRACT(MONTH FROM booking_date)::int AS mo, outlet,
        COUNT(*)::int AS booked,
        COUNT(*) FILTER (WHERE status LIKE '%CANCEL%')::int AS cancelled,
        COUNT(*) FILTER (WHERE status = 'RETAIL')::int AS retailed
      FROM latest
      WHERE booking_date IS NOT NULL AND EXTRACT(YEAR FROM booking_date) = ${year}
      GROUP BY 1, 2
    `),
    db.execute(sql`
      WITH ${bookingLatestCte()},
      open_orders AS (
        SELECT * FROM latest WHERE status NOT LIKE '%CANCEL%' AND status <> 'RETAIL'
      )
      SELECT
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'outlet', outlet, 'open', open_count, 'amountReceived', amount, 'overdue', overdue,
          'd0_30', d0_30, 'd31_60', d31_60, 'd61_90', d61_90, 'd90_plus', d90_plus
        )), '[]'::jsonb) FROM (
          SELECT outlet,
            COUNT(*)::int AS open_count,
            COALESCE(SUM(amount_received), 0)::float AS amount,
            COUNT(*) FILTER (WHERE committed_delivery_date IS NOT NULL AND committed_delivery_date < CURRENT_DATE)::int AS overdue,
            COUNT(*) FILTER (WHERE booking_date >= CURRENT_DATE - 30)::int AS d0_30,
            COUNT(*) FILTER (WHERE booking_date < CURRENT_DATE - 30 AND booking_date >= CURRENT_DATE - 60)::int AS d31_60,
            COUNT(*) FILTER (WHERE booking_date < CURRENT_DATE - 60 AND booking_date >= CURRENT_DATE - 90)::int AS d61_90,
            COUNT(*) FILTER (WHERE booking_date < CURRENT_DATE - 90 OR booking_date IS NULL)::int AS d90_plus
          FROM open_orders GROUP BY 1
        ) o) AS outlets,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('model', model, 'count', n) ORDER BY n DESC), '[]'::jsonb) FROM (
          SELECT model, COUNT(*)::int AS n FROM open_orders WHERE model <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        ) m) AS top_models
    `),
  ])

  const monthly = rows(monthlyResult).map((row) => ({
    mo: num(row.mo),
    outlet: String(row.outlet || '').toUpperCase(),
    booked: num(row.booked), cancelled: num(row.cancelled), retailed: num(row.retailed),
  }))

  const monthsFor = (filter: (row: typeof monthly[number]) => boolean): KiaBookingMonthRow[] =>
    Array.from({ length: 12 }, (_, index) => {
      const monthRows = monthly.filter((row) => row.mo === index + 1 && filter(row))
      const booked = monthRows.reduce((sum, row) => sum + row.booked, 0)
      const cancelled = monthRows.reduce((sum, row) => sum + row.cancelled, 0)
      const retailed = monthRows.reduce((sum, row) => sum + row.retailed, 0)
      return { month: index + 1, booked, cancelled, retailed, open: Math.max(0, booked - cancelled - retailed) }
    })

  const summarise = (months: KiaBookingMonthRow[]) => {
    const booked = months.reduce((sum, row) => sum + row.booked, 0)
    const cancelled = months.reduce((sum, row) => sum + row.cancelled, 0)
    return { booked, cancelled, cancelRate: pct(cancelled, booked) }
  }

  const byOutlet = KIA_RETAIL_OUTLETS.map((outlet) => {
    const months = monthsFor((row) => row.outlet === outlet.code)
    return { outlet: outlet.code, label: outlet.label, months, ...summarise(months) }
  })
  const combinedMonths = monthsFor(() => true)

  const backlogRow = rows(backlogResult)[0] || {}
  const backlogRaw = jsonArray(backlogRow.outlets)
  const backlogOutlets: KiaBookingBacklogRow[] = KIA_RETAIL_OUTLETS.map((outlet) => {
    const mine = backlogRaw.find((row) => String(row.outlet || '').toUpperCase() === outlet.code)
    return {
      outlet: outlet.code,
      label: outlet.label,
      open: num(mine?.open),
      amountReceived: num(mine?.amountReceived),
      overdue: num(mine?.overdue),
      aging: {
        d0_30: num(mine?.d0_30), d31_60: num(mine?.d31_60), d61_90: num(mine?.d61_90), d90_plus: num(mine?.d90_plus),
      },
    }
  })
  // Anything credited outside the two known outlet codes still belongs in the total — a silently
  // short total is the bug class this whole section exists to avoid.
  const backlogTotal = backlogRaw.reduce<Omit<KiaBookingBacklogRow, 'outlet' | 'label'>>(
    (acc, row) => ({
      open: acc.open + num(row.open),
      amountReceived: acc.amountReceived + num(row.amountReceived),
      overdue: acc.overdue + num(row.overdue),
      aging: {
        d0_30: acc.aging.d0_30 + num(row.d0_30),
        d31_60: acc.aging.d31_60 + num(row.d31_60),
        d61_90: acc.aging.d61_90 + num(row.d61_90),
        d90_plus: acc.aging.d90_plus + num(row.d90_plus),
      },
    }),
    { open: 0, amountReceived: 0, overdue: 0, aging: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 } },
  )

  return {
    year,
    byOutlet,
    combined: { months: combinedMonths, ...summarise(combinedMonths) },
    backlog: {
      outlets: backlogOutlets,
      total: backlogTotal,
      topModels: jsonArray(backlogRow.top_models).map((row) => ({ model: String(row.model || ''), count: num(row.count) })),
    },
    notes: [
      'One booking = one (customer, booking no) on its latest upload — the feed is a cumulative '
      + 'snapshot, so counting raw rows would roughly double every figure.',
      'Open = latest status is still Booking / Assignment / Invoice: neither retailed nor cancelled. '
      + 'Amount received is the customer money currently held on those open bookings.',
    ],
  }
}

/* ------------------------------------------------------------------------------------ *
 * Enquiries — model-wise demand funnel and lost-enquiry analysis
 * ------------------------------------------------------------------------------------ */

export type KiaModelFunnelRow = {
  model: string
  enquiries: number
  testDrives: number
  bookings: number
  retails: number
  e2td: number
  e2bkg: number
  e2ret: number
}

export type KiaEnquiryLostMonth = {
  month: number
  enquiries: number
  lost: number
  lostRatio: number
}

export type KiaEnquiryPanel = {
  year: number
  models: KiaModelFunnelRow[]
  modelTotal: KiaModelFunnelRow
  lostMonths: KiaEnquiryLostMonth[]
  lostReasons: { reason: string; count: number }[]
  notes: string[]
}

export async function getKiaEnquiryPanel(year: number): Promise<KiaEnquiryPanel> {
  const result = await db.execute(sql`
    WITH ${enquiryCohortCte(year)}
    SELECT
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'model', model, 'enq', enq, 'td', td, 'bkg', bkg, 'ret', ret
      )), '[]'::jsonb) FROM (
        SELECT c.model, COUNT(*)::int AS enq,
          COUNT(*) FILTER (WHERE c.has_td)::int AS td,
          COUNT(*) FILTER (WHERE c.has_booking)::int AS bkg,
          COUNT(*) FILTER (WHERE c.has_ret)::int AS ret
        FROM cohort c GROUP BY c.model
      ) m) AS models,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('mo', mo, 'enq', enq, 'lost', lost)), '[]'::jsonb) FROM (
        SELECT c.mo, COUNT(*)::int AS enq, COUNT(*) FILTER (WHERE c.has_lost)::int AS lost
        FROM cohort c GROUP BY c.mo
      ) l) AS lost_months,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', reason, 'n', n) ORDER BY n DESC), '[]'::jsonb) FROM (
        SELECT c.lost_reason AS reason, COUNT(*)::int AS n
        FROM cohort c WHERE c.has_lost AND c.lost_reason <> ''
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
      ) r) AS lost_reasons
  `)

  const row = rows(result)[0] || {}

  // The feed's model strings (SONET / NEW SELTOS / SELTOS / ...) fold into the deck's canonical
  // rows, so this table lines up with the retail panel's model-wise slide.
  const byModel = new Map<string, { enq: number; td: number; bkg: number; ret: number }>()
  for (const raw of jsonArray(row.models)) {
    const model = canonicalKiaModel(raw.model)
    const bucket = byModel.get(model) || { enq: 0, td: 0, bkg: 0, ret: 0 }
    bucket.enq += num(raw.enq); bucket.td += num(raw.td); bucket.bkg += num(raw.bkg); bucket.ret += num(raw.ret)
    byModel.set(model, bucket)
  }
  const toFunnelRow = (model: string, v: { enq: number; td: number; bkg: number; ret: number }): KiaModelFunnelRow => ({
    model,
    enquiries: v.enq, testDrives: v.td, bookings: v.bkg, retails: v.ret,
    e2td: pct(v.td, v.enq), e2bkg: pct(v.bkg, v.enq), e2ret: pct(v.ret, v.enq),
  })
  const models = [...byModel.entries()]
    .map(([model, v]) => toFunnelRow(model, v))
    .sort((a, b) => b.enquiries - a.enquiries)
  const total = [...byModel.values()].reduce(
    (acc, v) => ({ enq: acc.enq + v.enq, td: acc.td + v.td, bkg: acc.bkg + v.bkg, ret: acc.ret + v.ret }),
    { enq: 0, td: 0, bkg: 0, ret: 0 },
  )

  const lostRaw = jsonArray(row.lost_months)
  const lostMonths: KiaEnquiryLostMonth[] = Array.from({ length: 12 }, (_, index) => {
    const mine = lostRaw.find((r) => num(r.mo) === index + 1)
    const enquiries = num(mine?.enq)
    const lost = num(mine?.lost)
    return { month: index + 1, enquiries, lost, lostRatio: pct(lost, enquiries) }
  })

  return {
    year,
    models,
    modelTotal: toFunnelRow('All models', total),
    lostMonths,
    lostReasons: jsonArray(row.lost_reasons).map((r) => ({ reason: String(r.reason || ''), count: num(r.n) })),
    notes: [
      'Cohort basis, like the conversion tab: an enquiry counts in the month it was raised, with '
      + 'whatever it later became. Retail here is the enquiry\'s own outcome flag, so recent months '
      + 'legitimately lag while their enquiries are still working.',
      'Lost = the enquiry carries a lost date on its latest upload. "Closed without sale" is the '
      + 'DMS\'s own bulk-closure label rather than a stated customer reason.',
    ],
  }
}
