import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db/index.ts'
import { users } from '../lib/db/schema.ts'
import { eq, isNull, and } from 'drizzle-orm'

const started = Date.now()
try {
  await db.execute(sql`SELECT pg_sleep(15)`)
  console.log('sleep finished', Date.now() - started)
} catch (error) {
  console.log('sleep failed after', Date.now() - started, error instanceof Error ? error.message : error)
}

const selectStarted = Date.now()
const rows = await db
  .select({ id: users.id })
  .from(users)
  .where(isNull(users.deletedAt))
  .limit(1)
console.log('select ok', Date.now() - selectStarted, 'rows', rows.length)
