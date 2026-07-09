import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const accessError = await requireBrandSectionApiAccess('kia', 'kia.bookings.view')
  if (accessError) return accessError
  try {
    const url = new URL(request.url)
    const variant = url.searchParams.get('variant') || ''
    const color = url.searchParams.get('color') || ''

    if (!variant || !color) {
      return NextResponse.json({ available: false, count: 0 })
    }

    // Build conditional filters for query
    let variantFilter = ''
    if (variant && variant !== 'other') {
      const escapedVariant = variant.replace(/'/g, "''").trim().toUpperCase()
      variantFilter = `AND UPPER(sm.variant) = '${escapedVariant}'`
    }

    let colorFilter = ''
    if (color) {
      const escapedColor = color.replace(/'/g, "''").trim().toUpperCase()
      colorFilter = `AND UPPER(sm.exterior_color_name) = '${escapedColor}'`
    }

    const query = sql.raw(`
      SELECT COUNT(*)::int AS count
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      WHERE va.id IS NULL
        ${variantFilter}
        ${colorFilter}
    `)

    const result = await db.execute(query)
    const count = Number(result[0]?.count || 0)

    return NextResponse.json({
      available: count > 0,
      count
    })
  } catch (error) {
    console.error('Failed to check stock:', error)
    return NextResponse.json({ available: false, count: 0, error: String(error) })
  }
}
