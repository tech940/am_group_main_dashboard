import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  // Are new policies arriving with NULL dates (a parse failure), rather than not arriving at all?
  const nulls = rows(await db.execute(sql`
    SELECT to_char(uploaded_at, 'YYYY-MM') AS upload_month,
           COUNT(*) AS total_rows,
           COUNT(*) FILTER (WHERE policy_issue_date IS NULL) AS null_issue,
           COUNT(DISTINCT policy_no) FILTER (WHERE policy_issue_date IS NULL) AS null_issue_policies
    FROM hyundai_insurance_policy_summary
    WHERE uploaded_at >= '2026-06-01'
    GROUP BY 1 ORDER BY 1`))
  console.log('rows by upload month, with NULL issue-date counts:')
  for (const r of nulls) console.log(`  ${r.upload_month}: rows=${r.total_rows} null_issue=${r.null_issue} (${r.null_issue_policies} policies)`)

  // Policies first seen (min uploaded_at) since 01 Jul — genuinely NEW policy numbers entering the
  // table — and what issue dates they carry.
  const firstSeen = rows(await db.execute(sql`
    SELECT to_char(f.issue, 'YYYY-MM') AS issue_month, COUNT(*) AS n
    FROM (
      SELECT policy_no, MIN(uploaded_at) AS first_up,
             MAX(policy_issue_date::date) AS issue
      FROM hyundai_insurance_policy_summary
      GROUP BY policy_no
    ) f
    WHERE f.first_up >= '2026-07-01'
    GROUP BY 1 ORDER BY 1`))
  console.log('\npolicy numbers FIRST SEEN since 01 Jul, by their issue month:')
  for (const r of firstSeen) console.log(`  ${r.issue_month ?? '(null)'}: ${r.n}`)

  const totalNew = rows(await db.execute(sql`
    SELECT COUNT(*) AS n FROM (
      SELECT policy_no, MIN(uploaded_at) AS first_up
      FROM hyundai_insurance_policy_summary GROUP BY policy_no
    ) f WHERE f.first_up >= '2026-07-01'`))
  console.log('total genuinely-new policy numbers since 01 Jul:', totalNew[0]?.n)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
