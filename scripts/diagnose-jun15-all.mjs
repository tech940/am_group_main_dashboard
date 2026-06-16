import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const url = await pickDatabaseUrl(postgres, '[jun15]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

console.log('open JK402 ro_date today:', await db.unsafe(`
  SELECT r_o_no, work_type, service_type, status FROM open_ro_yearly
  WHERE ro_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(dealer_code,'')))='${DEALER}'`))

console.log('billing JK402 ro_date today others:', await db.unsafe(`
  SELECT ro_no, work_type, service_type FROM ro_billing_report
  WHERE ro_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,''))))='${DEALER}'
    AND NOT (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%'
      OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%'
      OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type,'') ~* '^[0-9]+K$')`))

// accidental today model variants
const variants = await db.unsafe(`
  SELECT 'bill_today_acc' label, COUNT(DISTINCT COALESCE(NULLIF(ro_no,''),NULLIF(bill_no,''),id::text))::int n
  FROM ro_billing_report WHERE bill_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,''))))='${DEALER}'
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  UNION ALL
  SELECT 'open_today_acc_dealer', COUNT(DISTINCT COALESCE(NULLIF(r_o_no,''),id::text))::int
  FROM open_ro_yearly WHERE ro_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(dealer_code,'')))='${DEALER}'
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  UNION ALL
  SELECT 'union_distinct', COUNT(*)::int FROM (
    SELECT COALESCE(NULLIF(ro_no,''),NULLIF(bill_no,''),id::text) k FROM ro_billing_report WHERE bill_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,''))))='${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    UNION
    SELECT COALESCE(NULLIF(r_o_no,''),id::text) FROM open_ro_yearly WHERE ro_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(dealer_code,'')))='${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  ) u
`)
console.log(variants)

await db.end()
