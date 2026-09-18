/**
 * Applies lib/db/migrations/call-ai/0001_add_call_ai_reviews.sql (AI Call Review) on the SESSION pooler (5432)
 * and proves the result: RLS on every table, nothing granted to anon/authenticated/PUBLIC, the state row seeded,
 * and the CHECKs firing (probed inside a transaction that is always rolled back). Idempotent — safe to re-run.
 *
 * Not numbered on purpose: this migration was written as 0077, then 0078, and both times another agent's
 * migration took the number and overwrote scripts/apply-migration-00NN.ts. Leave those scripts to their owners.
 *
 *   npx tsx scripts/apply-call-ai-migration.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

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

class Rollback extends Error {}

async function main() {
  const url = resolveDirectUrl()
  const parsed = new URL(url)
  if (parsed.port === '6543') throw new Error('Refusing to run DDL against the pgbouncer pooler on 6543.')
  console.log(`connecting to ${parsed.hostname}:${parsed.port}`)

  const sqlText = readFileSync('lib/db/migrations/call-ai/0001_add_call_ai_reviews.sql', 'utf8')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    await sql.unsafe(sqlText)
    console.log('call-ai/0001 applied.')

    const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'call_ai_%' AND relkind = 'r' ORDER BY relname`
    console.log('RLS:', rls.map((r) => `${r.relname}=${r.relrowsecurity}`).join(', '))
    if (rls.length !== 4 || rls.some((r) => !r.relrowsecurity)) throw new Error('RLS is not on for all four tables')

    const grants = await sql`
      SELECT table_name, grantee FROM information_schema.role_table_grants
      WHERE table_name LIKE 'call_ai_%' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`
    if (grants.length) throw new Error(`Unexpected grants: ${JSON.stringify(grants)}`)
    console.log('No grants to anon/authenticated/PUBLIC.')

    const [state] = await sql`SELECT id, enabled FROM public.call_ai_state`
    if (!state || state.id !== 1) throw new Error('call_ai_state was not seeded')
    console.log('State row present, enabled =', state.enabled)

    // Probes — every one inside a transaction that is rolled back.
    const probes: string[] = []
    try {
      await sql.begin(async (tx) => {
        const expectFail = async (label: string, run: () => Promise<unknown>) => {
          await tx`SAVEPOINT probe`
          try {
            await run()
            throw new Error(`probe "${label}" was accepted`)
          } catch (error) {
            if (error instanceof Error && error.message.startsWith('probe ')) throw error
            probes.push(label)
          }
          await tx`ROLLBACK TO SAVEPOINT probe`
        }
        const [row] = await tx`
          INSERT INTO public.call_ai_reviews (cre_recording_id, scope, summary_en, headline_en)
          VALUES (gen_random_uuid(), 'hyundai', 'Customer asked about the delivery date of a Creta', 'Delivery date query')
          RETURNING id, search_en::text AS search`
        if (!String(row.search).includes('deliveri')) throw new Error('search_en was not generated')
        probes.push('search_en is generated from the English fields')
        await expectFail('an unknown status is refused', () => tx`UPDATE public.call_ai_reviews SET status = 'weird' WHERE id = ${row.id}`)
        await expectFail('processing without a lock token is refused', () => tx`UPDATE public.call_ai_reviews SET status = 'processing' WHERE id = ${row.id}`)
        await expectFail('satisfaction 6 is refused', () => tx`UPDATE public.call_ai_reviews SET satisfaction = 6 WHERE id = ${row.id}`)
        await expectFail('a second state row is refused', () => tx`INSERT INTO public.call_ai_state (id) VALUES (2)`)
        await expectFail('a duplicate recording is refused', async () => {
          const [again] = await tx`SELECT cre_recording_id FROM public.call_ai_reviews WHERE id = ${row.id}`
          await tx`INSERT INTO public.call_ai_reviews (cre_recording_id, scope) VALUES (${again.cre_recording_id}, 'hyundai')`
        })
        throw new Rollback()
      })
    } catch (error) {
      if (!(error instanceof Rollback)) throw error
    }
    for (const probe of probes) console.log('  probe ok:', probe)
    console.log('Probes rolled back. Done.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
