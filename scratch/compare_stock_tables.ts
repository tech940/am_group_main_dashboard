import 'dotenv/config'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

async function compareTables() {
  const mgtCount: any = await db.execute(sql`SELECT COUNT(*) FROM kia_stock_management`)
  const repCount: any = await db.execute(sql`SELECT COUNT(*) FROM kia_stock_report`)

  console.log('kia_stock_management count:', (Array.isArray(mgtCount) ? mgtCount : mgtCount.rows)[0].count)
  console.log('kia_stock_report count:', (Array.isArray(repCount) ? repCount : repCount.rows)[0].count)

  const sampleMgt: any = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'kia_stock_management'`)
  const sampleRep: any = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'kia_stock_report'`)

  console.log('kia_stock_management cols:', (Array.isArray(sampleMgt) ? sampleMgt : sampleMgt.rows).map((c: any) => c.column_name).join(', '))
  console.log('kia_stock_report cols:', (Array.isArray(sampleRep) ? sampleRep : sampleRep.rows).map((c: any) => c.column_name).join(', '))

  process.exit(0)
}

compareTables()
