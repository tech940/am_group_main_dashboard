import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaBookingDiscounts, kiaBookings, kiaBookingActivity } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  canActOnDiscountStage,
  discountStage,
  discountOverallStatus,
  requiresMdApproval,
  DISCOUNT_STAGE_LABEL,
  type DiscountStage,
} from '@/lib/kia/discount-chain'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/brands/kia/discounts/[id]/action
// Executes stage approval / rejection / payout on a KIA booking discount
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
    const {
      action, // 'approve' | 'reject' | 'payout'
      remarks,
      approvedAmount,
      payoutReference,
      payoutStatus,
    } = body

    if (!action || !['approve', 'reject', 'payout', 'hold'].includes(action)) {
      return NextResponse.json({ error: 'Valid action (approve, reject, payout, hold) is required.' }, { status: 400 })
    }

    const [discount] = await db
      .select()
      .from(kiaBookingDiscounts)
      .where(eq(kiaBookingDiscounts.id, id))
      .limit(1)

    if (!discount) {
      return NextResponse.json({ error: 'Discount request not found.' }, { status: 404 })
    }

    const currentStage = discountStage(discount)
    if (currentStage === 'done' || currentStage === 'rejected') {
      return NextResponse.json({ error: `This discount is already ${currentStage}.` }, { status: 400 })
    }

    if (!canActOnDiscountStage(appUser.role, currentStage)) {
      return NextResponse.json({
        error: `Forbidden. Your role (${appUser.role}) cannot act on the "${DISCOUNT_STAGE_LABEL[currentStage]}" stage.`,
      }, { status: 403 })
    }

    const now = new Date()
    const trimmedRemarks = String(remarks ?? '').trim()
    const updates: Partial<typeof kiaBookingDiscounts.$inferInsert> = {
      updatedAt: now,
    }

    let activityTitle = ''
    let activityDesc = ''

    if (currentStage === 'sales_manager') {
      if (action === 'approve') {
        updates.smStatus = 'APPROVED'
        updates.smBy = appUser.id
        updates.smByName = appUser.fullName
        updates.smRemarks = trimmedRemarks || null
        updates.smAt = now
        activityTitle = 'Discount Approved by GSM / SM'
        activityDesc = `GSM/SM ${appUser.fullName} approved discount request for ₹${Number(discount.requestedAmount).toLocaleString('en-IN')}. Moving to CEO approval.`
      } else if (action === 'hold') {
        updates.smStatus = 'HELD'
        updates.smBy = appUser.id
        updates.smByName = appUser.fullName
        updates.smRemarks = trimmedRemarks || null
        updates.smAt = now
        activityTitle = 'Discount Put on Hold by GSM / SM'
        activityDesc = `GSM/SM ${appUser.fullName} placed discount request on hold. Remarks: ${trimmedRemarks || 'None'}.`
      } else {
        updates.smStatus = 'REJECTED'
        updates.smBy = appUser.id
        updates.smByName = appUser.fullName
        updates.smRemarks = trimmedRemarks || null
        updates.smAt = now
        updates.status = 'REJECTED'
        activityTitle = 'Discount Rejected by GSM / SM'
        activityDesc = `GSM/SM ${appUser.fullName} rejected discount request. Remarks: ${trimmedRemarks || 'None'}.`
      }
    } else if (currentStage === 'ceo') {
      if (action === 'approve') {
        const finalAmt = approvedAmount ? String(Number(approvedAmount).toFixed(2)) : (discount.approvedAmount || discount.requestedAmount)
        updates.ceoStatus = 'APPROVED'
        updates.ceoBy = appUser.id
        updates.ceoByName = appUser.fullName
        updates.ceoRemarks = trimmedRemarks || null
        updates.ceoAt = now
        updates.ceoApprovedAmount = finalAmt
        updates.approvedAmount = finalAmt

        const needsMd = requiresMdApproval({
          requestedAmount: discount.requestedAmount,
          ceoApprovedAmount: finalAmt,
          approvedAmount: finalAmt,
        })
        const nextDesk = needsMd ? 'MD Approval (> ₹5,000)' : 'Accounts Payout'
        activityTitle = 'Discount Approved by CEO'
        activityDesc = `CEO ${appUser.fullName} approved discount for ₹${Number(finalAmt).toLocaleString('en-IN')}. Moving to ${nextDesk}.`
      } else if (action === 'hold') {
        updates.ceoStatus = 'HELD'
        updates.ceoBy = appUser.id
        updates.ceoByName = appUser.fullName
        updates.ceoRemarks = trimmedRemarks || null
        updates.ceoAt = now
        activityTitle = 'Discount Put on Hold by CEO'
        activityDesc = `CEO ${appUser.fullName} placed discount request on hold. Remarks: ${trimmedRemarks || 'None'}.`
      } else {
        updates.ceoStatus = 'REJECTED'
        updates.ceoBy = appUser.id
        updates.ceoByName = appUser.fullName
        updates.ceoRemarks = trimmedRemarks || null
        updates.ceoAt = now
        updates.status = 'REJECTED'
        activityTitle = 'Discount Rejected by CEO'
        activityDesc = `CEO ${appUser.fullName} rejected discount request. Remarks: ${trimmedRemarks || 'None'}.`
      }
    } else if (currentStage === 'md') {
      if (action === 'approve') {
        const finalAmt = approvedAmount
          ? String(Number(approvedAmount).toFixed(2))
          : (discount.ceoApprovedAmount || discount.approvedAmount || discount.requestedAmount)
        updates.mdStatus = 'APPROVED'
        updates.mdBy = appUser.id
        updates.mdByName = appUser.fullName
        updates.mdRemarks = trimmedRemarks || null
        updates.mdAt = now
        updates.mdApprovedAmount = finalAmt
        updates.approvedAmount = finalAmt
        activityTitle = 'Discount Approved by MD'
        activityDesc = `MD ${appUser.fullName} approved discount for ₹${Number(finalAmt).toLocaleString('en-IN')}. Moving to Accounts for payout.`
      } else if (action === 'hold') {
        updates.mdStatus = 'HELD'
        updates.mdBy = appUser.id
        updates.mdByName = appUser.fullName
        updates.mdRemarks = trimmedRemarks || null
        updates.mdAt = now
        activityTitle = 'Discount Put on Hold by MD'
        activityDesc = `MD ${appUser.fullName} placed discount request on hold. Remarks: ${trimmedRemarks || 'None'}.`
      } else {
        updates.mdStatus = 'REJECTED'
        updates.mdBy = appUser.id
        updates.mdByName = appUser.fullName
        updates.mdRemarks = trimmedRemarks || null
        updates.mdAt = now
        updates.status = 'REJECTED'
        activityTitle = 'Discount Rejected by MD'
        activityDesc = `MD ${appUser.fullName} rejected discount request. Remarks: ${trimmedRemarks || 'None'}.`
      }
    } else if (currentStage === 'accounts') {
      if (action === 'hold') {
        updates.payoutStatus = 'HELD'
        updates.payoutBy = appUser.id
        updates.payoutByName = appUser.fullName
        updates.payoutRemarks = trimmedRemarks || null
        updates.payoutAt = now
        activityTitle = 'Discount Payout Put on Hold'
        activityDesc = `Accounts ${appUser.fullName} placed discount payout on hold. Remarks: ${trimmedRemarks || 'None'}.`
      } else {
        const isPaid = action === 'approve' || action === 'payout' || String(payoutStatus).toUpperCase() === 'PAID'
        const statusValue = isPaid ? 'PAID' : 'NOT_PAID'
        updates.payoutStatus = statusValue
        updates.payoutBy = appUser.id
        updates.payoutByName = appUser.fullName
        updates.payoutRemarks = trimmedRemarks || null
        updates.payoutAt = now
        updates.payoutReference = payoutReference ? String(payoutReference).trim() : null
        updates.status = isPaid ? 'APPROVED' : 'REJECTED'

        activityTitle = isPaid ? 'Discount Payout Confirmed' : 'Discount Payout Declined'
        activityDesc = `Accounts ${appUser.fullName} marked discount as ${statusValue}. Reference: ${updates.payoutReference || 'None'}. Remarks: ${trimmedRemarks || 'None'}.`
      }
    }

    // Determine overall status
    const hypothetical = {
      ...discount,
      ...updates,
    }
    updates.status = discountOverallStatus(hypothetical)

    const [updated] = await db
      .update(kiaBookingDiscounts)
      .set(updates)
      .where(eq(kiaBookingDiscounts.id, id))
      .returning()

    // Log to booking activity
    if (discount.bookingId) {
      await db.insert(kiaBookingActivity).values({
        bookingId: discount.bookingId,
        activityType: 'discount_status_change',
        title: activityTitle,
        description: activityDesc,
        actorUserId: appUser.id,
        actorName: appUser.fullName,
        actorRole: appUser.role,
      }).catch((e) => console.warn('Activity log failed:', e))
    }

    const nextStage = discountStage(updated)

    return NextResponse.json({
      success: true,
      discount: updated,
      currentStage: nextStage,
      stageLabel: DISCOUNT_STAGE_LABEL[nextStage],
    })
  } catch (error) {
    console.error('Error executing discount action:', error)
    return NextResponse.json(
      {
        error: 'Failed to process discount action',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
