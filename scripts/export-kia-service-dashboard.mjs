import 'dotenv/config'
import { buildKiaServiceDashboardExport } from '../lib/kia/service-dashboard-export.ts'
import path from 'node:path'
import fs from 'node:fs'

const { buffer, fileName, metrics } = await buildKiaServiceDashboardExport({
  endDate: '2026-06-15',
  dealerCode: 'JK402',
})

const out = path.join('c:/Users/sahil/Downloads', fileName)
fs.writeFileSync(out, Buffer.from(buffer))
console.log('Wrote', out)
console.log(JSON.stringify({ intake: metrics.intake, oil: metrics.oil, operations: metrics.operations, vas: metrics.vasAmount }, null, 2))
