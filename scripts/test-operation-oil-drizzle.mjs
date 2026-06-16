import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db.ts'
import { KIA_ENGINE_OIL_PART_CODES } from '../lib/kia/dealer-branch.ts'

const monthStart = '2026-06-01'
const exportDate = '2026-06-15'
const codes = ['JK402']

function engineOilPartCodeMatchSql(partNoColumn, opPartCodeColumn) {
  const prefixes = KIA_ENGINE_OIL_PART_CODES.map((code) => code.replace(/'/g, "''"))
  const prefixMatches = prefixes
    .map((prefix) => `(UPPER(TRIM(COALESCE(${partNoColumn}, ''))) LIKE '${prefix}%' OR UPPER(TRIM(COALESCE(${opPartCodeColumn}, ''))) LIKE '${prefix}%')`)
    .join(' OR ')
  return sql.raw(`(
    ${prefixMatches}
    OR UPPER(TRIM(COALESCE(${partNoColumn}, ''))) LIKE 'NPNENG%'
    OR UPPER(TRIM(COALESCE(${opPartCodeColumn}, ''))) LIKE 'NPNENG%'
  )`)
}

function dealerFilter() {
  return sql.raw(`AND UPPER(TRIM(COALESCE(dealer_code, ''))) IN ('JK402')`)
}

function numericText(column) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

const result = await db.execute(sql`
  WITH latest_period AS (
    SELECT report_period_start::date AS report_period_start, report_period_end::date AS report_period_end
    FROM operation_wise_analysis_report
    WHERE report_period_start = ${monthStart}::date AND report_period_end <= ${exportDate}::date
      ${dealerFilter()}
    GROUP BY 1,2 ORDER BY report_period_end::date DESC LIMIT 1
  ),
  operation_rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
      ${numericText(sql.raw('source.total_count'))} AS quantity,
      UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS op_part_code
    FROM operation_wise_analysis_report source
    INNER JOIN latest_period ON source.report_period_start::date = latest_period.report_period_start
      AND source.report_period_end::date = latest_period.report_period_end
    WHERE TRUE
    ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
  ),
  classified AS (
    SELECT *, ${engineOilPartCodeMatchSql('op_part_code', 'op_part_code')} AS is_engine_oil FROM operation_rows
  )
  SELECT
    COALESCE(SUM(quantity) FILTER (WHERE is_engine_oil), 0)::float AS engine_mtd,
    COALESCE(SUM(quantity) FILTER (WHERE UPPER(TRIM(op_part_code)) LIKE 'NPNENG%'), 0)::float AS npn_only
  FROM classified
`)

console.log(result)
process.exit(0)
