import * as dotenv from 'dotenv'
import * as path from 'path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { kiaApprovalRequests } from '../lib/db/schema'

// Load environment variables from .env or .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function run() {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) {
    throw new Error('DATABASE_URL is not set in env!')
  }
  
  // Translate port 6543 -> 5432
  const url = new URL(rawUrl)
  if (url.port === '6543') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  const dbUrl = url.toString()

  console.log('Connecting to database:', dbUrl.replace(/:[^:@]+@/, ':***@'))
  const client = postgres(dbUrl, { ssl: { rejectUnauthorized: false } })
  const db = drizzle(client)

  console.log('Deleting all rows from kiaApprovalRequests table...')
  await db.delete(kiaApprovalRequests)
  console.log('All approval request rows deleted successfully!')
  
  await client.end()
  process.exit(0)
}

run().catch(err => {
  console.error('Error deleting data:', err)
  process.exit(1)
})
