import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[bcd]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

for (const pe of ['2026-06-13', '2026-06-16']) {
  const rows = await db.unsafe(`
    WITH d AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash,''), id::text))
        op_part_code, COALESCE(NULLIF(regexp_replace(total_amt::text,'[^0-9.-]','','g'),'')::numeric,0) amt
      FROM operation_wise_analysis_report
      WHERE report_period_start='${MONTH}' AND report_period_end='${pe}'
        AND UPPER(TRIM(dealer_code))='${DEALER}'
        AND UPPER(op_part_code) LIKE 'A10VAWHEELBC%'
      ORDER BY COALESCE(NULLIF(row_hash,''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ) SELECT * FROM d ORDER BY op_part_code`)
  const sum = rows.reduce((s,r)=>s+Number(r.amt),0)
  const no5 = rows.filter(r=>r.op_part_code!=='A10VAWHEELBC5').reduce((s,r)=>s+Number(r.amt),0)
  console.log(pe, rows, 'sum', sum, 'noBC5', no5)
}

// target 25417 combos
console.log('26102-637', 26102.06-637.05)
console.log('28510-3093', 28510.16-3093)

await db.end()
