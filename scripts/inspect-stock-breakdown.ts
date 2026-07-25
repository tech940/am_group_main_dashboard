import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function inspectModels() {
  const stockModels = await db.execute(sql.raw(`
    SELECT DISTINCT model, count(*)::int as count FROM kia_stock_management GROUP BY model ORDER BY model
  `))

  console.log('Distinct models in kia_stock_management:', stockModels)
}

inspectModels().catch(console.error).finally(() => process.exit(0))
