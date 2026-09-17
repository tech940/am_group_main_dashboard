/**
 * Loads ONE model's price sheet (the "<MODEL> Price Details" layout) into `kia_price_details`, so the
 * Bookings form and the proforma price it automatically.
 *
 *   npx tsx scripts/import-kia-model-price-sheet.ts                                   # dry run
 *   npx tsx scripts/import-kia-model-price-sheet.ts --apply                           # write
 *   npx tsx scripts/import-kia-model-price-sheet.ts --file "C:/…/X Price List.xlsx" [--apply] [--prune]
 *
 * First used for "Sorento Price List JK.xlsx" (2026-09-17, WEF 04 Sep 2026): 32 trims, Diesel + HEV.
 *
 * ── The layout ───────────────────────────────────────────────────────────────────────────────────
 * A title row "<MODEL> Price Details", then a header row
 *   Engine | T/M | Trim | Ex Showroom | TCS | Statutory Charges | Green Tax | Registration Charges |
 *   Insurance | EW 4th YEAR / 1 LAKH KM | Fastag | On-road Price | Accessories Kit | My Convenience Plus |
 *   Kia Connect | Inclusive with My Conv Plus & Kia Connect & Accessories kit
 * then one row per trim, then dealer / address / T&C text. Columns are matched by HEADER TEXT, never position.
 *
 * ── Decisions (see memory kia-proforma-price-details) ─────────────────────────────────────────────
 * - Model = "<Model> <Engine>" ("Sorento Diesel", "Sorento HEV"), the per-fuel convention bookings use
 *   ("SONET DIESEL", "SYROS EV"). The proforma matches a price by (model, trim).
 * - UPSERT on (model, trim) — there is no unique constraint on the pair. Nothing is deleted unless
 *   --prune is given, and then only trims of THESE models that the sheet no longer lists (backed up first).
 * - Money is stored in whole rupees like every other row. The sheet's insurance is fractional; the exact
 *   figure is kept in metadata.insuranceExact.
 * - Registration and statutory stay SEPARATE (a CASH deal pays registration only — pricing.ts).
 * - hyp / bank_name / bank_branch stay NULL (bank rows are the '__BANK_OPTION__' markers).
 * - Refuses to write unless every row reconciles with the sheet's own On-road and Total formulas, and
 *   unless Green Tax is empty (the table has no column for it).
 *
 * ⚠️ The options endpoint is cached for 30 minutes INSIDE each server process (L1) as well as in Redis.
 * This script clears Redis only. To show the new prices at once, a signed-in admin/developer runs
 * `fetch('/api/admin/bust-bank-cache', { method: 'POST' })` in the dashboard, or the server restarts.
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import ExcelJS from 'exceljs'
import postgres from 'postgres'
import { invalidateCache } from '../lib/redis/cache-utils'
import { calculateKiaProformaPricing, type KiaPriceLookupRow, type ProformaPricingInput } from '../lib/kia-proforma/pricing'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const PRUNE = args.includes('--prune')
const fileArg = args.indexOf('--file')
const FILE = fileArg >= 0 ? args[fileArg + 1] : 'C:/Users/sahil/Downloads/Sorento Price List JK.xlsx'

const HEADERS = {
  engine: ['engine'],
  seating: ['t/m'],
  trim: ['trim'],
  ex: ['ex showroom'],
  tcs: ['tcs'],
  statutory: ['statutory charges'],
  greenTax: ['green tax'],
  registration: ['registration charges'],
  insurance: ['insurance'],
  extendedWarranty: ['ew 4th year / 1 lakh km', 'ew 4th year'],
  fastag: ['fastag'],
  onRoad: ['on-road price', 'on road price'],
  accessoriesKit: ['accessories kit'],
  myConveniencePlus: ['my convenience plus'],
  kiaConnect: ['kia connect'],
  total: ['inclusive with my conv plus & kia connect & accessories kit'],
} as const
type Key = keyof typeof HEADERS

const ENGINE_MODEL: Record<string, string> = { DIESEL: 'Diesel', PETROL: 'Petrol', HEV: 'HEV', HYBRID: 'HEV', EV: 'EV', ELECTRIC: 'EV' }

type SheetRow = {
  sourceRow: number
  model: string
  trim: string
  trimAsWritten: string
  engine: string
  seating: string | null
  ex: number
  tcs: number
  statutory: number
  registration: number
  insurance: number
  insuranceExact: number
  extendedWarranty: number
  fastag: number
  accessoriesKit: number
  myConveniencePlus: number
  kiaConnect: number
  onRoad: number
  total: number
  sheetOnRoad: number
  sheetTotal: number
  greenTax: number
}

const text = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim()
const inr = (n: number) => n.toLocaleString('en-IN')

function cellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value as unknown
  if (value && typeof value === 'object') {
    if ('result' in value) return (value as { result: unknown }).result
    if ('richText' in value) return (value as { richText: Array<{ text: string }> }).richText.map((part) => part.text).join('')
    if ('text' in value) return (value as { text: unknown }).text
  }
  return value
}

function money(value: unknown, where: string): number {
  if (value === null || value === undefined || value === '') return 0
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[₹,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0) throw new Error(`${where}: "${String(value)}" is not an amount`)
  return n
}

/** Spacing slips in the sheet ("AWDHTX 6", "HTK(A)B7") made consistent with the sibling trims. */
function tidyTrim(raw: string): string {
  return text(raw).replace(/\bAWDHTX\b/g, 'AWD HTX').replace(/\)([A-Z]\d)\b/g, ') $1')
}

async function readSheet(): Promise<{ modelBase: string; effective: string | null; rows: SheetRow[] }> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(FILE)
  if (workbook.worksheets.length !== 1) throw new Error(`Expected one sheet, found ${workbook.worksheets.length}`)
  const sheet = workbook.worksheets[0]

  let title = ''
  let headerRow = 0
  const columns = new Map<Key, number>()
  let effective: string | null = null
  sheet.eachRow((row, index) => {
    const cells: Array<[number, string]> = []
    row.eachCell((cell, col) => cells.push([col, text(cellValue(cell))]))
    if (!title) {
      const found = cells.find(([, value]) => /price details$/i.test(value))
      if (found) title = found[1]
    }
    const wef = cells.map(([, value]) => /WEF\s+(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i.exec(value)).find(Boolean)
    if (wef) effective = wef[1]
    if (!headerRow && cells.some(([, value]) => value.toLowerCase() === 'trim') && cells.some(([, value]) => value.toLowerCase() === 'ex showroom')) {
      headerRow = index
      for (const [col, value] of cells) {
        const key = (Object.keys(HEADERS) as Key[]).find((k) => (HEADERS[k] as readonly string[]).includes(value.toLowerCase()))
        if (key) columns.set(key, col)
      }
    }
  })
  if (!title) throw new Error('No "<MODEL> Price Details" title row')
  if (!headerRow) throw new Error('No header row with "Trim" and "Ex Showroom"')
  const missing = (Object.keys(HEADERS) as Key[]).filter((key) => !columns.has(key))
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`)

  const base = title.replace(/\s*price details$/i, '').trim()
  const modelBase = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase()
  const rows: SheetRow[] = []
  sheet.eachRow((row, index) => {
    if (index <= headerRow) return
    const get = (key: Key) => cellValue(row.getCell(columns.get(key)!))
    const trimAsWritten = text(get('trim'))
    const ex = money(get('ex'), `row ${index} ex-showroom`)
    if (!trimAsWritten || ex <= 0) return // dealer name, address and T&C lines
    const engine = text(get('engine')).toUpperCase()
    const suffix = ENGINE_MODEL[engine]
    if (!suffix) throw new Error(`row ${index}: unknown engine "${engine}"`)
    const at = (key: Key) => money(get(key), `row ${index} ${key}`)
    const insuranceExact = at('insurance')
    const whole = {
      ex: Math.round(ex),
      tcs: Math.round(at('tcs')),
      statutory: Math.round(at('statutory')),
      registration: Math.round(at('registration')),
      insurance: Math.round(insuranceExact),
      extendedWarranty: Math.round(at('extendedWarranty')),
      fastag: Math.round(at('fastag')),
      accessoriesKit: Math.round(at('accessoriesKit')),
      myConveniencePlus: Math.round(at('myConveniencePlus')),
      kiaConnect: Math.round(at('kiaConnect')),
    }
    const onRoad = whole.ex + whole.tcs + whole.statutory + whole.registration + whole.insurance + whole.extendedWarranty + whole.fastag
    rows.push({
      sourceRow: index,
      model: `${modelBase} ${suffix}`,
      trim: tidyTrim(trimAsWritten),
      trimAsWritten,
      engine,
      seating: text(get('seating')) || null,
      ...whole,
      insuranceExact,
      onRoad,
      total: onRoad + whole.accessoriesKit + whole.myConveniencePlus + whole.kiaConnect,
      sheetOnRoad: at('onRoad'),
      sheetTotal: at('total'),
      greenTax: at('greenTax'),
    })
  })
  return { modelBase, effective, rows }
}

function pricingRow(row: Record<string, unknown>): KiaPriceLookupRow {
  return {
    model: row.model as string,
    trimDescription: row.trim_description as string,
    exShowroomPrice: row.ex_showroom_price as string,
    tcs: row.tcs as string,
    registrationCharges: row.registration_charges as string,
    statutoryCharges: row.statutory_charges as string,
    insurance: row.insurance as string,
    fastag: row.fastag as string,
    accessoriesKit: row.accessories_kit as string,
    extendedWarranty4thYear: row.extended_warranty_4th_year as string,
    insuranceCompany: row.insurance_company as string | null,
  }
}

async function main() {
  const { modelBase, effective, rows } = await readSheet()
  const models = [...new Set(rows.map((row) => row.model))]
  console.log(`\nFILE    ${basename(FILE)}`)
  console.log(`MODELS  ${models.map((m) => `${m} (${rows.filter((r) => r.model === m).length})`).join(', ')}   price list WEF ${effective ?? 'not stated'}`)
  console.log(`MODE    ${APPLY ? `APPLY${PRUNE ? ' + PRUNE' : ''} (writes)` : 'DRY RUN (no writes)'}\n`)

  // ── Checks before anything is written ─────────────────────────────────────────────────────────
  const problems: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.model}|${row.trim.toLowerCase()}`
    if (seen.has(key)) problems.push(`row ${row.sourceRow}: "${row.trim}" appears twice in ${row.model}`)
    seen.add(key)
    if (row.greenTax !== 0) problems.push(`row ${row.sourceRow}: Green Tax ${row.greenTax} has no column in kia_price_details`)
    if (row.onRoad !== Math.round(row.sheetOnRoad)) problems.push(`row ${row.sourceRow} ${row.trim}: on-road ${row.onRoad} ≠ sheet ${row.sheetOnRoad}`)
    if (row.total !== Math.round(row.sheetTotal)) problems.push(`row ${row.sourceRow} ${row.trim}: total ${row.total} ≠ sheet ${row.sheetTotal}`)
    if (row.tcs !== Math.round(row.ex * 0.01)) problems.push(`row ${row.sourceRow} ${row.trim}: TCS is not 1 % of ex-showroom`)
  }
  console.log('RECONCILIATION — stored components vs the sheet\'s own On-road and Total')
  for (const row of rows) {
    console.log(`  ${row.model.padEnd(15)} ${row.trim.padEnd(34)} ${(row.seating ?? '').padEnd(7)} ex ${inr(row.ex).padStart(11)}  ins ${inr(row.insurance).padStart(9)}  on-road ${inr(row.onRoad).padStart(11)}`)
  }
  const tidied = rows.filter((row) => row.trim !== row.trimAsWritten)
  if (tidied.length) {
    console.log('\nTRIM NAMES TIDIED (spacing only)')
    for (const row of tidied) console.log(`  "${row.trimAsWritten}" → "${row.trim}"`)
  }
  if (problems.length) {
    console.log(`\n${problems.length} PROBLEM(S) — nothing will be written:`)
    for (const problem of problems) console.log(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`\n  all ${rows.length} rows reconcile with the sheet\n`)

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    const existing = await sql<Record<string, unknown>[]>`
      SELECT * FROM kia_price_details WHERE model = ANY(${models}) ORDER BY model, trim_description`
    const sameBase = await sql<{ model: string; n: number }[]>`
      SELECT model, count(*)::int AS n FROM kia_price_details
      WHERE model ILIKE ${`${modelBase}%`} AND NOT (model = ANY(${models})) GROUP BY model`
    const [{ total: totalBefore }] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM kia_price_details`
    const existingKeys = new Map(existing.map((row) => [`${row.model}|${String(row.trim_description).toLowerCase()}`, row]))
    const toInsert = rows.filter((row) => !existingKeys.has(`${row.model}|${row.trim.toLowerCase()}`))
    const toUpdate = rows.filter((row) => existingKeys.has(`${row.model}|${row.trim.toLowerCase()}`))
    const stale = existing.filter((row) => !seen.has(`${row.model}|${String(row.trim_description).toLowerCase()}`))
    console.log(`DATABASE  ${totalBefore} rows in kia_price_details; ${existing.length} already under ${models.join(' / ')}`)
    console.log(`          insert ${toInsert.length} · update ${toUpdate.length} · no longer listed ${stale.length}${stale.length ? (PRUNE ? ' (will be REMOVED)' : ' (kept; --prune removes them)') : ''}`)
    if (sameBase.length) console.log(`          other ${modelBase} models left untouched: ${sameBase.map((m) => `${m.model} (${m.n})`).join(', ')}`)

    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply.\n')
      return
    }

    if (existing.length) {
      const dir = join('scripts', 'backups')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `kia-price-details-${modelBase.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
      writeFileSync(file, JSON.stringify(existing, null, 2))
      console.log(`\nBACKUP    ${existing.length} existing rows → ${file}`)
    }

    const importedAt = new Date().toISOString()
    await sql.begin(async (tx) => {
      for (const row of rows) {
        const metadata = {
          engine: row.engine,
          seating: row.seating,
          onRoadPrice: row.onRoad,
          totalAmount: row.total,
          insuranceExact: row.insuranceExact,
          myConveniencePlus: row.myConveniencePlus,
          kiaConnect: row.kiaConnect,
          greenTax: row.greenTax,
          priceListEffective: effective,
          sourceRow: row.sourceRow,
          sourceSheet: basename(FILE),
          ...(row.trim !== row.trimAsWritten ? { trimAsWritten: row.trimAsWritten } : {}),
          importedAt,
        }
        const updated = await tx`
          UPDATE kia_price_details SET
            ex_showroom_price = ${row.ex}, tcs = ${row.tcs}, statutory_charges = ${row.statutory},
            registration_charges = ${row.registration}, insurance = ${row.insurance}, fastag = ${row.fastag},
            extended_warranty_4th_year = ${row.extendedWarranty}, accessories_kit = ${row.accessoriesKit},
            metadata = ${tx.json(metadata)}, updated_at = NOW()
          WHERE model = ${row.model} AND lower(trim_description) = ${row.trim.toLowerCase()}
          RETURNING id`
        if (updated.length > 1) throw new Error(`${row.model} "${row.trim}" is on ${updated.length} rows — clean the duplicates first`)
        if (updated.length === 0) {
          await tx`
            INSERT INTO kia_price_details (
              model, trim_description, ex_showroom_price, tcs, statutory_charges, registration_charges,
              insurance, fastag, extended_warranty_4th_year, accessories_kit, metadata
            ) VALUES (
              ${row.model}, ${row.trim}, ${row.ex}, ${row.tcs}, ${row.statutory}, ${row.registration},
              ${row.insurance}, ${row.fastag}, ${row.extendedWarranty}, ${row.accessoriesKit}, ${tx.json(metadata)}
            )`
        }
      }
      if (PRUNE && stale.length) {
        await tx`DELETE FROM kia_price_details WHERE id = ANY(${stale.map((row) => row.id as string)})`
      }
    })

    // ── Read back, and price a proforma with the app's own function ──────────────────────────────
    const after = await sql<Record<string, unknown>[]>`
      SELECT * FROM kia_price_details WHERE model = ANY(${models}) ORDER BY model, trim_description`
    const [{ total: totalAfter }] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM kia_price_details`
    const mismatches = rows.filter((row) => {
      const stored = after.find((a) => a.model === row.model && String(a.trim_description).toLowerCase() === row.trim.toLowerCase())
      return !stored || Number(stored.ex_showroom_price) !== row.ex || Number(stored.insurance) !== row.insurance
        || Number(stored.registration_charges) !== row.registration || Number(stored.statutory_charges) !== row.statutory
    })
    console.log(`\nWRITTEN   ${after.length} rows under ${models.join(' / ')}; table ${totalBefore} → ${totalAfter}; read-back mismatches: ${mismatches.length}`)
    if (mismatches.length) throw new Error(`Read-back mismatch: ${mismatches.map((m) => m.trim).join(', ')}`)

    const lookup = after.map(pricingRow)
    for (const sample of [rows[0], rows[rows.length - 1]]) {
      const base: Omit<ProformaPricingInput, 'bankName'> = {
        bankBranch: '', modelName: sample.model, trimDescription: sample.trim, exShowroom: 0, tcsValue: 0, registrationCharges: 0,
        insuranceValue: 0, fastagValue: 0, accessoriesKit: 0, extWarranty: 0, cashDiscount: 0, exchangeValue: 0, bookingAmount: 0,
        govtEmployeeDiscount: 0, additionalDiscount: 0,
      }
      const cash = calculateKiaProformaPricing({ ...base, bankName: 'CASH' }, lookup, [])
      const financed = calculateKiaProformaPricing({ ...base, bankName: '' }, lookup, [])
      console.log(`PROFORMA  ${sample.trim}: ex ${cash.prefill?.exShowroom} · registration cash ${cash.prefill?.registrationCharges} / financed ${financed.prefill?.registrationCharges} · insurance ${cash.prefill?.insuranceValue}`)
      if (!cash.prefill || Number(cash.prefill.exShowroom) !== sample.ex || Number(cash.prefill.registrationCharges) !== sample.registration
        || Number(financed.prefill?.registrationCharges) !== sample.registration + sample.statutory) {
        throw new Error(`The proforma does not price ${sample.trim} as the sheet does`)
      }
    }

    await invalidateCache('kia:proforma:options:data')
    await invalidateCache('finance:bank-options')
    console.log('\nRedis cache cleared. A running server may keep its in-memory copy for up to 30 minutes:')
    console.log("  signed in as admin/developer, run  fetch('/api/admin/bust-bank-cache', { method: 'POST' })  or restart the server.\n")
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('\nIMPORT FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
