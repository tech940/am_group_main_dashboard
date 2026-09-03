import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { vendors, kiaApprovalRequests } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { requireVendorAccess } from '@/lib/vendors/access'
import { filterVisibleApprovals } from '@/lib/kia/approval-scope'

export const dynamic = 'force-dynamic'

// GET — fetch payment history for a vendor across all companies/brands
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ brand: string; id: string }> }
) {
  try {
    /*
     * ⚠️ THIS ENDPOINT HAD NO AUTHENTICATION AND NO SCOPING AT ALL.
     *
     * It selected the FULL kia_approval_requests row for every payment matching a vendor name,
     * across every brand, and returned it to anyone holding a vendor id — amounts, requester names,
     * bill URLs, GST, the lot. No session check, no permission, no branch filter.
     *
     * Two guards, and both are needed:
     *   1. the SECTION permission, so this matches the page and every other approvals endpoint;
     *   2. filterVisibleApprovals, so a Hyundai login sees Hyundai payments and nothing else.
     *
     * The second is the one that matters here: this route is deliberately cross-company (a vendor
     * bills several of our entities), so without a row filter a correct permission still hands over
     * the whole group's ledger.
     */
    const access = await requireVendorAccess()
    if (access.denied) return access.denied
    const appUser = access.appUser

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
    const allPayments = await db
      .select()
      .from(kiaApprovalRequests)
      .where(
        sql`LOWER(${kiaApprovalRequests.vendorName}) = LOWER(${vendor.name})`
      )
      .orderBy(kiaApprovalRequests.createdAt)

    // Narrow to the brands and branches this user may actually see — the same helper the approvals
    // list and the Tally export use, so the three cannot disagree about who sees which payment.
    const payments = filterVisibleApprovals(appUser, allPayments)

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
