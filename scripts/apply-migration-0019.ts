/**
 * Applies migration 0019 — adds the `crm` and `idt` role enum values.
 *
 * crm = Customer Relationship Manager: the only operational role that may mark a vehicle Delivered.
 * idt = Internal Development Trainee: the only operational role that may allot a vehicle to a booking.
 * (admin/developer retain their override in both cases — see lib/kia/workflow-access.ts.)
 *
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, which is why this is a standalone
 * script rather than a drizzle-kit migration, and why each value is issued as its own statement on a
 * `max: 1, prepare: false` connection. Idempotent (IF NOT EXISTS) — safe to re-run.
 *
 * MUST be applied BEFORE deploying the code that references these roles: a users.role write would
 * fail until the enum value exists.
 *
 * Run:  npx tsx scripts/apply-migration-0019.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

const NEW_ROLES = ['crm', 'idt']

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    for (const role of NEW_ROLES) {
      const started = Date.now()
      // Separate statements — ADD VALUE cannot share a transaction.
      await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS '${role}'`)
      console.log(`[0019] role '${role}' ensured in ${Date.now() - started}ms`)
    }

    const present = await sql<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'role' AND e.enumlabel = ANY(${NEW_ROLES})
      ORDER BY e.enumlabel`

    const found = present.map((r) => r.enumlabel)
    console.log('')
    console.log(`Migration 0019 applied. Present role values: ${found.join(', ') || '(none)'}`)

    const missing = NEW_ROLES.filter((r) => !found.includes(r))
    if (missing.length) console.error(`MISSING: ${missing.join(', ')}`)
    process.exit(missing.length === 0 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Migration 0019 failed:', error); process.exit(1) })
