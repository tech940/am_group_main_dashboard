import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const EXPORT = '2026-06-15'
const url = await pickDatabaseUrl(postgres, '[lab]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

async function labour(pe, dealerFilter) {
  const dealerSql = dealerFilter
    ? `AND UPPER(TRIM(COALESCE(source.dealer_code,''))) = '${DEALER}'`
    : ''
  const [r] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_amt::text,'[^0-9.-]','','g'),'')::numeric,0) AS amount,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = '${MONTH}'::date
        AND source.report_period_end::date = '${pe}'::date
        ${dealerSql}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    ),
    classified AS (
      SELECT *,
        (operation_code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))') AS is_wa,
        (operation_code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))') AS is_wb_all,
        (report_type = 'operation' AND (operation_code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')) AS is_wb_op
      FROM operation_rows
    )
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::float AS wa_amt,
      COALESCE(SUM(amount) FILTER (WHERE is_wb_all), 0)::float AS wb_all,
      COALESCE(SUM(amount) FILTER (WHERE is_wb_op), 0)::float AS wb_op
    FROM classified`)
  return r
}

for (const pe of ['2026-06-13', '2026-06-16']) {
  console.log(pe, 'no dealer', await labour(pe, false))
  console.log(pe, 'dealer', await labour(pe, true))
}

await db.end()
