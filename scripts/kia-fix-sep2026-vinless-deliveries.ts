/**
 * September 2026: attach the delivered chassis to the KIA bookings marked delivered with none.
 *
 * ⚠️ DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * 4 of September's 10 deliveries showed "NO VIN ON BOOKING" on the Stock board. All four were closed
 * from the follow-up screen as Converted, which delivered with no allotment/payment check (fixed in
 * resolveKiaDeliveryVehicle + the kia-delivery/0001 trigger). Three have a DMS retail row that proves
 * which car the customer took; each pair below was matched by hand and is RE-PROVED here before any
 * write, on every signal at once:
 *   - the FULL 10-digit phone on the DMS retail equals the booking's, and resolves to exactly one VIN
 *   - the DMS outlet (dealer_code_2) equals the booking's dealer
 *   - the variant is the same
 *   - no other booking claims the chassis, and nobody holds a live allocation on it
 *
 * Tahar mohd's colour differs (booking AURORA BLACK PEARL, DMS GLACIER WHITE PEARL). Every other
 * signal agrees and it is a CSD purchase, so the chassis is attached; the DMS colour is recorded in
 * metadata and the booking's own colour is left as entered.
 *
 * Udhay Partap singh jamwal (KIA_JK501_2026_120124) is NOT here: the DMS has not retailed his car
 * and no feed names a chassis for him. That one is an owner decision, not a match.
 *
 * Writes allocated_vin only (plus provenance in metadata and one activity row). No allocation row is
 * invented and delivered_at / updated_by are left alone: the CCM delivered these, not this script.
 *
 *   npx tsx scripts/kia-fix-sep2026-vinless-deliveries.ts
 *   npx tsx scripts/kia-fix-sep2026-vinless-deliveries.ts --apply
 */
import 'dotenv/config'
import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')

const PAIRS = [
  { bookingNumber: 'KIA_JK501_2026_120187', vin: 'MZBEA812LTN085813', colourMayDiffer: true },
  { bookingNumber: 'KIA_JK501_2026_120116', vin: 'MZBGB813LTN334662', colourMayDiffer: false },
  { bookingNumber: 'KIA_JK501_2026_120130', vin: 'MZBEF812LTN080843', colourMayDiffer: false },
] as const

const letters = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — September 2026 VIN-less KIA deliveries\n`)
  let written = 0
  try {
    for (const pair of PAIRS) {
      await sql.begin(async (tx) => {
        const [b] = await tx`
          SELECT id, booking_number, customer_name, status, allocated_vin, dealer_code, variant, color, delivered_at,
                 regexp_replace(COALESCE(customer_phone, ''), '[^0-9]', '', 'g') AS phone
          FROM kia_bookings
          WHERE booking_number = ${pair.bookingNumber} AND deleted_at IS NULL
          FOR UPDATE`
        const problems: string[] = []
        if (!b) throw new Error(`${pair.bookingNumber}: booking not found`)
        if (b.status !== 'delivered') problems.push(`status is '${b.status}', not delivered`)
        if (String(b.allocated_vin || '').trim()) problems.push(`already carries ${b.allocated_vin}`)
        const deliveredAt = b.delivered_at ? new Date(b.delivered_at) : null
        if (!deliveredAt || deliveredAt < new Date('2026-08-31T18:30:00Z') || deliveredAt >= new Date('2026-09-30T18:30:00Z')) {
          problems.push('not delivered in September 2026 (IST)')
        }

        const [s] = await tx`
          SELECT registration_name, dealer_code_2, variant, color, delivery_date,
                 regexp_replace(COALESCE(contact_num1, ''), '[^0-9]', '', 'g') AS phone
          FROM kia_sales_report
          WHERE UPPER(BTRIM(vin_number)) = ${pair.vin}
          ORDER BY uploaded_at DESC NULLS LAST
          LIMIT 1`
        if (!s) problems.push(`no DMS retail row for ${pair.vin}`)
        else {
          const phone10 = (p: string) => p.slice(-10)
          if (phone10(String(s.phone)).length !== 10 || phone10(String(s.phone)) !== phone10(String(b.phone))) problems.push('DMS phone differs')
          if (letters(s.dealer_code_2) !== letters(b.dealer_code)) problems.push(`DMS outlet ${s.dealer_code_2} vs booking ${b.dealer_code}`)
          if (letters(s.variant) !== letters(b.variant)) problems.push(`variant "${s.variant}" vs "${b.variant}"`)
          if (!pair.colourMayDiffer && letters(s.color) !== letters(b.color)) problems.push(`colour "${s.color}" vs "${b.color}"`)
        }
        const [{ n: vinsOnPhone }] = await tx`
          SELECT COUNT(DISTINCT UPPER(BTRIM(vin_number)))::int AS n FROM kia_sales_report
          WHERE RIGHT(regexp_replace(COALESCE(contact_num1, ''), '[^0-9]', '', 'g'), 10) = RIGHT(${String(b.phone)}, 10)`
        if (vinsOnPhone !== 1) problems.push(`phone maps to ${vinsOnPhone} VINs`)
        const [claim] = await tx`
          SELECT booking_number FROM kia_bookings
          WHERE deleted_at IS NULL AND id <> ${b.id} AND UPPER(BTRIM(COALESCE(allocated_vin, ''))) = ${pair.vin} LIMIT 1`
        if (claim) problems.push(`chassis already on ${claim.booking_number}`)
        const [live] = await tx`
          SELECT booking_id FROM kia_vehicle_allocations
          WHERE released_at IS NULL AND UPPER(BTRIM(vin_number)) = ${pair.vin} LIMIT 1`
        if (live) problems.push('chassis holds a live allocation')

        if (problems.length) {
          console.log(`  SKIP  ${pair.bookingNumber}  ${b.customer_name}: ${problems.join('; ')}`)
          return
        }
        const dmsDate = s.delivery_date ? new Date(s.delivery_date).toISOString().slice(0, 10) : null
        console.log(`  OK    ${pair.bookingNumber}  ${String(b.customer_name).padEnd(28)} -> ${pair.vin}   (DMS retail ${dmsDate}${pair.colourMayDiffer ? `, DMS colour ${s.color}` : ''})`)
        if (!APPLY) return

        const evidence = {
          source: 'kia_sales_report',
          matchedOn: 'full phone (unique to this VIN) + DMS outlet + variant, no competing claim',
          dmsRetailDate: dmsDate,
          dmsColour: s.color,
          previousAllocatedVin: null,
          reason: 'Delivered via follow-up Converted with no allotment; chassis attached from the DMS retail (2026-09-18).',
          at: new Date().toISOString(),
        }
        const updated = await tx`
          UPDATE kia_bookings
          SET allocated_vin = ${pair.vin},
              metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('deliveryVinReconciliation', ${JSON.stringify(evidence)}::jsonb),
              updated_at = now()
          WHERE id = ${b.id} AND status = 'delivered' AND COALESCE(BTRIM(allocated_vin), '') = ''
          RETURNING id`
        if (!updated.length) throw new Error(`${pair.bookingNumber}: changed underneath, nothing written`)
        await tx`
          INSERT INTO kia_booking_activity (booking_id, activity_type, title, description, actor_name, actor_role, before_value, after_value)
          VALUES (${b.id}, 'updated', 'Delivered chassis attached',
                  ${`Chassis ${pair.vin} attached from the DMS retail of ${dmsDate}. The booking had been marked delivered from a follow-up with no vehicle allotted.`},
                  'System', 'system',
                  ${JSON.stringify({ allocatedVin: null })}::jsonb,
                  ${JSON.stringify({ allocatedVin: pair.vin, deliveryVinReconciliation: evidence })}::jsonb)`
        written += 1
      })
    }
  } finally {
    await sql.end()
  }
  console.log(APPLY ? `\n${written} booking(s) updated.` : '\nNothing was written. Re-run with --apply.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
