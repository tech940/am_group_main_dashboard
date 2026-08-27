/**
 * Mark the August 2026 DMS retail sales as DELIVERED against their KIA bookings.
 *
 * ⚠️ DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * ── What this is ──────────────────────────────────────────────────────────────────────────────
 * The dealership's DMS SalesReport is the record of what was actually invoiced and handed over.
 * This dashboard's booking pipeline had drifted badly behind it: cars that left the showroom weeks
 * ago were still sitting in "Awaiting VIN" and "Payment Pending". This walks the sheet and brings
 * each sale's booking to `delivered`, on the DMS delivery date, carrying the DMS chassis number.
 *
 * THE SHEET IS AUTHORITATIVE. Where our records disagree they are overridden, because the sheet
 * describes a car that physically left the premises and our record describes an intention.
 *
 * ── Why matching is not a join ────────────────────────────────────────────────────────────────
 * There is no shared key. The sheet's `Booking No` is a DMS number (B2026…) that this system
 * records nowhere, and the phone is masked to its last four digits.
 *
 * ⚠️ Chassis numbers on bookings CANNOT be used as the key. Stale `allocated_vin` pointers are
 * systemic here — 18+ bookings carry a VIN whose allocation was released long ago. Matching on VIN
 * put SAHIL SHARMA's car on Chaman lal's booking, MADAN LAL's on Ajay kumar sharma's, and
 * RAHEEL MURTAZA NAZIR's on Kanav raina's: 7 of 11 "matches" were the wrong person.
 *
 * So the match is decided on CUSTOMER NAME + PHONE LAST-4 + DEALER + MODEL, adjudicated per row and
 * independently re-derived by an adversarial reviewer. This script only executes that decision —
 * it is deliberately not clever. `scratch/decisions.json` is the input.
 *
 * ── Side effects, and why each is here ────────────────────────────────────────────────────────
 * Delivery is not one column. The application's own delivery path does four more things, and
 * skipping them is how a bulk update quietly corrupts the module:
 *
 *   1. cancelKiaBookingFollowups — ⚠️ THE IMPORTANT ONE. The follow-up pipeline reads the table
 *      directly and EMAILS CUSTOMERS. Marking a booking delivered without closing its follow-ups
 *      leaves reminders going out to people whose car is already in their driveway.
 *   2. addActivity — the audit trail. A status change with no activity row is unattributable.
 *   3. createFinancePayoutForDeliveredBooking — the post-delivery payout ledger starts at delivery.
 *      Upserted, so it never wipes a figure finance already entered.
 *   4. local_status = 'retail' — the app-owned signal that keeps a sold car out of Available. It
 *      survives a DMS re-upload, which a write to kia_stock_management would not.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/kia-mark-august-delivered.ts
 *       npx tsx --tsconfig ./tsconfig.verify.json scripts/kia-mark-august-delivered.ts --apply
 */
import 'dotenv/config'
import fs from 'fs'
import { eq, sql } from 'drizzle-orm'
import { db } from '../lib/db'
import { kiaBookings } from '../lib/db/schema'
import { addActivity, createFinancePayoutForDeliveredBooking } from '../lib/kia/bookings'
import { cancelKiaBookingFollowups } from '../lib/kia/lead-followups'
import type { AppUser } from '../lib/auth/app-user'

const APPLY = process.argv.includes('--apply')
const DECISIONS = 'scratch/decisions.json'

/**
 * Attributed to the CXM, not to whoever ran the script.
 *
 * ⚠️ Marking a vehicle delivered is the CXM's step in this workflow (see lib/kia/workflow-access.ts
 * — cxm marks Delivered, ccm is the backup, crm is retired). The Stock > Delivered list renders
 * "delivered by" straight from kia_bookings.updated_by, so attributing the import to the MD who
 * requested it put the MD's name against 38 handovers he did not perform. The instruction is
 * recorded in each booking's metadata instead, which is where provenance belongs.
 */
const ACTOR: AppUser = {
  id: 'c07646b8-9863-41cb-a80f-61f8e5ea2a1a',
  supabaseId: 'c07646b8-9863-41cb-a80f-61f8e5ea2a1a',
  email: 'karnesh.uttam@jammuautomart.com',
  fullName: 'Karnesh Uttam',
  role: 'cxm' as AppUser['role'],
  brand: 'kia',
  dealers: 'JK402,JK501',
  department: null,
  isActive: true,
}

type Decision = {
  sheetRow: number
  sheetVin: string
  sheetName: string
  action: 'mark_delivered' | 'create_new'
  bookingNumber: string | null
  confidence: string
  evidence: string
  risk?: string
  sheet: {
    vin: string
    name: string
    dealer: string
    model: string
    variant: string
    color: string
    delivery: string
    dmsBooking: string
    phone4: string
  }
}

const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows || []))

/**
 * NOON India, not midnight.
 *
 * The sheet gives a calendar date and no time, and every month-scoped query in this module compares
 * a timestamptz against `date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')` — a bare timestamp
 * that Postgres resolves in the SERVER's zone. Midnight IST on the 1st sits 5h30m either side of
 * that boundary depending on which zone the server runs in, so it can fall out of its own month.
 * Noon cannot, in any zone on earth, and it is no less truthful: we know the day, not the hour.
 */
const noonIst = (ymd: string) => new Date(`${ymd}T12:00:00+05:30`)

async function main() {
  if (!fs.existsSync(DECISIONS)) {
    console.error(`missing ${DECISIONS} — run the adjudication first`)
    process.exit(1)
  }
  const decisions: Decision[] = JSON.parse(fs.readFileSync(DECISIONS, 'utf8'))
  const toDeliver = decisions.filter((d) => d.action === 'mark_delivered' && d.bookingNumber)
  const toCreate = decisions.filter((d) => d.action === 'create_new')

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — August 2026 deliveries from the DMS SalesReport\n`)
  console.log(`  ${decisions.length} sheet rows: ${toDeliver.length} onto existing bookings, ${toCreate.length} with no booking\n`)

  let delivered = 0
  let created = 0
  let followupsClosed = 0
  let claimsCleared = 0
  let allocationsReleased = 0

  for (const d of decisions) {
    const s = d.sheet
    const vin = String(d.sheetVin).toUpperCase().trim()
    const when = noonIst(s.delivery)

    if (d.action === 'create_new') {
      console.log(`  CREATE   row ${String(d.sheetRow).padStart(2)}  ${s.name.slice(0, 34).padEnd(34)} ${vin}  ${s.delivery}  [${d.confidence}]`)
      if (!APPLY) continue
      await db.transaction(async (tx) => {
        /*
         * ⚠️ Strip competing claims on the CREATE path too, not just when reconciling an existing
         * booking. Missing this left two chassis claimed twice: row 1's car was still pointed at by
         * Anish Kumar's live booking and row 18's by Chaman lal's, because a sale with no booking of
         * its own is exactly the case where some OTHER booking is holding a stale pointer to it.
         */
        const preCleared = await tx.execute(sql`
          UPDATE kia_bookings SET allocated_vin = NULL, updated_at = now(),
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'vinPointerCleared', jsonb_build_object(
                'vin', ${vin}::text,
                'why', 'DMS SalesReport records this chassis against another customer'::text,
                'at', now()::text))
          WHERE deleted_at IS NULL AND UPPER(BTRIM(COALESCE(allocated_vin, ''))) = ${vin}
          RETURNING id`)
        claimsCleared += rowsOf(preCleared).length

        const preReleased = await tx.execute(sql`
          UPDATE kia_vehicle_allocations SET released_at = now(), updated_at = now(),
            release_reason = 'Superseded by the DMS SalesReport: chassis retailed to another customer'
          WHERE released_at IS NULL AND UPPER(BTRIM(COALESCE(vin_number, ''))) = ${vin}
          RETURNING id`)
        allocationsReleased += rowsOf(preReleased).length

        const seqRes = await tx.execute(sql`SELECT nextval('public.kia_booking_number_seq')::text AS seq`)
        const raw = parseInt(rowsOf<{ seq: string }>(seqRes)[0]?.seq || '0', 10)
        const bookingNumber = `KIA_${s.dealer.replace(/[^A-Z0-9]/g, '')}_2026_${String(raw + 120000).padStart(6, '0')}`
        const [booking] = await tx.insert(kiaBookings).values({
          bookingNumber,
          customerName: s.name,
          /*
           * ⚠️ Empty, not the sheet's value. The sheet masks all but the last four digits
           * ("XXXXXX5477"), and a partial number sitting in a phone column is worse than no number:
           * the call-centre and follow-up surfaces will dial it. The four digits are preserved in
           * metadata, where they read as a fragment rather than a phone number.
           * The column is NOT NULL, so this is an empty string rather than null.
           */
          customerPhone: '',
          model: s.model,
          variant: s.variant,
          // NOT NULL. Left blank rather than invented — attributing these to a made-up consultant
          // would corrupt the Sales Performance leaderboard, which groups by this column.
          consultantName: '',
          color: s.color,
          dealerCode: s.dealer,
          status: 'delivered',
          deliveredAt: when,
          allocatedVin: vin,
          createdBy: ACTOR.id,
          updatedBy: ACTOR.id,
          metadata: {
            importedFrom: 'DMS SalesReport (August 2026)',
            dmsBookingNo: s.dmsBooking,
            phoneLast4: s.phone4,
            note: 'Created from the DMS sale; no booking existed in this system.',
          } as Record<string, unknown>,
        }).returning()
        await addActivity(tx, {
          bookingId: booking.id,
          type: 'delivered',
          title: 'Vehicle delivered',
          description: `Imported from the DMS SalesReport. Chassis ${vin}, delivered ${s.delivery}.`,
          appUser: ACTOR,
        })
        await createFinancePayoutForDeliveredBooking(tx, booking, ACTOR)
        created++
      })
      continue
    }

    const [existing] = await db.select().from(kiaBookings).where(eq(kiaBookings.bookingNumber, d.bookingNumber!)).limit(1)
    if (!existing || existing.deletedAt) {
      console.log(`  MISSING  row ${String(d.sheetRow).padStart(2)}  ${d.bookingNumber} not found — skipped`)
      continue
    }

    const was = `${existing.status}${existing.allocatedVin && existing.allocatedVin.toUpperCase() !== vin ? ` vin:${existing.allocatedVin}` : ''}`
    console.log(`  DELIVER  row ${String(d.sheetRow).padStart(2)}  ${d.bookingNumber} ${String(existing.customerName).slice(0, 22).padEnd(22)} ${was.padEnd(40)} -> delivered ${s.delivery} vin ${vin}  [${d.confidence}]`)
    if (!APPLY) continue

    await db.transaction(async (tx) => {
      /*
       * Strip every competing claim on this chassis FIRST. The sheet says this car went to this
       * customer; anything else pointing at it is stale by definition. Without this the module ends
       * up with two bookings claiming one physical car, which is the defect this whole exercise is
       * meant to remove.
       */
      const cleared = await tx.execute(sql`
        UPDATE kia_bookings SET allocated_vin = NULL, updated_at = now(),
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'vinPointerCleared', jsonb_build_object(
              'vin', ${vin}::text,
              'why', 'DMS SalesReport records this chassis against another customer'::text,
              'at', now()::text))
        WHERE deleted_at IS NULL AND id <> ${existing.id}::uuid
          AND UPPER(BTRIM(COALESCE(allocated_vin, ''))) = ${vin}
        RETURNING id`)
      claimsCleared += rowsOf(cleared).length

      // A live reservation on this chassis held by anyone else is likewise superseded.
      const releasedOthers = await tx.execute(sql`
        UPDATE kia_vehicle_allocations SET released_at = now(), updated_at = now(),
          release_reason = 'Superseded by the DMS SalesReport: chassis retailed to another customer'
        WHERE released_at IS NULL AND booking_id <> ${existing.id}::uuid
          AND UPPER(BTRIM(COALESCE(vin_number, ''))) = ${vin}
        RETURNING id`)

      /*
       * …and this booking's own reservation, when it is on a DIFFERENT car. That other vehicle was
       * never handed over, so leaving it reserved would keep a genuinely available car off the
       * Available list indefinitely.
       */
      const releasedOwn = await tx.execute(sql`
        UPDATE kia_vehicle_allocations SET released_at = now(), updated_at = now(),
          release_reason = 'Customer took a different vehicle per the DMS SalesReport'
        WHERE released_at IS NULL AND booking_id = ${existing.id}::uuid
          AND UPPER(BTRIM(COALESCE(vin_number, ''))) <> ${vin}
        RETURNING id`)
      allocationsReleased += rowsOf(releasedOthers).length + rowsOf(releasedOwn).length

      /*
       * Where the reservation IS on the delivered car, settle it rather than release it — that is
       * the state the 12 pre-existing delivered bookings are in.
       *
       * ⚠️ Clearing expires_at is the point. A delivery recorded while the allocation is still
       * 'temporary' leaves the reservation clock running, and expireKiaTemporaryAllocations would
       * then rewrite the booking to 'proforma_generated' and return the car to free stock — it
       * un-delivers a car that is already with its owner. The sweep now refuses delivered bookings
       * outright; this makes the data correct as well, so neither guard is load-bearing alone.
       */
      await tx.execute(sql`
        UPDATE kia_vehicle_allocations
        SET allocation_status = 'final', stock_status = 'final', expires_at = NULL, updated_at = now()
        WHERE released_at IS NULL AND booking_id = ${existing.id}::uuid
          AND UPPER(BTRIM(COALESCE(vin_number, ''))) = ${vin}
          AND allocation_status <> 'final'`)

      const [booking] = await tx.update(kiaBookings).set({
        status: 'delivered',
        deliveredAt: when,
        allocatedVin: vin,
        updatedBy: ACTOR.id,
        updatedAt: new Date(),
        metadata: {
          ...((existing.metadata || {}) as Record<string, unknown>),
          augustDeliveryImport: {
            source: 'DMS SalesReport (August 2026)',
            dmsBookingNo: s.dmsBooking,
            assignedVin: vin,
            priorStatus: existing.status,
            priorAllocatedVin: existing.allocatedVin || '',
            matchedOn: d.evidence,
            at: new Date().toISOString(),
          },
        } as Record<string, unknown>,
      }).where(eq(kiaBookings.id, existing.id)).returning()

      await addActivity(tx, {
        bookingId: existing.id,
        type: 'delivered',
        title: 'Vehicle delivered',
        description: `Reconciled against the DMS SalesReport. Chassis ${vin}, delivered ${s.delivery}.`
          + (existing.allocatedVin && existing.allocatedVin.toUpperCase() !== vin
            ? ` Previously recorded against ${existing.allocatedVin}.` : ''),
        before: existing as unknown as Record<string, unknown>,
        after: booking as unknown as Record<string, unknown>,
        appUser: ACTOR,
      })

      // ⚠️ Stops the reminder emails. See the header.
      followupsClosed += await cancelKiaBookingFollowups(tx, existing.id, 'vehicle delivered')

      await createFinancePayoutForDeliveredBooking(tx, booking, ACTOR)

      await tx.execute(sql`
        INSERT INTO kia_stock_local_statuses
          (vin_number, local_status, booking_no, customer_name, stock_status_at_mark, notes, marked_by, marked_by_name, marked_by_role)
        VALUES (${vin}, 'retail', ${booking.bookingNumber}, ${booking.customerName},
                'Retail — reconciled from the DMS SalesReport',
                'August 2026 delivery import', ${ACTOR.id}::uuid, ${ACTOR.fullName}, ${ACTOR.role})
        ON CONFLICT (vin_number) DO UPDATE SET
          local_status = 'retail', booking_no = EXCLUDED.booking_no,
          customer_name = EXCLUDED.customer_name, updated_at = now()`)

      delivered++
    })
  }

  console.log(`\n${APPLY ? 'WROTE' : 'WOULD WRITE'}:`)
  console.log(`  bookings marked delivered   : ${APPLY ? delivered : toDeliver.length}`)
  console.log(`  bookings created            : ${APPLY ? created : toCreate.length}`)
  if (APPLY) {
    console.log(`  pending follow-ups closed   : ${followupsClosed}`)
    console.log(`  stale chassis claims cleared: ${claimsCleared}`)
    console.log(`  allocations released        : ${allocationsReleased}`)
  }
  if (!APPLY) console.log('\nNothing was written. Re-run with --apply.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
