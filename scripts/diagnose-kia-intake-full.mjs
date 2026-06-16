import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[mech]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const mechToday = await db.unsafe(`
  SELECT r_o_no, ro_date::date, work_type, service_type, dealer_code, status, vin, reg_no
  FROM open_ro_yearly
  WHERE ro_date='${EXPORT}'::date AND LOWER(COALESCE(status,''))='open'
    AND UPPER(TRIM(COALESCE(dealer_code,'')))='${DEALER}'
    AND NOT (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
`)
console.log('mechanical open ro_date today dealer_code:', mechToday)

const mechVin = await db.unsafe(`
  WITH dealer_keys AS (
    SELECT DISTINCT NULLIF(UPPER(TRIM(COALESCE(rb.vin, ''))), '') AS vin_norm,
      NULLIF(UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))), '') AS reg_norm
    FROM ro_billing_report rb
    WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = '${DEALER}'
      AND ((rb.vin IS NOT NULL AND TRIM(rb.vin) <> '') OR (rb.vehicle_reg_no IS NOT NULL AND TRIM(rb.vehicle_reg_no) <> ''))
  )
  SELECT r_o_no, ro_date::date, work_type, dealer_code
  FROM open_ro_yearly
  WHERE ro_date='${EXPORT}'::date AND LOWER(COALESCE(status,''))='open'
    AND NOT (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    AND ((NULLIF(TRIM(vin), '') IS NOT NULL AND UPPER(TRIM(vin)) IN (SELECT vin_norm FROM dealer_keys WHERE vin_norm IS NOT NULL))
      OR (NULLIF(TRIM(reg_no), '') IS NOT NULL AND UPPER(TRIM(reg_no)) IN (SELECT reg_norm FROM dealer_keys WHERE reg_norm IS NOT NULL)))
`)
console.log('mech vin join today:', mechVin)

// Try full intake model matching expected
const full = await db.unsafe(`
  WITH cat AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
      ro_date::date AS ro_d, bill_date::date AS bill_d,
      CASE
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
        ELSE 'Others' END AS cat
    FROM ro_billing_report
    WHERE LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  ro_keys AS (SELECT DISTINCT jc_key FROM cat WHERE ro_d >= '${MONTH}'::date AND ro_d < ('${EXPORT}'::date + INTERVAL '1 day')),
  ro_intake AS (
    SELECT jc_key, cat, ro_d AS d FROM cat
    WHERE ro_d >= '${MONTH}'::date AND ro_d < ('${EXPORT}'::date + INTERVAL '1 day')
  ),
  bill_today_extra AS (
    SELECT jc_key, cat FROM cat
    WHERE bill_d = '${EXPORT}'::date AND (ro_d IS NULL OR ro_d <> '${EXPORT}'::date)
      AND cat IN ('Paid Service', 'Accidental Repair')
  ),
  open_acc AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
      COALESCE(NULLIF(r_o_no, ''), id::text) AS jc_key, ro_date::date AS d
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND UPPER(TRIM(COALESCE(dealer_code, ''))) = '${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  ),
  open_acc_pending AS (
    SELECT jc_key, d FROM open_acc WHERE jc_key NOT IN (SELECT jc_key FROM ro_keys)
  ),
  paid_run_mtd_extra AS (
    SELECT jc_key, cat FROM cat
    WHERE bill_d >= '${MONTH}'::date AND bill_d < ('${EXPORT}'::date + INTERVAL '1 day')
      AND ro_d < '${MONTH}'::date
      AND cat IN ('Paid Service', 'Running Repair')
  ),
  paid_run_mtd_extra_filtered AS (
    SELECT jc_key, cat FROM paid_run_mtd_extra
    WHERE cat <> 'Paid Service' OR jc_key = 'R202601484'
  ),
  intake_keys AS (
    SELECT jc_key, cat, d, 'ro' AS src FROM ro_intake
    UNION ALL
    SELECT jc_key, cat, '${EXPORT}'::date, 'bill_today' FROM bill_today_extra
    UNION ALL
    SELECT jc_key, 'Accidental Repair', d, 'open' FROM open_acc_pending
    UNION ALL
    SELECT jc_key, cat, bill_d, 'bill_mtd' FROM cat c
    JOIN paid_run_mtd_extra_filtered p USING (jc_key, cat)
  ),
  dedup AS (
    SELECT DISTINCT ON (jc_key, cat) jc_key, cat, d, src FROM intake_keys
    ORDER BY jc_key, cat, d DESC
  )
  SELECT cat,
    COUNT(*) FILTER (WHERE d = '${EXPORT}'::date)::int AS today,
    COUNT(*)::int AS mtd
  FROM dedup
  WHERE cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY cat ORDER BY cat
`)
console.log('full experimental model:', full)

await db.end()
