/**
 * Applies 0072_add_tata_h_promise.sql and checks what it promised.
 *
 * ⚠️ DDL MUST NOT RUN ON THE PGBOUNCER POOLER (port 6543). `DATABASE_URL` points there. This uses the
 * session pooler on 5432 and refuses anything else.
 *
 * Every check after the apply is read-only, except the two trigger probes, which run inside a transaction that
 * is always rolled back — nothing they insert survives.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/apply-migration-0072.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const TABLES = [
  'tata_h_promise_vehicles',
  'tata_h_promise_bookings',
  'tata_h_promise_files',
  'tata_h_promise_events',
  'tata_h_promise_options',
  'tata_h_promise_settings',
  'tata_h_promise_exchange_bonuses',
]

class RollbackProbe extends Error {}

function resolveDirectUrl(): string {
  const fromEnv = process.env.DATABASE_DIRECT_URL
  if (fromEnv) return fromEnv
  // Same derivation as apply-migration-0071: the session port is the same endpoint as the transaction pooler.
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

  const sqlText = readFileSync('lib/db/migrations/0072_add_tata_h_promise.sql', 'utf8')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false } })
  try {
    await sql.unsafe(sqlText)
    console.log('0072 applied.\n')

    const tables = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relkind = 'r' AND relname = ANY(${TABLES})`
    for (const t of tables) console.log(`  ${t.relname.padEnd(34)} RLS ${t.relrowsecurity ? 'on' : 'OFF'}`)
    assert(tables.length === TABLES.length, `expected ${TABLES.length} tables, found ${tables.length}`)
    assert(tables.every((t) => t.relrowsecurity), 'RLS is not enabled on every table')

    const grants = await sql<{ table_name: string; grantee: string }[]>`
      SELECT table_name, grantee FROM information_schema.role_table_grants
      WHERE table_name = ANY(${TABLES}) AND grantee IN ('anon', 'authenticated', 'PUBLIC')`
    console.log(`\nanon/authenticated/PUBLIC table grants: ${grants.length === 0 ? 'NONE' : grants.length}`)
    assert(grants.length === 0, 'an H Promise table is still granted to anon/authenticated/PUBLIC')

    const [seq] = await sql<{ anon: boolean; authed: boolean }[]>`
      SELECT has_sequence_privilege('anon', 'public.tata_h_promise_vehicles_stock_no_seq', 'USAGE') AS anon,
             has_sequence_privilege('authenticated', 'public.tata_h_promise_vehicles_stock_no_seq', 'USAGE') AS authed`
    console.log(`stock-number sequence usable by anon: ${seq.anon}, by authenticated: ${seq.authed}`)
    assert(!seq.anon && !seq.authed, 'the stock-number sequence is still usable by anon/authenticated')

    const triggers = await sql<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'tata_h_promise_%' ORDER BY tgname`
    console.log(`triggers: ${triggers.map((t) => t.tgname).join(', ')}`)
    assert(triggers.length === 3, `expected 3 triggers, found ${triggers.length}`)

    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'tata_h_promise_vehicles' AND indexname = 'tata_h_promise_vehicles_reg_live_key'`
    assert(indexes.length === 1, 'the live registration unique index is missing')

    const options = await sql<{ kind: string; n: number }[]>`
      SELECT kind, count(*)::int AS n FROM public.tata_h_promise_options GROUP BY kind ORDER BY kind`
    console.log(`seeded options: ${options.map((o) => `${o.kind} ${o.n}`).join(', ')}`)
    assert(options.find((o) => o.kind === 'location')?.n === 6, 'expected 6 seeded locations')
    assert(options.find((o) => o.kind === 'approver')?.n === 5, 'expected 5 seeded approvers')

    const rates = await sql<{ value: { ratePct?: number } }[]>`
      SELECT value FROM public.tata_h_promise_settings WHERE key = 'interest_rate_annual_pct'`
    console.log(`interest rate rows: ${rates.map((r) => `${r.value.ratePct}%`).join(', ')}`)
    assert(rates.length === 1 && rates[0].value.ratePct === 12, 'expected the 12 % interest rate to be seeded')

    // The generated key must match lib/h-promise/registration.ts#normalizeRegNo.
    const [key] = await sql<{ k: string }[]>`
      SELECT upper(regexp_replace(${'jk-02 ab 1234'}, '[^A-Za-z0-9]', '', 'g')) AS k`
    console.log(`reg key of 'jk-02 ab 1234': ${key.k}`)
    assert(key.k === 'JK02AB1234', 'the registration key expression changed')

    // Trigger probes, inside a transaction that is ALWAYS rolled back.
    try {
      await sql.begin(async (tx) => {
        const [v] = await tx<{ id: string }[]>`
          INSERT INTO public.tata_h_promise_vehicles
            (reg_no, model, location, purchase_date, purchase_price, purchased_by,
             purchase_whatsapp_approver, purchase_status, created_by_name)
          VALUES ('ZZ99PROBE0072', 'Probe', 'TATA NARWAL', current_date, 100000, 'PROBE',
                  'NOT_TAKEN', 'approved', 'apply-migration-0072 probe')
          RETURNING id`
        let priceLocked = false
        try {
          await tx.savepoint(async (sp) => {
            await sp`UPDATE public.tata_h_promise_vehicles SET purchase_price = 1 WHERE id = ${v.id}`
          })
        } catch (error) {
          priceLocked = (error as { code?: string }).code === 'HP001'
        }
        console.log(`price lock refuses an approved price change: ${priceLocked}`)
        assert(priceLocked, 'the price-lock trigger did not fire')

        await tx`INSERT INTO public.tata_h_promise_events (vehicle_id, action, actor_name) VALUES (${v.id}, 'probe', 'probe')`
        let appendOnly = false
        try {
          await tx.savepoint(async (sp) => {
            await sp`UPDATE public.tata_h_promise_events SET remarks = 'x' WHERE vehicle_id = ${v.id}`
          })
        } catch {
          appendOnly = true
        }
        console.log(`events refuse UPDATE: ${appendOnly}`)
        assert(appendOnly, 'tata_h_promise_events accepted an UPDATE')

        throw new RollbackProbe()
      })
    } catch (error) {
      if (!(error instanceof RollbackProbe)) throw error
    }
    const [leftover] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.tata_h_promise_vehicles WHERE reg_no = 'ZZ99PROBE0072'`
    assert(leftover.n === 0, 'the probe row survived the rollback')

    console.log('\nAll post-conditions hold.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
