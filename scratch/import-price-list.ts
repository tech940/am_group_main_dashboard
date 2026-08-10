import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { inArray, sql } from 'drizzle-orm'
import { db } from '../lib/db'
import { kiaPriceDetails } from '../lib/db/schema'

/**
 * One-off import of the Aug-2026 KIA price list (C:/Users/sahil/Downloads/Untitled.xlsx) into
 * kia_price_details.
 *
 * This workbook is a DIFFERENT SHAPE from what the admin importer expects (8 per-model sheets,
 * model in the sheet TITLE, no bank columns) — and the admin importer also deletes the whole
 * table, which would destroy the 328 '__BANK_OPTION__' bank-branch rows behind the HYP dropdown.
 * So this script:
 *   - detects each "<Model> Price List" section per sheet (a sheet can hold several — Syros
 *     carries Petrol AND Diesel lists);
 *   - replaces ONLY the price rows of models present in the workbook, preserving bank rows and
 *     any model the workbook does not mention (e.g. Syros EV);
 *   - keeps the exact row/metadata shape the proforma options route and importer already use.
 *
 * DRY RUN by default. Pass --apply to write.
 */

const FILE = 'C:/Users/sahil/Downloads/Untitled.xlsx'
const APPLY = process.argv.includes('--apply')

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const normHeader = (v: unknown) => norm(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const amount = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
  const p = Number(String(v ?? '').replace(/₹|rs\.?|,/gi, '').replace(/[^0-9.-]/g, '').trim())
  return Number.isFinite(p) ? Math.round(p * 100) / 100 : 0
}

type Insert = typeof kiaPriceDetails.$inferInsert

const HEADER_KEYS: Record<string, string> = {
  'trim description': 'trim',
  'colour': 'colour',
  'new ex showroom prices': 'ex',
  'tcs': 'tcs',
  'statutory charges': 'statutory',
  'registration charges': 'registration',
  'insurance': 'insurance',
  'fastag': 'fastag',
  'extended warranty 4th year': 'ew4',
  'on road price': 'onRoad',
  'my convenience plus': 'myConv',
  'accessories kit': 'accKit',
  'kia connect basic 1 year': 'kiaConnect',
}

function parseWorkbook() {
  const wb = XLSX.readFile(FILE)
  const inserts: Insert[] = []
  const sections: { sheet: string; model: string; rows: number }[] = []

  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null }) as unknown[][]
    let currentTitle = norm(sheetName)
    let cols: Record<string, number> | null = null
    let model = ''
    let count = 0

    const flushSection = () => {
      if (model && count > 0) sections.push({ sheet: sheetName, model, rows: count })
      count = 0
    }

    for (let r = 0; r < grid.length; r += 1) {
      const row = grid[r] ?? []
      const cellA = norm(row[0])
      const cellB = norm(row[1])

      // A section title: "New Seltos Petrol Price List" / "CARENS CLAVIS EV"
      const titleCell = cellA || cellB
      if (titleCell && /price list$/i.test(titleCell)) {
        flushSection()
        currentTitle = titleCell.replace(/\s*price list$/i, '').trim()
        // A mid-sheet section (Syros carries Petrol then Diesel) may reuse the columns of the list
        // above it without repeating the header row — keep `cols`, just switch the model.
        model = currentTitle
        continue
      }
      if (r === 0 && titleCell && !/price list/i.test(titleCell)) {
        currentTitle = titleCell // e.g. the EV sheet's bare "CARENS CLAVIS EV" banner
      }

      // A header row: contains 'Trim Description'
      if (row.some((c) => normHeader(c) === 'trim description')) {
        flushSection()
        cols = {}
        row.forEach((c, i) => {
          const key = HEADER_KEYS[normHeader(c)]
          if (key && cols && cols[key] === undefined) cols[key] = i
        })
        model = currentTitle
        continue
      }

      if (!cols || !model) continue
      const trim = norm(row[cols.trim])
      const ex = amount(row[cols.ex])
      if (!trim || ex <= 0) continue
      if (/price list|terms|condition/i.test(trim)) continue

      count += 1
      inserts.push({
        model,
        trimDescription: trim,
        hyp: null,
        bankName: null,
        bankBranch: null,
        exShowroomPrice: String(ex),
        tcs: String(amount(row[cols.tcs!])),
        statutoryCharges: String(amount(row[cols.statutory!])),
        registrationCharges: String(amount(row[cols.registration!])),
        insurance: String(amount(row[cols.insurance!])),
        fastag: String(amount(row[cols.fastag!])),
        accessoriesKit: String(amount(row[cols.accKit!])),
        extendedWarranty4thYear: String(amount(row[cols.ew4!])),
        insuranceCompany: null,
        metadata: {
          sourceSheet: sheetName,
          sourceRow: r + 1,
          importMode: 'replace',
          colour: norm(row[cols.colour!]) || null,
          onRoadPrice: amount(row[cols.onRoad!]),
          myConveniencePlus: amount(row[cols.myConv!]),
          kiaConnect: amount(row[cols.kiaConnect!]),
          importedFrom: 'Untitled.xlsx (Aug 2026 price list)',
        },
      })
    }
    flushSection()
  }
  return { inserts, sections }
}

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  const { inserts, sections } = parseWorkbook()
  console.log('sections detected:')
  for (const s of sections) console.log(`  [${s.sheet}] model=${JSON.stringify(s.model)} rows=${s.rows}`)
  console.log('total price rows parsed:', inserts.length)

  const incomingModels = [...new Set(inserts.map((i) => i.model))]
  const dupes = inserts.filter((i, idx) => inserts.findIndex((o) => o.model === i.model && o.trimDescription === i.trimDescription) !== idx)
  if (dupes.length) console.log('\n⚠ duplicate (model, trim) rows in workbook (kept as-is):', dupes.map((d) => `${d.model}|${d.trimDescription}`).join('; '))

  const current = rows(await db.execute(sql`
    SELECT model, COUNT(*) AS n FROM kia_price_details WHERE model NOT LIKE '\\_\\_%' GROUP BY 1 ORDER BY 1`))
  console.log('\ncurrent DB price rows by model:')
  for (const r of current) console.log(`  ${JSON.stringify(r.model)}: ${r.n}`)
  const currentModels = current.map((r) => String(r.model))
  const preserved = currentModels.filter((m) => !incomingModels.includes(m))
  const added = incomingModels.filter((m) => !currentModels.includes(m))
  console.log('\nmodels REPLACED:', incomingModels.filter((m) => currentModels.includes(m)).join(' | '))
  if (added.length) console.log('models ADDED (new):', added.join(' | '))
  if (preserved.length) console.log('models PRESERVED (not in workbook, left untouched):', preserved.join(' | '))

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to import.')
    return
  }

  // Backup the price rows being replaced, then swap inside one transaction.
  const backup = rows(await db.execute(sql`
    SELECT * FROM kia_price_details WHERE model NOT LIKE '\\_\\_%'`))
  const backupPath = `scratch/price-details-backup-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(backupPath, JSON.stringify(backup, null, 1))
  console.log(`\nbacked up ${backup.length} price rows -> ${backupPath}`)

  await db.transaction(async (tx) => {
    await tx.delete(kiaPriceDetails).where(inArray(kiaPriceDetails.model, incomingModels))
    for (let i = 0; i < inserts.length; i += 200) {
      await tx.insert(kiaPriceDetails).values(inserts.slice(i, i + 200))
    }
  })

  const { invalidateCache } = await import('../lib/redis/cache-utils')
  await Promise.all([
    invalidateCache('kia:proforma:options:data'),
    invalidateCache('finance:bank-options'),
  ])

  const after = rows(await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE model NOT LIKE '\\_\\_%') AS price_rows,
      COUNT(*) FILTER (WHERE model LIKE '\\_\\_%') AS bank_rows
    FROM kia_price_details`))
  console.log('after import:', JSON.stringify(after[0]))
  console.log('IMPORT APPLIED. Options cache invalidated.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
