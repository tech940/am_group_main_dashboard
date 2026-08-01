import 'dotenv/config'
import Module from 'module'
const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string) {
  if (id === 'server-only') return {}
  return originalRequire.apply(this, arguments as any)
}

import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

async function executeDelete() {
  const bookingNumber = 'KIA_JK402_2026_120135'
  const bookingId = '07cb6bf3-463d-4ed9-9c41-a01382ff3a25'

  console.log(`Deleting booking ${bookingNumber} (${bookingId})...`)

  // List of tables with potential foreign key references to kia_bookings
  const cleanupTables = [
    'kia_lead_followups',
    'kia_booking_activity',
    'kia_booking_discount_approvals',
    'kia_booking_payment_history',
    'kia_vehicle_allocations',
    'kia_booking_cancellations',
    'kia_proforma',
    'kia_booking_documents',
  ]

  for (const table of cleanupTables) {
    try {
      const res: any = await db.execute(sql.raw(`DELETE FROM "${table}" WHERE booking_id = '${bookingId}'`))
      console.log(`✓ Cleaned up related records from "${table}"`)
    } catch (err: any) {
      // Table doesn't exist or column doesn't match, continue
    }
  }

  // Delete from main kia_bookings table
  const delRes: any = await db.execute(sql`DELETE FROM kia_bookings WHERE id = ${bookingId} OR booking_number = ${bookingNumber}`)
  console.log('✓ Successfully deleted booking from kia_bookings table:', delRes)

  // Verify deletion
  const checkRes: any = await db.execute(sql`SELECT id, booking_number FROM kia_bookings WHERE id = ${bookingId} OR booking_number = ${bookingNumber}`)
  const remaining = (Array.isArray(checkRes) ? checkRes : checkRes.rows)
  console.log(`Verification: Remaining rows for ${bookingNumber} = ${remaining.length}`)

  process.exit(0)
}

executeDelete().catch((err) => {
  console.error(err)
  process.exit(1)
})
