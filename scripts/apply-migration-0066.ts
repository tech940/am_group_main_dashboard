/**
 * Applies 0066_add_kia_sales_target_plan.sql.
 *
 * ⚠️ DDL MUST NOT RUN ON THE PGBOUNCER POOLER (port 6543). `DATABASE_URL` points there. This script
 * uses `DATABASE_DIRECT_URL` (the session pooler, port 5432) and refuses to run if the resolved URL
 * is a 6543 one — a transaction-pooled ALTER TABLE is how schema ends up half-applied.
 *
 * `DATABASE_DIRECT_URL` is commented out in .env, so it is also read from there directly: the value
 * is never printed, only the host and port it resolved to.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/apply-migration-0066.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

function resolveDirectUrl(): string {
  const fromEnv = process.env.DATABASE_DIRECT_URL
  if (fromEnv) return fromEnv
  /*
   * ⚠️ The DATABASE_DIRECT_URL line commented out in .env carries a STALE PASSWORD (13 characters
   * against the live 18) and fails authentication. Host, database and user are identical to
   * DATABASE_URL — Supabase's transaction pooler and session pooler are the same endpoint on two
   * ports — so the direct URL is derived by moving 6543 to 5432, which keeps the password current by
   * construction. Set DATABASE_DIRECT_URL properly and this branch is never reached.
   */
  const pooled = process.env.DATABASE_URL
  if (!pooled) throw new Error('Neither DATABASE_DIRECT_URL nor DATABASE_URL is set')
  const url = new URL(pooled)
  if (url.port !== '6543') throw new Error(`Expected DATABASE_URL on 6543 to derive from; found ${url.port}`)
  url.port = '5432'
  return url.toString()
}

async function main() {
  const url = resolveDirectUrl()
  const parsed = new URL(url)
  if (parsed.port === '6543') {
    throw new Error('Refusing to run DDL against the pgbouncer pooler on 6543. Use the 5432 session URL.')
  }
  console.log(`connecting to ${parsed.hostname}:${parsed.port}`)

  const sqlText = readFileSync('lib/db/migrations/0066_add_kia_sales_target_plan.sql', 'utf8')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false } })
  try {
    await sql.unsafe(sqlText)
    console.log('0066 applied.\n')

    const cols = await sql<{ column_name: string; data_type: string; column_default: string | null }[]>`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'kia_sales_targets'
        AND column_name IN ('enquiry_target', 'test_drive_target', 'team_leader')
      ORDER BY column_name`
    console.log('columns:')
    for (const c of cols) console.log(`  ${c.column_name.padEnd(18)} ${c.data_type.padEnd(10)} default ${c.column_default ?? 'NULL'}`)
    if (cols.length !== 3) throw new Error(`expected 3 new columns, found ${cols.length}`)

    const anon = await sql<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'kia_sales_targets' AND grantee = 'anon'`
    console.log(`\nanon grants on kia_sales_targets: ${anon.length === 0 ? 'NONE (locked down)' : anon.map((a) => a.privilege_type).join(', ')}`)
    if (anon.length > 0) throw new Error('anon still holds grants')

    const idx = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'kia_sales_targets' AND indexname = 'kia_sales_targets_period_idx'`
    console.log(`period index: ${idx.length ? 'present' : 'MISSING'}`)
    if (!idx.length) throw new Error('period index missing')

    console.log('\nAll post-conditions hold.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
