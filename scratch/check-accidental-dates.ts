import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { serviceCategoryExpression } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DEALER_CODE = 'JK402'
  const MONTH_START = '2026-06-01'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== Billed Accidental ROs with ro_date in June ===')
  const billedAccidental = await db.execute(sql`
    SELECT 
      ro_no,
      ro_date::text AS ro_date,
      bill_date::text AS bill_date,
      total_amt
    FROM ro_billing_report
    WHERE 
      ro_date >= ${MONTH_START}::date
      AND ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
      AND ${serviceCategoryExpression('work_type', 'service_type')} = 'Accidental Repair'
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${DEALER_CODE}
  `)
  console.log(`Count: ${billedAccidental.length}`)
  console.log(billedAccidental)

  console.log('\n=== Open Accidental ROs with ro_date in June ===')
  const openAccidental = await db.execute(sql`
    SELECT 
      r_o_no,
      ro_date::text AS ro_date,
      status
    FROM open_ro_yearly
    WHERE 
      ro_date >= ${MONTH_START}::date
      AND ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
      AND ${serviceCategoryExpression('work_type', 'service_type')} = 'Accidental Repair'
      AND LOWER(COALESCE(status, '')) = 'open'
      AND UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
  `)
  console.log(`Count: ${openAccidental.length}`)
  console.log(openAccidental)
}

main().catch(console.error)
