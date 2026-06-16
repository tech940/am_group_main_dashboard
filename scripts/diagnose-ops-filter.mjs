import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[ops-filter]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

async function query(pe, extraWhere = '') {
  const [row] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
        LOWER(COALESCE(source.op_part_code, '')) AS code,
        LOWER(COALESCE(source.report_type, '')) AS rtype,
        LOWER(COALESCE(source.op_part_desc, '')) AS op_desc,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description
      FROM operation_wise_analysis_report source
      WHERE source.dealer_code = 'JK402'
        AND source.report_period_start = '2026-06-01'
        AND source.report_period_end = '${pe}'::date
        ${extraWhere}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'), 0)::float AS wa,
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'), 0)::float AS wb,
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)'), 0)::float AS wb_code_only,
      COALESCE(SUM(qty) FILTER (WHERE rtype = 'operation' AND code ~ '(^|[^a-z])wb([^a-z]|$)'), 0)::float AS wb_op_code
    FROM operation_rows`)
  return row
}

console.log('j13 all', await query('2026-06-13'))
console.log('j16 all', await query('2026-06-16'))
console.log('j16 operation/part', await query('2026-06-16', `AND LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')`))
console.log('j16 operation only', await query('2026-06-16', `AND LOWER(COALESCE(source.report_type, '')) = 'operation'`))

// Without dealer filter like current export bug
const [noDealer] = await db.unsafe(`
  WITH latest AS (
    SELECT report_period_start::date AS ps, report_period_end::date AS pe
    FROM operation_wise_analysis_report
    WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end <= '2026-06-15'
    GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
  ), operation_rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
      COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
      LOWER(COALESCE(source.op_part_code, '')) AS code,
      LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description
    FROM operation_wise_analysis_report source
    INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
    ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
  )
  SELECT (SELECT pe::text FROM latest) pe,
    COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ 'alignment|align'), 0)::float AS wa,
    COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ 'balanc'), 0)::float AS wb
  FROM operation_rows`)
console.log('export-style no row dealer filter:', noDealer)

const [withDealer] = await db.unsafe(`
  WITH latest AS (
    SELECT report_period_start::date AS ps, report_period_end::date AS pe
    FROM operation_wise_analysis_report
    WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end <= '2026-06-15'
    GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
  ), operation_rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
      COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
      LOWER(COALESCE(source.op_part_code, '')) AS code,
      LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description
    FROM operation_wise_analysis_report source
    INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
    WHERE source.dealer_code = 'JK402'
    ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
  )
  SELECT (SELECT pe::text FROM latest) pe,
    COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ 'alignment|align'), 0)::float AS wa,
    COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ 'balanc'), 0)::float AS wb
  FROM operation_rows`)
console.log('export-style with row dealer filter:', withDealer)

await db.end()
