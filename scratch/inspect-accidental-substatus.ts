import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  const DEALER_CODE = 'JK402'
  const EXPORT_DATE = '2026-06-17'

  console.log('=== Open Accidental ROs substatus ===')
  const result = await db.execute(sql`
    SELECT 
      o.r_o_no,
      o.ro_date::text AS ro_date,
      o.status,
      o.new_r_o_status,
      o.ro_sub_status
    FROM open_ro_yearly o
    WHERE LOWER(COALESCE(o.status, '')) = 'open'
      AND o.ro_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
      AND UPPER(TRIM(dealer_code)) = ${DEALER_CODE}
      AND (o.work_type = 'Accidental Repair' OR o.work_type = 'Bodyshop')
      AND NOT EXISTS (
        SELECT 1
        FROM ro_billing_report rb2
        WHERE rb2.bill_date < (${EXPORT_DATE}::date + INTERVAL '1 day')
          AND ${activeBillStatusSql('rb2.')}
          AND UPPER(TRIM(COALESCE(NULLIF(rb2.dealer_code, ''), NULLIF(rb2.main_dealer_code, '')))) = ${DEALER_CODE}
          AND COALESCE(NULLIF(rb2.ro_no, ''), NULLIF(rb2.bill_no, ''), rb2.id::text)
            = COALESCE(NULLIF(o.r_o_no, ''), o.id::text)
      )
  `)
  console.log(result)
}

function activeBillStatusSql(alias = '') {
  return sql`LOWER(TRIM(COALESCE(${sql.raw(`${alias}bill_status`)}::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
}

main().catch(console.error)
