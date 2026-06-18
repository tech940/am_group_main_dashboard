import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'
  const MONTH_START = '2026-06-01'

  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT bill_date)::int AS days
    FROM ro_billing_report
    WHERE bill_date >= ${MONTH_START}::date
      AND bill_date <= ${EXPORT_DATE}::date
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${DEALER_CODE}
  `)
  console.log('Distinct billing days:', result[0]?.days)

  const resultRo = await db.execute(sql`
    SELECT COUNT(DISTINCT ro_date)::int AS days
    FROM ro_billing_report
    WHERE ro_date >= ${MONTH_START}::date
      AND ro_date <= ${EXPORT_DATE}::date
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${DEALER_CODE}
  `)
  console.log('Distinct ro_date days:', resultRo[0]?.days)
}

main().catch(console.error)
