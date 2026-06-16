import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[pend12]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const queries = {
  openAccNoBillJun_dealer: `
    SELECT COUNT(DISTINCT COALESCE(NULLIF(r_o_no, ''), id::text))::int AS n
    FROM open_ro_yearly o
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      AND ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND UPPER(TRIM(COALESCE(o.dealer_code, ''))) = '${DEALER}'
      AND NOT EXISTS (
        SELECT 1 FROM ro_billing_report rb2
        WHERE UPPER(TRIM(COALESCE(NULLIF(rb2.dealer_code, ''), NULLIF(rb2.main_dealer_code, '')))) = '${DEALER}'
          AND rb2.bill_date >= '${MONTH}' AND rb2.bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(rb2.bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
          AND (LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%bodyshop%')
          AND COALESCE(NULLIF(rb2.ro_no, ''), NULLIF(rb2.bill_no, ''), rb2.id::text) = COALESCE(NULLIF(o.r_o_no, ''), o.id::text)
      )`,
  openAccNoBillJun_vin: `
    SELECT COUNT(DISTINCT COALESCE(NULLIF(r_o_no, ''), id::text))::int AS n
    FROM open_ro_yearly o
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      AND ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND EXISTS (SELECT 1 FROM ro_billing_report rb WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = '${DEALER}'
        AND ((NULLIF(TRIM(o.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(o.vin)))
          OR (NULLIF(TRIM(o.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(o.reg_no)))))
      AND NOT EXISTS (
        SELECT 1 FROM ro_billing_report rb2
        WHERE UPPER(TRIM(COALESCE(NULLIF(rb2.dealer_code, ''), NULLIF(rb2.main_dealer_code, '')))) = '${DEALER}'
          AND rb2.bill_date >= '${MONTH}' AND rb2.bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(rb2.bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
          AND (LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%bodyshop%')
          AND ((NULLIF(TRIM(o.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb2.vin, ''))) = UPPER(TRIM(o.vin)))
            OR (NULLIF(TRIM(o.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb2.vehicle_reg_no, ''))) = UPPER(TRIM(o.reg_no))))
      )`,
  openAccNoRoBillJun_dealer: `
    SELECT COUNT(DISTINCT COALESCE(NULLIF(r_o_no, ''), id::text))::int AS n
    FROM open_ro_yearly o
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      AND ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND UPPER(TRIM(COALESCE(o.dealer_code, ''))) = '${DEALER}'
      AND NOT EXISTS (
        SELECT 1 FROM ro_billing_report rb2
        WHERE UPPER(TRIM(COALESCE(NULLIF(rb2.dealer_code, ''), NULLIF(rb2.main_dealer_code, '')))) = '${DEALER}'
          AND rb2.ro_date >= '${MONTH}' AND rb2.ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(rb2.bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
          AND (LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', rb2.work_type, service_type)) LIKE '%bodyshop%')
          AND COALESCE(NULLIF(rb2.ro_no, ''), NULLIF(rb2.bill_no, ''), rb2.id::text) = COALESCE(NULLIF(o.r_o_no, ''), o.id::text)
      )`,
  supplement_ro_keys_match_ro_no: `
    WITH ro_keys AS (
      SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key
      FROM ro_billing_report
      WHERE ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
        AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    ),
    open_acc AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
        COALESCE(NULLIF(r_o_no, ''), id::text) AS jc_key, ro_date::date AS d
      FROM open_ro_yearly
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
        AND UPPER(TRIM(COALESCE(dealer_code, ''))) = '${DEALER}'
        AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*) FILTER (WHERE jc_key NOT IN (SELECT jc_key FROM ro_keys))::int AS mtd,
      COUNT(*) FILTER (WHERE jc_key NOT IN (SELECT jc_key FROM ro_keys) AND d='${EXPORT}'::date)::int AS today
    FROM open_acc`,
}

for (const [name, q] of Object.entries(queries)) {
  console.log(name, await db.unsafe(q))
}

await db.end()
