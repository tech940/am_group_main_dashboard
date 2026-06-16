import 'dotenv/config'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'

function withStatementTimeout(url) {
  const parsed = new URL(url)
  const option = 'statement_timeout=12000'
  const existing = parsed.searchParams.get('options')
  parsed.searchParams.set('options', existing ? `${existing} -c ${option}` : `-c ${option}`)
  return parsed.toString()
}

const url = withStatementTimeout(process.env.DATABASE_URL)
const client = postgres(url, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
const db = drizzle(client)

const started = Date.now()
try {
  await db.execute(sql`SELECT pg_sleep(15)`)
  console.log('sleep finished', Date.now() - started)
} catch (error) {
  console.log('sleep failed after', Date.now() - started, error instanceof Error ? error.message : error)
} finally {
  await client.end()
}
