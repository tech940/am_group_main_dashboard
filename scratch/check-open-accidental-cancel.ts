import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== Checking cancel/close fields for open Accidental ROs ===')
  const result = await db.execute(sql`
    SELECT 
      o.r_o_no,
      o.ro_date::text AS ro_date,
      o.closing_date_time::text AS closing_date_time,
      o.cancel_date::text AS cancel_date,
      o.status
    FROM open_ro_yearly o
    WHERE LOWER(COALESCE(o.status, '')) = 'open'
      AND o.ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
      AND UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
      AND (o.work_type = 'Accidental Repair' OR o.work_type = 'Bodyshop')
      AND (o.closing_date_time IS NOT NULL OR o.cancel_date IS NOT NULL)
  `)
  console.log(result)
}

main().catch(console.error)
