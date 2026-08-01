/**
 * verify:be-windows — asserts the Business Excellence TD/MTD/QTD/YTD windows are built correctly.
 *
 *   npm run verify:be-windows
 *
 * Read-only. Two layers:
 *  1. SOURCE assertions — the four modules that build YTD must use the APRIL financial year, not
 *     1 January. This is a regression guard: it fails if anyone reintroduces getCalendarYearStart.
 *  2. MATH assertions — the window arithmetic over a set of dates chosen to hit every edge case.
 *
 * ⚠️ CONTEXT. Two things here look like bugs and are NOT, so they are asserted explicitly and must
 * never be "fixed":
 *   - MTD == QTD whenever the end date falls in the FIRST month of a quarter (Jan/Apr/Jul/Oct).
 *     Same window, so the numbers must match. Reported as a bug on 2026-08-01; it is correct.
 *   - QTD == YTD through the whole of Apr-Jun, because 1 April starts both the quarter and the
 *     financial year. On 1 April, TD/MTD/QTD/YTD all coincide.
 * The financial year runs APRIL-MARCH, so January-March belong to the FY that began the PREVIOUS
 * April — the edge case that silently breaks if someone writes `getFullYear()` with no -1.
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const ROOT = join(__dirname, '..')
const YTD_SOURCES = [
  'lib/hyundai/business-excellence.ts',
  'app/api/brands/hyundai/business-excellence/ro-billing-analysis/route.ts',
  'app/api/brands/kia/business-excellence/ro-billing-analysis/route.ts',
  'app/api/brands/platinum/business-excellence/ro-billing-analysis/route.ts',
]

/** The shipped rule, mirrored: fiscal year starts 1 April; Jan-Mar belong to the previous April. */
const financialYearStart = (y: number, m: number) => (m >= 4 ? y : y - 1)
const quarterStartMonth = (m: number) => Math.floor((m - 1) / 3) * 3 + 1
const pad = (n: number) => String(n).padStart(2, '0')

function windows(iso: string) {
  const [y, m] = iso.split('-').map(Number)
  return {
    mtd: `${y}-${pad(m)}-01`,
    qtd: `${y}-${pad(quarterStartMonth(m))}-01`,
    ytd: `${financialYearStart(y, m)}-04-01`,
  }
}

function main() {
  console.log('\nSOURCE — YTD must be the APRIL financial year, never 1 January\n')
  for (const rel of YTD_SOURCES) {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    ok(`${rel.split('/').slice(-2).join('/')}: no calendar-year start`,
      !src.includes('getCalendarYearStart') && !/return `\$\{date\.getUTCFullYear\(\)\}-01-01`/.test(src))
    ok(`${rel.split('/').slice(-2).join('/')}: uses the April financial year`,
      src.includes('getFinancialYearStart') || src.includes('financialYearStart'))
  }

  console.log('\nMATH — every window edge case\n')
  const CASES: Array<[string, string, string, string, string]> = [
    // endDate,      mtd,          qtd,          ytd,          note
    ['2026-07-31', '2026-07-01', '2026-07-01', '2026-04-01', 'July = FIRST month of a quarter -> MTD==QTD is CORRECT'],
    ['2026-08-15', '2026-08-01', '2026-07-01', '2026-04-01', 'mid-quarter -> all three differ'],
    ['2026-06-30', '2026-06-01', '2026-04-01', '2026-04-01', 'Q1 -> QTD==YTD is CORRECT (1 Apr starts both)'],
    ['2026-04-01', '2026-04-01', '2026-04-01', '2026-04-01', 'first day of the FY -> all four coincide'],
    ['2027-01-15', '2027-01-01', '2027-01-01', '2026-04-01', 'JANUARY -> YTD must roll BACK to the previous April'],
    ['2027-03-31', '2027-03-01', '2027-01-01', '2026-04-01', 'last day of the FY -> still the previous April'],
    ['2026-10-01', '2026-10-01', '2026-10-01', '2026-04-01', 'October = first month of a quarter'],
    ['2026-12-31', '2026-12-01', '2026-10-01', '2026-04-01', 'December -> Q3, same FY'],
  ]

  for (const [end, wantMtd, wantQtd, wantYtd, note] of CASES) {
    const got = windows(end)
    const good = got.mtd === wantMtd && got.qtd === wantQtd && got.ytd === wantYtd
    ok(`${end}  MTD ${got.mtd}  QTD ${got.qtd}  YTD ${got.ytd}`, good,
      good ? note : `expected MTD ${wantMtd} QTD ${wantQtd} YTD ${wantYtd}`)
  }

  console.log('\nINVARIANTS\n')
  const july = windows('2026-07-31')
  ok('MTD and QTD coincide in the first month of a quarter (documented, not a bug)',
    july.mtd === july.qtd, 'July')
  const august = windows('2026-08-15')
  ok('MTD and QTD DIVERGE once past the first month', august.mtd !== august.qtd, 'August')
  const jan = windows('2027-01-15')
  ok('a January date does NOT reset YTD to that January', jan.ytd === '2026-04-01', jan.ytd)
  ok('YTD never starts on 1 January', CASES.every(([end]) => !windows(end).ytd.endsWith('-01-01')))

  console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`} — ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
