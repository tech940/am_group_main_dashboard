import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[mech-pend]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const rows = await db.unsafe(`
  SELECT r_o_no, ro_date::date, work_type, service_type
  FROM (
    SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text)) o.*
    FROM open_ro_yearly o
    WHERE LOWER(COALESCE(o.status, '')) = 'open'
      AND o.ro_date >= '2026-06-01' AND o.ro_date < '2026-06-16'
      AND UPPER(TRIM(COALESCE(o.dealer_code, ''))) = 'JK402'
      AND NOT (
        LOWER(CONCAT_WS(' ', o.work_type, o.service_type)) LIKE '%accident%'
        OR LOWER(CONCAT_WS(' ', o.work_type, o.service_type)) LIKE '%bodyshop%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM ro_billing_report rb2
        WHERE UPPER(TRIM(COALESCE(NULLIF(rb2.dealer_code, ''), NULLIF(rb2.main_dealer_code, '')))) = 'JK402'
          AND rb2.bill_date >= '2026-06-01' AND rb2.bill_date < '2026-06-16'
          AND LOWER(TRIM(COALESCE(rb2.bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
          AND NOT (
            LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%accident%'
            OR LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%bodyshop%'
          )
          AND COALESCE(NULLIF(rb2.ro_no, ''), NULLIF(rb2.bill_no, ''), rb2.id::text)
            = COALESCE(NULLIF(o.r_o_no, ''), o.id::text)
      )
    ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  ) x`)
console.log('mech pending rows:', rows)

await db.end()
