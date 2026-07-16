import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { vendors } from '@/lib/db/schema'
import { eq, desc, isNull } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

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

    let cleanGst = ''
    if (!gstNumber || !gstNumber.trim()) {
      // Generate a unique dummy GST that passes regex and unique constraint
      let isUnique = false
      let attempts = 0
      while (!isUnique && attempts < 10) {
        attempts++
        const letters = Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')
        const digits = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('')
        const generated = `99${letters}${digits}A1Z1`
        
        const existing = await db
          .select({ id: vendors.id })
          .from(vendors)
          .where(eq(vendors.gstNumber, generated))
          .limit(1)
        
        if (existing.length === 0) {
          cleanGst = generated
          isUnique = true
        }
      }
      if (!cleanGst) {
        return NextResponse.json({ error: 'Failed to generate unique GST number' }, { status: 500 })
      }
    } else {
      // Validate GST format: 15 alphanumeric characters
      const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
      cleanGst = gstNumber.trim().toUpperCase()
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
