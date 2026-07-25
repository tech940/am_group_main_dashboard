import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function inspectScrapData() {
  console.log('=== Inspecting Scrap Transactions ===')

  const recent = await db.execute(sql.raw(`
    SELECT *
    FROM scrap_transactions
    ORDER BY created_at DESC
    LIMIT 15
  `))

  console.log('Recent 15 scrap transactions:', JSON.stringify(recent, null, 2))
}

inspectScrapData().catch(console.error).finally(() => process.exit(0))
