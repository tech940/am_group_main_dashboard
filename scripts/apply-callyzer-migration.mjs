// Applies lib/db/migrations/0025_add_callyzer_calls.sql (idempotent).
//   node scripts/apply-callyzer-migration.mjs
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'

const file = path.join(process.cwd(), 'lib/db/migrations/0025_add_callyzer_calls.sql')
const ddl = fs.readFileSync(file, 'utf8')

// Session mode (5432) — DDL cannot run through the transaction pooler on 6543.
const url = (process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '').replace(':6543', ':5432')
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

const sql = postgres(url, { prepare: false, ssl: 'require', max: 1 })
try {
  await sql.unsafe(ddl)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM callyzer_calls`
  const [state] = await sql`SELECT * FROM callyzer_sync_state WHERE id = 1`
  console.log('migration applied. callyzer_calls rows:', n)
  console.log('sync state:', JSON.stringify(state))
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
