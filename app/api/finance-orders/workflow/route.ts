import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { financeOrderComments, financeOrders, financeOrderWorkflow, users } from '@/lib/db/schema'
import { serializeUtcTimestampFields } from '@/lib/date-time'
import { canApproveFinanceEa, canApproveFinanceMd, canReadFinanceOrder, canVerifyFinanceAccounts } from '@/lib/finance-orders/access'
import { createFinanceOrderWorkflowNotifications } from '@/lib/notifications/finance-workflow'

export const dynamic = 'force-dynamic'

const WORKFLOW_UTC_FIELDS = ['createdAt'] as const
type FinanceOrderInsert = typeof financeOrders.$inferInsert
type FinanceWorkflowEvent =
  | 'finance_order_submitted'
  | 'accounts_verified'
  | 'accounts_denied'
  | 'accounts_held'
  | 'ea_approved'
  | 'ea_denied'
  | 'ea_held'
  | 'md_approved'
  | 'md_denied'
  | 'md_held'

function serializeWorkflowRow(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...WORKFLOW_UTC_FIELDS])
}

function getRemarks(value: unknown) {
  return String(value || '').trim()
}

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const orderId = request.nextUrl.searchParams.get('orderId')
    if (!orderId) return NextResponse.json({ error: 'Finance order ID is required' }, { status: 400 })

    const [order] = await db
      .select()
      .from(financeOrders)
      .where(and(eq(financeOrders.id, orderId), isNull(financeOrders.deletedAt)))
      .limit(1)

    if (!order || !canReadFinanceOrder(appUser, order)) {
      return NextResponse.json({ error: 'Finance order not found' }, { status: 404 })
    }

    const rows = await db
      .select({
        id: financeOrderWorkflow.id,
        action: financeOrderWorkflow.action,
        stage: financeOrderWorkflow.stage,
        performedBy: financeOrderWorkflow.performedBy,
        userRole: financeOrderWorkflow.userRole,
        remarks: financeOrderWorkflow.remarks,
        previousStatus: financeOrderWorkflow.previousStatus,
        newStatus: financeOrderWorkflow.newStatus,
        metadata: financeOrderWorkflow.metadata,
        createdAt: financeOrderWorkflow.createdAt,
        actorName: users.fullName,
        actorEmail: users.email,
      })
      .from(financeOrderWorkflow)
      .leftJoin(users, eq(financeOrderWorkflow.performedBy, users.id))
      .where(eq(financeOrderWorkflow.financeOrderId, orderId))
      .orderBy(asc(financeOrderWorkflow.createdAt))

    return NextResponse.json({ history: rows.map(serializeWorkflowRow) })
  } catch (error) {
    console.error('Error in GET /api/finance-orders/workflow:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as Record<string, unknown>
    const orderId = String(body.orderId || '').trim()
    const action = String(body.action || '').trim()
    const remarks = getRemarks(body.remarks)

    if (!orderId) return NextResponse.json({ error: 'Finance order ID is required' }, { status: 400 })
    if (!['approve', 'hold', 'deny'].includes(action)) return NextResponse.json({ error: 'Invalid workflow action' }, { status: 400 })
    if ((action === 'hold' || action === 'deny') && !remarks) {
      return NextResponse.json({ error: 'Remarks are required for hold and deny actions' }, { status: 400 })
    }

    const [order] = await db
      .select()
      .from(financeOrders)
      .where(and(eq(financeOrders.id, orderId), isNull(financeOrders.deletedAt)))
      .limit(1)

    if (!order || !canReadFinanceOrder(appUser, order)) {
      return NextResponse.json({ error: 'Finance order not found' }, { status: 404 })
    }

    const isAccountsStage = order.status === 'awaiting_accounts_verification' || order.status === 'accounts_on_hold'
    const isEaStage = order.status === 'awaiting_ea_approval' || order.status === 'ea_on_hold'
    const isMdStage = order.status === 'awaiting_md_approval' || order.status === 'md_on_hold'
    if (isAccountsStage && !canVerifyFinanceAccounts(appUser.role)) {
      return NextResponse.json({ error: 'Only Accounts can verify payment received for this finance order' }, { status: 403 })
    }
    if (isEaStage && !canApproveFinanceEa(appUser.role)) {
      return NextResponse.json({ error: 'Only EA can act on this finance order' }, { status: 403 })
    }
    if (isMdStage && !canApproveFinanceMd(appUser.role)) {
      return NextResponse.json({ error: 'Only MD can act on this finance order' }, { status: 403 })
    }
    if (!isAccountsStage && !isEaStage && !isMdStage) {
      return NextResponse.json({ error: 'This finance order is not in an approval queue' }, { status: 409 })
    }

    const now = new Date()
    let updateData: Partial<FinanceOrderInsert> = { updatedAt: now }
    let event: FinanceWorkflowEvent
    let newStatus = order.status
    let newStage = order.currentStage
    const stage = isAccountsStage ? 'accounts_verification' : isEaStage ? 'ea_approval' : 'md_approval'

    if (isAccountsStage) {
      if (action === 'approve') {
        newStatus = 'awaiting_ea_approval'
        newStage = 'ea_approval'
        event = 'accounts_verified'
        updateData = {
          ...updateData,
          status: newStatus,
          currentStage: newStage,
          accountsVerificationStatus: 'received',
          accountsVerifiedBy: appUser.id,
          accountsVerifiedAt: now,
          accountsVerificationRemarks: remarks || null,
          accountsHeldAt: null,
          accountsHeldBy: null,
          holdRemarks: null,
        }
      } else if (action === 'hold') {
        newStatus = 'accounts_on_hold'
        event = 'accounts_held'
        updateData = {
          ...updateData,
          status: newStatus,
          currentStage: 'accounts_verification',
          accountsVerificationStatus: 'hold',
          accountsHeldAt: now,
          accountsHeldBy: appUser.id,
          holdRemarks: remarks,
        }
      } else {
        newStatus = 'accounts_denied'
        newStage = 'finance_head_submission'
        event = 'accounts_denied'
        updateData = {
          ...updateData,
          status: newStatus,
          currentStage: newStage,
          accountsVerificationStatus: 'denied',
          accountsVerifiedBy: appUser.id,
          accountsVerifiedAt: now,
          accountsVerificationRemarks: remarks,
          rejectedAt: now,
        }
      }
    } else if (isEaStage) {
      if (action === 'approve') {
        newStatus = 'awaiting_md_approval'
        newStage = 'md_approval'
        event = 'ea_approved'
        updateData = {
          ...updateData,
          status: newStatus,
          currentStage: newStage,
          eaApprovalStatus: 'approved',
          eaApprovedBy: appUser.id,
          eaApprovedAt: now,
          eaApprovalRemarks: remarks || null,
          eaHeldAt: null,
          eaHeldBy: null,
          holdRemarks: null,
        }
      } else if (action === 'hold') {
        newStatus = 'ea_on_hold'
        event = 'ea_held'
        updateData = {
          ...updateData,
          status: newStatus,
          currentStage: 'ea_approval',
          eaApprovalStatus: 'hold',
          eaHeldAt: now,
          eaHeldBy: appUser.id,
          holdRemarks: remarks,
        }
      } else {
        newStatus = 'ea_denied'
        newStage = 'finance_head_submission'
        event = 'ea_denied'
        updateData = {
          ...updateData,
          status: newStatus,
          currentStage: newStage,
          eaApprovalStatus: 'denied',
          eaApprovedBy: appUser.id,
          eaApprovedAt: now,
          eaApprovalRemarks: remarks,
          rejectedAt: now,
        }
      }
    } else if (action === 'approve') {
      newStatus = 'completed'
      newStage = 'completed'
      event = 'md_approved'
      updateData = {
        ...updateData,
        status: newStatus,
        currentStage: newStage,
        mdApprovalStatus: 'approved',
        mdApprovedBy: appUser.id,
        mdApprovedAt: now,
        mdApprovalRemarks: remarks || null,
        mdHeldAt: null,
        mdHeldBy: null,
        holdRemarks: null,
        completedAt: now,
      }
    } else if (action === 'hold') {
      newStatus = 'md_on_hold'
      event = 'md_held'
      updateData = {
        ...updateData,
        status: newStatus,
        currentStage: 'md_approval',
        mdApprovalStatus: 'hold',
        mdHeldAt: now,
        mdHeldBy: appUser.id,
        holdRemarks: remarks,
      }
    } else {
      newStatus = 'md_denied'
      newStage = 'finance_head_submission'
      event = 'md_denied'
      updateData = {
        ...updateData,
        status: newStatus,
        currentStage: newStage,
        mdApprovalStatus: 'denied',
        mdApprovedBy: appUser.id,
        mdApprovedAt: now,
        mdApprovalRemarks: remarks,
        rejectedAt: now,
      }
    }

    const [updatedOrder] = await db
      .update(financeOrders)
      .set(updateData)
      .where(eq(financeOrders.id, order.id))
      .returning()

    const [historyEntry] = await db.insert(financeOrderWorkflow).values({
      financeOrderId: order.id,
      performedBy: appUser.id,
      userRole: appUser.role,
      action,
      stage,
      previousStatus: order.status,
      newStatus,
      remarks: remarks || null,
      metadata: { resultingStage: newStage },
    }).returning({ id: financeOrderWorkflow.id, remarks: financeOrderWorkflow.remarks })

    if (remarks) {
      await db.insert(financeOrderComments).values({
        financeOrderId: order.id,
        userId: appUser.id,
        comment: remarks,
      })
    }

    await createFinanceOrderWorkflowNotifications({
      event,
      order: updatedOrder,
      actor: appUser,
      historyEntry,
    })

    return NextResponse.json({
      success: true,
      orderId: order.id,
      newStatus,
      newStage,
    })
  } catch (error) {
    console.error('Error in POST /api/finance-orders/workflow:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
