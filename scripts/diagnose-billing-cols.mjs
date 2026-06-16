import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const url = await pickDatabaseUrl(postgres, '[cols2]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const cols = await db.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='ro_billing_report' AND column_name ILIKE '%insur%' OR table_name='ro_billing_report' AND column_name ILIKE '%body%' ORDER BY column_name`)
console.log('billing insurance/body cols:', cols)

const todayBilling = await db.unsafe(`
  SELECT ro_no, work_type, service_type, insurance_company_name, surveyor_name, bill_type
  FROM ro_billing_report
  WHERE ro_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,''))))='${DEALER}'`)

console.log('all billing ro today:', todayBilling)

// Test accidental today = bill today acc + open supplement today (dealer_code, ro_keys by bill_date)
const accTodayModel = await db.unsafe(`
  WITH ro_keys AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key
    FROM ro_billing_report
    WHERE bill_date >= '2026-06-01' AND bill_date < '2026-06-16'
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  ),
  bill_today AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key
    FROM ro_billing_report
    WHERE bill_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, ''))))='${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  ),
  open_today AS (
    SELECT DISTINCT COALESCE(NULLIF(r_o_no, ''), id::text) AS jc_key
    FROM open_ro_yearly
    WHERE ro_date='${EXPORT}'::date AND LOWER(COALESCE(status,''))='open'
      AND UPPER(TRIM(COALESCE(dealer_code,'')))='${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      AND COALESCE(NULLIF(r_o_no, ''), id::text) NOT IN (SELECT jc_key FROM ro_keys)
  )
  SELECT (SELECT COUNT(*)::int FROM bill_today) bill_n, (SELECT COUNT(*)::int FROM open_today) open_n,
    (SELECT COUNT(*)::int FROM (SELECT jc_key FROM bill_today UNION SELECT jc_key FROM open_today) u) total
`)
console.log('acc today bill+open dealer ro_keys bill:', accTodayModel)

await db.end()
