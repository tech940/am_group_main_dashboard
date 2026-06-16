import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[wbpart]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const rows = await db.unsafe(`
  WITH d AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash,''), id::text))
      op_part_code, report_type, op_part_desc,
      COALESCE(NULLIF(regexp_replace(total_amt::text,'[^0-9.-]','','g'),'')::numeric,0) amt
    FROM operation_wise_analysis_report
    WHERE report_period_start='${MONTH}' AND report_period_end='2026-06-16'
      AND UPPER(TRIM(dealer_code))='${DEALER}'
    ORDER BY COALESCE(NULLIF(row_hash,''), id::text), uploaded_at DESC NULLS LAST, id DESC
  ),
  c AS (
    SELECT *, LOWER(COALESCE(report_type,'')) rt,
      LOWER(COALESCE(op_part_code,'')) code,
      LOWER(CONCAT_WS(' ', report_type, op_part_code, op_part_desc)) description
    FROM d
  )
  SELECT op_part_code, report_type, amt, rt FROM c
  WHERE (code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')
    AND rt <> 'operation'
  ORDER BY amt DESC`)

console.log('non-op wb', rows, 'sum', rows.reduce((s,r)=>s+Number(r.amt),0))

const allwb = await db.unsafe(`
  WITH d AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash,''), id::text))
      report_type, COALESCE(NULLIF(regexp_replace(total_amt::text,'[^0-9.-]','','g'),'')::numeric,0) amt,
      LOWER(COALESCE(op_part_code,'')) code,
      LOWER(CONCAT_WS(' ', report_type, op_part_code, op_part_desc)) description
    FROM operation_wise_analysis_report
    WHERE report_period_start='${MONTH}' AND report_period_end='2026-06-16'
      AND UPPER(TRIM(dealer_code))='${DEALER}'
    ORDER BY COALESCE(NULLIF(row_hash,''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT report_type, SUM(amt) s FROM d
  WHERE (code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')
  GROUP BY 1`)
console.log('by type', allwb)

await db.end()
