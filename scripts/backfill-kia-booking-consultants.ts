/**
 * Repairs booking OWNERSHIP so consultants can see their own bookings.
 *
 * THE BUG: a sales_executive only sees bookings where `created_by = them OR consultant_email = them`
 * (the viewer filter in lib/kia/bookings.ts listFilters). The typed `consultant_name` — the field
 * that actually says whose booking it is — plays no part.
 *
 * THE DAMAGE: the bookings imported from Bookings_Data.xlsx were all attributed to one creator and
 * left `consultant_email` empty, so the consultants named on them matched neither side of that OR
 * and could see nothing. Verified: 14+ bookings invisible to the person who owns them.
 *
 * THE REPAIR: resolve `consultant_name` to a real user and stamp `consultant_email`. `created_by` is
 * deliberately NOT touched — it records who actually keyed the booking in, which stays true. The
 * viewer filter is an OR, so the consultant gains access without the creator losing it.
 *
 * MATCHING: case, spacing AND punctuation are all stripped. Staff names are hand-typed and vary in
 * all three — the same person exists as "gulshankumar" and "GULSHAN KUMAR", "akashbhat" and
 * "Akash Bhat". Lower-casing alone misses those; they differ by a SPACE, not a capital.
 *
 * SAFETY: a name matching zero users, or more than one, is skipped and reported — never guessed.
 * This decides who sees which customer, so ambiguity must not resolve to a coin flip.
 *
 * Dry-run by default:
 *   npx tsx scripts/backfill-kia-booking-consultants.ts          # report only
 *   npx tsx scripts/backfill-kia-booking-consultants.ts commit   # write
 */
import 'dotenv/config'
import postgres from 'postgres'

const COMMIT = process.argv.includes('commit')

type UserRow = { id: string; full_name: string; email: string; role: string }

/** Same rule as personNameKey() in lib/kia/bookings.ts — keep them in step. */
const nameKey = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Names that do NOT resolve automatically but were confirmed by the requester.
 * booking consultant_name -> the user's exact full_name.
 * Only add an entry a human has explicitly confirmed; a wrong one shows a salesperson another
 * salesperson's customers.
 */
const CONFIRMED_ALIASES: Record<string, string> = {
  // "ANSH" on 6 imported bookings is Ansh Dutta — confirmed by the requester 2026-07-16.
  ansh: 'Ansh Dutta',
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    const users = await sql<UserRow[]>`
      SELECT id, full_name, email, role FROM users WHERE deleted_at IS NULL AND is_active`

    // Index by normalised name, tracking collisions so we can refuse to guess.
    const byKey = new Map<string, UserRow[]>()
    for (const u of users) {
      const k = nameKey(u.full_name)
      if (!k) continue
      const list = byKey.get(k) ?? []
      list.push(u)
      byKey.set(k, list)
    }
    const aliasKeyToUser = new Map<string, UserRow>()
    for (const [alias, fullName] of Object.entries(CONFIRMED_ALIASES)) {
      const hit = byKey.get(nameKey(fullName))
      if (hit?.length === 1) aliasKeyToUser.set(alias, hit[0])
      else console.warn(`  ! alias "${alias}" -> "${fullName}" does not resolve to exactly one user; ignoring`)
    }

    const rows = await sql<{ id: string; booking_number: string; consultant_name: string }[]>`
      SELECT id, booking_number, consultant_name
      FROM kia_bookings
      WHERE deleted_at IS NULL AND coalesce(trim(consultant_email), '') = ''
      ORDER BY consultant_name`

    const plan: { id: string; bookingNumber: string; name: string; email: string; via: string }[] = []
    const skipped: { name: string; why: string }[] = []

    for (const b of rows) {
      const k = nameKey(b.consultant_name)
      const exact = byKey.get(k) ?? []
      if (exact.length === 1) {
        plan.push({ id: b.id, bookingNumber: b.booking_number, name: b.consultant_name, email: exact[0].email, via: 'name' })
      } else if (exact.length > 1) {
        skipped.push({ name: b.consultant_name, why: `ambiguous — ${exact.length} users share that name` })
      } else if (aliasKeyToUser.has(k)) {
        const u = aliasKeyToUser.get(k)!
        plan.push({ id: b.id, bookingNumber: b.booking_number, name: b.consultant_name, email: u.email, via: 'confirmed alias' })
      } else {
        skipped.push({ name: b.consultant_name, why: 'no user account' })
      }
    }

    const byName = new Map<string, { n: number; email: string; via: string }>()
    for (const p of plan) {
      const e = byName.get(p.name) ?? { n: 0, email: p.email, via: p.via }
      e.n += 1
      byName.set(p.name, e)
    }
    const skipCounts = new Map<string, { n: number; why: string }>()
    for (const s of skipped) {
      const e = skipCounts.get(s.name) ?? { n: 0, why: s.why }
      e.n += 1
      skipCounts.set(s.name, e)
    }

    console.log('=== KIA booking consultant backfill ===')
    console.log(`  bookings with no consultant_email: ${rows.length}`)
    console.log('')
    console.log(`  WILL ASSIGN (${plan.length} bookings):`)
    for (const [name, e] of [...byName].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`    ${name.padEnd(16)} ${String(e.n).padStart(2)} -> ${e.email.padEnd(30)} (${e.via})`)
    }
    console.log('')
    console.log(`  SKIPPED (${skipped.length} bookings) — left with the importer:`)
    for (const [name, e] of [...skipCounts].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`    ${name.padEnd(16)} ${String(e.n).padStart(2)}    ${e.why}`)
    }
    console.log('')

    if (!plan.length) { console.log('Nothing to assign.'); process.exit(0) }
    if (!COMMIT) { console.log('DRY RUN — nothing written. Re-run with `commit` to apply.'); process.exit(0) }

    // One statement per distinct email keeps it simple and auditable.
    let written = 0
    for (const [, e] of byName) {
      const ids = plan.filter((p) => p.email === e.email).map((p) => p.id)
      const res = await sql`
        UPDATE kia_bookings SET consultant_email = ${e.email}, updated_at = now()
        WHERE id = ANY(${ids}::uuid[])`
      written += res.count
    }

    const [after] = await sql<{ remaining: string }[]>`
      SELECT count(*)::text AS remaining FROM kia_bookings
      WHERE deleted_at IS NULL AND coalesce(trim(consultant_email), '') = ''`

    console.log(`ASSIGNED ${written} booking(s).`)
    console.log(`  still without a consultant_email: ${after.remaining} (the no-account names above)`)
    process.exit(0)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Backfill failed:', error); process.exit(1) })
