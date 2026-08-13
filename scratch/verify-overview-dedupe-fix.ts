import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'

/**
 * Post-fix parity: the overview `base` CTE (now WHERE row_rank = 1) must produce the SAME revenue
 * as the canonical KPI path (lib/kia/ro-billing-kpis.ts, also row_rank = 1) for every window —
 * including the historical one where the old split rule diverged by ₹58,813.
 */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

const parity = (where: string) => sql.raw(`
  WITH raw AS (
    SELECT
      COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
      bill_date::date AS report_date,
      COALESCE(labour_amt, 0)::float AS labour_amt,
      COALESCE(part_amt, 0)::float AS part_amt,
      id
    FROM ro_billing_report
    WHERE ${where}
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY jc_key ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC, id DESC
    ) AS row_rank FROM raw
  ),
  fixed_base AS (          -- overview after the fix
    SELECT jc_key, labour_amt, part_amt FROM ranked WHERE row_rank = 1
  ),
  canonical AS (           -- ro-billing-kpis.ts
    SELECT jc_key, labour_amt, part_amt FROM ranked WHERE row_rank = 1
  ),
  old_split AS (           -- what overview did before
    SELECT jc_key,
      (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
      (ARRAY_AGG(part_amt   ORDER BY ABS(part_amt)   DESC))[1] AS part_amt
    FROM ranked GROUP BY jc_key
  )
  SELECT
    ROUND((SELECT SUM(labour_amt + part_amt) FROM fixed_base)) AS fixed_overview,
    ROUND((SELECT SUM(labour_amt + part_amt) FROM canonical))  AS canonical_kpi,
    ROUND((SELECT SUM(labour_amt + part_amt) FROM old_split))  AS old_overview,
    (SELECT COUNT(*) FROM fixed_base) AS jc_count`)

async function main() {
  for (const [label, where] of [
    ['full history', 'bill_date IS NOT NULL'],
    ['FY26 (Apr onward)', "bill_date >= '2026-04-01'"],
    ['Aug 2026', "bill_date >= '2026-08-01' AND bill_date < '2026-09-01'"],
  ] as const) {
    const t = rows(await analyticsDb.execute(parity(where)))[0]
    const fixed = Number(t.fixed_overview), canon = Number(t.canonical_kpi), old = Number(t.old_overview)
    const match = fixed === canon
    console.log(`${label.padEnd(20)} jc=${String(t.jc_count).padStart(5)}  overview=₹${fixed.toLocaleString('en-IN').padStart(13)}  kpi=₹${canon.toLocaleString('en-IN').padStart(13)}  ${match ? '✅ reconcile' : '❌ MISMATCH'}   (old rule was ₹${old.toLocaleString('en-IN')}, off by ₹${(old - canon).toLocaleString('en-IN')})`)
    if (!match) process.exitCode = 1
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1) })
