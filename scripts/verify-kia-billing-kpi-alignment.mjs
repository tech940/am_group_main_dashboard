import 'dotenv/config'
import { fetchDeliveredBillingKpis } from '../lib/kia/ro-billing-kpis.ts'
import { buildKiaServiceDashboardWorkbook } from '../lib/kia/service-dashboard-export.ts'

const DEALER = 'JK402'
const END_DATE = '2026-06-15'
const START_DATE = '2026-06-01'

const billingKpis = await fetchDeliveredBillingKpis(START_DATE, END_DATE, DEALER)
const { metrics } = await buildKiaServiceDashboardWorkbook({ endDate: END_DATE, dealerCode: DEALER })
const delivered = Object.values(metrics.revenue.delivered).reduce((sum, row) => sum + row.mtd, 0)
const labour = metrics.revenue.mechanicalLabour.mtd + metrics.revenue.bodyshopLabour.mtd
const parts = metrics.revenue.mechanicalParts.mtd + metrics.revenue.bodyshopParts.mtd

const checks = [
  ['deliveredCount', billingKpis.deliveredCount, delivered],
  ['labour', Math.round(billingKpis.labour), Math.round(labour)],
  ['parts', Math.round(billingKpis.parts), Math.round(parts)],
  ['labourPerVehicle', Math.round(billingKpis.labourPerVehicle), Math.round(labour / delivered)],
  ['partsPerVehicle', Math.round(billingKpis.partsPerVehicle), Math.round(parts / delivered)],
  ['avgBilling', Math.round(billingKpis.avgBilling), Math.round((labour + parts) / delivered)],
]

let ok = true
for (const [label, actual, expected] of checks) {
  const pass = actual === expected
  ok &&= pass
  console.log(`${pass ? 'OK' : 'FAIL'} ${label}: snapshot=${actual} dashboard=${expected}`)
}

process.exit(ok ? 0 : 1)
