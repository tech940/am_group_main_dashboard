import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[ops-vas]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

for (const end of ['2026-06-13', '2026-06-15', '2026-06-16']) {
  const [row] = await db.unsafe(`
    WITH latest AS (
      SELECT report_period_start::date AS ps, report_period_end::date AS pe
      FROM operation_wise_analysis_report
      WHERE dealer_code = '${DEALER}' AND report_period_start = '${MONTH}' AND report_period_end <= '${end}'::date
      GROUP BY 1,2
      ORDER BY CASE WHEN report_period_end::date = '${end}'::date THEN 0 ELSE 1 END, report_period_end::date DESC
      LIMIT 1
    ),
    operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
        COALESCE(NULLIF(regexp_replace(source.total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amt,
        LOWER(COALESCE(source.op_part_code, '')) AS code,
        LOWER(COALESCE(source.report_type, '')) AS rtype,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description
      FROM operation_wise_analysis_report source
      INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT (SELECT pe::text FROM latest) AS pe,
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'), 0)::float AS wa,
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'), 0)::float AS wb,
      COALESCE(SUM(amt) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'), 0)::float AS wa_amt,
      COALESCE(SUM(amt) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'), 0)::float AS wb_amt,
      COALESCE(SUM(qty) FILTER (WHERE code LIKE 'npneng%'), 0)::float AS oil_npn,
      COALESCE(SUM(qty) FILTER (WHERE code LIKE 'npneng2p2bio%' OR code LIKE 'npneng3d1bic%' OR code LIKE 'npneng4d2bic%'), 0)::float AS oil_coded
    FROM operation_rows`)
  console.log('period end', end, row)
}

const vasFilter = `(
  description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
  OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
  OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
  OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
) AND description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'`

for (const pe of ['2026-06-13', '2026-06-16']) {
  const [vas] = await db.unsafe(`
    WITH rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        COALESCE(NULLIF(regexp_replace(total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
        LOWER(COALESCE(op_part_desc, '')) AS description
      FROM operation_wise_analysis_report
      WHERE dealer_code = '${DEALER}' AND report_period_start = '${MONTH}' AND report_period_end = '${pe}'::date
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COALESCE(SUM(amount) FILTER (WHERE ${vasFilter}), 0)::float AS vas
    FROM rows`)
  console.log('vas pe', pe, vas, 'labour w/o vas', Math.round((554378 - vas.vas) / 134))
}

await db.end()
