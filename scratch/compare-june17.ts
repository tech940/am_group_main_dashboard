import 'dotenv/config'
import { buildServiceDashboardMetrics } from '../lib/kia/service-dashboard-export'

async function main() {
  const END_DATE = '2026-06-17'
  const DEALER_CODE = 'JK402'
  const metrics = await buildServiceDashboardMetrics(END_DATE, DEALER_CODE)
  console.log('=== UNCACHED METRICS FOR JK402 @ 2026-06-17 ===')
  console.log(JSON.stringify(metrics, null, 2))
}

main().catch(console.error)
