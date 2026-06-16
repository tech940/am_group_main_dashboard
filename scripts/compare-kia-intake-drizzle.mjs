import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db.ts'

const monthStart = '2026-06-01'
const exportDate = '2026-06-15'
const dealerFilter = sql.raw(`AND (UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), ''))) IN ('JK402') OR UPPER(TRIM(COALESCE(NULLIF(main_dealer_code, ''), ''))) IN ('JK402'))`)

function serviceCategoryExpression(workTypeColumn, serviceTypeColumn) {
  return sql`CASE
    WHEN LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%accident%'
      OR LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%bodyshop%'
      THEN 'Accidental Repair'
    WHEN LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%running%'
      THEN 'Running Repair'
    WHEN LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%free%'
      THEN 'Free Service'
    WHEN LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%paid%'
      OR COALESCE(${sql.raw(serviceTypeColumn)}, '') ~* '^[0-9]+K$'
      THEN 'Paid Service'
    ELSE COALESCE(NULLIF(${sql.raw(workTypeColumn)}, ''), NULLIF(${sql.raw(serviceTypeColumn)}, ''), 'Others')
  END`
}

function activeBillStatusSql() {
  return sql`LOWER(TRIM(COALESCE(${sql.raw('bill_status')}::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
}

const withExpr = await db.execute(sql`
  WITH raw AS (
    SELECT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
      ${serviceCategoryExpression('work_type', 'service_type')} AS service_category
    FROM ro_billing_report
    WHERE ro_date >= ${monthStart}::date AND ro_date < (${exportDate}::date + INTERVAL '1 day')
      AND ${activeBillStatusSql()}
      ${dealerFilter}
  ),
  ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY ro_date DESC) rk FROM raw),
  dedup AS (SELECT * FROM ranked WHERE rk = 1)
  SELECT service_category, COUNT(*)::int AS mtd FROM dedup
  WHERE service_category IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY service_category ORDER BY 1
`)

const withSimple = await db.execute(sql.raw(`
  WITH raw AS (
    SELECT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
      CASE
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
        ELSE 'Others'
      END AS service_category
    FROM ro_billing_report
    WHERE ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND (UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402')
  ),
  ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY ro_date DESC) rk FROM raw),
  dedup AS (SELECT * FROM ranked WHERE rk = 1)
  SELECT service_category, COUNT(*)::int AS mtd FROM dedup
  WHERE service_category IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY service_category ORDER BY 1
`))

console.log('serviceCategoryExpression:', withExpr)
console.log('simple ELSE Others:', withSimple)
process.exit(0)
