import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) process.exit(1)
const sql = postgres(connectionString)

async function main() {
  console.log('=== AUDITING STOCK VS BOOKINGS MATCHING ===\n')

  const stockRows = await sql`
    SELECT vin_number, model, variant, exterior_color_name as color, order_dealer
    FROM kia_stock_management
    LIMIT 10
  `
  console.log('Sample Stock Rows:', JSON.stringify(stockRows, null, 2))

  const bookings = await sql`
    SELECT id, booking_number, model, variant, color, dealer_code, status
    FROM kia_bookings
    WHERE status NOT IN ('draft', 'delivered', 'cancelled')
      AND id NOT IN (SELECT booking_id FROM kia_vehicle_allocations WHERE released_at IS NULL)
    LIMIT 10
  `
  console.log('\nSample Unallocated Active Bookings:', JSON.stringify(bookings, null, 2))

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
