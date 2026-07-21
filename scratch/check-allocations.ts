import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) process.exit(1)
const sql = postgres(connectionString)

async function main() {
  console.log('=== AUDITING RECENT ALLOCATION TIMESTAMPS ===\n')

  const allocs = await sql`
    SELECT id, vin_number, booking_id, allocated_at, released_at
    FROM kia_vehicle_allocations
    ORDER BY created_at DESC
    LIMIT 5
  `
  console.log('Recent Allocations:', JSON.stringify(allocs, null, 2))

  const activities = await sql`
    SELECT id, type, title, description, created_at
    FROM kia_booking_activity
    ORDER BY created_at DESC
    LIMIT 5
  `
  console.log('\nRecent Activities:', JSON.stringify(activities, null, 2))

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
