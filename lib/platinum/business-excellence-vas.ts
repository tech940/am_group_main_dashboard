import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

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
  dedupeMode: string | null
  latestSnapshotUploadedAt?: string | null
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

  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  const exists = Boolean(resultRows(result)[0]?.exists)
  tableExistsCache.set(tableName, exists)
  return exists
}

async function tableColumns(tableName: string) {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName)!

  const result = await db.execute(sql`
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
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(source_dealer_code, ''))) = ${dealerCode}`
    : sql``
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
    dedupeMode: null,
    latestSnapshotUploadedAt: null,
  }
}

const PERIOD_UNSUPPORTED_REASON = 'No date-scoped VAS rows found for the selected period in am_platinum_operation_wise_analysis_report. Showing latest snapshot instead. Select a wider date range or verify report_period_start/report_period_end coverage.'

function vasFilter() {
  return sql`
    (
      code ~ '(^|[^a-z0-9])vas|vas([a-z0-9]|$)'
      OR description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
      OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
      OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
      OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*(cleaning|dressing)|service[[:space:]-]*lubrication|lubrication[[:space:]]*\\(|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
      OR description ~ '(interior[[:space:]-]*antimicrobial|exterior[[:space:]-]*beautification|paint[[:space:]-]*protection|egr[[:space:]-]*cleaner|fuel[[:space:]-]*injector)'
    )
    AND description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'
    AND description !~ '(water[[:space:]-]*borne|body[[:space:]-]*shop|bodyshop|denting|accidental[[:space:]-]*repair)'
  `
}

export async function fetchPlatinumWorkshopVasAmount(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter = null
): Promise<PlatinumVasResult> {
  const sourceTable = 'am_platinum_operation_wise_analysis_report'
  if (!await tableExists(sourceTable)) {
    return emptyResult('Platinum operation-wise VAS source table is unavailable')
  }

  const columns = await tableColumns(sourceTable)
  const codeSql = codeExpression(columns)
  const descriptionSql = descriptionExpression(columns)
  const hasDescription = ['op_part_desc', 'labour_desc', 'part_desc'].some((column) => columns.has(column))

  if (hasColumns(columns, ['report_period_start', 'report_period_end', 'total_amt', 'source_dealer_code']) && hasDescription) {
    const result = await db.execute(sql`
      WITH operation_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
          COALESCE(NULLIF(row_hash, ''), id::text) AS addon_key,
          report_period_start::date AS period_start,
          report_period_end::date AS period_end,
          source_dealer_code,
          ${numericText(sql.raw('total_amt'))} AS amount,
          ${codeSql} AS code,
          ${descriptionSql} AS description
        FROM am_platinum_operation_wise_analysis_report
        WHERE report_period_start <= ${endDate}::date
          AND report_period_end >= ${startDate}::date
          ${reportTypeFilter(columns)}
          ${operationDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        COALESCE(SUM(amount), 0)::float AS vas_amount,
        COUNT(*)::int AS source_rows,
        MIN(period_start)::text AS period_start,
        MAX(period_end)::text AS period_end
      FROM operation_rows
      WHERE ${vasFilter()}
    `)
    const row = resultRows(result)[0]
    const sourceRows = numberValue(row?.source_rows)

    if (sourceRows > 0) {
      return {
        amount: numberValue(row?.vas_amount),
        available: true,
        unavailableReason: null,
        source: 'operation_period_exact',
        sourceTable,
        periodStart: dateValue(row?.period_start),
        periodEnd: dateValue(row?.period_end),
        sourceRows,
        dedupeMode: null,
      }
    }
  }

  const snapshotMeta = await db.execute(sql`
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
    ...emptyResult(PERIOD_UNSUPPORTED_REASON),
    source: 'snapshot_only',
    sourceTable,
    sourceRows: 0,
    latestSnapshotUploadedAt: dateValue(snapshotRow?.latest_uploaded_at),
  }
}
