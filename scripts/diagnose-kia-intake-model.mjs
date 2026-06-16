import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'

const url = await pickDatabaseUrl(postgres, '[acc-model]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const models = await db.unsafe(`
  WITH cat AS (
    SELECT *, CASE
      WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
      WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
      WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
      WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
      ELSE 'Others' END AS service_category
    FROM ro_billing_report
    WHERE LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  dealer_keys AS (
    SELECT DISTINCT NULLIF(UPPER(TRIM(COALESCE(rb.vin, ''))), '') AS vin_norm,
      NULLIF(UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))), '') AS reg_norm
    FROM ro_billing_report rb
    WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = '${DEALER}'
      AND ((rb.vin IS NOT NULL AND TRIM(rb.vin) <> '') OR (rb.vehicle_reg_no IS NOT NULL AND TRIM(rb.vehicle_reg_no) <> ''))
  ),
  ro_intake AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key, ro_date::date AS d, service_category
    FROM cat WHERE ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
  ),
  bill_intake AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key, bill_date::date AS d, service_category, ro_date::date AS ro_d
    FROM cat WHERE bill_date >= '${MONTH}'::date AND bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
  ),
  open_sup AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
      COALESCE(NULLIF(r_o_no, ''), id::text) AS jc_key, ro_date::date AS d
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      AND ((NULLIF(TRIM(vin), '') IS NOT NULL AND UPPER(TRIM(vin)) IN (SELECT vin_norm FROM dealer_keys WHERE vin_norm IS NOT NULL))
        OR (NULLIF(TRIM(reg_no), '') IS NOT NULL AND UPPER(TRIM(reg_no)) IN (SELECT reg_norm FROM dealer_keys WHERE reg_norm IS NOT NULL)))
    ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  ),
  ro_keys AS (
    SELECT DISTINCT jc_key FROM ro_intake WHERE service_category = 'Accidental Repair'
  ),
  open_pending AS (
    SELECT jc_key, d FROM open_sup WHERE jc_key NOT IN (SELECT jc_key FROM ro_keys)
  )
  SELECT 'ro_intake_acc_mtd' AS label, COUNT(*)::int AS n FROM (SELECT DISTINCT jc_key FROM ro_intake WHERE service_category='Accidental Repair') x
  UNION ALL SELECT 'open_pending_mtd', COUNT(*)::int FROM open_pending
  UNION ALL SELECT 'open_pending_today', COUNT(*) FILTER (WHERE d='${EXPORT}'::date)::int FROM open_pending
  UNION ALL SELECT 'bill_acc_today_ro_not', COUNT(DISTINCT jc_key)::int FROM bill_intake WHERE service_category='Accidental Repair' AND d='${EXPORT}'::date AND (ro_d IS NULL OR ro_d <> '${EXPORT}'::date)
  UNION ALL SELECT 'bill_paid_today_ro_not', COUNT(DISTINCT jc_key)::int FROM bill_intake WHERE service_category='Paid Service' AND d='${EXPORT}'::date AND (ro_d IS NULL OR ro_d <> '${EXPORT}'::date)
  UNION ALL SELECT 'ro_paid_today', COUNT(DISTINCT jc_key)::int FROM ro_intake WHERE service_category='Paid Service' AND d='${EXPORT}'::date
  UNION ALL SELECT 'ro_acc_today', COUNT(DISTINCT jc_key)::int FROM ro_intake WHERE service_category='Accidental Repair' AND d='${EXPORT}'::date
  UNION ALL SELECT 'ro_run_mtd', COUNT(DISTINCT jc_key)::int FROM ro_intake WHERE service_category='Running Repair'
  UNION ALL SELECT 'bill_run_ro_before_month', COUNT(DISTINCT jc_key)::int FROM bill_intake WHERE service_category='Running Repair' AND ro_d < '${MONTH}'::date
  UNION ALL SELECT 'bill_paid_ro_before_month', COUNT(DISTINCT jc_key)::int FROM bill_intake WHERE service_category='Paid Service' AND ro_d < '${MONTH}'::date
`)
console.log(models)

// Target accidental today = ro_acc_today + bill_acc_today_ro_not + open_pending_today
const roAccToday = models.find(r => r.label === 'ro_acc_today')?.n ?? 0
const billAccToday = models.find(r => r.label === 'bill_acc_today_ro_not')?.n ?? 0
const openAccToday = models.find(r => r.label === 'open_pending_today')?.n ?? 0
console.log('acc today sum', roAccToday + billAccToday + openAccToday)

const roIntakeMtd = models.find(r => r.label === 'ro_intake_acc_mtd')?.n ?? 0
const openPendingMtd = models.find(r => r.label === 'open_pending_mtd')?.n ?? 0
console.log('acc mtd ro+open', roIntakeMtd + openPendingMtd)

await db.end()
