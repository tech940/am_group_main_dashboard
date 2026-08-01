/**
 * Applies migration 0031 — adds the `hr` role enum value to Postgres.
 *
 * The `hr` role was added to lib/db/schema.ts, lib/auth/roles.ts,
 * lib/permissions/registry.ts, and lib/permissions/tiers.ts but the
 * underlying Postgres enum was never updated. This caused every user
 * creation attempt with role='hr' to fail with:
 *   "invalid input value for enum role: 'hr'"
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, so
 * this is applied on a standalone max:1, prepare:false connection.
 * Idempotent — safe to re-run.
 *
 * Run:  npx tsx scripts/apply-migration-0031.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const NEW_ROLES = ['hr']

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

  try {
    for (const role of NEW_ROLES) {
      const started = Date.now()
      await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS '${role}'`)
      console.log(`[0031] role '${role}' ensured in ${Date.now() - started}ms`)
    }

    const present = await sql<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'role'
      ORDER BY e.enumsortorder
    `
    const labels = present.map((row) => row.enumlabel)
    console.log(`[0031] role enum now has ${labels.length} values:`)
    for (const role of NEW_ROLES) {
      console.log(`  ${labels.includes(role) ? 'OK  ' : 'MISS'} ${role}`)
    }

    // Verify the new enum value is accepted by role_permissions (rolled back — no stray data).
    try {
      await sql.begin(async (tx) => {
        const [permission] = await tx<{ id: string }[]>`SELECT id FROM permissions LIMIT 1`
        if (permission) {
          await tx`
            INSERT INTO role_permissions (role, permission_id, allowed)
            VALUES ('hr', ${permission.id}, true)
            ON CONFLICT (role, permission_id) DO NOTHING`
        }
        throw new Error('__rollback__')
      })
    } catch (error) {
      if ((error as Error).message !== '__rollback__') throw error
    }
    console.log('[0031] verified: role_permissions accepts hr (probe rolled back)')

    if (!NEW_ROLES.every((r) => labels.includes(r))) process.exitCode = 1
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[0031] failed:', error)
  process.exit(1)
})
