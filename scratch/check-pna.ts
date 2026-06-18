import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== Checking PNA in open_ro_yearly ===')
  const result = await db.execute(sql`
    SELECT r_o_no, ro_date::text, work_type, new_r_o_status, ro_sub_status, delay_reason, ro_remaks
    FROM open_ro_yearly
    WHERE UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
      AND ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
      AND (
        LOWER(ro_sub_status) LIKE '%pna%'
        OR LOWER(delay_reason) LIKE '%pna%'
        OR LOWER(ro_remaks) LIKE '%pna%'
        OR LOWER(ro_sub_status) LIKE '%parts not available%'
        OR LOWER(delay_reason) LIKE '%parts not available%'
      )
  `)
  console.log(result)
}

main().catch(console.error)
