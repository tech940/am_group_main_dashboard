import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { platinumSourceDealerFilter } from '@/lib/platinum/dealer-filter'
import {
  PLATINUM_VAS_IDENTIFIER_VERSION,
  platinumKnownCodeSql,
  platinumVasCodeSql,
} from '@/lib/platinum/vas-identifiers'

type DealerFilter = string | null
type ResultRow = Record<string, unknown>

const tableExistsCache = new Map<string, boolean>()
const tableColumnsCache = new Map<string, Set<string>>()

export type PlatinumVasResult = {
  amount: number
  available: boolean
  unavailableReason: string | null
  source: string | null
  sourceTable: string | null
  periodStart: string | null
  periodEnd: string | null
  sourceRows: number
  matchedRows: number
  unknownCodeRows: number
  identifierVersion: string
  dedupeMode: string | null
  latestSnapshotUploadedAt?: string | null
  parityStatus?: 'not_checked' | 'matched' | 'summary_mismatch' | 'live_only'
  summaryAmount?: number | null
  summarySourceRows?: number | null
}

function resultRows(result: unknown): ResultRow[] {
  return Array.isArray(result) ? result as ResultRow[] : []
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function dateValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10) || null
}

function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

async function tableExists(tableName: string) {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName)!

  const result = await analyticsDb.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  const exists = Boolean(resultRows(result)[0]?.exists)
  tableExistsCache.set(tableName, exists)
  return exists
}

async function tableColumns(tableName: string) {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName)!

  const result = await analyticsDb.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `)
  const columns = new Set(resultRows(result).map((row) => String(row.column_name || '')))
  tableColumnsCache.set(tableName, columns)
  return columns
}

function hasColumns(columns: Set<string>, required: string[]) {
  return required.every((column) => columns.has(column))
}

function operationDealerFilter(dealerCode: DealerFilter) {
  return platinumSourceDealerFilter(dealerCode)
}

function reportTypeFilter(columns: Set<string>) {
  return columns.has('report_type')
    ? sql`AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')`
    : sql``
}

function codeExpression(columns: Set<string>) {
  return columns.has('op_part_code')
    ? sql`LOWER(COALESCE(op_part_code::text, ''))`
    : sql`''`
}

function descriptionExpression(columns: Set<string>) {
  const descriptionColumns = ['op_part_desc', 'labour_desc', 'part_desc'].filter((column) => columns.has(column))
  if (descriptionColumns.length === 0) return sql`''`

  const parts = descriptionColumns.map((column) => `COALESCE(${column}::text, '')`).join(', ')
  return sql`LOWER(CONCAT_WS(' ', ${sql.raw(parts)}))`
}

function emptyResult(reason: string): PlatinumVasResult {
  return {
    amount: 0,
    available: false,
    unavailableReason: reason,
    source: null,
    sourceTable: null,
    periodStart: null,
    periodEnd: null,
    sourceRows: 0,
    matchedRows: 0,
    unknownCodeRows: 0,
    identifierVersion: PLATINUM_VAS_IDENTIFIER_VERSION,
    dedupeMode: null,
    latestSnapshotUploadedAt: null,
    parityStatus: 'not_checked',
    summaryAmount: null,
    summarySourceRows: null,
  }
}

function vasFilter() {
  return platinumVasCodeSql(sql.raw('code'))
}

function unknownCodeFilter() {
  return sql`
    NULLIF(TRIM(code), '') IS NOT NULL
    AND NOT (${platinumKnownCodeSql(sql.raw('code'))})
  `
}

function vasSourceType(startDate: string, endDate: string, periodStart: string | null, periodEnd: string | null) {
  if (periodStart === startDate && periodEnd === endDate) return 'operation_period_exact'
  if (periodStart?.slice(0, 7) === endDate.slice(0, 7)) return 'operation_month_snapshot'
  if (periodStart && periodEnd && periodStart >= startDate && periodEnd <= endDate) return 'operation_period_covered'
  return 'operation_period_containing'
}

export function isComparableVasSource(source: string | null | undefined) {
  return source === 'operation_period_exact'
    || source === 'operation_period_covered'
    || source === 'operation_month_snapshot'
}

function nonComparableResult(startDate: string, endDate: string, resolved: PlatinumVasResult): PlatinumVasResult {
  return {
    ...emptyResult(`No operation period matches ${startDate} to ${endDate} for the selected location.`),
    source: resolved.source,
    sourceTable: resolved.sourceTable,
    periodStart: resolved.periodStart,
    periodEnd: resolved.periodEnd,
    sourceRows: resolved.sourceRows,
    matchedRows: resolved.matchedRows,
    unknownCodeRows: resolved.unknownCodeRows,
    identifierVersion: resolved.identifierVersion,
    dedupeMode: resolved.dedupeMode,
    latestSnapshotUploadedAt: resolved.latestSnapshotUploadedAt,
  }
}

function finalizeVasResult(
  result: PlatinumVasResult,
  startDate: string,
  endDate: string,
  requireComparable: boolean
): PlatinumVasResult {
  if (!result.available) return result
  if (!requireComparable || isComparableVasSource(result.source)) return result
  return nonComparableResult(startDate, endDate, result)
}

function buildVasResult(
  startDate: string,
  endDate: string,
  sourceTable: string,
  row: ResultRow | undefined,
  dedupeMode: string
): PlatinumVasResult | null {
  if (!row || numberValue(row.period_rows) <= 0) return null

  const periodStart = dateValue(row.period_start)
  const periodEnd = dateValue(row.period_end)

  return {
    amount: numberValue(row.vas_amount),
    available: true,
    unavailableReason: null,
    source: vasSourceType(startDate, endDate, periodStart, periodEnd),
    sourceTable,
    periodStart,
    periodEnd,
    sourceRows: numberValue(row.source_rows),
    matchedRows: numberValue(row.source_rows),
    unknownCodeRows: numberValue(row.unknown_code_rows),
    identifierVersion: PLATINUM_VAS_IDENTIFIER_VERSION,
    dedupeMode,
    latestSnapshotUploadedAt: dateValue(row.latest_uploaded_at),
    parityStatus: 'not_checked',
    summaryAmount: null,
    summarySourceRows: null,
  }
}

function vasResultsMatch(summary: PlatinumVasResult, live: PlatinumVasResult) {
  return Math.abs(summary.amount - live.amount) <= 0.01
    && summary.sourceRows === live.sourceRows
    && summary.periodStart === live.periodStart
    && summary.periodEnd === live.periodEnd
}

function resolveSummaryParity(summary: PlatinumVasResult, live: PlatinumVasResult | null) {
  if (!live) return summary
  if (vasResultsMatch(summary, live)) {
    return {
      ...summary,
      parityStatus: 'matched' as const,
      summaryAmount: summary.amount,
      summarySourceRows: summary.sourceRows,
    }
  }

  return {
    ...live,
    parityStatus: 'summary_mismatch' as const,
    summaryAmount: summary.amount,
    summarySourceRows: summary.sourceRows,
    dedupeMode: 'row_hash_latest_summary_mismatch',
  }
}

async function fetchLiveVasForParity(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter,
  periodStart: string,
  periodEnd: string
) {
  try {
    return await fetchOperationVasForPeriod(startDate, endDate, dealerCode, periodStart, periodEnd)
  } catch (error) {
    console.warn('Platinum VAS live parity check failed; using materialized summary.', error)
    return null
  }
}

// Queries the materialized summary view for an exact period match.
async function fetchExactSummaryVas(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter
): Promise<PlatinumVasResult | null> {
  const dealerWhere = dealerCode ? sql`AND dealer_code = ${dealerCode}` : sql``
  const result = await analyticsDb.execute(sql`
    SELECT
      COALESCE(SUM(vas_amount), 0)::float AS vas_amount,
      COALESCE(SUM(period_rows), 0)::int AS period_rows,
      COALESCE(SUM(source_rows), 0)::int AS source_rows,
      MIN(period_start)::text AS period_start,
      MAX(period_end)::text AS period_end,
      MAX(uploaded_at)::text AS latest_uploaded_at
    FROM am_platinum_vas_period_summary_v1
    WHERE period_start = ${startDate}::date
      AND period_end = ${endDate}::date
      ${dealerWhere}
  `)

  return buildVasResult(
    startDate,
    endDate,
    'am_platinum_operation_wise_analysis_report',
    resultRows(result)[0],
    'materialized_row_hash_latest'
  )
}

// Queries the materialized summary view for the best-matching period when an exact match is unavailable.
async function fetchFallbackSummaryVas(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter
): Promise<PlatinumVasResult | null> {
  const dealerWhere = dealerCode ? sql`AND dealer_code = ${dealerCode}` : sql``
  const result = await analyticsDb.execute(sql`
    WITH candidate_period AS (
      SELECT period_start, period_end
      FROM am_platinum_vas_period_summary_v1
    WHERE date_trunc('month', period_start)::date = date_trunc('month', ${endDate}::date)::date
        ${dealerWhere}
      GROUP BY period_start, period_end
      ORDER BY
        period_end DESC,
        period_start DESC
      LIMIT 1
    )
    SELECT
      COALESCE(SUM(summary.vas_amount), 0)::float AS vas_amount,
      COALESCE(SUM(summary.period_rows), 0)::int AS period_rows,
      COALESCE(SUM(summary.source_rows), 0)::int AS source_rows,
      MIN(summary.period_start)::text AS period_start,
      MAX(summary.period_end)::text AS period_end,
      MAX(summary.uploaded_at)::text AS latest_uploaded_at
    FROM am_platinum_vas_period_summary_v1 summary
    JOIN candidate_period candidate
      ON candidate.period_start = summary.period_start
     AND candidate.period_end = summary.period_end
    WHERE 1 = 1
      ${dealerWhere}
  `)

  return buildVasResult(
    startDate,
    endDate,
    'am_platinum_operation_wise_analysis_report',
    resultRows(result)[0],
    'materialized_row_hash_latest'
  )
}

async function fetchOperationVasForPeriod(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter,
  periodStart: string,
  periodEnd: string
): Promise<PlatinumVasResult | null> {
  const sourceTable = 'am_platinum_operation_wise_analysis_report'
  if (!await tableExists(sourceTable)) return null

  const columns = await tableColumns(sourceTable)
  const codeSql = codeExpression(columns)
  const descriptionSql = descriptionExpression(columns)
  const hasDescription = ['op_part_desc', 'labour_desc', 'part_desc'].some((column) => columns.has(column))
  if (!hasColumns(columns, ['report_period_start', 'report_period_end', 'total_amt', 'source_dealer_code']) || !hasDescription) {
    return null
  }

  const result = await analyticsDb.execute(sql`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        COALESCE(NULLIF(row_hash, ''), id::text) AS addon_key,
        report_period_start::date AS period_start,
        report_period_end::date AS period_end,
        ${numericText(sql.raw('total_amt'))} AS amount,
        ${codeSql} AS code,
        ${descriptionSql} AS description
      FROM am_platinum_operation_wise_analysis_report
      WHERE report_period_start::date = ${periodStart}::date
        AND report_period_end::date = ${periodEnd}::date
        ${reportTypeFilter(columns)}
        ${operationDealerFilter(dealerCode)}
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE ${vasFilter()}), 0)::float AS vas_amount,
      COUNT(*)::int AS period_rows,
      COUNT(*) FILTER (WHERE ${vasFilter()})::int AS source_rows,
      COUNT(*) FILTER (WHERE ${unknownCodeFilter()})::int AS unknown_code_rows,
      MIN(period_start)::text AS period_start,
      MAX(period_end)::text AS period_end
    FROM operation_rows
  `)

  return buildVasResult(startDate, endDate, sourceTable, resultRows(result)[0], 'row_hash_latest')
}

async function fetchBestEffortOperationVas(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter
): Promise<PlatinumVasResult | null> {
  const sourceTable = 'am_platinum_operation_wise_analysis_report'
  if (!await tableExists(sourceTable)) return null

  const columns = await tableColumns(sourceTable)
  if (!hasColumns(columns, ['report_period_start', 'report_period_end'])) return null

  const periodResult = await analyticsDb.execute(sql`
    SELECT report_period_start::date AS period_start,
           report_period_end::date AS period_end
    FROM am_platinum_operation_wise_analysis_report
    WHERE date_trunc('month', report_period_start)::date = date_trunc('month', ${endDate}::date)::date
      ${reportTypeFilter(columns)}
      ${operationDealerFilter(dealerCode)}
    GROUP BY report_period_start::date, report_period_end::date
    ORDER BY
      report_period_end::date DESC,
      report_period_start::date DESC
    LIMIT 1
  `)

  const periodRow = resultRows(periodResult)[0]
  const periodStart = dateValue(periodRow?.period_start)
  const periodEnd = dateValue(periodRow?.period_end)
  if (!periodStart || !periodEnd) return null

  return fetchOperationVasForPeriod(startDate, endDate, dealerCode, periodStart, periodEnd)
}

type VasPeriodRequest = {
  key: 'cy' | 'ly'
  startDate: string
  endDate: string
}

// Batch-fetches exact period matches from the materialized summary view.
async function fetchExactSummaryVasBatch(
  periods: VasPeriodRequest[],
  dealerCode: DealerFilter
): Promise<Map<string, PlatinumVasResult>> {
  const dealerWhere = dealerCode ? sql`AND dealer_code = ${dealerCode}` : sql``
  const periodFilters = sql.join(
    periods.map((period) => sql`(period_start = ${period.startDate}::date AND period_end = ${period.endDate}::date)`),
    sql` OR `
  )
  const result = await analyticsDb.execute(sql`
    SELECT
      period_start::text AS period_start,
      period_end::text AS period_end,
      COALESCE(SUM(vas_amount), 0)::float AS vas_amount,
      COALESCE(SUM(period_rows), 0)::int AS period_rows,
      COALESCE(SUM(source_rows), 0)::int AS source_rows,
      MAX(uploaded_at)::text AS latest_uploaded_at
    FROM am_platinum_vas_period_summary_v1
    WHERE (${periodFilters})
      ${dealerWhere}
    GROUP BY period_start, period_end
  `)

  const resolved = new Map<string, PlatinumVasResult>()
  for (const row of resultRows(result)) {
    const periodStart = dateValue(row.period_start)
    const periodEnd = dateValue(row.period_end)
    const match = periods.find((period) => period.startDate === periodStart && period.endDate === periodEnd)
    if (!match) continue
    const built = buildVasResult(
      match.startDate,
      match.endDate,
      'am_platinum_operation_wise_analysis_report',
      row,
      'materialized_row_hash_latest'
    )
    if (built) resolved.set(match.key, built)
  }
  return resolved
}

export type PlatinumVasFetchOptions = {
  requireComparable?: boolean
}

export async function fetchPlatinumWorkshopVasAmounts(
  cyStart: string,
  cyEnd: string,
  lyStart: string,
  lyEnd: string,
  dealerCode: DealerFilter = null
): Promise<{ cy: PlatinumVasResult; ly: PlatinumVasResult }> {
  const [cy, ly] = await Promise.all([
    fetchPlatinumWorkshopVasAmount(cyStart, cyEnd, dealerCode),
    fetchPlatinumWorkshopVasAmount(lyStart, lyEnd, dealerCode, { requireComparable: true }),
  ])
  return {
    cy,
    ly,
  }
}

export async function fetchPlatinumWorkshopVasAmount(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter = null,
  options: PlatinumVasFetchOptions = {}
): Promise<PlatinumVasResult> {
  const requireComparable = options.requireComparable === true
  const sourceTable = 'am_platinum_operation_wise_analysis_report'
  const summaryTable = 'am_platinum_vas_period_summary_v1'

  // Operation Wise is a monthly report, not a transaction-date source. Always
  // prefer the latest live snapshot for the selected calendar month.
  const monthlyOperation = await fetchBestEffortOperationVas(startDate, endDate, dealerCode)
  if (monthlyOperation) {
    return finalizeVasResult({
      ...monthlyOperation,
      parityStatus: 'live_only',
    }, startDate, endDate, requireComparable)
  }

  if (await tableExists(summaryTable)) {
    const fallbackSummary = await fetchFallbackSummaryVas(startDate, endDate, dealerCode)
    if (fallbackSummary) return finalizeVasResult(fallbackSummary, startDate, endDate, requireComparable)
  }

  const snapshotMeta = await analyticsDb.execute(sql`
    SELECT
      MAX(uploaded_at)::text AS latest_uploaded_at
    FROM am_platinum_operation_wise_analysis_report
    WHERE id = (
      SELECT id
      FROM am_platinum_operation_wise_analysis_report
      WHERE uploaded_at IS NOT NULL
      ORDER BY id DESC
      LIMIT 1
    )
  `)
  const snapshotRow = resultRows(snapshotMeta)[0]

  return {
    ...emptyResult(`No Platinum VAS source period covers ${startDate} to ${endDate} for the selected location.`),
    source: 'operation_period_unavailable',
    sourceTable,
    sourceRows: 0,
    matchedRows: 0,
    unknownCodeRows: 0,
    identifierVersion: PLATINUM_VAS_IDENTIFIER_VERSION,
    latestSnapshotUploadedAt: dateValue(snapshotRow?.latest_uploaded_at),
  }
}
