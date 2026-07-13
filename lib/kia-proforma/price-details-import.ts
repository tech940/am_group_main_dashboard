import 'server-only'

import * as XLSX from 'xlsx'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaPriceDetails, kiaProformaLookupOptions } from '@/lib/db/schema'
import { invalidateCache } from '@/lib/redis/cache-utils'

type RawRow = Record<string, unknown> & {
  __rowNumber: number
  __sheetName: string
}

type PriceInsert = typeof kiaPriceDetails.$inferInsert

export type KiaPriceImportFailure = {
  rowNumber: number
  reason: string
}

export type KiaPriceImportSummary = {
  sheetName: string
  totalRowsProcessed: number
  importedRows: number
  failedRows: number
  bankBranches: number
  failures: KiaPriceImportFailure[]
  startedAt: string
  completedAt: string
  durationMs: number
}

type LookupInsert = typeof kiaProformaLookupOptions.$inferInsert

// The PRICE DETAILS sheet co-locates a full bank-branch master list (HYP + BANK BRACH columns) that
// runs well past the priced rows. Capture every distinct (bank, branch) so the proforma HYP dropdown
// offers them all — stored in kia_proforma_lookup_options (category 'bank_branch') so a price
// re-import never wipes it. See app/api/brands/kia/proforma/options/route.ts.
function buildBranchInserts(rows: RawRow[]): LookupInsert[] {
  const seen = new Set<string>()
  const out: LookupInsert[] = []
  for (const row of rows) {
    const bank = toText(valueFor(row, 'hyp'))
    const branch = toText(valueFor(row, 'bankBranch'))
    if (!branch) continue
    const key = `${bank.toLowerCase()}||${branch.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      category: 'bank_branch',
      value: branch,
      label: bank || null,
      sourceSheet: row.__sheetName,
      sourceRow: row.__rowNumber,
      metadata: { bank_name: bank || null },
    })
  }
  return out
}

const PRICE_SHEET_NAME = 'PRICE DETAILS'

const REQUIRED_COLUMNS = ['model', 'trimDescription', 'exShowroomPrice'] as const

const HEADER_ALIASES: Record<typeof REQUIRED_COLUMNS[number] | keyof Omit<PriceInsert, 'id' | 'createdAt' | 'updatedAt'>, string[]> = {
  model: ['model', 'model name', 'vehicle model'],
  trimDescription: ['trim description', 'variant', 'variant description', 'trim', 'description'],
  hyp: ['hyp', 'hypothecation', 'bank', 'bank name'],
  bankName: ['bank name', 'bank', 'hyp', 'financier', 'financer'],
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
  metadata: ['metadata'],
}

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/@/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function toText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function toAmount(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(String(value ?? '').replace(/₹|rs\.?|,/gi, '').replace(/[^0-9.-]/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function valueFor(row: RawRow, key: keyof typeof HEADER_ALIASES) {
  for (const alias of HEADER_ALIASES[key]) {
    const normalized = normalizeHeader(alias)
    if (Object.prototype.hasOwnProperty.call(row, normalized)) return row[normalized]
  }
  return null
}

function selectPriceSheet(workbook: XLSX.WorkBook) {
  if (workbook.SheetNames.length === 1) return workbook.SheetNames[0]
  const exact = workbook.SheetNames.find((name) => name.trim().toUpperCase() === PRICE_SHEET_NAME)
  if (!exact) {
    throw new Error(`Workbook has multiple sheets. Add or select a sheet named "${PRICE_SHEET_NAME}".`)
  }
  return exact
}

function readRows(workbook: XLSX.WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet?.['!ref']) return []
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const headers: string[] = []
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })]
    headers.push(normalizeHeader(cell?.v) || `__empty_${column}`)
  }

  const rows: RawRow[] = []
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const row: RawRow = { __rowNumber: r + 1, __sheetName: sheetName }
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

function assertRequiredColumns(rows: RawRow[]) {
  const first = rows[0]
  if (!first) throw new Error('No price rows found in workbook.')
  const missing = REQUIRED_COLUMNS.filter((key) => valueFor(first, key) === null && !HEADER_ALIASES[key].some((alias) => Object.prototype.hasOwnProperty.call(first, normalizeHeader(alias))))
  if (missing.length > 0) {
    const labels = missing.map((key) => HEADER_ALIASES[key][0]).join(', ')
    throw new Error(`Missing required price detail column(s): ${labels}`)
  }
}

function buildPriceInsert(row: RawRow): { value?: PriceInsert; failure?: KiaPriceImportFailure } {
  const model = toText(valueFor(row, 'model'))
  const trimDescription = toText(valueFor(row, 'trimDescription'))
  const exShowroomPrice = toAmount(valueFor(row, 'exShowroomPrice'))

  if (!model) return { failure: { rowNumber: row.__rowNumber, reason: 'Model is blank.' } }
  if (!trimDescription) return { failure: { rowNumber: row.__rowNumber, reason: 'Trim Description is blank.' } }
  if (exShowroomPrice <= 0) return { failure: { rowNumber: row.__rowNumber, reason: 'Ex-showroom price is missing or invalid.' } }

  const hyp = toText(valueFor(row, 'hyp'))
  const bankName = toText(valueFor(row, 'bankName')) || hyp

  return {
    value: {
      model,
      trimDescription,
      hyp: hyp || null,
      bankName: bankName || null,
      bankBranch: toText(valueFor(row, 'bankBranch')) || null,
      exShowroomPrice: String(exShowroomPrice),
      tcs: String(toAmount(valueFor(row, 'tcs'))),
      registrationCharges: String(toAmount(valueFor(row, 'registrationCharges'))),
      statutoryCharges: String(toAmount(valueFor(row, 'statutoryCharges'))),
      insurance: String(toAmount(valueFor(row, 'insurance'))),
      fastag: String(toAmount(valueFor(row, 'fastag'))),
      accessoriesKit: String(toAmount(valueFor(row, 'accessoriesKit'))),
      extendedWarranty4thYear: String(toAmount(valueFor(row, 'extendedWarranty4thYear'))),
      insuranceCompany: toText(valueFor(row, 'insuranceCompany')) || null,
      metadata: {
        sourceSheet: row.__sheetName,
        sourceRow: row.__rowNumber,
        importMode: 'replace',
        colour: toText(row[normalizeHeader('Colour')]) || null,
        onRoadPrice: toAmount(row[normalizeHeader('On-Road Price')]),
        myConveniencePlus: toAmount(row[normalizeHeader('My Convenience Plus')]),
      },
    },
  }
}

export async function importKiaPriceDetailsFromWorkbook(buffer: Buffer): Promise<KiaPriceImportSummary> {
  const started = Date.now()
  const startedAt = new Date(started)
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheetName = selectPriceSheet(workbook)
  const rows = readRows(workbook, sheetName)
  assertRequiredColumns(rows)

  const values: PriceInsert[] = []
  const failures: KiaPriceImportFailure[] = []
  for (const row of rows) {
    const result = buildPriceInsert(row)
    if (result.value) values.push(result.value)
    if (result.failure) failures.push(result.failure)
  }
  const branchValues = buildBranchInserts(rows)

  await db.transaction(async (tx) => {
    await tx.delete(kiaPriceDetails)
    for (let index = 0; index < values.length; index += 500) {
      await tx.insert(kiaPriceDetails).values(values.slice(index, index + 500))
    }
    // Full bank-branch master list (scoped to 'bank_branch' only — other lookup categories untouched).
    await tx.delete(kiaProformaLookupOptions).where(eq(kiaProformaLookupOptions.category, 'bank_branch'))
    for (let index = 0; index < branchValues.length; index += 500) {
      await tx.insert(kiaProformaLookupOptions).values(branchValues.slice(index, index + 500))
    }
  })
  await invalidateCache('kia:proforma:options:data')

  const completed = Date.now()
  return {
    sheetName,
    totalRowsProcessed: rows.length,
    importedRows: values.length,
    failedRows: failures.length,
    bankBranches: branchValues.length,
    failures: failures.slice(0, 25),
    startedAt: startedAt.toISOString(),
    completedAt: new Date(completed).toISOString(),
    durationMs: completed - started,
  }
}
