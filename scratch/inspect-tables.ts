import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString)

async function main() {
  const customerId = 'C2025080005'
  
  console.log(`=== LOOKING UP CUSTOMER: ${customerId} ===`)

  const hyundaiBookings = await sql`
    SELECT * 
    FROM hyundai_booking_report 
    WHERE customer_id = ${customerId} OR order_ref_no = ${customerId}
  `
  console.log('Hyundai Bookings found:', hyundaiBookings)

  const platBookings = await sql`
    SELECT * 
    FROM am_platinum_booking_report 
    WHERE customer_id = ${customerId} OR order_ref_no = ${customerId}
  `
  console.log('Platinum Bookings found:', platBookings)

  if (platBookings.length > 0) {
    const booking = platBookings[0]
    const orderRef = booking.order_ref_no
    const customer_id = booking.customer_id

    const sales = await sql`
      SELECT * 
      FROM am_platinum_sales_report 
      WHERE customerid = ${customer_id} 
         OR order_ref_no = ${orderRef}
         OR customerid = ${customerId}
         OR order_ref_no = ${customerId}
    `
    console.log('Platinum Sales rows found:', sales)
  }

  await sql.end()
}

main().catch(console.error)
