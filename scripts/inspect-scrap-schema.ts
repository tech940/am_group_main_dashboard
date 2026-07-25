import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function inspectColumns() {
  const columns = await db.execute(sql.raw(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'scrap_transactions'
    ORDER BY ordinal_position
  `))

  console.log('Columns of scrap_transactions:', columns)
}

inspectColumns().catch(console.error).finally(() => process.exit(0))
