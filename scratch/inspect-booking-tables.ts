import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString, {
  connect_timeout: 30,
  idle_timeout: 20,
  max: 1,
})

function generateNumber(prefix: string) {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `${prefix}-${dateStr}-${rand}`
}

import { getPettyCashDashboard, listPettyCashRequests, getPettyCashApprovalQueue, getPettyCashApprovalCount } from '@/lib/petty-cash/server'
import type { AppUser } from '@/lib/auth/app-user'

async function main() {
  const settings = await sql`
    SELECT *
    FROM settings
  `.catch((err) => {
    console.error('Settings table error:', err.message)
    return []
  })
  console.log('Settings in DB:\n', settings)

  await sql.end()
}

main().catch(console.error)
