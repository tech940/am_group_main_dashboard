import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  for (const table of ['am_platinum_insurance_policy_summary', 'kia_insurance']) {
    const dateCol = table === 'kia_insurance' ? 'create_date' : 'policy_issue_date'
    const monthly = rows(await db.execute(sql.raw(`
      SELECT to_char(${dateCol}::date, 'YYYY-MM') AS month, COUNT(DISTINCT COALESCE(NULLIF(TRIM(${table === 'kia_insurance' ? 'policyno' : 'policy_no'}), ''), id::text)) AS policies
      FROM ${table}
      WHERE ${dateCol} IS NOT NULL AND ${dateCol}::date >= '2026-04-01'
      GROUP BY 1 ORDER BY 1`)))
    const fresh = rows(await db.execute(sql.raw(`SELECT MAX(uploaded_at)::text AS up FROM ${table}`)))
    console.log(`\n=== ${table} (last upload ${fresh[0]?.up}) ===`)
    for (const r of monthly) console.log(`  ${r.month}: ${r.policies}`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
