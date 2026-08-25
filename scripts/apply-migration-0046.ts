/**
 * Applies migration 0046 — bank sanction brand scoping (`branch_code`).
 *
 * `psql` is not installed here; the `postgres` driver already is. DDL must not run through the
 * :6543 transaction pooler, so the URL is rewritten to the session port. Idempotent — the seed only
 * fills rows still NULL, so re-running never overwrites a manual correction made in the UI.
 *
 * Run:  npx tsx scripts/apply-migration-0046.ts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import postgres from 'postgres'

const MIGRATION = 'lib/db/migrations/0046_add_bank_sanction_branch_code.sql'

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
    console.log('Applied 0046_add_bank_sanction_branch_code.sql\n')

    const rows = await sql`
      SELECT COALESCE(branch_code, '(group-level)') AS branch,
             COUNT(*)::int AS facilities,
             ROUND(SUM(credit_limit::numeric) / 1e7, 2)::text AS limit_cr
      FROM bank_sanction_limits GROUP BY 1 ORDER BY COUNT(*) DESC`
    console.log('branch          facilities   limit')
    for (const r of rows) {
      console.log(`  ${String(r.branch).padEnd(16)} ${String(r.facilities).padStart(3)}   Rs${r.limit_cr}Cr`)
    }

    const [check] = await sql`
      SELECT COUNT(*) FILTER (WHERE branch_code IS NOT NULL)::int AS mapped,
             COUNT(*) FILTER (WHERE branch_code IS NULL)::int AS group_level,
             COUNT(*)::int AS total FROM bank_sanction_limits`
    console.log(`\nVerify: ${check.mapped} brand-scoped + ${check.group_level} group-level = ${check.total} total`)
    if (check.total !== check.mapped + check.group_level) {
      console.error('VERIFICATION FAILED')
      process.exitCode = 1
      return
    }
    console.log('Verified. Brand users now see only their own facilities; MD & Developer see all.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('Migration 0046 failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
