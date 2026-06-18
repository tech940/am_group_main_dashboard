import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== Running Repair Open ROs details ===')
  const result = await db.execute(sql`
    SELECT id, r_o_no, ro_date::text, status, work_type, service_type
    FROM open_ro_yearly
    WHERE UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
      AND r_o_no = 'R202601729'
  `)
  console.log(result)
  
  console.log('=== Checking if R202601729 is in ro_billing_report ===')
  const billed = await db.execute(sql`
    SELECT id, bill_no, ro_no, bill_date::text, bill_status
    FROM ro_billing_report
    WHERE ro_no = 'R202601729' OR bill_no = 'R202601729'
  `)
  console.log(billed)
}

main().catch(console.error)
