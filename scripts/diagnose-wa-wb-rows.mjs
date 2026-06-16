import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const PE = '2026-06-16'
const url = await pickDatabaseUrl(postgres, '[rows]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const wa = await db.unsafe(`
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
  SELECT * FROM operation_rows
  WHERE operation_code ~ '(^|[^a-z])wa([^a-z]|$)'
    OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'
  ORDER BY operation_count DESC`)
console.log('WA rows sum', wa.reduce((s,r)=>s+Number(r.operation_count),0), 'count', wa.length)
console.log(wa.slice(0,15))

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
  SELECT * FROM operation_rows
  WHERE report_type = 'operation'
    AND (operation_code ~ '(^|[^a-z])wb([^a-z]|$)'
      OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')
  ORDER BY operation_count DESC`)
console.log('WB rows sum', wb.reduce((s,r)=>s+Number(r.operation_count),0), 'count', wb.length)

// diff periods incremental
const inc = await db.unsafe(`
  WITH p13 AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text)) op_part_code, report_type,
      COALESCE(NULLIF(regexp_replace(total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS c,
      LOWER(CONCAT_WS(' ', report_type, op_part_code, op_part_desc)) AS description,
      LOWER(COALESCE(op_part_code, '')) AS operation_code
    FROM operation_wise_analysis_report
    WHERE report_period_start='${MONTH}' AND report_period_end='2026-06-13'
      AND UPPER(TRIM(dealer_code))='${DEALER}'
    ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  ),
  p16 AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text)) op_part_code, report_type,
      COALESCE(NULLIF(regexp_replace(total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS c,
      LOWER(CONCAT_WS(' ', report_type, op_part_code, op_part_desc)) AS description,
      LOWER(COALESCE(op_part_code, '')) AS operation_code
    FROM operation_wise_analysis_report
    WHERE report_period_start='${MONTH}' AND report_period_end='2026-06-16'
      AND UPPER(TRIM(dealer_code))='${DEALER}'
    ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT
    COALESCE(SUM(p16.c) FILTER (WHERE p16.operation_code ~ '(^|[^a-z])wa([^a-z]|$)' OR p16.description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'),0) wa16,
    COALESCE(SUM(p13.c) FILTER (WHERE p13.operation_code ~ '(^|[^a-z])wa([^a-z]|$)' OR p13.description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'),0) wa13,
    COALESCE(SUM(p16.c) FILTER (WHERE p16.report_type='operation' AND (p16.operation_code ~ '(^|[^a-z])wb([^a-z]|$)' OR p16.description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')),0) wb16,
    COALESCE(SUM(p13.c) FILTER (WHERE p13.report_type='operation' AND (p13.operation_code ~ '(^|[^a-z])wb([^a-z]|$)' OR p13.description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')),0) wb13
  FROM p16 FULL JOIN p13 ON false`)
console.log('period totals', inc[0])

await db.end()
