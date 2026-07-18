/**
 * Applies migration 0024 — the Delegation Tasks section (cross-brand top-down task delegation).
 *
 * Two tables:
 *  1. delegation_tasks — a task a leader/manager delegates DOWN to a specific user. Generic (not tied
 *     to a booking or a brand). Assignee is a real FK + denormalized name/email snapshot (same reason
 *     kia_lead_followups does it — a reminder/list can render without a join). Status/priority are
 *     text columns validated in the lib layer (the recent convention; avoids the non-transactional
 *     ALTER TYPE dance a pgEnum would need for every new status).
 *  2. delegation_task_activity — an append-only, human-readable timeline, made IMMUTABLE by a trigger
 *     (same pattern as kia_finance_payout_activity in migration 0021) so the audit trail is tamper-proof.
 *
 * `reminder_sent_at` on delegation_tasks is unused in v1 — it exists so the future due/overdue email
 * reminder (reusing lib/kia/followup-reminders.ts) is a pure additive wire-up with no later migration.
 *
 * Idempotent (IF NOT EXISTS / CREATE OR REPLACE). CREATE INDEX CONCURRENTLY cannot run inside a
 * transaction, so every statement is issued in autocommit on a max:1 connection.
 *
 * Run:  npx tsx scripts/apply-migration-0024.ts
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
      CREATE TABLE IF NOT EXISTS delegation_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Content
        title text NOT NULL,
        description text,

        -- Assignee (the delegatee) — FK + denormalized snapshot for cheap list/email rendering
        assigned_to uuid NOT NULL REFERENCES users(id),
        assigned_name text,
        assigned_email text,

        -- Scheduling / classification (status + priority validated in lib/delegation/tasks.ts)
        due_at timestamptz,
        status text NOT NULL DEFAULT 'assigned',   -- assigned | in_progress | done | cancelled
        priority text NOT NULL DEFAULT 'normal',   -- low | normal | high

        -- Optional cross-brand tagging (non-enforcing — this section is not brand-gated)
        brand text,
        dealer_code text,

        -- Close-out
        completion_remark text,
        completed_by uuid REFERENCES users(id),
        completed_at timestamptz,

        -- Future email reminder (unused in v1)
        reminder_sent_at timestamptz,

        -- Audit
        created_by uuid NOT NULL REFERENCES users(id),
        metadata jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    console.log(`[0024] delegation_tasks ensured in ${Date.now() - started}ms`)

    started = Date.now()
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS delegation_task_activity (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id uuid NOT NULL REFERENCES delegation_tasks(id),
        type text NOT NULL,        -- assigned | started | completed | reopened | reassigned | cancelled | edited | commented
        message text,
        actor_user_id uuid REFERENCES users(id),
        actor_name text NOT NULL,
        actor_role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    console.log(`[0024] delegation_task_activity ensured in ${Date.now() - started}ms`)

    for (const [name, ddl] of [
      // "My inbox" (assignee) and the overdue sort share this.
      ['delegation_tasks_assigned_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS delegation_tasks_assigned_idx ON delegation_tasks (assigned_to, status)`],
      // "Tasks I delegated" (the manager's tracking view).
      ['delegation_tasks_creator_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS delegation_tasks_creator_idx ON delegation_tasks (created_by, status)`],
      ['delegation_tasks_status_due_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS delegation_tasks_status_due_idx ON delegation_tasks (status, due_at)`],
      ['delegation_tasks_created_at_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS delegation_tasks_created_at_idx ON delegation_tasks (created_at DESC)`],
      ['delegation_task_activity_task_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS delegation_task_activity_task_idx ON delegation_task_activity (task_id, created_at DESC)`],
    ] as const) {
      started = Date.now()
      await sql.unsafe(ddl)
      console.log(`[0024] ${name} ensured in ${Date.now() - started}ms`)
    }

    // Immutability: the activity feed can only ever be INSERTed into. A BEFORE UPDATE OR DELETE trigger
    // raises for every caller (app + admin), which is what makes it a real audit trail. Same pattern
    // as kia_finance_payout_activity (migration 0021).
    started = Date.now()
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION delegation_task_activity_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'delegation_task_activity is an immutable audit log — % is not allowed', TG_OP;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS delegation_task_activity_no_mutate ON delegation_task_activity;
      CREATE TRIGGER delegation_task_activity_no_mutate
        BEFORE UPDATE OR DELETE ON delegation_task_activity
        FOR EACH ROW EXECUTE FUNCTION delegation_task_activity_immutable();
    `)
    console.log(`[0024] immutability trigger ensured in ${Date.now() - started}ms`)

    // --- Verification ---
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('delegation_tasks', 'delegation_task_activity') ORDER BY table_name`
    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('delegation_tasks_assigned_idx','delegation_tasks_creator_idx',
                          'delegation_tasks_status_due_idx','delegation_tasks_created_at_idx',
                          'delegation_task_activity_task_idx') ORDER BY indexname`
    const [{ exists: triggerOk }] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'delegation_task_activity_no_mutate') AS exists`

    console.log('')
    console.log(`Migration 0024 applied.`)
    console.log(`  tables  : ${tables.map((t) => t.table_name).join(', ') || '(none)'}`)
    console.log(`  indexes : ${indexes.length}/5 — ${indexes.map((i) => i.indexname).join(', ')}`)
    console.log(`  immutability trigger: ${triggerOk}`)

    const ok = tables.length === 2 && indexes.length === 5 && triggerOk
    process.exit(ok ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Migration 0024 failed:', error); process.exit(1) })
