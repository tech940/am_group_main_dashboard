import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

function resolveDirectUrl(): string {
  const fromEnv = process.env.DATABASE_DIRECT_URL
  if (fromEnv) return fromEnv
  const pooled = process.env.DATABASE_URL
  if (!pooled) throw new Error('Neither DATABASE_DIRECT_URL nor DATABASE_URL is set')
  const url = new URL(pooled)
  if (url.port !== '6543') throw new Error(`Expected DATABASE_URL on 6543 to derive from; found ${url.port}`)
  url.port = '5432'
  return url.toString()
}

async function main() {
  const url = resolveDirectUrl()
  const parsed = new URL(url)
  if (parsed.port === '6543') throw new Error('Refusing to run DDL against the pgbouncer pooler on 6543.')
  console.log(`connecting to ${parsed.hostname}:${parsed.port}`)

  const sqlText = readFileSync('lib/db/migrations/0075_update_kia_walk_in_leads_followup.sql', 'utf8')
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    await sql.unsafe(sqlText)
    console.log('0075 applied successfully.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
