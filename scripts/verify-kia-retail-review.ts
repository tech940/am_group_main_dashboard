import 'dotenv/config'
import assert from 'node:assert/strict'
import { getKiaRetailReview, canonicalKiaModel } from '../lib/kia/retail-review'

/**
 * Guards the MD's retail review against the two defects that produced wrong numbers here before,
 * and against the deck it has to reconcile to.
 *
 * ⚠️ Structural invariants and floors, not fixed totals. The KIA feeds are live and cumulative —
 * an earlier run of this work saw a count move by 2 within twenty minutes. Anything pinned to an
 * exact number fails for the wrong reason every morning.
 *
 * The ONE exception is the CY2025 series: that year is closed, so its monthly numbers cannot
 * legitimately move and are asserted exactly against the MD's own deck.
 *
 * Run: npm run verify:kia-retail-review
 */

// From the MD's deck, CY2025 — a closed year, so these are safe to pin.
const DECK_CY25_JAMMU = [17, 24, 32, 42, 24, 21, 24, 24, 36, 52, 61, 32]
const DECK_CY25_UDHAMPUR = [0, 1, 8, 10, 8, 10, 13, 8, 9, 27, 16, 12]
const DECK_CY25_TOTAL = 511

async function main() {
  const checks: string[] = []
  const ok = (label: string) => checks.push(`  [PASS] ${label}`)

  const review = await getKiaRetailReview({ currentYear: 2026 })
  const byOutlet = new Map(review.series.map((series) => [series.outlet, series]))
  const all = byOutlet.get('ALL')!
  const jammu = byOutlet.get('JK402')!
  const udhampur = byOutlet.get('JK501')!

  /* 1. The closed prior year must match the deck exactly. */
  assert.deepEqual(jammu.months.map((m) => m.previous), DECK_CY25_JAMMU, 'Jammu CY2025 drifted from the deck')
  assert.deepEqual(udhampur.months.map((m) => m.previous), DECK_CY25_UDHAMPUR, 'Udhampur CY2025 drifted from the deck')
  assert.equal(all.previousTotal, DECK_CY25_TOTAL, `combined CY2025 should be ${DECK_CY25_TOTAL}`)
  ok(`CY2025 reconciles to the deck exactly (Jammu, Udhampur, and ${DECK_CY25_TOTAL} combined)`)

  /* 2. ⚠️ THE OUTLET SPLIT. This is the regression that matters most.
   *    The feed changed shape on 2026-07-22 — dealer_code became the parent JK402 and the real
   *    outlet moved to dealer_code_2. If the column order is ever reverted, Udhampur's post-July
   *    retails all collapse into Jammu and this assertion is the thing that catches it. */
  const julyUdhampur = udhampur.months[6].current
  assert.ok(
    julyUdhampur > 0,
    'Udhampur has ZERO retails in July 2026 — the outlet is being read from dealer_code instead of '
    + 'dealer_code_2, so every Udhampur retail after 2026-07-22 is being credited to Jammu.',
  )
  ok(`outlet split survives the 2026-07-22 feed changeover (Udhampur July = ${julyUdhampur})`)

  /* 3. Branches must recompose to the combined series, month by month. */
  for (let index = 0; index < 12; index += 1) {
    const sum = jammu.months[index].current + udhampur.months[index].current
    assert.ok(
      sum <= all.months[index].current,
      `month ${index + 1}: branches (${sum}) exceed the combined total (${all.months[index].current})`,
    )
  }
  ok('branch series never exceed the combined series')

  /* 4. ⚠️ VIN DEDUPE. KIA reuses invoice numbers (16 map to 32 VINs), so an invoice-keyed dedupe
   *    silently drops retails. A sudden drop in a closed month is the signature. */
  assert.ok(all.currentTotal > 0, 'no CY2026 retail at all — the dedupe or the date key is broken')
  const janToJul = all.months.slice(0, 7).reduce((total, row) => total + row.current, 0)
  assert.ok(janToJul >= 350, `CY2026 Jan-Jul fell to ${janToJul}; the deck says 367 and it cannot go down`)
  ok(`CY2026 Jan-Jul = ${janToJul} (deck 367)`)

  /* 5. The partial current month must never enter the averages. */
  const b = all.baseline
  assert.ok(
    b.lastMonthWithData === null || b.elapsedMonths <= b.lastMonthWithData,
    'elapsed months exceeds the months that carry data',
  )
  const now = new Date()
  if (review.currentYear === now.getUTCFullYear()) {
    assert.ok(
      b.elapsedMonths <= now.getUTCMonth(),
      `elapsedMonths (${b.elapsedMonths}) includes the current, incomplete month — a single early-month `
      + 'retail drags the average down and turns de-growth into a false collapse.',
    )
  }
  ok(`averages cover ${b.elapsedMonths} complete months only`)

  /* 6. Q4 baseline arithmetic. */
  assert.equal(b.q4Volume, all.months.slice(9, 12).reduce((t, r) => t + r.previous, 0), 'Q4 volume must be Oct-Dec of the prior year')
  assert.ok(b.deGrowthPercent !== null, 'de-growth should be computable')
  ok(`Q4 baseline: vol ${b.q4Volume}, avg ${b.q4AveragePerMonth.toFixed(1)}/mo, de-growth ${b.deGrowthPercent!.toFixed(0)}%`)

  /* 7. Model canonicalisation — the deck's rows, including the variant-driven Clavis split. */
  assert.equal(canonicalKiaModel('NEW SELTOS'), 'SELTOS', 'NEW SELTOS must merge into SELTOS')
  assert.equal(canonicalKiaModel('SELTOS'), 'SELTOS')
  assert.equal(canonicalKiaModel('CARENS', 'CARENS G1.5 6MT PREMIUM (O) 7'), 'CARENS')
  assert.equal(canonicalKiaModel('CARENS', 'CARENS CLAVIS G1.5 6MT HTE(O)7'), 'CARENS CLAVIS')
  assert.equal(canonicalKiaModel('CARENS', 'CARENS CLAVISG1.5T 6MT HTE EX7'), 'CARENS CLAVIS', 'the no-space spelling must still split')
  assert.equal(canonicalKiaModel('CARENS CLAVIS EV'), 'CARENS CLAVIS EV')
  assert.equal(canonicalKiaModel('SOMETHING NEW'), 'Other', 'unlisted models must bucket, never vanish')
  ok('model canonicalisation holds (Seltos merge, Clavis-by-variant, Other bucket)')

  /* 8. The model table must tie back to overall retail. */
  const modelSum = review.models.reduce((total, model) => total + model.total, 0)
  assert.equal(modelSum, review.modelTotals.total, 'model rows must sum to the overall row')
  assert.equal(review.modelTotals.total, janToJul, 'model total must equal retail over the same window')
  ok(`model rows tie to overall retail (${modelSum})`)

  console.log(checks.join('\n'))
  console.log('\n=== KIA RETAIL REVIEW: ALL CHECKS PASSED ===')
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
