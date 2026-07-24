import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function inspectDiscrepancy() {
  // Query 1: Booking SRM definition of Payment Pending (vehicle_allocated)
  const bookingSrmPending = await db.execute(sql`
    SELECT id, booking_number, customer_name, status, dealer_code
    FROM kia_bookings
    WHERE status = 'vehicle_allocated' AND deleted_at IS NULL
  `)
  console.log('--- Bookings SRM (status = vehicle_allocated) Count:', bookingSrmPending.length)

  // Query 2: Stock Management definition of Payment Pending (active allocation, status NOT IN ready_delivery, delivered)
  const stockPending = await db.execute(sql`
    SELECT 
      sm.vin_number,
      sm.model,
      va.id as allocation_id,
      va.allocation_status,
      kb.id as booking_id,
      kb.booking_number,
      kb.customer_name,
      kb.status as booking_status
    FROM kia_stock_management sm
    JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
    WHERE kb.status NOT IN ('ready_delivery', 'delivered') OR kb.status IS NULL
  `)
  console.log('--- Stock Management Payment Pending Count:', stockPending.length)

  console.log('\nBreakdown of Stock Pending by Booking Status:')
  const statusCounts: Record<string, number> = {}
  stockPending.forEach((row: any) => {
    const st = row.booking_status || 'NO_BOOKING'
    statusCounts[st] = (statusCounts[st] || 0) + 1
  })
  console.log(statusCounts)

  console.log('\nAllocated records whose booking status is NOT vehicle_allocated:')
  stockPending.filter((row: any) => row.booking_status !== 'vehicle_allocated').forEach((row: any) => {
    console.log(`VIN: ${row.vin_number} | Booking#: ${row.booking_number} | Booking Status: ${row.booking_status} | Alloc Status: ${row.allocation_status}`)
  })

  process.exit(0)
}

inspectDiscrepancy().catch(err => {
  console.error(err)
  process.exit(1)
})
