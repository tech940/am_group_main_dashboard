/**
 * One-time import of the "AM Kia Walk In Register (Responses)" Google Form sheet into kia_walk_in_leads.
 *
 *   npx tsx --tsconfig ./tsconfig.verify.json scripts/import-kia-walk-in-leads.ts            # dry run
 *   npx tsx --tsconfig ./tsconfig.verify.json scripts/import-kia-walk-in-leads.ts --apply    # write
 *   … --file "C:/…/AM Kia Walk In Register (Responses).xlsx"
 *
 * Idempotent: every row is keyed by (import_batch, import_row) — the sheet row number — so a re-run inserts
 * only rows it has not seen (ON CONFLICT DO NOTHING). Nothing is updated or deleted.
 *
 * Columns are matched by HEADER TEXT. MONTH / YEAR / DATE / Booked are formulas over other columns and are
 * derived again here rather than imported. The report prints no name, phone, e-mail or address.
 */
import 'dotenv/config'
import { basename } from 'node:path'
import ExcelJS from 'exceljs'
import postgres from 'postgres'
import {
  WALK_IN_MODELS,
  WALK_IN_SOURCES,
  isValidIndianMobile,
  normalizeMobile,
  remarksMeanBooked,
  tidyText,
  titleCaseName,
} from '../lib/kia/walk-in-leads/constants'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const fileArg = args.indexOf('--file')
const FILE = fileArg >= 0 ? args[fileArg + 1] : 'C:/Users/sahil/Downloads/AM Kia Walk In Register (Responses).xlsx'
const SHEET = 'Form Responses 1'
const BATCH = 'walk-in-sheet-2026-09-17'

const HEADERS = {
  timestamp: 'timestamp',
  name: 'customer name',
  enquiryDate: 'date of enquiry',
  email: 'email',
  mobile: 'mobile no.',
  location: 'location',
  address: 'address',
  model: 'model',
  consultant: 'consultant name',
  testDrive: 'test drive',
  source: 'enquiry source',
  info: 'additional information',
  bookingDate: 'booking date',
  remarks: 'remarks',
  exchange: 'exchange',
  countryCode: 'country code',
  customerType: 'new or existing',
  booked: 'booked',
} as const
type Key = keyof typeof HEADERS

const LOCATION_CODES: Record<string, string> = { JAMMU: 'JK402', UDHAMPUR: 'JK501', BANIHAL: 'JK502' }
const IST_OFFSET_MS = 330 * 60_000

function raw(cell: ExcelJS.Cell): unknown {
  const value = cell.value as unknown
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return (value as { result: unknown }).result
    if ('richText' in value) return (value as { richText: Array<{ text: string }> }).richText.map((p) => p.text).join('')
    if ('text' in value) return (value as { text: unknown }).text
    return null
  }
  return value
}

function ymd(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const text = tidyText(value)
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

function nullable(value: unknown, max: number): string | null {
  const text = tidyText(value)
  if (!text || /^(-+|na|n\/a|nil|none|\.)$/i.test(text)) return null
  return text.slice(0, max)
}

type Lead = {
  importRow: number
  submittedAt: string
  enquiryDate: string
  dealerCode: string
  customerName: string
  countryCode: string
  mobile: string
  email: string | null
  address: string | null
  model: string
  consultantName: string
  testDrive: boolean
  enquirySource: string
  customerType: string | null
  exchange: boolean | null
  exchangeDetails: string | null
  additionalInfo: string | null
  expectedBookingDate: string | null
  remarks: string | null
  booked: boolean
}

async function main() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(FILE)
  const sheet = workbook.getWorksheet(SHEET)
  if (!sheet) throw new Error(`No "${SHEET}" sheet`)

  const columns = new Map<Key, number>()
  sheet.getRow(1).eachCell((cell, col) => {
    const text = tidyText(cell.text).toLowerCase()
    const key = (Object.keys(HEADERS) as Key[]).find((k) => HEADERS[k] === text)
    if (key) columns.set(key, col)
  })
  const missing = (Object.keys(HEADERS) as Key[]).filter((key) => !columns.has(key))
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`)

  const leads: Lead[] = []
  const problems: string[] = []
  const notes = { oddMobiles: 0, invalidEmails: 0, unknownModels: new Map<string, number>(), unknownSources: new Map<string, number>(), exchangeDetails: 0, booked: 0 }
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const get = (key: Key) => raw(row.getCell(columns.get(key)!))
    const cells = (Object.keys(HEADERS) as Key[]).map(get)
    if (cells.every((v) => v === null || v === undefined || tidyText(v) === '')) continue

    const timestamp = get('timestamp')
    const enquiryDate = ymd(get('enquiryDate')) ?? (timestamp instanceof Date ? timestamp.toISOString().slice(0, 10) : null)
    const name = tidyText(get('name')).slice(0, 120)
    const mobile = normalizeMobile(get('mobile'))
    const model = tidyText(get('model')).toUpperCase()
    const consultant = titleCaseName(get('consultant')).slice(0, 80)
    const source = tidyText(get('source')).toUpperCase()
    if (!(timestamp instanceof Date)) problems.push(`row ${r}: no timestamp`)
    if (!enquiryDate) problems.push(`row ${r}: no enquiry date`)
    if (!name) problems.push(`row ${r}: no customer name`)
    if (!consultant) problems.push(`row ${r}: no consultant`)
    if (!model) problems.push(`row ${r}: no model`)
    if (!mobile) notes.oddMobiles++
    else if (!isValidIndianMobile(mobile)) notes.oddMobiles++
    if (!(WALK_IN_MODELS as readonly string[]).includes(model)) notes.unknownModels.set(model, (notes.unknownModels.get(model) ?? 0) + 1)
    if (!(WALK_IN_SOURCES as readonly string[]).includes(source)) notes.unknownSources.set(source, (notes.unknownSources.get(source) ?? 0) + 1)

    // Stray spaces are removed ("name @gmail.com"); anything that is still not an address ("nil", "no") is left empty.
    const emailRaw = nullable(get('email'), 160)?.toLowerCase().replace(/\s+/g, '') ?? null
    const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null
    if (emailRaw && !email) notes.invalidEmails++

    const exchangeText = tidyText(get('exchange'))
    let exchange: boolean | null = null
    let exchangeDetails: string | null = null
    if (/^no\b/i.test(exchangeText)) exchange = false
    else if (/^yes$/i.test(exchangeText)) exchange = true
    else if (exchangeText) {
      exchange = true
      exchangeDetails = exchangeText.replace(/^yes\s*/i, '').replace(/^\((.*)\)$/, '$1').trim().slice(0, 200) || null
      if (exchangeDetails) notes.exchangeDetails++
    }

    const remarks = nullable(get('remarks'), 500)
    const booked = remarksMeanBooked(remarks)
    if (booked) notes.booked++

    const type = tidyText(get('customerType')).toUpperCase()
    const code = tidyText(get('countryCode')).replace(/^\+?/, '+')
    const location = tidyText(get('location')).toUpperCase()
    if (!LOCATION_CODES[location]) problems.push(`row ${r}: unknown location "${location}"`)

    leads.push({
      importRow: r,
      // ⚠️ The sheet's timestamps are IST wall-clock serials; ExcelJS reads a serial as UTC. Without the 5 h 30 m
      // correction the latest entry landed two hours AFTER the file was downloaded.
      submittedAt: timestamp instanceof Date
        ? new Date(timestamp.getTime() - IST_OFFSET_MS).toISOString()
        : new Date(`${enquiryDate}T00:00:00+05:30`).toISOString(),
      enquiryDate: enquiryDate ?? '',
      dealerCode: LOCATION_CODES[location] ?? 'JK402',
      customerName: name,
      countryCode: code === '+' ? '+91' : code,
      mobile: mobile.slice(0, 20),
      email,
      address: nullable(get('address'), 500),
      model,
      consultantName: consultant,
      testDrive: /^yes$/i.test(tidyText(get('testDrive'))),
      enquirySource: source || 'OTHERS',
      customerType: type === 'NEW' || type === 'EXISTING' ? type : null,
      exchange,
      exchangeDetails,
      additionalInfo: nullable(get('info'), 1000),
      expectedBookingDate: ymd(get('bookingDate')),
      remarks,
      booked,
    })
  }

  const byMonth = new Map<string, number>()
  for (const lead of leads) byMonth.set(lead.enquiryDate.slice(0, 7), (byMonth.get(lead.enquiryDate.slice(0, 7)) ?? 0) + 1)
  const dupes = new Map<string, number>()
  for (const lead of leads) dupes.set(`${lead.mobile}|${lead.enquiryDate}`, (dupes.get(`${lead.mobile}|${lead.enquiryDate}`) ?? 0) + 1)
  const consultants = new Set(leads.map((lead) => lead.consultantName))

  console.log(`\nFILE      ${basename(FILE)} · sheet "${SHEET}"`)
  console.log(`MODE      ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'} · batch ${BATCH}`)
  console.log(`ROWS      ${leads.length} leads · ${leads[0]?.enquiryDate} → ${leads.at(-1)?.enquiryDate}`)
  console.log(`BY MONTH  ${[...byMonth.entries()].sort().map(([m, n]) => `${m}:${n}`).join(' ')}`)
  // The sheet's Booked column is a shared formula whose cached results Excel readers mostly cannot see, so the
  // count comes from REMARKS, exactly as the formula computed it.
  console.log(`BOOKED    ${notes.booked} (REMARKS says BOOKED)`)
  console.log(`TEST DRIVE ${leads.filter((l) => l.testDrive).length} · EXCHANGE yes ${leads.filter((l) => l.exchange).length}, no ${leads.filter((l) => l.exchange === false).length}, not asked ${leads.filter((l) => l.exchange === null).length} (${notes.exchangeDetails} with vehicle details)`)
  console.log(`CONSULTANTS ${consultants.size} after tidying names (sheet: 40)`)
  console.log(`NOTES     ${notes.oddMobiles} mobiles are not a valid 10-digit Indian number (kept as found) · ${notes.invalidEmails} e-mail entries that are not addresses (left empty)`)
  console.log(`          same mobile + same day: ${[...dupes.values()].filter((n) => n > 1).length} pairs (kept — each is a sheet entry)`)
  if (notes.unknownModels.size) console.log(`          models outside the form list: ${[...notes.unknownModels.entries()].map(([k, n]) => `${k}×${n}`).join(', ')}`)
  if (notes.unknownSources.size) console.log(`          sources outside the form list: ${[...notes.unknownSources.entries()].map(([k, n]) => `${k}×${n}`).join(', ')}`)
  if (problems.length) {
    console.log(`\n${problems.length} PROBLEM(S) — nothing will be written:`)
    for (const problem of problems.slice(0, 30)) console.log(`  - ${problem}`)
    process.exit(1)
  }

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    const [{ n: already }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM kia_walk_in_leads WHERE import_batch = ${BATCH}`
    const [{ n: total }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM kia_walk_in_leads`
    console.log(`\nDATABASE  ${total} leads now · ${already} already imported from this batch · ${leads.length - already} to add`)
    if (!APPLY) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply.\n')
      return
    }
    let inserted = 0
    await sql.begin(async (tx) => {
      for (let i = 0; i < leads.length; i += 200) {
        const chunk = leads.slice(i, i + 200).map((lead) => ({
          enquiry_date: lead.enquiryDate,
          dealer_code: lead.dealerCode,
          customer_name: lead.customerName,
          country_code: lead.countryCode,
          mobile: lead.mobile,
          email: lead.email,
          address: lead.address,
          model: lead.model,
          consultant_name: lead.consultantName,
          test_drive: lead.testDrive,
          enquiry_source: lead.enquirySource,
          customer_type: lead.customerType,
          exchange: lead.exchange,
          exchange_details: lead.exchangeDetails,
          additional_info: lead.additionalInfo,
          expected_booking_date: lead.expectedBookingDate,
          remarks: lead.remarks,
          booked: lead.booked,
          source: 'import',
          submitted_at: lead.submittedAt,
          created_at: lead.submittedAt,
          updated_at: lead.submittedAt,
          import_batch: BATCH,
          import_row: lead.importRow,
        }))
        const result = await tx`
          INSERT INTO kia_walk_in_leads ${tx(chunk)}
          ON CONFLICT (import_batch, import_row) WHERE import_batch IS NOT NULL DO NOTHING
          RETURNING id`
        inserted += result.length
      }
    })
    const [{ n: after }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM kia_walk_in_leads WHERE import_batch = ${BATCH}`
    console.log(`\nWRITTEN   ${inserted} new rows · ${after} rows now carry batch ${BATCH} (expected ${leads.length})\n`)
    if (after !== leads.length) throw new Error('The imported count does not match the sheet')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('\nIMPORT FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
