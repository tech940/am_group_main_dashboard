import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { serviceCategoryExpression } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== All Open ROs as of June 17, 2026 (No date limit on ro_date) ===')
  const result = await db.execute(sql`
    WITH pending AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(o.r_o_no, ''), o.id::text))
        o.ro_date::date AS ro_date,
        ${serviceCategoryExpression('o.work_type', 'o.service_type')} AS service_category,
        o.r_o_no
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
    )
    SELECT
      service_category,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE ro_date = ${EXPORT_DATE}::date)::int AS today
    FROM pending
    GROUP BY service_category
  `)
  console.log(result)
}

function activeBillStatusSql(alias = '') {
  return sql`LOWER(TRIM(COALESCE(${sql.raw(`${alias}bill_status`)}::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
}

main().catch(console.error)
