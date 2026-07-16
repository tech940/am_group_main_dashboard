import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { vendors } from '@/lib/db/schema'
import { eq, desc, isNull } from 'drizzle-orm'

// GET — list all active vendors
export async function GET() {
  try {
    const rows = await db
      .select()
      .from(vendors)
      .where(isNull(vendors.deletedAt))
      .orderBy(desc(vendors.createdAt))

    return NextResponse.json({ vendors: rows })
  } catch (error) {
    console.error('Error fetching vendors:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vendors', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// POST — create a new vendor
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, gstNumber, email, phone, address } = body

    // Validate mandatory fields
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })
    }
    if (!gstNumber || !gstNumber.trim()) {
      return NextResponse.json({ error: 'GST Number is required' }, { status: 400 })
    }

    // Validate GST format: 15 alphanumeric characters
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
    const cleanGst = gstNumber.trim().toUpperCase()
    if (!gstRegex.test(cleanGst)) {
      return NextResponse.json(
        { error: 'Invalid GST Number format. Expected: 15-character GSTIN (e.g. 01ABCDE1234A1Z5)' },
        { status: 400 }
      )
    }

    // Check duplicate GST
    const existing = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(eq(vendors.gstNumber, cleanGst))
      .limit(1)

    if (existing.length > 0) {
      return NextResponse.json({ error: 'A vendor with this GST Number already exists' }, { status: 409 })
    }

    const [inserted] = await db
      .insert(vendors)
      .values({
        name: name.trim(),
        gstNumber: cleanGst,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
      })
      .returning()

    return NextResponse.json({ success: true, vendor: inserted })
  } catch (error) {
    console.error('Error creating vendor:', error)
    return NextResponse.json(
      { error: 'Failed to create vendor', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
