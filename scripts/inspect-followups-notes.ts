import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function inspectNotes() {
  console.log('=== Inspecting kia_lead_followups & remarks ===')

  const totalFollowups = await db.execute(sql.raw(`SELECT count(*)::int as count FROM kia_lead_followups`))
  console.log('Total kia_lead_followups:', totalFollowups[0]?.count)

  const distinctReasons = await db.execute(sql.raw(`
    SELECT reason, outcome, count(*)::int as count 
    FROM kia_lead_followups 
    GROUP BY reason, outcome 
    ORDER BY count DESC
  `))
  console.log('Followups reasons & outcomes:', distinctReasons)

  const sampleNotes = await db.execute(sql.raw(`
    SELECT id, booking_id, status, reason, outcome, notes, created_at 
    FROM kia_lead_followups 
    ORDER BY created_at DESC 
    LIMIT 20
  `))
  console.log('Sample latest 20 follow-ups:', sampleNotes)

  const bookingStatusCounts = await db.execute(sql.raw(`
    SELECT status, count(*)::int as count FROM kia_bookings GROUP BY status
  `))
  console.log('Booking statuses in kia_bookings:', bookingStatusCounts)
}

inspectNotes().catch(console.error).finally(() => process.exit(0))
