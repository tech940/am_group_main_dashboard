/**
 * Applies migration 0013 — transfer retention primitive (#9).
 *
 * Mirrors the allocation retention columns onto `kia_vehicle_transfers` so a transferred vehicle is
 * saved separately (like an allotment) and stays visible under its destination dealer even after its
 * VIN disappears from the DMS stock feed. Idempotent (ADD COLUMN IF NOT EXISTS).
 */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql.unsafe(`
      ALTER TABLE kia_vehicle_transfers
        ADD COLUMN IF NOT EXISTS vehicle_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS stock_last_seen_at timestamptz,
        ADD COLUMN IF NOT EXISTS stock_missing_at timestamptz,
        ADD COLUMN IF NOT EXISTS stock_status text;
    `)

    // #12 Stock holds live in kia_stock_local_statuses (like 'retail'/'bbnd'). Widen its CHECK to
    // allow the two hold statuses. Drop the existing local_status CHECK by discovered name, then
    // recreate it with the full allowed set. Idempotent.
    await sql.unsafe(`
      DO $$
      DECLARE cname text;
      BEGIN
        SELECT con.conname INTO cname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'kia_stock_local_statuses' AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%local_status%'
        LIMIT 1;
        IF cname IS NOT NULL THEN
          EXECUTE format('ALTER TABLE kia_stock_local_statuses DROP CONSTRAINT %I', cname);
        END IF;
      END $$;
      ALTER TABLE kia_stock_local_statuses
        ADD CONSTRAINT kia_stock_local_statuses_local_status_check
        CHECK (local_status IN ('bbnd', 'retail', 'hold_customer', 'hold_dealer'));
    `)

    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'kia_vehicle_transfers'
        AND column_name IN ('vehicle_snapshot', 'stock_last_seen_at', 'stock_missing_at', 'stock_status')`
    const present = cols.map((c) => c.column_name).sort()
    console.log('kia_vehicle_transfers retention columns present =', present.join(', '))
    console.log('kia_stock_local_statuses CHECK widened to allow hold_customer / hold_dealer')
    process.exit(present.length === 4 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0013 failed:', error); process.exit(1) })
