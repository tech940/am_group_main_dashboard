import 'dotenv/config'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

async function checkView() {
  const result: any = await db.execute(sql`
    SELECT table_name, table_type 
    FROM information_schema.tables 
    WHERE table_name IN ('kia_stock_management', 'kia_stock_report')
  `)
  console.log('Tables/Views:', Array.isArray(result) ? result : result.rows)

  const viewDef: any = await db.execute(sql`
    SELECT view_definition 
    FROM information_schema.views 
    WHERE table_name = 'kia_stock_management'
  `)
  const defRows = Array.isArray(viewDef) ? viewDef : viewDef.rows
  if (defRows.length > 0) {
    console.log('kia_stock_management view definition:', defRows[0].view_definition)
  }

  process.exit(0)
}

checkView()
