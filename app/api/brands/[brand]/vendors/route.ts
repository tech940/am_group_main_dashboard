import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { approvalsCommonData } from '@/lib/db/schema'
import { and, eq, or } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// GET — list all active vendors for this brand
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand } = await context.params
    const normalizedBrand = String(brand || '').trim().toLowerCase()

    const rows = await db
      .select()
      .from(approvalsCommonData)
      .where(
        and(
          eq(approvalsCommonData.category, 'vendor'),
          or(
            eq(approvalsCommonData.brand, normalizedBrand),
            eq(approvalsCommonData.brand, 'all')
          )
        )
      )

    // Map to structure expected by frontend (id, name, gstNumber)
    const vendors = rows.map(r => ({
      id: r.id,
      name: r.value,
      gstNumber: ''
    }))

    return NextResponse.json({ vendors })
  } catch (error) {
    console.error('Error fetching vendors:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vendors', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// POST — create a new vendor
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand } = await context.params
    const normalizedBrand = String(brand || '').trim().toLowerCase()

    const body = await request.json()
    const { name } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })
    }

    const trimmedName = name.trim()

    // Check duplicate
    const existing = await db
      .select()
      .from(approvalsCommonData)
      .where(
        and(
          eq(approvalsCommonData.category, 'vendor'),
          eq(approvalsCommonData.value, trimmedName)
        )
      )
      .limit(1)

    let insertedRow
    if (existing.length > 0) {
      insertedRow = existing[0]
    } else {
      const [inserted] = await db
        .insert(approvalsCommonData)
        .values({
          category: 'vendor',
          value: trimmedName,
          brand: 'all', // make it common/accessible everywhere
        })
        .returning()
      insertedRow = inserted
    }

    return NextResponse.json({
      success: true,
      vendor: {
        id: insertedRow.id,
        name: insertedRow.value,
        gstNumber: ''
      }
    })
  } catch (error) {
    console.error('Error creating vendor:', error)
    return NextResponse.json(
      { error: 'Failed to create vendor', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
