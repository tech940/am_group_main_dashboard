import 'dotenv/config'
import { buildKiaServiceDashboardWorkbook } from '../lib/kia/service-dashboard-export.ts'

const DEALER = 'JK402'
const END_DATE = '2026-06-15'

const { metrics } = await buildKiaServiceDashboardWorkbook({ endDate: END_DATE, dealerCode: DEALER })

const totalVehicleMtd = Object.values(metrics.intake).reduce((sum, row) => sum + row.mtd, 0)
const totalDeliveredMtd = Object.values(metrics.revenue.delivered).reduce((sum, row) => sum + row.mtd, 0)
const totalLabourMtd = metrics.revenue.mechanicalLabour.mtd + metrics.revenue.bodyshopLabour.mtd
const dayOfMonth = Number(metrics.exportDate.slice(8, 10))
const averageRo = totalVehicleMtd / Math.max(dayOfMonth - 1, 1)
const avgLabourPerRo = totalLabourMtd / totalDeliveredMtd
const labourPerRoWithoutVas = (totalLabourMtd - metrics.vasAmount) / totalDeliveredMtd

console.log('exportDate:', metrics.exportDate, 'monthStart:', metrics.monthStart)
console.log('=== buildMetrics JK402 @ 2026-06-15 ===')
console.log('intake:', metrics.intake)
console.log('delivered:', metrics.revenue.delivered)
console.log('labour MTD:', totalLabourMtd)
console.log('parts MTD:', metrics.revenue.mechanicalParts.mtd + metrics.revenue.bodyshopParts.mtd)
console.log('RSA MTD:', metrics.addons.rsa.mtd)
console.log('MCP MTD:', metrics.addons.mcp.mtd)
console.log('E/W MTD:', metrics.addons.ew.mtd)
console.log('alignment:', metrics.operations.alignmentCount, 'balancing:', metrics.operations.balancingCount)
console.log('alignment labour:', metrics.operations.alignmentLabour, 'balancing labour:', metrics.operations.balancingLabour)
console.log('pending accidental:', metrics.pending.accidental, 'mechanical:', metrics.pending.mechanical)
console.log('engine oil MTD:', metrics.oil.engineOilQty.mtd)
console.log('VAS amount:', metrics.vasAmount)
console.log('average RO:', Math.round(averageRo))
console.log('avg labour per RO:', Math.round(avgLabourPerRo))
console.log('labour per RO without VAS:', Math.round(labourPerRoWithoutVas))

process.exit(0)
