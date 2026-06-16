import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[pending-model]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const r603 = await db.unsafe(`
  SELECT 'billing' src, ro_no, ro_date::date, bill_date::date, work_type, bill_status FROM ro_billing_report WHERE ro_no='R202601603' OR bill_no IN (SELECT bill_no FROM ro_billing_report WHERE ro_no='R202601603')
  UNION ALL
  SELECT 'open', r_o_no, ro_date::date, NULL, work_type, status FROM open_ro_yearly WHERE r_o_no='R202601603'
`)
console.log('R202601603:', r603)

// Model: acc mtd = ro_billing accidental ro_date mtd dedup + pending accidental mtd (reference style)
const pendingAcc = await db.unsafe(`
  WITH dealer_keys AS (
    SELECT DISTINCT NULLIF(UPPER(TRIM(COALESCE(rb.vin, ''))), '') AS vin_norm,
      NULLIF(UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))), '') AS reg_norm
    FROM ro_billing_report rb
    WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = '${DEALER}'
      AND ((rb.vin IS NOT NULL AND TRIM(rb.vin) <> '') OR (rb.vehicle_reg_no IS NOT NULL AND TRIM(rb.vehicle_reg_no) <> ''))
  ),
  active AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
      ro_date::date AS report_date,
      CASE WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair' ELSE 'Mechanical' END AS cat
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND ((NULLIF(TRIM(vin), '') IS NOT NULL AND UPPER(TRIM(vin)) IN (SELECT vin_norm FROM dealer_keys WHERE vin_norm IS NOT NULL))
        OR (NULLIF(TRIM(reg_no), '') IS NOT NULL AND UPPER(TRIM(reg_no)) IN (SELECT reg_norm FROM dealer_keys WHERE reg_norm IS NOT NULL)))
    ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT cat,
    COUNT(*) FILTER (WHERE report_date='${EXPORT}'::date)::int AS today,
    COUNT(*)::int AS mtd
  FROM active GROUP BY cat
`)
console.log('pending by vin (current):', pendingAcc)

const pendingDealer = await db.unsafe(`
  WITH active AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
      ro_date::date AS report_date,
      CASE WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair' ELSE 'Mechanical' END AS cat
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND UPPER(TRIM(COALESCE(dealer_code, ''))) = '${DEALER}'
    ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT cat,
    COUNT(*) FILTER (WHERE report_date='${EXPORT}'::date)::int AS today,
    COUNT(*)::int AS mtd
  FROM active GROUP BY cat
`)
console.log('pending by dealer_code:', pendingDealer)

// 17 + 12 = 29 if pending accidental mtd = 12
const billingAccMtd = 17
console.log('17 + pending12 =', billingAccMtd + 12)

await db.end()
