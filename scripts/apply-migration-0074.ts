/**
 * Applies 0074_add_kia_walk_in_leads.sql and checks what it promised.
 *
 * ⚠️ DDL MUST NOT RUN ON THE PGBOUNCER POOLER (port 6543). This uses the session pooler on 5432 and refuses
 * anything else. The probe row runs inside a transaction that is always rolled back.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/apply-migration-0074.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

class RollbackProbe extends Error {}

function resolveDirectUrl(): string {
  const fromEnv = process.env.DATABASE_DIRECT_URL
  if (fromEnv) return fromEnv
  const pooled = process.env.DATABASE_URL
  if (!pooled) throw new Error('Neither DATABASE_DIRECT_URL nor DATABASE_URL is set')
  const url = new URL(pooled)
  if (url.port !== '6543') throw new Error(`Expected DATABASE_URL on 6543 to derive from; found ${url.port}`)
  url.port = '5432'
  return url.toString()
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const url = resolveDirectUrl()
  const parsed = new URL(url)
  if (parsed.port === '6543') throw new Error('Refusing to run DDL against the pgbouncer pooler on 6543.')
  console.log(`connecting to ${parsed.hostname}:${parsed.port}`)

  const sqlText = readFileSync('lib/db/migrations/0074_add_kia_walk_in_leads.sql', 'utf8')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    await sql.unsafe(sqlText)
    console.log('0074 applied.\n')

    const [table] = await sql<{ rls: boolean }[]>`SELECT relrowsecurity AS rls FROM pg_class WHERE relname = 'kia_walk_in_leads' AND relkind = 'r'`
    assert(table, 'kia_walk_in_leads is missing')
    console.log(`RLS on: ${table.rls}`)
    assert(table.rls, 'RLS is not enabled')

    const grants = await sql<{ grantee: string }[]>`
      SELECT grantee FROM information_schema.role_table_grants
      WHERE table_name = 'kia_walk_in_leads' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`
    console.log(`anon/authenticated/PUBLIC grants: ${grants.length}`)
    assert(grants.length === 0, 'kia_walk_in_leads is granted to anon/authenticated/PUBLIC')

    const indexes = await sql<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'kia_walk_in_leads' ORDER BY indexname`
    console.log(`indexes: ${indexes.map((i) => i.indexname).join(', ')}`)
    assert(indexes.some((i) => i.indexname === 'kia_walk_in_leads_import_key'), 'the import key index is missing')

    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO public.kia_walk_in_leads (enquiry_date, customer_name, mobile, model, consultant_name, enquiry_source)
          VALUES (current_date, 'Probe 0074', '9999999999', 'SONET', 'Probe', 'WALK IN')`
        let refused = false
        try {
          await tx.savepoint(async (sp) => {
            await sp`INSERT INTO public.kia_walk_in_leads (enquiry_date, customer_name, mobile, model, consultant_name, enquiry_source, source)
                     VALUES (current_date, 'Probe 0074', '9999999999', 'SONET', 'Probe', 'WALK IN', 'spam')`
          })
        } catch (error) {
          refused = (error as { code?: string }).code === '23514'
        }
        console.log(`an unknown source is refused: ${refused}`)
        assert(refused, 'the source CHECK did not fire')
        throw new RollbackProbe()
      })
    } catch (error) {
      if (!(error instanceof RollbackProbe)) throw error
    }
    const [left] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM public.kia_walk_in_leads WHERE customer_name = 'Probe 0074'`
    assert(left.n === 0, 'the probe row survived the rollback')
    console.log('\nAll post-conditions hold.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
