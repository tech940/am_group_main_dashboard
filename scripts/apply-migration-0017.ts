/**
 * Applies migration 0017 — users.last_seen_at, backing the automatic user-deactivation system.
 *
 * WHY A NEW COLUMN AND NOT "last login":
 * The obvious signal — MAX(user_activity_events.created_at) WHERE event_type='login' — is wrong here.
 * Supabase sessions auto-refresh (a deliberate fix; users were being logged out hourly), so somebody who
 * uses the dashboard every single day may not produce a login event for weeks. Measured against live data,
 * a "no login in N days" rule would have deactivated 38 of 45 eligible users, including 12 who were active
 * in the app within the previous 24 hours. last_seen_at tracks real usage instead.
 *
 * THE BACKFILL is a one-shot seed from user_activity_events (both the login rows and the ~10k historical
 * page_view rows left behind by the now-removed page-view tracker — this is their last useful act). Users
 * with no events at all fall back to created_at, which correctly reads as "never used it".
 * Matched on user_id OR supabase_id because logUserActivity writes user_id as NULL when the app-user
 * lookup misses, and page_view rows predate some user records.
 *
 * CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so every statement is issued in
 * autocommit. Idempotent (IF NOT EXISTS / WHERE last_seen_at IS NULL) — safe to re-run.
 *
 * Run:  npx tsx scripts/apply-migration-0017.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const EXEMPT_ROLES = ['md', 'ea', 'accounts', 'developer']
const THRESHOLD_DAYS = 7

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    let started = Date.now()
    await sql.unsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz`)
    console.log(`[0017] users.last_seen_at ensured in ${Date.now() - started}ms`)

    started = Date.now()
    const backfilled = await sql.unsafe(`
      UPDATE users u
      SET last_seen_at = GREATEST(
        COALESCE((
          SELECT MAX(e.created_at) FROM user_activity_events e
          WHERE e.user_id = u.id OR e.supabase_id = u.supabase_id
        ), u.created_at),
        u.created_at
      )
      WHERE u.last_seen_at IS NULL
    `)
    console.log(`[0017] backfilled ${backfilled.count} users from activity history in ${Date.now() - started}ms`)

    started = Date.now()
    await sql.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS users_last_seen_active_idx ON users (last_seen_at) WHERE is_active`)
    console.log(`[0017] users_last_seen_active_idx ensured in ${Date.now() - started}ms`)

    // Verification: report the exact first-run blast radius so it is a decision, not a surprise.
    const [{ exists: colExists }] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'last_seen_at'
      ) AS exists`
    const [{ exists: idxExists }] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'users_last_seen_active_idx'
      ) AS exists`
    const [nulls] = await sql<{ n: string }[]>`SELECT COUNT(*)::text AS n FROM users WHERE last_seen_at IS NULL AND deleted_at IS NULL`

    const impact = await sql<{ role: string; idle: string; total: string }[]>`
      SELECT u.role,
             COUNT(*) FILTER (WHERE u.last_seen_at < now() - ${`${THRESHOLD_DAYS} days`}::interval)::text AS idle,
             COUNT(*)::text AS total
      FROM users u
      WHERE u.is_active AND u.deleted_at IS NULL AND u.role::text <> ALL(${EXEMPT_ROLES}::text[])
      GROUP BY u.role
      ORDER BY 2 DESC`

    const totalIdle = impact.reduce((sum, r) => sum + Number(r.idle), 0)
    const totalEligible = impact.reduce((sum, r) => sum + Number(r.total), 0)

    console.log('')
    console.log(`Migration 0017 applied. column=${colExists} index=${idxExists} unbackfilled=${nulls.n}`)
    console.log(`First sweep at ${THRESHOLD_DAYS}d would deactivate ${totalIdle} of ${totalEligible} eligible users:`)
    for (const row of impact.filter((r) => Number(r.idle) > 0)) {
      console.log(`  ${row.role.padEnd(22)} ${String(row.idle).padStart(3)} / ${String(row.total).padStart(3)}`)
    }

    process.exit(colExists && idxExists && nulls.n === '0' ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Migration 0017 failed:', error); process.exit(1) })
