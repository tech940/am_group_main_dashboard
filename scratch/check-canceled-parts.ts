import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'
  const MONTH_START = '2026-06-01'

  const result = await db.execute(sql`
    SELECT 
      ro_no,
      bill_no,
      bill_date::text AS bill_date,
      work_type,
      service_type,
      bill_status,
      part_amt,
      labour_amt
    FROM ro_billing_report
    WHERE bill_date >= ${MONTH_START}::date
      AND bill_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${DEALER_CODE}
  `)
  console.log(result)
}

main().catch(console.error)
