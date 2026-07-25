import { NextResponse } from 'next/server'
import { eq, and, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaBookings, kiaPriceDetails } from '@/lib/db/schema'
import { invalidateCache } from '@/lib/redis/cache-utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 1. Update Seltos Petrol -> New Seltos Petrol
    const petrolRes = await db
      .update(kiaBookings)
      .set({ model: 'New Seltos Petrol', updatedAt: new Date() })
      .where(sql`lower(trim(${kiaBookings.model})) = 'seltos petrol'`)
      .returning({ id: kiaBookings.id, bookingNumber: kiaBookings.bookingNumber })

    // 2. Update Seltos Diesel -> New Seltos Diesel
    const dieselRes = await db
      .update(kiaBookings)
      .set({ model: 'New Seltos Diesel', updatedAt: new Date() })
      .where(sql`lower(trim(${kiaBookings.model})) = 'seltos diesel'`)
      .returning({ id: kiaBookings.id, bookingNumber: kiaBookings.bookingNumber })

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

    await invalidateCache('kia:proforma:options:data')

    return NextResponse.json({
      success: true,
      petrolMigratedCount: petrolRes.length,
      dieselMigratedCount: dieselRes.length,
      dummyRowsDeletedCount: deletedRes.length,
    })
  } catch (error) {
    console.error('Migration endpoint error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    )
  }
}
