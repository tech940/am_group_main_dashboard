import 'dotenv/config'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db/index.ts'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT_DATE = '2026-06-15'
const MONTH_START = '2026-06-01'

const intakeSql = `
  WITH raw AS (
    SELECT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
      ro_date::date AS report_date,
      CASE
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
        ELSE 'Others'
      END AS service_category,
      uploaded_at, id
    FROM ro_billing_report
    WHERE ro_date >= '${MONTH_START}'::date AND ro_date < ('${EXPORT_DATE}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC, uploaded_at DESC NULLS LAST, id DESC) AS row_rank FROM raw),
  dedup AS (SELECT * FROM ranked WHERE row_rank = 1)
  SELECT service_category, COUNT(*)::int AS mtd
  FROM dedup WHERE service_category IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY service_category ORDER BY 1
`

const url = await pickDatabaseUrl(postgres, '[compare]')
const pg = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
const pgRows = await pg.unsafe(intakeSql)
await pg.end()

const drizzleRows = await db.execute(sql.raw(intakeSql))

console.log('pickDatabaseUrl intake:', pgRows)
console.log('lib/db drizzle intake:', drizzleRows)

process.exit(0)
