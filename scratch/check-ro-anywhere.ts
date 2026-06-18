import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('=== Checking R202601729 in ro_billing_report (Any dealer/status/date) ===')
  const result = await db.execute(sql`
    SELECT id, ro_no, bill_no, bill_date::text, dealer_code, main_dealer_code, bill_status
    FROM ro_billing_report
    WHERE ro_no = 'R202601729' OR bill_no = 'R202601729'
  `)
  console.log(result)

  console.log('=== Checking R202601729 in open_ro_yearly (Any dealer/status/date) ===')
  const openResult = await db.execute(sql`
    SELECT id, r_o_no, ro_date::text, status, dealer_code, dealer_name
    FROM open_ro_yearly
    WHERE r_o_no = 'R202601729'
  `)
  console.log(openResult)
}

main().catch(console.error)
