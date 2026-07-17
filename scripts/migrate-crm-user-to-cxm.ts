/**
 * Moves the CRM user to the CXM role.
 *
 * CXM (Customer Experience Management) took over "mark vehicle Delivered" from CRM, and delivery was
 * CRM's ONLY capability — so a user left on `crm` can do nothing at all in the booking workflow.
 * There is exactly one: Smriti Sudan (crm@amkia.in).
 *
 * ORDER: run this BEFORE `crm` is hidden from the admin role picker. The Admin console always sends
 * `role` in its PUT body, so once `crm` is filtered out of assignableRoles, ANY edit to a
 * still-crm user (even a phone number) is rejected with "You cannot assign this role." — and their
 * role field renders blank. Move them first and that trap can never fire.
 *
 * Idempotent: the WHERE clause matches only role='crm', so a re-run is a no-op.
 * Requires migration 0023 (the `cxm` enum value) to have been applied first.
 *
 *   npx tsx scripts/migrate-crm-user-to-cxm.ts          # dry run
 *   npx tsx scripts/migrate-crm-user-to-cxm.ts commit   # write
 */
import 'dotenv/config'
import postgres from 'postgres'

const COMMIT = process.argv.includes('commit')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    const [hasCxm] = await sql<{ present: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'role' AND e.enumlabel = 'cxm'
      ) AS present`
    if (!hasCxm.present) throw new Error("role enum has no 'cxm' value — run scripts/apply-migration-0023.ts first")

    const targets = await sql<{ id: string; email: string; full_name: string }[]>`
      SELECT id, email, full_name FROM users WHERE role = 'crm' AND deleted_at IS NULL`

    console.log(`users still on the retired 'crm' role: ${targets.length}`)
    for (const t of targets) console.log(`   ${t.full_name} <${t.email}>  ->  cxm`)
    if (!targets.length) {
      console.log('\nNothing to do — no crm users remain.')
      process.exit(0)
    }

    if (!COMMIT) {
      console.log('\nDRY RUN — nothing written. Re-run with `commit`.')
      process.exit(0)
    }

    const moved = await sql<{ id: string }[]>`
      UPDATE users SET role = 'cxm', updated_at = now()
      WHERE role = 'crm' AND deleted_at IS NULL
      RETURNING id`
    console.log(`\nMOVED ${moved.length} user(s) to cxm.`)

    const [left] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM users WHERE role = 'crm' AND deleted_at IS NULL`
    console.log(`users remaining on 'crm': ${left.c}`)
    console.log('\nNOTE: their cached permission snapshot is keyed on PERMISSION_CACHE_VERSION, which')
    console.log('this change bumped to v15 — so the new role resolves on their next request.')
    process.exit(Number(left.c) === 0 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Migration failed:', error); process.exit(1) })
