import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaBookingDiscounts, kiaBookingActivity } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/brands/kia/bookings/discounts/[id]/action
// MD approves or rejects a specific discount request
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorize MD/CEO or admin/dev roles
    const allowedRoles = ['md', 'ceo', 'developer', 'admin']
    if (!allowedRoles.includes(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden. Only the MD or CEO can approve/reject discount requests.' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const { action, approvedAmount, remarks } = body // action: 'APPROVE' | 'REJECT'

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be APPROVE or REJECT.' }, { status: 400 })
    }

    // Fetch existing request
    const [discountRequest] = await db
      .select()
      .from(kiaBookingDiscounts)
      .where(eq(kiaBookingDiscounts.id, id))
      .limit(1)

    if (!discountRequest) {
      return NextResponse.json({ error: 'Discount request not found.' }, { status: 404 })
    }

    if (discountRequest.status !== 'PENDING') {
      return NextResponse.json({ error: `This request has already been ${discountRequest.status.toLowerCase()}.` }, { status: 400 })
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    const finalApprovedAmount = action === 'APPROVE' 
      ? String(approvedAmount !== undefined ? approvedAmount : discountRequest.requestedAmount)
      : null

    // Update the row
    const [updated] = await db
      .update(kiaBookingDiscounts)
      .set({
        status: newStatus,
        approvedAmount: finalApprovedAmount,
        actionBy: appUser.id,
        actionByName: appUser.fullName,
        actionRemarks: remarks || '',
        actionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(kiaBookingDiscounts.id, id))
      .returning()

    // Log booking activity
    const activityDesc = action === 'APPROVE'
      ? `Approved discount of INR ${Number(finalApprovedAmount).toLocaleString('en-IN')} (requested: INR ${Number(discountRequest.requestedAmount).toLocaleString('en-IN')}) by ${appUser.fullName}. Remarks: ${remarks || 'None'}.`
      : `Rejected discount request of INR ${Number(discountRequest.requestedAmount).toLocaleString('en-IN')} by ${appUser.fullName}. Remarks: ${remarks || 'None'}.`

    await db.insert(kiaBookingActivity).values({
      bookingId: discountRequest.bookingId,
      activityType: action === 'APPROVE' ? 'discount_approved' : 'discount_rejected',
      title: action === 'APPROVE' ? 'Discount Approved' : 'Discount Rejected',
      description: activityDesc,
      actorUserId: appUser.id,
      actorName: appUser.fullName,
      actorRole: appUser.role,
    })

    return NextResponse.json({ success: true, discount: updated })
  } catch (error) {
    console.error('Error acting on booking discount:', error)
    return NextResponse.json(
      {
        error: 'Failed to record action on booking discount',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
