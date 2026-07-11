/** Applies migration 0012 — adds the read-only `ca` (Chartered Accountant) role. Idempotent. */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    // Enum value must be added on its own — it cannot share a transaction with other DDL.
    await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS 'ca'`)

    const [{ has_role }] = await sql<{ has_role: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'role' AND e.enumlabel = 'ca'
      ) AS has_role`
    console.log(`ca role present = ${has_role}`)
    process.exit(has_role ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0012 failed:', error); process.exit(1) })
