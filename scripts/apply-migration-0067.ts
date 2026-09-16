/**
 * Applies 0067_add_kia_daily_commitments.sql.
 *
 * ⚠️ DDL MUST NOT RUN ON THE PGBOUNCER POOLER (port 6543). `DATABASE_URL` points there. This uses the
 * session pooler on 5432 and refuses anything else.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/apply-migration-0067.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

function resolveDirectUrl(): string {
  const fromEnv = process.env.DATABASE_DIRECT_URL
  if (fromEnv) return fromEnv
  /*
   * ⚠️ The DATABASE_DIRECT_URL commented out in .env carries a STALE PASSWORD (13 characters against
   * the live 18) and fails authentication. Host, database and user are identical to DATABASE_URL —
   * Supabase's transaction and session poolers are one endpoint on two ports — so the direct URL is
   * derived by moving 6543 to 5432, which keeps the password current by construction.
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
  if (parsed.port === '6543') throw new Error('Refusing to run DDL against the pgbouncer pooler on 6543.')
  console.log(`connecting to ${parsed.hostname}:${parsed.port}`)

  const sqlText = readFileSync('lib/db/migrations/0067_add_kia_daily_commitments.sql', 'utf8')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false } })
  try {
    await sql.unsafe(sqlText)
    console.log('0067 applied.\n')

    const cols = await sql<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'kia_sales_daily_commitments'
      ORDER BY ordinal_position`
    console.log('columns:')
    for (const c of cols) console.log(`  ${c.column_name.padEnd(18)} ${c.data_type}`)
    if (!cols.length) throw new Error('table was not created')

    /* ⚠️ A timestamptz would move a 09:00 IST commitment onto the previous UTC day. */
    const dateCol = cols.find((c) => c.column_name === 'commitment_date')
    if (dateCol?.data_type !== 'date') throw new Error(`commitment_date must be a date, got ${dateCol?.data_type}`)

    const anon = await sql<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'kia_sales_daily_commitments' AND grantee = 'anon'`
    console.log(`\nanon grants: ${anon.length === 0 ? 'NONE (locked down)' : anon.map((a) => a.privilege_type).join(', ')}`)
    if (anon.length > 0) throw new Error('anon still holds grants')

    const [rls] = await sql<{ relrowsecurity: boolean }[]>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'kia_sales_daily_commitments'`
    console.log(`RLS enabled: ${rls?.relrowsecurity}`)
    if (!rls?.relrowsecurity) throw new Error('RLS is not enabled')

    const idx = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'kia_sales_daily_commitments'`
    console.log(`indexes: ${idx.map((i) => i.indexname).join(', ')}`)
    if (!idx.some((i) => i.indexname === 'kia_sales_daily_commitments_unique_idx')) {
      throw new Error('the unique index the upsert conflicts on is missing')
    }

    console.log('\nAll post-conditions hold.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
