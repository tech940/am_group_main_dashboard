/**
 * Applies migration 0014 — KIA customer-vehicle Finance Workflow.
 *
 * Four new booking/proforma-scoped tables (deliberately NOT the dealer-payout finance_orders system):
 *   kia_finance_processing   — one durable row per proforma: finance status + expected-completion
 *                              countdown (seeded from the 72h/CSD window) + completion + current bank.
 *   kia_finance_remarks      — append-only remark history (user/role/remark/time), never overwritten.
 *   kia_finance_bank_attempts— append-only bank-attempt history (bank/branch/status/date/reason).
 *   kia_finance_activity     — IMMUTABLE audit log (user, role, action, before/after, time). A
 *                              BEFORE UPDATE/DELETE trigger raises, so rows can only ever be inserted.
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER).
 */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS kia_finance_processing (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        proforma_id uuid NOT NULL UNIQUE REFERENCES kia_proformas(id),
        booking_id uuid REFERENCES kia_bookings(id),
        finance_status text NOT NULL DEFAULT 'pending',
        started_at timestamptz NOT NULL DEFAULT now(),
        expected_completion_date timestamptz NOT NULL,
        base_hours integer NOT NULL DEFAULT 72,
        delay_count integer NOT NULL DEFAULT 0,
        last_delay_reason_category text,
        last_delay_reason text,
        current_bank_name text,
        current_bank_branch text,
        current_bank_status text,
        completed_at timestamptz,
        completed_by uuid REFERENCES users(id),
        completed_by_name text,
        completed_by_role text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS kia_finance_remarks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        finance_processing_id uuid NOT NULL REFERENCES kia_finance_processing(id),
        remark text NOT NULL,
        created_by uuid REFERENCES users(id),
        created_by_name text NOT NULL,
        created_by_role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS kia_finance_bank_attempts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        finance_processing_id uuid NOT NULL REFERENCES kia_finance_processing(id),
        attempt_no integer NOT NULL,
        bank_name text NOT NULL,
        bank_branch text NOT NULL,
        status text NOT NULL DEFAULT 'Pending',
        rejection_reason text,
        submitted_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz,
        created_by uuid REFERENCES users(id),
        created_by_name text NOT NULL,
        created_by_role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS kia_finance_activity (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        finance_processing_id uuid NOT NULL REFERENCES kia_finance_processing(id),
        proforma_id uuid NOT NULL,
        activity_type text NOT NULL,
        title text NOT NULL,
        description text,
        before_value jsonb,
        after_value jsonb,
        actor_user_id uuid REFERENCES users(id),
        actor_name text NOT NULL,
        actor_role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS kia_finance_remarks_processing_idx ON kia_finance_remarks (finance_processing_id, created_at);
      CREATE INDEX IF NOT EXISTS kia_finance_bank_attempts_processing_idx ON kia_finance_bank_attempts (finance_processing_id, attempt_no);
      CREATE INDEX IF NOT EXISTS kia_finance_activity_processing_idx ON kia_finance_activity (finance_processing_id, created_at);
    `)

    // Immutability: the activity log can only ever be INSERTed into. A BEFORE UPDATE OR DELETE trigger
    // raises for every caller (app + admin), giving a true audit trail — kia_booking_activity has no
    // such guard. (Trigger only; no REVOKE, so this stays independent of the connecting DB role.)
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION kia_finance_activity_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'kia_finance_activity is an immutable audit log — % is not allowed', TG_OP;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS kia_finance_activity_no_mutate ON kia_finance_activity;
      CREATE TRIGGER kia_finance_activity_no_mutate
        BEFORE UPDATE OR DELETE ON kia_finance_activity
        FOR EACH ROW EXECUTE FUNCTION kia_finance_activity_immutable();
    `)

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('kia_finance_processing', 'kia_finance_remarks', 'kia_finance_bank_attempts', 'kia_finance_activity')`
    const present = tables.map((t) => t.table_name).sort()
    console.log('finance workflow tables present =', present.join(', '))
    const [{ has_trigger }] = await sql<{ has_trigger: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'kia_finance_activity_no_mutate') AS has_trigger`
    console.log('kia_finance_activity immutability trigger present =', has_trigger)
    process.exit(present.length === 4 && has_trigger ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0014 failed:', error); process.exit(1) })
