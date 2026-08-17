/**
 * Applies migration 0035 — adds kia_vehicle_allocations.payment_window_hours and creates the
 * kia_payment_window_requests table (+ indexes). Idempotent; safe to re-run.
 *
 * Run:  npx tsx scripts/apply-migration-0035.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const migration = readFileSync(
    join(process.cwd(), 'lib', 'db', 'migrations', '0035_add_kia_payment_window_requests.sql'),
    'utf8',
  )
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql.unsafe(migration)

    const [{ exists: tableExists }] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_name = 'kia_payment_window_requests'
      ) as exists`

    const [{ exists: columnExists }] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_name = 'kia_vehicle_allocations' and column_name = 'payment_window_hours'
      ) as exists`

    const indexes = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'kia_payment_window_requests'
      order by indexname`

    // NULL everywhere is the CORRECT post-migration state — the column is deliberately not
    // backfilled, so every existing allocation keeps falling back to the policy default.
    const [{ count: nonNull }] = await sql<{ count: number }[]>`
      select count(*)::int as count from kia_vehicle_allocations
      where payment_window_hours is not null`

    console.log(`payment_window_hours column present = ${columnExists}`)
    console.log(`kia_payment_window_requests table present = ${tableExists}`)
    console.log(`indexes: ${indexes.map((i) => i.indexname).join(', ') || '(none)'}`)
    console.log(`allocations with an explicit window = ${nonNull} (expected 0 on first run)`)

    const ok = tableExists && columnExists
      && indexes.some((i) => i.indexname === 'kia_payment_window_requests_one_pending_idx')
    process.exit(ok ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0035 failed:', error); process.exit(1) })
