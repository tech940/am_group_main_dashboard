/**
 * Applies migration 0016 — missing analytics indexes on kia_call_logs + kia_lead_followups.
 *
 * The KIA Call & Follow-up Analytics dashboard filters kia_call_logs by started_at and kia_lead_followups
 * by created_at / completed_at, none of which were indexed — so each of the ~4 aggregation queries
 * seq-scanned. These indexes back those range filters (and the call-center recent-calls ORDER BY started_at).
 *
 * Uses CREATE INDEX CONCURRENTLY so it does not lock the live tables. CONCURRENTLY cannot run inside a
 * transaction block, so each statement is issued as its own autocommit query. Idempotent (IF NOT EXISTS).
 *
 * Run:  npx tsx scripts/apply-migration-0016.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const INDEXES: { name: string; ddl: string }[] = [
  { name: 'kia_call_logs_started_at_idx', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_call_logs_started_at_idx ON kia_call_logs (started_at)` },
  { name: 'kia_lead_followups_created_at_idx', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_lead_followups_created_at_idx ON kia_lead_followups (created_at)` },
  { name: 'kia_lead_followups_completed_at_idx', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_lead_followups_completed_at_idx ON kia_lead_followups (completed_at)` },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  // max:1, no transactions — CONCURRENTLY must run in autocommit.
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    for (const idx of INDEXES) {
      const started = Date.now()
      await sql.unsafe(idx.ddl)
      console.log(`[0016] ${idx.name} ensured in ${Date.now() - started}ms`)
    }

    const present = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('kia_call_logs_started_at_idx', 'kia_lead_followups_created_at_idx', 'kia_lead_followups_completed_at_idx')
      ORDER BY indexname`
    console.log('Migration 0016 applied. Present indexes:', present.map((r) => r.indexname).join(', '))
    process.exit(present.length === 3 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0016 failed:', error); process.exit(1) })
