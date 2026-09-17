/**
 * ONE-TIME import of the retired Google Sheet (VEHICLE MASTER tab) into AM Tata · H Promise.
 *
 *   npx tsx --tsconfig ./tsconfig.verify.json scripts/h-promise-import.ts --file "<path to .xlsx>"            (dry run)
 *   … --apply                 insert the vehicles (and the name lists they use), then copy the Drive files
 *   … --apply --skip-files    vehicles only
 *   … --files-only            copy (or retry) the Drive files for vehicles already imported
 *   … --probe 3               in a dry run, test-download 3 Drive files (nothing is stored)
 *   … --report <path>         where the JSON report goes (default: the OS temp folder — it lists
 *                             registration numbers, so it is kept out of the repository)
 *
 * ⚠️ DML only, on the session port 5432 (never the pooler). Idempotent: a vehicle is keyed by
 *    (import_batch, import_row) and a copied file by (vehicle, slot, Drive link), so a second run adds nothing.
 * ⚠️ Stock numbers are assigned in purchase-date order (HP-00001 = the first car bought) and the sequence is
 *    moved past them.
 * ⚠️ Only the VEHICLE MASTER tab is read. The workbook's "login id" tab holds passwords and is never opened.
 * ⚠️ Phone numbers never reach the console or the report unmasked.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import ExcelJS from 'exceljs'
import postgres from 'postgres'
import { FILE_KIND_POLICY, NOT_TAKEN, type FileKind } from '../lib/h-promise/constants'
import { computeEconomics, DEFAULT_ECONOMICS_SETTINGS } from '../lib/h-promise/economics'
import {
  DRIVE_HOSTS,
  SHEET_NAME,
  canonicalNames,
  driveDownloadUrl,
  labelFromValue,
  mapHeaders,
  matchLocation,
  parseSheetRow,
  type ParsedVehicle,
} from '../lib/h-promise/import-core'
import { maskPhone } from '../lib/h-promise/registration'
import { sniffFileType } from '../lib/h-promise/file-sniff'
import { optimizeImage } from '../lib/images/optimize'
import { HPromiseUploadError, removeHPromiseObjects, storeHPromiseFile } from '../lib/h-promise/storage'

const BATCH = 'sheet-2026-09-17'
const ACTOR = 'Google Sheet import'
const DECIDER = 'Google Sheet (imported)'
const SHEET_TODAY = '2026-09-17'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const APPLY = flag('--apply')
const FILES_ONLY = flag('--files-only')
const SKIP_FILES = flag('--skip-files')
const PROBE = Number(option('--probe') ?? 0)
const FILE = option('--file')
const REPORT = option('--report') ?? join(tmpdir(), 'h-promise-import', `report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

function sessionUrl(): string {
  const direct = process.env.DATABASE_DIRECT_URL
  const url = new URL(direct ?? process.env.DATABASE_URL ?? '')
  if (url.port === '6543') url.port = '5432'
  if (url.port === '6543') throw new Error('Refusing to write through the pgbouncer pooler.')
  return url.toString()
}

type Report = Record<string, unknown>

async function readSheet(path: string) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const sheet = workbook.getWorksheet(SHEET_NAME)
  if (!sheet) throw new Error(`The workbook has no "${SHEET_NAME}" tab.`)
  const headerRow = sheet.getRow(1)
  const headers: unknown[] = []
  for (let c = 1; c <= sheet.columnCount; c += 1) headers.push(headerRow.getCell(c).value)
  const mapped = mapHeaders(headers)
  if (mapped.missing.length) throw new Error(`Required columns are missing: ${mapped.missing.join(', ')}`)

  const parsed: ParsedVehicle[] = []
  const bookingData: number[] = []
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r)
    const values: unknown[] = []
    for (let c = 1; c <= sheet.columnCount; c += 1) values.push(row.getCell(c).value)
    if (mapped.bookingColumns.some((index) => values[index] !== null && values[index] !== undefined && String(values[index]).trim() !== '')) {
      bookingData.push(r)
    }
    const vehicle = parseSheetRow(values, mapped.columns, r)
    if (vehicle) parsed.push(vehicle)
  }
  return { parsed, bookingData, columns: Object.keys(mapped.columns).length }
}

async function main() {
  if (!FILE) throw new Error('Pass --file "<path to the .xlsx>".')
  if (FILES_ONLY && SKIP_FILES) throw new Error('--files-only and --skip-files cannot be combined.')
  const sql = postgres(sessionUrl(), { prepare: false, max: 4, ssl: { rejectUnauthorized: false }, connect_timeout: 20 })
  const report: Report = { batch: BATCH, mode: APPLY ? (FILES_ONLY ? 'files-only' : 'apply') : FILES_ONLY ? 'files-only' : 'dry-run', startedAt: new Date().toISOString() }
  try {
    const { parsed, bookingData, columns } = await readSheet(FILE)
    console.log(`Read ${parsed.length} vehicles from "${SHEET_NAME}" (${columns} columns recognised).`)
    report.rowsRead = parsed.length
    if (bookingData.length) report.bookingColumnsWithData = bookingData

    // ── Name lists ────────────────────────────────────────────────────────────────────────────
    const optionRows = await sql<{ kind: string; value: string }[]>`SELECT kind, value FROM public.tata_h_promise_options`
    const optionValues = (kind: string) => optionRows.filter((row) => row.kind === kind).map((row) => row.value)
    const staffNames = canonicalNames([
      ...parsed.map((v) => v.purchasedByRaw).filter(Boolean),
      ...parsed.map((v) => v.sale?.soldByRaw).filter((v): v is string => Boolean(v)),
    ])
    const staffToAdd = [...new Set(staffNames.map.values())].filter((value) => !optionValues('staff').includes(value)).sort()
    const approversSeen = [...new Set(parsed.flatMap((v) => [v.purchaseWhatsappApproverRaw, v.sale?.saleWhatsappApproverRaw]).filter((v): v is string => Boolean(v)))]
    const approversToAdd = approversSeen.filter((value) => !optionValues('approver').includes(value)).sort()
    const locationMap = new Map<string, string>()
    const locationsToAdd: string[] = []
    for (const raw of new Set(parsed.map((v) => v.locationRaw).filter(Boolean))) {
      const match = matchLocation(raw, optionValues('location'))
      if (match) locationMap.set(raw, match)
      else {
        const value = raw.startsWith('TATA ') ? raw : `TATA ${raw}`
        locationMap.set(raw, value)
        locationsToAdd.push(value)
      }
    }
    report.names = {
      staffToAdd,
      staffSpellingsMerged: staffNames.merges,
      approversToAdd,
      locationsMatched: Object.fromEntries(locationMap),
      locationsToAdd,
    }

    // ── Checks ────────────────────────────────────────────────────────────────────────────────
    const errors = parsed.flatMap((v) => v.issues.filter((i) => i.level === 'error').map((i) => ({ row: v.sheetRow, reg: v.regNo, ...i })))
    const warnings = parsed.flatMap((v) => v.issues.filter((i) => i.level === 'warning').map((i) => ({ row: v.sheetRow, reg: v.regNo, ...i })))
    const keys = new Map<string, number[]>()
    for (const v of parsed) keys.set(v.regKey, [...(keys.get(v.regKey) ?? []), v.sheetRow])
    const duplicates = [...keys.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ key, rows }))
    for (const dup of duplicates) {
      for (const row of dup.rows.slice(1)) errors.push({ row, reg: dup.key, level: 'error', field: 'REG NO', message: `the same registration is also on row ${dup.rows[0]}` })
    }
    const existing = await sql<{ reg_no_key: string; stock_no: number; import_batch: string | null; import_row: number | null }[]>`
      SELECT reg_no_key, stock_no, import_batch, import_row FROM public.tata_h_promise_vehicles WHERE deleted_at IS NULL`
    const alreadyImported = new Set(existing.filter((e) => e.import_batch === BATCH).map((e) => e.import_row))
    const liveKeys = new Map(existing.filter((e) => e.import_batch !== BATCH).map((e) => [e.reg_no_key, e.stock_no]))
    for (const v of parsed) {
      const clash = liveKeys.get(v.regKey)
      if (clash !== undefined) errors.push({ row: v.sheetRow, reg: v.regNo, level: 'error', field: 'REG NO', message: `already on the register as HP-${String(clash).padStart(5, '0')} (entered in the app)` })
    }
    report.errors = errors
    report.warnings = warnings
    report.duplicates = duplicates

    // Formula check against the sheet's own results (the sheet counted interest to today for every row).
    const formulaMismatches: unknown[] = []
    for (const v of parsed) {
      if (!v.sale) continue
      const sheetMode = computeEconomics({
        purchasePrice: v.purchasePrice, purchaseGstPct: v.purchaseGstPct, sellingPrice: v.sale.sellingPrice,
        otherCost: v.sale.otherCost, purchaseDate: v.purchaseDate, saleDate: v.sale.saleDate, asOfYmd: SHEET_TODAY,
      }, { ...DEFAULT_ECONOMICS_SETTINGS, interestRunsTo: 'as_of' })
      const pairs: Array<[string, number | null, number | null]> = [
        ['gross profit', sheetMode.grossProfitPaise === null ? null : sheetMode.grossProfitPaise / 100, v.sheetFigures.grossProfit],
        ['gross profit with GST', sheetMode.grossProfitWithGstPaise === null ? null : sheetMode.grossProfitWithGstPaise / 100, v.sheetFigures.grossProfitWithGst],
        ['net profit', sheetMode.netProfitPaise === null ? null : sheetMode.netProfitPaise / 100, v.sheetFigures.netProfit],
      ]
      for (const [what, ours, sheet] of pairs) {
        if (sheet !== null && ours !== sheet) formulaMismatches.push({ row: v.sheetRow, reg: v.regNo, what, app: ours, sheet })
      }
    }
    report.formulaMismatches = formulaMismatches

    // ── What would be imported ────────────────────────────────────────────────────────────────
    const importable = parsed
      .filter((v) => !errors.some((e) => e.row === v.sheetRow))
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate)
        || (a.purchaseTimestamp?.getTime() ?? 0) - (b.purchaseTimestamp?.getTime() ?? 0)
        || a.sheetRow - b.sheetRow)
    const summary = {
      toImport: importable.filter((v) => !alreadyImported.has(v.sheetRow)).length,
      alreadyImported: importable.filter((v) => alreadyImported.has(v.sheetRow)).length,
      blocked: parsed.length - importable.length,
      purchase: countBy(importable, (v) => v.purchase.status),
      sale: countBy(importable, (v) => (v.sale ? v.sale.decision.status : 'not sold')),
      soldTo: countBy(importable.filter((v) => v.sale), (v) => v.sale!.soldTo),
      files: countBy(importable.flatMap((v) => v.files), (f) => f.kind),
      totalFiles: importable.reduce((n, v) => n + v.files.length, 0),
      phonesKeptAsFound: importable.filter((v) => v.sellerPhone && v.sellerPhone.length !== 10).map((v) => ({ row: v.sheetRow, seller: maskPhone(v.sellerPhone) })),
    }
    report.summary = summary

    // Per-month totals, so the MIS can be reconciled against the sheet.
    const months = new Map<string, { purchased: number; purchaseValue: number; sold: number; saleValue: number; netProfitApp: number; netProfitSheetRule: number }>()
    const bump = (key: string) => {
      const m = months.get(key) ?? { purchased: 0, purchaseValue: 0, sold: 0, saleValue: 0, netProfitApp: 0, netProfitSheetRule: 0 }
      months.set(key, m)
      return m
    }
    for (const v of importable) {
      if (v.purchase.status !== 'rejected') {
        const m = bump(v.purchaseDate.slice(0, 7))
        m.purchased += 1
        m.purchaseValue += v.purchasePrice
      }
      if (v.sale && v.sale.decision.status !== 'rejected') {
        const m = bump(v.sale.saleDate.slice(0, 7))
        const base = { purchasePrice: v.purchasePrice, purchaseGstPct: v.purchaseGstPct, sellingPrice: v.sale.sellingPrice, otherCost: v.sale.otherCost, purchaseDate: v.purchaseDate, saleDate: v.sale.saleDate, asOfYmd: SHEET_TODAY }
        m.sold += 1
        m.saleValue += v.sale.sellingPrice
        m.netProfitApp += (computeEconomics(base).netProfitPaise ?? 0) / 100
        m.netProfitSheetRule += (computeEconomics(base, { ...DEFAULT_ECONOMICS_SETTINGS, interestRunsTo: 'as_of' }).netProfitPaise ?? 0) / 100
      }
    }
    report.months = Object.fromEntries([...months.entries()].sort(([a], [b]) => a.localeCompare(b)))

    console.log(`  to import: ${summary.toImport}, already imported: ${summary.alreadyImported}, blocked by errors: ${summary.blocked}`)
    console.log(`  purchases: ${JSON.stringify(summary.purchase)}  sales: ${JSON.stringify(summary.sale)}`)
    console.log(`  Drive files to copy: ${summary.totalFiles}`)
    console.log(`  staff to add: ${staffToAdd.join(', ') || 'none'}${staffNames.merges.length ? `  (merged spellings: ${staffNames.merges.map((m) => `${m.merged.join('/')} → ${m.kept}`).join('; ')})` : ''}`)
    console.log(`  approvers to add: ${approversToAdd.join(', ') || 'none'};  locations to add: ${locationsToAdd.join(', ') || 'none'}`)
    console.log(`  errors: ${errors.length}, warnings: ${warnings.length}, formula mismatches: ${formulaMismatches.length}`)
    for (const e of errors) console.log(`    ERROR row ${e.row} ${e.field}: ${e.message}`)
    for (const w of warnings) console.log(`    warn  row ${w.row} ${w.field}: ${w.message}`)
    for (const m of formulaMismatches as Array<Record<string, unknown>>) console.log(`    formula row ${m.row} ${m.what}: app ${m.app} vs sheet ${m.sheet}`)

    if (!APPLY) {
      if (PROBE > 0) {
        const sample = importable.flatMap((v) => v.files).slice(0, PROBE)
        const probes = []
        for (const file of sample) {
          try {
            const got = await downloadDrive(file.driveId)
            probes.push({ kind: file.kind, ok: true, type: sniffFileType(got.bytes) ?? 'unrecognised', bytes: got.bytes.byteLength })
          } catch (error) {
            probes.push({ kind: file.kind, ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        }
        report.probe = probes
        console.log(`  probe: ${JSON.stringify(probes)}`)
      }
      console.log('\nDry run — nothing was written. Add --apply to import.')
      return
    }

    if (!FILES_ONLY) {
      if (errors.length > 0) throw new Error(`${errors.length} row(s) have errors; fix the sheet or the parser before applying.`)
      await applyVehicles(sql, importable, alreadyImported, staffNames.map, locationMap, { staffToAdd, approversToAdd, locationsToAdd })
      report.vehiclesApplied = true
    }
    if (!SKIP_FILES) {
      report.files = await copyFiles(sql, importable)
    }
  } finally {
    report.finishedAt = new Date().toISOString()
    mkdirSync(dirname(REPORT), { recursive: true })
    writeFileSync(REPORT, JSON.stringify(report, null, 2))
    console.log(`\nReport: ${REPORT}`)
    await sql.end({ timeout: 5 })
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1
  return out
}

async function applyVehicles(
  sql: postgres.Sql,
  importable: ParsedVehicle[],
  alreadyImported: Set<number | null>,
  staff: Map<string, string>,
  locations: Map<string, string>,
  add: { staffToAdd: string[]; approversToAdd: string[]; locationsToAdd: string[] },
) {
  await sql.begin(async (tx) => {
    const lists: Array<[string, string[]]> = [['staff', add.staffToAdd], ['approver', add.approversToAdd], ['location', add.locationsToAdd]]
    for (const [kind, values] of lists) {
      let order = 1000
      for (const value of values) {
        order += 10
        const label = kind === 'location' ? labelFromValue(value.replace(/^TATA\s+/, '')) : labelFromValue(value)
        const inserted = await tx`
          INSERT INTO public.tata_h_promise_options (kind, value, label, sort_order, created_by_name, updated_by_name)
          VALUES (${kind}, ${value}, ${label}, ${order}, ${ACTOR}, ${ACTOR})
          ON CONFLICT (kind, value) DO NOTHING RETURNING id`
        if (inserted.length) {
          await tx`
            INSERT INTO public.tata_h_promise_events (subject, subject_id, action, actor_name, remarks, changes, created_at)
            VALUES ('option', ${inserted[0].id}, 'option_added', ${ACTOR}, 'Found in the Google Sheet', ${tx.json({ kind, value, label })}, now())`
        }
      }
    }
  })
  console.log('Name lists updated.')

  const [{ max }] = await sql<{ max: number | null }[]>`SELECT max(stock_no) AS max FROM public.tata_h_promise_vehicles WHERE import_batch IS DISTINCT FROM ${BATCH}`
  if (max !== null) throw new Error(`The register already has vehicles entered in the app (up to HP-${max}); stock numbers for the import would collide. Stopping.`)

  let inserted = 0
  for (let index = 0; index < importable.length; index += 1) {
    const v = importable[index]
    if (alreadyImported.has(v.sheetRow)) continue
    const stockNo = index + 1
    const sale = v.sale
    const now = new Date()
    const createdAt = v.purchaseTimestamp ?? new Date(`${v.purchaseDate}T06:30:00Z`)
    const hasDocs = Boolean(v.insuranceEndDate || v.hypothecation || v.rtoStatus || v.documentsRemarks
      || v.files.some((f) => FILE_KIND_POLICY[f.kind].group === 'documents'))
    await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO public.tata_h_promise_vehicles (
          stock_no, reg_no, model, colour, manufacturing_year, odometer_km, engine_no, chassis_no, location,
          purchase_date, purchase_price, purchase_gst_pct, expected_profit, purchase_remarks, purchase_financed,
          purchased_by, sales_consultant, seller_phone, purchase_whatsapp_approver,
          purchase_status, purchase_submitted_by_name, purchase_submitted_at,
          purchase_decided_by_name, purchase_decided_at, purchase_decision_reason,
          sale_status, sale_date, selling_price, other_cost, is_demo, sold_to, sale_financed, sold_by,
          buyer_name, buyer_phone, buyer_address, sale_whatsapp_approver,
          sale_submitted_by_name, sale_submitted_at, sale_decided_by_name, sale_decided_at, sale_decision_reason,
          insurance_end_date, hypothecation, rto_status, documents_remarks, documents_updated_by_name, documents_updated_at,
          broker_rc_remarks, broker_rc_updated_by_name, broker_rc_updated_at,
          created_by_name, created_at, updated_by_name, updated_at, import_batch, import_row
        ) VALUES (
          ${stockNo}, ${v.regNo}, ${v.model}, ${v.colour}, ${v.manufacturingYear}, ${v.odometerKm}, ${v.engineNo}, ${v.chassisNo},
          ${locations.get(v.locationRaw) ?? v.locationRaw},
          ${v.purchaseDate}, ${v.purchasePrice.toFixed(2)}, ${String(v.purchaseGstPct)},
          ${v.expectedProfit === null ? null : v.expectedProfit.toFixed(2)}, ${v.purchaseRemarks}, ${v.purchaseFinanced},
          ${staff.get(v.purchasedByRaw) ?? v.purchasedByRaw}, ${v.salesConsultant}, ${v.sellerPhone},
          ${v.purchaseWhatsappApproverRaw ?? NOT_TAKEN},
          ${v.purchase.status}, ${ACTOR}, ${v.purchaseTimestamp},
          ${v.purchase.status === 'pending' ? null : DECIDER},
          ${v.purchase.status === 'pending' ? null : v.purchaseDecidedAt},
          ${v.purchase.reason},
          ${sale ? sale.decision.status : null}, ${sale?.saleDate ?? null},
          ${sale ? sale.sellingPrice.toFixed(2) : null}, ${v.otherCost.toFixed(2)},
          ${sale?.isDemo ?? null}, ${sale?.soldTo ?? null}, ${sale?.saleFinanced ?? null},
          ${sale?.soldByRaw ? staff.get(sale.soldByRaw) ?? sale.soldByRaw : null},
          ${sale?.buyerName ?? null}, ${sale?.buyerPhone ?? null}, ${sale?.buyerAddress ?? null},
          ${sale?.saleWhatsappApproverRaw ?? null},
          ${sale ? ACTOR : null}, ${sale?.submittedAt ?? null},
          ${sale && sale.decision.status !== 'pending' ? DECIDER : null},
          ${sale && sale.decision.status !== 'pending' ? sale.decidedAt : null},
          ${sale?.decision.reason ?? null},
          ${v.insuranceEndDate}, ${v.hypothecation}, ${v.rtoStatus}, ${v.documentsRemarks},
          ${hasDocs ? ACTOR : null}, ${hasDocs ? now : null},
          ${v.brokerRcRemarks}, ${v.brokerRcRemarks ? ACTOR : null}, ${v.brokerRcRemarks ? now : null},
          ${ACTOR}, ${createdAt}, ${ACTOR}, ${now}, ${BATCH}, ${v.sheetRow}
        )
        RETURNING id`
      await tx`
        INSERT INTO public.tata_h_promise_events (vehicle_id, subject, subject_id, stock_no, reg_no, action, to_status, actor_name, remarks, changes, created_at)
        VALUES (${row.id}, 'vehicle', ${row.id}, ${stockNo}, ${v.regNo}, 'imported', ${v.purchase.status}, ${ACTOR},
          ${`Imported from the Google Sheet, row ${v.sheetRow}.`},
          ${tx.json({
            sheetRow: v.sheetRow,
            purchaseApproval: v.purchase.status,
            saleApproval: sale ? sale.decision.status : null,
            filesInSheet: v.files.length,
          })},
          ${now})`
    })
    inserted += 1
  }
  await sql`SELECT setval('public.tata_h_promise_vehicles_stock_no_seq', (SELECT max(stock_no) FROM public.tata_h_promise_vehicles), true)`
  console.log(`Vehicles inserted: ${inserted}. Stock-number sequence moved past HP-${String(importable.length).padStart(5, '0')}.`)
}

// ── Drive files ──────────────────────────────────────────────────────────────────────────────────

const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024

async function downloadDrive(driveId: string): Promise<{ bytes: Buffer; name: string | null }> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(driveDownloadUrl(driveId), { redirect: 'follow', signal: controller.signal })
      const host = new URL(response.url).hostname
      if (!DRIVE_HOSTS.has(host) && !host.endsWith('.googleusercontent.com')) throw new Error(`redirected to an unexpected host (${host})`)
      if (response.status === 429 || response.status >= 500) throw new Error(`Drive answered ${response.status}`)
      if (!response.ok) {
        const error = new Error(response.status === 404 ? 'the file no longer exists on Drive' : `Drive answered ${response.status}`)
        ;(error as Error & { permanent?: boolean }).permanent = true
        throw error
      }
      const type = response.headers.get('content-type') ?? ''
      if (type.includes('text/html')) {
        const error = new Error('Drive returned a web page, not the file (the file is probably not shared)')
        ;(error as Error & { permanent?: boolean }).permanent = true
        throw error
      }
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > MAX_DOWNLOAD_BYTES) throw Object.assign(new Error(`too large (${length} bytes)`), { permanent: true })
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.byteLength === 0) throw new Error('empty download')
      if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw Object.assign(new Error(`too large (${bytes.byteLength} bytes)`), { permanent: true })
      const disposition = response.headers.get('content-disposition') ?? ''
      const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] ?? null
      return { bytes, name: name ? decodeURIComponent(name).slice(0, 120) : null }
    } catch (error) {
      lastError = error
      if ((error as { permanent?: boolean }).permanent) break
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function isHeif(bytes: Buffer): boolean {
  if (bytes.byteLength < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') return false
  return ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'avif'].includes(bytes.toString('ascii', 8, 12))
}

/** Photos from phones: HEIC is converted, and very large images are shrunk before the 10 MB check. */
async function prepare(bytes: Buffer, kind: FileKind): Promise<Buffer> {
  const preset = FILE_KIND_POLICY[kind].preset
  if (isHeif(bytes)) {
    const converted = await optimizeImage(bytes, 'image/heic', { preset })
    if (!converted.optimized) throw new Error('a HEIC photo that could not be converted')
    return converted.buffer
  }
  const type = sniffFileType(bytes)
  if (type && type !== 'application/pdf' && bytes.byteLength > 9 * 1024 * 1024) {
    const smaller = await optimizeImage(bytes, type, { preset })
    return smaller.buffer
  }
  return bytes
}

async function copyFiles(sql: postgres.Sql, importable: ParsedVehicle[]) {
  const vehicles = await sql<{ id: string; import_row: number }[]>`
    SELECT id, import_row FROM public.tata_h_promise_vehicles WHERE import_batch = ${BATCH}`
  const byRow = new Map(vehicles.map((v) => [v.import_row, v.id]))
  const present = await sql<{ vehicle_id: string; kind: string; legacy_url: string | null; current: boolean }[]>`
    SELECT vehicle_id, kind, legacy_url, (attached_at IS NOT NULL AND superseded_at IS NULL) AS current
    FROM public.tata_h_promise_files
    WHERE vehicle_id IN (SELECT id FROM public.tata_h_promise_vehicles WHERE import_batch = ${BATCH})`
  const done = new Set(present.filter((p) => p.legacy_url).map((p) => `${p.vehicle_id}|${p.kind}|${p.legacy_url}`))
  const occupied = new Set(present.filter((p) => p.current).map((p) => `${p.vehicle_id}|${p.kind}`))

  type Job = { vehicleId: string; row: number; reg: string; kind: FileKind; driveId: string; legacyUrl: string }
  const jobs: Job[] = []
  let skipped = 0
  for (const v of importable) {
    const vehicleId = byRow.get(v.sheetRow)
    if (!vehicleId) continue
    for (const file of v.files) {
      const legacyUrl = `https://drive.google.com/open?id=${file.driveId}`
      if (done.has(`${vehicleId}|${file.kind}|${legacyUrl}`)) { skipped += 1; continue }
      if (occupied.has(`${vehicleId}|${file.kind}`)) { skipped += 1; continue }
      jobs.push({ vehicleId, row: v.sheetRow, reg: v.regNo, kind: file.kind, driveId: file.driveId, legacyUrl })
    }
  }
  console.log(`\nCopying ${jobs.length} Drive files (${skipped} already copied)…`)

  const failures: Array<{ row: number; reg: string; kind: string; error: string }> = []
  let copied = 0
  let cursor = 0
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor]
      cursor += 1
      let storedPath: string | null = null
      try {
        const downloaded = await downloadDrive(job.driveId)
        const bytes = await prepare(downloaded.bytes, job.kind)
        const fileId = randomUUID()
        const stored = await storeHPromiseFile({ bytes, kind: job.kind, folder: job.vehicleId, fileId, allowPdf: true })
        storedPath = stored.path
        await sql.begin(async (tx) => {
          await tx`
            INSERT INTO public.tata_h_promise_files
              (id, vehicle_id, kind, storage_path, content_type, size_bytes, sha256, original_name, source, legacy_url,
               uploaded_by_name, uploaded_at, attached_at)
            VALUES (${fileId}, ${job.vehicleId}, ${job.kind}, ${stored.path}, ${stored.contentType}, ${stored.sizeBytes},
              ${stored.sha256}, ${downloaded.name}, 'import', ${job.legacyUrl}, ${ACTOR}, now(), now())`
          if (job.kind === 'payment_ledger') {
            await tx`
              UPDATE public.tata_h_promise_vehicles SET payment_verified_by_name = ${DECIDER}
              WHERE id = ${job.vehicleId} AND payment_verified_by_name IS NULL`
          }
        })
        storedPath = null
        copied += 1
        if (copied % 25 === 0) console.log(`  … ${copied} copied`)
      } catch (error) {
        if (storedPath) await removeHPromiseObjects([storedPath])
        const message = error instanceof HPromiseUploadError || error instanceof Error ? error.message : String(error)
        failures.push({ row: job.row, reg: job.reg, kind: job.kind, error: message })
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  console.log(`Files copied: ${copied}; failed: ${failures.length}; skipped (already there): ${skipped}.`)
  for (const failure of failures.slice(0, 40)) console.log(`  FAILED row ${failure.row} ${failure.kind}: ${failure.error}`)
  return { copied, skipped, failed: failures.length, failures, byKindFailed: countBy(failures, (f) => f.kind) }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
