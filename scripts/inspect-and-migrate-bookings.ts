import { db } from '../lib/db'
import { kiaBookings } from '../lib/db/schema'
import { eq } from 'drizzle-orm'

async function inspectSeltos() {
  const rows = await db
    .select()
    .from(kiaBookings)
    .where(eq(kiaBookings.model, 'SELTOS'))

  const summary = rows.map(r => ({
    id: r.id,
    bookingNumber: r.bookingNumber,
    model: r.model,
    variant: r.variant,
    fuelType: (r as any).fuelType || (r as any).fuel_type || (r.metadata as any)?.fuelType || (r.metadata as any)?.fuel_type,
    metadata: r.metadata
  }))

  console.log('Found 21 SELTOS rows summary:', JSON.stringify(summary, null, 2))
}

inspectSeltos().catch(console.error).finally(() => process.exit(0))
