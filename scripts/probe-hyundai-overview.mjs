import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db.ts'

const start = '2026-06-01'
const end = '2026-06-15'

async function timed(label, query) {
  const started = Date.now()
  try {
    const rows = await db.execute(query)
    const count = Array.isArray(rows) ? rows.length : 0
    console.log(`OK ${label}: ${Date.now() - started}ms rows=${count}`)
    return rows
  } catch (error) {
    console.error(`FAIL ${label}: ${Date.now() - started}ms`, error instanceof Error ? error.message : error)
    throw error
  }
}

await timed('hyundai_ro_billing_report count', sql`
  SELECT COUNT(*)::int AS c
  FROM hyundai_ro_billing_report
  WHERE bill_date >= ${start}::date
    AND bill_date < (${end}::date + INTERVAL '1 day')
`)

await timed('hyundai_repair_order_list open', sql`
  SELECT COUNT(*)::int AS c
  FROM hyundai_repair_order_list
  WHERE LOWER(COALESCE(r_o_status, '')) = 'open'
    AND r_o_date >= ${start}::date
    AND r_o_date < (${end}::date + INTERVAL '1 day')
`)

await timed('hyundai overview ro kpi shape', sql`
  WITH raw AS (
    SELECT
      bill_date::date AS report_date,
      COALESCE(NULLIF(bill_no, ''), NULLIF(r_o_no, ''), id::text) AS jc_key,
      COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
      'Others'::text AS service_category,
      COALESCE(NULLIF(regexp_replace(labour_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS labour_amt,
      COALESCE(NULLIF(regexp_replace(part_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS part_amt,
      COALESCE(NULLIF(regexp_replace(total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS total_amt
    FROM hyundai_ro_billing_report
    WHERE bill_date >= ${start}::date
      AND bill_date < (${end}::date + INTERVAL '1 day')
      AND TRUE
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC) AS row_rank
    FROM raw
  ),
  base AS (
    SELECT
      jc_key,
      (ARRAY_AGG(report_date ORDER BY row_rank ASC))[1] AS report_date,
      (ARRAY_AGG(advisor ORDER BY row_rank ASC))[1] AS advisor,
      (ARRAY_AGG(service_category ORDER BY row_rank ASC))[1] AS service_category,
      (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
      (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
      (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt
    FROM ranked
    GROUP BY jc_key
  ),
  enriched AS (
    SELECT *, labour_amt + part_amt AS revenue FROM base
  )
  SELECT
    COUNT(DISTINCT jc_key)::int AS total_jc,
    COALESCE(SUM(revenue), 0)::float AS revenue
  FROM enriched
`)

console.log('done')
