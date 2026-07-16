import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { vendors } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// DELETE — soft-delete a vendor
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await db
      .update(vendors)
      .set({ deletedAt: new Date() })
      .where(eq(vendors.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting vendor:', error)
    return NextResponse.json(
      { error: 'Failed to delete vendor', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// PATCH — update a vendor
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, gstNumber, email, phone, address } = body

    if (!name?.trim()) return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })
    if (!gstNumber?.trim()) return NextResponse.json({ error: 'GST Number is required' }, { status: 400 })

    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
    const cleanGst = gstNumber.trim().toUpperCase()
    if (!gstRegex.test(cleanGst)) {
      return NextResponse.json({ error: 'Invalid GST Number format' }, { status: 400 })
    }

    const [updated] = await db
      .update(vendors)
      .set({
        name: name.trim(),
        gstNumber: cleanGst,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(vendors.id, id))
      .returning()

    return NextResponse.json({ success: true, vendor: updated })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update vendor', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
