import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  // Yearly volumes: has ~600/month always been the norm, or did volume decline?
  const yearly = rows(await db.execute(sql`
    SELECT to_char(d.policy_issue_date, 'YYYY') AS year, COUNT(*) AS policies,
           ROUND(COUNT(*) / COUNT(DISTINCT to_char(d.policy_issue_date, 'YYYY-MM'))::numeric) AS avg_per_month
    FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text))
        policy_issue_date::date AS policy_issue_date
      FROM hyundai_insurance_policy_summary
      ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
    ) d
    WHERE d.policy_issue_date IS NOT NULL
    GROUP BY 1 ORDER BY 1`))
  console.log('yearly (deduped):')
  for (const r of yearly) console.log(`  ${r.year}: ${r.policies} (${r.avg_per_month}/mo avg)`)

  // Dealer codes: did a branch vanish from the feed?
  const byDealer = rows(await db.execute(sql`
    SELECT COALESCE(NULLIF(TRIM(dealer_code), ''), '(blank)') AS dealer,
           to_char(d.policy_issue_date, 'YYYY-MM') AS month, COUNT(*) AS n
    FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text))
        policy_issue_date::date AS policy_issue_date, dealer_code
      FROM hyundai_insurance_policy_summary
      ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
    ) d
    WHERE d.policy_issue_date >= '2026-01-01'
    GROUP BY 1, 2 ORDER BY 2, 1`))
  console.log('\n2026 by dealer_code x month:')
  const dealers = [...new Set(byDealer.map((r) => r.dealer))]
  const months = [...new Set(byDealer.map((r) => r.month))].sort()
  for (const dealer of dealers) {
    const line = months.map((m) => {
      const hit = byDealer.find((r) => r.dealer === dealer && r.month === m)
      return `${m.slice(5)}:${hit ? hit.n : 0}`
    }).join(' ')
    console.log(`  ${dealer}: ${line}`)
  }

  // sub_user (branch) coverage: how many distinct branches per month — did some stop?
  const bySub = rows(await db.execute(sql`
    SELECT to_char(d.policy_issue_date, 'YYYY-MM') AS month,
           COUNT(DISTINCT NULLIF(TRIM(sub_user), '')) AS branches, COUNT(*) AS n
    FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text))
        policy_issue_date::date AS policy_issue_date, sub_user
      FROM hyundai_insurance_policy_summary
      ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
    ) d
    WHERE d.policy_issue_date >= '2025-09-01'
    GROUP BY 1 ORDER BY 1`))
  console.log('\ndistinct sub_user branches by month (since Sep 2025):')
  for (const r of bySub) console.log(`  ${r.month}: ${r.branches} branches, ${r.n} policies`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
