import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { KIA_RETAIL_OUTLETS } from '@/lib/kia/retail-review'

/**
 * KIA Retail Review — the Conversion, Exchange and Accessories panels (the MD's slides 5-10).
 *
 * Shared rules with lib/kia/retail-review.ts, repeated here because getting any of them wrong
 * produces a plausible number rather than an error:
 *
 * ⚠️ OUTLET = `dealer_code_2` first. The feed changed shape on 2026-07-22 — `dealer_code` became
 *    the parent code JK402 on every row. Reading it first credits every Udhampur record to Jammu.
 *
 * ⚠️ The enquiry feed is a CUMULATIVE SNAPSHOT: 88,319 rows for 8,110 customers. Dedupe on
 *    (customer_id, enquiry_no) taking the latest upload, or every figure inflates roughly 10x.
 *
 * ⚠️ SOURCE is the `source` column (Field / Hyperlocal / Referral / Walkin / Online-CRM /
 *    Telephone), NOT `enquiry_source`, which is a different taxonomy (MOB/ONLINE/DMS/MYKIA)
 *    and would produce a table that looks right and means nothing.
 *
 * COHORT BASIS, agreed with the owner: an enquiry raised in July is counted in July together with
 * whatever it later became. So E2TD/E2BKG/E2RET compare the same people, and recent months' RET
 * legitimately lags — a July enquiry may retail in September.
 */

const ENQUIRY_OUTLET = sql`UPPER(BTRIM(COALESCE(
  NULLIF(BTRIM(e.dealer_code_2), ''), NULLIF(BTRIM(e.dealer_code), ''), ''
)))`

/** One row per real enquiry, with outlet, source and funnel flags resolved. Shared with the
 *  bookings/enquiries panels in retail-review-pipeline.ts — change the rules in one place. */
export function enquiryCohortCte(year: number) {
  return sql`
  cohort AS MATERIALIZED (
    SELECT
      EXTRACT(MONTH FROM d.enquiry_date)::int AS mo,
      d.outlet,
      d.source,
      d.customer_id,
      d.model,
      d.has_td,
      d.has_booking,
      d.has_ret,
      d.has_lost,
      d.lost_reason,
      d.exch_interested,
      d.exch_evaluated
    FROM (
      SELECT DISTINCT ON (e.customer_id, e.enquiry_no)
        e.enquiry_date,
        ${ENQUIRY_OUTLET} AS outlet,
        COALESCE(NULLIF(BTRIM(e.source), ''), 'Unspecified') AS source,
        UPPER(BTRIM(COALESCE(e.customer_id, ''))) AS customer_id,
        UPPER(BTRIM(COALESCE(e.model, ''))) AS model,
        (e.test_drive_date IS NOT NULL) AS has_td,
        (COALESCE(BTRIM(e.booking_no), '') <> '') AS has_booking,
        -- Enquiry-spine retail flag: this enquiry row itself reached delivery. Used by the model
        -- funnel, where the question is "what did THIS enquiry become" — the retail PANEL stays on
        -- the sales-side VIN spine, which is the one that ties to the MD's deck.
        (e.delivery_date IS NOT NULL OR e.retail_date IS NOT NULL) AS has_ret,
        (e.lost_date IS NOT NULL) AS has_lost,
        COALESCE(NULLIF(BTRIM(e.lost_reason), ''), '') AS lost_reason,
        (UPPER(BTRIM(COALESCE(e.interested_in_exchange_y_n, ''))) = 'Y') AS exch_interested,
        (UPPER(BTRIM(COALESCE(e.old_car_evaluation_done, ''))) = 'Y') AS exch_evaluated
      FROM kia_enquiry_report e
      WHERE COALESCE(e.customer_id, '') <> ''
        AND e.enquiry_date IS NOT NULL
        AND EXTRACT(YEAR FROM e.enquiry_date) = ${year}
      ORDER BY e.customer_id, e.enquiry_no, e.uploaded_at DESC NULLS LAST
    ) d
  ),
  -- ⚠️ RET is computed from the SALES side, one row per retailed vehicle, NOT by flagging
  -- enquiries whose customer later bought.
  --
  -- The obvious approach - mark every enquiry from a customer who ever retailed - over-counts
  -- badly, because one buyer typically raises several enquiries: it produced 353 retails for
  -- Jammu against a true 263. Worse, the source columns would not sum to the retail total, so
  -- the table would silently disagree with the retail panel on the same page.
  --
  -- Starting from the vehicle guarantees each retail is attributed exactly once. The source
  -- comes from that customer's most recent enquiry at or before delivery.
  retailed AS MATERIALIZED (
    SELECT
      v.customer_id,
      EXTRACT(MONTH FROM v.delivery_date)::int AS mo,
      v.outlet,
      COALESCE(src.source, 'Unspecified') AS source
    FROM (
      SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number)))
        UPPER(BTRIM(COALESCE(s.customerid, ''))) AS customer_id,
        s.delivery_date,
        UPPER(BTRIM(COALESCE(NULLIF(BTRIM(s.dealer_code_2), ''), NULLIF(BTRIM(s.dealer_code), ''), ''))) AS outlet
      FROM kia_sales_report s
      WHERE COALESCE(s.vin_number, '') <> '' AND s.delivery_date IS NOT NULL
        AND EXTRACT(YEAR FROM s.delivery_date) = ${year}
      ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST
    ) v
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(BTRIM(e2.source), ''), 'Unspecified') AS source
      FROM kia_enquiry_report e2
      WHERE UPPER(BTRIM(COALESCE(e2.customer_id, ''))) = v.customer_id
        AND e2.enquiry_date IS NOT NULL
        AND e2.enquiry_date <= v.delivery_date
      ORDER BY e2.enquiry_date DESC, e2.uploaded_at DESC NULLS LAST
      LIMIT 1
    ) src ON TRUE
  )`
}

export type KiaConversionRow = {
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

export type KiaOutletConversion = {
  outlet: string
  label: string
  total: KiaConversionRow
  sources: KiaConversionRow[]
}

export type KiaMonthlySourceRow = {
  source: string
  outlet: string
  months: KiaConversionRow[]
}

export type KiaConversionPanel = {
  year: number
  outlets: KiaOutletConversion[]
  /** Slide 6 — Hyperlocal and Walk-in, month on month, per outlet. */
  focusSources: KiaMonthlySourceRow[]
  /** Slide 8 — outlet x month EBT. */
  outletMonths: KiaMonthlySourceRow[]
  notes: string[]
}

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

function toRow(key: string, label: string, enq: number, td: number, bkg: number, ret: number): KiaConversionRow {
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

const FOCUS_SOURCES = ['Hyperlocal', 'Walkin']

export async function getKiaConversionPanel(year: number): Promise<KiaConversionPanel> {
  const [result, bookingResult] = await Promise.all([
    db.execute(sql`
      WITH ${enquiryCohortCte(year)}
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
    // ⚠️ Real booking counts for the Outlet by Month table.
    // The enquiry-cohort `has_booking` flag counts enquiries that generated a booking number —
    // a different number from "how many bookings were made this month". The booking panel
    // (kia_booking_report) is the source of truth for the MD's booking intake figures.
    db.execute(sql`
      SELECT EXTRACT(MONTH FROM booking_date)::int AS mo,
        UPPER(BTRIM(COALESCE(NULLIF(BTRIM(dealer_code_2), ''), NULLIF(BTRIM(dealer_code), ''), ''))) AS outlet,
        COUNT(*)::int AS booked
      FROM (
        SELECT DISTINCT ON (UPPER(BTRIM(COALESCE(customer_id, ''))), UPPER(BTRIM(COALESCE(booking_no, ''))))
          booking_date,
          dealer_code_2,
          dealer_code
        FROM kia_booking_report
        WHERE COALESCE(booking_no, '') <> ''
          AND booking_date IS NOT NULL
          AND EXTRACT(YEAR FROM booking_date) = ${year}
        ORDER BY UPPER(BTRIM(COALESCE(customer_id, ''))), UPPER(BTRIM(COALESCE(booking_no, ''))), uploaded_at DESC NULLS LAST
      ) b
      GROUP BY 1, 2
    `),
  ])

  const raw = rows(result).map((row) => ({
    mo: num(row.mo),
    outlet: String(row.outlet || '').trim().toUpperCase(),
    source: String(row.source || 'Unspecified'),
    enq: num(row.enq), td: num(row.td), bkg: num(row.bkg), ret: num(row.ret),
  }))

  // Real booking counts keyed by [mo, outlet] for the Outlet by Month table.
  const realBookings = rows(bookingResult).map((row) => ({
    mo: num(row.mo),
    outlet: String(row.outlet || '').trim().toUpperCase(),
    booked: num(row.booked),
  }))

  const realBookingCount = (mo: number, outlet: string): number =>
    realBookings.filter((r) => r.mo === mo && r.outlet === outlet).reduce((sum, r) => sum + r.booked, 0)

  const outlets: KiaOutletConversion[] = KIA_RETAIL_OUTLETS.map((outlet) => {
    const mine = raw.filter((row) => row.outlet === outlet.code)
    const bySource = new Map<string, { enq: number; td: number; bkg: number; ret: number }>()
    let t = { enq: 0, td: 0, bkg: 0, ret: 0 }
    for (const row of mine) {
      const bucket = bySource.get(row.source) || { enq: 0, td: 0, bkg: 0, ret: 0 }
      bucket.enq += row.enq; bucket.td += row.td; bucket.bkg += row.bkg; bucket.ret += row.ret
      bySource.set(row.source, bucket)
      t = { enq: t.enq + row.enq, td: t.td + row.td, bkg: t.bkg + row.bkg, ret: t.ret + row.ret }
    }
    return {
      outlet: outlet.code,
      label: `${outlet.code} — AM Kia, ${outlet.label}`,
      total: toRow(outlet.code, `${outlet.code} — AM Kia, ${outlet.label}`, t.enq, t.td, t.bkg, t.ret),
      sources: [...bySource.entries()]
        .map(([source, v]) => toRow(`${outlet.code}:${source}`, source, v.enq, v.td, v.bkg, v.ret))
        .sort((a, b) => b.enquiries - a.enquiries),
    }
  })

  const monthlyFor = (predicate: (row: typeof raw[number]) => boolean, label: string, outlet: string) => {
    const months: KiaConversionRow[] = Array.from({ length: 12 }, (_, index) => {
      const monthRows = raw.filter((row) => row.mo === index + 1 && predicate(row))
      const t = monthRows.reduce((acc, row) => ({
        enq: acc.enq + row.enq, td: acc.td + row.td, bkg: acc.bkg + row.bkg, ret: acc.ret + row.ret,
      }), { enq: 0, td: 0, bkg: 0, ret: 0 })
      return toRow(`${outlet}:${label}:${index + 1}`, String(index + 1), t.enq, t.td, t.bkg, t.ret)
    })
    return { source: label, outlet, months }
  }

  const focusSources: KiaMonthlySourceRow[] = []
  for (const outlet of KIA_RETAIL_OUTLETS) {
    for (const source of FOCUS_SOURCES) {
      focusSources.push(monthlyFor(
        (row) => row.outlet === outlet.code && row.source.toUpperCase() === source.toUpperCase(),
        source,
        outlet.code,
      ))
    }
  }

  // Outlet by Month: enquiries and test drives stay cohort-based; bookings use the real
  // kia_booking_report intake so the numbers match the pipeline/bookings panel exactly.
  const outletMonths: KiaMonthlySourceRow[] = KIA_RETAIL_OUTLETS.map((outlet) => {
    const months: KiaConversionRow[] = Array.from({ length: 12 }, (_, index) => {
      const mo = index + 1
      const monthRows = raw.filter((row) => row.mo === mo && row.outlet === outlet.code)
      const enq = monthRows.reduce((sum, row) => sum + row.enq, 0)
      const td = monthRows.reduce((sum, row) => sum + row.td, 0)
      const bkg = realBookingCount(mo, outlet.code)
      const ret = monthRows.reduce((sum, row) => sum + row.ret, 0)
      return toRow(`${outlet.code}:All sources:${mo}`, String(mo), enq, td, bkg, ret)
    })
    return { source: 'All sources', outlet: outlet.code, months }
  })

  return {
    year,
    outlets,
    focusSources,
    outletMonths,
    notes: [
      'Cohort basis: an enquiry is counted in the month it was raised, together with whatever it later '
      + 'became. Recent months therefore show a lower retail conversion — those enquiries have not had '
      + 'time to close yet.',
      'Bookings (Outlet by Month) use the actual booking intake from the booking register, matching '
      + 'the pipeline panel. E2BKG% in the source table uses the enquiry-cohort booking flag.',
      'Retail is attributed to a source through the DMS customer id, which links enquiry to sale on '
      + '99.9% of records.',
    ],
  }
}

/* ------------------------------------------------------------------------------------ *
 * Slide 9 — Exchange
 * ------------------------------------------------------------------------------------ */

export type KiaExchangeMonth = {
  month: number
  totalEnquiries: number
  exchangeEnquiries: number
  exchangeEnquiryRatio: number
  evaluations: number
  evaluationRatio: number
  exchangeNet: number
  retailNet: number
  exchangePenetration: number
}

export type KiaExchangePanel = {
  year: number
  months: KiaExchangeMonth[]
  byOutlet: { outlet: string; label: string; months: KiaExchangeMonth[] }[]
  notes: string[]
}

export async function getKiaExchangePanel(year: number): Promise<KiaExchangePanel> {
  // ⚠️ `exchange_done` and `exchange_channel` are 100% NULL on every KIA feed, so a completed
  // exchange cannot be read directly. Owner decision: Exch Net = retails whose enquiry had the
  // old car EVALUATED. That is the tighter of the two available signals — evaluation is only ever
  // recorded on customers already flagged interested.
  const result = await db.execute(sql`
    WITH ${enquiryCohortCte(year)}
    SELECT mo, outlet, SUM(enq)::int AS enq, SUM(exch_enq)::int AS exch_enq,
           SUM(evaluated)::int AS evaluated, SUM(exch_net)::int AS exch_net, SUM(retail_net)::int AS retail_net
    FROM (
      SELECT c.mo, c.outlet, COUNT(*)::int AS enq,
        COUNT(*) FILTER (WHERE c.exch_interested)::int AS exch_enq,
        COUNT(*) FILTER (WHERE c.exch_evaluated)::int AS evaluated,
        0 AS exch_net, 0 AS retail_net
      FROM cohort c GROUP BY c.mo, c.outlet
      UNION ALL
      -- Retail Net and Exchange Net are per RETAILED VEHICLE, so they tie to the retail panel.
      SELECT r.mo, r.outlet, 0, 0, 0,
        COUNT(*) FILTER (WHERE ev.evaluated)::int,
        COUNT(*)::int
      FROM retailed r
      LEFT JOIN LATERAL (
        SELECT BOOL_OR(UPPER(BTRIM(COALESCE(e3.old_car_evaluation_done, ''))) = 'Y') AS evaluated
        FROM kia_enquiry_report e3
        WHERE UPPER(BTRIM(COALESCE(e3.customer_id, ''))) = r.customer_id
      ) ev ON TRUE
      GROUP BY r.mo, r.outlet
    ) u GROUP BY mo, outlet
  `)

  const raw = rows(result).map((row) => ({
    mo: num(row.mo),
    outlet: String(row.outlet || '').trim().toUpperCase(),
    enq: num(row.enq), exchEnq: num(row.exch_enq), evaluated: num(row.evaluated),
    exchNet: num(row.exch_net), retailNet: num(row.retail_net),
  }))

  const build = (filter: (row: typeof raw[number]) => boolean): KiaExchangeMonth[] =>
    Array.from({ length: 12 }, (_, index) => {
      const monthRows = raw.filter((row) => row.mo === index + 1 && filter(row))
      const t = monthRows.reduce((acc, row) => ({
        enq: acc.enq + row.enq, exchEnq: acc.exchEnq + row.exchEnq, evaluated: acc.evaluated + row.evaluated,
        exchNet: acc.exchNet + row.exchNet, retailNet: acc.retailNet + row.retailNet,
      }), { enq: 0, exchEnq: 0, evaluated: 0, exchNet: 0, retailNet: 0 })
      return {
        month: index + 1,
        totalEnquiries: t.enq,
        exchangeEnquiries: t.exchEnq,
        exchangeEnquiryRatio: pct(t.exchEnq, t.enq),
        evaluations: t.evaluated,
        evaluationRatio: pct(t.evaluated, t.exchEnq),
        exchangeNet: t.exchNet,
        retailNet: t.retailNet,
        exchangePenetration: pct(t.exchNet, t.retailNet),
      }
    })

  return {
    year,
    months: build(() => true),
    byOutlet: KIA_RETAIL_OUTLETS.map((outlet) => ({
      outlet: outlet.code,
      label: outlet.label,
      months: build((row) => row.outlet === outlet.code),
    })),
    notes: [
      'Exchange Net counts retails whose enquiry had the old car evaluated. The feed\'s '
      + '"exchange done" flag is empty on every row, so a completed exchange cannot be read directly '
      + '— evaluation is the closest reliable signal.',
    ],
  }
}

/* ------------------------------------------------------------------------------------ *
 * Slide 10 — Accessories
 * ------------------------------------------------------------------------------------ */

export type KiaAccessoryMonth = {
  month: number
  retailMrp: number
  retailNdp: number
  vehicleRetail: number
  perCarMrp: number
  perCarNdp: number
}

export type KiaAccessoriesPanel = {
  year: number
  months: KiaAccessoryMonth[]
  byDealer: { outlet: string; label: string; retailMrp: number; retailNdp: number; vehicleRetail: number; perCarMrp: number; perCarNdp: number }[]
  total: KiaAccessoryMonth
  /** Top accessory lines by NDP value — what is actually selling over the counter. */
  topItems: { item: string; qty: number; mrp: number; ndp: number }[]
  /** Fields the MD's slide carries that we hold no source for. Rendered, never inferred. */
  unavailableFields: string[]
  notes: string[]
}

export async function getKiaAccessoriesPanel(year: number): Promise<KiaAccessoriesPanel> {
  const [accResult, vehResult, itemResult] = await Promise.all([
    db.execute(sql`
      SELECT
        EXTRACT(MONTH FROM a.csr_date)::int AS mo,
        UPPER(BTRIM(COALESCE(NULLIF(BTRIM(a.dealer_code_2), ''), NULLIF(BTRIM(a.dealer_code), ''), ''))) AS outlet,
        COALESCE(SUM(a.accessories_mrp_price), 0)::float AS mrp,
        COALESCE(SUM(a.accessories_list_price_unit), 0)::float AS ndp
      FROM kia_accessories_counter_sales_report a
      WHERE a.csr_date IS NOT NULL AND EXTRACT(YEAR FROM a.csr_date) = ${year}
      GROUP BY 1, 2
    `),
    db.execute(sql`
      SELECT EXTRACT(MONTH FROM d.delivery_date)::int AS mo, d.outlet, COUNT(*)::int AS n
      FROM (
        SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number)))
          s.delivery_date,
          UPPER(BTRIM(COALESCE(NULLIF(BTRIM(s.dealer_code_2), ''), NULLIF(BTRIM(s.dealer_code), ''), ''))) AS outlet
        FROM kia_sales_report s
        WHERE COALESCE(s.vin_number, '') <> '' AND s.delivery_date IS NOT NULL
          AND EXTRACT(YEAR FROM s.delivery_date) = ${year}
        ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST
      ) d
      GROUP BY 1, 2
    `),
    db.execute(sql`
      SELECT
        COALESCE(NULLIF(BTRIM(a.accessories_description), ''), '(unspecified)') AS item,
        COALESCE(SUM(a.accessories_qty), 0)::int AS qty,
        COALESCE(SUM(a.accessories_mrp_price), 0)::float AS mrp,
        COALESCE(SUM(a.accessories_list_price_unit), 0)::float AS ndp
      FROM kia_accessories_counter_sales_report a
      WHERE a.csr_date IS NOT NULL AND EXTRACT(YEAR FROM a.csr_date) = ${year}
      GROUP BY 1
      ORDER BY 4 DESC
      LIMIT 12
    `),
  ])

  const acc = rows(accResult).map((row) => ({ mo: num(row.mo), outlet: String(row.outlet || '').toUpperCase(), mrp: num(row.mrp), ndp: num(row.ndp) }))
  const veh = rows(vehResult).map((row) => ({ mo: num(row.mo), outlet: String(row.outlet || '').toUpperCase(), n: num(row.n) }))

  const months: KiaAccessoryMonth[] = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const mrp = acc.filter((row) => row.mo === month).reduce((sum, row) => sum + row.mrp, 0)
    const ndp = acc.filter((row) => row.mo === month).reduce((sum, row) => sum + row.ndp, 0)
    const vehicles = veh.filter((row) => row.mo === month).reduce((sum, row) => sum + row.n, 0)
    return {
      month,
      retailMrp: mrp,
      retailNdp: ndp,
      vehicleRetail: vehicles,
      perCarMrp: vehicles > 0 ? mrp / vehicles : 0,
      perCarNdp: vehicles > 0 ? ndp / vehicles : 0,
    }
  })

  const totalMrp = months.reduce((sum, row) => sum + row.retailMrp, 0)
  const totalNdp = months.reduce((sum, row) => sum + row.retailNdp, 0)
  const totalVehicles = months.reduce((sum, row) => sum + row.vehicleRetail, 0)

  return {
    year,
    months,
    byDealer: KIA_RETAIL_OUTLETS.map((outlet) => {
      const mrp = acc.filter((row) => row.outlet === outlet.code).reduce((sum, row) => sum + row.mrp, 0)
      const ndp = acc.filter((row) => row.outlet === outlet.code).reduce((sum, row) => sum + row.ndp, 0)
      const vehicles = veh.filter((row) => row.outlet === outlet.code).reduce((sum, row) => sum + row.n, 0)
      return {
        outlet: outlet.code,
        label: outlet.label,
        retailMrp: mrp,
        retailNdp: ndp,
        vehicleRetail: vehicles,
        perCarMrp: vehicles > 0 ? mrp / vehicles : 0,
        perCarNdp: vehicles > 0 ? ndp / vehicles : 0,
      }
    }),
    total: {
      month: 0,
      retailMrp: totalMrp,
      retailNdp: totalNdp,
      vehicleRetail: totalVehicles,
      perCarMrp: totalVehicles > 0 ? totalMrp / totalVehicles : 0,
      perCarNdp: totalVehicles > 0 ? totalNdp / totalVehicles : 0,
    },
    topItems: rows(itemResult).map((row) => ({
      item: String(row.item || ''), qty: num(row.qty), mrp: num(row.mrp), ndp: num(row.ndp),
    })),
    // ⚠️ Never infer these. The MD's slide carries them, but no table in this database holds an
    // accessory wholesale figure or a stock valuation.
    unavailableFields: ['Accy Wholesale', 'Accy Stock'],
    notes: [
      'Accessory Wholesale and Accessory Stock are not held in this system, so those two rows of the '
      + 'MD\'s slide are shown as unavailable rather than estimated.',
      'NDP is taken from the accessory list price per unit; MRP from the accessory MRP price.',
    ],
  }
}
