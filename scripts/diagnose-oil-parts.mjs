import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[oilp]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

for (const PE of ['2026-06-13', '2026-06-16']) {
  const rows = await db.unsafe(`
    WITH d AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash,''), id::text))
        UPPER(TRIM(op_part_code)) code,
        COALESCE(NULLIF(regexp_replace(total_count::text,'[^0-9.-]','','g'),'')::numeric,0) q
      FROM operation_wise_analysis_report
      WHERE report_period_start='${MONTH}' AND report_period_end='${PE}'
        AND UPPER(TRIM(dealer_code))='${DEALER}'
        AND LOWER(COALESCE(report_type,''))='part'
        AND UPPER(TRIM(op_part_code)) LIKE 'NPNENG%'
      ORDER BY COALESCE(NULLIF(row_hash,''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ) SELECT * FROM d ORDER BY code`)
  console.log(PE, rows, 'sum', rows.reduce((s,r)=>s+Number(r.q),0))
}

await db.end()
