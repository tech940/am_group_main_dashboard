const fs = require('fs')
const path = require('path')
const postgres = require('postgres')
require('dotenv').config()

async function main() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured')
  }

  const sqlPath = path.join(process.cwd(), 'scripts', 'create-am-finance-v2.sql')
  const statement = fs.readFileSync(sqlPath, 'utf8')
  const sql = postgres(databaseUrl, {
    ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
    max: 1,
    prepare: false,
  })

  try {
    console.log('[am-finance-v2-setup] applying AM Finance form schema')
    await sql.unsafe(statement)
    console.log('[am-finance-v2-setup] ready: finance_sheet_id_seq, am_finance_audit_logs')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[am-finance-v2-setup] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
