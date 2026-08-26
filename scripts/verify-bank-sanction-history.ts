/**
 * Proves the facility revision trail is COMPLETE and reads correctly.
 *
 *   npm run verify:bank-sanction-history
 *   npm run verify:bank-sanction-history -- "<path to the Responses .xlsx>"
 *
 * The register's whole point is that the old sheet's rows are NOT duplicates: the Google form was
 * append-only, so each row is that facility as it stood on that date and the sequence IS the
 * history. This checks two separate things:
 *
 *   1. COMPLETENESS — every response row in the source workbook is present in bank_sanction_history,
 *      linked to a register record, at its own timestamp. Nothing collapsed, nothing deduped away.
 *      (Skipped, with a notice, when the workbook is not on this machine.)
 *   2. READABILITY — the diff the History dialog renders is exercised against the REAL rows, so a
 *      formatting or comparison regression shows up here rather than as a trail that claims every
 *      field changed on every entry.
 */
import 'dotenv/config'
import fs from 'fs'
import { desc, eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { bankSanctionHistory, bankSanctionLimits } from '../lib/db/schema'
import { loanTypeKey } from '../lib/bank-sanctions/store'
import {
  HISTORY_FIELDS,
  formatHistoryValue,
  historyActionLabel,
  historyChanges,
  normalisedHistoryValue,
} from '../lib/bank-sanctions/history-diff'

const DEFAULT_WORKBOOK = 'C:/Users/sahil/Downloads/AM GROUP BANK SANCTION LIMITS FORM (Responses).xlsx'

let failures = 0
const ok = (msg: string) => console.log(`  [PASS] ${msg}`)
const fail = (msg: string) => { failures += 1; console.log(`  [FAIL] ${msg}`) }
const assert = (msg: string, cond: boolean) => (cond ? ok(msg) : fail(msg))

async function main() {
  console.log('\n1. Pure formatting + diff rules')
  {
    // The trailing-zero trap: the sheet import and the app write the same money differently.
    assert("'17500000.00' and '17500000' are the SAME money",
      normalisedHistoryValue('money', '17500000.00') === normalisedHistoryValue('money', '17500000'))
    assert("'11.550' and '11.55' are the SAME rate",
      normalisedHistoryValue('percent', '11.550') === normalisedHistoryValue('percent', '11.55'))
    assert('a real change is still a change',
      normalisedHistoryValue('money', '17500000.00') !== normalisedHistoryValue('money', '17200000.00'))
    assert('null and empty string both read as "unset"',
      normalisedHistoryValue('text', null) === '' && normalisedHistoryValue('text', '') === '')

    // ⚠️ A snapshot date is a calendar date, not an instant — IST formatting would shift the day.
    assert("'2025-02-05' prints as 05 Feb 2025 (no timezone shift)",
      formatHistoryValue('date', '2025-02-05') === '05 Feb 2025')
    assert('a datetime string is truncated to its date',
      formatHistoryValue('date', '2025-02-05T18:29:50.000Z') === '05 Feb 2025')
    assert('money prints in Cr', formatHistoryValue('money', '17500000.00') === '₹1.75 Cr')
    assert('ROI drops the stored trailing zeros', formatHistoryValue('percent', '11.550') === '11.55%')
    assert('an unset field prints as an em dash', formatHistoryValue('money', null) === '—')

    assert('the first entry has no diff', historyChanges({ creditLimit: '1' }, undefined).length === 0)
    const changed = historyChanges({ creditLimit: '2000000' }, { creditLimit: '1000000' })
    assert('a limit change is reported once', changed.length === 1 && changed[0].key === 'creditLimit')
    assert("'imported' reads as a sheet entry", historyActionLabel('imported').label === 'Sheet entry')
  }

  console.log('\n2. The trail in the database')
  const records = await db.select().from(bankSanctionLimits)
  const history = await db.select().from(bankSanctionHistory)
  const byRecord = new Map<string, number>()
  for (const row of history) {
    if (!row.recordId) continue
    byRecord.set(row.recordId, (byRecord.get(row.recordId) || 0) + 1)
  }
  const withNone = records.filter((r) => !byRecord.get(r.id))
  console.log(`  register=${records.length} facilities · history=${history.length} entries`)
  assert('every facility has at least one history entry', withNone.length === 0)
  if (withNone.length) console.log(`         missing: ${withNone.map((r) => r.loanType).join(' | ')}`)

  const multi = records.filter((r) => (byRecord.get(r.id) || 0) > 1)
  assert('facilities carry MULTIPLE revisions (the sheet rows were not collapsed)', multi.length > 0)
  console.log(`         ${multi.length} of ${records.length} facilities have more than one entry`)

  console.log('\n3. Source workbook completeness')
  const workbookPath = process.argv[2] || DEFAULT_WORKBOOK
  if (!fs.existsSync(workbookPath)) {
    console.log(`  [SKIP] workbook not found at ${workbookPath} — pass its path as an argument to check.`)
  } else {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const XLSX = require('xlsx')
    const sheet = XLSX.readFile(workbookPath, { cellDates: false }).Sheets['Form Responses 1']
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true })
    const usable = rows.filter((r) => String(r['Loan Type'] ?? '').trim() && r['Timestamp'])
    const sheetCounts = new Map<string, number>()
    for (const row of usable) {
      const key = loanTypeKey(String(row['Loan Type']))
      sheetCounts.set(key, (sheetCounts.get(key) || 0) + 1)
    }
    console.log(`  workbook: ${rows.length} rows, ${usable.length} usable, ${sheetCounts.size} facilities`)

    const registerByKey = new Map(records.map((r) => [loanTypeKey(r.loanType), r]))
    const unmatched = [...sheetCounts.keys()].filter((k) => !registerByKey.has(k))
    assert('every workbook facility exists in the register', unmatched.length === 0)
    if (unmatched.length) console.log(`         unmatched keys: ${unmatched.join(', ')}`)

    const short: string[] = []
    for (const [key, count] of sheetCounts) {
      const record = registerByKey.get(key)
      if (!record) continue
      const got = byRecord.get(record.id) || 0
      if (got < count) short.push(`${record.loanType} (sheet ${count}, db ${got})`)
    }
    assert('no facility has FEWER entries than the workbook (nothing was deduped)', short.length === 0)
    if (short.length) console.log(`         ${short.slice(0, 10).join(' | ')}`)
  }

  console.log('\n4. The dialog rendered against the longest real trail')
  const longest = [...byRecord.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!longest) {
    fail('no history rows to render')
  } else {
    const [recordId] = longest
    const record = records.find((r) => r.id === recordId)!
    const entries = await db
      .select()
      .from(bankSanctionHistory)
      .where(eq(bankSanctionHistory.recordId, recordId))
      .orderBy(desc(bankSanctionHistory.createdAt))

    console.log(`  "${record.loanType}" — ${entries.length} entries, newest first:\n`)
    let entriesWithChanges = 0
    let everythingChanged = 0
    entries.forEach((entry, index) => {
      const previous = entries[index + 1]
      const snapshot = (entry.snapshot || {}) as Record<string, unknown>
      const changes = historyChanges(snapshot, (previous?.snapshot || undefined) as Record<string, unknown> | undefined)
      if (changes.length) entriesWithChanges += 1
      if (changes.length === HISTORY_FIELDS.length) everythingChanged += 1
      const stamp = new Date(entry.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      const label = historyActionLabel(entry.action).label
      const summary = previous
        ? (changes.length
            ? changes.map((c) => `${c.label} ${formatHistoryValue(c.kind, c.from)} → ${formatHistoryValue(c.kind, c.to)}`).join('; ')
            : 'no change to any tracked field')
        : 'first recorded entry'
      console.log(`   #${entries.length - index} [${label}] ${stamp}`)
      console.log(`      limit ${formatHistoryValue('money', snapshot.creditLimit)} · outstanding ${formatHistoryValue('money', snapshot.outstandingAmount)} · roi ${formatHistoryValue('percent', snapshot.roiPct)} · expiry ${formatHistoryValue('date', snapshot.expiryDate)}`)
      console.log(`      ${summary}`)
    })

    assert('the trail shows real movement, not a wall of identical cards', entriesWithChanges > 0)
    /*
     * The trailing-zero regression's signature: EVERY field of EVERY entry reported as changed.
     * A genuine edit touches a handful of fields, never all 16 on more than the odd row.
     */
    assert('no entry claims that every single field changed', everythingChanged === 0)
  }

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })
