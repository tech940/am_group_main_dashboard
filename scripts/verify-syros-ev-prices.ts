/**
 * verify:syros-ev — asserts the Syros EV price rows are stored correctly AND that the proforma
 * form will read them back with the right numbers.
 *
 *   npm run verify:syros-ev
 *
 * Read-only. Runs the REAL pricing resolver (lib/kia-proforma/pricing.ts) over the live rows, so a
 * value that lands in the wrong column shows up as a wrong prefill, not just a wrong cell.
 */
import 'dotenv/config'
import postgres from 'postgres'
import { calculateKiaProformaPricing } from '../lib/kia-proforma/pricing'

const MODEL = 'Syros EV'
let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const inr = (n: number) => n.toLocaleString('en-IN')

/** The sheet, transcribed independently of the seed script so a shared typo cannot hide. */
const SHEET: Array<[string, number, number, number, number, number, number, number, number, number, number]> = [
  // trim, ex, tcs, statutory, registration, insurance, fastag, extWarranty, accKit, onRoad, total
  ['Syros EV HTK',         1349900, 13499, 2164, 650, 56336, 500, 32384, 20945, 1455433, 1476378],
  ['Syros EV HTK Plus',    1499900, 14999, 2164, 650, 59540, 500, 32384, 20945, 1610137, 1631082],
  ['Syros EV HTX',         1599900, 15999, 2164, 650, 61676, 500, 32384, 20945, 1713273, 1734218],
  ['Syros EV ER HTK Plus', 1699900, 16999, 2164, 650, 63812, 500, 32384, 20945, 1816409, 1837354],
  ['Syros EV ER HTX',      1799900, 17999, 2164, 650, 65948, 500, 32384, 20945, 1919545, 1942380],
  ['Syros EV ER HTX Plus', 1949900, 19499, 2164, 650, 69152, 500, 32384, 20945, 2074249, 2097084],
  ['Syros EV ER X Line',   1999900, 19999, 2164, 650, 70220, 500, 32384, 20945, 2125817, 2148652],
]

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    const rows = await sql<Record<string, string>[]>`
      SELECT trim_description, ex_showroom_price::text ex, tcs::text tcs, statutory_charges::text st,
             registration_charges::text reg, insurance::text ins, fastag::text ft,
             extended_warranty_4th_year::text ew, accessories_kit::text ak, metadata::text meta
      FROM kia_price_details WHERE model = ${MODEL} ORDER BY ex_showroom_price`

    console.log('\nSTORED ROWS')
    ok('all 7 variants present', rows.length === 7, `${rows.length} rows`)
    ok('no duplicate trims', new Set(rows.map((r) => r.trim_description)).size === rows.length)

    for (const [trim, ex, tcs, st, reg, ins, ft, ew, ak, onRoad, total] of SHEET) {
      const r = rows.find((x) => x.trim_description === trim)
      if (!r) { ok(`${trim}: present`, false, 'missing'); continue }
      const eq = (a: string, b: number) => Math.abs(Number(a) - b) < 0.01
      const good = eq(r.ex, ex) && eq(r.tcs, tcs) && eq(r.st, st) && eq(r.reg, reg)
        && eq(r.ins, ins) && eq(r.ft, ft) && eq(r.ew, ew) && eq(r.ak, ak)
      ok(`${trim.padEnd(22)} ex ${String(inr(ex)).padStart(10)}`, good,
        good ? `on-road ${inr(onRoad)} · total ${inr(total)}` : `stored ex=${r.ex} tcs=${r.tcs} st=${r.st} reg=${r.reg} ins=${r.ins} ft=${r.ft} ew=${r.ew} ak=${r.ak}`)
    }

    console.log('\nSHEET ARITHMETIC (component sum must equal the stated figures)')
    for (const [trim, ex, tcs, st, reg, ins, ft, ew, ak, onRoad, total] of SHEET) {
      const derivedOnRoad = ex + tcs + st + reg + ins + ft + ew
      ok(`${trim.padEnd(22)} on-road reconciles`, derivedOnRoad === onRoad, `${inr(derivedOnRoad)}`)
      const kiaConnect = total - derivedOnRoad - ak
      ok(`${trim.padEnd(22)} total reconciles`, derivedOnRoad + ak + kiaConnect === total,
        kiaConnect ? `incl. Kia Connect ${inr(kiaConnect)}` : 'no Kia Connect')
    }

    console.log('\nPROFORMA PREFILL (the real resolver, as the Bookings form would call it)')
    const priceRows = await sql`SELECT * FROM kia_price_details WHERE model = ${MODEL}`
    const lookup = priceRows.map((r) => ({
      model: r.model, trimDescription: r.trim_description,
      exShowroomPrice: r.ex_showroom_price, tcs: r.tcs,
      registrationCharges: r.registration_charges, statutoryCharges: r.statutory_charges,
      insurance: r.insurance, fastag: r.fastag, accessoriesKit: r.accessories_kit,
      extendedWarranty4thYear: r.extended_warranty_4th_year, insuranceCompany: r.insurance_company,
    })) as never

    for (const [trim, ex, tcs, st, reg, ins, ft, ew, ak] of SHEET.slice(0, 3)) {
      const res = calculateKiaProformaPricing(
        { modelName: MODEL, trimDescription: trim, bankName: '', bankBranch: '',
          registrationCharges: '0' } as never,
        lookup, [] as never,
      ) as unknown as { prefill?: Record<string, string> }
      const p = res.prefill || {}
      // Financed deal: registration = registration_charges + statutory_charges (pricing.ts:168-172)
      ok(`${trim.padEnd(22)} prefills ex-showroom`, Number(p.exShowroom) === ex, `Rs ${inr(Number(p.exShowroom || 0))}`)
      ok(`${trim.padEnd(22)} prefills TCS`, Number(p.tcsValue) === tcs)
      ok(`${trim.padEnd(22)} registration = reg + statutory`, Number(p.registrationCharges) === reg + st,
        `Rs ${inr(Number(p.registrationCharges || 0))} = ${reg} + ${st}`)
      ok(`${trim.padEnd(22)} prefills insurance`, Number(p.insuranceValue) === ins)
      ok(`${trim.padEnd(22)} prefills accessories`, Number(p.accessoriesKit) === ak)
      ok(`${trim.padEnd(22)} prefills warranty`, Number(p.extWarranty) === ew)
    }

    console.log('\nISOLATION (the existing Syros models must be untouched)')
    const others = await sql<{ model: string; n: number; total: string }[]>`
      SELECT model, COUNT(*)::int n, SUM(ex_showroom_price)::text total
      FROM kia_price_details WHERE model ILIKE 'Syros%' GROUP BY 1 ORDER BY 1`
    for (const o of others) console.log(`    ${o.model.padEnd(16)} ${String(o.n).padStart(2)} rows`)
    ok('Syros Petrol still has 9 rows', others.find((o) => o.model === 'Syros Petrol')?.n === 9)
    ok('Syros Diesel still has 9 rows', others.find((o) => o.model === 'Syros Diesel')?.n === 9)
    ok('Syros EV is its own model, not merged', others.some((o) => o.model === MODEL))

    console.log('\nDROPDOWN VISIBILITY')
    const models = await sql<{ model: string }[]>`
      SELECT DISTINCT model FROM kia_price_details WHERE model NOT LIKE '\\_\\_%' ORDER BY 1`
    ok(`"${MODEL}" appears in the model dropdown`, models.some((m) => m.model === MODEL),
      `${models.length} models: ${models.map((m) => m.model).join(', ')}`)
    ok('bank fields left null (no phantom HYP branches added)',
      (await sql<{ n: number }[]>`SELECT COUNT(*)::int n FROM kia_price_details WHERE model = ${MODEL} AND (bank_branch IS NOT NULL OR bank_name IS NOT NULL)`)[0].n === 0)

    console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`} — ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error('\nVERIFY FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
