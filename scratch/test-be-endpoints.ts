import 'dotenv/config'
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

// Mock Request object for GET handler
import { GET } from '../app/api/brands/hyundai/business-excellence/ro-billing-analysis/route'

async function testEndpoint(dealerCode: string | null) {
  const url = `http://localhost:3000/api/brands/hyundai/business-excellence/ro-billing-analysis?brand=hyundai&sheet=hyundai_ro_billing_report&analysisType=load&view=table&groupBy=work_type&metrics=all&startDate=2026-06-01&endDate=2026-06-24${dealerCode ? `&dealer_code=${dealerCode}` : ''}`
  console.log(`Testing URL: ${url}`)
  
  const req = new Request(url)
  const startTime = Date.now()
  try {
    const res = await GET(req)
    console.log(`Response status: ${res.status} (took ${Date.now() - startTime}ms)`)
    if (res.status !== 200) {
      const text = await res.text()
      console.error(`Error response: ${text}`)
    } else {
      const data = await res.json()
      console.log(`Success! Result row count: ${data.rows?.length || data.byMetric?.load?.rows?.length || 0}`)
    }
  } catch (error) {
    console.error(`Request failed for ${dealerCode || 'All'}:`, error)
  }
}

async function main() {
  // Test All Locations
  await testEndpoint(null)

  // Test individual branches
  const branches = ['JAMMU', 'AKHNOOR', 'KATHUA', 'RS_PURA', 'VIJAYPUR', 'BILLAWAR']
  for (const branch of branches) {
    await testEndpoint(branch)
  }
}

main().catch(console.error)
