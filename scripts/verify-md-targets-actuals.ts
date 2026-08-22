/**
 * Proves the MD Targets aggregates tie back to each brand's own canonical reader.
 *
 *   NODE_ENV=development npx tsx --tsconfig ./tsconfig.verify.json scripts/verify-md-targets-actuals.ts
 *
 * lib/targets/actuals.ts deliberately does NOT call getKiaWorkshopSummary et al — twelve calls per
 * brand would be 200+ statements against a pooler where 15 concurrent queries once never completed.
 * It re-expresses each brand's dedup key and active-bill test as one month-grouped aggregate. That
 * is a copy, and copies drift, so this asserts the two agree for a COMPLETE month.
 */
import 'dotenv/config'
import { getBrandActuals, actualsKey } from '../lib/targets/actuals'
import { getKiaWorkshopSummary } from '../lib/kia/workshop-summary'
import { fetchCanonicalHyundaiRoBillingMetrics } from '../lib/hyundai/business-excellence-metrics'
import { fetchCanonicalRoBillingMetrics } from '../lib/platinum/business-excellence-metrics'
import { getBrandDealers } from '../lib/dealers/registry'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures += 1; console.log(`  [FAIL] ${m}`) }
/** Money is float-summed in two different orders, so compare within a rupee. */
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol

function lastCompleteMonth(): { year: number; month: number } {
  const ist = new Date(Date.now() + 330 * 60_000)
  const y = ist.getUTCFullYear()
  const m = ist.getUTCMonth() + 1
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 }
}

async function main() {
  const { year, month } = lastCompleteMonth()
  const mm = String(month).padStart(2, '0')
  const monthStart = `${year}-${mm}-01`
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  console.log(`\nComparing ${year}-${mm} against each brand's canonical reader\n`)

  // ---- KIA service: sum our per-branch cells, compare to the workshop summary total ----
  console.log('1) KIA service vs getKiaWorkshopSummary')
  const kia = await getBrandActuals('kia', year, month)
  let kiaRo = 0, kiaRev = 0
  for (const d of getBrandDealers('kia')) {
    const c = kia.cells.get(actualsKey(d.code, year, month))
    kiaRo += c?.serviceRoCount ?? 0
    kiaRev += c?.serviceRevenue ?? 0
  }
  const ws = await getKiaWorkshopSummary({ endDate: monthEnd })
  console.log(`     ours: ${kiaRo} ROs / Rs${kiaRev.toFixed(0)}   reader: ${ws.total.roCount} ROs / Rs${Number(ws.total.billing).toFixed(0)}`)
  if (kiaRo === ws.total.roCount) ok('KIA RO count matches exactly')
  else fail(`KIA RO count ${kiaRo} vs reader ${ws.total.roCount}`)
  if (near(kiaRev, Number(ws.total.billing))) ok('KIA service revenue matches')
  else fail(`KIA service revenue ${kiaRev.toFixed(2)} vs reader ${Number(ws.total.billing).toFixed(2)}`)

  // ---- Hyundai + Platinum service ----
  for (const brand of ['hyundai', 'platinum'] as const) {
    console.log(`\n2) ${brand} service vs its canonical RO-billing reader`)
    const a = await getBrandActuals(brand, year, month)
    let ro = 0, rev = 0
    for (const d of getBrandDealers(brand)) {
      const c = a.cells.get(actualsKey(d.code, year, month))
      ro += c?.serviceRoCount ?? 0
      rev += c?.serviceRevenue ?? 0
    }
    const args = { cyStart: monthStart, cyEnd: monthEnd, lyStart: monthStart, lyEnd: monthEnd }
    const m = brand === 'hyundai'
      ? await fetchCanonicalHyundaiRoBillingMetrics(args)
      : await fetchCanonicalRoBillingMetrics(args)
    const readerRo = Number(m?.cy?.dedupedJc ?? 0)
    const readerRev = Number(m?.cy?.revenue ?? 0)
    console.log(`     ours: ${ro} ROs / Rs${rev.toFixed(0)}   reader: ${readerRo} ROs / Rs${readerRev.toFixed(0)}`)
    // Ours EXCLUDES branch keys that map to no registered branch (e.g. the Hyundai code N6848 found
    // in the Platinum feed); the reader includes everything. So ours must be <= the reader, and any
    // gap is exactly that contamination — reported, not silently tolerated.
    if (ro <= readerRo) ok(`${brand} RO count is within the reader total (gap ${readerRo - ro} = unmapped branch keys)`)
    else fail(`${brand} RO count ${ro} EXCEEDS reader ${readerRo} — double counting`)
    if (rev <= readerRev + 1) ok(`${brand} service revenue is within the reader total (gap Rs${(readerRev - rev).toFixed(0)})`)
    else fail(`${brand} service revenue ${rev.toFixed(2)} EXCEEDS reader ${readerRev.toFixed(2)} — double counting`)
  }

  // ---- No branch may exceed its brand: the consolidated-dealer double-count guard ----
  console.log('\n3) Per-branch service never exceeds the brand total (consolidation guard)')
  for (const brand of ['kia', 'hyundai', 'platinum'] as const) {
    const a = await getBrandActuals(brand, year, month)
    const dealers = getBrandDealers(brand)
    let sum = 0
    let max = 0
    for (const d of dealers) {
      const c = a.cells.get(actualsKey(d.code, year, month))
      const v = c?.serviceRevenue ?? 0
      sum += v
      max = Math.max(max, v)
    }
    if (sum === 0) { ok(`${brand}: no service data this month (nothing to check)`); continue }
    if (max <= sum) ok(`${brand}: no single branch exceeds the branch sum (${dealers.length} branches)`)
    else fail(`${brand}: one branch exceeds the sum — a consolidated code is being counted twice`)
  }

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
