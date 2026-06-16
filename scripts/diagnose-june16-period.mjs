import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[june16]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

async function metricsForPeriod(pe) {
  const [row] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
        COALESCE(NULLIF(regexp_replace(source.total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amt,
        LOWER(COALESCE(source.op_part_code, '')) AS code,
        LOWER(COALESCE(source.report_type, '')) AS rtype,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description
      FROM operation_wise_analysis_report source
      WHERE source.dealer_code = 'JK402'
        AND source.report_period_start = '2026-06-01'
        AND source.report_period_end = '${pe}'::date
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'), 0)::float AS wa,
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'), 0)::float AS wb,
      COALESCE(SUM(amt) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'), 0)::float AS wa_amt,
      COALESCE(SUM(amt) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'), 0)::float AS wb_amt,
      COALESCE(SUM(qty) FILTER (WHERE code LIKE 'npneng%'), 0)::float AS oil_npn,
      COALESCE(SUM(qty) FILTER (
        WHERE code LIKE 'npneng%'
          OR description ~ '(engine[[:space:]-]*oil|(^|[^0-9])0w[[:space:]-]*20([^0-9]|$)|(^|[^0-9])5w[[:space:]-]*30([^0-9]|$)|(^|[^0-9])10w[[:space:]-]*30([^0-9]|$)|(^|[^0-9])15w[[:space:]-]*40([^0-9]|$))'
      ), 0)::float AS oil_desc
    FROM operation_rows`)
  return row
}

for (const pe of ['2026-06-13', '2026-06-14', '2026-06-15', '2026-06-16']) {
  console.log(pe, await metricsForPeriod(pe))
}

// VAS by report_type for June 16
const vasFilter = `(
  description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
  OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
  OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
  OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
) AND description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'`

for (const pe of ['2026-06-13', '2026-06-16']) {
  const [row] = await db.unsafe(`
    WITH rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        COALESCE(NULLIF(regexp_replace(total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
        LOWER(COALESCE(op_part_desc, '')) AS description,
        LOWER(COALESCE(report_type, '')) AS rtype
      FROM operation_wise_analysis_report
      WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end = '${pe}'::date
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COALESCE(SUM(amount) FILTER (WHERE ${vasFilter}), 0)::float AS all_vas,
      COALESCE(SUM(amount) FILTER (WHERE rtype = 'operation' AND ${vasFilter}), 0)::float AS op_vas,
      COALESCE(SUM(amount) FILTER (WHERE rtype = 'part' AND ${vasFilter}), 0)::float AS part_vas
    FROM rows`)
  console.log('vas', pe, row, 'labour w/o', Math.round((554378 - row.all_vas) / 134))
}

await db.end()
