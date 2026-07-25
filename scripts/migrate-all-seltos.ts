import { db } from '../lib/db'
import { kiaBookings, kiaPriceDetails } from '../lib/db/schema'
import { eq, and, sql, ilike } from 'drizzle-orm'
import { invalidateCache } from '../lib/redis/cache-utils'

async function migrateAllSeltos() {
  console.log('=== Starting Full Seltos Booking Migration ===')

  // 1. Fetch all bookings where model contains "SELTOS" or "seltos"
  const seltosBookings = await db
    .select()
    .from(kiaBookings)
    .where(ilike(kiaBookings.model, '%seltos%'))

  console.log(`Found ${seltosBookings.length} total Seltos bookings.`)

  let petrolCount = 0
  let dieselCount = 0

  for (const b of seltosBookings) {
    const rawFuel = String(b.fuelType || (b.metadata as any)?.fuelType || '').toUpperCase()
    const rawVariant = String(b.variant || (b.metadata as any)?.variant || '').toUpperCase()
    const rawNaturalKey = String((b.metadata as any)?.naturalKey || '').toUpperCase()

    const isDiesel =
      rawFuel.includes('DIESEL') ||
      rawVariant.includes('D1.5') ||
      rawVariant.includes('DIESEL') ||
      rawNaturalKey.includes('DIESEL')

    const targetModel = isDiesel ? 'New Seltos Diesel' : 'New Seltos Petrol'

    if (b.model !== targetModel) {
      await db
        .update(kiaBookings)
        .set({ model: targetModel, updatedAt: new Date() })
        .where(eq(kiaBookings.id, b.id))

      if (isDiesel) dieselCount++
      else petrolCount++
    }
  }

  console.log(`Migrated ${petrolCount} bookings to 'New Seltos Petrol'.`)
  console.log(`Migrated ${dieselCount} bookings to 'New Seltos Diesel'.`)

  // 2. Cleanup __BANK_BRANCH__ rows in kia_price_details
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

  // 3. Invalidate Redis cache
  await invalidateCache('kia:proforma:options:data')
  console.log('Cache invalidated for kia:proforma:options:data.')

  // 4. Verify distinct models in kia_bookings
  const updatedModels = await db
    .select({
      model: kiaBookings.model,
      count: sql<number>`count(*)::int`
    })
    .from(kiaBookings)
    .groupBy(kiaBookings.model)

  console.log('Updated distinct models in kia_bookings:', updatedModels)
}

migrateAllSeltos().catch((err) => {
  console.error('Migration error:', err)
  process.exit(1)
}).finally(() => {
  process.exit(0)
})
