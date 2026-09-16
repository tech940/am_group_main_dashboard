/**
 * Applies 0071_add_fuel_accountability.sql and checks what it promised.
 *
 * ⚠️ DDL MUST NOT RUN ON THE PGBOUNCER POOLER (port 6543). `DATABASE_URL` points there. This uses the
 * session pooler on 5432 and refuses anything else.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/apply-migration-0071.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

function resolveDirectUrl(): string {
  const fromEnv = process.env.DATABASE_DIRECT_URL
  if (fromEnv) return fromEnv
  // ⚠️ The DATABASE_DIRECT_URL commented out in .env carries a stale password. The session port is the same
  // endpoint as the transaction pooler, so moving 6543 to 5432 keeps the password current by construction.
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

  const sqlText = readFileSync('lib/db/migrations/0071_add_fuel_accountability.sql', 'utf8')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false } })
  try {
    await sql.unsafe(sqlText)
    console.log('0071 applied.\n')

    const cols = await sql<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'fuel_approvals'
        AND column_name IN ('approved_quantity', 'actual_quantity', 'gate_pass_id', 'department')`
    for (const c of cols) console.log(`  fuel_approvals.${c.column_name.padEnd(18)} ${c.data_type}`)
    if (cols.length !== 4) throw new Error(`expected 4 new columns, found ${cols.length}`)

    const [counts] = await sql<{ approved: number; with_approved_qty: number; with_actual: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved,
             count(*) FILTER (WHERE status = 'approved' AND approved_quantity IS NOT NULL)::int AS with_approved_qty,
             count(*) FILTER (WHERE actual_quantity IS NOT NULL)::int AS with_actual
      FROM public.fuel_approvals`
    console.log(`\napproved requests: ${counts.approved}; with an approved quantity: ${counts.with_approved_qty}; with an actual: ${counts.with_actual}`)
    if (counts.approved !== counts.with_approved_qty) throw new Error('backfill left approved requests without an approved quantity')

    const anon = await sql<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'fuel_exception_reviews' AND grantee IN ('anon', 'authenticated')`
    console.log(`anon/authenticated grants on fuel_exception_reviews: ${anon.length === 0 ? 'NONE' : anon.length}`)
    if (anon.length > 0) throw new Error('fuel_exception_reviews is still granted to anon/authenticated')

    const [rls] = await sql<{ relrowsecurity: boolean }[]>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'fuel_exception_reviews'`
    console.log(`RLS enabled: ${rls?.relrowsecurity}`)
    if (!rls?.relrowsecurity) throw new Error('RLS is not enabled')

    const triggers = await sql<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE tgname LIKE 'fuel_exception_reviews_%'`
    console.log(`append-only triggers: ${triggers.map((t) => t.tgname).join(', ')}`)
    if (triggers.length !== 2) throw new Error('the append-only triggers are missing')

    console.log('\nAll post-conditions hold.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
