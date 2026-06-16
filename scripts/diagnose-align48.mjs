import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[align48]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

async function metrics(pe, opOnly = false) {
  const typeFilter = opOnly ? `AND LOWER(COALESCE(source.report_type, '')) = 'operation'` : ''
  const [row] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
        COALESCE(NULLIF(regexp_replace(source.total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amt,
        LOWER(COALESCE(source.op_part_code, '')) AS code,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description
      FROM operation_wise_analysis_report source
      WHERE source.dealer_code = 'JK402'
        AND source.report_period_start = '2026-06-01'
        AND source.report_period_end = '${pe}'::date
        ${typeFilter}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ 'alignment|align|(^|[^a-z])wa([^a-z]|$)'), 0)::float AS wa,
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ 'balanc|(^|[^a-z])wb([^a-z]|$)'), 0)::float AS wb,
      COALESCE(SUM(amt) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ 'alignment|align'), 0)::float AS wa_amt,
      COALESCE(SUM(amt) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ 'balanc'), 0)::float AS wb_amt
    FROM operation_rows`)
  return row
}

const j13 = await metrics('2026-06-13')
const j13op = await metrics('2026-06-13', true)
const j16op = await metrics('2026-06-16', true)
console.log('j13', j13)
console.log('j13op', j13op)
console.log('j16op', j16op)
console.log('j13 wa + (j16op-j13op)', j13.wa + (j16op.wa - j13op.wa), j13.wb + (j16op.wb - j13op.wb))
console.log('j13 amt, j13 count+increment amt unchanged')

// ro_billing alignment mentions
const [rb] = await db.unsafe(`
  SELECT COUNT(*)::int AS rows
  FROM ro_billing_report
  WHERE bill_date >= '2026-06-01' AND bill_date < '2026-06-16'
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402'
    AND LOWER(CONCAT_WS(' ', work_type, service_type, remarks, '')) ~ 'align'`)
console.log('rb align mentions', rb)

await db.end()
