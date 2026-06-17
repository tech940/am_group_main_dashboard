import 'dotenv/config'
import { buildKiaServiceDashboardPreview } from '../lib/kia/service-dashboard-export.ts'

const start = Date.now()
await buildKiaServiceDashboardPreview({ endDate: '2026-06-15', dealerCode: 'JK402' })
const first = Date.now() - start

const start2 = Date.now()
await buildKiaServiceDashboardPreview({ endDate: '2026-06-15', dealerCode: 'JK402' })
const second = Date.now() - start2

console.log(JSON.stringify({ firstMs: first, cachedMs: second }))
