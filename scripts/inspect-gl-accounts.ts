import * as dotenv from 'dotenv'
import * as path from 'path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { glAccounts } from '../lib/db/schema'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function run() {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) throw new Error('DATABASE_URL is not set')
  
  const url = new URL(rawUrl)
  if (url.port === '6543') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  
  const client = postgres(url.toString(), { ssl: { rejectUnauthorized: false } })
  const db = drizzle(client)
  
  const rows = await db.select().from(glAccounts)
  console.log('Existing GL Accounts count:', rows.length)
  console.log('Rows:', rows.map(r => ({ id: r.id, glCode: r.glCode, glName: r.glName })))
  
  await client.end()
  process.exit(0)
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
