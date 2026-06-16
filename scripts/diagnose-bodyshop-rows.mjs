import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const EXPORT = '2026-06-15'
const url = await pickDatabaseUrl(postgres, '[search]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

console.log(await db.unsafe(`
  SELECT ro_no, ro_date::date, bill_date::date, work_type, service_type, bill_type
  FROM ro_billing_report
  WHERE UPPER(TRIM(COALESCE(NULLIF(dealer_code,''),NULLIF(main_dealer_code,''))))='JK402'
    AND (ro_date='${EXPORT}'::date OR bill_date='${EXPORT}'::date)
    AND (LOWER(COALESCE(work_type,'')) LIKE '%body%' OR LOWER(COALESCE(service_type,'')) LIKE '%body%'
      OR LOWER(COALESCE(bill_type,'')) LIKE '%body%' OR LOWER(COALESCE(work_type,'')) LIKE '%insur%')`))

await db.end()
