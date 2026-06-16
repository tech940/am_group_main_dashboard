import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db.ts'

const start = '2026-06-01'
const end = '2026-06-16'

function numericText(column) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

const roSql = sql`
  WITH raw AS (
    SELECT
      bill_date::date AS report_date,
      COALESCE(NULLIF(bill_no, ''), NULLIF(r_o_no, ''), id::text) AS jc_key,
      COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
      'Others'::text AS service_category,
      ${numericText(sql.raw('labour_amt'))} AS labour_amt,
      ${numericText(sql.raw('part_amt'))} AS part_amt,
      ${numericText(sql.raw('total_amt'))} AS total_amt
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
`

const openSql = sql`
  WITH active AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
      COALESCE(NULLIF(r_o_no, ''), id::text) AS ro_key,
      r_o_date::date AS ro_date,
      svc_adv AS service_adv,
      work_type,
      work_type AS service_type,
      r_o_status AS status,
      NULL::date AS promise_date,
      uploaded_at
    FROM hyundai_repair_order_list
    WHERE LOWER(COALESCE(r_o_status, '')) = 'open'
      AND r_o_date >= ${start}::date
      AND r_o_date < (${end}::date + INTERVAL '1 day')
    ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  ),
  enriched AS (
    SELECT *, GREATEST((CURRENT_DATE - ro_date)::int, 0) AS aging_days,
      CASE WHEN (CURRENT_DATE - ro_date)::int <= 4 THEN '0-4D' WHEN (CURRENT_DATE - ro_date)::int <= 7 THEN '5-7D' WHEN (CURRENT_DATE - ro_date)::int <= 15 THEN '8-15D' ELSE '>15D' END AS aging_bucket,
      'On Track'::text AS delay_status,
      'Others'::text AS service_category
    FROM active
  )
`

async function timed(label, fn) {
  const started = Date.now()
  try {
    await fn()
    console.log(`OK ${label}: ${Date.now() - started}ms`)
  } catch (error) {
    console.error(`FAIL ${label}: ${Date.now() - started}ms`, error instanceof Error ? error.message : error)
  }
}

console.log('Running summary-shaped parallel batch...')
const batchStart = Date.now()
await Promise.all([
  timed('ro kpi', () => db.execute(sql`${roSql} SELECT COUNT(DISTINCT jc_key)::int AS total_jc, COALESCE(SUM(revenue),0)::float AS revenue FROM enriched`)),
  timed('open kpi', () => db.execute(sql`${openSql} SELECT COUNT(*)::int AS total_open_ro FROM enriched`)),
  timed('ew dedup', () => db.execute(sql`
    WITH dedup AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(certi_no), ''), id::text))
        id
      FROM hyundai_ew_report
      WHERE reg_date >= ${start}::date
        AND reg_date < (${end}::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
      ORDER BY COALESCE(NULLIF(TRIM(certi_no), ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*)::int AS count FROM dedup
  `)),
  timed('workshop fallback', () => db.execute(sql`
    WITH raw AS (
      SELECT COALESCE(NULLIF(bill_no, ''), NULLIF(r_o_no, ''), id::text) AS jc_key,
        bill_date::date AS report_date,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${start}::date AND bill_date < (${end}::date + INTERVAL '1 day')
    ),
    dedup AS (
      SELECT jc_key,
        (ARRAY_AGG(report_date ORDER BY report_date DESC))[1] AS report_date,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM raw GROUP BY jc_key
    )
    SELECT COUNT(*)::int AS total_jc, COALESCE(SUM(labour_amt),0)::float AS labour FROM dedup
  `)),
  timed('complaints kpi', () => db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text)) *
      FROM hyundai_call_center_complaints
      WHERE complaint_date IS NOT NULL
      ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ),
    enriched AS (
      SELECT complaint_no, complaint_date, 'Closed'::text AS status_group, 0::int AS resolution_days
      FROM latest
      WHERE complaint_date >= ${start}::date AND complaint_date < (${end}::date + INTERVAL '1 day')
    )
    SELECT COUNT(*)::int AS total FROM enriched
  `)),
])
console.log(`Batch total: ${Date.now() - batchStart}ms`)
