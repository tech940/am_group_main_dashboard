import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const EXPORT = '2026-06-15'
const url = await pickDatabaseUrl(postgres, '[null-dc]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

console.log(await db.unsafe(`
  SELECT r_o_no, dealer_code, ro_date::date, work_type, status
  FROM open_ro_yearly
  WHERE ro_date='${EXPORT}'::date
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')`))

console.log('vin semi vs dealer diff count:', await db.unsafe(`
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
    SELECT DISTINCT COALESCE(NULLIF(r_o_no, ''), id::text) jc
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status,''))='open' AND ro_date>='2026-06-01' AND ro_date<'2026-06-16'
      AND UPPER(TRIM(COALESCE(dealer_code,'')))='JK402'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  )
  SELECT (SELECT COUNT(*)::int FROM dealer_rows WHERE jc NOT IN (SELECT jc FROM vin_rows)) only_dealer,
         (SELECT COUNT(*)::int FROM vin_rows WHERE jc NOT IN (SELECT jc FROM dealer_rows)) only_vin`))

await db.end()
