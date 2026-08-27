/**
 * Backfill the chassis number onto DELIVERED KIA bookings that have none, from kia_sales_report.
 *
 * ⚠️ DRY RUN BY DEFAULT. Pass --apply to write. Read the report first — the naive version of this
 * match is wrong more often than it is right.
 *
 * ── Why this is not a simple join ─────────────────────────────────────────────────────────────
 * There is NO shared key. kia_sales_report carries a DMS booking_no (B2026…) on 100% of rows, but
 * nothing in kia_bookings records it — 0 of our bookings mention one anywhere, including metadata.
 * So the only bridge is the customer's phone, and phone alone is dangerous here:
 *
 *   - CSD sales register the vehicle to "THE AREA MANAGER CANTEEN STORES DEPARTMENT", so the name
 *     on the sales row is NOT the buyer's name. That is legitimate for a booking whose
 *     customerType is CSD — and a red flag on one whose customerType is Regular.
 *   - Dealer phones are shared across up to 16 distinct VINs (9419111126 → 16), so a phone that
 *     resolves to several cars can never be used.
 *   - A VIN can already belong to a DIFFERENT booking. Measured: 2 of the 7 phone matches would
 *     have taken a VIN that is currently held by another booking — one of them a LIVE, undelivered
 *     one. Writing those would have two customers claiming one car.
 *
 * So every candidate is scored on independent corroboration and only unambiguous, unconflicted,
 * corroborated matches are eligible. Everything else is reported for a human to decide.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/kia-backfill-delivered-vins.ts
 *       npx tsx --tsconfig ./tsconfig.verify.json scripts/kia-backfill-delivered-vins.ts --apply
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

const APPLY = process.argv.includes('--apply')

type Candidate = {
  booking_id: string
  booking_number: string
  customer_name: string
  customer_type: string | null
  booking_model: string
  booking_color: string
  dealer_code: string
  phone: string
  vin: string | null
  vins_on_phone: number
  sr_name: string | null
  sr_color: string | null
  sr_dealer: string | null
  sr_model: string | null
  name_match: boolean
  color_match: boolean
  dealer_match: boolean
  vin_conflict_booking: string | null
}

const rows = <T>(r: unknown): T[] => (Array.isArray(r) ? r as T[] : ((r as { rows?: T[] }).rows || []))

async function main() {
  const result = await db.execute(sql`
    WITH vinless AS (
      SELECT kb.id::text AS booking_id, kb.booking_number, kb.customer_name,
             kb.metadata->>'customerType' AS customer_type,
             COALESCE(kb.model, '') AS booking_model,
             COALESCE(kb.color, kb.metadata->>'color', '') AS booking_color,
             COALESCE(kb.dealer_code, '') AS dealer_code,
             regexp_replace(COALESCE(kb.customer_phone, ''), '[^0-9]', '', 'g') AS phone
      FROM kia_bookings kb
      WHERE kb.deleted_at IS NULL
        AND kb.status = 'delivered'
        AND COALESCE(BTRIM(kb.allocated_vin), '') = ''
        AND NOT EXISTS (
          SELECT 1 FROM kia_vehicle_allocations va
          WHERE va.booking_id = kb.id AND COALESCE(BTRIM(va.vin_number), '') <> ''
        )
    ),
    -- One row per VIN. The feed is a cumulative snapshot, so the same sale re-exports every upload.
    sr AS (
      SELECT DISTINCT ON (UPPER(BTRIM(vin_number)))
        UPPER(BTRIM(vin_number)) AS vin,
        regexp_replace(COALESCE(contact_num1, ''), '[^0-9]', '', 'g') AS phone,
        registration_name AS sr_name,
        model AS sr_model,
        color AS sr_color,
        UPPER(BTRIM(COALESCE(NULLIF(BTRIM(dealer_code_2), ''), dealer_code, ''))) AS sr_dealer
      FROM kia_sales_report
      WHERE COALESCE(BTRIM(vin_number), '') <> ''
      ORDER BY UPPER(BTRIM(vin_number)), uploaded_at DESC NULLS LAST
    )
    SELECT v.*,
      s.vin, s.sr_name, s.sr_color, s.sr_dealer, s.sr_model,
      (SELECT COUNT(DISTINCT x.vin)::int FROM sr x WHERE x.phone = v.phone) AS vins_on_phone,
      (regexp_replace(UPPER(BTRIM(COALESCE(v.customer_name,''))),'[^A-Z]','','g')
        = regexp_replace(UPPER(BTRIM(COALESCE(s.sr_name,''))),'[^A-Z]','','g')
       OR regexp_replace(UPPER(BTRIM(COALESCE(v.customer_name,''))),'[^A-Z]','','g')
        LIKE '%' || regexp_replace(UPPER(BTRIM(COALESCE(s.sr_name,''))),'[^A-Z]','','g') || '%'
       OR regexp_replace(UPPER(BTRIM(COALESCE(s.sr_name,''))),'[^A-Z]','','g')
        LIKE '%' || regexp_replace(UPPER(BTRIM(COALESCE(v.customer_name,''))),'[^A-Z]','','g') || '%'
      ) AS name_match,
      (regexp_replace(UPPER(BTRIM(COALESCE(v.booking_color,''))),'[^A-Z]','','g')
        LIKE regexp_replace(UPPER(BTRIM(COALESCE(s.sr_color,''))),'[^A-Z]','','g') || '%'
       OR regexp_replace(UPPER(BTRIM(COALESCE(s.sr_color,''))),'[^A-Z]','','g')
        LIKE regexp_replace(UPPER(BTRIM(COALESCE(v.booking_color,''))),'[^A-Z]','','g') || '%'
      ) AS color_match,
      (UPPER(BTRIM(v.dealer_code)) = s.sr_dealer) AS dealer_match,
      (SELECT o.booking_number FROM kia_bookings o
        WHERE o.deleted_at IS NULL AND UPPER(BTRIM(COALESCE(o.allocated_vin,''))) = s.vin
        LIMIT 1) AS vin_conflict_booking
    FROM vinless v
    LEFT JOIN sr s ON s.phone = v.phone
    ORDER BY v.booking_number
  `)

  const all = rows<Candidate>(result)

  /*
   * ELIGIBILITY. A match is written only when every one of these holds:
   *   - the phone resolves to exactly ONE vin (never a shared dealer/CSD line);
   *   - that VIN is not already on another booking;
   *   - the colour agrees;
   *   - the dealer agrees;
   *   - AND the name agrees, OR the booking is genuinely a CSD purchase (where the vehicle
   *     registers to the department, so a name mismatch is expected rather than suspicious).
   */
  const isCsd = (c: Candidate) => String(c.customer_type || '').trim().toUpperCase() === 'CSD'
  const eligible = all.filter((c) =>
    c.vin
    && Number(c.vins_on_phone) === 1
    && !c.vin_conflict_booking
    && c.color_match
    && c.dealer_match
    && (c.name_match || isCsd(c)))

  const rejected = all.filter((c) => !eligible.includes(c))

  const reason = (c: Candidate): string => {
    if (!c.vin) return 'no sales row carries this phone'
    if (Number(c.vins_on_phone) !== 1) return `phone maps to ${c.vins_on_phone} VINs (shared line)`
    if (c.vin_conflict_booking) return `VIN ${c.vin} already on ${c.vin_conflict_booking}`
    if (!c.color_match) return `colour differs (booking "${c.booking_color}" vs sales "${c.sr_color}")`
    if (!c.dealer_match) return `dealer differs (booking ${c.dealer_code} vs sales ${c.sr_dealer})`
    if (!c.name_match && !isCsd(c)) return `name differs ("${c.sr_name}") and the booking is not CSD`
    return 'unclassified'
  }

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — delivered KIA bookings with no chassis number\n`)
  console.log(`  ${all.length} vinless delivered bookings examined\n`)

  console.log(`ELIGIBLE — will be written (${eligible.length})\n`)
  for (const c of eligible) {
    console.log(`  ${c.booking_number}  ${String(c.customer_name).padEnd(18)} -> ${c.vin}`)
    console.log(`     ${c.booking_model} · ${c.booking_color} · ${c.dealer_code}`
      + `   [${c.name_match ? 'name' : 'CSD'} ✓ colour ✓ dealer ✓ phone unique ✓ no conflict ✓]`)
  }

  console.log(`\nNOT ELIGIBLE — left for a human (${rejected.length})\n`)
  for (const c of rejected) {
    console.log(`  ${c.booking_number}  ${String(c.customer_name).padEnd(18)} — ${reason(c)}`)
  }

  if (!APPLY) {
    console.log('\nNothing was written. Re-run with --apply to write the eligible matches.')
    process.exit(0)
  }

  if (!eligible.length) {
    console.log('\nNothing eligible to write.')
    process.exit(0)
  }

  /*
   * The write. allocated_vin only — deliberately NOT creating kia_vehicle_allocations rows: an
   * allocation is a reservation with a payment clock and a release lifecycle, and inventing one
   * retrospectively for a car already handed over would put fabricated history into the audit
   * trail. The guard in the WHERE clause re-checks emptiness so a concurrent write cannot be
   * clobbered.
   */
  let written = 0
  for (const c of eligible) {
    const res = await db.execute(sql`
      UPDATE kia_bookings
      SET allocated_vin = ${c.vin},
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'vinBackfill', jsonb_build_object(
              'source', 'kia_sales_report',
              'matchedOn', 'customer_phone + colour + dealer',
              'at', now()::text
            )
          ),
          updated_at = now()
      WHERE id = ${c.booking_id}::uuid
        AND deleted_at IS NULL
        AND COALESCE(BTRIM(allocated_vin), '') = ''
      RETURNING id
    `)
    const hit = rows<{ id: string }>(res).length
    written += hit
    console.log(`  ${hit ? 'written' : 'SKIPPED (changed underneath)'}: ${c.booking_number} -> ${c.vin}`)
  }
  console.log(`\n${written} of ${eligible.length} bookings updated.`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
