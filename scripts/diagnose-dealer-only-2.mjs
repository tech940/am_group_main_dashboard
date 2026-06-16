import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[diff2]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const rows = await db.unsafe(`
  WITH dealer_keys AS (
    SELECT DISTINCT NULLIF(UPPER(TRIM(COALESCE(rb.vin, ''))), '') AS vin_norm,
      NULLIF(UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))), '') AS reg_norm
    FROM ro_billing_report rb
    WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = 'JK402'
      AND ((rb.vin IS NOT NULL AND TRIM(rb.vin) <> '') OR (rb.vehicle_reg_no IS NOT NULL AND TRIM(rb.vehicle_reg_no) <> ''))
  ),
  vin_rows AS (
    SELECT DISTINCT COALESCE(NULLIF(r_o_no, ''), id::text) jc
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status,''))='open' AND ro_date>='2026-06-01' AND ro_date<'2026-06-16'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      AND ((NULLIF(TRIM(vin),'') IS NOT NULL AND UPPER(TRIM(vin)) IN (SELECT vin_norm FROM dealer_keys WHERE vin_norm IS NOT NULL))
        OR (NULLIF(TRIM(reg_no),'') IS NOT NULL AND UPPER(TRIM(reg_no)) IN (SELECT reg_norm FROM dealer_keys WHERE reg_norm IS NOT NULL)))
  ),
  dealer_rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
      COALESCE(NULLIF(r_o_no, ''), id::text) jc, ro_date::date, vin, reg_no, work_type
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status,''))='open' AND ro_date>='2026-06-01' AND ro_date<'2026-06-16'
      AND UPPER(TRIM(COALESCE(dealer_code,'')))='JK402'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT d.* FROM dealer_rows d WHERE d.jc NOT IN (SELECT jc FROM vin_rows)
`)
console.log('2 dealer-only open accidental:', rows)

const roKeys = await db.unsafe(`
  SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key
  FROM ro_billing_report
  WHERE ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402'
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
`)
const roKeySet = new Set(roKeys.map((r) => r.jc_key))
for (const r of rows) {
  console.log(r.jc, 'supplement_eligible', !roKeySet.has(r.jc), 'ro_date', r.ro_date)
}

await db.end()
