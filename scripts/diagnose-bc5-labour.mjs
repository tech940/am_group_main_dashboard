import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[bc5]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const rows = await db.unsafe(`
  WITH d AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash,''), id::text))
      op_part_code, report_type,
      COALESCE(NULLIF(regexp_replace(total_amt::text,'[^0-9.-]','','g'),'')::numeric,0) amt,
      COALESCE(NULLIF(regexp_replace(total_count::text,'[^0-9.-]','','g'),'')::numeric,0) cnt
    FROM operation_wise_analysis_report
    WHERE report_period_start='${MONTH}' AND report_period_end='2026-06-16'
      AND UPPER(TRIM(dealer_code))='${DEALER}'
      AND UPPER(op_part_code) LIKE '%WHEEL%'
    ORDER BY COALESCE(NULLIF(row_hash,''), id::text), uploaded_at DESC NULLS LAST, id DESC
  ) SELECT * FROM d ORDER BY op_part_code`)

console.log(rows)
console.log('BC5', rows.find(r => r.op_part_code === 'A10VAWHEELBC5'))

// wheel balancing labour only operation type
const [wb] = await db.unsafe(`
  WITH d AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash,''), id::text))
      op_part_code, LOWER(COALESCE(report_type,'')) rt,
      COALESCE(NULLIF(regexp_replace(total_amt::text,'[^0-9.-]','','g'),'')::numeric,0) amt
    FROM operation_wise_analysis_report
    WHERE report_period_start='${MONTH}' AND report_period_end='2026-06-16'
      AND UPPER(TRIM(dealer_code))='${DEALER}'
    ORDER BY COALESCE(NULLIF(row_hash,''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT op_part_code, rt, amt FROM d
  WHERE (LOWER(op_part_code) LIKE '%wheelbc%' OR LOWER(op_part_code) LIKE '%wheelal%')
  ORDER BY op_part_code`)

console.log('wheel rows', wb)

await db.end()
