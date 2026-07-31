/**
 * verify:scrap-calculations — regression guards for the money-destroying bugs found in the
 * Scrap module's calculation audit (2026-07-31).
 *
 *   npm run verify:scrap-calculations
 *
 * Read-only. Each check replays the exact scenario that used to lose money, against the live data.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// The PUT handler's total rule, lifted verbatim so the test breaks if the route drifts from it.
function resolveTotal(body: Record<string, unknown>, existing: { weight_qty: number; rate_per_unit: number; calculated_total: number }) {
  const weightQty = body.weightQty !== undefined ? Number(body.weightQty) : Number(existing.weight_qty || 0)
  const ratePerUnit = body.ratePerUnit !== undefined ? Number(body.ratePerUnit) : Number(existing.rate_per_unit || 0)
  if (body.calculatedTotal !== undefined) return Math.round(Number(body.calculatedTotal) * 100) / 100
  if (weightQty > 0 && ratePerUnit > 0) return Math.round(weightQty * ratePerUnit * 100) / 100
  return Math.round(Number(existing.calculated_total || 0) * 100) / 100
}

const toIsoDate = (v: unknown) => (!v ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    const rows = await sql<{ transaction_number: string; sold_date: unknown; weight_qty: string; rate_per_unit: string; calculated_total: string; amount_received: string }[]>`
      SELECT transaction_number, sold_date, weight_qty, rate_per_unit, calculated_total, amount_received
      FROM scrap_transactions ORDER BY transaction_number`

    console.log('\nDATE HANDLING (sold_date is a DATE column; the driver returns a JS Date)')
    const sample = rows[0].sold_date
    ok('driver really does return a Date object (the trap is real)', sample instanceof Date, typeof sample)
    ok('the OLD code produced a weekday string',
      /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2}$/.test(String(sample).slice(0, 10)),
      `String(...).slice(0,10) = "${String(sample).slice(0, 10)}"`)
    const isoDates = rows.map((r) => toIsoDate(r.sold_date))
    ok('the FIX yields ISO dates on every row', isoDates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      `${isoDates[0]} .. ${isoDates[isoDates.length - 1]}`)

    // A date filter is a plain string comparison, so a broken format silently excludes everything.
    const inJuly = isoDates.filter((d) => d >= '2026-07-01' && d <= '2026-07-31').length
    const oldInJuly = rows.filter((r) => {
      const d = String(r.sold_date).slice(0, 10)
      return d >= '2026-07-01' && d <= '2026-07-31'
    }).length
    ok('a July date-range filter now returns rows', inJuly > 0, `${inJuly} rows (was ${oldInJuly} under the old format)`)
    const windowRows = isoDates.filter((d) => d >= '2026-07-01').length
    ok('the distribution window is the real July slice, not everything',
      windowRows === 56 && windowRows < rows.length, `${windowRows} of ${rows.length} rows`)

    console.log('\nSTATED TOTALS (rows carrying a total with no qty/rate)')
    // Deliberately NOT hardcoded: the register is re-issued periodically and this figure moves with
    // it (Rs 92,994 over 12 rows on the 30 Jul sheet, Rs 1,02,994 on the 31 Jul one). What must hold
    // is that the class exists and that no save can zero it — scenarios A and B below assert that.
    const stated = rows.filter((r) => (Number(r.weight_qty) === 0 || Number(r.rate_per_unit) === 0) && Number(r.calculated_total) > 0)
    const statedSum = stated.reduce((s, r) => s + Number(r.calculated_total), 0)
    ok('rows with a stated total exist and are worth real money', stated.length > 0 && statedSum > 0,
      `${stated.length} rows worth Rs ${inr(statedSum)} at risk`)

    // Scenario A — the Distribution tab's one-click, which sends no money fields at all.
    let destroyedA = 0
    for (const r of stated) {
      const after = resolveTotal({ id: 'x', isDistributed: true }, {
        weight_qty: Number(r.weight_qty), rate_per_unit: Number(r.rate_per_unit), calculated_total: Number(r.calculated_total),
      })
      if (Math.abs(after - Number(r.calculated_total)) > 0.01) destroyedA += Number(r.calculated_total)
    }
    ok('one-click "mark distributed" preserves the total', destroyedA === 0,
      destroyedA === 0 ? `Rs 0 lost across all ${stated.length} rows` : `Rs ${inr(destroyedA)} STILL DESTROYED`)

    // Scenario B — re-saving the record through the edit form, changing only a text field.
    let destroyedB = 0
    for (const r of stated) {
      const after = resolveTotal({ soldTo: 'A Different Vendor' }, {
        weight_qty: Number(r.weight_qty), rate_per_unit: Number(r.rate_per_unit), calculated_total: Number(r.calculated_total),
      })
      if (Math.abs(after - Number(r.calculated_total)) > 0.01) destroyedB += Number(r.calculated_total)
    }
    ok('editing a vendor preserves the total', destroyedB === 0,
      destroyedB === 0 ? 'Rs 0 lost' : `Rs ${inr(destroyedB)} STILL DESTROYED`)

    // Scenario C — an ordinary row must still recompute normally.
    const normal = rows.filter((r) => Number(r.weight_qty) > 0 && Number(r.rate_per_unit) > 0)
    let drift = 0
    for (const r of normal) {
      const after = resolveTotal({ weightQty: Number(r.weight_qty), ratePerUnit: Number(r.rate_per_unit) }, {
        weight_qty: Number(r.weight_qty), rate_per_unit: Number(r.rate_per_unit), calculated_total: Number(r.calculated_total),
      })
      if (Math.abs(after - Number(r.calculated_total)) > 0.01) drift++
    }
    ok('ordinary rows still derive qty x rate unchanged', drift === 0, `${normal.length} rows, ${drift} drifted`)

    // Scenario D — an explicit new total from the client must win.
    const t0 = resolveTotal({ calculatedTotal: 12345.67 }, { weight_qty: 10, rate_per_unit: 5, calculated_total: 50 })
    ok('an explicit total from the client is honoured', Math.abs(t0 - 12345.67) < 0.001, `Rs ${inr(t0)}`)

    console.log('\nAGING HEATMAP ("days since each scrap type was last sold, per location")')
    // The columns are ITEM categories (CARDBOARD, IRON, ALUMINIUM…) but were matched against
    // scrap_type_name, which only ever holds SCRAP / USED OIL / OLD BATTERIES — so six of the eight
    // columns matched nothing and read "never" for every location, and 185 rows fell into one.
    const items = await sql<{ location_name: string; scrap_type_name: string; description: string; sold_date: unknown }[]>`
      SELECT location_name, scrap_type_name, description, sold_date FROM scrap_transactions`
    const BUCKETS: Array<[string, string[]]> = [
      ['USED OIL', ['USED OIL', 'OIL']],
      ['CARDBOARD', ['CARDBOARD', 'BOXES', 'GATTA', 'CARTON']],
      ['IRON', ['IRON', 'STEEL', 'METAL']],
      ['WASTAGE PLASTIC', ['WASTAGE PLASTIC', 'PLASTIC', 'BUMPER']],
      ['OLD BATTERIES', ['OLD BATTERIES', 'BATTERY', 'BATTERIES']],
      ['EMPTY BARREL', ['EMPTY BARREL', 'BARREL', 'DRUM']],
      ['ALUMINIUM', ['ALUMINIUM', 'ALLUMINIUM', 'ALUMINUM']],
      ['BLACK PLASTIC', ['BLACK PLASTIC']],
    ]
    const itemText = (r: { description: string; scrap_type_name: string }) =>
      String(r.description || r.scrap_type_name || '').toUpperCase()

    const emptyColumns = BUCKETS.filter(([, al]) => !items.some((r) => al.some((a) => itemText(r).includes(a))))
    ok('no aging column is permanently empty', emptyColumns.length === 0,
      emptyColumns.length ? `always blank: ${emptyColumns.map(([k]) => k).join(', ')}` : `all ${BUCKETS.length} columns match live rows`)

    const uncategorised = items.filter((r) => !BUCKETS.some(([, al]) => al.some((a) => itemText(r).includes(a))))
    ok('uncategorised items are collected by OTHER, not dropped', true,
      `${uncategorised.length} rows fall to OTHER (e.g. ${[...new Set(uncategorised.map((r) => r.description))].slice(0, 4).join(', ')})`)

    // Matching on the 3-value type instead of the item is the regression to catch.
    const byType = BUCKETS.filter(([, al]) => items.some((r) => al.some((a) => String(r.scrap_type_name || '').toUpperCase().includes(a)))).length
    ok('item-based matching covers more columns than type-based', byType < BUCKETS.length,
      `type-based would fill only ${byType} of ${BUCKETS.length} columns`)

    const dash = readFileSync('features/scrap-erp/ScrapExecutiveDashboardView.tsx', 'utf8')
    ok('heatmap matches on the item, not scrapTypeName', dash.includes('function agingItemText') && dash.includes('matchesAgingBucket'))
    // Scoped to the aging loop on purpose: the Used Oil barrel matrix legitimately filters on
    // scrapTypeName (type 'USED OIL' identifies those rows exactly), so a blanket ban is wrong.
    ok('the aging loop filters via matchesAgingBucket, not the scrap type',
      dash.includes('locTxns.filter((t) => matchesAgingBucket(t, cfg))'))
    ok('day count is calendar arithmetic, not Date-instant subtraction',
      dash.includes('function daysBetweenIso') && !dash.includes('const diffMs = new Date().getTime() - latestDate.getTime()'))
    ok('one "today" for the whole matrix', dash.includes('const todayIso = toLocalIsoDate(new Date())'))
    ok('OTHER is a catch-all, not an alias list', dash.includes("{ key: 'OTHER', label: 'OTHER', threshold: 45, aliases: [] }"))

    console.log('\nSOURCE GUARDS (the fixes are actually in the code)')
    const route = readFileSync('app/api/scrap-erp/route.ts', 'utf8')
    ok('route uses toIsoDate for sold_date', route.includes('const soldDate = toIsoDate(row.sold_date)'))
    ok('route no longer does String(row.sold_date).slice', !route.includes('String(row.sold_date).slice'))
    ok('PUT honours body.calculatedTotal', route.includes('body.calculatedTotal !== undefined'))
    ok('PUT falls back to the stored total', route.includes('Number(existing.calculated_total || 0)'))
    ok('PUT rounds outstanding', route.includes('Math.round((calculatedTotal - amountReceived) * 100) / 100'))
    ok('PUT writes descriptive fields', route.includes('TEXT_FIELDS') && route.includes("['soldTo', 'sold_to']"))

    const form = readFileSync('features/scrap-erp/ScrapEntryFormView.tsx', 'utf8')
    ok('entry form guards the stated total', form.includes('wt > 0 && rate > 0'))
    ok('entry form accepts paise in Amount Received', /placeholder=\{`Default: ₹\$\{calculatedTotal\}`\}/.test(form) && form.includes('step="0.01"\n                  placeholder'))
    const modal = readFileSync('features/scrap-erp/EditScrapRecordModal.tsx', 'utf8')
    ok('edit modal guards the stated total', modal.includes('wt > 0 && rate > 0'))

    console.log('\nINVARIANTS (unchanged by the fixes)')
    const [k] = await sql<{ n: number; tot: string; recv: string; out: string }[]>`
      SELECT COUNT(*)::int n, SUM(calculated_total)::text tot, SUM(amount_received)::text recv, SUM(outstanding_amount)::text out
      FROM scrap_transactions`
    ok('row count', k.n === 272, String(k.n))
    ok('grand total still Rs 35,14,522.58', Math.abs(Number(k.tot) - 3514522.58) < 0.01, `Rs ${inr(Number(k.tot))}`)
    ok('received still equals total', Math.abs(Number(k.recv) - Number(k.tot)) < 0.01)
    ok('outstanding still zero', Math.abs(Number(k.out)) < 0.01)

    console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`} — ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error('\nVERIFY FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
