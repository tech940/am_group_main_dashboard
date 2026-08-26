/**
 * Proof of the KIA part-payment rules.
 *
 * ⚠️ READ THIS BEFORE EDITING. An earlier version of this script called
 * `expireKiaTemporaryAllocations()` directly to prove the release exemption. That function is a
 * GLOBAL sweep — it does not take a booking id — so running it from a test executes the real
 * production release across every expired allocation in the database. It happened to release nothing
 * that day, which was luck, not design.
 *
 * So the sweep is now verified by running its PREDICATE as a read-only SELECT and comparing the
 * before/after row sets. That proves the same thing (which rows the sweep would take) without
 * writing anything, and it will keep proving it as the predicate changes, because the predicate is
 * pasted from the sweep itself.
 *
 * Everything else runs against a scratch booking created and deleted inside this script.
 *
 * Run: npx tsx --tsconfig ./tsconfig.verify.json scratch/verify-kia-part-payments.ts
 */
import 'dotenv/config'
import { eq, sql } from 'drizzle-orm'
import { db } from '../lib/db'
import { kiaBookingPayments, kiaBookings, kiaVehicleAllocations, users } from '../lib/db/schema'
import { recordKiaBookingPartialPayment, reverseKiaBookingPayment } from '../lib/kia/bookings'
import { KIA_PAYMENT_SECURED_THRESHOLD } from '../lib/kia/workflow-access'
import type { AppUser } from '../lib/auth/app-user'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures++; console.log(`  [FAIL] ${m}`) }
const check = (c: boolean, m: string) => (c ? ok(m) : fail(m))
const R = (n: number) => `Rs${Math.round(n).toLocaleString('en-IN')}`

/** Verbatim from expireKiaTemporaryAllocations (lib/kia/bookings.ts) — as a SELECT, not an UPDATE. */
const sweepWouldTake = async () => {
  const res = await db.execute(sql`
    SELECT id FROM kia_vehicle_allocations
    WHERE released_at IS NULL
      AND payment_confirmed_at IS NULL
      AND payment_secured_at IS NULL
      AND allocation_status = 'temporary'
      AND expires_at IS NOT NULL
      AND expires_at <= now()`)
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as { id: string }[]
  return new Set(rows.map((r) => r.id))
}

async function main() {
  const [actor] = await db.select().from(users).where(eq(users.role, 'accounts')).limit(1)
  if (!actor) throw new Error('no accounts user to act as')
  const appUser = actor as unknown as AppUser
  console.log(`acting as ${actor.email}\n`)

  const stamp = Date.now()
  let bookingId = ''
  let allocationId = ''

  try {
    // ── A scratch booking + allocation of our own. Nothing real is touched. ────────────────────
    const [booking] = await db.insert(kiaBookings).values({
      bookingNumber: `VERIFY_PARTPAY_${stamp}`,
      status: 'vehicle_allocated',
      dealerCode: 'JK402',
      customerName: 'Verification Scratch',
      customerPhone: '0000000000',
      model: 'SONET', variant: 'HTK',
      consultantName: 'verification',
      createdBy: actor.id,
    }).returning()
    bookingId = booking.id

    const [allocation] = await db.insert(kiaVehicleAllocations).values({
      bookingId: booking.id,
      vinNumber: `VERIFYVIN${stamp}`,
      allocationStatus: 'temporary',
      // Already overdue, so the sweep predicate would take it the moment it is not secured.
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      paymentWindowHours: 72,
      allocatedBy: actor.id,
    }).returning()
    allocationId = allocation.id
    console.log(`scratch booking ${booking.bookingNumber} / allocation ${allocationId.slice(0, 8)}\n`)

    const readAlloc = async () => (await db.select().from(kiaVehicleAllocations).where(eq(kiaVehicleAllocations.id, allocationId)).limit(1))[0]

    // ── 1. The sweep WOULD take it while unsecured ─────────────────────────────────────────────
    console.log('1) Baseline: an overdue, unsecured allocation is in the sweep set')
    check((await sweepWouldTake()).has(allocationId), 'sweep predicate matches it before any payment')

    // ── 2. Ledger arithmetic + the threshold boundary ──────────────────────────────────────────
    console.log('\n2) Ledger arithmetic and the threshold boundary')
    const r1 = await recordKiaBookingPartialPayment(bookingId, { amount: '1,00,000', paymentMode: 'NEFT' }, appUser)
    check(r1.totalReceived === 100000, `Rs1L recorded, total ${R(r1.totalReceived)}`)
    check(!r1.secured, 'Rs1L does not secure')
    check((await sweepWouldTake()).has(allocationId), 'still in the sweep set at Rs1L (the MD rule: under the threshold it can still lapse)')

    const r2 = await recordKiaBookingPartialPayment(bookingId, { amount: String(KIA_PAYMENT_SECURED_THRESHOLD - 100000) }, appUser)
    check(r2.totalReceived === KIA_PAYMENT_SECURED_THRESHOLD, `total is exactly ${R(KIA_PAYMENT_SECURED_THRESHOLD)}`)
    check(!r2.secured, 'exactly Rs7,00,000 does NOT secure (strictly greater than)')
    check((await sweepWouldTake()).has(allocationId), 'still in the sweep set at exactly the threshold')

    const r3 = await recordKiaBookingPartialPayment(bookingId, { amount: '1' }, appUser)
    check(r3.secured && r3.securedChanged, 'one rupee over the threshold secures it')

    // ── 3. THE HEADLINE RULE ───────────────────────────────────────────────────────────────────
    console.log('\n3) The release exemption')
    check(!(await sweepWouldTake()).has(allocationId), 'SECURED + overdue: the sweep no longer matches it')
    const sec = await readAlloc()
    check(sec.expiresAt !== null, 'expires_at was preserved, not nulled (so the deadline can be restored)')
    check(sec.paymentSecuredAt !== null, 'payment_secured_at is stamped')

    // ── 4. Reversal un-secures and re-arms ─────────────────────────────────────────────────────
    console.log('\n4) Reversal')
    const rows = await db.select().from(kiaBookingPayments).where(eq(kiaBookingPayments.bookingId, bookingId))
    const crossing = rows.find((r) => Number(r.amount) === 1)!
    const rev = await reverseKiaBookingPayment(bookingId, { paymentId: crossing.id, reason: 'verification' }, appUser)
    check(rev.totalReceived === KIA_PAYMENT_SECURED_THRESHOLD, `total back to ${R(rev.totalReceived)}`)
    check(!rev.secured && rev.securedChanged, 'no longer secured')
    const un = await readAlloc()
    check(!!un.expiresAt && un.expiresAt.getTime() > Date.now(), 'clock re-armed into the FUTURE, not left stale in the past')
    check(!(await sweepWouldTake()).has(allocationId), 'and therefore not in the sweep set either (the deadline is fresh)')

    let twice = false
    try { await reverseKiaBookingPayment(bookingId, { paymentId: crossing.id }, appUser); twice = true } catch { /* expected */ }
    check(!twice, 'the same payment cannot be reversed twice')

    // ── 5. Ledger integrity ────────────────────────────────────────────────────────────────────
    console.log('\n5) Ledger integrity')
    const all = await db.select().from(kiaBookingPayments).where(eq(kiaBookingPayments.bookingId, bookingId))
    const sum = all.reduce((t, r) => t + Number(r.amount), 0)
    const [bk] = await db.select({ amt: kiaBookings.amountReceived }).from(kiaBookings).where(eq(kiaBookings.id, bookingId))
    check(Math.abs(sum - Number(bk.amt)) < 0.01, `ledger sums to the stored total (${R(sum)} = ${R(Number(bk.amt))})`)
    check(all.filter((r) => r.entryType === 'reversal').every((r) => Number(r.amount) < 0), 'every reversal row is negative')
    check(all.filter((r) => r.entryType === 'payment').every((r) => Number(r.amount) > 0), 'every payment row is positive')

    for (const [amount, label] of [['0', 'zero'], ['-500', 'negative'], ['abc', 'non-numeric']] as const) {
      let accepted = false
      try { await recordKiaBookingPartialPayment(bookingId, { amount }, appUser); accepted = true } catch { /* expected */ }
      check(!accepted, `${label} amount rejected`)
    }
  } finally {
    console.log('\n6) Cleanup')
    if (bookingId) {
      await db.delete(kiaBookingPayments).where(eq(kiaBookingPayments.bookingId, bookingId))
      await db.delete(kiaVehicleAllocations).where(eq(kiaVehicleAllocations.bookingId, bookingId))
      await db.execute(sql`DELETE FROM kia_booking_activity WHERE booking_id = ${bookingId}`)
      await db.delete(kiaBookings).where(eq(kiaBookings.id, bookingId))
    }
    const [left] = (await db.execute(sql`
      SELECT (SELECT COUNT(*)::int FROM kia_bookings WHERE booking_number LIKE 'VERIFY_PARTPAY_%') AS bookings,
             (SELECT COUNT(*)::int FROM kia_vehicle_allocations WHERE vin_number LIKE 'VERIFYVIN%') AS allocs
    `) as unknown as Record<string, number>[])
    check(left.bookings === 0 && left.allocs === 0, 'scratch booking and allocation removed')
  }

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
