import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { vendors, approvalsCommonData } from '@/lib/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// GET — list all active vendors from the central vendors master registry
export async function GET(
  _request: NextRequest,
  _context: { params: Promise<{ brand: string }> }
) {
  try {
    const rows = await db
      .select()
      .from(vendors)
      .where(isNull(vendors.deletedAt))
      .orderBy(vendors.name)

    return NextResponse.json({ vendors: rows })
  } catch (error) {
    console.error('Error fetching vendors:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vendors', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// POST — create a new vendor with auto-assigned vendor code
export async function POST(
  request: NextRequest,
  _context: { params: Promise<{ brand: string }> }
) {
  try {
    const body = await request.json()
    const { name, gstNumber, bankAccountNumber, email, phone, address } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })
    }

    const trimmedName = name.trim()
    const cleanGst = gstNumber?.trim() || null
    const cleanBank = bankAccountNumber?.trim() || null

    // Check duplicate name case-insensitively
    const [existing] = await db
      .select()
      .from(vendors)
      .where(
        and(
          sql`LOWER(${vendors.name}) = LOWER(${trimmedName})`,
          isNull(vendors.deletedAt)
        )
      )
      .limit(1)

    if (existing) {
      return NextResponse.json({ error: 'A vendor with this name already exists.' }, { status: 400 })
    }

    // Auto-assign vendorCode: find max number in the V-XXX sequence
    const allVendors = await db
      .select({ vendorCode: vendors.vendorCode })
      .from(vendors)
      .where(isNull(vendors.deletedAt))

    let maxNum = 0
    allVendors.forEach((v) => {
      if (v.vendorCode && v.vendorCode.startsWith('V-')) {
        const num = parseInt(v.vendorCode.replace('V-', ''), 10)
        if (!isNaN(num) && num > maxNum) {
          maxNum = num
        }
      }
    })
    const nextCode = `V-${String(maxNum + 1).padStart(3, '0')}`

    // Insert into true vendors table
    const [inserted] = await db
      .insert(vendors)
      .values({
        name: trimmedName,
        gstNumber: cleanGst,
        vendorCode: nextCode,
        bankAccountNumber: cleanBank,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
      })
      .returning()

    // Compatibility support: Also sync into approvalsCommonData to support legacy dropdown systems
    try {
      const [existingCommon] = await db
        .select()
        .from(approvalsCommonData)
        .where(
          and(
            eq(approvalsCommonData.category, 'vendor'),
            eq(approvalsCommonData.value, trimmedName)
          )
        )
        .limit(1)

      if (!existingCommon) {
        await db.insert(approvalsCommonData).values({
          category: 'vendor',
          value: trimmedName,
          brand: 'all',
        })
      }
    } catch (err) {
      console.warn('Failed to sync vendor to approvalsCommonData:', err)
    }

    return NextResponse.json({
      success: true,
      vendor: inserted
    })
  } catch (error) {
    console.error('Error creating vendor:', error)
    return NextResponse.json(
      { error: 'Failed to create vendor', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
