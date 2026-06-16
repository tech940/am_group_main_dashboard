import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = process.argv[2] || 'JK402'
const END = process.argv[3] || '2026-06-16'
const START = END.slice(0, 8) + '01'
const LY_START = `${Number(END.slice(0, 4)) - 1}${END.slice(4, 7)}-01`
const LY_END = `${Number(END.slice(0, 4)) - 1}${END.slice(4)}`

const url = await pickDatabaseUrl(postgres, '[td-pipeline]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const dealerFilter = `AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'`
const statusFilter = `LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`

const rows = await db.unsafe(`
  WITH base AS (
    SELECT
      COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
      COALESCE(NULLIF(service_type, ''), 'Unspecified') AS service_type,
      COALESCE(NULLIF(technician, ''), 'Unspecified') AS technician,
      COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
      bill_date::date AS bill_date,
      COALESCE(labour_amt, 0)::numeric AS labour_amt,
      COALESCE(part_amt, 0)::numeric AS part_amt
    FROM ro_billing_report
    WHERE bill_date >= '${LY_START}'::date
      AND bill_date < ('${END}'::date + INTERVAL '1 day')
      AND ${statusFilter}
      ${dealerFilter}
  ),
  parent_dedup AS (
    SELECT 'parent'::text AS aggregate_level, work_type, NULL::text AS service_type, NULL::text AS technician,
      bill_key, bill_date,
      (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
      (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
    FROM base GROUP BY work_type, bill_key, bill_date
  ),
  aggregate_rows AS (SELECT * FROM parent_dedup)
  SELECT work_type,
    COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN '${END}'::date AND '${END}'::date)::int AS td_cy_load,
    COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN '${START}'::date AND '${END}'::date)::int AS mtd_cy_load
  FROM aggregate_rows
  GROUP BY work_type
  ORDER BY mtd_cy_load DESC
`)

let grandTd = 0
let grandMtd = 0
for (const row of rows) {
  console.log(row.work_type, 'TD', row.td_cy_load, 'MTD', row.mtd_cy_load)
  grandTd += row.td_cy_load
  grandMtd += row.mtd_cy_load
}
console.log('Grand Total (sum of work types - approximate)', { td: grandTd, mtd: grandMtd })

await db.end()
