/**
 * Proves a recorded part payment is actually VISIBLE in both places it should be:
 *   1. the Allocation History trail (per-allocation count + total, and the SECURED marker)
 *   2. the per-booking receipts list the Stock chip opens
 *
 * Uses a scratch booking + allocation it creates and deletes. Nothing real is touched, and no sweep
 * is executed — see the header of verify-kia-part-payments.ts for why that matters.
 *
 * Run: npx tsx --tsconfig ./tsconfig.verify.json scratch/verify-payment-visibility.ts
 */
import 'dotenv/config'
import { eq, sql } from 'drizzle-orm'
import { db } from '../lib/db'
import { kiaBookingPayments, kiaBookings, kiaVehicleAllocations, users } from '../lib/db/schema'
import { getKiaBookingPayments, recordKiaBookingPartialPayment, reverseKiaBookingPayment } from '../lib/kia/bookings'
import { getAllocationHistory } from '../lib/kia/allocation-history'
import type { AppUser } from '../lib/auth/app-user'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures++; console.log(`  [FAIL] ${m}`) }
const check = (c: boolean, m: string) => (c ? ok(m) : fail(m))
const R = (n: number) => `Rs${Math.round(n).toLocaleString('en-IN')}`

async function main() {
  const [actor] = await db.select().from(users).where(eq(users.role, 'accounts')).limit(1)
  if (!actor) throw new Error('no accounts user')
  const appUser = actor as unknown as AppUser
  const stamp = Date.now()
  let bookingId = ''

  try {
    const [booking] = await db.insert(kiaBookings).values({
      bookingNumber: `VERIFY_VIS_${stamp}`, status: 'vehicle_allocated', dealerCode: 'JK402',
      customerName: 'Visibility Scratch', customerPhone: '0000000000',
      model: 'SONET', variant: 'HTK', consultantName: 'verification', createdBy: actor.id,
    }).returning()
    bookingId = booking.id

    await db.insert(kiaVehicleAllocations).values({
      bookingId: booking.id, vinNumber: `VISVIN${stamp}`, allocationStatus: 'temporary',
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000), paymentWindowHours: 72,
      allocatedBy: actor.id, model: 'SONET', variant: 'HTK', dealerCode: 'JK402',
    })

    console.log('1) Record three payments, one of which crosses the threshold')
    await recordKiaBookingPartialPayment(bookingId, { amount: '100000', paymentMode: 'NEFT', reference: 'TXN-A' }, appUser)
    await recordKiaBookingPartialPayment(bookingId, { amount: '250000', paymentMode: 'RTGS', reference: 'TXN-B' }, appUser)
    const third = await recordKiaBookingPartialPayment(bookingId, { amount: '400000', paymentMode: 'CHEQUE', reference: 'CHQ-9' }, appUser)
    check(third.totalReceived === 750000, `total ${R(third.totalReceived)}`)
    check(third.secured, 'crossed the threshold, so the allocation is secured')

    console.log('\n2) The receipts list the Stock chip opens')
    const ledger = await getKiaBookingPayments(bookingId)
    check(ledger.length === 3, `${ledger.length} entries returned`)
    check(ledger.every((e) => e.recordedByName === actor.fullName), 'every entry names who recorded it')
    check(ledger.some((e) => e.reference === 'CHQ-9' && e.paymentMode === 'CHEQUE'), 'mode and reference are carried through')
    const totals = ledger.map((e) => Number(e.totalAfter)).sort((a, b) => a - b)
    check(JSON.stringify(totals) === JSON.stringify([100000, 350000, 750000]),
      `running totals read ${totals.map(R).join(' -> ')}`)

    console.log('\n3) The Allocation History trail')
    const hist = await getAllocationHistory({ search: `VISVIN${stamp}`, pageSize: 10 })
    const row = hist.rows[0]
    check(Boolean(row), 'the allocation appears in the trail')
    if (row) {
      check(row.paymentCount === 3, `payment count ${row.paymentCount}`)
      check(Math.abs(row.paymentTotal - 750000) < 0.01, `payment total ${R(row.paymentTotal)}`)
      check(Math.abs(row.bookingReceivedTotal - 750000) < 0.01, `booking total ${R(row.bookingReceivedTotal)}`)
      check(row.paymentSecuredAt !== null, 'the SECURED marker is on the trail row')
    }

    console.log('\n4) A reversal shows up in both, and nets off')
    const chq = ledger.find((e) => e.reference === 'CHQ-9')!
    const rev = await reverseKiaBookingPayment(bookingId, { paymentId: chq.id, reason: 'wrong cheque' }, appUser)
    check(rev.totalReceived === 350000, `total back to ${R(rev.totalReceived)}`)

    const ledger2 = await getKiaBookingPayments(bookingId)
    check(ledger2.length === 4, 'the reversal is a NEW row — the original is still visible')
    check(ledger2.some((e) => e.entryType === 'reversal' && Number(e.amount) === -400000), 'reversal row is negative')

    const hist2 = await getAllocationHistory({ search: `VISVIN${stamp}`, pageSize: 10 })
    const row2 = hist2.rows[0]
    check(Math.abs(row2.paymentTotal - 350000) < 0.01, `trail total nets down to ${R(row2.paymentTotal)}`)
    check(row2.paymentCount === 3, 'the trail still counts 3 payments (a reversal is not a 4th payment)')
    check(row2.paymentSecuredAt === null, 'the SECURED marker cleared once it dropped below the threshold')
  } finally {
    console.log('\n5) Cleanup')
    if (bookingId) {
      await db.delete(kiaBookingPayments).where(eq(kiaBookingPayments.bookingId, bookingId))
      await db.delete(kiaVehicleAllocations).where(eq(kiaVehicleAllocations.bookingId, bookingId))
      await db.execute(sql`DELETE FROM kia_booking_activity WHERE booking_id = ${bookingId}`)
      await db.delete(kiaBookings).where(eq(kiaBookings.id, bookingId))
    }
    const [left] = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM kia_bookings WHERE booking_number LIKE 'VERIFY_VIS_%'
    `) as unknown as { n: number }[])
    check(left.n === 0, 'scratch booking removed')
  }

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
