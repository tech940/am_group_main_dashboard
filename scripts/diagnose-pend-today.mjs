import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[pend-today]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

console.log(await db.unsafe(`
  SELECT r_o_no, ro_date::date, work_type, vin, reg_no
  FROM open_ro_yearly
  WHERE LOWER(COALESCE(status,''))='open' AND ro_date='${EXPORT}'::date
    AND UPPER(TRIM(COALESCE(dealer_code,'')))='JK402'
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')`))

console.log('pending mech today dealer:', await db.unsafe(`
  SELECT r_o_no, work_type FROM open_ro_yearly
  WHERE LOWER(COALESCE(status,''))='open' AND ro_date='${EXPORT}'::date
    AND UPPER(TRIM(COALESCE(dealer_code,'')))='JK402'
    AND NOT (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')`))

await db.end()
