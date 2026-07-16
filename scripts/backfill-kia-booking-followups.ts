/**
 * Enrols EXISTING bookings into the Booking Follow-ups pipeline.
 *
 * Every booking created from now on auto-enrols inside createKiaBooking. Bookings that predate that
 * change have no follow-up at all, so they can never appear in the pipeline — which is why the page
 * looked empty. This is the one-shot catch-up.
 *
 * Rules, matching the auto-enrol path exactly:
 *  - skips delivered and cancelled bookings (the journey is over)
 *  - skips soft-deleted bookings
 *  - skips any booking that already has a follow-up in ANY state — idempotent, safe to re-run
 *  - due immediately, so it lands straight in the CRE's Pending list
 *  - UNASSIGNED (assigned_to NULL): the CRE team works one shared pool, not per-consultant queues
 *
 * Dry-run by default. Pass `commit` to write:
 *   npx tsx scripts/backfill-kia-booking-followups.ts          # report only
 *   npx tsx scripts/backfill-kia-booking-followups.ts commit   # actually enrol
 */
import 'dotenv/config'
import postgres from 'postgres'

const COMMIT = process.argv.includes('commit')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    // created_by is NOT NULL on kia_lead_followups — attribute the backfill to the booking's own
    // creator so the audit trail stays truthful rather than inventing a system actor.
    const candidates = await sql<{ id: string; booking_number: string; customer_name: string; status: string; dealer_code: string | null; created_by: string }[]>`
      SELECT b.id, b.booking_number, b.customer_name, b.status, b.dealer_code, b.created_by
      FROM kia_bookings b
      WHERE b.deleted_at IS NULL
        AND b.status NOT IN ('delivered', 'cancelled')
        AND b.created_by IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM kia_lead_followups f WHERE f.booking_id = b.id)
      ORDER BY b.created_at`

    const [totals] = await sql<{ total: string; enrolled: string; skipped_terminal: string }[]>`
      SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM kia_lead_followups f WHERE f.booking_id = b.id))::text AS enrolled,
        count(*) FILTER (WHERE b.status IN ('delivered','cancelled'))::text AS skipped_terminal
      FROM kia_bookings b WHERE b.deleted_at IS NULL`

    console.log('=== Booking Follow-ups backfill ===')
    console.log(`  bookings (not deleted)      : ${totals.total}`)
    console.log(`  already in the pipeline     : ${totals.enrolled}`)
    console.log(`  skipped (delivered/cancelled): ${totals.skipped_terminal}`)
    console.log(`  TO ENROL                    : ${candidates.length}`)
    console.log('')

    if (!candidates.length) {
      console.log('Nothing to do.')
      process.exit(0)
    }

    for (const b of candidates.slice(0, 10)) {
      console.log(`   ${String(b.booking_number).padEnd(22)} ${String(b.customer_name).slice(0, 24).padEnd(25)} ${b.status}`)
    }
    if (candidates.length > 10) console.log(`   … and ${candidates.length - 10} more`)
    console.log('')

    if (!COMMIT) {
      console.log('DRY RUN — nothing written. Re-run with `commit` to enrol these.')
      process.exit(0)
    }

    const inserted = await sql`
      INSERT INTO kia_lead_followups (booking_id, due_at, status, reason, priority, assigned_to, dealer_code, source, notes, created_by)
      SELECT b.id, now(), 'pending', 'general', 'normal', NULL, b.dealer_code, 'manual',
             'Backfilled into Booking Follow-ups — this booking predates automatic enrolment.',
             b.created_by
      FROM kia_bookings b
      WHERE b.deleted_at IS NULL
        AND b.status NOT IN ('delivered', 'cancelled')
        AND b.created_by IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM kia_lead_followups f WHERE f.booking_id = b.id)
      RETURNING id`

    const [after] = await sql<{ n: string; unenrolled: string }[]>`
      SELECT
        (SELECT count(*)::text FROM kia_lead_followups) AS n,
        (SELECT count(*)::text FROM kia_bookings b WHERE b.deleted_at IS NULL
           AND b.status NOT IN ('delivered','cancelled')
           AND NOT EXISTS (SELECT 1 FROM kia_lead_followups f WHERE f.booking_id = b.id)) AS unenrolled`

    console.log(`ENROLLED ${inserted.length} booking(s).`)
    console.log(`  follow-up rows now          : ${after.n}`)
    console.log(`  active bookings still unenrolled: ${after.unenrolled} (should be 0)`)
    process.exit(Number(after.unenrolled) === 0 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Backfill failed:', error); process.exit(1) })
