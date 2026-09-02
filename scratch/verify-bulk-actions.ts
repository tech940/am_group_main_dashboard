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

async function main() {
  console.log('Cleaning Fuel Approvals test data...')
  const before = await sql`SELECT id, request_number, status, veh_reg_no, submitted_by_name FROM fuel_approvals`
  console.log(`Found ${before.length} fuel approval records:`)
  for (const r of before) {
    console.log(`  - [${r.request_number}] (${r.status}) ${r.veh_reg_no} by ${r.submitted_by_name}`)
  }

  const deleted = await sql`DELETE FROM fuel_approvals RETURNING id, request_number`
  console.log(`Successfully removed ${deleted.length} test records from fuel_approvals table.`)
  await sql.end()
  process.exit(0)
}

main().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
