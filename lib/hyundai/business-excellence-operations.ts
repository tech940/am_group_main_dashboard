import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { getHyundaiDealerCodes } from '@/lib/hyundai/dealer-branch'
import {
  PLATINUM_VAS_IDENTIFIER_VERSION,
  platinumVasCodeSql,
  platinumWheelAlignmentCodeSql,
  platinumWheelBalancingCodeSql,
} from '@/lib/platinum/vas-identifiers'

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
  const codes = getHyundaiDealerCodes(dealerCode)
  if (!codes.length) return sql``
  return sql`AND UPPER(TRIM(COALESCE(${sql.raw(`${alias}source_dealer_code`)}, ${sql.raw(`${alias}dealer_code`)}, ''))) IN (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})`
}

export async function fetchHyundaiMonthlyOperationMetrics(
  endDate: string,
  dealerCode: string | null = null,
): Promise<HyundaiMonthlyOperationMetrics> {
  const result = await db.execute(sql`
    WITH candidate_period AS (
      SELECT report_period_start::date AS period_start, report_period_end::date AS period_end
      FROM hyundai_operation_wise_analysis_report
      WHERE date_trunc('month', report_period_start)::date = date_trunc('month', ${endDate}::date)::date
        ${dealerFilter(dealerCode)}
      GROUP BY report_period_start::date, report_period_end::date
      ORDER BY report_period_end::date DESC, report_period_start::date DESC
      LIMIT 1
    ),
    latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS code,
        COALESCE(source.total_amt, 0)::numeric AS amount
      FROM hyundai_operation_wise_analysis_report source
      JOIN candidate_period period
        ON source.report_period_start::date = period.period_start
       AND source.report_period_end::date = period.period_end
      WHERE LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
        ${dealerFilter(dealerCode, 'source.')}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text),
        source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT
      MIN(period.period_start)::text AS period_start,
      MAX(period.period_end)::text AS period_end,
      COUNT(*) FILTER (WHERE ${platinumVasCodeSql(sql.raw('latest.code'))})::int AS vas_rows,
      COALESCE(SUM(amount) FILTER (WHERE ${platinumVasCodeSql(sql.raw('latest.code'))}), 0)::float AS vas_amount,
      COUNT(*) FILTER (WHERE ${platinumWheelAlignmentCodeSql(sql.raw('latest.code'))})::int AS wa_count,
      COALESCE(SUM(amount) FILTER (WHERE ${platinumWheelAlignmentCodeSql(sql.raw('latest.code'))}), 0)::float AS wa_amount,
      COUNT(*) FILTER (WHERE ${platinumWheelBalancingCodeSql(sql.raw('latest.code'))})::int AS wb_count,
      COALESCE(SUM(amount) FILTER (WHERE ${platinumWheelBalancingCodeSql(sql.raw('latest.code'))}), 0)::float AS wb_amount
    FROM candidate_period period
    LEFT JOIN latest ON TRUE
  `)

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
    identifierVersion: PLATINUM_VAS_IDENTIFIER_VERSION,
  }
}
