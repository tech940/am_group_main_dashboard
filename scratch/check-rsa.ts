import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const EXPORT_DATE = '2026-06-17'
  const MONTH_START = '2026-06-01'
  const DEALER_CODE = 'JK402'

  console.log('=== RSA records in June ===')
  const result = await db.execute(sql`
    SELECT 
      id,
      invoice_no,
      invoice_date::text AS invoice_date,
      dealer_workshop_code,
      vin_chasis_no,
      policy_name
    FROM rsa_report
    WHERE invoice_date::date >= ${MONTH_START}::date
      AND invoice_date::date < (${EXPORT_DATE}::date + INTERVAL '2 day') -- check up to June 18 too
    ORDER BY invoice_date ASC
  `)
  console.log(`Total: ${result.length}`)
  console.log(result)
}

main().catch(console.error)
