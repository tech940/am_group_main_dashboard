import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { serviceCategoryExpression } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DATE = '2026-06-17'
  const DEALER_CODE = 'JK402'
  
  console.log('=== ro_billing_report entries for 2026-06-17 ===')
  const billingRows = await db.execute(sql`
    SELECT 
      id,
      bill_no,
      ro_no,
      ro_date::text AS ro_date,
      bill_date::text AS bill_date,
      work_type,
      service_type,
      bill_status,
      total_amt,
      ${serviceCategoryExpression('work_type', 'service_type')} AS category
    FROM ro_billing_report
    WHERE 
      (ro_date = ${DATE}::date OR bill_date = ${DATE}::date)
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${DEALER_CODE}
  `)
  console.log(billingRows)

  console.log('\n=== open_ro_yearly entries for 2026-06-17 ===')
  const openRows = await db.execute(sql`
    SELECT 
      id,
      r_o_no,
      ro_date::text AS ro_date,
      work_type,
      service_type,
      status,
      ${serviceCategoryExpression('work_type', 'service_type')} AS category
    FROM open_ro_yearly
    WHERE 
      (ro_date = ${DATE}::date)
      AND UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
  `)
  console.log(openRows)
}

main().catch(console.error)
