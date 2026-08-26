/**
 * Applies migration 0048 — KIA part-payment ledger + the "secured" release exemption.
 *
 * `psql` is not installed here; the `postgres` driver already is. DDL must not run through the
 * :6543 transaction pooler, so the URL is rewritten to the session port. Idempotent — every
 * statement is IF NOT EXISTS or DROP-then-ADD, so re-running is a no-op.
 *
 * Run:  npx tsx scripts/apply-migration-0048.ts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import postgres from 'postgres'

const MIGRATION = 'lib/db/migrations/0048_add_kia_booking_payments.sql'

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
  const failures: string[] = []
  try {
    await sql.unsafe(fs.readFileSync(path.resolve(MIGRATION), 'utf8'))
    console.log('Applied 0048_add_kia_booking_payments.sql\n')

    // 1. The ledger table and its shape.
    const cols = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'kia_booking_payments' ORDER BY ordinal_position`
    console.log(`kia_booking_payments: ${cols.length} columns`)
    if (cols.length === 0) failures.push('kia_booking_payments was not created')

    // 2. The two constraints are what make "nothing is ever deleted" structural rather than a
    //    convention, so assert them by name rather than trusting the DDL ran.
    const checks = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'kia_booking_payments'::regclass AND contype = 'c'
      ORDER BY conname`
    console.log('\nconstraints:')
    for (const c of checks) console.log(`  ${c.conname}`)
    for (const want of ['kia_booking_payments_amount_check', 'kia_booking_payments_kind_check']) {
      if (!checks.some((c) => c.conname === want)) failures.push(`missing constraint ${want}`)
    }

    // 3. The parent columns.
    const [parent] = await sql`
      SELECT
        (SELECT data_type FROM information_schema.columns
          WHERE table_name = 'kia_bookings' AND column_name = 'amount_received') AS amount_received,
        (SELECT column_default FROM information_schema.columns
          WHERE table_name = 'kia_bookings' AND column_name = 'amount_received') AS amount_default,
        (SELECT data_type FROM information_schema.columns
          WHERE table_name = 'kia_vehicle_allocations' AND column_name = 'payment_secured_at') AS secured_at,
        (SELECT column_default FROM information_schema.columns
          WHERE table_name = 'kia_vehicle_allocations' AND column_name = 'payment_secured_at') AS secured_default`
    console.log(`\nkia_bookings.amount_received .............. ${parent.amount_received} default ${parent.amount_default}`)
    console.log(`kia_vehicle_allocations.payment_secured_at  ${parent.secured_at} default ${parent.secured_default ?? '(none)'}`)
    if (!parent.amount_received) failures.push('kia_bookings.amount_received missing')
    if (!parent.secured_at) failures.push('kia_vehicle_allocations.payment_secured_at missing')
    // A default here would mark every allocation secured and silently disable the release sweep.
    if (parent.secured_default) failures.push('payment_secured_at must have NO default')

    // 4. Nothing should be secured yet — a non-zero count means the column was added wrong.
    const [state] = await sql`
      SELECT (SELECT COUNT(*)::int FROM kia_booking_payments) AS ledger_rows,
             (SELECT COUNT(*)::int FROM kia_vehicle_allocations WHERE payment_secured_at IS NOT NULL) AS secured,
             (SELECT COUNT(*)::int FROM kia_bookings WHERE amount_received <> 0) AS with_money`
    console.log(`\nledger rows ${state.ledger_rows} · secured allocations ${state.secured} · bookings with money ${state.with_money}`)
    if (state.secured !== 0) failures.push(`expected 0 secured allocations, found ${state.secured}`)

    if (failures.length) {
      console.error(`\nVERIFICATION FAILED:\n  - ${failures.join('\n  - ')}`)
      process.exitCode = 1
      return
    }
    console.log('\nVerified. Part payments can now be recorded; no vehicle is secured yet.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('Migration 0048 failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
