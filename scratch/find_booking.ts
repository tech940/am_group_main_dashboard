import 'dotenv/config'
import Module from 'module'
const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string) {
  if (id === 'server-only') return {}
  return originalRequire.apply(this, arguments as any)
}

import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

async function findBooking() {
  const targetId = 'KIA_JK402_2026_120135'
  console.log(`Searching for ${targetId} across PostgreSQL tables...`)

  const tablesResult: any = await db.execute(sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `)
  const tableNames = (Array.isArray(tablesResult) ? tablesResult : tablesResult.rows).map((r: any) => r.table_name)

  for (const tableName of tableNames) {
    try {
      // Find columns in this table
      const colsResult: any = await db.execute(sql.raw(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = '${tableName}'
      `))
      const cols = (Array.isArray(colsResult) ? colsResult : colsResult.rows)
      const textCols = cols.filter((c: any) => 
        ['text', 'character varying', 'varchar', 'uuid'].includes(c.data_type)
      ).map((c: any) => c.column_name)

      if (textCols.length === 0) continue

      const ORConditions = textCols.map((col: string) => `"${col}"::text = '${targetId}'`).join(' OR ')
      const query = `SELECT COUNT(*) as count FROM "${tableName}" WHERE ${ORConditions}`
      const res: any = await db.execute(sql.raw(query))
      const count = Number((Array.isArray(res) ? res : res.rows)[0].count)
      if (count > 0) {
        console.log(`FOUND IN TABLE "${tableName}": ${count} row(s)`)

        // Print matching rows
        const matchQuery = `SELECT * FROM "${tableName}" WHERE ${ORConditions}`
        const matches: any = await db.execute(sql.raw(matchQuery))
        const rows = Array.isArray(matches) ? matches : matches.rows
        console.dir(rows, { depth: 4 })
      }
    } catch (err: any) {
      // Ignore query errors on unsearchable columns
    }
  }

  process.exit(0)
}

findBooking().catch((err) => {
  console.error(err)
  process.exit(1)
})
