import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== Detailed Fields for Open Mechanical ROs ===')
  const result = await db.execute(sql`
    SELECT 
      o.r_o_no,
      o.ro_date::text AS ro_date,
      o.status,
      o.new_r_o_status,
      o.ro_sub_status,
      o.closing_date_time::text AS closing_date_time,
      o.gate_pass_time,
      o.cancel_date::text AS cancel_date
    FROM open_ro_yearly o
    WHERE LOWER(COALESCE(o.status, '')) = 'open'
      AND o.ro_date >= '2026-06-01'::date
      AND o.ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
      AND UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
      AND (o.work_type <> 'Accidental Repair' AND o.work_type <> 'Bodyshop')
  `)
  console.log(result)
}

main().catch(console.error)
