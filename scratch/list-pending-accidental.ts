import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { serviceCategoryExpression } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== Open Accidental ROs as of June 17, 2026 ===')
  const result = await db.execute(sql`
    SELECT DISTINCT ON (COALESCE(NULLIF(o.r_o_no, ''), o.id::text))
      o.r_o_no,
      o.ro_date::text AS ro_date,
      o.work_type,
      o.service_type,
      o.status
    FROM open_ro_yearly o
    WHERE LOWER(COALESCE(o.status, '')) = 'open'
      AND o.ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
      AND UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
      AND NOT EXISTS (
        SELECT 1
        FROM ro_billing_report rb2
        WHERE rb2.bill_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
          AND ${activeBillStatusSql('rb2.')}
          AND UPPER(TRIM(COALESCE(NULLIF(rb2.dealer_code, ''), NULLIF(rb2.main_dealer_code, '')))) = ${DEALER_CODE}
          AND COALESCE(NULLIF(rb2.ro_no, ''), NULLIF(rb2.bill_no, ''), rb2.id::text)
            = COALESCE(NULLIF(o.r_o_no, ''), o.id::text)
      )
    ORDER BY COALESCE(NULLIF(o.r_o_no, ''), o.id::text), o.uploaded_at DESC NULLS LAST, o.id DESC
  `)
  console.log(`Total: ${result.length}`)
  console.log(result)
}

function activeBillStatusSql(alias = '') {
  return sql`LOWER(TRIM(COALESCE(${sql.raw(`${alias}bill_status`)}::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
}

main().catch(console.error)
