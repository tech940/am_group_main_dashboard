/**
 * Imports the group scrap register (`overall scrap.xlsx`) into `scrap_transactions`.
 *
 *   npx tsx scripts/import-overall-scrap-xlsx.ts --file "C:/Users/sahil/Downloads/overall scrap.xlsx"
 *
 *   (no flag)       DRY RUN — parse, normalise, print the full reconciliation, write nothing
 *   --apply         back up the current rows, then REPLACE the table contents in one transaction
 *   --backup-only   dump the current rows to JSON and stop
 *
 * ⚠️ --apply is DESTRUCTIVE: the register is a whole-table replace, not an append. The sheet is a
 * corrected re-issue covering the same period as the existing rows, so appending would double-count
 * the entire period. Existing rows are written to scripts/backups/ first and the delete/insert runs
 * in a single transaction, so a mid-flight failure leaves the old data untouched.
 *
 * ⚠️ FOUR TRAPS, all verified against the real file — see the notes at each site below:
 *   1. QTY and TOTAL VALUE wear a DATE number format but hold plain numbers.
 *   2. Six DATE cells are the text "30-07-206" (a typo for 2026-07-30), not serials.
 *   3. TOTAL VALUE is authoritative; QTY x RATE disagrees on 12 rows and must not be recomputed.
 *   4. lib/db/schema.ts is STALE for this table — the live table has 38 columns including a NOT NULL
 *      `unit` that Drizzle does not know about, so this writes parameterised raw SQL instead.
 */
import 'dotenv/config'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import postgres from 'postgres'

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const FILE = opt('file') || 'C:/Users/sahil/Downloads/overall scrap.xlsx'
const APPLY = flag('apply')
const BACKUP_ONLY = flag('backup-only')

// ── Header handling ──────────────────────────────────────────────────────────────────────────────
// Aliased so a re-issued sheet with slightly different captions still imports (same idea as
// HEADER_ALIASES in lib/kia-proforma/price-details-import.ts).
const normalizeHeader = (h: string) => String(h || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const HEADER_ALIASES: Record<string, string> = {
  SNO: 'sno', SNO_: 'sno', SERIALNO: 'sno',
  DATE: 'date',
  LOCATIONNAME: 'location', LOCATION: 'location',
  DEALERNAME: 'dealer', DEALER: 'dealer', COMPANY: 'dealer',
  VENDORNAME: 'vendor', VENDOR: 'vendor', SOLDTO: 'vendor',
  SCRAPITEMNAME: 'item', ITEMNAME: 'item', DESCRIPTION: 'item',
  SCRAPTYPE: 'type',
  QTYKGS: 'qty', QTY: 'qty', WEIGHTQTY: 'qty', WEIGHT: 'qty',
  RATEPERKG: 'rate', RATE: 'rate', RATEPERUNIT: 'rate',
  TOTALVALUE: 'total', TOTALAMOUNT: 'total', AMOUNT: 'total',
  MODEOFPAYMENT: 'mode', PAYMENTMODE: 'mode',
  PAYMENTSUBMITTEDREMARKS: 'remark', PAYMENTHANDOVERTO: 'remark', REMARKS: 'remark',
}
const REQUIRED = ['date', 'location', 'dealer', 'total', 'mode', 'remark'] as const

// ── Value coercion ───────────────────────────────────────────────────────────────────────────────
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

/** TRAP 1: never route these through a date parser — see excelDate for why. */
function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * TRAP 2: 259 DATE cells are Excel serials, 6 are the literal text "30-07-206" — a mistyped
 * "30-07-2026". A 3-digit year is treated as 2026 rather than dropped, because those 6 rows are real
 * revenue on the register's last day.
 */
function excelDate(v: unknown): string | null {
  if (v instanceof Date) return iso(v)
  if (typeof v === 'number' && Number.isFinite(v)) return iso(new Date(EXCEL_EPOCH + v * 86400000))
  const s = clean(v)
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return iso(new Date(EXCEL_EPOCH + Number(s) * 86400000))
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/)
  if (m) {
    const d = Number(m[1])
    const mo = Number(m[2])
    let y = Number(m[3])
    if (y < 100) y += 2000
    else if (y < 1000) y = 2026 // "206" -> 2026
    const dt = new Date(Date.UTC(y, mo - 1, d))
    return Number.isNaN(dt.getTime()) ? null : iso(dt)
  }
  return null
}

// ── Normalisation maps ───────────────────────────────────────────────────────────────────────────
/**
 * Dealer -> group_name. These 8 literals are the ones ALREADY in the live table, and each was
 * checked against getCompanyShareConfig (lib/scrap-erp/distribution.ts) to confirm it resolves to
 * the intended company.
 *
 * ⚠️ That matcher uses `upper.includes(key)` in ARRAY ORDER and its first entry's keys include the
 * 3-letter 'JAM', so any group string containing "JAM" resolves to JAMMU AUTOMART first. Do not
 * invent new group literals without re-checking them against it.
 *
 * AM HYUNDAI-MOBIS folds into JAM by owner decision — it is part of Jammu Automart, not its own
 * entity, so it shares the 70/30 split rather than getting a config of its own.
 */
function toGroupName(dealer: string): string {
  const d = dealer.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
  if (d.includes('MOBIS')) return 'JAM'
  if (d.includes('PLATINUM') || d === 'PLATINUM') return 'PLATINUM'
  if (d.includes('HYUNDAI')) return 'JAM'
  if (d.includes('DIAMOND') || d.includes('HONDA')) return 'DIAMOND'
  if (d.includes('TATA')) return 'SMAM TATA'
  if (d.includes('KIA')) return 'AM KIA'
  if (d.includes('BAJAJ')) return 'BAJAJ'
  if (d.includes('KTM')) return 'KTM'
  if (d === 'MG' || d.includes('AM MG')) return 'MG'
  return d || 'JAM'
}

function toScrapType(raw: string): string {
  const t = raw.toUpperCase().replace(/\s+/g, ' ').trim()
  if (t.includes('OIL')) return 'USED OIL'
  if (t.includes('BATTER')) return 'OLD BATTERIES'
  return 'SCRAP'
}

/** Live column is NOT NULL. Oil is sold by the litre, everything else by weight. */
const toUnit = (scrapType: string) => (scrapType === 'USED OIL' ? 'Ltr' : 'Kg')

function toDepartment(location: string): string {
  const l = location.toUpperCase()
  if (l.includes('BODYSHOP') || l.includes('BODY SHOP')) return 'BODYSHOP'
  if (l.includes('SALES') || l.includes('SHOWROOM')) return 'SALES'
  return 'SERVICE' // 176 of 265 rows carry no department keyword at all
}

/**
 * The register records custody in free text. Two spellings mean "the cash reached the MD" —
 * `CASH TO MD"s` (42 rows) and `CASH HANDOVER TO MD` (27) — and by owner decision both count.
 * They are written as the single literal below because features/scrap-erp/ScrapDistributionView.tsx
 * keys its accounts-vs-MD split on exactly that string; normalising here means the Distribution tab
 * picks up all 69 rows with no code change. The verbatim original survives in `remarks`.
 */
export const MD_CASH_HANDOVER = 'CASH HANDOVER TO MD'

export function isMdCashRemark(remark: string): boolean {
  const r = remark.toUpperCase().replace(/["']/g, '').replace(/\s+/g, ' ')
  return r.includes('CASH') && r.includes('MD')
}

/** Folds the register's typos/case drift so one person is not split across report rows. */
function toHandoverName(remark: string): string {
  if (isMdCashRemark(remark)) return MD_CASH_HANDOVER
  let r = remark.toUpperCase().replace(/\s+/g, ' ').trim()
  r = r.replace(/\bACCONTANT\b/g, 'ACCOUNTANT')
  r = r.replace(/\bSOURAB\b/g, 'SOURAV')
  r = r.replace(/\bKESHAV SIR\b/g, 'KESHAV')
  if (r && !r.startsWith('ACCOUNTANT') && /^[A-Z ]+$/.test(r)) r = `ACCOUNTANT ${r}`
  return r || 'UNSPECIFIED'
}

const toPaymentMode = (raw: string) => {
  const m = raw.toUpperCase().trim()
  if (m.includes('CASH')) return 'CASH'
  if (m.includes('CHEQUE') || m.includes('CHECK')) return 'CHEQUE'
  return 'ONLINE'
}

// ── Types ────────────────────────────────────────────────────────────────────────────────────────
type ParsedRow = {
  sheetRow: number
  transactionNumber: string
  soldDate: string
  groupName: string
  locationName: string
  departmentName: string
  scrapTypeName: string
  unit: string
  description: string
  weightQty: number
  ratePerUnit: number
  calculatedTotal: number
  amountReceived: number
  soldTo: string
  paymentModeName: string
  paymentHandoverToName: string
  remarks: string
  metadata: Record<string, unknown>
}
type Failure = { sheetRow: number; reason: string }

// ── Parse ────────────────────────────────────────────────────────────────────────────────────────
function parseWorkbook(path: string) {
  const buf = readFileSync(path)
  // TRAP 1: NO `cellDates: true`. QTY and TOTAL VALUE carry a date number format by mistake; a
  // date-aware read silently turns 1310 kg into "1903-08-02" and 19650 into "1953-10-18".
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('workbook has no sheets')

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: true })

  // The caption row is not row 1 — find the row that resolves the most known headers.
  let headerIdx = -1
  let best = 0
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const hits = (grid[i] || []).filter((c) => HEADER_ALIASES[normalizeHeader(String(c))]).length
    if (hits > best) { best = hits; headerIdx = i }
  }
  if (headerIdx < 0) throw new Error('could not locate a header row in the first 10 rows')

  const headerCells = grid[headerIdx] as unknown[]
  const colOf: Record<string, number> = {}
  headerCells.forEach((cell, i) => {
    const key = HEADER_ALIASES[normalizeHeader(String(cell))]
    if (key && colOf[key] === undefined) colOf[key] = i
  })
  const missing = REQUIRED.filter((k) => colOf[k] === undefined)
  if (missing.length) throw new Error(`sheet is missing required column(s): ${missing.join(', ')}`)

  const rows: ParsedRow[] = []
  const failures: Failure[] = []

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i] || []
    const sheetRow = i + 1
    const cell = (k: string) => (colOf[k] === undefined ? '' : r[colOf[k]])
    if (r.every((c) => c === undefined || c === null || String(c).trim() === '')) continue

    /**
     * Skip footer/summary rows silently instead of failing the import.
     *
     * The register carries running-total formulas BELOW the data (e.g. a grand total and a
     * variance-vs-last-issue cell), in a column outside the 12 data columns. The all-blank guard
     * above does not catch them, so they used to land in `failures` — and because --apply refuses to
     * run with any failure, a perfectly good sheet became unimportable.
     *
     * The test: a real record always carries at least one of DATE / DEALER / TOTAL. A row with none
     * of them is not a broken record, it is not a record at all.
     */
    const looksLikeRecord = ['date', 'dealer', 'total', 'location', 'vendor', 'item']
      .some((k) => String(cell(k) ?? '').trim() !== '')
    if (!looksLikeRecord) continue

    const soldDate = excelDate(cell('date'))
    const total = toNumber(cell('total'))
    const dealerRaw = clean(cell('dealer'))
    if (!soldDate) { failures.push({ sheetRow, reason: `unparseable DATE: ${JSON.stringify(cell('date'))}` }); continue }
    if (!dealerRaw) { failures.push({ sheetRow, reason: 'DEALER NAME is blank' }); continue }
    if (!(total > 0)) { failures.push({ sheetRow, reason: `TOTAL VALUE is not a positive number: ${JSON.stringify(cell('total'))}` }); continue }

    const typeRaw = clean(cell('type'))
    const scrapTypeName = toScrapType(typeRaw)
    const locationName = clean(cell('location')).toUpperCase()
    const remarkRaw = clean(cell('remark'))
    const itemRaw = clean(cell('item')).toUpperCase()

    rows.push({
      sheetRow,
      transactionNumber: '', // assigned after sorting
      soldDate,
      groupName: toGroupName(dealerRaw),
      locationName: locationName || 'UNSPECIFIED',
      departmentName: toDepartment(locationName),
      scrapTypeName,
      unit: toUnit(scrapTypeName),
      description: itemRaw || scrapTypeName,
      weightQty: toNumber(cell('qty')),
      ratePerUnit: toNumber(cell('rate')),
      // TRAP 3: TOTAL VALUE as-is. QTY x RATE disagrees on 12 rows (blank QTY/RATE with a known
      // total); recomputing would erase real revenue.
      calculatedTotal: total,
      amountReceived: total, // owner decision: every row fully collected
      soldTo: clean(cell('vendor')) || 'UNSPECIFIED',
      paymentModeName: toPaymentMode(clean(cell('mode'))),
      paymentHandoverToName: toHandoverName(remarkRaw),
      remarks: remarkRaw,
      metadata: {
        importSource: 'overall-scrap-xlsx',
        sheetRow,
        rawDealer: dealerRaw,
        rawRemark: remarkRaw,
        rawScrapType: typeRaw,
        rawSNo: clean(cell('sno')),
      },
    })
  }

  // Deterministic numbering: one pass over sorted rows, no per-row SELECT. The route's
  // SELECT-max-then-+1 (app/api/scrap-erp/route.ts) races against the UNIQUE index in a bulk loop.
  rows.sort((a, b) => (a.soldDate === b.soldDate
    ? Number(a.metadata.rawSNo || 0) - Number(b.metadata.rawSNo || 0)
    : a.soldDate < b.soldDate ? -1 : 1))
  rows.forEach((row, i) => { row.transactionNumber = `SCRAP-2026-${String(i + 1).padStart(4, '0')}` })

  return { rows, failures }
}

// ── Reporting ────────────────────────────────────────────────────────────────────────────────────
const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function report(rows: ParsedRow[], failures: Failure[]) {
  const total = rows.reduce((s, r) => s + r.calculatedTotal, 0)
  const dates = rows.map((r) => r.soldDate).sort()
  const md = rows.filter((r) => r.paymentHandoverToName === MD_CASH_HANDOVER)
  const mdTotal = md.reduce((s, r) => s + r.amountReceived, 0)

  console.log(`\nPARSED ${rows.length} rows, ${failures.length} failure(s)`)
  for (const f of failures.slice(0, 25)) console.log(`   row ${f.sheetRow}: ${f.reason}`)
  console.log(`GRAND TOTAL      Rs ${money(total)}`)
  console.log(`DATE RANGE       ${dates[0]} .. ${dates[dates.length - 1]}  (${new Set(dates).size} distinct days)`)
  console.log(`TXN NUMBERS      ${rows[0]?.transactionNumber} .. ${rows[rows.length - 1]?.transactionNumber}`)

  const by = <T extends string>(key: (r: ParsedRow) => T) => {
    const m = new Map<T, { n: number; amt: number }>()
    for (const r of rows) {
      const k = key(r)
      const cur = m.get(k) || { n: 0, amt: 0 }
      cur.n++; cur.amt += r.calculatedTotal
      m.set(k, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].amt - a[1].amt)
  }

  console.log('\nBY COMPANY (group_name — this is what the MD split keys on)')
  for (const [g, v] of by((r) => r.groupName)) console.log(`   ${g.padEnd(12)} ${String(v.n).padStart(4)} rows   Rs ${money(v.amt).padStart(14)}`)
  console.log('\nBY SCRAP TYPE')
  for (const [t, v] of by((r) => r.scrapTypeName)) console.log(`   ${t.padEnd(16)} ${String(v.n).padStart(4)} rows   Rs ${money(v.amt).padStart(14)}`)
  console.log('\nBY PAYMENT MODE')
  for (const [p, v] of by((r) => r.paymentModeName)) console.log(`   ${p.padEnd(10)} ${String(v.n).padStart(4)} rows   Rs ${money(v.amt).padStart(14)}`)

  console.log(`\nMD CASH (payment_handover_to_name = "${MD_CASH_HANDOVER}")`)
  console.log(`   ${md.length} rows   Rs ${money(mdTotal)}   (${(100 * mdTotal / total).toFixed(1)}% of the register)`)
  // ScrapDistributionView only surfaces soldDate >= this unless a row is explicitly flagged.
  const CUTOFF = '2026-07-01'
  const after = md.filter((r) => r.soldDate >= CUTOFF)
  const before = md.filter((r) => r.soldDate < CUTOFF)
  console.log(`   on/after ${CUTOFF}: ${after.length} rows Rs ${money(after.reduce((s, r) => s + r.amountReceived, 0))}  <- visible on the Distribution tab`)
  console.log(`   before   ${CUTOFF}: ${before.length} rows Rs ${money(before.reduce((s, r) => s + r.amountReceived, 0))}  <- hidden there until flagged`)

  console.log('\nHANDOVER NAMES')
  for (const [h, v] of by((r) => r.paymentHandoverToName).slice(0, 25)) console.log(`   ${h.padEnd(30)} ${String(v.n).padStart(4)}`)
}

// ── DB ───────────────────────────────────────────────────────────────────────────────────────────
const COLUMNS = [
  'transaction_number', 'timestamp', 'group_name', 'location_name', 'department_name',
  'scrap_type_name', 'unit', 'description', 'weight_qty', 'rate_per_unit', 'calculated_total',
  'amount_received', 'outstanding_amount', 'sold_by_name', 'sold_to', 'sold_date',
  'payment_mode_name', 'payment_handover_to_name', 'remarks', 'status',
  'is_distributed', 'sent_to_accounts', 'metadata',
] as const

async function main() {
  console.log(`\nSOURCE  ${FILE}`)
  console.log(`MODE    ${BACKUP_ONLY ? 'BACKUP ONLY' : APPLY ? 'APPLY (destructive)' : 'DRY RUN (no writes)'}`)

  const { rows, failures } = parseWorkbook(FILE)
  if (!BACKUP_ONLY) report(rows, failures)

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })

  try {
    const existing = await sql<Record<string, unknown>[]>`SELECT * FROM scrap_transactions ORDER BY transaction_number`
    console.log(`\nLIVE TABLE currently holds ${existing.length} row(s)`)

    if (!APPLY && !BACKUP_ONLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to replace the table.')
      return
    }

    // Back up BEFORE touching anything. The insert refuses to start without a readable dump.
    const dir = join(process.cwd(), 'scripts', 'backups')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = join(dir, `scrap_transactions_${stamp}.json`)
    writeFileSync(backupPath, JSON.stringify(existing, null, 2), 'utf8')
    const verifyBackup = JSON.parse(readFileSync(backupPath, 'utf8')) as unknown[]
    if (verifyBackup.length !== existing.length) throw new Error('backup did not round-trip — aborting')
    console.log(`BACKUP  ${verifyBackup.length} row(s) -> ${backupPath}`)

    if (BACKUP_ONLY) { console.log('\n--backup-only: stopping before any write.'); return }
    if (failures.length) throw new Error(`refusing to apply with ${failures.length} unparsed row(s)`)

    // Delete + insert in ONE transaction: a mid-flight failure leaves the old data intact.
    await sql.begin(async (tx) => {
      const deleted = await tx`DELETE FROM scrap_transactions RETURNING 1`
      console.log(`DELETE  ${deleted.length} row(s)`)
      const payload = rows.map((r) => ({
        transaction_number: r.transactionNumber,
        timestamp: r.soldDate,
        group_name: r.groupName,
        location_name: r.locationName,
        department_name: r.departmentName,
        scrap_type_name: r.scrapTypeName,
        unit: r.unit,
        description: r.description,
        weight_qty: r.weightQty,
        rate_per_unit: r.ratePerUnit,
        calculated_total: r.calculatedTotal,
        amount_received: r.amountReceived,
        outstanding_amount: 0,
        sold_by_name: 'Imported — overall scrap.xlsx',
        sold_to: r.soldTo,
        sold_date: r.soldDate,
        payment_mode_name: r.paymentModeName,
        payment_handover_to_name: r.paymentHandoverToName,
        remarks: r.remarks,
        status: 'COMPLETED',
        is_distributed: false,
        sent_to_accounts: false,
        metadata: { ...r.metadata, importedAt: new Date().toISOString() },
      }))
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100)
        await tx`INSERT INTO scrap_transactions ${tx(chunk, ...COLUMNS)}`
      }
      console.log(`INSERT  ${payload.length} row(s)`)
    })

    const [k] = await sql<{ n: number; tot: string; recv: string; out: string }[]>`
      SELECT COUNT(*)::int n, SUM(calculated_total)::text tot, SUM(amount_received)::text recv,
             SUM(outstanding_amount)::text out FROM scrap_transactions`
    console.log(`\nAFTER   ${k.n} rows · total Rs ${money(Number(k.tot))} · received Rs ${money(Number(k.recv))} · outstanding Rs ${money(Number(k.out))}`)
    console.log(`\nRollback if needed:\n  npx tsx scripts/restore-scrap-backup.ts --file "${backupPath}"`)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('\nIMPORT FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
