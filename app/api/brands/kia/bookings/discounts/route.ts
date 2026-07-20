import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaBookingDiscounts, kiaBookings } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/brands/kia/bookings/discounts
// Returns a list of all discount requests across all bookings
export async function GET(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Restrict list to MD, CEO, Developer, Admin, or managers if needed.
    // The prompt says "then MD can see list of Discounts that user has asked for".
    const allowedRoles = ['md', 'ceo', 'developer', 'admin', 'sales_manager', 'general_manager']
    if (!allowedRoles.includes(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden. You do not have permission to view discount requests.' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') // optional, e.g. 'PENDING'

    // Build the query
    let query = db
      .select({
        id: kiaBookingDiscounts.id,
        bookingId: kiaBookingDiscounts.bookingId,
        requestedAmount: kiaBookingDiscounts.requestedAmount,
        approvedAmount: kiaBookingDiscounts.approvedAmount,
        reason: kiaBookingDiscounts.reason,
        status: kiaBookingDiscounts.status,
        requestedBy: kiaBookingDiscounts.requestedBy,
        requestedByName: kiaBookingDiscounts.requestedByName,
        actionBy: kiaBookingDiscounts.actionBy,
        actionByName: kiaBookingDiscounts.actionByName,
        actionRemarks: kiaBookingDiscounts.actionRemarks,
        actionAt: kiaBookingDiscounts.actionAt,
        createdAt: kiaBookingDiscounts.createdAt,
        updatedAt: kiaBookingDiscounts.updatedAt,
        bookingNumber: kiaBookings.bookingNumber,
        customerName: kiaBookings.customerName,
        customerPhone: kiaBookings.customerPhone,
        model: kiaBookings.model,
        variant: kiaBookings.variant,
        color: kiaBookings.color,
        dealerCode: kiaBookings.dealerCode,
        consultantName: kiaBookings.consultantName,
        bookingStatus: kiaBookings.status,
      })
      .from(kiaBookingDiscounts)
      .innerJoin(kiaBookings, eq(kiaBookingDiscounts.bookingId, kiaBookings.id))

    if (statusFilter) {
      // @ts-ignore
      query = query.where(eq(kiaBookingDiscounts.status, statusFilter))
    }

    // @ts-ignore
    const rows = await query.orderBy(desc(kiaBookingDiscounts.createdAt))

    return NextResponse.json({ success: true, discounts: rows })
  } catch (error) {
    console.error('Error fetching global booking discounts:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch global booking discounts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
