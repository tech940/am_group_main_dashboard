import 'dotenv/config'
import { fetchHyundaiMonthlyOperationMetrics } from '../lib/hyundai/business-excellence-operations'
import { HYUNDAI_BRANCH_DEALERS } from '../lib/hyundai/dealer-branch'

const endDate = process.argv[2] || '2026-06-18'
const locations = [
  { label: 'All Locations', dealerCode: null },
  ...HYUNDAI_BRANCH_DEALERS,
]

async function main() {
  for (const location of locations) {
    const result = await fetchHyundaiMonthlyOperationMetrics(endDate, location.dealerCode)
    console.log(JSON.stringify({
      location: location.label,
      dealerCode: location.dealerCode,
      endDate,
      ...result,
    }))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
