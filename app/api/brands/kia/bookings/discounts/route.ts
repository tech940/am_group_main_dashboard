import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaBookingDiscounts, kiaBookings } from '@/lib/db/schema'
import { eq, desc, and, or, ilike } from 'drizzle-orm'
import {
  discountStage,
  canActOnDiscountStage,
  DISCOUNT_STAGE_LABEL,
  requiresMdApproval,
  type DiscountStage,
} from '@/lib/kia/discount-chain'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/brands/kia/bookings/discounts
// Returns a list of all discount requests across all bookings enriched with stage & permission metadata
export async function GET(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const allowedRoles = [
      'md', 'ceo', 'ed', 'ea', 'eba', 'developer', 'admin',
      'sales_manager', 'general_manager', 'sales_head',
      'accounts', 'accounts_head', 'accounts_team', 'finance_head', 'finance_team',
    ]
    if (!allowedRoles.includes(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden. You do not have permission to view discount requests.' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status')
    const stageFilter = searchParams.get('stage')
    const search = (searchParams.get('search') || '').trim()

    let query = db
      .select({
        id: kiaBookingDiscounts.id,
        bookingId: kiaBookingDiscounts.bookingId,
        requestedAmount: kiaBookingDiscounts.requestedAmount,
        approvedAmount: kiaBookingDiscounts.approvedAmount,
        discountType: kiaBookingDiscounts.discountType,
        reason: kiaBookingDiscounts.reason,
        status: kiaBookingDiscounts.status,
        requestedBy: kiaBookingDiscounts.requestedBy,
        requestedByName: kiaBookingDiscounts.requestedByName,
        smStatus: kiaBookingDiscounts.smStatus,
        smByName: kiaBookingDiscounts.smByName,
        smRemarks: kiaBookingDiscounts.smRemarks,
        smAt: kiaBookingDiscounts.smAt,
        ceoStatus: kiaBookingDiscounts.ceoStatus,
        ceoByName: kiaBookingDiscounts.ceoByName,
        ceoRemarks: kiaBookingDiscounts.ceoRemarks,
        ceoAt: kiaBookingDiscounts.ceoAt,
        ceoApprovedAmount: kiaBookingDiscounts.ceoApprovedAmount,
        mdStatus: kiaBookingDiscounts.mdStatus,
        mdByName: kiaBookingDiscounts.mdByName,
        mdRemarks: kiaBookingDiscounts.mdRemarks,
        mdAt: kiaBookingDiscounts.mdAt,
        mdApprovedAmount: kiaBookingDiscounts.mdApprovedAmount,
        payoutStatus: kiaBookingDiscounts.payoutStatus,
        payoutByName: kiaBookingDiscounts.payoutByName,
        payoutRemarks: kiaBookingDiscounts.payoutRemarks,
        payoutAt: kiaBookingDiscounts.payoutAt,
        payoutReference: kiaBookingDiscounts.payoutReference,
        vehicleSnapshot: kiaBookingDiscounts.vehicleSnapshot,
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

    const filters = []
    if (statusFilter && statusFilter !== 'all') {
      filters.push(eq(kiaBookingDiscounts.status, statusFilter))
    }
    if (search) {
      filters.push(or(
        ilike(kiaBookings.bookingNumber, `%${search}%`),
        ilike(kiaBookings.customerName, `%${search}%`),
        ilike(kiaBookings.customerPhone, `%${search}%`),
        ilike(kiaBookings.consultantName, `%${search}%`),
        ilike(kiaBookings.dealerCode, `%${search}%`),
        ilike(kiaBookingDiscounts.discountType, `%${search}%`)
      )!)
    }

    if (filters.length > 0) {
      // @ts-ignore
      query = query.where(and(...filters))
    }

    // @ts-ignore
    const rows = await query.orderBy(desc(kiaBookingDiscounts.createdAt))

    // Enrich rows with stage and permission info
    const enriched = rows.map((r) => {
      const stage = discountStage({
        requestedAmount: r.requestedAmount,
        approvedAmount: r.approvedAmount,
        smStatus: r.smStatus,
        ceoStatus: r.ceoStatus,
        ceoApprovedAmount: r.ceoApprovedAmount,
        mdStatus: r.mdStatus,
        mdApprovedAmount: r.mdApprovedAmount,
        payoutStatus: r.payoutStatus,
      })
      const isHighValue = requiresMdApproval({
        requestedAmount: r.requestedAmount,
        ceoApprovedAmount: r.ceoApprovedAmount,
        approvedAmount: r.approvedAmount,
      })
      const canAct = canActOnDiscountStage(appUser.role, stage)

      return {
        ...r,
        stage,
        stageLabel: DISCOUNT_STAGE_LABEL[stage],
        isHighValue,
        canAct,
      }
    })

    const filtered = stageFilter && stageFilter !== 'all'
      ? enriched.filter((item) => item.stage === stageFilter)
      : enriched

    return NextResponse.json({
      success: true,
      discounts: filtered,
      rows: filtered,
      totalCount: rows.length,
    })
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
