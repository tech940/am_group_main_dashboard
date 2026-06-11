const dotenv = require('dotenv')
const fs = require('fs/promises')
const path = require('path')
const postgres = require('postgres')

dotenv.config({ quiet: true })

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured. Run this from the project folder or add DATABASE_URL to .env.')
  }

  const sqlPath = path.join(process.cwd(), 'scripts', 'create-finance-orders.sql')
  const setupSql = await fs.readFile(sqlPath, 'utf8')
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  })

  try {
    console.log('[finance-orders-setup] applying finance order schema')
    await sql.unsafe(setupSql)

    const checks = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('finance_orders', 'finance_order_workflow', 'finance_order_comments')
      ORDER BY table_name
    `

    const createdTables = checks.map((row) => row.table_name)
    const missingTables = ['finance_orders', 'finance_order_workflow', 'finance_order_comments']
      .filter((tableName) => !createdTables.includes(tableName))

    if (missingTables.length > 0) {
      throw new Error(`Finance order setup did not create expected tables: ${missingTables.join(', ')}`)
    }

    console.log(`[finance-orders-setup] ready: ${createdTables.join(', ')}`)
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {})
  }
}

main().catch((error) => {
  console.error('[finance-orders-setup] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
