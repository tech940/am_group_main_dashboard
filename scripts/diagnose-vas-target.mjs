import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[vas56032]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
const TARGET = 554378 - 3719 * 134

const vasFilter = `(
  op_desc ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
  OR op_desc ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
  OR op_desc ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
  OR op_desc ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
) AND op_desc !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'`

for (const pe of ['2026-06-13', '2026-06-16']) {
  for (const rtype of ['all', 'operation', 'part']) {
    const typeFilter = rtype === 'all' ? '' : `WHERE rtype = '${rtype}'`
    const [row] = await db.unsafe(`
      WITH rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
          COALESCE(NULLIF(regexp_replace(total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS op_amt,
          LOWER(COALESCE(op_part_desc, '')) AS op_desc,
          LOWER(COALESCE(report_type, '')) AS rtype
        FROM operation_wise_analysis_report
        WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end = '${pe}'::date
        ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT COALESCE(SUM(op_amt) FILTER (WHERE ${vasFilter}), 0)::float AS vas
      FROM rows ${typeFilter}`)
    const diff = Math.abs(row.vas - TARGET)
    console.log(pe, rtype, Math.round(row.vas), 'target', TARGET, 'diff', Math.round(diff))
  }
}

await db.end()
