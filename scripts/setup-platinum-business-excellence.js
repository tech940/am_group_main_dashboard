const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured')
  }

  const sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    connection: {
      application_name: 'setup_platinum_business_excellence',
      statement_timeout: 120_000,
    },
  })

  const filePath = path.join(__dirname, 'platinum-business-excellence-performance.sql')
  const statements = fs.readFileSync(filePath, 'utf8')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)

  try {
    for (const [index, statement] of statements.entries()) {
      const startedAt = Date.now()
      console.log(`[platinum-be] ${index + 1}/${statements.length}`)
      await sql.unsafe(statement)
      console.log(`[platinum-be] completed in ${Date.now() - startedAt}ms`)
    }
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[setup-platinum-business-excellence] failed', error)
  process.exit(1)
})
