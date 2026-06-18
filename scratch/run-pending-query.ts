import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { serviceCategoryExpression, openRoDealerFilter, roBillingDealerFilter } from '../lib/kia/service-dashboard-metrics'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'
  const MONTH_START = '2026-06-01'

  const result = await db.execute(sql`
    WITH pending AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(o.r_o_no, ''), o.id::text))
        o.r_o_no,
        o.ro_date::date AS ro_date,
        ${serviceCategoryExpression('o.work_type', 'o.service_type')} AS service_category,
        o.work_type,
        o.service_type
      FROM open_ro_yearly o
      WHERE LOWER(COALESCE(o.status, '')) = 'open'
        AND o.ro_date >= ${MONTH_START}::date
        AND o.ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
        ${openRoDealerFilter(DEALER_CODE, 'o')}
        AND NOT EXISTS (
          SELECT 1
          FROM ro_billing_report rb2
          WHERE rb2.bill_date >= ${MONTH_START}::date
            AND rb2.bill_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
            AND ${activeBillStatusSql('rb2.')}
            ${roBillingDealerFilter(DEALER_CODE, 'rb2.')}
            AND COALESCE(NULLIF(rb2.ro_no, ''), NULLIF(rb2.bill_no, ''), rb2.id::text)
              = COALESCE(NULLIF(o.r_o_no, ''), o.id::text)
            AND (
              (
                ${serviceCategoryExpression('o.work_type', 'o.service_type')} = 'Accidental Repair'
                AND (
                  LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%accident%'
                  OR LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%bodyshop%'
                )
              )
              OR (
                ${serviceCategoryExpression('o.work_type', 'o.service_type')} <> 'Accidental Repair'
                AND NOT (
                  LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%accident%'
                  OR LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%bodyshop%'
                )
              )
            )
        )
      ORDER BY COALESCE(NULLIF(o.r_o_no, ''), o.id::text), o.uploaded_at DESC NULLS LAST, o.id DESC
    )
    SELECT *
    FROM pending
  `)
  console.log(result)
}

function activeBillStatusSql(alias = '') {
  return sql`LOWER(TRIM(COALESCE(${sql.raw(`${alias}bill_status`)}::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
}

main().catch(console.error)
