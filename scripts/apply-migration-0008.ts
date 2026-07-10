/** Applies migration 0008 — adds stock-presence columns to kia_vehicle_allocations. Idempotent. */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const migration = readFileSync(
    join(process.cwd(), 'lib', 'db', 'migrations', '0008_add_allocation_stock_missing.sql'),
    'utf8',
  )
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql.unsafe(migration)
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'kia_vehicle_allocations'
        and column_name in ('stock_last_seen_at', 'stock_missing_at', 'stock_status')`
    const present = cols.map((c) => c.column_name).sort()
    console.log(`kia_vehicle_allocations stock columns present = ${JSON.stringify(present)}`)
    process.exit(present.length === 3 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0008 failed:', error); process.exit(1) })
