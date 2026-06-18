import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { serviceCategoryExpression } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'
  const MONTH_START = '2026-06-01'

  const result = await db.execute(sql`
    WITH raw AS (
      SELECT
        COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
        ${serviceCategoryExpression('work_type', 'service_type')} AS service_category,
        COALESCE(part_amt, 0)::float AS part_amt,
        COALESCE(labour_amt, 0)::float AS labour_amt
      FROM ro_billing_report
      WHERE bill_date >= ${MONTH_START}::date
        AND bill_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${DEALER_CODE}
    ),
    dedup AS (
      SELECT DISTINCT ON (jc_key)
        service_category,
        part_amt,
        labour_amt
      FROM raw
      ORDER BY jc_key, ABS(labour_amt + part_amt) DESC
    )
    SELECT
      service_category,
      SUM(part_amt) AS raw_sum_parts,
      SUM(labour_amt) AS raw_sum_labour
    FROM dedup
    GROUP BY service_category
  `)
  console.log(result)
}

main().catch(console.error)
