import dotenv from 'dotenv'
dotenv.config()
import postgres from 'postgres'

const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || ''
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString, { ssl: { rejectUnauthorized: false } })

async function run() {
  // Let's check how many bookings are 'ready_delivery'
  const bookings = await sql`
    SELECT id, booking_number, customer_name, status, allocated_vin
    FROM kia_bookings
    WHERE status = 'ready_delivery' AND deleted_at IS NULL
  `
  console.log('Bookings with status = ready_delivery:', bookings.length)
  if (bookings.length > 0) {
    console.log(JSON.stringify(bookings, null, 2))

    // Let's check active allocations for these bookings
    const bookingIds = bookings.map(b => b.id)
    const allocations = await sql`
      SELECT id, booking_id, vin_number, allocation_status, released_at
      FROM kia_vehicle_allocations
      WHERE booking_id IN (${sql(bookingIds)}) AND released_at IS NULL
    `
    console.log('Active allocations for these bookings:', allocations.length)
    if (allocations.length > 0) {
      console.log(JSON.stringify(allocations, null, 2))

      // Let's check if the allocated VINs exist in kia_stock_management
      const vins = allocations.map(a => a.vin_number)
      const stock = await sql`
        SELECT id, vin_number, model, variant, stock_status
        FROM kia_stock_management
        WHERE vin_number IN (${sql(vins)})
      `
      console.log('Allocated VINs present in kia_stock_management:', stock.length)
      console.log(JSON.stringify(stock, null, 2))
    }
  }

  // Let's run the exact query used by rows in route.ts when status is PAID_TO_DELIVER
  const rows = await sql`
    SELECT 
      sm.id,
      sm.vin_number,
      kb.status as booking_status
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
    LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
    LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
    WHERE va.id IS NOT NULL AND kb.status = 'ready_delivery'
      AND NOT (((va.id IS NOT NULL AND kb.status = 'delivered') OR COALESCE(ls.local_status, '') = 'retail'))
  `
  console.log('Rows returned by route.ts query format:', rows.length)
  console.log(JSON.stringify(rows, null, 2))

  await sql.end()
}

run().catch(console.error)
