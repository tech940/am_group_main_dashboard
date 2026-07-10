import { getKiaSalesReportSummary } from '../lib/kia/sales-report'

async function run() {
  const summaryAll = await getKiaSalesReportSummary({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
  })
  console.log('ALL DEALERS RETAILS:', summaryAll.kpis.find((k) => k.label === 'Retails'))

  const summaryJK402 = await getKiaSalesReportSummary({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    dealerCode: 'JK402',
  })
  console.log('JK402 RETAILS:', summaryJK402.kpis.find((k) => k.label === 'Retails'))

  const summaryJK501 = await getKiaSalesReportSummary({
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    dealerCode: 'JK501',
  })
  console.log('JK501 RETAILS:', summaryJK501.kpis.find((k) => k.label === 'Retails'))

  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
