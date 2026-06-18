import 'dotenv/config'
import { analyticsDb as db } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  try {
    const tables = ['open_ro_yearly', 'ro_billing_report']
    for (const table of tables) {
      console.log(`=== Columns for ${table} ===`)
      const result = await db.execute(sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = ${table}
        ORDER BY ordinal_position
      `)
      for (const row of result) {
        console.log(`- ${row.column_name} (${row.data_type})`)
      }
    }
  } catch (err) {
    console.error(err)
  }
}

main().catch(console.error)
