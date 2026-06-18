import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { serviceCategoryExpression } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DEALER_CODE = 'JK402'
  const MONTH_START = '2026-06-01'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== PURE RO DATE INTAKE (Billed + Open) ===')
  const result = await db.execute(sql`
    WITH combined AS (
      -- Billed ROs
      SELECT 
        COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
        ro_date::date AS ro_date,
        ${serviceCategoryExpression('work_type', 'service_type')} AS category
      FROM ro_billing_report
      WHERE 
        ro_date >= ${MONTH_START}::date
        AND ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${DEALER_CODE}
      
      UNION
      
      -- Open ROs
      SELECT 
        COALESCE(NULLIF(r_o_no, ''), id::text) AS jc_key,
        ro_date::date AS ro_date,
        ${serviceCategoryExpression('work_type', 'service_type')} AS category
      FROM open_ro_yearly
      WHERE 
        ro_date >= ${MONTH_START}::date
        AND ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
        AND LOWER(COALESCE(status, '')) = 'open'
        AND UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
    ),
    dedup AS (
      SELECT DISTINCT ON (jc_key)
        jc_key,
        ro_date,
        category
      FROM combined
      ORDER BY jc_key, ro_date ASC
    )
    SELECT 
      category,
      COUNT(*) FILTER (WHERE ro_date = ${EXPORT_DATE}::date)::int AS today,
      COUNT(*)::int AS mtd
    FROM dedup
    WHERE category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
    GROUP BY category
  `)
  console.log(result)
}

main().catch(console.error)
