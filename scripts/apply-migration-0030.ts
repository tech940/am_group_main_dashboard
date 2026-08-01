/**
 * Applies migration 0030 — adds the `process_coordinator` role enum value.
 *
 * WHY THIS IS URGENT, not cosmetic: without this value, syncPermissionRegistry() throws on every
 * snapshot build (it seeds a role_permissions row per template key per role, and the insert fails
 * with 22P02). Drizzle 0.45 wraps that in a DrizzleQueryError whose message is the whole failed
 * statement — including the text "role_permissions" — which the old substring-matching
 * isMissingPermissionTableError() read as "the permission tables are missing". Every user then
 * fell back to a role-template-only snapshot with ALL of their Access Map overrides dropped, and
 * the admin API returned 503 "Permission tables are not installed."
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, which is why this is a
 * standalone script on a `max: 1, prepare: false` connection. Idempotent — safe to re-run.
 *
 * Adding an enum value is ADDITIVE and does not rewrite or invalidate any existing row. Note that
 * Postgres cannot REMOVE an enum value, so this is not revertible in place.
 *
 * Run:  npx tsx scripts/apply-migration-0030.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const NEW_ROLES = ['process_coordinator']

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

  try {
    for (const role of NEW_ROLES) {
      const started = Date.now()
      await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS '${role}'`)
      console.log(`[0030] role '${role}' ensured in ${Date.now() - started}ms`)
    }

    const present = await sql<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'role'
      ORDER BY e.enumsortorder
    `
    const labels = present.map((row) => row.enumlabel)
    console.log(`[0030] role enum now has ${labels.length} values`)
    for (const role of NEW_ROLES) {
      console.log(`  ${labels.includes(role) ? 'OK  ' : 'MISS'} ${role}`)
    }

    // Prove the seed insert that was breaking now succeeds. Rolled back — this only checks that
    // Postgres accepts the enum value, it must not leave a stray grant behind.
    try {
      await sql.begin(async (tx) => {
        const [permission] = await tx<{ id: string }[]>`SELECT id FROM permissions LIMIT 1`
        if (permission) {
          await tx`
            INSERT INTO role_permissions (role, permission_id, allowed)
            VALUES ('process_coordinator', ${permission.id}, true)
            ON CONFLICT (role, permission_id) DO NOTHING`
        }
        throw new Error('__rollback__')
      })
    } catch (error) {
      if ((error as Error).message !== '__rollback__') throw error
    }
    console.log('[0030] verified: role_permissions accepts process_coordinator (probe rolled back)')

    if (!NEW_ROLES.every((r) => labels.includes(r))) process.exitCode = 1
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[0030] failed:', error)
  process.exit(1)
})
