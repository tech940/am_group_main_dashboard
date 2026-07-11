/** Applies migration 0011 — adds the kia_lead_followups table (lead follow-up pipeline). Idempotent. */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    const migration = readFileSync(join(process.cwd(), 'lib', 'db', 'migrations', '0011_add_kia_lead_followups.sql'), 'utf8')
    await sql.unsafe(migration)

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'kia_lead_followups'`
    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'kia_lead_followups'`
    const phoneLike = cols.filter((c) => /phone|mobile/i.test(c.column_name))
    console.log(`kia_lead_followups present = ${tables.length === 1}; columns = ${cols.length}; phone-like columns = ${JSON.stringify(phoneLike.map((c) => c.column_name))}`)
    process.exit(tables.length === 1 && phoneLike.length === 0 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0011 failed:', error); process.exit(1) })
