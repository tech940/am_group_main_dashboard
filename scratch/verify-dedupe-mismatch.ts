import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'

/**
 * Verify P1-C9: the overview `base` CTE picks labour, parts and total INDEPENDENTLY (max-abs each)
 * while report_date/advisor/category come from the winning row. The canonical KPI path takes the
 * whole winning row. Do they actually disagree, and by how much?
 */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  const r = rows(await analyticsDb.execute(sql`
    WITH raw AS (
      SELECT
        -- EXACT expression from overview/route.ts:271
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        bill_date AS report_date,
        COALESCE(labour_amt, 0)::float AS labour_amt,
        COALESCE(part_amt, 0)::float AS part_amt,
        id
      FROM ro_billing_report
      WHERE bill_date IS NOT NULL
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY jc_key ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC, id DESC
      ) AS row_rank
      FROM raw
    ),
    -- Rule A: the overview 'base' CTE — three independent max-abs picks
    split_rule AS (
      SELECT jc_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt   ORDER BY ABS(part_amt)   DESC))[1] AS part_amt
      FROM ranked GROUP BY jc_key
    ),
    -- Rule B: the canonical KPI path — the whole winning row
    winning_row AS (
      SELECT jc_key, labour_amt, part_amt FROM ranked WHERE row_rank = 1
    ),
    dupes AS (
      SELECT jc_key FROM ranked GROUP BY jc_key HAVING COUNT(*) > 1
    )
    SELECT
      (SELECT COUNT(*) FROM ranked) AS raw_rows,
      (SELECT COUNT(*) FROM winning_row) AS distinct_jcs,
      (SELECT COUNT(*) FROM dupes) AS duplicated_keys,
      (SELECT ROUND(SUM(labour_amt + part_amt)) FROM split_rule)  AS revenue_split_rule,
      (SELECT ROUND(SUM(labour_amt + part_amt)) FROM winning_row) AS revenue_winning_row,
      (SELECT COUNT(*) FROM split_rule s JOIN winning_row w USING (jc_key)
        WHERE s.labour_amt <> w.labour_amt OR s.part_amt <> w.part_amt) AS rows_that_differ`))

  const t = r[0]
  const split = Number(t.revenue_split_rule)
  const winning = Number(t.revenue_winning_row)
  const gap = split - winning
  console.log(`raw rows            : ${t.raw_rows}`)
  console.log(`distinct job cards  : ${t.distinct_jcs}`)
  console.log(`duplicated keys     : ${t.duplicated_keys}`)
  console.log(`rows where rules disagree: ${t.rows_that_differ}`)
  console.log()
  console.log(`revenue — charts   (split max-abs rule) : ₹${split.toLocaleString('en-IN')}`)
  console.log(`revenue — KPI card (whole winning row)  : ₹${winning.toLocaleString('en-IN')}`)
  console.log(`GAP                                     : ₹${gap.toLocaleString('en-IN')}  ${gap === 0 ? '(rules agree)' : '← belongs to no single bill'}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
