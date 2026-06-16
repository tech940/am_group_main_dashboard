import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db.ts'

const monthStart = '2026-06-01'
const exportDate = '2026-06-15'

const result = await db.execute(sql.raw(`
  WITH latest AS (
    SELECT report_period_start::date AS ps, report_period_end::date AS pe
    FROM operation_wise_analysis_report
    WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end <= '2026-06-15'
    GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
  ), rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
      COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
      UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS code
    FROM operation_wise_analysis_report source
    INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
    ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
  )
  SELECT (SELECT pe::text FROM latest) AS pe,
    COALESCE(SUM(qty) FILTER (WHERE code LIKE 'NPNENG%'), 0)::float AS oil,
    COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)'), 0)::float AS wa
  FROM rows
`))

console.log('analytics raw sql:', result)

process.exit(0)
