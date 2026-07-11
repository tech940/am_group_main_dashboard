/** Applies migration 0009 — creates the kia_sales_targets table (+ unique index). Idempotent. */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const migration = readFileSync(
    join(process.cwd(), 'lib', 'db', 'migrations', '0009_add_kia_sales_targets.sql'),
    'utf8',
  )
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql.unsafe(migration)
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.tables where table_name = 'kia_sales_targets'
      ) as exists`
    console.log(`kia_sales_targets table present = ${exists}`)
    process.exit(exists ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0009 failed:', error); process.exit(1) })
