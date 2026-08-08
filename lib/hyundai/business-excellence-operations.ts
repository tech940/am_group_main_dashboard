import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import {
  HYUNDAI_BRANCH_DEALERS,
  HYUNDAI_CONSOLIDATED_BRANCH,
  HYUNDAI_CONSOLIDATED_DEALER_CODE,
  normalizeHyundaiDealerCode,
} from '@/lib/hyundai/dealer-branch'
import {
  HYUNDAI_VAS_IDENTIFIER_VERSION,
  hyundaiVasCodeSql,
  hyundaiWheelAlignmentCodeSql,
  hyundaiWheelBalancingCodeSql,
} from '@/lib/hyundai/vas-identifiers'

type Row = Record<string, unknown>

export type HyundaiMonthlyOperationMetrics = {
  available: boolean
  periodStart: string | null
  periodEnd: string | null
  vasAmount: number
  vasRows: number
  waCount: number
  waAmount: number
  wbCount: number
  wbAmount: number
  sourceRows: number
  classifiedRows: number
  unknownCodeRows: number
  unknownCodes: string[]
  identifierVersion: string
  /**
   * Set when the figures could not be produced the intended way — e.g. the consolidated
   * N5216 file is missing for the period, so the group total falls back to the sum of the
   * branches that did upload. Never render these numbers as verified without surfacing it.
   */
  coverageWarning: string | null
}

/** Per raw dealer code, from a single chosen upload. */
type DealerTotals = {
  vasAmount: number
  vasRows: number
  waCount: number
  waAmount: number
  wbCount: number
  wbAmount: number
  sourceRows: number
  classifiedRows: number
  unknownCodeRows: number
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : []
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function dateValue(value: unknown) {
  return value ? String(value).slice(0, 10) : null
}

function getMonthRange(dateInput: string) {
  const anchor = new Date(`${dateInput}T00:00:00Z`)
  const monthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
  const nextMonthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1))

  return {
    monthStart: monthStart.toISOString().slice(0, 10),
    nextMonthStart: nextMonthStart.toISOString().slice(0, 10),
  }
}

const emptyTotals = (): DealerTotals => ({
  vasAmount: 0,
  vasRows: 0,
  waCount: 0,
  waAmount: 0,
  wbCount: 0,
  wbAmount: 0,
  sourceRows: 0,
  classifiedRows: 0,
  unknownCodeRows: 0,
})

function addTotals(a: DealerTotals, b: DealerTotals): DealerTotals {
  return {
    vasAmount: a.vasAmount + b.vasAmount,
    vasRows: a.vasRows + b.vasRows,
    waCount: a.waCount + b.waCount,
    waAmount: a.waAmount + b.waAmount,
    wbCount: a.wbCount + b.wbCount,
    wbAmount: a.wbAmount + b.wbAmount,
    sourceRows: a.sourceRows + b.sourceRows,
    classifiedRows: a.classifiedRows + b.classifiedRows,
    unknownCodeRows: a.unknownCodeRows + b.unknownCodeRows,
  }
}

/**
 * Consolidated minus the branches it contains, floored at zero.
 *
 * Only money and quantity are subtracted. The *Rows fields count distinct code rows in the
 * file and are not subtractive -- the consolidated file lists a code once no matter how many
 * branches billed it, so 65 VAS code rows minus the branches' 100 would read as "0 codes"
 * for a branch that clearly billed VAS. Those diagnostics carry the consolidated file's
 * values, which is what they describe: the shape of the snapshot the figure came from.
 */
function subtractTotals(whole: DealerTotals, part: DealerTotals): DealerTotals {
  const clamp = (value: number) => (value > 0 ? value : 0)
  return {
    vasAmount: clamp(whole.vasAmount - part.vasAmount),
    waCount: clamp(whole.waCount - part.waCount),
    waAmount: clamp(whole.waAmount - part.waAmount),
    wbCount: clamp(whole.wbCount - part.wbCount),
    wbAmount: clamp(whole.wbAmount - part.wbAmount),
    vasRows: whole.vasRows,
    sourceRows: whole.sourceRows,
    classifiedRows: whole.classifiedRows,
    unknownCodeRows: whole.unknownCodeRows,
  }
}

export async function fetchHyundaiMonthlyOperationMetrics(
  endDate: string,
  dealerCode: string | null = null,
): Promise<HyundaiMonthlyOperationMetrics> {
  const empty = (coverageWarning: string | null = null): HyundaiMonthlyOperationMetrics => ({
    available: false,
    periodStart: null,
    periodEnd: null,
    ...emptyTotals(),
    unknownCodes: [],
    identifierVersion: HYUNDAI_VAS_IDENTIFIER_VERSION,
    coverageWarning,
  })

  if (!(await db.tableExists('hyundai_operation_wise_analysis_report'))) return empty()

  const { monthStart, nextMonthStart } = getMonthRange(endDate)
  const dealerKey = sql.raw("UPPER(TRIM(COALESCE(source.source_dealer_code, source.dealer_code, '')))")

  let result: unknown
  try {
    result = await db.execute(sql`
    WITH candidate_period AS (
      SELECT report_period_start::date AS period_start, report_period_end::date AS period_end
      FROM hyundai_operation_wise_analysis_report
      WHERE report_period_start >= ${monthStart}::date
        AND report_period_start < ${nextMonthStart}::date
        AND report_type = 'Operation'
      GROUP BY report_period_start::date, report_period_end::date
      ORDER BY
        (COUNT(*) > 100) DESC,
        report_period_end::date DESC,
        report_period_start::date DESC
      LIMIT 1
    ),
    -- The same (dealer, period, report_type) is uploaded more than once: a truncated early
    -- fetch and then the complete file. Both sets of rows are kept, and deduping on row_hash
    -- cannot remove either -- the hash is computed by our own trigger over the measure
    -- columns, so cumulative snapshots of one code necessarily hash differently and every
    -- row is unique. Summing every upload inflated July VAS to Rs40,17,728 against a true
    -- Rs16,99,979.
    --
    -- Pick the LARGEST upload, not the newest: a truncated re-fetch can land after the
    -- complete file (May 2026 N6848: latest upload had 5 rows against 33 available).
    upload_stats AS (
      SELECT
        ${dealerKey} AS dealer,
        source.uploaded_at AS uploaded_at,
        COUNT(*) AS row_count
      FROM hyundai_operation_wise_analysis_report source
      JOIN candidate_period period
        ON source.report_period_start::date = period.period_start
       AND source.report_period_end::date = period.period_end
      WHERE source.report_type = 'Operation'
      GROUP BY 1, 2
    ),
    picked_upload AS (
      SELECT DISTINCT ON (dealer) dealer, uploaded_at
      FROM upload_stats
      ORDER BY dealer, row_count DESC, uploaded_at DESC NULLS LAST
    ),
    latest AS (
      SELECT
        ${dealerKey} AS dealer,
        UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS code,
        COALESCE(source.total_amt, 0)::numeric AS amount,
        COALESCE(source.total_count, 0)::numeric AS quantity
      FROM hyundai_operation_wise_analysis_report source
      JOIN candidate_period period
        ON source.report_period_start::date = period.period_start
       AND source.report_period_end::date = period.period_end
      JOIN picked_upload picked
        ON picked.dealer = ${dealerKey}
       AND picked.uploaded_at = source.uploaded_at
      -- VAS, wheel alignment and wheel balancing are all operation codes; 'Part' rows carry
      -- none of them and only pollute the unknown-code diagnostics.
      WHERE source.report_type = 'Operation'
    )
    SELECT
      latest.dealer AS dealer,
      (SELECT MIN(period_start)::text FROM candidate_period) AS period_start,
      (SELECT MAX(period_end)::text FROM candidate_period) AS period_end,
      COUNT(*)::int AS source_rows,
      COUNT(*) FILTER (WHERE ${hyundaiVasCodeSql(sql.raw('latest.code'))})::int AS vas_rows,
      COALESCE(SUM(amount) FILTER (WHERE ${hyundaiVasCodeSql(sql.raw('latest.code'))}), 0)::float AS vas_amount,
      COALESCE(SUM(quantity) FILTER (WHERE ${hyundaiWheelAlignmentCodeSql(sql.raw('latest.code'))}), 0)::float AS wa_count,
      COALESCE(SUM(amount) FILTER (WHERE ${hyundaiWheelAlignmentCodeSql(sql.raw('latest.code'))}), 0)::float AS wa_amount,
      COALESCE(SUM(quantity) FILTER (WHERE ${hyundaiWheelBalancingCodeSql(sql.raw('latest.code'))}), 0)::float AS wb_count,
      COALESCE(SUM(amount) FILTER (WHERE ${hyundaiWheelBalancingCodeSql(sql.raw('latest.code'))}), 0)::float AS wb_amount,
      COUNT(*) FILTER (
        WHERE ${hyundaiVasCodeSql(sql.raw('latest.code'))}
          OR ${hyundaiWheelAlignmentCodeSql(sql.raw('latest.code'))}
          OR ${hyundaiWheelBalancingCodeSql(sql.raw('latest.code'))}
      )::int AS classified_rows,
      COUNT(*) FILTER (
        WHERE latest.code <> ''
          AND NOT (${hyundaiVasCodeSql(sql.raw('latest.code'))})
          AND NOT (${hyundaiWheelAlignmentCodeSql(sql.raw('latest.code'))})
          AND NOT (${hyundaiWheelBalancingCodeSql(sql.raw('latest.code'))})
      )::int AS unknown_code_rows,
      ARRAY(
        SELECT DISTINCT unknown.code
        FROM latest unknown
        WHERE unknown.dealer = latest.dealer
          AND unknown.code <> ''
          AND NOT (${hyundaiVasCodeSql(sql.raw('unknown.code'))})
          AND NOT (${hyundaiWheelAlignmentCodeSql(sql.raw('unknown.code'))})
          AND NOT (${hyundaiWheelBalancingCodeSql(sql.raw('unknown.code'))})
        ORDER BY unknown.code
        LIMIT 25
      ) AS unknown_codes
    FROM latest
    GROUP BY latest.dealer
    `)
  } catch (error) {
    const code = String((error as { cause?: { code?: unknown }; code?: unknown })?.cause?.code
      || (error as { code?: unknown })?.code
      || '')
    if (code === '42703' || code === '42P01') return empty()
    throw error
  }

  const resultRows = rows(result)
  if (!resultRows.length) return empty()

  const periodStart = dateValue(resultRows[0]?.period_start)
  const periodEnd = dateValue(resultRows[0]?.period_end)

  const byDealer = new Map<string, DealerTotals>()
  const unknownByDealer = new Map<string, string[]>()
  for (const row of resultRows) {
    const dealer = String(row.dealer || '').trim().toUpperCase()
    byDealer.set(dealer, {
      vasAmount: numberValue(row.vas_amount),
      vasRows: numberValue(row.vas_rows),
      waCount: numberValue(row.wa_count),
      waAmount: numberValue(row.wa_amount),
      wbCount: numberValue(row.wb_count),
      wbAmount: numberValue(row.wb_amount),
      sourceRows: numberValue(row.source_rows),
      classifiedRows: numberValue(row.classified_rows),
      unknownCodeRows: numberValue(row.unknown_code_rows),
    })
    unknownByDealer.set(dealer, Array.isArray(row.unknown_codes) ? row.unknown_codes.map(String) : [])
  }

  const consolidated = byDealer.get(HYUNDAI_CONSOLIDATED_DEALER_CODE) || null

  // Every branch except the one the consolidated file is filed under. These are the rows
  // that the consolidated file already contains, so they are the subtrahend for the
  // consolidated branch and the fallback when the consolidated file is missing.
  const containedBranchTotals = HYUNDAI_BRANCH_DEALERS
    .filter((branch) => branch.dealerCode !== HYUNDAI_CONSOLIDATED_BRANCH)
    .flatMap((branch) => branch.dealerCodes)
    .map((code) => byDealer.get(code.toUpperCase()))
    .filter((totals): totals is DealerTotals => Boolean(totals))
    .reduce(addTotals, emptyTotals())

  const requested = normalizeHyundaiDealerCode(dealerCode)
  let totals: DealerTotals
  let coverageWarning: string | null = null
  let unknownCodes: string[] = []

  if (!requested) {
    // All Locations: the consolidated file IS the group. Summing all six double-counts five.
    if (consolidated) {
      totals = consolidated
      unknownCodes = unknownByDealer.get(HYUNDAI_CONSOLIDATED_DEALER_CODE) || []
    } else {
      totals = containedBranchTotals
      coverageWarning = `The consolidated ${HYUNDAI_CONSOLIDATED_DEALER_CODE} Operation file is missing for this period, `
        + `so the group total covers only the branches that uploaded and excludes ${HYUNDAI_CONSOLIDATED_BRANCH}.`
    }
  } else if (requested === HYUNDAI_CONSOLIDATED_BRANCH) {
    // There is no per-branch file for this branch; its figure is only ever a residual.
    if (consolidated) {
      totals = subtractTotals(consolidated, containedBranchTotals)
      unknownCodes = unknownByDealer.get(HYUNDAI_CONSOLIDATED_DEALER_CODE) || []
    } else {
      totals = emptyTotals()
      coverageWarning = `The consolidated ${HYUNDAI_CONSOLIDATED_DEALER_CODE} Operation file is missing for this period. `
        + `${HYUNDAI_CONSOLIDATED_BRANCH} has no per-branch file of its own, so no figure can be derived.`
    }
  } else {
    const branch = HYUNDAI_BRANCH_DEALERS.find((item) => item.dealerCode === requested)
    const codes = branch?.dealerCodes || []
    totals = codes
      .map((code) => byDealer.get(code.toUpperCase()))
      .filter((value): value is DealerTotals => Boolean(value))
      .reduce(addTotals, emptyTotals())
    unknownCodes = codes.flatMap((code) => unknownByDealer.get(code.toUpperCase()) || []).slice(0, 25)
  }

  return {
    available: Boolean(periodStart) && totals.sourceRows > 0,
    periodStart,
    periodEnd,
    ...totals,
    unknownCodes,
    identifierVersion: HYUNDAI_VAS_IDENTIFIER_VERSION,
    coverageWarning,
  }
}
