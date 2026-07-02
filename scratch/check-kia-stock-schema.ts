import 'dotenv/config'
import { analyticsDb } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function checkSchema() {
  try {
    const kiaReportCols = await analyticsDb.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'kia_stock_report'
    `)
    console.log('kia_stock_report columns and types:')
    console.log(JSON.stringify(kiaReportCols, null, 2))

    const localStatusCols = await analyticsDb.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'kia_stock_local_statuses'
    `)
    console.log('kia_stock_local_statuses columns and types:')
    console.log(JSON.stringify(localStatusCols, null, 2))
  } catch (e: any) {
    console.error('Error checking schema:', e.message)
  }
}

checkSchema()
