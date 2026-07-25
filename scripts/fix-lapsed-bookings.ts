import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function runFix() {
  console.log('--- RESTORING LAPSED PAYMENT BOOKINGS TO PROFORMA_GENERATED (AWAITING VIN) ---')

  const res = await db.execute(sql`
    WITH updated AS (
      UPDATE kia_bookings kb
      SET status = 'proforma_generated', updated_at = NOW()
      WHERE kb.deleted_at IS NULL
        AND kb.status = 'on_hold'
        AND EXISTS (
          SELECT 1 FROM kia_booking_activity a
          WHERE a.booking_id = kb.id AND a.activity_type = 'no_payment'
        )
        AND NOT EXISTS (
          SELECT 1 FROM kia_vehicle_allocations va
          WHERE va.booking_id = kb.id AND va.released_at IS NULL
        )
      RETURNING kb.id, kb.booking_number, kb.customer_name
    )
    SELECT * FROM updated;
  `)

  console.log('Restored remaining bookings count:', (res as any[]).length)
  console.log('Restored bookings details:', res)

  const onHoldDetails = await db.execute(sql`
    SELECT kb.id, kb.booking_number, kb.customer_name, kb.status, kb.proforma_id, kb.metadata->>'heldReason' as held_reason, kb.created_at,
           (SELECT jsonb_agg(jsonb_build_object('type', a.activity_type, 'title', a.title, 'desc', a.description)) FROM kia_booking_activity a WHERE a.booking_id = kb.id) as history
    FROM kia_bookings kb
    WHERE kb.deleted_at IS NULL AND kb.status = 'on_hold'
  `)
  console.log('--- REMAINING ON_HOLD BOOKINGS ---')
  console.log(JSON.stringify(onHoldDetails, null, 2))

  process.exit(0)
}

runFix().catch((err) => {
  console.error(err)
  process.exit(1)
})
