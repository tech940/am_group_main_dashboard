/**
 * Applies migration 0054 — adds the `dcm` role enum value (Deputy Chief Manager).
 *
 * The DCM owns the FIRST approval stage on AM Platinum SERVICE requests:
 *     Platinum SERVICE:  submitted → DCM → EA → MD → Accounts
 *     Platinum SALES:    submitted → EA → MD → Accounts   (unchanged — no first stage)
 *
 * Platinum is the only brand whose first stage depends on the track, which is why
 * brandHasFirstStage() now takes the department (lib/approvals/first-stage-approver.ts).
 *
 * The stage reuses the existing `vp_approval` column — the generic first-stage column that already
 * holds an ED's, a GSM's or a VP's sign-off depending on brand, and whose label is rendered from
 * firstStageShortLabel(). No new column is needed, and the ordering gate, the printed voucher, the
 * MD queue and the decision emails all follow automatically.
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, which is why this is a
 * standalone script rather than a drizzle-kit migration, and why it runs on a `max: 1,
 * prepare: false` connection. Idempotent (IF NOT EXISTS) — safe to re-run.
 *
 * ⚠️ MUST be applied BEFORE deploying the code that references this role.
 *
 * This is not merely "the DCM cannot be assigned yet". syncPermissionRegistry() inserts one
 * role_permissions row per template key, typed by the role enum. With 'dcm' in the code and not in
 * Postgres, every one of those inserts fails with 22P02 — and the failure used to be misread as
 * "the permission tables are missing", which silently discarded all 205 Access Map grants and took
 * access control down for EVERY user, not just the new role. See the comment on
 * isMissingPermissionTables in lib/permissions/service.ts.
 *
 * Run:  npx tsx scripts/apply-migration-0054.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const NEW_ROLES = ['dcm']

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

  try {
    for (const role of NEW_ROLES) {
      const started = Date.now()
      await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS '${role}'`)
      console.log(`[0054] role '${role}' ensured in ${Date.now() - started}ms`)
    }

    const present = await sql<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'role'
      ORDER BY e.enumsortorder
    `
    const labels = present.map((row) => row.enumlabel)
    console.log(`[0054] role enum now has ${labels.length} values`)
    for (const role of NEW_ROLES) {
      console.log(`  ${labels.includes(role) ? 'OK  ' : 'MISS'} ${role}`)
    }
    if (!NEW_ROLES.every((r) => labels.includes(r))) process.exitCode = 1
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[0054] failed:', error)
  process.exit(1)
})
