const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

function databaseUrl() {
  const raw = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')
  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

async function main() {
  const db = postgres(databaseUrl(), {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    connect_timeout: 30,
    connection: {
      application_name: 'setup_hyundai_business_excellence_parity',
      statement_timeout: 600_000,
    },
  })

  try {
    const file = path.join(__dirname, 'setup-hyundai-business-excellence-parity.sql')
    const source = fs.readFileSync(file, 'utf8')
    const statements = source
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.replace(/^--.*$/gm, '').trim())
      .filter(Boolean)

    for (const statement of statements) {
      try {
        await db.unsafe(statement)
      } catch (error) {
        if (error?.code === '42P01' || error?.code === '42703') {
          console.warn(`[hyundai-parity] skipped unavailable source/index: ${error.message}`)
          continue
        }
        throw error
      }
    }
    console.log('[hyundai-parity] indexes applied')
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error('[hyundai-parity] setup failed', error)
  process.exit(1)
})
