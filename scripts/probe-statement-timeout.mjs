import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db/index.ts'

const started = Date.now()
try {
  await db.execute(sql`SELECT pg_sleep(15)`)
  console.log('sleep finished', Date.now() - started)
} catch (error) {
  console.log('sleep failed after', Date.now() - started, error instanceof Error ? error.message : error)
}
