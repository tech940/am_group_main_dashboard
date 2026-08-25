/**
 * Applies migration 0047 — MD Target labour metrics (mech / bodyshop / total).
 *
 * `psql` is not installed here; the `postgres` driver already is. DDL must not run through the
 * :6543 transaction pooler, so the URL is rewritten to the session port. Idempotent — ADD COLUMN
 * IF NOT EXISTS, and the CHECK is dropped-then-recreated, so re-running is a no-op.
 *
 * ⚠️ Run this BEFORE deploying the matching schema.ts change. `getBrandTargets` issues a bare
 * `db.select().from(mdBranchTargets)`, which drizzle expands to the full schema column list — so a
 * deployed schema.ts without these columns makes every read fail with 42703 and takes /targets down.
 * The readiness probe in lib/targets/store.ts now checks for the columns and degrades gracefully,
 * but applying first avoids the amber banner entirely.
 *
 * Run:  npx tsx scripts/apply-migration-0047.ts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import postgres from 'postgres'

const MIGRATION = 'lib/db/migrations/0047_add_md_target_labour_metrics.sql'
const NEW_COLUMNS = ['service_mech_labour', 'service_bodyshop_labour', 'service_labour_total']

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
    console.log('Applied 0047_add_md_target_labour_metrics.sql\n')

    const cols = await sql`
      SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'md_branch_targets' AND column_name = ANY(${NEW_COLUMNS})
      ORDER BY column_name`
    console.log('column                    type            nullable  default')
    for (const c of cols) {
      const type = `${c.data_type}(${c.numeric_precision},${c.numeric_scale})`
      console.log(`  ${String(c.column_name).padEnd(24)} ${type.padEnd(15)} ${String(c.is_nullable).padEnd(9)} ${c.column_default ?? '(none)'}`)
    }

    // A DEFAULT here would make "not set" indistinguishable from "target of zero".
    const defaulted = cols.filter((c) => c.column_default !== null)
    const notNullable = cols.filter((c) => c.is_nullable !== 'YES')

    const [constraint] = await sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'md_branch_targets'::regclass AND conname = 'md_branch_targets_nonneg_check'`
    const covers = NEW_COLUMNS.filter((c) => String(constraint?.def || '').includes(c))
    console.log(`\nnonneg check covers ${covers.length}/3 new columns`)

    const failures: string[] = []
    if (cols.length !== 3) failures.push(`expected 3 new columns, found ${cols.length}`)
    if (defaulted.length) failures.push(`columns must have NO default: ${defaulted.map((c) => c.column_name).join(', ')}`)
    if (notNullable.length) failures.push(`columns must be nullable: ${notNullable.map((c) => c.column_name).join(', ')}`)
    if (covers.length !== 3) failures.push('md_branch_targets_nonneg_check does not cover all three new columns')

    if (failures.length) {
      console.error(`\nVERIFICATION FAILED:\n  - ${failures.join('\n  - ')}`)
      process.exitCode = 1
      return
    }
    console.log('Verified. Labour targets can now be saved; NULL still means "not set", never zero.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('Migration 0047 failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
