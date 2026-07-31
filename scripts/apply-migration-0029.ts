/**
 * Applies migration 0029 — adds the `assistant_manager` role enum value.
 *
 * Assistant Manager: a branch-level generalist who oversees BOTH Sales and Service for the branches
 * they are assigned to. Sits on the previously-reserved SUPERVISOR rung of the tier model — above
 * front-line staff, below a full Manager — so it does NOT inherit the Manager template's approve /
 * audit rights (see lib/permissions/tiers.ts).
 *
 * Branch scoping needs no work here: `users.brand` narrows the snapshot to one brand
 * (constrainSnapshotToBranch) and `users.dealers` narrows it further to named branch codes via
 * getUserDealerScope — both are existing, role-agnostic axes.
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, which is why this is a
 * standalone script rather than a drizzle-kit migration, and why it runs on a `max: 1,
 * prepare: false` connection. Idempotent (IF NOT EXISTS) — safe to re-run.
 *
 * ⚠️ MUST be applied BEFORE deploying the code that references this role: assigning the role to a
 * user writes `users.role = 'assistant_manager'`, which fails until the enum value exists. The same
 * ordering applies to syncPermissionRegistry(), which inserts a role_permissions row per template
 * key using the roleEnum type.
 *
 * Run:  npx tsx scripts/apply-migration-0029.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const NEW_ROLES = ['assistant_manager']

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

  try {
    for (const role of NEW_ROLES) {
      const started = Date.now()
      await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS '${role}'`)
      console.log(`[0029] role '${role}' ensured in ${Date.now() - started}ms`)
    }

    const present = await sql<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'role'
      ORDER BY e.enumsortorder
    `
    const labels = present.map((row) => row.enumlabel)
    console.log(`[0029] role enum now has ${labels.length} values`)
    for (const role of NEW_ROLES) {
      console.log(`  ${labels.includes(role) ? 'OK  ' : 'MISS'} ${role}`)
    }
    if (!NEW_ROLES.every((r) => labels.includes(r))) process.exitCode = 1
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[0029] failed:', error)
  process.exit(1)
})
