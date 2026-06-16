import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const EXPORT = '2026-06-15'
const url = await pickDatabaseUrl(postgres, '[acc2]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const rows = await db.unsafe(`
  SELECT ro_no, bill_no, dealer_code, main_dealer_code, ro_date::date, bill_date::date, work_type, service_type, bill_status
  FROM ro_billing_report
  WHERE bill_date='${EXPORT}'::date
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
`)
console.log('all accidental bill today:', rows)

const openTodayDealer = await db.unsafe(`
  SELECT r_o_no, dealer_code, sale_dealer_code, ro_date::date, work_type, status
  FROM open_ro_yearly
  WHERE ro_date='${EXPORT}'::date
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
`)
console.log('open accidental ro today all dealers:', openTodayDealer)

await db.end()
