/**
 * Applies lib/db/migrations/kia-recon/0001_add_kia_dms_reconciliation.sql and 0002_add_booking_month.sql
 * (in order, both idempotent) on the SESSION pooler (5432) and proves them: RLS on, nothing granted to anon/authenticated/PUBLIC, state row seeded, and the
 * CHECKs firing (probed inside a transaction that is always rolled back). Idempotent.
 *
 * Not numbered on purpose: another agent takes the next 00NN number in this repo and has overwritten
 * scripts/apply-migration-00NN.ts before. Leave those scripts to their owners.
 *
 *   npx tsx scripts/apply-kia-recon-migration.ts
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

  const files = ['0001_add_kia_dms_reconciliation.sql', '0002_add_booking_month.sql']
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    for (const file of files) {
      await sql.unsafe(readFileSync(`lib/db/migrations/kia-recon/${file}`, 'utf8'))
      console.log(`kia-recon/${file} applied.`)
    }

    const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('kia_dms_recon_items', 'kia_dms_recon_state') AND relkind = 'r' ORDER BY relname`
    console.log('RLS:', rls.map((r) => `${r.relname}=${r.relrowsecurity}`).join(', '))
    if (rls.length !== 2 || rls.some((r) => !r.relrowsecurity)) throw new Error('RLS is not on for both tables')
    const grants = await sql`
      SELECT table_name, grantee FROM information_schema.role_table_grants
      WHERE table_name IN ('kia_dms_recon_items', 'kia_dms_recon_state') AND grantee IN ('anon', 'authenticated', 'PUBLIC')`
    if (grants.length) throw new Error(`Unexpected grants: ${JSON.stringify(grants)}`)
    console.log('No grants to anon/authenticated/PUBLIC.')
    const [state] = await sql`SELECT id FROM public.kia_dms_recon_state`
    if (!state) throw new Error('kia_dms_recon_state was not seeded')

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
          INSERT INTO public.kia_dms_recon_items (item_key, kind, exception_type, severity, booking_id, event_date, booking_date, headline)
          VALUES ('probe', 'exception', 'dms_delivered', 'critical', gen_random_uuid(), '2026-09-14', '2026-08-18', 'probe')
          RETURNING id, event_month::text AS month, booking_month::text AS booked`
        if (row.month !== '2026-09-01') throw new Error(`event_month generated as ${row.month}`)
        if (row.booked !== '2026-08-01') throw new Error(`booking_month generated as ${row.booked}`)
        probes.push('event_month and booking_month are generated from their dates')
        await expectFail('an unknown exception type is refused', () => tx`UPDATE public.kia_dms_recon_items SET exception_type = 'x' WHERE id = ${row.id}`)
        await expectFail('resolved without resolved_at is refused', () => tx`UPDATE public.kia_dms_recon_items SET state = 'resolved' WHERE id = ${row.id}`)
        await expectFail('a booking exception without a booking is refused', () => tx`UPDATE public.kia_dms_recon_items SET booking_id = NULL WHERE id = ${row.id}`)
        await expectFail('a duplicate item key is refused', () => tx`
          INSERT INTO public.kia_dms_recon_items (item_key, kind, exception_type, severity, booking_id, event_date, headline)
          VALUES ('probe', 'exception', 'dms_paid', 'high', gen_random_uuid(), '2026-09-14', 'probe')`)
        await expectFail('a second state row is refused', () => tx`INSERT INTO public.kia_dms_recon_state (id) VALUES (2)`)
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
