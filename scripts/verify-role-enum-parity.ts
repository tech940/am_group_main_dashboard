/**
 * verify:role-enum — proves the Postgres `role` enum matches the roles the CODE declares.
 *
 *   npm run verify:role-enum
 *
 * WHY THIS EXISTS. On 2026-08-01 `process_coordinator` was added to lib/db/schema.ts roleEnum and
 * to the permission templates, but the matching `ALTER TYPE role ADD VALUE` never reached Postgres.
 * That one missing enum label took down access control for EVERY user:
 *
 *   syncPermissionRegistry() seeds one role_permissions row per template key per role, so it tried
 *   to INSERT role = 'process_coordinator' -> Postgres 22P02 invalid_text_representation.
 *   Drizzle 0.45 wraps driver errors in a DrizzleQueryError whose message is the ENTIRE failed
 *   statement — text that contains "role_permissions" — and the old isMissingPermissionTableError()
 *   substring-matched table names, so it reported "the permission tables are not installed".
 *   Callers then "degraded gracefully" to a role-template-only snapshot, silently discarding all
 *   205 Access Map grants. Users lost sidebar sections while the Access Map still showed their
 *   checkbox ticked, because the Access Map reads user_permissions directly and the sidebar reads
 *   the snapshot.
 *
 * A single ALTER TYPE would have prevented it. This check makes that omission impossible to ship.
 * Read-only apart from one probe INSERT that is always rolled back.
 */
import 'dotenv/config'
import postgres from 'postgres'
import { roleEnum } from '../lib/db/schema'

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 2, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })

  try {
    const dbRoles = (await sql<{ enumlabel: string }[]>`
      SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'role' ORDER BY e.enumsortorder
    `).map((r) => r.enumlabel)
    const codeRoles = [...roleEnum.enumValues] as string[]

    console.log(`\ncode declares ${codeRoles.length} roles · database enum has ${dbRoles.length}\n`)

    console.log('CODE -> DATABASE (a role here that the DB lacks BREAKS ALL PERMISSIONS)')
    const missingInDb = codeRoles.filter((r) => !dbRoles.includes(r))
    ok('every role in schema.ts exists in the Postgres enum', missingInDb.length === 0,
      missingInDb.length
        ? `MISSING: ${missingInDb.join(', ')} — add a migration: ALTER TYPE role ADD VALUE IF NOT EXISTS '${missingInDb[0]}'`
        : 'no drift')

    console.log('\nDATABASE -> CODE (informational: a legacy label Drizzle does not know about)')
    const missingInCode = dbRoles.filter((r) => !codeRoles.includes(r))
    if (missingInCode.length) {
      console.log(`  NOTE  database-only role(s): ${missingInCode.join(', ')}`)
      const orphanUsers = await sql<{ role: string; n: number }[]>`
        SELECT role::text AS role, COUNT(*)::int AS n FROM users
        WHERE deleted_at IS NULL AND role::text = ANY(${missingInCode}) GROUP BY 1`
      for (const row of orphanUsers) {
        console.log(`        ${row.n} active user(s) still hold '${row.role}'`)
      }
      ok('no ACTIVE user holds a role the code does not declare', orphanUsers.length === 0,
        orphanUsers.length ? 'those users resolve against no template' : 'none')
    } else {
      ok('database enum has no labels beyond the code', true)
    }

    // The real failure mode: not "does the label exist" but "can the registry seed actually write
    // a row for it". This reproduces syncPermissionRegistry()'s insert for every declared role.
    console.log('\nSEED INSERTABILITY (what syncPermissionRegistry actually does, rolled back)')
    const [permission] = await sql<{ id: string }[]>`SELECT id FROM permissions LIMIT 1`
    if (!permission) {
      ok('permissions table has at least one row to probe with', false, 'table is empty')
    } else {
      const rejected: string[] = []
      for (const role of codeRoles) {
        try {
          await sql.begin(async (tx) => {
            await tx`
              INSERT INTO role_permissions (role, permission_id, allowed)
              VALUES (${role}::role, ${permission.id}, true)
              ON CONFLICT (role, permission_id) DO NOTHING`
            throw new Error('__rollback__')
          })
        } catch (error) {
          if ((error as Error).message !== '__rollback__') rejected.push(role)
        }
      }
      ok('role_permissions accepts every role the code declares', rejected.length === 0,
        rejected.length ? `REJECTED: ${rejected.join(', ')}` : `${codeRoles.length} roles probed`)
    }

    console.log('\nACCESS MAP GRANTS (the data the outage was hiding, not deleting)')
    const [grants] = await sql<{ granted: number; denied: number; users: number }[]>`
      SELECT COUNT(*) FILTER (WHERE allowed)::int AS granted,
             COUNT(*) FILTER (WHERE NOT allowed)::int AS denied,
             COUNT(DISTINCT user_id)::int AS users
      FROM user_permissions`
    console.log(`  ${grants.granted} explicit grants · ${grants.denied} explicit denials · ${grants.users} users`)
    ok('user_permissions overrides are present', grants.granted > 0)

    const [orphaned] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM user_permissions up
      WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.id = up.permission_id)`
    ok('every override points at a permission that still exists', orphaned.n === 0,
      orphaned.n ? `${orphaned.n} dangling override(s)` : 'no dangling rows')

    console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`} — ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('\nVERIFY FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
