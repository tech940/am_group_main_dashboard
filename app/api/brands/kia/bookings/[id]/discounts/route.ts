import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaBookingDiscounts, kiaBookings, kiaBookingActivity } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/brands/kia/bookings/[id]/discounts
// Returns all discount requests for a booking
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params

    const rows = await db
      .select()
      .from(kiaBookingDiscounts)
      .where(eq(kiaBookingDiscounts.bookingId, id))
      .orderBy(desc(kiaBookingDiscounts.createdAt))

    return NextResponse.json({ success: true, discounts: rows })
  } catch (error) {
    console.error('Error fetching booking discounts:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch booking discounts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// POST /api/brands/kia/bookings/[id]/discounts
// Submits a new discount request for a booking
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const { amount, reason } = body

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Invalid discount amount. Must be a positive number.' }, { status: 400 })
    }

    // Verify booking exists
    const [booking] = await db
      .select()
      .from(kiaBookings)
      .where(eq(kiaBookings.id, id))
      .limit(1)

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    }

    // Insert the discount request
    const [inserted] = await db
      .insert(kiaBookingDiscounts)
      .values({
        bookingId: id,
        requestedAmount: String(amount),
        reason: reason || '',
        status: 'PENDING',
        requestedBy: appUser.id,
        requestedByName: appUser.fullName,
      })
      .returning()

    // Log booking activity
    await db.insert(kiaBookingActivity).values({
      bookingId: id,
      activityType: 'discount_requested',
      title: 'Discount Requested',
      description: `Requested a discount of INR ${Number(amount).toLocaleString('en-IN')} by ${appUser.fullName}. Reason: ${reason || 'Not specified'}.`,
      actorUserId: appUser.id,
      actorName: appUser.fullName,
      actorRole: appUser.role,
    })

    return NextResponse.json({ success: true, discount: inserted })
  } catch (error) {
    console.error('Error creating booking discount:', error)
    return NextResponse.json(
      {
        error: 'Failed to create booking discount',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
