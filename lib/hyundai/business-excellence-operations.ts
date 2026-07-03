import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { hyundaiSourceDealerFilter } from '@/lib/hyundai/dealer-branch'

type Row = Record<string, unknown>
const HYUNDAI_VAS_IDENTIFIER_VERSION = 'hyundai-vas-canonical-codes-2026-06-30-v2'
const HYUNDAI_VAS_CODES = [
  'A10AAACDVASHR',
  'A10AAATLVASHR',
  'A10AATBC000HR',
  'A10AAECMVASHR',
  'A10AASPMVASHR',
  'A10AAECLVASHR',
  'A10AAISSVASHR',
  'A10AASPLVASHR',
  'A10AAECSVASHR',
  'A10AAATMVASHR',
  'A10AAATSVASHR',
  'A10AAACDVASHRAA',
  'A10AASPSVASHR',
  'A10AATBC000HRAA',
  'A10AAECLVASHRAA',
] as const
const HYUNDAI_WHEEL_ALIGNMENT_CODES = [
  'A10AAGM06WHAL',
  'A10AAGM06WHALAA',
] as const
const HYUNDAI_WHEEL_BALANCING_CODES = [
  'A10AAGM07WHBL',
] as const

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

function dealerFilter(dealerCode: string | null, alias = '') {
  return hyundaiSourceDealerFilter(
    dealerCode,
    sql.raw(`${alias}source_dealer_code`),
    [sql.raw(`${alias}dealer_code`)],
  )
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

function codeMatchSql(codeColumn: ReturnType<typeof sql.raw>, codes: readonly string[]) {
  return sql`UPPER(TRIM(COALESCE(${codeColumn}::text, ''))) IN (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})`
}

function hyundaiVasCodeSql(codeColumn: ReturnType<typeof sql.raw>) {
  return codeMatchSql(codeColumn, HYUNDAI_VAS_CODES)
}

function hyundaiWheelAlignmentSql(codeColumn: ReturnType<typeof sql.raw>) {
  return codeMatchSql(codeColumn, HYUNDAI_WHEEL_ALIGNMENT_CODES)
}

function hyundaiWheelBalancingSql(codeColumn: ReturnType<typeof sql.raw>) {
  return codeMatchSql(codeColumn, HYUNDAI_WHEEL_BALANCING_CODES)
}

export async function fetchHyundaiMonthlyOperationMetrics(
  endDate: string,
  dealerCode: string | null = null,
): Promise<HyundaiMonthlyOperationMetrics> {
  const empty = (): HyundaiMonthlyOperationMetrics => ({
    available: false,
    periodStart: null,
    periodEnd: null,
    vasAmount: 0,
    vasRows: 0,
    waCount: 0,
    waAmount: 0,
    wbCount: 0,
    wbAmount: 0,
    sourceRows: 0,
    classifiedRows: 0,
    unknownCodeRows: 0,
    unknownCodes: [],
    identifierVersion: HYUNDAI_VAS_IDENTIFIER_VERSION,
  })

  if (!(await db.tableExists('hyundai_operation_wise_analysis_report'))) return empty()

  const { monthStart, nextMonthStart } = getMonthRange(endDate)

  let result: unknown
  try {
    result = await db.execute(sql`
    WITH candidate_period AS (
      SELECT report_period_start::date AS period_start, report_period_end::date AS period_end
      FROM hyundai_operation_wise_analysis_report
      WHERE report_period_start >= ${monthStart}::date
        AND report_period_start < ${nextMonthStart}::date
        ${dealerFilter(dealerCode)}
      GROUP BY report_period_start::date, report_period_end::date
      ORDER BY
        (COUNT(*) > 100) DESC,
        report_period_end::date DESC,
        report_period_start::date DESC
      LIMIT 1
    ),
    latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS code,
        COALESCE(source.total_amt, 0)::numeric AS amount,
        COALESCE(source.total_count, 0)::numeric AS quantity
      FROM hyundai_operation_wise_analysis_report source
      JOIN candidate_period period
        ON source.report_period_start::date = period.period_start
       AND source.report_period_end::date = period.period_end
      WHERE TRUE
        ${dealerFilter(dealerCode, 'source.')}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text),
        source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT
      MIN(period.period_start)::text AS period_start,
      MAX(period.period_end)::text AS period_end,
      COUNT(latest.code)::int AS source_rows,
      COUNT(*) FILTER (WHERE ${hyundaiVasCodeSql(sql.raw('latest.code'))})::int AS vas_rows,
      COALESCE(SUM(amount) FILTER (WHERE ${hyundaiVasCodeSql(sql.raw('latest.code'))}), 0)::float AS vas_amount,
      COALESCE(SUM(quantity) FILTER (WHERE ${hyundaiWheelAlignmentSql(sql.raw('latest.code'))}), 0)::float AS wa_count,
      COALESCE(SUM(amount) FILTER (WHERE ${hyundaiWheelAlignmentSql(sql.raw('latest.code'))}), 0)::float AS wa_amount,
      COALESCE(SUM(quantity) FILTER (WHERE ${hyundaiWheelBalancingSql(sql.raw('latest.code'))}), 0)::float AS wb_count,
      COALESCE(SUM(amount) FILTER (WHERE ${hyundaiWheelBalancingSql(sql.raw('latest.code'))}), 0)::float AS wb_amount,
      COUNT(*) FILTER (
        WHERE ${hyundaiVasCodeSql(sql.raw('latest.code'))}
          OR ${hyundaiWheelAlignmentSql(sql.raw('latest.code'))}
          OR ${hyundaiWheelBalancingSql(sql.raw('latest.code'))}
      )::int AS classified_rows,
      COUNT(*) FILTER (
        WHERE latest.code <> ''
          AND NOT (${hyundaiVasCodeSql(sql.raw('latest.code'))})
          AND NOT (${hyundaiWheelAlignmentSql(sql.raw('latest.code'))})
          AND NOT (${hyundaiWheelBalancingSql(sql.raw('latest.code'))})
      )::int AS unknown_code_rows,
      ARRAY(
        SELECT DISTINCT unknown.code
        FROM latest unknown
        WHERE unknown.code <> ''
          AND NOT (${hyundaiVasCodeSql(sql.raw('unknown.code'))})
          AND NOT (${hyundaiWheelAlignmentSql(sql.raw('unknown.code'))})
          AND NOT (${hyundaiWheelBalancingSql(sql.raw('unknown.code'))})
        ORDER BY unknown.code
        LIMIT 25
      ) AS unknown_codes
    FROM candidate_period period
    LEFT JOIN latest ON TRUE
    `)
  } catch (error) {
    const code = String((error as { cause?: { code?: unknown }; code?: unknown })?.cause?.code
      || (error as { code?: unknown })?.code
      || '')
    if (code === '42703' || code === '42P01') return empty()
    throw error
  }

  const row = rows(result)[0] || {}
  const periodStart = dateValue(row.period_start)
  return {
    available: Boolean(periodStart),
    periodStart,
    periodEnd: dateValue(row.period_end),
    vasAmount: numberValue(row.vas_amount),
    vasRows: numberValue(row.vas_rows),
    waCount: numberValue(row.wa_count),
    waAmount: numberValue(row.wa_amount),
    wbCount: numberValue(row.wb_count),
    wbAmount: numberValue(row.wb_amount),
    sourceRows: numberValue(row.source_rows),
    classifiedRows: numberValue(row.classified_rows),
    unknownCodeRows: numberValue(row.unknown_code_rows),
    unknownCodes: Array.isArray(row.unknown_codes)
      ? row.unknown_codes.map(String)
      : [],
    identifierVersion: HYUNDAI_VAS_IDENTIFIER_VERSION,
  }
}
