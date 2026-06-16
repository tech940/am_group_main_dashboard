import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const url = await pickDatabaseUrl(postgres, '[gate]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

for (const q of [
  `SELECT r_o_no, ro_date::date, r_o_date_time::date AS ro_dt, gate_pass_time::date AS gate, work_type, dealer_code, status
   FROM open_ro_yearly
   WHERE (ro_date='${EXPORT}'::date OR r_o_date_time::date='${EXPORT}'::date OR gate_pass_time::date='${EXPORT}'::date)
     AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
     AND UPPER(TRIM(COALESCE(dealer_code,''))) IN ('${DEALER}','JK402')`,
  `SELECT ro_no, ro_date::date, bill_date::date, work_type FROM ro_billing_report
   WHERE bill_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,''))))='${DEALER}'
     AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')`,
  `SELECT COUNT(*)::int AS n FROM open_ro_yearly
   WHERE ro_date='${EXPORT}'::date AND UPPER(TRIM(COALESCE(dealer_code,'')))='${DEALER}'`,
]) {
  console.log(await db.unsafe(q))
}

await db.end()
