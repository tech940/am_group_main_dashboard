import { NextRequest, NextResponse } from 'next/server'
import { and, inArray, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { purchaseOrders, workflowHistory } from '@/lib/db/schema'
import {
  canApproveEa,
  canApproveMd,
  canReadPurchaseOrder,
} from '@/lib/purchase-orders/access'

type SupportedBulkStage = 'ea_approval' | 'md_approval'

function resolveBulkStage(role: string, requestedStage?: string): SupportedBulkStage | null {
  if (requestedStage === 'ea_approval' || requestedStage === 'md_approval') {
    return requestedStage
  }

  if (role === 'ea') {
    return 'ea_approval'
  }

  if (role === 'md') {
    return 'md_approval'
  }

  return null
}

export async function POST(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { orderIds, action, remarks, stage } = body as {
      orderIds?: string[]
      action?: string
      remarks?: string
      stage?: string
    }

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: 'Order IDs array is required' }, { status: 400 })
    }

    if (action !== 'approve' && action !== 'deny' && action !== 'hold') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const bulkStage = resolveBulkStage(appUser.role, stage)
    if (!bulkStage) {
      return NextResponse.json({ error: 'Unsupported bulk approval stage' }, { status: 400 })
    }

    if (bulkStage === 'ea_approval' && !canApproveEa(appUser.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    if (bulkStage === 'md_approval' && !canApproveMd(appUser.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const orders = await db
      .select()
      .from(purchaseOrders)
      .where(and(inArray(purchaseOrders.id, orderIds), isNull(purchaseOrders.deletedAt)))

    const visibleOrders = orders.filter((order) => canReadPurchaseOrder(appUser, order))
    if (visibleOrders.length === 0) {
      return NextResponse.json({ error: 'No accessible purchase orders found' }, { status: 404 })
    }

    const expectedStatuses = bulkStage === 'ea_approval'
      ? ['awaiting_ea_approval', 'ea_denied', 'ea_on_hold', 'md_denied', 'md_on_hold']
      : ['awaiting_md_approval', 'md_denied', 'md_on_hold']
    const eligibleOrders = visibleOrders.filter((order) => expectedStatuses.includes(order.status))

    if (eligibleOrders.length === 0) {
      return NextResponse.json({ error: `No orders are currently awaiting ${bulkStage === 'ea_approval' ? 'EA' : 'MD'} approval` }, { status: 409 })
    }

    const now = new Date()
    const orderIdsToUpdate = eligibleOrders.map((order) => order.id)
    let updateSet: Partial<typeof purchaseOrders.$inferInsert>

    if (bulkStage === 'ea_approval') {
      updateSet = {
        updatedAt: now,
        eaApprovalStatus: action === 'approve' ? 'approved' : action === 'deny' ? 'denied' : 'pending',
        eaApprovedBy: action === 'hold' ? null : appUser.id,
        eaApprovedAt: action === 'hold' ? null : now,
        eaApprovalRemarks: remarks || null,
        mdApprovalStatus: action === 'approve' ? 'pending' : null,
        mdApprovedBy: null,
        mdApprovedAt: null,
        mdApprovalRemarks: null,
        rejectedAt: action === 'deny' ? now : null,
        eaHeldAt: action === 'hold' ? now : null,
        eaHeldBy: action === 'hold' ? appUser.id : null,
        holdRemarks: action === 'hold' ? remarks || null : null,
        status: action === 'approve' ? 'awaiting_md_approval' : action === 'deny' ? 'ea_denied' : 'ea_on_hold',
        currentStage: action === 'approve' ? 'md_approval' : 'ea_approval',
      }
    } else {
      updateSet = {
        updatedAt: now,
        mdApprovalStatus: action === 'approve' ? 'approved' : action === 'deny' ? 'denied' : 'pending',
        mdApprovedBy: action === 'hold' ? null : appUser.id,
        mdApprovedAt: action === 'hold' ? null : now,
        mdApprovalRemarks: action === 'hold' ? null : remarks || null,
        rejectedAt: action === 'deny' ? now : null,
        mdHeldAt: action === 'hold' ? now : null,
        mdHeldBy: action === 'hold' ? appUser.id : null,
        holdRemarks: action === 'hold' ? remarks || null : null,
        status: action === 'approve' ? 'awaiting_grn' : action === 'deny' ? 'md_denied' : 'md_on_hold',
        currentStage: action === 'approve' ? 'grn' : 'md_approval',
      }
    }

    const updatedOrders = await db
      .update(purchaseOrders)
      .set(updateSet)
      .where(and(
        inArray(purchaseOrders.id, orderIdsToUpdate),
        inArray(purchaseOrders.status, eligibleOrders.map((order) => order.status))
      ))
      .returning()

    await db
      .insert(workflowHistory)
      .values(
        updatedOrders.map((order) => ({
          purchaseOrderId: order.id,
          action,
          stage: bulkStage,
          performedBy: appUser.id,
          userRole: appUser.role,
          remarks: remarks || null,
          previousStatus: eligibleOrders.find((eligibleOrder) => eligibleOrder.id === order.id)?.status || null,
          newStatus: order.status,
          metadata: {
            bulkAction: true,
            totalOrders: updatedOrders.length,
          },
        }))
      )

    const actionLabel = action === 'approve' ? 'approved' : action === 'deny' ? 'denied' : 'held'

    return NextResponse.json({
      message: `Successfully ${actionLabel} ${updatedOrders.length} orders`,
      data: updatedOrders,
      count: updatedOrders.length,
    })
  } catch (error) {
    console.error('Error in POST /api/purchase-orders/bulk-approve:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
