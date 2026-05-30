const fs = require('fs')
const path = require('path')
const postgres = require('postgres')
require('dotenv').config()

async function main() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured')
  }

  const sqlFile = path.join(__dirname, 'create-permissions-manager.sql')
  const statement = fs.readFileSync(sqlFile, 'utf8')
  const sql = postgres(databaseUrl, {
    ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
    max: 1,
    prepare: false,
  })

  try {
    await sql.unsafe(statement)
    console.log('Permissions manager tables and seed records are ready.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('Failed to setup permissions manager:', error)
  process.exit(1)
})
