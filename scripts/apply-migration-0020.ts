/**
 * Applies migration 0020 — the CRE role + the customer's decline reason.
 *
 * 1. role enum value `cre` — Customer Relationship Executive: calls customers and owns booking
 *    follow-ups. Distinct from `crm` (Customer Relationship MANAGER, added in 0019, which owns
 *    vehicle delivery) — one letter apart, different jobs.
 * 2. kia_lead_followups.not_interested_reason — WHY THE CUSTOMER DECLINED, as a preset code so the
 *    analytics dashboard can rank reasons. Deliberately NOT the existing `reason` column, which
 *    means "why this follow-up was scheduled" (callback / payment_pending / …). Same word, opposite
 *    concept — do not conflate them. The free-text detail lives in `notes`, which is now mandatory.
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, so the enum add is issued first,
 * separately, on a `max: 1, prepare: false` connection. Idempotent — safe to re-run.
 *
 * Run:  npx tsx scripts/apply-migration-0020.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    // 1. Enum value — must be its own statement, cannot share a transaction with the DDL below.
    let started = Date.now()
    await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS 'cre'`)
    console.log(`[0020] role 'cre' ensured in ${Date.now() - started}ms`)

    // 2. The decline reason.
    started = Date.now()
    await sql.unsafe(`ALTER TABLE kia_lead_followups ADD COLUMN IF NOT EXISTS not_interested_reason text`)
    console.log(`[0020] kia_lead_followups.not_interested_reason ensured in ${Date.now() - started}ms`)

    // Index it: the analytics dashboard ranks reasons, so it groups on this column.
    started = Date.now()
    await sql.unsafe(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_lead_followups_not_interested_idx
      ON kia_lead_followups (not_interested_reason) WHERE not_interested_reason IS NOT NULL`)
    console.log(`[0020] kia_lead_followups_not_interested_idx ensured in ${Date.now() - started}ms`)

    const [{ exists: roleOk }] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'role' AND e.enumlabel = 'cre'
      ) AS exists`
    const [{ exists: colOk }] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'kia_lead_followups' AND column_name = 'not_interested_reason'
      ) AS exists`
    const [{ exists: idxOk }] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'kia_lead_followups_not_interested_idx') AS exists`

    console.log('')
    console.log(`Migration 0020 applied. role 'cre'=${roleOk} · not_interested_reason=${colOk} · index=${idxOk}`)
    process.exit(roleOk && colOk && idxOk ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Migration 0020 failed:', error); process.exit(1) })
