import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  const cols = rows(await db.execute(sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'hyundai_insurance_policy_summary'
      AND column_name IN ('policy_issue_date', 'policy_start_date', 'uploaded_at', 'policy_no')`))
  console.log('column types:', cols.map((c) => `${c.column_name}:${c.data_type}`).join(', '))

  const fresh = rows(await db.execute(sql`
    SELECT MAX(uploaded_at)::text AS last_upload, COUNT(*) AS total_rows,
           COUNT(DISTINCT policy_no) AS distinct_policies
    FROM hyundai_insurance_policy_summary`))
  console.log('freshness:', JSON.stringify(fresh[0]))

  // Monthly counts by ISSUE date, deduped one row per policy (latest upload), 2026
  const monthly = rows(await db.execute(sql`
    SELECT to_char(d.policy_issue_date::date, 'YYYY-MM') AS month, COUNT(*) AS policies
    FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text))
        policy_issue_date
      FROM hyundai_insurance_policy_summary
      ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
    ) d
    WHERE d.policy_issue_date IS NOT NULL
      AND d.policy_issue_date::date >= '2026-01-01'
    GROUP BY 1 ORDER BY 1`))
  console.log('\n2026 monthly policy counts (deduped, by policy_issue_date):')
  for (const r of monthly) console.log(` ${r.month}: ${r.policies}`)

  // Same but by policy_start_date for July, and raw rows uploaded during July
  const july = rows(await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text)) policy_start_date
        FROM hyundai_insurance_policy_summary
        ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
      ) d WHERE d.policy_start_date::date BETWEEN '2026-07-01' AND '2026-07-31') AS july_by_start,
      (SELECT COUNT(*) FROM hyundai_insurance_policy_summary
        WHERE uploaded_at >= '2026-07-01' AND uploaded_at < '2026-08-01') AS rows_uploaded_in_july,
      (SELECT MAX(policy_issue_date::date)::text FROM hyundai_insurance_policy_summary) AS max_issue_date`))
  console.log('\njuly by start date / uploads during july / max issue date:', JSON.stringify(july[0]))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
