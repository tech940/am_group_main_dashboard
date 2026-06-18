import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== open_ro_yearly status values ===')
  const result = await db.execute(sql`
    SELECT status, COUNT(*)
    FROM open_ro_yearly
    WHERE UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
      AND ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
    GROUP BY status
  `)
  console.log(result)
}

main().catch(console.error)
