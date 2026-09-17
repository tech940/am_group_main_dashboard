/**
 * Applies 0073_h_promise_two_stage_approval.sql and checks what it promised.
 *
 * ⚠️ DDL MUST NOT RUN ON THE PGBOUNCER POOLER (port 6543). This uses the session pooler on 5432 and refuses
 * anything else. The migration is additive (nullable columns + NULL-safe CHECKs) and changes no data; the
 * probes below run inside a transaction that is always rolled back.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/apply-migration-0073.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const COLUMNS = [
  'purchase_manager_status', 'purchase_manager_by', 'purchase_manager_by_name', 'purchase_manager_role',
  'purchase_manager_at', 'purchase_manager_note', 'purchase_decided_role',
  'sale_manager_status', 'sale_manager_by', 'sale_manager_by_name', 'sale_manager_role',
  'sale_manager_at', 'sale_manager_note', 'sale_decided_role',
]

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

  const sqlText = readFileSync('lib/db/migrations/0073_h_promise_two_stage_approval.sql', 'utf8')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false } })
  try {
    const [before] = await sql<{ n: number; pending: number; approved: number }[]>`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE purchase_status = 'pending')::int AS pending,
             count(*) FILTER (WHERE purchase_status = 'approved')::int AS approved
      FROM public.tata_h_promise_vehicles`
    await sql.unsafe(sqlText)
    console.log('0073 applied.\n')

    const columns = await sql<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tata_h_promise_vehicles' AND column_name = ANY(${COLUMNS})`
    console.log(`new columns: ${columns.length}/${COLUMNS.length}`)
    assert(columns.length === COLUMNS.length, 'a new column is missing')
    assert(columns.every((c) => c.is_nullable === 'YES'), 'a new column is NOT NULL')

    const constraints = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'tata_h_promise_vehicles_%manager%' ORDER BY conname`
    console.log(`constraints: ${constraints.map((c) => c.conname).join(', ')}`)
    assert(constraints.length === 4, `expected 4 manager CHECK constraints, found ${constraints.length}`)

    const [after] = await sql<{ n: number; pending: number; approved: number }[]>`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE purchase_status = 'pending')::int AS pending,
             count(*) FILTER (WHERE purchase_status = 'approved')::int AS approved
      FROM public.tata_h_promise_vehicles`
    console.log(`rows before ${JSON.stringify(before)} after ${JSON.stringify(after)}`)
    assert(JSON.stringify(before) === JSON.stringify(after), 'row counts or statuses changed')

    const grants = await sql<{ grantee: string }[]>`
      SELECT grantee FROM information_schema.role_table_grants
      WHERE table_name = 'tata_h_promise_vehicles' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`
    assert(grants.length === 0, 'the vehicles table is granted to anon/authenticated/PUBLIC')

    // Probes, inside a transaction that is ALWAYS rolled back.
    try {
      await sql.begin(async (tx) => {
        const [user] = await tx<{ id: string }[]>`SELECT id FROM public.users WHERE deleted_at IS NULL LIMIT 1`
        const [v] = await tx<{ id: string }[]>`
          INSERT INTO public.tata_h_promise_vehicles
            (reg_no, model, location, purchase_date, purchase_price, purchased_by,
             purchase_whatsapp_approver, purchase_status, purchase_submitted_by, created_by, created_by_name)
          VALUES ('ZZ99PROBE0073', 'Probe', 'TATA NARWAL', current_date, 100000, 'PROBE',
                  'NOT_TAKEN', 'pending', ${user.id}, ${user.id}, 'apply-migration-0073 probe')
          RETURNING id`
        let badStatus = false
        try {
          await tx.savepoint(async (sp) => {
            await sp`UPDATE public.tata_h_promise_vehicles SET purchase_manager_status = 'maybe' WHERE id = ${v.id}`
          })
        } catch (error) {
          badStatus = (error as { code?: string }).code === '23514'
        }
        console.log(`an unknown manager status is refused: ${badStatus}`)
        assert(badStatus, 'the manager status CHECK did not fire')

        let selfRefused = false
        try {
          await tx.savepoint(async (sp) => {
            await sp`UPDATE public.tata_h_promise_vehicles SET purchase_manager_status = 'approved', purchase_manager_by = ${user.id} WHERE id = ${v.id}`
          })
        } catch (error) {
          selfRefused = (error as { code?: string }).code === '23514'
        }
        console.log(`the person who entered it cannot approve it as manager: ${selfRefused}`)
        assert(selfRefused, 'the manager self-approval CHECK did not fire')

        throw new RollbackProbe()
      })
    } catch (error) {
      if (!(error instanceof RollbackProbe)) throw error
    }
    const [leftover] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.tata_h_promise_vehicles WHERE reg_no = 'ZZ99PROBE0073'`
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
