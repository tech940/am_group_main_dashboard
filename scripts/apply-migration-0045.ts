/**
 * Applies migration 0045 — the Bank Sanctions register + history tables.
 *
 * `psql` is not installed on this machine; the `postgres` driver is already a dependency.
 * DDL must not run through the :6543 transaction pooler, so the URL is rewritten to the session
 * port, mirroring lib/db/index.ts. Idempotent — re-running is safe.
 *
 * Run:  npx tsx scripts/apply-migration-0045.ts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import postgres from 'postgres'

const MIGRATION = 'lib/db/migrations/0045_add_bank_sanctions.sql'

function sessionModeUrl(raw: string): string {
  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

async function main() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is not set. Is .env present?')

  const url = sessionModeUrl(raw)
  const parsed = new URL(url)
  console.log(`Target: ${parsed.hostname}:${parsed.port} db=${parsed.pathname.slice(1)}`)

  const sql = postgres(url, { max: 1, prepare: false, ssl: 'require' })
  try {
    await sql.unsafe(fs.readFileSync(path.resolve(MIGRATION), 'utf8'))
    console.log('Applied 0045_add_bank_sanctions.sql')

    const [check] = await sql`
      SELECT
        (to_regclass('public.bank_sanction_limits') IS NOT NULL)::int  AS limits_table,
        (to_regclass('public.bank_sanction_history') IS NOT NULL)::int AS history_table,
        (SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'bank_sanction_limits_loan_key_idx')::int AS dup_idx,
        (SELECT COUNT(*) FROM information_schema.role_table_grants
          WHERE table_name = 'bank_sanction_limits' AND grantee = 'anon')::int AS anon_grants`
    console.log(`Verify: limits=${check.limits_table} history=${check.history_table} dup_idx=${check.dup_idx} anon_grants=${check.anon_grants} (expect 1,1,1,0)`)

    const ok = check.limits_table === 1 && check.history_table === 1 && check.dup_idx === 1 && check.anon_grants === 0
    if (!ok) {
      console.error('VERIFICATION FAILED — the tables are not in the expected shape.')
      process.exitCode = 1
      return
    }
    console.log('\nVerified. /bank-sanctions can now read and write.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('Migration 0045 failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
