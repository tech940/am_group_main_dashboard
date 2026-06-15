/**
 * Spot-check parity across Platinum, KIA, and Hyundai priority tables.
 */
const dotenv = require('dotenv')
const { spawnSync } = require('node:child_process')

dotenv.config({ quiet: true })

const SPOT_CHECKS = [
  'am_platinum_ro_billing_report',
  'ro_billing_report',
  'hyundai_ro_billing_report',
  'am_platinum_operation_wise_analysis_report',
  'hyundai_repair_order_list',
]

function main() {
  let failures = 0
  for (const table of SPOT_CHECKS) {
    const result = spawnSync(process.execPath, ['scripts/bigquery/validate-parity.js', '--table', table], {
      stdio: 'inherit',
      env: process.env,
    })
    if (result.status !== 0) failures += 1
  }
  if (failures > 0) process.exit(1)
  console.log('[validate-all-brands] all spot checks passed')
}

main()
