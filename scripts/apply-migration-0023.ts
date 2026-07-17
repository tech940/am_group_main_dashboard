/**
 * Applies migration 0023 — adds the `cxm` and `ccm` role enum values.
 *
 * cxm = Customer Experience Management: takes over "mark vehicle Delivered" from `crm`.
 * ccm = Customer Care Manager: backup deliverer, for when the CXM is absent.
 * (admin/developer retain their override — see lib/kia/workflow-access.ts.)
 *
 * `crm` is RETIRED by this change but its enum value STAYS: Postgres cannot drop an enum value, and
 * the one existing crm user is migrated to cxm separately (scripts/migrate-crm-user-to-cxm.ts). The
 * role is instead hidden from the admin role picker so nobody is assigned it again.
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, which is why this is a standalone
 * script rather than a drizzle-kit migration, and why each value is issued as its own statement on a
 * `max: 1, prepare: false` connection. Idempotent (IF NOT EXISTS) — safe to re-run.
 *
 * MUST be applied BEFORE deploying the code that references these roles: a users.role write would
 * fail until the enum value exists.
 *
 * Run:  npx tsx scripts/apply-migration-0023.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const NEW_ROLES = ['cxm', 'ccm']

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    for (const role of NEW_ROLES) {
      const started = Date.now()
      // Separate statements — ADD VALUE cannot share a transaction.
      await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS '${role}'`)
      console.log(`[0023] role '${role}' ensured in ${Date.now() - started}ms`)
    }

    const present = await sql<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'role' AND e.enumlabel = ANY(${NEW_ROLES})
      ORDER BY e.enumlabel`

    const found = present.map((r) => r.enumlabel)
    const missing = NEW_ROLES.filter((r) => !found.includes(r))

    console.log('')
    console.log(`Migration 0023 applied. role enum now contains: ${found.join(', ')}`)
    if (missing.length) console.error(`MISSING: ${missing.join(', ')}`)
    process.exit(missing.length ? 1 : 0)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Migration 0023 failed:', error); process.exit(1) })
