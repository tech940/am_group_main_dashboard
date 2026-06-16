import 'dotenv/config'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'

function sessionPoolerUrl(raw) {
  const url = new URL(raw)
  url.port = '5432'
  url.searchParams.set('pgbouncer', 'true')
  return url.toString()
}

const client = postgres(sessionPoolerUrl(process.env.DATABASE_URL), {
  prepare: false,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connection: { statement_timeout: 12000 },
})
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
