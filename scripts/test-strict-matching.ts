import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

function normalizeModel(m: string): string {
  return String(m || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^(thenew|allnew|new)/, '')
    .replace(/(petrol|diesel|ev|hev|mhev)$/, '')
    .trim()
}

function normalizeVariant(v: string): string {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function normalizeColor(c: string): string {
  return String(c || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

async function testStrictMatching() {
  const bookingsRes = await db.execute(sql.raw(`
    SELECT id, booking_number, model, variant, color, metadata, status
    FROM kia_bookings
    WHERE deleted_at IS NULL AND status NOT IN ('delivered', 'cancelled')
  `))

  const stockRes = await db.execute(sql.raw(`
    SELECT sm.vin_number, sm.model, sm.variant, sm.exterior_color_name as color, sm.stock_status
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
    WHERE va.id IS NULL
      AND coalesce(ls.local_status, '') NOT IN ('retail', 'hold_customer', 'hold_dealer')
      AND lower(trim(coalesce(sm.stock_status, ''))) IN ('free stock', 'in transit')
  `))

  const bookings = bookingsRes as any[]
  const stock = stockRes as any[]

  console.log(`Found ${bookings.length} active bookings and ${stock.length} available stock vehicles.`)

  let matchingBookingsCount = 0

  for (const b of bookings) {
    const bModel = normalizeModel(b.model)
    const bVar = normalizeVariant(b.variant)
    const bColor = normalizeColor(b.color || b.metadata?.color)

    const matches = stock.filter((s) => {
      const sModel = normalizeModel(s.model)
      const sVar = normalizeVariant(s.variant)
      const sColor = normalizeColor(s.color)

      if (!bModel || !sModel) return false
      const modelMatch = bModel === sModel || bModel.includes(sModel) || sModel.includes(bModel)
      if (!modelMatch) return false

      if (!bVar || !sVar) return false
      const variantMatch = bVar === sVar || bVar.includes(sVar) || sVar.includes(bVar)
      if (!variantMatch) return false

      if (!bColor || !sColor) return false
      const colorMatch = bColor === sColor || bColor.includes(sColor) || sColor.includes(bColor)
      return colorMatch
    })

    if (matches.length > 0) {
      matchingBookingsCount++
      console.log(`\n✅ Booking [${b.booking_number}] (${b.status})`)
      console.log(`   Model='${b.model}' | Variant='${b.variant}' | Color='${b.color || b.metadata?.color}'`)
      console.log(`   Matched Stock (${matches.length}):`, matches.map(m => `[VIN: ${m.vin_number} | ${m.model} | ${m.variant} | ${m.color}]`))
    }
  }

  console.log(`\nSummary: Out of ${bookings.length} active bookings, strictly ${matchingBookingsCount} have matching stock vehicles on Model, Variant, AND Color!`)
}

testStrictMatching().catch(console.error).finally(() => process.exit(0))
