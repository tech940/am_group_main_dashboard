import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[dealer-open]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const byDealerCode = await db.unsafe(`
  SELECT COUNT(*) FILTER (WHERE ro_date='${EXPORT}'::date)::int AS acc_today,
    COUNT(*)::int AS acc_mtd
  FROM open_ro_yearly
  WHERE LOWER(COALESCE(status,''))='open'
    AND ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
    AND UPPER(TRIM(COALESCE(dealer_code,''))) = '${DEALER}'
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
`)
console.log('open accidental by dealer_code:', byDealerCode)

const todayRows = await db.unsafe(`
  SELECT r_o_no, ro_date::date, work_type, dealer_code, status, vin, reg_no
  FROM open_ro_yearly
  WHERE ro_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(dealer_code,'')))='${DEALER}'
  ORDER BY work_type
`)
console.log('all open ro dealer JK402 ro_date today:', todayRows)

const accBillTodayAll = await db.unsafe(`
  SELECT COALESCE(NULLIF(ro_no,''),NULLIF(bill_no,''),id::text) jc_key, ro_date::date, bill_date::date, work_type
  FROM ro_billing_report
  WHERE bill_date='${EXPORT}'::date
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,''))))='${DEALER}'
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
`)
console.log('acc bill today:', accBillTodayAll)

// Combined model with dealer_code open filter
const combined = await db.unsafe(`
  WITH ro_today AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no,''),NULLIF(bill_no,''),id::text) jc_key, 'ro' src
    FROM ro_billing_report
    WHERE ro_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,''))))='${DEALER}'
      AND LOWER(TRIM(COALESCE(bill_status::text,''))) NOT IN ('cancel','cancelled','canceled')
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  ),
  bill_today AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no,''),NULLIF(bill_no,''),id::text) jc_key, 'bill' src
    FROM ro_billing_report
    WHERE bill_date='${EXPORT}'::date AND (ro_date IS NULL OR ro_date <> '${EXPORT}'::date)
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,''))))='${DEALER}'
      AND LOWER(TRIM(COALESCE(bill_status::text,''))) NOT IN ('cancel','cancelled','canceled')
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  ),
  open_today AS (
    SELECT DISTINCT COALESCE(NULLIF(r_o_no,''),id::text) jc_key, 'open' src
    FROM open_ro_yearly
    WHERE ro_date='${EXPORT}'::date AND LOWER(COALESCE(status,''))='open'
      AND UPPER(TRIM(COALESCE(dealer_code,'')))='${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  )
  SELECT src, COUNT(*)::int n FROM (
    SELECT jc_key, src FROM ro_today
    UNION ALL SELECT jc_key, src FROM bill_today
    UNION ALL SELECT jc_key, src FROM open_today
  ) u GROUP BY src
`)
console.log('acc today components by dealer_code open:', combined)

await db.end()
