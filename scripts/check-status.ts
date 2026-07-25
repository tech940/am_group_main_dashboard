import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function check() {
  const res = await db.execute(sql`
    SELECT status, count(*)::int AS count FROM kia_bookings WHERE deleted_at IS NULL GROUP BY status ORDER BY count DESC
  `)
  console.log('--- STATUS COUNTS ---')
  console.log(res)

  const onHoldRes = await db.execute(sql`
    SELECT id, booking_number, customer_name, status, proforma_id, metadata->>'heldReason' as held_reason, created_at, updated_at
    FROM kia_bookings
    WHERE deleted_at IS NULL AND status = 'on_hold'
    LIMIT 50
  `)
  console.log('--- ON HOLD BOOKINGS ---')
  console.log(onHoldRes)

  const activityRes = await db.execute(sql`
    SELECT booking_id, title, description, created_at
    FROM kia_booking_activity
    WHERE activity_type IN ('no_payment', 'release', 'hold')
    ORDER BY created_at DESC
    LIMIT 30
  `)
  console.log('--- RECENT RELEASE/HOLD ACTIVITIES ---')
  console.log(activityRes)

  process.exit(0)
}

check().catch((err) => {
  console.error(err)
  process.exit(1)
})
