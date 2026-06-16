import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'
const catExpr = `CASE
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
  ELSE 'Others' END`

const url = await pickDatabaseUrl(postgres, '[extras]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const extras = await db.unsafe(`
  WITH ro_mtd AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key
    FROM ro_billing_report
    WHERE ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  bill_rows AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
      ro_date::date, bill_date::date, work_type, service_type, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE bill_date >= '${MONTH}'::date AND bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  )
  SELECT b.* FROM bill_rows b
  LEFT JOIN ro_mtd r ON r.jc_key = b.jc_key
  WHERE r.jc_key IS NULL
  ORDER BY cat, bill_date, jc_key
`)
console.log('bill rows not matched by ro_mtd jc_key:', extras)

// Try model: intake MTD = ro dedup + bill extras where ro_date < month OR ro_date > export
const model = await db.unsafe(`
  WITH raw AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
      ro_date::date AS ro_date, bill_date::date AS bill_date, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
      AND (
        (ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day'))
        OR (bill_date >= '${MONTH}'::date AND bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
          AND (ro_date IS NULL OR ro_date < '${MONTH}'::date)
          AND ${catExpr} IN ('Paid Service', 'Running Repair', 'Accidental Repair'))
      )
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY COALESCE(ro_date, bill_date) DESC) AS rk FROM raw
  )
  SELECT cat,
    COUNT(*) FILTER (WHERE rk=1 AND (ro_date='${EXPORT}'::date OR (ro_date IS DISTINCT FROM '${EXPORT}'::date AND bill_date='${EXPORT}'::date AND cat IN ('Paid Service','Accidental Repair'))))::int AS today,
    COUNT(*) FILTER (WHERE rk=1)::int AS mtd
  FROM ranked
  WHERE cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY cat ORDER BY cat
`)
console.log('\nmodel with bill extras for ro before month:', model)

await db.end()
