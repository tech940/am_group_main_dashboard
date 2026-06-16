import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[dc]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

console.log('open_ro dealer codes Jun:', await db.unsafe(`
  SELECT UPPER(TRIM(COALESCE(dealer_code,''))) dc, UPPER(TRIM(COALESCE(sale_dealer_code,''))) sdc, COUNT(*)::int n
  FROM open_ro_yearly WHERE ro_date>='2026-06-01' AND ro_date<'2026-06-16'
  GROUP BY 1,2 ORDER BY n DESC LIMIT 20`))

console.log('open accidental Jun not JK402 dealer_code:', await db.unsafe(`
  SELECT r_o_no, dealer_code, sale_dealer_code, ro_date::date
  FROM open_ro_yearly
  WHERE ro_date>='2026-06-01' AND ro_date<'2026-06-16'
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    AND UPPER(TRIM(COALESCE(dealer_code,''))) <> 'JK402'
  LIMIT 10`))

await db.end()
