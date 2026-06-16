import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'
const catExpr = `CASE
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
  ELSE 'Others' END`

const url = await pickDatabaseUrl(postgres, '[intake-mtd]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const greatestToday = await db.unsafe(`
  SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
    ro_date::date, bill_date::date, ${catExpr} AS cat
  FROM ro_billing_report
  WHERE GREATEST(ro_date::date, bill_date::date) = '${EXPORT}'::date
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
    AND ${catExpr} IN ('Paid Service', 'Accidental Repair')
  ORDER BY cat, jc_key
`)
console.log('greatest(ro,bill)=today paid/accidental:', greatestToday)

const mtdBillSupplement = await db.unsafe(`
  WITH ro_mtd AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  bill_mtd AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE bill_date >= '${MONTH}'::date AND bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  extra AS (
    SELECT b.jc_key, b.cat FROM bill_mtd b
    LEFT JOIN ro_mtd r ON r.jc_key = b.jc_key
    WHERE r.jc_key IS NULL AND b.cat IN ('Paid Service','Running Repair','Accidental Repair')
  )
  SELECT cat, COUNT(*)::int AS extra_mtd FROM extra GROUP BY cat ORDER BY cat
`)
console.log('bill_mtd keys not in ro_mtd:', mtdBillSupplement)

const fullModel = await db.unsafe(`
  WITH ro_base AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
      ro_date::date AS report_date, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  bill_extra AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
      bill_date::date AS report_date, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE bill_date >= '${MONTH}'::date AND bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND (ro_date IS NULL OR ro_date < '${MONTH}'::date OR ro_date > '${EXPORT}'::date)
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
      AND ${catExpr} IN ('Paid Service', 'Accidental Repair')
  ),
  combined AS (
    SELECT jc_key, report_date, cat FROM ro_base
    UNION ALL
    SELECT jc_key, report_date, cat FROM bill_extra
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC) AS rk FROM combined
  )
  SELECT cat,
    COUNT(*) FILTER (WHERE report_date = '${EXPORT}'::date AND rk = 1)::int AS today,
    COUNT(*) FILTER (WHERE rk = 1)::int AS mtd
  FROM ranked
  WHERE cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY cat ORDER BY cat
`)
console.log('ro_base + bill_extra paid/accidental MTD model:', fullModel)

// open supplement today with uploaded_at
const openUploadedToday = await db.unsafe(`
  WITH dealer_keys AS (
    SELECT DISTINCT NULLIF(UPPER(TRIM(COALESCE(rb.vin, ''))), '') AS vin_norm,
      NULLIF(UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))), '') AS reg_norm
    FROM ro_billing_report rb
    WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = '${DEALER}'
      AND ((rb.vin IS NOT NULL AND TRIM(rb.vin) <> '') OR (rb.vehicle_reg_no IS NOT NULL AND TRIM(rb.vehicle_reg_no) <> ''))
  )
  SELECT r_o_no, ro_date::date, uploaded_at::date, work_type, vin, reg_no
  FROM open_ro_yearly
  WHERE uploaded_at::date = '${EXPORT}'::date
    AND LOWER(COALESCE(status, '')) = 'open'
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    AND ((NULLIF(TRIM(vin), '') IS NOT NULL AND UPPER(TRIM(vin)) IN (SELECT vin_norm FROM dealer_keys WHERE vin_norm IS NOT NULL))
      OR (NULLIF(TRIM(reg_no), '') IS NOT NULL AND UPPER(TRIM(reg_no)) IN (SELECT reg_norm FROM dealer_keys WHERE reg_norm IS NOT NULL)))
`)
console.log('open accidental uploaded today:', openUploadedToday)

await db.end()
