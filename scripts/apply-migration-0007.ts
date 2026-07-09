/** Applies migration 0007 — creates the `kia_callback_requests` table (+ indexes). Idempotent. */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const migration = readFileSync(
    join(process.cwd(), 'lib', 'db', 'migrations', '0007_add_kia_callback_requests.sql'),
    'utf8',
  )
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql.unsafe(migration)
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_name = 'kia_callback_requests'
      ) as exists`
    console.log(`kia_callback_requests table present = ${exists}`)
    process.exit(exists ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0007 failed:', error); process.exit(1) })
