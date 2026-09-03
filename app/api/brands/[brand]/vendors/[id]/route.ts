import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { vendors, approvalsCommonData } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireVendorAccess } from '@/lib/vendors/access'

// DELETE — soft delete vendor from central registry
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    /*
     * ⚠️ This handler was UNAUTHENTICATED. Anyone could edit or delete a vendor — including
     * its bank account number, which is a payment-redirection vector, since the account on
     * the vendor record is what Accounts pay against.
     */
    const access = await requireVendorAccess()
    if (access.denied) return access.denied

    const { id } = await context.params

    // Fetch vendor details to know the name for common data sync
    const [vendor] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.id, id))
      .limit(1)

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found.' }, { status: 404 })
    }

    // Soft delete vendor
    await db
      .update(vendors)
      .set({ deletedAt: new Date() })
      .where(eq(vendors.id, id))

    // Parity sync: Delete from approvalsCommonData
    try {
      await db
        .delete(approvalsCommonData)
        .where(
          and(
            eq(approvalsCommonData.category, 'vendor'),
            eq(approvalsCommonData.value, vendor.name)
          )
        )
    } catch (err) {
      console.warn('Failed to delete legacy common data row:', err)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting vendor:', error)
    return NextResponse.json(
      { error: 'Failed to delete vendor', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// PATCH — update vendor registry details
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    /*
     * ⚠️ This handler was UNAUTHENTICATED. Anyone could edit or delete a vendor — including
     * its bank account number, which is a payment-redirection vector, since the account on
     * the vendor record is what Accounts pay against.
     */
    const access = await requireVendorAccess()
    if (access.denied) return access.denied

    const { id } = await context.params
    const body = await request.json()
    const { name, gstNumber, bankAccountNumber, email, phone, address } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })
    }

    const trimmedName = name.trim()
    const cleanGst = gstNumber?.trim() || null
    const cleanBank = bankAccountNumber?.trim() || null

    const [oldVendor] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.id, id))
      .limit(1)

    if (!oldVendor) {
      return NextResponse.json({ error: 'Vendor not found.' }, { status: 404 })
    }

    // Update vendors table
    const [updated] = await db
      .update(vendors)
      .set({
        name: trimmedName,
        gstNumber: cleanGst,
        bankAccountNumber: cleanBank,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(vendors.id, id))
      .returning()

    // Parity sync: Update name in approvalsCommonData
    try {
      await db
        .update(approvalsCommonData)
        .set({ value: trimmedName })
        .where(
          and(
            eq(approvalsCommonData.category, 'vendor'),
            eq(approvalsCommonData.value, oldVendor.name)
          )
        )
    } catch (err) {
      console.warn('Failed to update legacy common data row name:', err)
    }

    return NextResponse.json({
      success: true,
      vendor: updated
    })
  } catch (error) {
    console.error('Error updating vendor:', error)
    return NextResponse.json(
      { error: 'Failed to update vendor', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
