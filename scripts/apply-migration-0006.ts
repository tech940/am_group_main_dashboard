/** Applies migration 0006 — adds the nullable `users.dealers` column. Idempotent. */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql.unsafe('ALTER TABLE users ADD COLUMN IF NOT EXISTS dealers text')
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_name = 'users' and column_name = 'dealers'
      ) as exists`
    console.log(`users.dealers column present = ${exists}`)
    process.exit(exists ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0006 failed:', error); process.exit(1) })
