/* eslint-disable no-console */
const path = require('path')
const XLSX = require('xlsx')
const postgres = require('postgres')
const dotenv = require('dotenv')

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const fileArgIndex = process.argv.indexOf('--file')
const filePath = path.resolve(fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : 'C:\\Users\\sahil\\Downloads\\KIA PROFORMA (Responses).xlsx')
const shouldApply = process.argv.includes('--apply')
const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL || process.env.POSTGRES_URL

function normalizeHeader(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/@/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function toText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function toAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(String(value ?? '').replace(/₹|rs\.?|,/gi, '').replace(/[^0-9.-]/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

const aliases = {
  model: ['model', 'model name', 'vehicle model'],
  trimDescription: ['trim description', 'variant', 'variant description', 'trim', 'description'],
  hyp: ['hyp', 'hypothecation', 'bank', 'bank name'],
  bankBranch: ['bank brach', 'bank branch', 'branch'],
  exShowroomPrice: ['new ex-showroom prices', 'new ex showroom prices', 'ex showroom price', 'ex-showroom price', 'ex showroom'],
  tcs: ['tcs', 't.c.s. 1%', 't.c.s @1%', 't.c.s. @1%'],
  registrationCharges: ['registration charges', 'registration', 'rto', 'r.t.o 9%', 'r.t.o @9%'],
  statutoryCharges: ['statutory charges', 'statutory'],
  insurance: ['insurance', 'insurance approx', 'insurance approximate'],
  fastag: ['fastag', 'fast tag', 'number plate'],
  accessoriesKit: ['accessories kit', 'accessories combo', 'accessories'],
  extendedWarranty4thYear: ['extended warranty 4th year', 'extended warranty', 'warranty', 'ext warranty'],
  insuranceCompany: ['insurance company', 'insurer'],
}

function get(row, key) {
  for (const alias of aliases[key]) {
    const normalized = normalizeHeader(alias)
    if (Object.prototype.hasOwnProperty.call(row, normalized)) return row[normalized]
  }
  return null
}

function readRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet || !sheet['!ref']) return []
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const headers = []
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })]
    headers.push(normalizeHeader(cell?.v) || `__empty_${c}`)
  }
  const rows = []
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const row = { __rowNumber: r + 1, __sheetName: sheetName }
    let hasValue = false
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      const value = cell?.v ?? null
      if (value !== null && value !== undefined && String(value).trim() !== '') hasValue = true
      row[headers[c - range.s.c]] = value
    }
    if (hasValue) rows.push(row)
  }
  return rows
}

function buildRows(rows) {
  const failures = []
  const values = []
  for (const row of rows) {
    const model = toText(get(row, 'model'))
    const trimDescription = toText(get(row, 'trimDescription'))
    const exShowroomPrice = toAmount(get(row, 'exShowroomPrice'))
    if (!model || !trimDescription || exShowroomPrice <= 0) {
      failures.push({ rowNumber: row.__rowNumber, reason: !model ? 'Model missing' : !trimDescription ? 'Trim missing' : 'Ex-showroom price invalid' })
      continue
    }
    const hyp = toText(get(row, 'hyp'))
    values.push({
      model,
      trim_description: trimDescription,
      hyp: hyp || null,
      bank_name: hyp || null,
      bank_branch: toText(get(row, 'bankBranch')) || null,
      ex_showroom_price: exShowroomPrice,
      tcs: toAmount(get(row, 'tcs')),
      registration_charges: toAmount(get(row, 'registrationCharges')),
      statutory_charges: toAmount(get(row, 'statutoryCharges')),
      insurance: toAmount(get(row, 'insurance')),
      fastag: toAmount(get(row, 'fastag')),
      accessories_kit: toAmount(get(row, 'accessoriesKit')),
      extended_warranty_4th_year: toAmount(get(row, 'extendedWarranty4thYear')),
      insurance_company: toText(get(row, 'insuranceCompany')) || null,
      metadata: {
        sourceSheet: row.__sheetName,
        sourceRow: row.__rowNumber,
        importMode: 'replace',
        colour: toText(row[normalizeHeader('Colour')]) || null,
        onRoadPrice: toAmount(row[normalizeHeader('On-Road Price')]),
        myConveniencePlus: toAmount(row[normalizeHeader('My Convenience Plus')]),
      },
    })
  }
  return { values, failures }
}

// The PRICE DETAILS sheet co-locates a full bank-branch master list (HYP + BANK BRACH columns) that
// extends well past the priced rows. Capture EVERY distinct (bank, branch) so the proforma HYP
// dropdown offers them all, not only the branches attached to a priced car. Stored in
// kia_proforma_lookup_options (category 'bank_branch') so a price re-import never wipes it.
function buildBranchList(rows) {
  const seen = new Set()
  const values = []
  for (const row of rows) {
    const bank = toText(get(row, 'hyp'))
    const branch = toText(get(row, 'bankBranch'))
    if (!branch) continue
    const key = `${bank.toLowerCase()}||${branch.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    values.push({
      category: 'bank_branch',
      value: branch,
      label: bank || null,
      source_sheet: row.__sheetName,
      source_row: row.__rowNumber,
      metadata: { bank_name: bank || null },
    })
  }
  return values
}

async function main() {
  const workbook = XLSX.readFile(filePath, { cellDates: true })
  const sheetName = workbook.SheetNames.length === 1
    ? workbook.SheetNames[0]
    : workbook.SheetNames.find((name) => name.trim().toUpperCase() === 'PRICE DETAILS')
  if (!sheetName) throw new Error('Workbook must contain a PRICE DETAILS sheet.')
  const sourceRows = readRows(workbook, sheetName)
  const { values, failures } = buildRows(sourceRows)
  const branchValues = buildBranchList(sourceRows)
  console.log(JSON.stringify({ filePath, sheetName, processed: sourceRows.length, importable: values.length, failed: failures.length, bankBranches: branchValues.length, failures: failures.slice(0, 10), mode: shouldApply ? 'apply' : 'dry-run' }, null, 2))
  if (!shouldApply) return
  if (!databaseUrl) throw new Error('DATABASE_URL is missing in .env')
  const sql = postgres(databaseUrl, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20 })
  try {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM kia_price_details`
      const columns = [
        'model',
        'trim_description',
        'hyp',
        'bank_name',
        'bank_branch',
        'ex_showroom_price',
        'tcs',
        'registration_charges',
        'statutory_charges',
        'insurance',
        'fastag',
        'accessories_kit',
        'extended_warranty_4th_year',
        'insurance_company',
        'metadata',
      ]
      for (let i = 0; i < values.length; i += 500) {
        const chunk = values.slice(i, i + 500)
        await tx`INSERT INTO ${tx('kia_price_details')} ${tx(chunk, columns)}`
      }

      // Full bank-branch master list → kia_proforma_lookup_options (scoped to 'bank_branch' only).
      await tx`DELETE FROM kia_proforma_lookup_options WHERE category = 'bank_branch'`
      const lookupColumns = ['category', 'value', 'label', 'source_sheet', 'source_row', 'metadata']
      for (let i = 0; i < branchValues.length; i += 500) {
        const chunk = branchValues.slice(i, i + 500)
        await tx`INSERT INTO ${tx('kia_proforma_lookup_options')} ${tx(chunk, lookupColumns)}`
      }
    })
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
