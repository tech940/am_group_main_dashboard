import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[wb]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

for (const PE of ['2026-06-13', '2026-06-16']) {
  const wb = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        source.op_part_code, source.op_part_desc, source.report_type,
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS operation_count,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = '${MONTH}'::date
        AND source.report_period_end::date = '${PE}'::date
        AND UPPER(TRIM(COALESCE(source.dealer_code,''))) = '${DEALER}'
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT op_part_code, operation_count, report_type FROM operation_rows
    WHERE LOWER(COALESCE(report_type,'')) = 'operation'
      AND (operation_code ~ '(^|[^a-z])wb([^a-z]|$)'
        OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')
    ORDER BY operation_count DESC`)
  const sum = wb.reduce((s, r) => s + Number(r.operation_count), 0)
  console.log(PE, 'WB', sum, wb)
}

// oil by part rows Jun 16
const oil = await db.unsafe(`
  WITH operation_rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
      source.op_part_code, source.report_type,
      COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS quantity
    FROM operation_wise_analysis_report source
    WHERE source.report_period_start::date = '${MONTH}'::date
      AND source.report_period_end::date = '2026-06-16'::date
      AND UPPER(TRIM(COALESCE(source.dealer_code,''))) = '${DEALER}'
      AND LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
    ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
  )
  SELECT op_part_code, SUM(quantity) q FROM operation_rows
  WHERE UPPER(TRIM(COALESCE(op_part_code,''))) LIKE 'NPNENG%'
  GROUP BY 1 ORDER BY q DESC`)
console.log('oil parts', oil, 'sum', oil.reduce((s,r)=>s+Number(r.q),0))

await db.end()
