import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[lab2]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const periods = await db.unsafe(`
  SELECT DISTINCT report_period_end::date pe FROM operation_wise_analysis_report
  WHERE report_period_start='${MONTH}' ORDER BY 1`)

for (const { pe } of periods) {
  const d = pe.toISOString().slice(0, 10)
  for (const [label, dealerSql, wbFilter] of [
    ['all', '', 'wb_all'],
    ['dealer', `AND UPPER(TRIM(COALESCE(source.dealer_code,'')))='${DEALER}'`, 'wb_all'],
    ['dealer_wbop', `AND UPPER(TRIM(COALESCE(source.dealer_code,'')))='${DEALER}'`, 'wb_op'],
  ]) {
    const [r] = await db.unsafe(`
      WITH operation_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
          COALESCE(NULLIF(regexp_replace(source.total_amt::text,'[^0-9.-]','','g'),'')::numeric,0) AS amount,
          LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
          LOWER(COALESCE(source.op_part_code, '')) AS operation_code,
          LOWER(COALESCE(source.report_type, '')) AS report_type
        FROM operation_wise_analysis_report source
        WHERE source.report_period_start::date='${MONTH}' AND source.report_period_end::date='${d}'
          ${dealerSql}
        ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), uploaded_at DESC NULLS LAST, source.id DESC
      ),
      c AS (
        SELECT *,
          (operation_code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))') is_wa,
          (operation_code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))') is_wb_all,
          (report_type='operation' AND (operation_code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')) is_wb_op
        FROM operation_rows
      )
      SELECT ROUND(COALESCE(SUM(amount) FILTER (WHERE is_wa),0)) wa,
        ROUND(COALESCE(SUM(amount) FILTER (WHERE is_wb_all),0)) wb_all,
        ROUND(COALESCE(SUM(amount) FILTER (WHERE is_wb_op),0)) wb_op FROM c`)
    if (r.wa === 30212 || r.wb_all === 25417 || r.wb_op === 25417 || d === '2026-06-16' || d === '2026-06-13') {
      console.log(d, label, r)
    }
  }
}

await db.end()
