/**
 * Applies migration 0005 — adds the `service_general_manager` value to the `role` enum.
 *
 * Run as a single, non-transactional statement because `ALTER TYPE ... ADD VALUE` cannot
 * run inside a transaction block. Idempotent (`IF NOT EXISTS`).
 *
 * Run:  npx tsx scripts/apply-migration-0005.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')

  // max:1, no prepared statements — keep it a plain one-shot connection.
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    const before = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'role' order by e.enumsortorder`
    const had = before.some((r) => r.enumlabel === 'service_general_manager')
    console.log(`Before: role has ${before.length} values; service_general_manager present = ${had}`)

    if (!had) {
      // ALTER TYPE ADD VALUE must not run inside a transaction — postgres.js sends this
      // as its own simple statement, which is exactly what we need.
      await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS 'service_general_manager'`)
      console.log('Applied: ALTER TYPE role ADD VALUE service_general_manager')
    } else {
      console.log('Skipped: value already present.')
    }

    const after = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'role' order by e.enumsortorder`
    const present = after.some((r) => r.enumlabel === 'service_general_manager')
    console.log(`After: service_general_manager present = ${present}`)
    process.exit(present ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error('Migration 0005 failed:', error)
  process.exit(1)
})
