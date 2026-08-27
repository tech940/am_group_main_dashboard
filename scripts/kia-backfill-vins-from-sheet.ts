/**
 * Backfill chassis numbers onto delivered KIA bookings from a SalesReport .xlsx.
 *
 * ⚠️ DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * Companion to scripts/kia-backfill-delivered-vins.ts, which sources from the kia_sales_report
 * TABLE. This one reads a spreadsheet, because the remaining bookings were not reachable from the
 * table: their customer phone appears on no sales row there.
 *
 * ── Why the matching is deliberately paranoid ─────────────────────────────────────────────────
 * The naive phone match against the table was wrong 6 times in 7 — it assigned VINs already held by
 * other bookings, crossed dealers, and crossed colours. So nothing is written on one signal.
 *
 * ⚠️ The sheet's Contact Num1 is MASKED to its last four digits ("XXXXXX5477"), so a phone match
 * here is worth far less than it looks: four digits collide roughly once in ten thousand, and this
 * dealership has far more than four digits' worth of customers over time. It is therefore treated
 * as ONE signal among several, never as the key.
 *
 * A row is written only when the sheet and the booking agree on the customer AND the exact car AND
 * the branch, and the VIN is not already claimed:
 *   - phone last-4 matches, AND
 *   - the name matches (or the booking is a genuine CSD purchase, where the vehicle registers to
 *     "THE AREA MANAGER CANTEEN STORES DEPARTMENT" and a name mismatch is expected), AND
 *   - model, variant and colour all agree, AND
 *   - the dealer agrees, AND
 *   - the VIN is on no other booking and in no allocation row.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/kia-backfill-vins-from-sheet.ts "<path.xlsx>"
 *       ... --apply
 */
import 'dotenv/config'
import ExcelJS from 'exceljs'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

const APPLY = process.argv.includes('--apply')
const FILE = process.argv.find((a) => a.toLowerCase().endsWith('.xlsx'))
  || 'C:/Users/sahil/Downloads/SalesReport (18).xlsx'

const rows = <T>(r: unknown): T[] => (Array.isArray(r) ? r as T[] : ((r as { rows?: T[] }).rows || []))

/** Letters only, upper case — kills punctuation, spacing and case differences in names/colours. */
const norm = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
/** Digits only; the sheet masks all but the last four. */
const last4 = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '').slice(-4)

const cell = (row: ExcelJS.Row, idx: number): string => {
  const v = row.getCell(idx).value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'text' in (v as Record<string, unknown>)) return String((v as { text: unknown }).text).trim()
  if (typeof v === 'object' && 'result' in (v as Record<string, unknown>)) return String((v as { result: unknown }).result).trim()
  return String(v).trim()
}

type SheetRow = {
  vin: string
  name: string
  phone4: string
  model: string
  variant: string
  color: string
  dealer: string
  deliveryDate: string
  bookingNo: string
}

type Booking = {
  booking_id: string
  booking_number: string
  customer_name: string
  customer_type: string | null
  model: string
  variant: string
  color: string
  dealer_code: string
  phone: string
}

async function main() {
  // ── Read the sheet ────────────────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(FILE)
  const ws = wb.worksheets[0]

  const header: Record<string, number> = {}
  ws.getRow(1).eachCell((c, i) => { header[norm(c.value)] = i })
  const col = (...names: string[]) => {
    for (const n of names) if (header[norm(n)]) return header[norm(n)]
    throw new Error(`column not found in sheet: ${names[0]}`)
  }

  const cVin = col('Vin Number')
  const cName = col('Registration Name')
  const cPhone = col('Contact Num1')
  const cModel = col('Model')
  const cVariant = col('Variant')
  const cColor = col('Color')
  const cDealer = col('Dealer Code')
  const cDelivery = col('Delivery Date')
  const cBookingNo = col('Booking No')

  const sheet: SheetRow[] = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const vin = cell(ws.getRow(r), cVin).toUpperCase()
    if (!vin) continue
    sheet.push({
      vin,
      name: cell(ws.getRow(r), cName),
      phone4: last4(cell(ws.getRow(r), cPhone)),
      model: cell(ws.getRow(r), cModel),
      variant: cell(ws.getRow(r), cVariant),
      color: cell(ws.getRow(r), cColor),
      dealer: cell(ws.getRow(r), cDealer).toUpperCase(),
      deliveryDate: cell(ws.getRow(r), cDelivery),
      bookingNo: cell(ws.getRow(r), cBookingNo),
    })
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — source: ${FILE}`)
  console.log(`  ${sheet.length} sales rows with a VIN read from the sheet\n`)

  // ── The bookings still missing a chassis number ───────────────────────────────────────────
  const bookings = rows<Booking>(await db.execute(sql`
    SELECT kb.id::text AS booking_id, kb.booking_number, kb.customer_name,
           kb.metadata->>'customerType' AS customer_type,
           COALESCE(kb.model, '') AS model,
           COALESCE(kb.variant, '') AS variant,
           COALESCE(kb.color, kb.metadata->>'color', '') AS color,
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
    ORDER BY kb.booking_number`))

  // VINs already spoken for anywhere in the system.
  const claimed = new Set(rows<{ vin: string }>(await db.execute(sql`
    SELECT UPPER(BTRIM(allocated_vin)) AS vin FROM kia_bookings
      WHERE deleted_at IS NULL AND COALESCE(BTRIM(allocated_vin), '') <> ''
    UNION
    SELECT UPPER(BTRIM(vin_number)) AS vin FROM kia_vehicle_allocations
      WHERE COALESCE(BTRIM(vin_number), '') <> ''`)).map((r) => r.vin))

  const isCsd = (b: Booking) => String(b.customer_type || '').trim().toUpperCase() === 'CSD'
  const nameAgrees = (a: string, b: string) => {
    const x = norm(a)
    const y = norm(b)
    if (!x || !y) return false
    return x === y || x.includes(y) || y.includes(x)
  }
  const looseAgrees = (a: string, b: string) => {
    const x = norm(a)
    const y = norm(b)
    if (!x || !y) return false
    return x === y || x.startsWith(y) || y.startsWith(x)
  }

  const eligible: { b: Booking; s: SheetRow; via: string }[] = []
  const rejected: { b: Booking; why: string }[] = []

  for (const b of bookings) {
    const p4 = last4(b.phone)
    const byPhone = sheet.filter((s) => s.phone4 && s.phone4 === p4)

    if (byPhone.length === 0) { rejected.push({ b, why: 'no row in the sheet has this phone (last 4)' }); continue }

    // Every corroborating signal must hold on the SAME row.
    const strong = byPhone.filter((s) =>
      (nameAgrees(b.customer_name, s.name) || isCsd(b))
      && looseAgrees(b.model, s.model)
      && looseAgrees(b.variant, s.variant)
      && looseAgrees(b.color, s.color)
      && norm(b.dealer_code) === norm(s.dealer))

    if (strong.length === 0) {
      const s = byPhone[0]
      const misses = [
        (nameAgrees(b.customer_name, s.name) || isCsd(b)) ? '' : `name ("${s.name}")`,
        looseAgrees(b.model, s.model) ? '' : `model ("${s.model}")`,
        looseAgrees(b.variant, s.variant) ? '' : `variant ("${s.variant}")`,
        looseAgrees(b.color, s.color) ? '' : `colour ("${s.color}")`,
        norm(b.dealer_code) === norm(s.dealer) ? '' : `dealer (${s.dealer})`,
      ].filter(Boolean).join(', ')
      rejected.push({ b, why: `phone matched but ${misses} differ` })
      continue
    }
    if (strong.length > 1) {
      rejected.push({ b, why: `${strong.length} sheet rows match equally well — ambiguous` })
      continue
    }
    const s = strong[0]
    if (claimed.has(s.vin)) { rejected.push({ b, why: `VIN ${s.vin} is already claimed elsewhere` }); continue }
    if (eligible.some((e) => e.s.vin === s.vin)) { rejected.push({ b, why: `VIN ${s.vin} already assigned earlier in this run` }); continue }

    eligible.push({ b, s, via: isCsd(b) && !nameAgrees(b.customer_name, s.name) ? 'CSD' : 'name' })
  }

  console.log(`ELIGIBLE — every signal agrees (${eligible.length})\n`)
  for (const { b, s, via } of eligible) {
    console.log(`  ${b.booking_number}  ${String(b.customer_name).padEnd(18)} -> ${s.vin}`)
    console.log(`     booking: ${b.model} · ${b.variant} · ${b.color} · ${b.dealer_code}`)
    console.log(`     sheet  : ${s.model} · ${s.variant} · ${s.color} · ${s.dealer} · "${s.name}" · delivered ${s.deliveryDate}`)
    console.log(`     [${via} ✓ model ✓ variant ✓ colour ✓ dealer ✓ phone-last4 ✓ unclaimed ✓]`)
  }

  console.log(`\nNOT ELIGIBLE (${rejected.length})\n`)
  for (const { b, why } of rejected) {
    console.log(`  ${b.booking_number}  ${String(b.customer_name).padEnd(18)} — ${why}`)
  }

  if (!APPLY) {
    console.log('\nNothing was written. Re-run with --apply to write the eligible matches.')
    process.exit(0)
  }
  if (!eligible.length) { console.log('\nNothing eligible.'); process.exit(0) }

  let written = 0
  for (const { b, s } of eligible) {
    // The emptiness guard is re-checked in the WHERE so a concurrent write cannot be clobbered.
    const res = await db.execute(sql`
      UPDATE kia_bookings
      SET allocated_vin = ${s.vin},
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'vinBackfill', jsonb_build_object(
              'source', 'SalesReport xlsx',
              'file', ${FILE},
              'matchedOn', 'phone-last4 + name/CSD + model + variant + colour + dealer',
              'at', now()::text
            )
          ),
          updated_at = now()
      WHERE id = ${b.booking_id}::uuid
        AND deleted_at IS NULL
        AND COALESCE(BTRIM(allocated_vin), '') = ''
      RETURNING id`)
    const hit = rows<{ id: string }>(res).length
    written += hit
    console.log(`  ${hit ? 'written' : 'SKIPPED (changed underneath)'}: ${b.booking_number} -> ${s.vin}`)
  }
  console.log(`\n${written} of ${eligible.length} bookings updated.`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
