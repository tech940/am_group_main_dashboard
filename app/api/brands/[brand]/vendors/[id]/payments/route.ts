import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { vendors, kiaApprovalRequests } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// GET — fetch payment history for a vendor across all companies/brands
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ brand: string; id: string }> }
) {
  try {
    const { id } = await context.params

    // Fetch vendor details to get their exact name
    const [vendor] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.id, id))
      .limit(1)

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found.' }, { status: 404 })
    }

    // Query approval requests matching vendor name case-insensitively
    const payments = await db
      .select()
      .from(kiaApprovalRequests)
      .where(
        sql`LOWER(${kiaApprovalRequests.vendorName}) = LOWER(${vendor.name})`
      )
      .orderBy(kiaApprovalRequests.createdAt)

    return NextResponse.json({
      vendor,
      payments
    })
  } catch (error) {
    console.error('Error fetching vendor payments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vendor payments', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
