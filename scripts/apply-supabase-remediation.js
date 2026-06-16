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

function isCommentOnly(statement) {
  const lines = statement.split('\n').filter((line) => line.trim() && !line.trim().startsWith('--'))
  return lines.length === 0
}

function stripComments(sqlText) {
  return sqlText.replace(/^--[^\n]*\n?/gm, '')
}

function splitStatements(sqlText) {
  const statements = []
  let buffer = ''
  let index = 0
  let dollarTag = null
  const source = stripComments(sqlText)
  while (index < source.length) {
    if (dollarTag === null && source[index] === '$') {
      const match = source.slice(index).match(/^\$([A-Za-z0-9_]*)\$/)
      if (match) {
        dollarTag = match[0]
        buffer += dollarTag
        index += dollarTag.length
        continue
      }
    } else if (dollarTag !== null && source.slice(index, index + dollarTag.length) === dollarTag) {
      buffer += dollarTag
      index += dollarTag.length
      dollarTag = null
      continue
    }

    if (dollarTag === null && source[index] === ';') {
      const statement = buffer.trim()
      if (statement && !isCommentOnly(statement)) statements.push(statement)
      buffer = ''
      index += 1
      continue
    }

    buffer += source[index]
    index += 1
  }

  const trailing = buffer.trim()
  if (trailing && !isCommentOnly(trailing)) statements.push(trailing)
  return statements
}

async function applyFile(sql, fileName) {
  const filePath = path.join(__dirname, fileName)
  const statements = splitStatements(fs.readFileSync(filePath, 'utf8'))
  console.log(`[supabase-remediation] applying ${statements.length} statements from ${fileName}`)
  for (const [index, statement] of statements.entries()) {
    const label = statement.split('\n').find((line) => line.trim() && !line.trim().startsWith('--'))?.trim().slice(0, 80) || statement.slice(0, 80)
    const startedAt = Date.now()
    console.log(`[supabase-remediation] ${index + 1}/${statements.length}: ${label}`)
    await sql.unsafe(statement)
    console.log(`[supabase-remediation] done in ${Date.now() - startedAt}ms`)
  }
}

async function main() {
  const target = process.argv[2] || 'performance'
  const databaseUrl = ddlDatabaseUrl()
  const sql = postgres(databaseUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
    connection: {
      application_name: 'apply_supabase_remediation',
      statement_timeout: 600_000,
    },
  })

  try {
    if (target === 'performance' || target === 'all') {
      await applyFile(sql, 'supabase-query-performance-fixes.sql')
    }
    if (target === 'security' || target === 'all') {
      await applyFile(sql, 'supabase-security-linter-fixes.sql')
    }
    console.log('[supabase-remediation] all requested statements applied successfully')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[supabase-remediation] failed', error)
  process.exit(1)
})
