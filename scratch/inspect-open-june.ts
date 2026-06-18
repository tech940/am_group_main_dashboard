import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { serviceCategoryExpression } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== All Open June ROs ===')
  const result = await db.execute(sql`
    SELECT 
      o.r_o_no,
      o.ro_date::text AS ro_date,
      o.work_type,
      o.service_type,
      o.status,
      o.reg_no,
      ${serviceCategoryExpression('o.work_type', 'o.service_type')} AS category
    FROM open_ro_yearly o
    WHERE LOWER(COALESCE(o.status, '')) = 'open'
      AND o.ro_date >= '2026-06-01'::date
      AND o.ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
      AND UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
      ORDER BY o.ro_date ASC
  `)
  console.log(result)
}

main().catch(console.error)
