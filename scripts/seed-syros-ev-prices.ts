/**
 * Seeds the NEW "Syros EV" model and its 7 variants into `kia_price_details`.
 *
 *   npx tsx scripts/seed-syros-ev-prices.ts            # dry run — reconciles, writes nothing
 *   npx tsx scripts/seed-syros-ev-prices.ts --apply    # upsert
 *
 * Syros EV is a SEPARATE model from the existing "Syros Petrol" / "Syros Diesel" rows — it is added
 * alongside them, and neither is touched.
 *
 * Idempotent: keyed on (model, trim_description), so re-running updates in place rather than
 * duplicating. The proforma form matches a price by model+trim only
 * (findPriceByModelTrim, lib/kia-proforma/pricing.ts:159), so those two columns are the real key.
 *
 * ⚠️ `hyp` / `bank_name` / `bank_branch` are deliberately left NULL. On existing rows they are
 * import noise — app/api/brands/kia/proforma/options/route.ts builds the HYP dropdown from EVERY
 * row's bank fields, and the authoritative branch list already lives in the 328 '__BANK_OPTION__'
 * rows. Inventing a branch here would just add duplicates to that dropdown.
 *
 * ⚠️ Registration is charged as registration_charges + statutory_charges unless the bank is CASH
 * (pricing.ts:168-172), so BOTH columns must be populated, not merged.
 */
import 'dotenv/config'
import postgres from 'postgres'
import { invalidateCache } from '../lib/redis/cache-utils'

const APPLY = process.argv.includes('--apply')
const MODEL = 'Syros EV'

/** Transcribed from the price sheet image. `onRoad` and `total` are the sheet's own stated figures. */
type Variant = {
  trim: string
  ex: number
  tcs: number
  statutory: number
  registration: number
  insurance: number
  fastag: number
  extendedWarranty: number
  accessoriesKit: number
  kiaConnect: number
  onRoad: number
  total: number
}

const VARIANTS: Variant[] = [
  { trim: 'Syros EV HTK',          ex: 1349900, tcs: 13499, statutory: 2164, registration: 650, insurance: 56336, fastag: 500, extendedWarranty: 32384, accessoriesKit: 20945, kiaConnect: 0,    onRoad: 1455433, total: 1476378 },
  { trim: 'Syros EV HTK Plus',     ex: 1499900, tcs: 14999, statutory: 2164, registration: 650, insurance: 59540, fastag: 500, extendedWarranty: 32384, accessoriesKit: 20945, kiaConnect: 0,    onRoad: 1610137, total: 1631082 },
  { trim: 'Syros EV HTX',          ex: 1599900, tcs: 15999, statutory: 2164, registration: 650, insurance: 61676, fastag: 500, extendedWarranty: 32384, accessoriesKit: 20945, kiaConnect: 0,    onRoad: 1713273, total: 1734218 },
  { trim: 'Syros EV ER HTK Plus',  ex: 1699900, tcs: 16999, statutory: 2164, registration: 650, insurance: 63812, fastag: 500, extendedWarranty: 32384, accessoriesKit: 20945, kiaConnect: 0,    onRoad: 1816409, total: 1837354 },
  { trim: 'Syros EV ER HTX',       ex: 1799900, tcs: 17999, statutory: 2164, registration: 650, insurance: 65948, fastag: 500, extendedWarranty: 32384, accessoriesKit: 20945, kiaConnect: 1890, onRoad: 1919545, total: 1942380 },
  { trim: 'Syros EV ER HTX Plus',  ex: 1949900, tcs: 19499, statutory: 2164, registration: 650, insurance: 69152, fastag: 500, extendedWarranty: 32384, accessoriesKit: 20945, kiaConnect: 1890, onRoad: 2074249, total: 2097084 },
  { trim: 'Syros EV ER X Line',    ex: 1999900, tcs: 19999, statutory: 2164, registration: 650, insurance: 70220, fastag: 500, extendedWarranty: 32384, accessoriesKit: 20945, kiaConnect: 1890, onRoad: 2125817, total: 2148652 },
]

const inr = (n: number) => n.toLocaleString('en-IN')

/**
 * Re-derives the sheet's own On-Road and Total from the component columns. A transcription slip in
 * any single figure breaks one of these, so the script refuses to write until every row balances.
 */
function reconcile(v: Variant) {
  const onRoad = v.ex + v.tcs + v.statutory + v.registration + v.insurance + v.fastag + v.extendedWarranty
  const total = onRoad + v.accessoriesKit + v.kiaConnect
  return { onRoad, total, onRoadOk: onRoad === v.onRoad, totalOk: total === v.total }
}

async function main() {
  console.log(`\nMODEL   ${MODEL}   (${VARIANTS.length} variants)`)
  console.log(`MODE    ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`)

  console.log('RECONCILIATION — component sum vs the sheet\'s stated figures')
  let bad = 0
  for (const v of VARIANTS) {
    const r = reconcile(v)
    if (!r.onRoadOk || !r.totalOk) bad++
    const mark = r.onRoadOk && r.totalOk ? 'ok  ' : 'FAIL'
    console.log(`  ${mark} ${v.trim.padEnd(24)} ex ${String(inr(v.ex)).padStart(11)} · on-road ${String(inr(r.onRoad)).padStart(11)}${r.onRoadOk ? '' : ` != sheet ${inr(v.onRoad)}`} · total ${String(inr(r.total)).padStart(11)}${r.totalOk ? '' : ` != sheet ${inr(v.total)}`}`)
  }
  if (bad) throw new Error(`${bad} variant(s) do not reconcile — check the transcription before writing`)
  console.log('  all 7 rows balance against the sheet\n')

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })

  try {
    const existing = await sql<{ trim_description: string }[]>`
      SELECT trim_description FROM kia_price_details WHERE model = ${MODEL}`
    console.log(`EXISTING "${MODEL}" rows: ${existing.length}${existing.length ? ` (${existing.map((r) => r.trim_description).join(', ')})` : ''}`)

    const [{ others }] = await sql<{ others: number }[]>`
      SELECT COUNT(*)::int others FROM kia_price_details WHERE model ILIKE 'Syros%' AND model <> ${MODEL}`
    console.log(`OTHER Syros rows that must stay untouched: ${others} (Syros Petrol / Syros Diesel)`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply.\n')
      return
    }

    await sql.begin(async (tx) => {
      for (const v of VARIANTS) {
        const r = reconcile(v)
        const metadata = {
          colour: 'Metalic',
          onRoadPrice: r.onRoad,
          totalAmount: r.total,
          kiaConnectBasic1Year: v.kiaConnect,
          myConveniencePlus: 0,
          source: 'syros-ev-price-sheet',
          seededAt: new Date().toISOString(),
        }
        // Upsert on (model, trim) — no unique constraint exists on that pair, so do it explicitly.
        const updated = await tx`
          UPDATE kia_price_details SET
            ex_showroom_price = ${v.ex}, tcs = ${v.tcs}, statutory_charges = ${v.statutory},
            registration_charges = ${v.registration}, insurance = ${v.insurance}, fastag = ${v.fastag},
            extended_warranty_4th_year = ${v.extendedWarranty}, accessories_kit = ${v.accessoriesKit},
            metadata = ${sql.json(metadata)}, updated_at = NOW()
          WHERE model = ${MODEL} AND trim_description = ${v.trim}
          RETURNING id`
        if (updated.length === 0) {
          await tx`
            INSERT INTO kia_price_details (
              model, trim_description, ex_showroom_price, tcs, statutory_charges, registration_charges,
              insurance, fastag, extended_warranty_4th_year, accessories_kit, metadata
            ) VALUES (
              ${MODEL}, ${v.trim}, ${v.ex}, ${v.tcs}, ${v.statutory}, ${v.registration},
              ${v.insurance}, ${v.fastag}, ${v.extendedWarranty}, ${v.accessoriesKit}, ${sql.json(metadata)}
            )`
          console.log(`  INSERT ${v.trim}`)
        } else {
          console.log(`  UPDATE ${v.trim}`)
        }
      }
    })

    const after = await sql<{ n: number }[]>`SELECT COUNT(*)::int n FROM kia_price_details WHERE model = ${MODEL}`
    console.log(`\n"${MODEL}" now has ${after[0].n} rows.`)
    // The options endpoint caches the whole model/trim/price payload, so without this the new model
    // would not appear in the Bookings proforma dropdowns until the TTL expired.
    await invalidateCache('kia:proforma:options:data')
    await invalidateCache('finance:bank-options')
    console.log('Proforma options cache invalidated — the model is live immediately.\n')
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error('\nSEED FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
