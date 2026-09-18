/**
 * Raises two KIA discount requests from the backend (owner, 2026-09-18). DRY RUN unless --apply.
 * Requests only — each enters the normal chain (GSM/SM → CEO → MD over ₹5,000 → Accounts); nothing is approved.
 *
 *  - Sumaya Fatima Shad (DMS C2026050407): ₹4,800, "Discount on warranty" → type 'Extended warranty', on her
 *    existing booking KIA_JK402_2026_120044 (delivered, so it is not in the CRM list — it is in Delivered).
 *  - Divinder Kour (DMS C2026070093), at Shikha ma'am's request: ₹5,000, 'Accessories'. She has NO booking
 *    here and the owner chose not to create one, so the request stands on her DMS record (migration
 *    kia-discounts/0001) with the customer and car captured from DMS for the approvers.
 *
 * "Requested by" reads "Backend" (owner's instruction); requested_by is the developer account that ran it.
 *
 *   npx tsx scripts/kia-raise-backend-discounts-sep2026.ts [--apply]
 */
import 'dotenv/config'
import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')
const REQUESTER_EMAIL = 'tech@amgroupind.com'
const REQUESTER_LABEL = 'Backend'

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    const [requester] = await sql`SELECT id, full_name, role FROM users WHERE email = ${REQUESTER_EMAIL} AND is_active`
    if (!requester) throw new Error(`No active user ${REQUESTER_EMAIL}`)

    // ── Sumaya: her existing booking ─────────────────────────────────────────────────────────
    const [sumaya] = await sql`SELECT * FROM kia_bookings WHERE booking_number = 'KIA_JK402_2026_120044' AND deleted_at IS NULL`
    if (!sumaya || !/sumaya/i.test(sumaya.customer_name)) throw new Error('Sumaya booking not found')
    const [alloc] = await sql`SELECT vin_number, engine_no FROM kia_vehicle_allocations WHERE booking_id = ${sumaya.id} ORDER BY allocated_at DESC LIMIT 1`
    const meta = (sumaya.metadata || {}) as Record<string, unknown>
    // allocated_vin FIRST: her newest allocation row is a different chassis (MZBEB812LTN083395), while the
    // booking and the DMS sale both say MZBEB812LTN082929 — the car she took.
    const sumayaVin = sumaya.allocated_vin || alloc?.vin_number || null
    if (sumayaVin !== 'MZBEB812LTN082929') throw new Error(`Unexpected chassis ${sumayaVin}`)
    const sumayaSnapshot = {
      capturedAt: new Date().toISOString(),
      bookingNumber: sumaya.booking_number, customerName: sumaya.customer_name, dealerCode: sumaya.dealer_code,
      model: sumaya.model, variant: sumaya.variant, color: sumaya.color, fuelType: sumaya.fuel_type,
      vin: sumayaVin, engineNo: alloc?.vin_number === sumayaVin ? alloc?.engine_no ?? null : null,
      deliveredAt: sumaya.delivered_at ? new Date(sumaya.delivered_at).toISOString() : null,
      bookingStatus: sumaya.status, consultantName: sumaya.consultant_name, bankName: sumaya.bank_name,
      loanAmount: sumaya.loan_amount, financeRequired: sumaya.finance_required, amountReceived: sumaya.amount_received,
      exShowroom: typeof meta.exShowroom === 'number' ? meta.exShowroom : null,
      dmsCustomerId: 'C2026050407', dmsBookingNo: 'B202600863', raisedFrom: 'backend',
    }
    const sumayaReason = `Discount on warranty: ₹4,800 towards the extended warranty on her New Seltos (${sumayaVin}, delivered 18 Aug 2026). Raised from backend.`

    // ── Divinder: DMS record only ────────────────────────────────────────────────────────────
    const [dms] = await sql`
      SELECT booking_no, customerid, UPPER(BTRIM(vin_number)) AS vin, model, variant, color, delivery_date::text AS delivered,
             COALESCE(dealer_code_2, dealer_code) AS dealer, consultant_name, dsa_financier, ex_showroom_price, registration_name
      FROM kia_sales_report WHERE customerid = 'C2026070093' AND booking_no = 'B202600920'
      ORDER BY uploaded_at DESC LIMIT 1`
    if (!dms || !/divinder/i.test(dms.registration_name)) throw new Error('Divinder DMS sale not found')
    const [already] = await sql`SELECT id FROM kia_bookings WHERE deleted_at IS NULL AND UPPER(BTRIM(COALESCE(allocated_vin, ''))) = ${dms.vin}`
    if (already) throw new Error('A booking now holds this chassis — raise the discount on that booking instead')
    const divinderSnapshot = {
      capturedAt: new Date().toISOString(),
      bookingNumber: null, customerName: 'Divinder Kour', dealerCode: dms.dealer,
      model: dms.model, variant: dms.variant, color: dms.color, fuelType: null,
      vin: dms.vin, engineNo: null, deliveredAt: dms.delivered,
      bookingStatus: 'Delivered in DMS (no booking here)', consultantName: dms.consultant_name, bankName: dms.dsa_financier,
      loanAmount: null, financeRequired: null, amountReceived: null,
      exShowroom: dms.ex_showroom_price ? Number(dms.ex_showroom_price) : null,
      dmsCustomerId: 'C2026070093', dmsBookingNo: 'B202600920', raisedFrom: 'backend', requestedFor: 'Shikha Gupta',
    }
    const divinderReason = `Accessories: ₹5,000 towards accessories on her New Seltos HTK (O) (${dms.vin}, DMS booking B202600920, delivered 9 Jul 2026). Raised from backend at Shikha ma'am's request; the customer has no booking in the Kia booking section.`

    const plan = [
      { who: 'Sumaya Fatima Shad', bookingId: sumaya.id as string | null, dmsCustomerId: 'C2026050407', dmsBookingNo: 'B202600863', amount: 4800, type: 'Extended warranty', reason: sumayaReason, snapshot: sumayaSnapshot as Record<string, unknown> },
      { who: 'Divinder Kour', bookingId: null as string | null, dmsCustomerId: 'C2026070093', dmsBookingNo: 'B202600920', amount: 5000, type: 'Accessories', reason: divinderReason, snapshot: divinderSnapshot as Record<string, unknown> },
    ]

    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — requested by "${REQUESTER_LABEL}" (${requester.full_name}, ${requester.role})\n`)
    for (const p of plan) {
      const [dup] = await sql`
        SELECT id FROM kia_booking_discounts
        WHERE status = 'PENDING' AND requested_amount = ${p.amount}
          AND (booking_id = ${p.bookingId} OR (booking_id IS NULL AND dms_customer_id = ${p.dmsCustomerId}))`
      console.log(`  ${p.who}: ₹${p.amount.toLocaleString('en-IN')} · ${p.type} · ${p.bookingId ? `on booking ${p.snapshot.bookingNumber}` : `on DMS ${p.dmsBookingNo}`}`)
      console.log(`    remark: ${p.reason}`)
      if (dup) { console.log('    SKIP — an identical pending request already exists'); continue }
      if (!APPLY) continue
      await sql.begin(async (tx) => {
        const [row] = await tx`
          INSERT INTO kia_booking_discounts (booking_id, dms_customer_id, dms_booking_no, requested_amount, discount_type, reason,
                                             status, requested_by, requested_by_name, vehicle_snapshot)
          VALUES (${p.bookingId}, ${p.dmsCustomerId}, ${p.dmsBookingNo}, ${p.amount}, ${p.type}, ${p.reason},
                  'PENDING', ${requester.id}, ${REQUESTER_LABEL}, ${sql.json(p.snapshot as never)})
          RETURNING id`
        if (p.bookingId) {
          await tx`
            INSERT INTO kia_booking_activity (booking_id, activity_type, title, description, actor_user_id, actor_name, actor_role)
            VALUES (${p.bookingId}, 'discount_requested', 'Discount Requested',
                    ${`Requested a ${p.type} discount of INR ${p.amount.toLocaleString('en-IN')} on ${String(p.snapshot.vin)} from backend (booking ${String(p.snapshot.bookingStatus).replace(/_/g, ' ')}). Reason: ${p.reason}`},
                    ${requester.id}, ${REQUESTER_LABEL}, ${requester.role})`
        }
        console.log(`    RAISED — discount ${row.id}`)
      })
    }
  } finally {
    await sql.end()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
