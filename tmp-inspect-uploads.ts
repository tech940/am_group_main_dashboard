import { analyticsDb } from './lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  try {
    console.log('Listing all uploads in kia_purchase_report...')
    const result = await analyticsDb.execute(sql`
      SELECT uploaded_at, COUNT(*) as cnt
      FROM kia_purchase_report
      GROUP BY uploaded_at
      ORDER BY uploaded_at DESC
    `)
    console.log(result)
  } catch (error) {
    console.error(error)
  }
}

main()
