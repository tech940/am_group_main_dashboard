import { db } from '../lib/db'
import { kiaBookings, kiaPriceDetails } from '../lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { invalidateCache } from '../lib/redis/cache-utils'

async function main() {
  console.log('--- Starting Migration & Cleanup ---')

  // 1. Migrate Seltos Petrol -> New Seltos Petrol
  const petrolRes = await db
    .update(kiaBookings)
    .set({ model: 'New Seltos Petrol', updatedAt: new Date() })
    .where(eq(kiaBookings.model, 'Seltos Petrol'))
    .returning({ id: kiaBookings.id, bookingNumber: kiaBookings.bookingNumber })

  console.log(`Updated ${petrolRes.length} bookings from 'Seltos Petrol' to 'New Seltos Petrol'.`)

  // 2. Migrate Seltos Diesel -> New Seltos Diesel
  const dieselRes = await db
    .update(kiaBookings)
    .set({ model: 'New Seltos Diesel', updatedAt: new Date() })
    .where(eq(kiaBookings.model, 'Seltos Diesel'))
    .returning({ id: kiaBookings.id, bookingNumber: kiaBookings.bookingNumber })

  console.log(`Updated ${dieselRes.length} bookings from 'Seltos Diesel' to 'New Seltos Diesel'.`)

  // 3. Clean up dummy __BANK_BRANCH__ rows in kia_price_details
  const deletedRes = await db
    .delete(kiaPriceDetails)
    .where(
      and(
        eq(kiaPriceDetails.model, '__BANK_BRANCH__'),
        eq(kiaPriceDetails.trimDescription, '__BANK_BRANCH__')
      )
    )
    .returning({ id: kiaPriceDetails.id })

  console.log(`Deleted ${deletedRes.length} dummy '__BANK_BRANCH__' rows from 'kia_price_details'.`)

  // 4. Invalidate Redis options cache
  await invalidateCache('kia:proforma:options:data')
  console.log('Invalidated Redis cache kia:proforma:options:data.')

  console.log('--- Migration & Cleanup Finished Successfully ---')
}

main().catch((err) => {
  console.error('Migration error:', err)
  process.exit(1)
}).finally(() => {
  process.exit(0)
})
