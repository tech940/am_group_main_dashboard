import 'dotenv/config'
import { getKiaStockReportSummary } from '../lib/kia/stock-report'

async function test() {
  try {
    console.log('Fetching getKiaStockReportSummary...')
    const data = await getKiaStockReportSummary({
      dealerCode: null,
    })
    console.log('Success! Data keys:', Object.keys(data))
    console.log('Total vehicles:', data.totalStock)
    console.log('Avg age:', data.avgAge)
  } catch (e: any) {
    console.error('Error fetching summary:', e.message)
    if (e.stack) {
      console.error(e.stack)
    }
  }
}

test()
