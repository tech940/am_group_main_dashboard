import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaVehicleAllocations, kiaBookingDiscounts, kiaBookings, kiaBookingActivity } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { canRequestDiscount, isValidDiscountType } from '@/lib/kia/discount-chain'

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
    const { amount, reason, discountType } = body

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Enter a discount amount greater than zero.' }, { status: 400 })
    }
    if (!isValidDiscountType(discountType)) {
      return NextResponse.json({ error: 'Choose a discount type from the list.' }, { status: 400 })
    }
    if (!String(reason ?? '').trim()) {
      return NextResponse.json({ error: 'Add a remark explaining why this discount is needed.' }, { status: 400 })
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

    /*
     * ⚠️ DELIVERED ONLY. A discount before handover belongs in the proforma price, where the
     * customer signs it; this flow is money returned AFTER the sale, which is why it needs the MD
     * and then a payment. Enforced here and not only on the screen — the button being hidden is a
     * courtesy, this is the control.
     */
    if (!canRequestDiscount(booking)) {
      return NextResponse.json({
        error: 'A discount can only be requested once the vehicle has been delivered.',
      }, { status: 400 })
    }

    /*
     * The delivered vehicle AS IT STANDS NOW, frozen onto the request.
     *
     * The booking keeps changing — a car can be re-allotted and a variant corrected, both of which
     * happened this month — so an approver reading this request weeks later must see what was
     * actually delivered when it was raised, not whatever the record has become.
     */
    const [allocation] = await db
      .select()
      .from(kiaVehicleAllocations)
      .where(eq(kiaVehicleAllocations.bookingId, id))
      .orderBy(desc(kiaVehicleAllocations.allocatedAt))
      .limit(1)

    const meta = (booking.metadata || {}) as Record<string, unknown>
    const vehicleSnapshot = {
      capturedAt: new Date().toISOString(),
      bookingNumber: booking.bookingNumber,
      customerName: booking.customerName,
      dealerCode: booking.dealerCode,
      model: booking.model,
      variant: booking.variant,
      color: booking.color,
      fuelType: booking.fuelType,
      // The allocation is the authority on WHICH car; the booking's allocated_vin is the fallback.
      vin: allocation?.vinNumber ?? booking.allocatedVin ?? null,
      engineNo: allocation?.engineNo ?? null,
      deliveredAt: booking.deliveredAt ? booking.deliveredAt.toISOString() : null,
      consultantName: booking.consultantName,
      bankName: booking.bankName,
      loanAmount: booking.loanAmount,
      financeRequired: booking.financeRequired,
      amountReceived: booking.amountReceived,
      exShowroom: typeof meta.exShowroom === 'number' ? meta.exShowroom : null,
    }

    // Insert the discount request
    const [inserted] = await db
      .insert(kiaBookingDiscounts)
      .values({
        bookingId: id,
        requestedAmount: String(amount),
        discountType: String(discountType).trim(),
        reason: String(reason).trim(),
        // PENDING is the OVERALL status; the chain itself starts with every stage column NULL,
        // which discountStage() reads as "waiting on the Sales Manager".
        status: 'PENDING',
        requestedBy: appUser.id,
        requestedByName: appUser.fullName,
        vehicleSnapshot,
      })
      .returning()

    // Log booking activity
    await db.insert(kiaBookingActivity).values({
      bookingId: id,
      activityType: 'discount_requested',
      title: 'Discount Requested',
      description: `Requested a ${String(discountType).trim()} discount of INR ${Number(amount).toLocaleString('en-IN')}`
        + ` on ${vehicleSnapshot.vin || 'an unallocated vehicle'} by ${appUser.fullName}. Reason: ${String(reason).trim()}.`,
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
