/**
 * Syncs the Finance Payouts ledger from the source workbook (default: "AM FINANCE SHEET.xlsx",
 * sheet "FINANCE DATA").
 *
 * SCOPE: KIA only. The workbook is cross-brand (AM HYUNDAI / PLATINUM HYUNDAI / AM TATA / AM KIA /
 * AM MG); this ledger is KIA-only for now, so only MAIN_DEALER === 'AM KIA' rows are synced. The
 * rest are ignored, not silently mangled.
 *
 * UPSERT, not insert-only: a row already in the ledger is UPDATED from the sheet, new rows are
 * inserted. The sheet is the source of truth while the team still works in Excel.
 *   ⚠️ Once the finance team edits payouts in the app, re-running this OVERWRITES their edits with
 *   the sheet's values, and (being a bulk sync, not a user action) it writes NO audit rows. Retire
 *   this import at that point, or teach it to skip app-edited rows.
 *
 * Rows are matched on CUSTOMER|YYYY-MM-DD|REGISTRATION|MODEL, where the ledger side is DERIVED IN
 * SQL from each row's own stored columns rather than read back from a stored metadata string. That
 * is deliberate: the stored key was built from the raw DELIVERY_DATE cell, the workbook has already
 * changed date formats once (DD/MM/YYYY strings → Excel serials), and matching on it would have
 * re-inserted all 266 existing rows as duplicates. Deriving the key means the match survives any
 * future format change, and the dry run reports the same counts the commit will actually do.
 *
 * FORMAT NOTES (this workbook vs the earlier extract) — all four verified against the data:
 *   • dates are Excel SERIALS (46023 = 2026-01-01), not "01/01/2026" strings;
 *   • DEALER_PAYOUT_PERCENT is a raw FRACTION (0.005 = 0.5%), not "0.5%";
 *   • LOAN_AMOUNT / PAYOUT_AMOUNT are numbers, not strings;
 *   • DSE_PAYOUT_STATUS / DEALER_PAYOUT_STATUS are still misnamed — they hold AMOUNTS.
 *
 * The workbook's LOGIN PASSWORD sheet is NEVER read. See the report at the end of the run.
 *
 *   node scripts/import-kia-finance-payouts.cjs                     # dry run — report only
 *   node scripts/import-kia-finance-payouts.cjs commit              # write
 *   node scripts/import-kia-finance-payouts.cjs commit "path.xlsx"  # explicit file
 */
require('dotenv').config()
const path = require('path')
const XLSX = require('xlsx')
const postgres = require('postgres')

const COMMIT = process.argv.includes('commit')
const FILE = process.argv.find((a) => a.toLowerCase().endsWith('.xlsx'))
  || 'C:/Users/sahil/Downloads/AM FINANCE SHEET.xlsx'
const SHEET = 'FINANCE DATA'

// LOCATION → the app's canonical KIA dealer codes (lib/kia/dealer-branch.ts).
const DEALER_BY_LOCATION = { 'KIA JAMMU': 'JK402', 'KIA UDHAMPUR': 'JK501' }
const PAYOUT_STATUS = { 'IN HOUSE': 'in_house', 'OUT HOUSE': 'out_house', CASH: 'cash', STAFF: 'staff' }
// 'RECEVIED' is the sheet's own typo — map it rather than "fix" the source.
const RECEIPT_STATUS = { PENDING: 'pending', 'NO PAYOUT': 'no_payout', RECEVIED: 'received', RECEIVED: 'received' }

const text = (v) => { const s = String(v ?? '').trim(); return s || null }

/**
 * Handles BOTH shapes this workbook has used: an Excel serial (46023) and a DD/MM/YYYY string.
 * Never let JS parse "01/02/2026" itself — it reads that as Jan 2nd (US order), not Feb 1st.
 */
function parseDate(v) {
  if (v === null || v === undefined || v === '') return null
  // Excel serial: days since 1899-12-30. 25569 = the 1970-01-01 offset.
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 1 || v > 100000) return null // out of any sane range — treat as junk, not 1899
    return new Date(Math.round((v - 25569) * 86400 * 1000))
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const [, d, mo, y] = m
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
    return Number.isNaN(dt.getTime()) ? null : dt
  }
  const dt = new Date(s)
  return Number.isNaN(dt.getTime()) ? null : dt
}

const isoDay = (v) => { const d = parseDate(v); return d ? d.toISOString().slice(0, 10) : '' }

/** "4,000" / 4000 → 4000 ; blank → null ; a word (some legacy amount cells say 'RECEIVED') → null. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').replace(/[,%₹\s]/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Payout percentage. Excel holds a percent-formatted cell as a FRACTION (0.5% is stored 0.005), so
 * a raw read understates it 100×. Verified against the data: sheet% × 100 === payout/loan × 100 on
 * every sampled row, and no value exceeds 1 — so a number ≤ 1 is always a fraction here.
 * A "0.5%" STRING (the older extract) is already in percent units and must not be scaled again.
 */
function percent(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? (v <= 1 ? v * 100 : v) : null
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s.replace(/[%\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

const yesNo = (v) => { const s = String(v ?? '').trim().toLowerCase(); return s === 'yes' ? true : s === 'no' ? false : null }

const naturalKey = (r) => [
  String(r.CUSTOMER_NAME ?? '').trim().toUpperCase(),
  isoDay(r.DELIVERY_DATE),
  String(r['vehicle Registration number to sale'] ?? '').trim().toUpperCase(),
  String(r.MODEL ?? '').trim().toUpperCase(),
].join('|')

function mapRow(r, skippedLoc) {
  const loc = String(r.LOCATION ?? '').trim()
  const dealer = DEALER_BY_LOCATION[loc] || null
  if (!dealer) skippedLoc.add(loc || '(blank)')
  return {
    brand: 'kia',
    source: 'import',
    delivery_date: parseDate(r.DELIVERY_DATE),
    customer_name: text(r.CUSTOMER_NAME),
    customer_phone: text(r.MOBILE_NO),
    model: text(r.MODEL),
    sales_executive: text(r.SALES_EXECUTIVE),
    dealer_code: dealer,
    tl_name: text(r.TL),
    hyp: text(r.HYP),
    bank_branch: text(r.BRANCH),
    loan_amount: num(r.LOAN_AMOUNT),
    pan_number: text(r.PAN_NUMBER),
    vehicle_registration_no: text(r['vehicle Registration number to sale']),
    payout_status: PAYOUT_STATUS[String(r.PAYOUT_STATUS).trim().toUpperCase()] || null,
    reason_if_outhouse: text(r.REASON_IF_OUTHOUSE),
    dealer_payout_percent: percent(r.DEALER_PAYOUT_PERCENT),
    dealer_payout_amount: num(r.PAYOUT_AMOUNT),
    payout_receipt_status: RECEIPT_STATUS[String(r.STATUS).trim().toUpperCase()] || null,
    // Named *_STATUS but overwhelmingly AMOUNTS (a few say 'RECEIVED'): keep the number where it
    // parses, the raw text otherwise.
    dse_payout_amount: num(r.DSE_PAYOUT_STATUS),
    dse_payout_status: num(r.DSE_PAYOUT_STATUS) === null ? text(r.DSE_PAYOUT_STATUS) : null,
    dealer_payout_status: num(r.DEALER_PAYOUT_STATUS) === null ? text(r.DEALER_PAYOUT_STATUS) : null,
    payment_received_date: parseDate(r.PAYMENT_RECEIVED_DATE),
    amount_received: num(r.AMOUNT_RECEIVED),
    invoice_number: text(r.INVOICE_NUMBER),
    bank_visit_scheduled: Boolean(parseDate(r.BANK_VISIT_SCHEDULED)),
    date_of_bank_visit: parseDate(r.DATE_OF_BANK_VISIT) || parseDate(r.BANK_VISIT_SCHEDULED),
    visited_by: text(r.VISITED_BY),
    banker_remarks: text(r.BANKER_REMARKS),
    hyp_as_per_rc: text(r.HYP_AS_PER_RC),
    login_user: text(r.LOGIN_USER),
    bank_interest_rate: num(r['BANK INT RATE']),
    bank_login: yesNo(r['BANK LOGIN']),
    bank_in_proforma: text(r['BANK IN PROFORMA']),
    metadata: { naturalKey: naturalKey(r), importSource: path.basename(FILE), importedAt: new Date().toISOString() },
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    const wb = XLSX.readFile(FILE)
    if (!wb.SheetNames.includes(SHEET)) throw new Error(`Sheet "${SHEET}" not found. Sheets: ${wb.SheetNames.join(', ')}`)
    const all = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { defval: '' })
    const kia = all.filter((r) => String(r.MAIN_DEALER).trim() === 'AM KIA')

    // Derive each ledger row's key from its own columns — same recipe as naturalKey() below.
    // `AT TIME ZONE 'UTC'` is load-bearing: delivery_date is timestamptz stored at UTC midnight, and
    // to_char() on a timestamptz renders in the SESSION timezone. Without the cast, a client
    // connecting from a negative-offset zone reads back the PREVIOUS day and matches nothing.
    const existing = await sql`
      SELECT id,
        upper(trim(coalesce(customer_name, ''))) || '|' ||
        coalesce(to_char(delivery_date AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '') || '|' ||
        upper(trim(coalesce(vehicle_registration_no, ''))) || '|' ||
        upper(trim(coalesce(model, ''))) AS k
      FROM kia_finance_payouts WHERE source = 'import'`
    const idByKey = new Map(existing.map((e) => [e.k, e.id]))

    const skippedLoc = new Set()
    const rows = kia.map((r) => ({ key: naturalKey(r), values: mapRow(r, skippedLoc) }))
    const toUpdate = rows.filter((r) => idByKey.has(r.key))
    const toInsert = rows.filter((r) => !idByKey.has(r.key))

    console.log('=== KIA Finance Payouts sync ===')
    console.log(`  file            : ${path.basename(FILE)}  ·  sheet "${SHEET}"`)
    console.log(`  rows in sheet   : ${all.length}`)
    console.log(`  AM KIA rows     : ${kia.length}   (other brands ignored — this ledger is KIA-only)`)
    console.log(`  already in ledger (will UPDATE): ${toUpdate.length}`)
    console.log(`  new             (will INSERT)  : ${toInsert.length}`)
    // Rows the previous import created that this sheet no longer has. Left ALONE — deleting finance
    // records because a row moved or was renamed upstream is not a call this script gets to make.
    const sheetKeys = new Set(rows.map((r) => r.key))
    const orphans = existing.filter((e) => !sheetKeys.has(e.k))
    if (orphans.length) console.log(`  ! in ledger but NOT in this sheet: ${orphans.length} (left untouched — review manually)`)
    const byDealer = rows.reduce((m, r) => ((m[r.values.dealer_code || '(unmapped)'] = (m[r.values.dealer_code || '(unmapped)'] || 0) + 1), m), {})
    console.log(`  by dealer       : ${Object.entries(byDealer).map(([k, n]) => `${k}=${n}`).join(', ')}`)
    if (skippedLoc.size) console.log(`  ! unmapped LOCATION -> dealer_code NULL: ${[...skippedLoc].join(', ')}`)
    const noDate = rows.filter((r) => !r.values.delivery_date).length
    console.log(`  rows with no parseable DELIVERY_DATE: ${noDate}${noDate ? '  ← check the date format' : ''}`)
    const pct = rows.map((r) => r.values.dealer_payout_percent).filter((v) => v !== null && v > 0)
    console.log(`  dealer_payout_percent range: ${Math.min(...pct)}% – ${Math.max(...pct)}%  (fractions scaled ×100)`)

    // The sheet carries the payout BOTH as a % and as an amount, and they don't always agree. Report
    // the disagreements — do NOT "fix" them. Which of the two columns is right is a finance call, and
    // silently rewriting either one would launder a data-entry error into an authoritative figure.
    const off = rows
      .map((r) => r.values)
      .filter((v) => v.loan_amount > 0 && v.dealer_payout_amount > 0 && v.dealer_payout_percent > 0.001)
      .map((v) => ({ ...v, implied: (v.dealer_payout_amount / v.loan_amount) * 100 }))
      .filter((v) => Math.abs(v.dealer_payout_percent - v.implied) >= 0.01)
    if (off.length) {
      console.log(`  ! ${off.length} row(s) where the sheet's % disagrees with its own amount÷loan (imported as-is):`)
      for (const v of off) {
        console.log(`      ${v.customer_name}: sheet ${v.dealer_payout_percent}% vs implied ${v.implied.toFixed(4)}%`)
      }
    }
    console.log('')

    if (!COMMIT) {
      console.log('DRY RUN — nothing written. Re-run with `commit` to sync.')
      process.exit(0)
    }

    let inserted = 0
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100).map((r) => r.values)
      const res = await sql`INSERT INTO kia_finance_payouts ${sql(chunk)} RETURNING id`
      inserted += res.length
    }

    let updated = 0
    for (const r of toUpdate) {
      // updated_at is refreshed; created_by/created_at are left as they were.
      const res = await sql`
        UPDATE kia_finance_payouts SET ${sql({ ...r.values, updated_at: new Date() })}
        WHERE id = ${idByKey.get(r.key)} RETURNING id`
      updated += res.length
    }

    const [after] = await sql`
      SELECT count(*)::text AS total,
             count(*) FILTER (WHERE source = 'import')::text AS imported,
             count(*) FILTER (WHERE delivery_date IS NULL)::text AS no_date
      FROM kia_finance_payouts`
    console.log(`SYNCED — inserted ${inserted}, updated ${updated}.`)
    console.log(`  ledger total: ${after.total}  (source='import': ${after.imported}, missing delivery_date: ${after.no_date})`)
    console.log('')
    console.log('NOTE: the workbook\'s "LOGIN PASSWORD" sheet was not read and is not imported.')
    process.exit(0)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => { console.error('Sync failed:', e); process.exit(1) })
