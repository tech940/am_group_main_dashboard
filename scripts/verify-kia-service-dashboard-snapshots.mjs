import 'dotenv/config'
import { buildKiaServiceDashboardWorkbook } from '../lib/kia/service-dashboard-export.ts'

const expected = {
  '2026-06-08': {
    B6: 12, C6: 70,
    B7: 3, C7: 8,
    B9: 0, C9: 1,
    B13: 71778, C13: 218032,
    B14: 289154, C14: 521985,
    B19: 4, C19: 20,
    B23: 12, C23: 67,
    B24: 27, C24: 27,
    B25: 21, C25: 21,
    B28: 9, C28: 9,
    B35: 148, C35: 148,
    B41: 2854, C41: 2854,
  },
  '2026-06-17': {
    B6: 5, C6: 152,
    B7: 0, C7: 17,
    B9: 0, C9: 3,
    B13: 21007, C13: 599479,
    B14: 62410, C14: 1016086,
    B19: 0, C19: 38,
    B23: 6, C23: 148,
    B24: 57, C24: 57,
    B25: 48, C25: 48,
    B28: 12, C28: 12,
    B35: 309, C35: 309,
    B41: 3625, C41: 3625,
    B42: 6,
  },
}

function cellValue(cell) {
  const value = cell.value
  if (value && typeof value === 'object' && 'result' in value) return value.result
  return value
}

let failed = false
for (const [date, cells] of Object.entries(expected)) {
  for (const dealerCode of [null, 'JK402']) {
    const { worksheet, metrics } = await buildKiaServiceDashboardWorkbook({ endDate: date, dealerCode })
    const dealerLabel = dealerCode || 'all'
    if (metrics.sourceMetadata.snapshotMode !== 'verified_historical') {
      console.error(`FAIL ${date} ${dealerLabel}: expected verified_historical snapshot`)
      failed = true
    }

    for (const [address, expectedValue] of Object.entries(cells)) {
      const actual = cellValue(worksheet.getCell(address))
      if (actual !== expectedValue) {
        console.error(`FAIL ${date} ${dealerLabel} ${address}: actual=${actual} expected=${expectedValue}`)
        failed = true
      }
    }
  }
}

if (failed) process.exit(1)
console.log('KIA Service Dashboard verified snapshots match the MD reports for 08/06/2026 and 17/06/2026.')
