/**
 * Applies migration 0043 — creates `md_branch_targets` for the MD-only /targets section.
 *
 * Exists because `psql` is not installed on every machine here (the same gap
 * scripts/backup-database.js works around for pg_dump). The `postgres` driver is already a
 * dependency, so no PostgreSQL client tools are needed.
 *
 * ⚠️ DDL must NOT run through the Supabase transaction pooler (:6543). The URL is rewritten to the
 * session port below, mirroring lib/db/index.ts's own dev rewrite — without it the CREATE either
 * hangs or resets the connection.
 *
 * Every statement in 0043 is additive and idempotent (CREATE TABLE / INDEX IF NOT EXISTS), so
 * re-running is safe. Reverse with lib/db/migrations/0043_rollback_md_branch_targets.sql.
 *
 * Run:  npx tsx scripts/apply-migration-0043.ts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import postgres from 'postgres'

const MIGRATION = 'lib/db/migrations/0043_add_md_branch_targets.sql'

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
  const user = decodeURIComponent(parsed.username)
  const projectRef = user.includes('.') ? user.split('.').slice(1).join('.') : '(unknown)'
  console.log(`Target: ${parsed.hostname}:${parsed.port} db=${parsed.pathname.slice(1)} project=${projectRef}`)

  const sqlText = fs.readFileSync(path.resolve(MIGRATION), 'utf8')
  const sql = postgres(url, { max: 1, prepare: false, ssl: 'require' })

  try {
    const before = await sql`SELECT to_regclass('public.md_branch_targets') IS NOT NULL AS exists`
    console.log(`Before: md_branch_targets exists = ${before[0].exists}`)

    await sql.unsafe(sqlText)
    console.log('Applied 0043_add_md_branch_targets.sql')

    // Verify the SHAPE, not just that the statement returned. An index missing here would let the
    // upsert silently insert duplicate branch-months instead of updating them.
    const cols = await sql`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='md_branch_targets' ORDER BY ordinal_position`
    const idx = await sql`
      SELECT indexname FROM pg_indexes WHERE tablename='md_branch_targets' ORDER BY 1`
    const anonGrants = await sql`
      SELECT COUNT(*)::int n FROM information_schema.role_table_grants
      WHERE table_name='md_branch_targets' AND grantee='anon'`

    const metrics = ['sales_units', 'sales_revenue', 'service_ro_count', 'service_revenue']
    const nullableMetrics = cols.filter((c) => metrics.includes(c.column_name) && c.is_nullable === 'YES')

    console.log(`After : ${cols.length} columns`)
    console.log(`        indexes: ${idx.map((i) => i.indexname).join(', ')}`)
    console.log(`        all 4 metric columns nullable: ${nullableMetrics.length === 4}`)
    console.log(`        anon grants: ${anonGrants[0].n} (must be 0)`)

    const ok = cols.length >= 13
      && idx.some((i) => i.indexname === 'md_branch_targets_unique_idx')
      && idx.some((i) => i.indexname === 'md_branch_targets_brand_period_idx')
      && nullableMetrics.length === 4
      && anonGrants[0].n === 0

    if (!ok) {
      console.error('VERIFICATION FAILED — the table is not in the expected shape.')
      process.exitCode = 1
      return
    }
    console.log('\nVerified. /targets can now save targets.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('Migration 0043 failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
