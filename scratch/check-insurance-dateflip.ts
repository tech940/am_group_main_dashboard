import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  // Signature of a DD/MM <-> MM/DD swap: dates whose day would be > 12 cannot be mis-parsed as a
  // month, so after a flip the affected window has ONLY days <= 12.
  const dayDist = rows(await db.execute(sql`
    SELECT to_char(d.policy_issue_date, 'YYYY-MM') AS month,
      COUNT(*) FILTER (WHERE EXTRACT(DAY FROM d.policy_issue_date) <= 12) AS day_le_12,
      COUNT(*) FILTER (WHERE EXTRACT(DAY FROM d.policy_issue_date) > 12) AS day_gt_12
    FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text))
        policy_issue_date::date AS policy_issue_date
      FROM hyundai_insurance_policy_summary
      ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
    ) d
    WHERE d.policy_issue_date >= '2026-01-01'
    GROUP BY 1 ORDER BY 1`))
  console.log('day-of-month distribution by issue month (deduped):')
  for (const r of dayDist) console.log(`  ${r.month}: day<=12 ${r.day_le_12} | day>12 ${r.day_gt_12}`)

  // What do recently-uploaded rows carry as their issue dates?
  const recent = rows(await db.execute(sql`
    SELECT to_char(policy_issue_date::date, 'YYYY-MM') AS issue_month, COUNT(*) AS n
    FROM hyundai_insurance_policy_summary
    WHERE uploaded_at >= '2026-08-01'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`))
  console.log('\nissue-month distribution of rows UPLOADED since 01 Aug:')
  for (const r of recent) console.log(`  ${r.issue_month}: ${r.n}`)

  // Sample fresh rows: do issue/start dates look sane relative to each other?
  const sample = rows(await db.execute(sql`
    SELECT policy_no, policy_issue_date::text AS issue, policy_start_date::text AS start, uploaded_at::text AS up
    FROM hyundai_insurance_policy_summary
    WHERE uploaded_at >= '2026-08-01' AND policy_issue_date >= '2026-07-01'
    ORDER BY uploaded_at DESC LIMIT 8`))
  console.log('\nsample rows uploaded since Aug with issue >= 01 Jul:')
  for (const r of sample) console.log(`  ${String(r.policy_no).slice(0, 28)} issue=${r.issue} start=${r.start}`)

  // How many distinct policies EVER appeared with a July start vs issue, regardless of dedupe
  const rawJuly = rows(await db.execute(sql`
    SELECT
      COUNT(DISTINCT policy_no) FILTER (WHERE policy_issue_date::date BETWEEN '2026-07-01' AND '2026-07-31') AS issue_july,
      COUNT(DISTINCT policy_no) FILTER (WHERE policy_start_date::date BETWEEN '2026-07-01' AND '2026-07-31') AS start_july
    FROM hyundai_insurance_policy_summary`))
  console.log('\nraw (pre-dedupe) distinct policies with July dates:', JSON.stringify(rawJuly[0]))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
