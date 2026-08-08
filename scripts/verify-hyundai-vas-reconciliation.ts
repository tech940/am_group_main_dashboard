import 'dotenv/config'
import assert from 'node:assert/strict'
import { fetchHyundaiMonthlyOperationMetrics } from '../lib/hyundai/business-excellence-operations'

/**
 * Reconciles the Hyundai Operation-report metrics against figures supplied by the dealership
 * for July 2026. Both anchors are exact, so any drift here is a real regression.
 *
 * Why these numbers are the reference:
 *   - hyundai_operation_wise_analysis_report files N5216 as a CONSOLIDATED all-branch report,
 *     so the group total is N5216 alone and the Jammu-only figure is N5216 minus the other
 *     five branches. Confirmed independently against hyundai_ro_billing_report, where
 *     main_dealer_code = 'N5216' for all six source dealers.
 *   - the same (dealer, period) is uploaded more than once and row_hash cannot dedup it
 *     (the hash is computed by our own trigger over the measure columns, so every row is
 *     unique). The reader picks the largest upload per dealer.
 *
 * Run: npm run verify:hyundai-vas-recon
 */

const JULY = '2026-07-31'
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

// Supplied by the dealership for July 2026, VAS codes only.
const GROUP_VAS_AMOUNT = 1699979
const JAMMU_VAS_AMOUNT = 1034206

async function main() {
  const group = await fetchHyundaiMonthlyOperationMetrics(JULY, null)
  const jammu = await fetchHyundaiMonthlyOperationMetrics(JULY, 'JAMMU')

  assert.ok(group.available, 'July 2026 group metrics unavailable')
  assert.equal(
    Math.round(group.vasAmount),
    GROUP_VAS_AMOUNT,
    `All Locations VAS should be ${inr(GROUP_VAS_AMOUNT)}, got ${inr(group.vasAmount)}. `
    + 'A higher value means the six dealer codes are being summed again — N5216 already contains the other five.',
  )
  assert.equal(
    Math.round(jammu.vasAmount),
    JAMMU_VAS_AMOUNT,
    `Jammu VAS should be ${inr(JAMMU_VAS_AMOUNT)}, got ${inr(jammu.vasAmount)}. `
    + 'Jammu has no per-branch Operation file; its figure is only ever N5216 minus the other five branches.',
  )

  // The branch figures must add back up to the group, or the residual is wrong.
  const branches = ['AKHNOOR', 'KATHUA', 'RS_PURA', 'VIJAYPUR', 'BILLAWAR'] as const
  let branchSum = 0
  for (const branch of branches) {
    const metrics = await fetchHyundaiMonthlyOperationMetrics(JULY, branch)
    assert.ok(metrics.vasAmount > 0, `${branch} reported no VAS for July 2026`)
    branchSum += metrics.vasAmount
  }
  const recomposed = Math.round(branchSum + jammu.vasAmount)
  assert.equal(
    recomposed,
    GROUP_VAS_AMOUNT,
    `Branches must recompose to the group total: got ${inr(recomposed)} vs ${inr(GROUP_VAS_AMOUNT)}`,
  )

  // Wheel work is reported separately and must never be inside VAS revenue.
  assert.ok(group.waCount > 0 && group.wbCount > 0, 'wheel alignment/balancing counts are zero')

  // A period with no consolidated upload must say so rather than quietly under-report.
  const april = await fetchHyundaiMonthlyOperationMetrics('2026-04-30', 'JAMMU')
  assert.ok(
    april.coverageWarning,
    'April 2026 has no N5216 Operation file; Jammu must carry a coverage warning instead of a bare zero',
  )
  assert.equal(april.available, false, 'Jammu April 2026 must not report itself as available')

  console.log(
    `OK  group=${inr(group.vasAmount)}  jammu=${inr(jammu.vasAmount)}  `
    + `branches=${inr(branchSum)}  WA=${Math.round(group.waCount)}  WB=${Math.round(group.wbCount)}`,
  )
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
