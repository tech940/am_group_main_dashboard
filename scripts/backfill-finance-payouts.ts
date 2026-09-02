/**
 * Put already-completed financings onto the Finance Payouts ledger.
 *
 * ⚠️ DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * ── Why these were missed ─────────────────────────────────────────────────────────────────────
 * A payout row was only ever created when a booking was marked DELIVERED. But financing can be
 * completed without a delivery — once Accounts confirms payment received, or outright by a Finance
 * Head / admin / MD. Those completed financings never reached the payouts desk.
 *
 * The code path is fixed (markKiaFinanceComplete now creates the row in the same transaction as the
 * status change). This backfills the ones completed before that.
 *
 * ⚠️ Excludes CANCELLED bookings — there is no payout to collect on a sale that did not happen —
 * and any financing with no booking link, since the ledger's unique key is the booking.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/backfill-finance-payouts.ts
 *       ... --apply
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { kiaBookings } from '../lib/db/schema'
import { upsertFinancePayoutForBooking } from '../lib/kia/bookings'
import type { AppUser } from '../lib/auth/app-user'

const APPLY = process.argv.includes('--apply')

type Candidate = {
  processing_id: string
  booking_id: string | null
  booking_number: string | null
  customer_name: string | null
  booking_status: string | null
  finance_required: boolean | null
  bank_name: string | null
  completed_at: string | null
}

async function main() {
  const rows = await analyticsExecute<Candidate>(sql`
    SELECT f.id::text AS processing_id, f.booking_id::text AS booking_id,
           b.booking_number, b.customer_name, b.status AS booking_status,
           b.finance_required, b.bank_name, f.completed_at::text AS completed_at
    FROM kia_finance_processing f
    LEFT JOIN kia_finance_payouts p ON p.booking_id = f.booking_id
    LEFT JOIN kia_bookings b ON b.id = f.booking_id
    WHERE f.finance_status = 'completed' AND p.id IS NULL
    ORDER BY f.completed_at DESC NULLS LAST`)

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — completed financings with no payout row\n`)
  console.log(`  ${rows.length} candidate(s)\n`)

  const eligible: Candidate[] = []
  for (const r of rows) {
    let skip: string | null = null
    if (!r.booking_id) skip = 'no booking link — the ledger is keyed on the booking'
    else if (r.booking_status === 'cancelled') skip = 'booking is CANCELLED — nothing to collect'
    else if (!r.booking_number) skip = 'booking row not found'
    if (skip) {
      console.log(`  SKIP  ${String(r.booking_number ?? '(none)').padEnd(24)} ${skip}`)
      continue
    }
    eligible.push(r)
    console.log(`  ADD   ${String(r.booking_number).padEnd(24)} ${String(r.customer_name ?? '-').slice(0, 22).padEnd(22)}`
      + ` ${String(r.booking_status).padEnd(18)} finance=${r.finance_required} bank=${r.bank_name ?? '-'}`)
  }

  console.log(`\n  ${eligible.length} to add, ${rows.length - eligible.length} skipped`)

  if (!APPLY) {
    console.log('\nNothing was written. Re-run with --apply.')
    process.exit(0)
  }

  /*
   * The system actor. These rows are created by a migration, not by a person, and stamping a real
   * user id would put someone's name against a decision they did not make.
   */
  const actor = { id: null, role: 'developer', fullName: 'Backfill (finance completion)' } as unknown as AppUser

  let written = 0
  for (const r of eligible) {
    await db.transaction(async (tx) => {
      const [booking] = await tx.select().from(kiaBookings).where(eq(kiaBookings.id, r.booking_id!)).limit(1)
      if (!booking) return
      const result = await upsertFinancePayoutForBooking(tx, booking, actor, 'finance_complete')
      if (!result.skipped) written += 1
    })
  }
  console.log(`\nwritten: ${written} payout row(s).`)

  const [after] = await analyticsExecute<{ missing: number }>(sql`
    SELECT COUNT(*)::int AS missing
    FROM kia_finance_processing f
    LEFT JOIN kia_finance_payouts p ON p.booking_id = f.booking_id
    LEFT JOIN kia_bookings b ON b.id = f.booking_id
    WHERE f.finance_status = 'completed' AND p.id IS NULL
      AND f.booking_id IS NOT NULL AND COALESCE(b.status, '') <> 'cancelled'`)
  console.log(`remaining eligible-but-missing: ${after.missing} (expected 0)`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
