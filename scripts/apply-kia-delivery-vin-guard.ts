/**
 * Applies lib/db/migrations/kia-delivery/0001_require_vin_on_delivery.sql on the SESSION pooler (5432)
 * and proves the trigger, with probes inside a transaction that is ALWAYS rolled back:
 *   - a booking cannot become 'delivered' without a VIN
 *   - it can with one
 *   - a delivered booking's VIN cannot be cleared
 *   - a booking already delivered without a VIN (historic) is still editable
 * Idempotent — safe to re-run.
 *
 * Not numbered on purpose: another agent takes the next 00NN number in this repo and has overwritten
 * scripts/apply-migration-00NN.ts twice. Leave those scripts to their owners.
 *
 *   npx tsx scripts/apply-kia-delivery-vin-guard.ts
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

  const sqlText = readFileSync('lib/db/migrations/kia-delivery/0001_require_vin_on_delivery.sql', 'utf8')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    await sql.unsafe(sqlText)
    console.log('kia-delivery/0001 applied.')

    const [trigger] = await sql`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.kia_bookings'::regclass AND tgname = 'kia_bookings_require_vin_on_delivery'`
    if (!trigger) throw new Error('Trigger is missing after apply')

    const probes: string[] = []
    try {
      await sql.begin(async (tx) => {
        const expect = async (label: string, shouldFail: boolean, run: () => Promise<unknown>) => {
          await tx`SAVEPOINT probe`
          let failed = false
          try { await run() } catch { failed = true }
          await tx`ROLLBACK TO SAVEPOINT probe`
          if (failed !== shouldFail) throw new Error(`probe "${label}" ${failed ? 'was refused' : 'was accepted'}`)
          probes.push(label)
        }

        const [open] = await tx`
          SELECT id FROM public.kia_bookings
          WHERE deleted_at IS NULL AND status <> 'delivered' AND NULLIF(BTRIM(COALESCE(allocated_vin, '')), '') IS NULL
          LIMIT 1`
        if (!open) throw new Error('No undelivered VIN-less booking to probe with')
        await expect('delivering without a VIN is refused', true,
          () => tx`UPDATE public.kia_bookings SET status = 'delivered' WHERE id = ${open.id}`)
        await expect('delivering with a VIN is accepted', false,
          () => tx`UPDATE public.kia_bookings SET status = 'delivered', allocated_vin = 'PROBEVIN00000001' WHERE id = ${open.id}`)
        await expect('clearing the VIN of a delivered booking is refused', true, async () => {
          await tx`UPDATE public.kia_bookings SET status = 'delivered', allocated_vin = 'PROBEVIN00000001' WHERE id = ${open.id}`
          await tx`UPDATE public.kia_bookings SET allocated_vin = NULL WHERE id = ${open.id}`
        })

        const [historic] = await tx`
          SELECT id FROM public.kia_bookings
          WHERE deleted_at IS NULL AND status = 'delivered' AND NULLIF(BTRIM(COALESCE(allocated_vin, '')), '') IS NULL
          LIMIT 1`
        if (historic) {
          await expect('a historic VIN-less delivery stays editable', false,
            () => tx`UPDATE public.kia_bookings SET status = 'delivered', notes = notes WHERE id = ${historic.id}`)
        }
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
