/**
 * Apply migration 0050 — the three-stage discount approval chain.
 *
 * ⚠️ Run against the DIRECT/session port (5432), never the pgbouncer pooler (6543): DDL through a
 * transaction pooler can be applied against a different backend than the one you are inspecting.
 *
 * Asserts the columns exist afterwards and that the two live PENDING requests were left untouched.
 *
 * Run: npx tsx --tsconfig ./tsconfig.verify.json scripts/apply-migration-0050.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'
import { analyticsExecute } from '../lib/analytics/db'

const NEW_COLUMNS = [
  'discount_type',
  'sm_status', 'sm_by', 'sm_by_name', 'sm_remarks', 'sm_at',
  'md_status', 'md_by', 'md_by_name', 'md_remarks', 'md_at', 'md_approved_amount',
  'payout_status', 'payout_by', 'payout_by_name', 'payout_remarks', 'payout_at', 'payout_reference',
  'vehicle_snapshot',
]

async function main() {
  const [before] = await analyticsExecute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM kia_booking_discounts`)
  console.log(`kia_booking_discounts holds ${before.n} row(s) before the migration`)

  const file = join(process.cwd(), 'lib/db/migrations/0050_add_kia_discount_approval_chain.sql')
  const ddl = readFileSync(file, 'utf8')
  await db.execute(sql.raw(ddl))
  console.log('migration applied')

  const cols = await analyticsExecute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kia_booking_discounts'`)
  const present = new Set(cols.map((c) => c.column_name))
  const missing = NEW_COLUMNS.filter((c) => !present.has(c))
  console.log(missing.length ? `MISSING: ${missing.join(', ')}` : `all ${NEW_COLUMNS.length} columns present`)

  /*
   * Every new column must be NULLABLE. A NOT NULL added to a table with existing rows would either
   * fail outright or silently stamp a default onto requests nobody has actioned — which would put
   * both live requests past a stage no human touched.
   */
  const notNull = await analyticsExecute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kia_booking_discounts'
      AND column_name = ANY(ARRAY[${sql.join(NEW_COLUMNS.map((c) => sql`${c}`), sql`, `)}]::text[])
      AND is_nullable = 'NO'`)
  console.log(notNull.length ? `UNEXPECTEDLY NOT NULL: ${notNull.map((c) => c.column_name).join(', ')}` : 'every new column is nullable')

  const [after] = await analyticsExecute<{ n: number; untouched: number }>(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE sm_status IS NULL AND md_status IS NULL AND payout_status IS NULL)::int AS untouched
    FROM kia_booking_discounts`)
  console.log(`rows: ${after.n} (was ${before.n}), of which ${after.untouched} have an untouched chain`)

  const ok = missing.length === 0 && notNull.length === 0 && after.n === before.n && after.untouched === after.n
  console.log(ok ? '\n=== 0050 APPLIED CLEANLY ===' : '\n=== CHECK THE OUTPUT ABOVE ===')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
