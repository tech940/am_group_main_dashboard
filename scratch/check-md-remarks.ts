import { db } from '../lib/db'
import { kiaBookingActivity, kiaBookings } from '../lib/db/schema'
import { sql } from 'drizzle-orm'

async function check() {
  console.log('=== Checking kia_booking_activity for potential MD remarks ===')
  const activities = await db.select({
    id: kiaBookingActivity.id,
    bookingId: kiaBookingActivity.bookingId,
    actorName: kiaBookingActivity.actorName,
    actorRole: kiaBookingActivity.actorRole,
    title: kiaBookingActivity.title,
    description: kiaBookingActivity.description,
    createdAt: kiaBookingActivity.createdAt,
  }).from(kiaBookingActivity).limit(100)

  console.log(`Total activity rows retrieved: ${activities.length}`)
  const mdRows = activities.filter(a => {
    const text = (a.description || a.title || '')
    const role = (a.actorRole || '').toLowerCase()
    const name = (a.actorName || '').toLowerCase()
    return role.includes('md') || name.includes('md') || /\[md/i.test(text) || /md remark/i.test(text) || text.includes('MD')
  })
  console.log(`Matching potential MD activity rows: ${mdRows.length}`)
  console.log(JSON.stringify(mdRows.slice(0, 10), null, 2))

  console.log('\n=== Checking kia_bookings table for notes/remarks columns ===')
  const sampleBookings = await db.select({
    id: kiaBookings.id,
    bookingNumber: kiaBookings.bookingNumber,
    customerName: kiaBookings.customerName,
    notes: kiaBookings.notes,
    metadata: kiaBookings.metadata,
  }).from(kiaBookings).limit(50)

  const bookingsWithNotes = sampleBookings.filter(b => b.notes || (b.metadata && (b.metadata as any).remarks))
  console.log(`Bookings with notes/metadata remarks: ${bookingsWithNotes.length}`)
  console.log(JSON.stringify(bookingsWithNotes.slice(0, 10), null, 2))

  process.exit(0)
}

check().catch(err => {
  console.error(err)
  process.exit(1)
})
