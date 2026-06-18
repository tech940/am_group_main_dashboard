import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { rsaDealerFilter } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'
  const MONTH_START = '2026-06-01'

  const result = await db.execute(sql`
    WITH dedup AS (
      SELECT DISTINCT ON (
        COALESCE(NULLIF(TRIM(invoice_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin_chasis_no), ''), NULLIF(TRIM(policy_name), ''), invoice_date::text), id::text)
      )
        invoice_date::date AS report_date,
        invoice_no,
        id
      FROM rsa_report
      WHERE invoice_date::date >= ${MONTH_START}::date
        AND invoice_date::date < (${EXPORT_DATE}::date + INTERVAL '1 day')
        ${rsaDealerFilter(DEALER_CODE)}
      ORDER BY COALESCE(NULLIF(TRIM(invoice_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin_chasis_no), ''), NULLIF(TRIM(policy_name), ''), invoice_date::text), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT id, invoice_no, report_date::text FROM dedup
  `)
  console.log('Count:', result.length)
  console.log(result)
}

main().catch(console.error)
