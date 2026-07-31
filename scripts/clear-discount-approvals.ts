import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())
import postgres from 'postgres'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL is not set in environment!')
  process.exit(1)
}

const sql = postgres(dbUrl, { prepare: false })

async function clearData() {
  console.log('Clearing all test records from discount_approvals table...')
  const deleted = await sql`DELETE FROM discount_approvals RETURNING id, customer_id, requester_name`
  console.log(`Successfully deleted ${deleted.length} test records from discount_approvals.`)
  await sql.end()
  process.exit(0)
}

clearData().catch((err) => {
  console.error('Error clearing discount_approvals:', err)
  process.exit(1)
})
