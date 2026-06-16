import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = process.argv[2] || null
const END = process.argv[3] || new Date().toISOString().slice(0, 10)
const START = END.slice(0, 8) + '01'

const url = await pickDatabaseUrl(postgres, '[td-api]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const dealerFilter = DEALER
  ? `AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'`
  : ''

const statusFilter = `LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`

for (const d of [END, START]) {
  const rows = await db.unsafe(`
    SELECT COUNT(*)::int AS rows,
           COUNT(DISTINCT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text))::int AS load
    FROM ro_billing_report
    WHERE bill_date = '${END}'::date
      AND ${statusFilter}
      ${dealerFilter}
  `)
  console.log('TD direct query', { dealer: DEALER || 'ALL', end: END, ...rows[0] })
}

const byStatus = await db.unsafe(`
  SELECT COALESCE(bill_status::text, 'null') AS status, COUNT(*)::int AS c
  FROM ro_billing_report
  WHERE bill_date = '${END}'::date ${dealerFilter}
  GROUP BY 1 ORDER BY 2 DESC
`)
console.log('bill_status breakdown on', END, byStatus)

const byDealer = await db.unsafe(`
  SELECT UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) AS dealer,
         COUNT(DISTINCT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text))::int AS load
  FROM ro_billing_report
  WHERE bill_date = '${END}'::date AND ${statusFilter}
  GROUP BY 1 ORDER BY 2 DESC
`)
console.log('dealers on', END, byDealer)

const aggregate = await db.unsafe(`
  WITH base AS (
    SELECT
      COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
      COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
      bill_date::date AS bill_date
    FROM ro_billing_report
    WHERE bill_date >= '${START}'::date
      AND bill_date < ('${END}'::date + INTERVAL '1 day')
      AND ${statusFilter}
      ${dealerFilter}
  ),
  parent_dedup AS (
    SELECT work_type, bill_key, bill_date
    FROM base
    GROUP BY work_type, bill_key, bill_date
  )
  SELECT
    COUNT(DISTINCT bill_key) FILTER (WHERE bill_date = '${END}'::date)::int AS td_cy_load,
    COUNT(DISTINCT bill_key) FILTER (WHERE bill_date >= '${START}'::date AND bill_date <= '${END}'::date)::int AS mtd_cy_load
  FROM parent_dedup
`)
console.log('work-type aggregate', { dealer: DEALER || 'ALL', ...aggregate[0] })

await db.end()
