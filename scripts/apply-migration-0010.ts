/** Applies migration 0010 — adds the `call_agent` role + KIA call-center tables. Idempotent. */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    // Enum value must be added on its own (cannot share a transaction with the table DDL below).
    await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS 'call_agent'`)
    const migration = readFileSync(join(process.cwd(), 'lib', 'db', 'migrations', '0010_add_kia_call_center.sql'), 'utf8')
    await sql.unsafe(migration)

    const [{ has_role }] = await sql<{ has_role: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname='role' AND e.enumlabel='call_agent') AS has_role`
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_name IN ('kia_call_agent_phones', 'kia_call_logs')`
    console.log(`call_agent role = ${has_role}; tables = ${JSON.stringify(tables.map((t) => t.table_name).sort())}`)
    process.exit(has_role && tables.length === 2 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0010 failed:', error); process.exit(1) })
