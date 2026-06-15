const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

function ddlDatabaseUrl() {
  const raw = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')

  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

function splitStatements(sqlText) {
  return sqlText
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.replace(/^--[^\n]*\n?/gm, '').trim())
    .filter((statement) => statement.length > 0 && !statement.split('\n').every((line) => !line.trim() || line.trim().startsWith('--')))
}

async function main() {
  const filePath = path.join(__dirname, 'postgres-performance-audit-fixes.sql')
  const statements = splitStatements(fs.readFileSync(filePath, 'utf8'))
  const databaseUrl = ddlDatabaseUrl()

  const sql = postgres(databaseUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
    connection: {
      application_name: 'apply_postgres_performance_audit_fixes',
      statement_timeout: 600_000,
    },
  })

  try {
    console.log(`[perf-audit] applying ${statements.length} statements`)
    for (const [index, statement] of statements.entries()) {
      const label = statement.split('\n').find((line) => line.trim() && !line.trim().startsWith('--'))?.trim().slice(0, 80) || statement.slice(0, 80)
      const startedAt = Date.now()
      console.log(`[perf-audit] ${index + 1}/${statements.length}: ${label}`)
      await sql.unsafe(statement)
      console.log(`[perf-audit] done in ${Date.now() - startedAt}ms`)
    }
    console.log('[perf-audit] all statements applied successfully')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[perf-audit] failed', error)
  process.exit(1)
})
