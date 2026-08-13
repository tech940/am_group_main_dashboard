import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'

/** Verify P1-C2: does `OR dealer_code IS NULL` double-count add-on rows across both branches? */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  for (const [table, col] of [
    ['kia_ew_report', 'dealer_code'],
    ['kia_mcp_report', 'dealer_code'],
    ['kia_rsa_report', 'dealer_workshop_code'],
  ] as const) {
    try {
      const r = rows(await analyticsDb.execute(sql.raw(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE ${col} IS NULL) AS null_code,
               COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(${col},''))) = 'JK402') AS jk402,
               COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(${col},''))) = 'JK501') AS jk501
        FROM ${table}`)))
      const t = r[0]
      const nullPct = Math.round((Number(t.null_code) / Math.max(1, Number(t.total))) * 100)
      // What each branch REPORTS today (with the OR ... IS NULL escape) vs the truth
      const reportedJammu = Number(t.jk402) + Number(t.null_code)
      const reportedUdh = Number(t.jk501) + Number(t.null_code)
      console.log(`${table}:`)
      console.log(`  total=${t.total}  null ${col}=${t.null_code} (${nullPct}%)  real JK402=${t.jk402}  real JK501=${t.jk501}`)
      console.log(`  → filter shows Jammu ${reportedJammu} / Udhampur ${reportedUdh}  = ${reportedJammu + reportedUdh} vs true total ${t.total}`)
      if (Number(t.jk501) > 0) {
        console.log(`  → Udhampur inflation: ${(reportedUdh / Number(t.jk501)).toFixed(1)}x`)
      }
    } catch (e) {
      const cause = (e as { cause?: { message?: string } })?.cause
      console.log(`${table}: SKIP — ${cause?.message ?? (e as Error).message.slice(0, 70)}`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
