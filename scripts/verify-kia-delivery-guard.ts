/**
 * Proves the KIA delivery rule end to end: a booking reaches 'delivered' only with an allotted vehicle
 * whose payment Accounts confirmed, from EVERY path — the Bookings button, a raw status change, and a
 * follow-up closed as Converted / Delivered — and it carries the chassis when it gets there.
 *
 * Runs the real server code against the real database inside ONE transaction that is always rolled
 * back (tsconfig.hp-flow.json maps @/lib/db to the rollback shim), on a throwaway booking it creates.
 * Nothing it writes survives. No email path is reachable from these functions.
 *
 *   npm run verify:kia-delivery-guard
 */
import { sql } from 'drizzle-orm'
import { realDb, testClient, useOuterTransaction } from './_shims/hp-test-db'
import type { AppUser } from '../lib/auth/app-user'
import { KIA_WORKFLOW_OWNED_STATUSES, updateKiaBooking } from '../lib/kia/bookings'
import { completeFollowup, updateFollowup } from '../lib/kia/lead-followups'

class Rollback extends Error {}
let failures = 0
function assert(label: string, condition: boolean, detail = '') {
  if (condition) console.log(`  [PASS] ${label}`)
  else { failures += 1; console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`) }
}
async function refused(run: () => Promise<unknown>, pattern: RegExp): Promise<string | true> {
  try { await run() } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return pattern.test(message) ? true : message
  }
  return 'was accepted'
}
type Row = Record<string, unknown>
const one = async (tx: typeof realDb, query: ReturnType<typeof sql>) => ((await tx.execute(query)) as unknown as Row[])[0]

async function main() {
  console.log('\n1) Which statuses a bare status write may not set')
  for (const s of ['vehicle_allocated', 'transferring', 'transfer_requested', 'payment_confirmed', 'ready_delivery', 'delivered']) {
    assert(`'${s}' belongs to its own step`, KIA_WORKFLOW_OWNED_STATUSES.has(s))
  }
  for (const s of ['pending', 'fake_booking', 'demo_vehicle', 'repeated_booking', 'booking_created', 'proforma_generated']) {
    assert(`'${s}' may still be set as a tag`, !KIA_WORKFLOW_OWNED_STATUSES.has(s))
  }

  console.log('\n2) The real server code, against the database, rolled back')
  const [user] = (await realDb.execute(sql`SELECT id FROM public.users WHERE is_active ORDER BY created_at LIMIT 1`)) as unknown as Array<{ id: string }>
  const base = { id: user.id, supabaseId: user.id, email: 'delivery-guard@test', fullName: 'Guard Tester', brand: 'kia', dealers: null, department: null, isActive: true }
  const as = (role: string) => ({ ...base, role }) as unknown as AppUser
  const ccm = as('ccm'), cre = as('cre'), sales = as('sales_executive'), dev = as('developer')
  const VIN = 'TESTGUARDVIN0001'
  const tag = `KIA_TEST_GUARD_${Date.now()}`

  try {
    await realDb.transaction(async (tx) => {
      useOuterTransaction(tx as unknown as typeof realDb)
      const newBooking = async (suffix: string) => (await one(tx as unknown as typeof realDb, sql`
        INSERT INTO kia_bookings (booking_number, status, dealer_code, customer_name, customer_phone, model, variant, consultant_name, created_by, proforma_id)
        VALUES (${`${tag}_${suffix}`}, 'proforma_generated', 'JK501', 'Delivery Guard Test', ${`TEST-${tag}-${suffix}`}, 'SONET', 'Sonet G1.2 5MT HTK', 'Guard', ${user.id}, NULL)
        RETURNING id::text AS id`)).id as string
      const newFollowup = async (bookingId: string) => (await one(tx as unknown as typeof realDb, sql`
        INSERT INTO kia_lead_followups (booking_id, due_at, created_by) VALUES (${bookingId}::uuid, now(), ${user.id})
        RETURNING id::text AS id`)).id as string
      const booking = async (id: string) => one(tx as unknown as typeof realDb, sql`
        SELECT status, allocated_vin, delivered_at FROM kia_bookings WHERE id = ${id}::uuid`)
      const setStatus = (id: string, status: string) => tx.execute(sql`UPDATE kia_bookings SET status = ${status} WHERE id = ${id}::uuid`)

      const b = await newBooking('A')
      const f = await newFollowup(b)

      console.log('\n   No vehicle allotted (how Tahar mohd, Khurshid ahmed, Panniru Nagendra and Udhay Partap were delivered)')
      let r = await refused(() => completeFollowup(ccm, f, { outcome: 'converted', notes: 'Delivered' }), /No vehicle is allotted/)
      assert('the CCM cannot close a follow-up as Converted / Delivered', r === true, String(r))
      assert('…the booking is untouched and the follow-up stays open', (await booking(b)).status === 'proforma_generated'
        && (await one(tx as unknown as typeof realDb, sql`SELECT status FROM kia_lead_followups WHERE id = ${f}::uuid`)).status === 'pending')
      r = await refused(() => completeFollowup(cre, f, { outcome: 'converted', notes: 'Customer bought it' }), /No vehicle is allotted/)
      assert('a CRE cannot mark it Converted either', r === true, String(r))
      r = await refused(() => completeFollowup(ccm, f, { outcome: 'done', notes: 'x', bookingStatus: 'delivered' }), /cannot set the booking to 'delivered'/)
      assert("a follow-up cannot write status 'delivered' directly", r === true, String(r))
      r = await refused(() => updateFollowup(ccm, f, { notes: 'x', bookingStatus: 'ready_delivery' }), /cannot set the booking to 'ready delivery'/)
      assert("…nor 'ready_delivery' (which would fake a payment)", r === true, String(r))
      r = await refused(() => updateKiaBooking(b, { delivered: true }, ccm), /No vehicle is allotted/)
      assert('the Bookings "Mark Delivered" path refuses it', r === true, String(r))
      r = await refused(() => updateKiaBooking(b, { status: 'delivered' }, ccm), /No vehicle is allotted/)
      assert("a raw status change to 'delivered' is a delivery and is refused the same way", r === true, String(r))
      r = await refused(() => updateKiaBooking(b, { status: 'ready_delivery' }, sales), /set by its own step/)
      assert("a sales executive cannot set 'ready_delivery' by editing the status", r === true, String(r))
      await updateKiaBooking(b, { status: 'ready_delivery' }, dev)
      r = await refused(() => updateKiaBooking(b, { delivered: true }, ccm), /No vehicle is allotted/)
      assert("even when a developer forces 'ready_delivery', delivery still needs the vehicle", r === true, String(r))
      await updateFollowup(ccm, f, { notes: 'Customer asked to wait', bookingStatus: 'pending' })
      assert("follow-up tags such as 'pending' still work", (await booking(b)).status === 'pending')

      console.log('\n   Vehicle allotted, payment not confirmed')
      await setStatus(b, 'vehicle_allocated')
      const alloc = (await one(tx as unknown as typeof realDb, sql`
        INSERT INTO kia_vehicle_allocations (booking_id, vin_number, allocated_by, allocation_status, expires_at)
        VALUES (${b}::uuid, ${VIN}, ${user.id}, 'temporary', now() + interval '5 days')
        RETURNING id::text AS id`)).id as string
      r = await refused(() => completeFollowup(ccm, f, { outcome: 'converted', notes: 'Delivered' }), /has not confirmed payment/)
      assert('Converted is refused until Accounts confirms payment', r === true, String(r))
      await setStatus(b, 'ready_delivery')
      r = await refused(() => updateKiaBooking(b, { delivered: true }, ccm), /has not confirmed payment/)
      assert('a ready_delivery status with no recorded payment is not enough', r === true, String(r))

      console.log('\n   Vehicle allotted and paid')
      await tx.execute(sql`UPDATE kia_vehicle_allocations SET payment_confirmed_at = now(), allocation_status = 'final', expires_at = NULL WHERE id = ${alloc}::uuid`)
      await completeFollowup(cre, f, { outcome: 'converted', notes: 'Customer confirmed' })
      assert('a CRE may now record Converted, and the car is NOT delivered by it', (await booking(b)).status === 'ready_delivery')
      const f2 = await newFollowup(b)
      await completeFollowup(ccm, f2, { outcome: 'converted', notes: 'Delivered' })
      const delivered = await booking(b)
      assert('the CCM’s Converted delivers it', delivered.status === 'delivered' && Boolean(delivered.delivered_at))
      assert('…with the allotted chassis on the booking', delivered.allocated_vin === VIN, String(delivered.allocated_vin))
      const payout = await one(tx as unknown as typeof realDb, sql`SELECT count(*)::int AS n FROM kia_finance_payouts WHERE booking_id = ${b}::uuid`)
      assert('…and the finance payout row opens, as before', Number(payout.n) === 1)
      const f3 = await newFollowup(b)
      await completeFollowup(ccm, f3, { outcome: 'converted', notes: 'Delivered again' })
      const again = await booking(b)
      assert('closing another follow-up on a delivered booking does not re-deliver it', String(again.delivered_at) === String(delivered.delivered_at))

      console.log('\n   One chassis, two customers')
      // Only one LIVE allocation per VIN can exist (kia_vehicle_allocations_active_vin_idx), so the
      // real way this happens is the stale pointer: the first booking's allotment was released (the
      // expiry sweep does this) while its allocated_vin stayed, and the car was allotted again.
      await tx.execute(sql`UPDATE kia_vehicle_allocations SET released_at = now() WHERE id = ${alloc}::uuid`)
      const c = await newBooking('B')
      await setStatus(c, 'ready_delivery')
      await tx.execute(sql`
        INSERT INTO kia_vehicle_allocations (booking_id, vin_number, allocated_by, allocation_status, payment_confirmed_at)
        VALUES (${c}::uuid, ${VIN}, ${user.id}, 'final', now())`)
      r = await refused(() => updateKiaBooking(c, { delivered: true }, ccm), /already delivered on booking/)
      assert('a chassis already delivered on another booking cannot be delivered again', r === true, String(r))
      r = await refused(() => updateKiaBooking(c, { delivered: true }, sales), /Only CXM or CCM/)
      assert('only CXM / CCM / admin may deliver at all', r === true, String(r))

      console.log('\n   The database backstop (kia-delivery/0001)')
      const trigger = await one(tx as unknown as typeof realDb, sql`
        SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.kia_bookings'::regclass AND tgname = 'kia_bookings_require_vin_on_delivery'`)
      if (Number(trigger.n) === 1) {
        await tx.execute(sql`SAVEPOINT backstop`)
        let blocked = false
        try { await tx.execute(sql`UPDATE kia_bookings SET status = 'delivered' WHERE id = ${c}::uuid AND allocated_vin IS NULL`) } catch { blocked = true }
        await tx.execute(sql`ROLLBACK TO SAVEPOINT backstop`)
        assert('a bare UPDATE to delivered with no VIN is refused by the database itself', blocked)
      } else {
        assert('the kia-delivery/0001 trigger is applied', false, 'run scripts/apply-kia-delivery-vin-guard.ts')
      }
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) { failures += 1; console.error('\n[FAIL] the flow stopped:', error) }
  } finally {
    useOuterTransaction(null)
  }
  const [left] = (await realDb.execute(sql`SELECT count(*)::int AS n FROM kia_bookings WHERE booking_number LIKE ${`${tag}%`}`)) as unknown as Array<{ n: number }>
  assert('nothing the test wrote survived', left.n === 0, String(left.n))

  console.log('\n3) This month on the Stock board')
  const vinless = (await realDb.execute(sql`
    SELECT booking_number, customer_name FROM kia_bookings
    WHERE deleted_at IS NULL AND status = 'delivered' AND COALESCE(BTRIM(allocated_vin), '') = ''
      AND delivered_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
    ORDER BY delivered_at`)) as unknown as Array<{ booking_number: string; customer_name: string }>
  console.log(`  delivered this month with no VIN: ${vinless.length}${vinless.length ? ` (${vinless.map((v) => `${v.customer_name} ${v.booking_number}`).join(', ')})` : ''}`)

  await testClient.end({ timeout: 5 })
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.')
  process.exit(failures ? 1 : 0)
}

main().catch(async (error) => {
  console.error(error)
  await testClient.end({ timeout: 5 }).catch(() => {})
  process.exit(1)
})
