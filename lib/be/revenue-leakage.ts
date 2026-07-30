import { sql, type SQL } from 'drizzle-orm'
import {
  hyundaiRoBillingDealerFilter,
  hyundaiRoBillingDealerSql,
} from '@/lib/hyundai/business-excellence-calculations'
import {
  platinumRoBillingDealerFilter,
  platinumRoBillingDealerSql,
} from '@/lib/platinum/business-excellence-calculations'

/**
 * REVENUE LEAKAGE — the RO-billing anomalies that quietly cost the workshop money.
 *
 * Per BRANCH, on hyundai_ro_billing_report and am_platinum_ro_billing_report (identical 36-column
 * schema, so one builder serves both):
 *
 *   - ROs billed with ZERO labour, ZERO parts, or zero on both (nothing charged at all)
 *   - Discount on Running Repair and Accidental Repair, the two work types the owner named
 *   - Discount as a % of labour, which is where the money actually goes
 *   - free-service load, paid services with no labour charged, and round-off magnitude
 *
 * ⚠️ THREE TRAPS, all verified:
 *
 * 1. DEALER IS A BRANCH, NOT A CODE. The BE overview passes 'JAMMU' / 'KATHUA' / 'RS_PURA', not
 *    'N5216'. The first version of this file compared source_dealer_code = 'JAMMU' directly and
 *    returned ZERO ROWS for every branch — the panel rendered "No repair orders in this period".
 *    Grouping and filtering both go through the brand's canonical dealer SQL, which owns the
 *    code -> branch mapping (JAMMU = N5203, N5216, JK402 …). Never re-implement that mapping here.
 *
 * 2. `part_disc` and `labour_disc` are TEXT while total_amt / labour_amt / part_amt / dis_amt /
 *    total_disc are NUMERIC. Summing the text ones unguarded raises 42883.
 *
 * 3. `main_dealer_code` collapses every branch onto one code (N5216 on all 142,201 Hyundai rows) —
 *    it is the GROUP, not the outlet. It is only ever a last-resort fallback inside the canonical SQL.
 */

export type LeakageBrand = 'hyundai' | 'platinum' | 'kia'

export const LEAKAGE_TABLES: Record<LeakageBrand, string> = {
  hyundai: 'hyundai_ro_billing_report',
  platinum: 'am_platinum_ro_billing_report',
  kia: 'kia_ro_billing_report',
}

/** Branch expression + branch filter, from the brand's own canonical helpers. */
function brandDealer(brand: LeakageBrand, dealerCode: string | null) {
  if (brand === 'kia') {
    // KIA has no code -> branch map (its outlets ARE the codes: JK402 Jammu, JK501 Billawar), so the
    // raw code is the branch. main_dealer_code is only a fallback, never the primary.
    return {
      expr: sql`COALESCE(NULLIF(btrim(dealer_code), ''), NULLIF(btrim(main_dealer_code), ''))`,
      // Inlined rather than imported from the KIA BE contract: that module pulls in lib/analytics/db,
      // which is server-only, and would drag this whole file behind that boundary for no benefit.
      // KIA outlets are plain codes, so the filter is a direct match on either dealer column.
      filter: dealerCode
        ? sql`AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, ''), ''))) = ${dealerCode.toUpperCase()}`
        : sql``,
    }
  }
  return brand === 'platinum'
    ? { expr: platinumRoBillingDealerSql(), filter: platinumRoBillingDealerFilter(dealerCode) }
    : { expr: hyundaiRoBillingDealerSql(), filter: hyundaiRoBillingDealerFilter(dealerCode) }
}

/**
 * Cancelled bills are excluded where the feed records them. Only KIA carries bill_status; the other
 * two have no cancellation flag at all, so their figures are gross of any cancellation — stated in
 * the panel footnote rather than papered over.
 */
function activeBills(brand: LeakageBrand): SQL {
  return brand === 'kia'
    ? sql`AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
    : sql``
}

/** Tolerates NUMERIC and TEXT money columns alike, and never throws on junk. */
function money(column: string): SQL {
  return sql`COALESCE(NULLIF(regexp_replace(${sql.raw(column)}::text, '[^0-9.\\-]', '', 'g'), '')::numeric, 0)`
}

/** work_type literals exactly as they appear in the feed. */
export const LEAKAGE_WORK_TYPES = {
  runningRepair: 'Running Repair',
  accidental: 'Accidental Repair',
  paidService: 'Paid Service',
  freeService: 'Free Service',
} as const

export type LeakageRow = {
  dealer: string
  ros: number
  totalAmt: number
  labourAmt: number
  partAmt: number
  zeroLabour: number
  zeroParts: number
  zeroBoth: number
  zeroTotal: number
  negativeTotal: number
  totalDisc: number
  labourDisc: number
  partDisc: number
  discRunningRepair: number
  discAccidental: number
  discPaidService: number
  discVsLabourPct: number
  discVsTotalPct: number
  zeroBothPct: number
  freeServiceRos: number
  paidServiceZeroLabour: number
  roundOffAbs: number
}

export function buildLeakageQuery(
  brand: LeakageBrand,
  opts: { dealerCode: string | null; startDate: string; endDate: string },
): SQL {
  const table = sql.raw(LEAKAGE_TABLES[brand])
  const { expr, filter } = brandDealer(brand, opts.dealerCode)
  const wt = (v: string) => sql`btrim(work_type) = ${v}`

  const labour = money('labour_amt')
  const part = money('part_amt')
  const total = money('total_amt')
  const totalDisc = money('total_disc')

  return sql`
    SELECT
      COALESCE(${expr}, 'UNMAPPED') AS dealer,
      COUNT(*)::int AS ros,
      SUM(${total})::numeric AS total_amt,
      SUM(${labour})::numeric AS labour_amt,
      SUM(${part})::numeric AS part_amt,

      COUNT(*) FILTER (WHERE ${labour} = 0)::int AS zero_labour,
      COUNT(*) FILTER (WHERE ${part} = 0)::int AS zero_parts,
      COUNT(*) FILTER (WHERE ${labour} = 0 AND ${part} = 0)::int AS zero_both,
      COUNT(*) FILTER (WHERE ${total} = 0)::int AS zero_total,
      COUNT(*) FILTER (WHERE ${total} < 0)::int AS negative_total,

      SUM(${totalDisc})::numeric AS total_disc,
      SUM(${money('labour_disc')})::numeric AS labour_disc,
      SUM(${money('part_disc')})::numeric AS part_disc,

      SUM(${totalDisc}) FILTER (WHERE ${wt(LEAKAGE_WORK_TYPES.runningRepair)})::numeric AS disc_running_repair,
      SUM(${totalDisc}) FILTER (WHERE ${wt(LEAKAGE_WORK_TYPES.accidental)})::numeric AS disc_accidental,
      SUM(${totalDisc}) FILTER (WHERE ${wt(LEAKAGE_WORK_TYPES.paidService)})::numeric AS disc_paid_service,

      COUNT(*) FILTER (WHERE ${wt(LEAKAGE_WORK_TYPES.freeService)})::int AS free_service_ros,
      COUNT(*) FILTER (WHERE ${wt(LEAKAGE_WORK_TYPES.paidService)} AND ${labour} = 0)::int AS paid_service_zero_labour,
      SUM(ABS(${money('round_off')}))::numeric AS round_off_abs
    FROM ${table}
    WHERE bill_date >= ${opts.startDate}::date
      AND bill_date < (${opts.endDate}::date + INTERVAL '1 day')
      ${activeBills(brand)}
      ${filter}
    GROUP BY 1
    ORDER BY SUM(${total}) DESC
  `
}

/** Month-on-month direction, so a worsening trend is visible and not just a level. */
export function buildLeakageTrendQuery(
  brand: LeakageBrand,
  opts: { dealerCode: string | null; startDate: string; endDate: string },
): SQL {
  const table = sql.raw(LEAKAGE_TABLES[brand])
  const { expr, filter } = brandDealer(brand, opts.dealerCode)
  return sql`
    SELECT
      to_char(bill_date, 'YYYY-MM') AS month_key,
      COALESCE(${expr}, 'UNMAPPED') AS dealer,
      COUNT(*)::int AS ros,
      SUM(${money('total_amt')})::numeric AS total_amt,
      SUM(${money('labour_amt')})::numeric AS labour_amt,
      SUM(${money('total_disc')})::numeric AS total_disc,
      SUM(${money('labour_disc')})::numeric AS labour_disc,
      COUNT(*) FILTER (WHERE ${money('labour_amt')} = 0 AND ${money('part_amt')} = 0)::int AS zero_both
    FROM ${table}
    WHERE bill_date >= ${opts.startDate}::date
      AND bill_date < (${opts.endDate}::date + INTERVAL '1 day')
      AND bill_date IS NOT NULL
      ${activeBills(brand)}
      ${filter}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)

export function mapLeakageRows(rows: Record<string, unknown>[]): LeakageRow[] {
  return rows.map((r) => {
    const labourAmt = n(r.labour_amt)
    const totalAmt = n(r.total_amt)
    const labourDisc = n(r.labour_disc)
    const totalDisc = n(r.total_disc)
    const ros = n(r.ros)
    return {
      dealer: String(r.dealer || 'UNMAPPED'),
      ros,
      totalAmt,
      labourAmt,
      partAmt: n(r.part_amt),
      zeroLabour: n(r.zero_labour),
      zeroParts: n(r.zero_parts),
      zeroBoth: n(r.zero_both),
      zeroTotal: n(r.zero_total),
      negativeTotal: n(r.negative_total),
      totalDisc,
      labourDisc,
      partDisc: n(r.part_disc),
      discRunningRepair: n(r.disc_running_repair),
      discAccidental: n(r.disc_accidental),
      discPaidService: n(r.disc_paid_service),
      discVsLabourPct: pct(labourDisc, labourAmt),
      discVsTotalPct: pct(totalDisc, totalAmt),
      zeroBothPct: pct(n(r.zero_both), ros),
      freeServiceRos: n(r.free_service_ros),
      paidServiceZeroLabour: n(r.paid_service_zero_labour),
      roundOffAbs: n(r.round_off_abs),
    }
  })
}
