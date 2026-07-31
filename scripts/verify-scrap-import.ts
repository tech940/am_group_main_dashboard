/**
 * verify:scrap-import — asserts the `overall scrap.xlsx` register landed correctly.
 *
 *   npm run verify:scrap-import
 *
 * Three layers:
 *   1. TABLE   — row count, totals, numbering, payment mode, MD-cash subset, per-company totals.
 *   2. TRAPS   — regression guards for the four ways this import can silently corrupt itself.
 *   3. SPLIT   — runs the REAL calculateScrapDistribution() over the live MD-cash rows and asserts
 *                every company resolves to its intended share config, none falling through to the
 *                50/50 default.
 *
 * Re-runnable and read-only.
 */
import 'dotenv/config'
import postgres from 'postgres'
import { calculateScrapDistribution, getCompanyShareConfig, DEFAULT_COMPANY_SHARE } from '../lib/scrap-erp/distribution'
import type { ScrapTransaction } from '../lib/scrap-erp/types'

const MD_CASH_HANDOVER = 'CASH HANDOVER TO MD'

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const near = (a: number, b: number) => Math.abs(a - b) < 0.01

// Every figure below was reconciled against the source workbook before the load.
// Reconciled against `overall scrap....xlsx` (2026-07-31 re-issue): 272 rows, 28 Mar - 31 Jul.
const EXPECTED_TOTAL = 3514522.58
const EXPECTED_ROWS = 272
const EXPECTED_MD_ROWS = 76
const EXPECTED_MD_TOTAL = 978276.50
const EXPECTED_LAST_DATE = '2026-07-31'
const EXPECTED_COMPANIES: Record<string, { rows: number; amt: number; displayName: string }> = {
  JAM: { rows: 77, amt: 1443605.00, displayName: 'JAMMU AUTOMART' },
  PLATINUM: { rows: 59, amt: 849213.50, displayName: 'PLATINUM AUTO' },
  'SMAM TATA': { rows: 39, amt: 395407.00, displayName: 'SMAM TATA' },
  DIAMOND: { rows: 42, amt: 346719.00, displayName: 'DIAMOND HONDA' },
  'AM KIA': { rows: 19, amt: 225839.08, displayName: 'AM KIA' },
  MG: { rows: 12, amt: 105932.00, displayName: 'AM MG' },
  BAJAJ: { rows: 19, amt: 101427.00, displayName: 'AM BAJAJ' },
  KTM: { rows: 5, amt: 46380.00, displayName: 'AM KTM' },
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const sql = postgres(url, { max: 2, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })

  try {
    console.log('\nTABLE')
    const [k] = await sql<{ n: number; tot: string; recv: string; out: string; lo: string; hi: string; days: number }[]>`
      SELECT COUNT(*)::int n, SUM(calculated_total)::text tot, SUM(amount_received)::text recv,
             SUM(outstanding_amount)::text out, MIN(sold_date)::text lo, MAX(sold_date)::text hi,
             COUNT(DISTINCT sold_date)::int days
      FROM scrap_transactions`
    ok('row count', k.n === EXPECTED_ROWS, `${k.n} (expected ${EXPECTED_ROWS})`)
    ok('sum(calculated_total)', near(Number(k.tot), EXPECTED_TOTAL), `Rs ${money(Number(k.tot))}`)
    ok('sum(amount_received) equals the total', near(Number(k.recv), EXPECTED_TOTAL), `Rs ${money(Number(k.recv))}`)
    ok('sum(outstanding_amount) is zero', near(Number(k.out), 0), `Rs ${money(Number(k.out))}`)
    ok('date range', k.lo === '2026-03-28' && k.hi === EXPECTED_LAST_DATE, `${k.lo} .. ${k.hi} (${k.days} days)`)

    const [t] = await sql<{ n: number; lo: string; hi: string; dupes: number }[]>`
      SELECT COUNT(DISTINCT transaction_number)::int n, MIN(transaction_number) lo, MAX(transaction_number) hi,
             (COUNT(*) - COUNT(DISTINCT transaction_number))::int dupes
      FROM scrap_transactions`
    ok('transaction numbers are unique', t.dupes === 0 && t.n === EXPECTED_ROWS, `${t.n} distinct, ${t.dupes} dupes`)
    ok('transaction numbering is contiguous',
      t.lo === 'SCRAP-2026-0001' && t.hi === `SCRAP-2026-${String(EXPECTED_ROWS).padStart(4, '0')}`, `${t.lo} .. ${t.hi}`)

    const modes = await sql<{ payment_mode_name: string; n: number }[]>`
      SELECT payment_mode_name, COUNT(*)::int n FROM scrap_transactions GROUP BY 1`
    ok('every row is ONLINE (as the register states)',
      modes.length === 1 && modes[0].payment_mode_name === 'ONLINE' && modes[0].n === EXPECTED_ROWS,
      modes.map((m) => `${m.payment_mode_name}=${m.n}`).join(' '))

    const [md] = await sql<{ n: number; amt: string }[]>`
      SELECT COUNT(*)::int n, COALESCE(SUM(amount_received),0)::text amt
      FROM scrap_transactions WHERE payment_handover_to_name = ${MD_CASH_HANDOVER}`
    ok('MD-cash row count', md.n === EXPECTED_MD_ROWS, `${md.n} (expected ${EXPECTED_MD_ROWS})`)
    ok('MD-cash total', near(Number(md.amt), EXPECTED_MD_TOTAL), `Rs ${money(Number(md.amt))}`)

    console.log('\nPER COMPANY (group_name)')
    const groups = await sql<{ group_name: string; n: number; amt: string }[]>`
      SELECT group_name, COUNT(*)::int n, SUM(calculated_total)::text amt
      FROM scrap_transactions GROUP BY 1 ORDER BY 3 DESC`
    ok('no unexpected companies', groups.length === Object.keys(EXPECTED_COMPANIES).length,
      `${groups.length} groups: ${groups.map((g) => g.group_name).join(', ')}`)
    for (const g of groups) {
      const exp = EXPECTED_COMPANIES[g.group_name]
      ok(`${g.group_name.padEnd(10)} ${String(g.n).padStart(3)} rows Rs ${money(Number(g.amt)).padStart(13)}`,
        Boolean(exp) && exp.rows === g.n && near(Number(g.amt), exp.amt),
        exp ? '' : 'not an expected group name')
    }

    console.log('\nTRAPS (regression guards)')
    // TRAP 1 — QTY/TOTAL read through a date parser would land as ~1900-1960 serials, i.e. tiny or
    // absurd numbers. The first row of the register is 1310 kg @ Rs 15 = Rs 19,650.
    const [row1] = await sql<{ w: string; r: string; c: string }[]>`
      SELECT weight_qty::text w, rate_per_unit::text r, calculated_total::text c
      FROM scrap_transactions WHERE transaction_number = 'SCRAP-2026-0001'`
    ok('numbers were not parsed as dates (row 1 = 1310 x 15 = 19650)',
      near(Number(row1.w), 1310) && near(Number(row1.r), 15) && near(Number(row1.c), 19650),
      `qty ${row1.w} rate ${row1.r} total ${row1.c}`)

    // TRAP 2 — the six "30-07-206" rows must exist as 2026-07-30, not be dropped or dated in year 206.
    const [lastDay] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int n FROM scrap_transactions WHERE sold_date = '2026-07-30'`
    ok('the mistyped "30-07-206" rows landed on 2026-07-30', lastDay.n >= 6, `${lastDay.n} rows on 30 Jul`)
    const [badYear] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int n FROM scrap_transactions WHERE sold_date < '2026-01-01' OR sold_date > '2026-12-31'`
    ok('no row escaped into a nonsense year', badYear.n === 0, `${badYear.n} out-of-range`)

    // TRAP 3 — TOTAL VALUE is authoritative. 12 rows have a blank qty/rate but a real total; if the
    // importer had recomputed qty x rate they would now be zero.
    const [recomputed] = await sql<{ n: number; amt: string }[]>`
      SELECT COUNT(*)::int n, COALESCE(SUM(calculated_total),0)::text amt
      FROM scrap_transactions WHERE (weight_qty = 0 OR rate_per_unit = 0) AND calculated_total > 0`
    ok('rows with blank qty/rate kept their stated total', recomputed.n > 0,
      `${recomputed.n} rows worth Rs ${money(Number(recomputed.amt))} would have been zeroed by recomputing`)

    // TRAP 4 — the NOT NULL column Drizzle does not know about.
    const [units] = await sql<{ nulls: number; kinds: string }[]>`
      SELECT COUNT(*) FILTER (WHERE unit IS NULL OR unit = '')::int nulls,
             string_agg(DISTINCT unit, ',') kinds FROM scrap_transactions`
    ok('every row carries a unit', units.nulls === 0, `units present: ${units.kinds}`)

    const [prov] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int n FROM scrap_transactions WHERE metadata->>'importSource' = 'overall-scrap-xlsx'`
    ok('every row is traceable to this import', prov.n === EXPECTED_ROWS, `${prov.n} tagged`)

    console.log('\nMD DISTRIBUTION (the real calculateScrapDistribution over live rows)')
    const mdRows = await sql<{ group_name: string; amount_received: string; transaction_number: string }[]>`
      SELECT group_name, amount_received::text, transaction_number
      FROM scrap_transactions WHERE payment_handover_to_name = ${MD_CASH_HANDOVER}`
    const txns = mdRows.map((r) => ({
      groupName: r.group_name,
      amountReceived: Number(r.amount_received),
      transactionNumber: r.transaction_number,
    })) as unknown as ScrapTransaction[]

    const dist = calculateScrapDistribution(txns)
    ok('distribution total equals the MD-cash total', near(dist.totalRevenue, EXPECTED_MD_TOTAL), `Rs ${money(dist.totalRevenue)}`)
    ok('distribution covers every MD-cash row', dist.totalTransactions === EXPECTED_MD_ROWS, `${dist.totalTransactions} txns`)

    // The substring matcher in getCompanyShareConfig is order-dependent and its first entry's key is
    // the 3-letter 'JAM'. Assert each stored group resolves to the company we intend.
    for (const [groupName, exp] of Object.entries(EXPECTED_COMPANIES)) {
      const resolved = getCompanyShareConfig(groupName)
      ok(`"${groupName}" resolves to ${exp.displayName}`, resolved.displayName === exp.displayName, resolved.displayName)
    }
    // A company on the fallback is indistinguishable from a configured 50/50 by its numbers alone,
    // so compare identity: getCompanyShareConfig returns the DEFAULT object itself when it falls through.
    for (const groupName of Object.keys(EXPECTED_COMPANIES)) {
      const resolved = getCompanyShareConfig(groupName)
      ok(`"${groupName}" has a declared split (not the silent default)`, resolved.shares !== DEFAULT_COMPANY_SHARE,
        Object.entries(resolved.shares).filter(([, v]) => v > 0).map(([kk, v]) => `${kk} ${v}%`).join(' / '))
    }

    console.log('\n  shareholder totals over the MD-cash rows:')
    let sum = 0
    for (const [key, p] of Object.entries(dist.personTotals)) {
      sum += p.amount
      if (p.amount > 0) console.log(`    ${p.name.padEnd(18)} Rs ${money(p.amount).padStart(13)}  (${p.percentage.toFixed(1)}%)  [${key}]`)
    }
    ok('shareholder amounts sum back to the MD-cash total', near(sum, EXPECTED_MD_TOTAL), `Rs ${money(sum)}`)

    console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`} — ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error('\nVERIFY FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
