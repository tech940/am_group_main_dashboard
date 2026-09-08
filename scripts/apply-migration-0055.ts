/**
 * Applies migration 0055 — adds the `dgm` role enum value (Deputy General Manager), and retires the
 * mistaken `dcm` that 0054 introduced.
 *
 * ── Why there are two ─────────────────────────────────────────────────────────────────────────
 * 0054 shipped this stage under the wrong acronym: DCM (Deputy Chief Manager). The correct title is
 * DGM (Deputy General Manager). The chain itself is unchanged:
 *
 *     Platinum SERVICE:  submitted → DGM → EA → MD → Accounts
 *     Platinum SALES:    submitted → EA → MD → Accounts        (no first stage)
 *
 * ⚠️ POSTGRES CANNOT REMOVE AN ENUM VALUE. There is no `ALTER TYPE ... DROP VALUE`, so 'dcm' stays
 * on the `role` type permanently — dropping it would mean recreating the type and rewriting every
 * column that uses it, on a live database, to delete a label nothing references. It is inert: no
 * user holds it, no code mentions it, and nothing can assign it because the Admin role picker is
 * derived from the same enum the code declares.
 *
 * What this script DOES clean up is the orphaned role_permissions row 0054's registry sync created
 * for 'dcm'. Left behind it would show up in the Access Map as a role with permissions and no
 * holders — the kind of thing somebody later "fixes" by giving it to a person.
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, hence a standalone script on a
 * `max: 1, prepare: false` connection. Idempotent — safe to re-run.
 *
 * ⚠️ MUST be applied BEFORE deploying the code that references 'dgm'. syncPermissionRegistry()
 * inserts a role_permissions row per template key, typed by this enum; with 'dgm' in the code and
 * absent from Postgres every insert fails with 22P02, and this app previously misread that as
 * "the permission tables are missing" and discarded all 205 Access Map grants.
 *
 * Run:  npx tsx scripts/apply-migration-0055.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const NEW_ROLES = ['dgm']
const RETIRED_ROLE = 'dcm'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

  try {
    for (const role of NEW_ROLES) {
      const started = Date.now()
      await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS '${role}'`)
      console.log(`[0055] role '${role}' ensured in ${Date.now() - started}ms`)
    }

    /*
     * Refuse to strand a human. If anyone was assigned the mistaken role, say so and stop rather
     * than deleting their permissions out from under them — they need moving to 'dgm' first.
     */
    const stranded = await sql<{ id: string; email: string }[]>`
      SELECT id, email FROM users WHERE role::text = ${RETIRED_ROLE} AND deleted_at IS NULL
    `
    if (stranded.length > 0) {
      console.log(`[0055] ⚠️ ${stranded.length} user(s) still hold '${RETIRED_ROLE}':`)
      for (const u of stranded) console.log(`         ${u.email}`)
      console.log(`[0055] Move them to 'dgm' in Admin → Users, then re-run. Nothing was deleted.`)
      process.exitCode = 1
      return
    }

    const removed = await sql`
      DELETE FROM role_permissions WHERE role::text = ${RETIRED_ROLE} RETURNING id
    `
    console.log(`[0055] removed ${removed.length} orphaned role_permissions row(s) for '${RETIRED_ROLE}'`)

    const present = await sql<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'role'
      ORDER BY e.enumsortorder
    `
    const labels = present.map((row) => row.enumlabel)
    console.log(`[0055] role enum now has ${labels.length} values`)
    for (const role of NEW_ROLES) {
      console.log(`  ${labels.includes(role) ? 'OK  ' : 'MISS'} ${role}`)
    }
    console.log(`  NOTE '${RETIRED_ROLE}' remains on the enum and cannot be dropped — it is inert.`)
    if (!NEW_ROLES.every((r) => labels.includes(r))) process.exitCode = 1
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[0055] failed:', error)
  process.exit(1)
})
