/**
 * Applies migration 0021 — the Finance Payouts ledger (Phase 1).
 *
 * Two tables:
 *  1. kia_finance_payouts — one row per delivered vehicle. Booking-sourced columns are a SNAPSHOT
 *     taken at delivery, not a live join: legacy/imported rows have no booking to join to, and a
 *     finance ledger wants the state AS AT DELIVERY (a later booking edit must not rewrite finance
 *     history). `booking_id` is nullable with a PARTIAL UNIQUE index so a delivered booking maps to
 *     exactly one payout row and auto-population is idempotent.
 *  2. kia_finance_payout_activity — append-only per-field edit history, made immutable by a trigger
 *     (same pattern as kia_finance_activity in migration 0014).
 *
 * This ledger is INDEPENDENT of the booking workflow. Nothing here writes booking state.
 *
 * Idempotent (IF NOT EXISTS / CREATE OR REPLACE). CREATE INDEX CONCURRENTLY cannot run inside a
 * transaction, so every statement is issued in autocommit on a max:1 connection.
 *
 * Run:  npx tsx scripts/apply-migration-0021.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    let started = Date.now()
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS kia_finance_payouts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        brand text NOT NULL DEFAULT 'kia',
        booking_id uuid REFERENCES kia_bookings(id),
        source text NOT NULL DEFAULT 'delivery',

        -- Snapshot from the delivered booking (or the legacy import)
        delivery_date timestamptz,
        customer_name text,
        customer_phone text,
        model text,
        sales_executive text,
        dealer_code text,
        tl_name text,
        hyp text,
        bank_branch text,
        loan_amount numeric(14,2),
        pan_number text,
        vehicle_registration_no text,

        -- Finance-specific, editable + audited
        payout_status text,
        reason_if_outhouse text,
        dealer_payout_percent numeric(6,2),
        dealer_payout_amount numeric(14,2),
        payout_receipt_status text,
        dse_payout_amount numeric(14,2),
        dse_payout_status text,
        dealer_payout_status text,
        payment_received_date timestamptz,
        amount_received numeric(14,2),
        invoice_number text,
        bank_visit_scheduled boolean NOT NULL DEFAULT false,
        date_of_bank_visit timestamptz,
        visited_by text,
        banker_remarks text,
        hyp_as_per_rc text,
        login_user text,
        bank_interest_rate numeric(5,2),
        bank_login boolean,
        bank_in_proforma text,

        metadata jsonb DEFAULT '{}'::jsonb,
        created_by uuid REFERENCES users(id),
        updated_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    console.log(`[0021] kia_finance_payouts ensured in ${Date.now() - started}ms`)

    started = Date.now()
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS kia_finance_payout_activity (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        payout_id uuid NOT NULL REFERENCES kia_finance_payouts(id),
        field text NOT NULL,
        before_value jsonb,
        after_value jsonb,
        actor_user_id uuid REFERENCES users(id),
        actor_name text NOT NULL,
        actor_role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    console.log(`[0021] kia_finance_payout_activity ensured in ${Date.now() - started}ms`)

    // The one-payout-per-booking guarantee. PARTIAL because imported rows have booking_id NULL and
    // must not collide with each other (many NULLs would violate a plain UNIQUE... actually Postgres
    // allows multiple NULLs, but the partial index also keeps it small and states the intent).
    // This is what makes the delivery hook's ON CONFLICT upsert idempotent.
    started = Date.now()
    await sql.unsafe(`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS kia_finance_payouts_booking_uidx
      ON kia_finance_payouts (booking_id) WHERE booking_id IS NOT NULL`)
    console.log(`[0021] kia_finance_payouts_booking_uidx ensured in ${Date.now() - started}ms`)

    for (const [name, ddl] of [
      ['kia_finance_payouts_delivery_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_finance_payouts_delivery_idx ON kia_finance_payouts (delivery_date DESC)`],
      ['kia_finance_payouts_dealer_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_finance_payouts_dealer_idx ON kia_finance_payouts (dealer_code)`],
      ['kia_finance_payouts_status_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_finance_payouts_status_idx ON kia_finance_payouts (payout_receipt_status)`],
      ['kia_finance_payout_activity_payout_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_finance_payout_activity_payout_idx ON kia_finance_payout_activity (payout_id, created_at DESC)`],
    ] as const) {
      started = Date.now()
      await sql.unsafe(ddl)
      console.log(`[0021] ${name} ensured in ${Date.now() - started}ms`)
    }

    // Immutability: the edit history can only ever be INSERTed into. A BEFORE UPDATE OR DELETE
    // trigger raises for every caller (app + admin), which is what makes it a real audit trail.
    // Same pattern as kia_finance_activity (migration 0014).
    started = Date.now()
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION kia_finance_payout_activity_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'kia_finance_payout_activity is an immutable audit log — % is not allowed', TG_OP;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS kia_finance_payout_activity_no_mutate ON kia_finance_payout_activity;
      CREATE TRIGGER kia_finance_payout_activity_no_mutate
        BEFORE UPDATE OR DELETE ON kia_finance_payout_activity
        FOR EACH ROW EXECUTE FUNCTION kia_finance_payout_activity_immutable();
    `)
    console.log(`[0021] immutability trigger ensured in ${Date.now() - started}ms`)

    // --- Verification ---
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('kia_finance_payouts', 'kia_finance_payout_activity') ORDER BY table_name`
    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('kia_finance_payouts_booking_uidx','kia_finance_payouts_delivery_idx',
                          'kia_finance_payouts_dealer_idx','kia_finance_payouts_status_idx',
                          'kia_finance_payout_activity_payout_idx') ORDER BY indexname`
    const [{ exists: triggerOk }] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'kia_finance_payout_activity_no_mutate') AS exists`

    console.log('')
    console.log(`Migration 0021 applied.`)
    console.log(`  tables  : ${tables.map((t) => t.table_name).join(', ') || '(none)'}`)
    console.log(`  indexes : ${indexes.length}/5 — ${indexes.map((i) => i.indexname).join(', ')}`)
    console.log(`  immutability trigger: ${triggerOk}`)

    const ok = tables.length === 2 && indexes.length === 5 && triggerOk
    process.exit(ok ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Migration 0021 failed:', error); process.exit(1) })
