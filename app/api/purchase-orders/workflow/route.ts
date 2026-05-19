import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { purchaseOrders, users, workflowHistory } from '@/lib/db/schema'
import { getIndiaDatePart, parseIndiaLocalDateTime, serializeUtcTimestampFields } from '@/lib/date-time'
import { createPurchaseOrderWorkflowNotifications } from '@/lib/notifications/workflow'
import { isBranchValue } from '@/lib/branches'
import {
  canMutatePurchaseOrderStage,
  canReadPurchaseOrder,
} from '@/lib/purchase-orders/access'

type PurchaseOrderRecord = typeof purchaseOrders.$inferSelect
type PurchaseOrderInsert = typeof purchaseOrders.$inferInsert
type WorkflowHistoryInsert = typeof workflowHistory.$inferInsert
type VendorOptionKey = 'vendorA' | 'vendorB' | 'vendorC'

const PURCHASE_ORDER_UTC_TIMESTAMP_FIELDS = [
  'createdAt',
  'updatedAt',
  'completedAt',
  'deletedAt',
  'eaApprovedAt',
  'mdApprovedAt',
] as const

const WORKFLOW_HISTORY_UTC_TIMESTAMP_FIELDS = ['createdAt'] as const

function serializeWorkflowOrder(order: Record<string, unknown>) {
  return serializeUtcTimestampFields(order, [...PURCHASE_ORDER_UTC_TIMESTAMP_FIELDS])
}

function serializeWorkflowHistoryItem(item: Record<string, unknown>) {
  return serializeUtcTimestampFields(item, [...WORKFLOW_HISTORY_UTC_TIMESTAMP_FIELDS])
}

function canUpdateVendorInformation(order: PurchaseOrderRecord) {
  return !['completed', 'cancelled'].includes(order.status)
}

function normalizeVendorOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item, index) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const fallbackKey: VendorOptionKey = index === 1 ? 'vendorB' : index === 2 ? 'vendorC' : 'vendorA'
    const key: VendorOptionKey = record.key === 'vendorA' || record.key === 'vendorB' || record.key === 'vendorC'
      ? record.key
      : fallbackKey
    const fallbackLabel = index === 1 ? 'Vendor B' : index === 2 ? 'Vendor C' : 'Vendor A'
    const images = Array.isArray(record.images)
      ? record.images.filter((image): image is string => typeof image === 'string' && image.length > 0)
      : []

    return {
      key,
      label: typeof record.label === 'string' ? record.label : fallbackLabel,
      name: typeof record.name === 'string' ? record.name.trim() : '',
      images,
    }
  }).filter((vendor) => vendor.name || vendor.images.length > 0)
}

function assertStagePermission(roleAllowed: boolean, message = 'Unauthorized for this stage') {
  if (!roleAllowed) {
    return NextResponse.json({ error: message }, { status: 403 })
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
    const { orderId, action, stage, data: formData = {} } = body as {
      orderId?: string
      action?: string
      stage?: string
      data?: Record<string, unknown>
    }

    if (!stage || typeof stage !== 'string') {
      return NextResponse.json({ error: 'Workflow stage is required' }, { status: 400 })
    }

    if (!canMutatePurchaseOrderStage(appUser, stage)) {
      return NextResponse.json({ error: 'Unauthorized for this workflow action' }, { status: 403 })
    }

    // Remarks are now optional for deny and hold actions
    // Removed mandatory remarks validation

    if (stage === 'initial_submission' && !orderId) {
      let orderNumber: string

      try {
        const datepart = getIndiaDatePart()
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
        orderNumber = `PO-${datepart}-${random}`
      } catch (error) {
        console.warn('Fallback order number generation failed, retrying with date-based key:', error)
        const datepart = getIndiaDatePart()
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
        orderNumber = `PO-${datepart}-${random}`
      }

      const branch = isBranchValue(formData.branch) ? formData.branch : null
      if (!branch) {
        return NextResponse.json({ error: 'Branch is required' }, { status: 400 })
      }

      const newOrderValues: PurchaseOrderInsert = {
        orderNumber,
        createdBy: appUser.id,
        assignedTo: appUser.role === 'purchase_manager' ? appUser.id : null,
        brand: branch,
        currentStage: 'ea_approval',
        status: 'awaiting_ea_approval',
        department: String(formData.department || ''),
        subDepartment: String(formData.subDepartment || ''),
        specifyOther: formData.specifyOther ? String(formData.specifyOther) : null,
        requestedBy: formData.requestedBy ? String(formData.requestedBy) : appUser.fullName,
        specialInstructions: formData.specialInstructions ? String(formData.specialInstructions) : null,
        quantityRequired: formData.quantityRequired ? String(formData.quantityRequired) : null,
        estimateIfAny: formData.estimateIfAny ? String(formData.estimateIfAny) : null,
        supportingImages: [],
      }

      const [newOrder] = await db.insert(purchaseOrders).values(newOrderValues).returning()

      const [historyEntry] = await db
        .insert(workflowHistory)
        .values({
          purchaseOrderId: newOrder.id,
          performedBy: appUser.id,
          userRole: appUser.role,
          action: 'submit',
          stage: 'initial_submission',
          previousStatus: null,
          newStatus: 'awaiting_ea_approval',
          remarks: formData.specialInstructions ? String(formData.specialInstructions) : null,
          metadata: {
            ...formData,
            branch,
            resultingStage: 'ea_approval',
          },
        })
        .returning({
          id: workflowHistory.id,
          remarks: workflowHistory.remarks,
        })

      await createPurchaseOrderWorkflowNotifications({
        event: 'initial_submission_submitted',
        order: newOrder,
        actor: {
          id: appUser.id,
          role: appUser.role,
          brand: appUser.brand,
          fullName: appUser.fullName,
          email: appUser.email,
        },
        historyEntry,
      })

      return NextResponse.json({
        success: true,
        message: 'Purchase order created successfully',
        orderId: newOrder.id,
        orderNumber: newOrder.orderNumber,
        newStage: 'ea_approval',
        newStatus: 'awaiting_ea_approval',
      })
    }

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required for this stage' }, { status: 400 })
    }

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, orderId), isNull(purchaseOrders.deletedAt)))
      .limit(1)

    if (!order || !canReadPurchaseOrder(appUser, order)) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    let updateData: Partial<PurchaseOrderInsert> = { updatedAt: new Date() }
    let newStatus = order.status
    let newStage = order.currentStage
    const historyStage = stage
    let notificationEvent:
      | 'vendor_information_submitted'
      | 'ea_approved'
      | 'ea_denied'
      | 'ea_held'
      | 'md_approved'
      | 'md_denied'
      | 'md_held'
      | 'grn_submitted'
      | null = null

    switch (stage) {
      case 'initial_submission': {
        if (['completed', 'cancelled'].includes(order.status)) {
          return NextResponse.json({ error: 'Completed or cancelled orders cannot be edited' }, { status: 409 })
        }

        const branch = isBranchValue(formData.branch) ? formData.branch : order.brand

        updateData = {
          ...updateData,
          brand: branch,
          department: formData.department ? String(formData.department) : order.department,
          subDepartment: formData.subDepartment ? String(formData.subDepartment) : order.subDepartment,
          specifyOther: formData.specifyOther ? String(formData.specifyOther) : null,
          requestedBy: formData.requestedBy ? String(formData.requestedBy) : order.requestedBy,
          specialInstructions: formData.specialInstructions ? String(formData.specialInstructions) : order.specialInstructions,
          quantityRequired: formData.quantityRequired ? String(formData.quantityRequired) : order.quantityRequired,
          estimateIfAny: formData.estimateIfAny ? String(formData.estimateIfAny) : order.estimateIfAny,
          supportingImages: order.supportingImages,
          currentStage: order.currentStage || 'ea_approval',
          status: order.status || 'awaiting_ea_approval',
        }
        newStage = updateData.currentStage || order.currentStage
        newStatus = updateData.status || order.status
        break
      }
      case 'vendor_information': {
        const stagePermissionError = assertStagePermission(canUpdateVendorInformation(order))
        if (stagePermissionError) {
          return stagePermissionError
        }

        const shouldAdvanceLegacyVendorFlow =
          order.currentStage === 'vendor_information' || order.status === 'vendor_info_pending'

        const vendorOptions = normalizeVendorOptions(formData.vendorOptions)
        const vendorName = formData.vendorName
          ? String(formData.vendorName)
          : vendorOptions.map((vendor) => vendor.name).filter(Boolean).join(', ')
        const vendorImages = Array.isArray(formData.vendorImages)
          ? formData.vendorImages.filter((value): value is string => typeof value === 'string')
          : vendorOptions.flatMap((vendor) => vendor.images)

        updateData = {
          ...updateData,
          vendorName: vendorName || order.vendorName,
          vendorImages: vendorImages.length > 0 ? vendorImages : order.vendorImages,
          vendorDetails: vendorOptions.length > 0 ? vendorOptions : order.vendorDetails,
          currentStage: shouldAdvanceLegacyVendorFlow ? 'ea_approval' : order.currentStage,
          status: shouldAdvanceLegacyVendorFlow ? 'awaiting_ea_approval' : order.status,
          assignedTo: order.assignedTo || appUser.id,
        }
        newStage = updateData.currentStage || order.currentStage
        newStatus = updateData.status || order.status
        notificationEvent = shouldAdvanceLegacyVendorFlow ? 'vendor_information_submitted' : null
        break
      }
      case 'ea_approval': {
        if (!['awaiting_ea_approval', 'ea_denied', 'md_denied', 'ea_on_hold', 'md_on_hold'].includes(order.status)) {
          return NextResponse.json({ error: 'This order is not awaiting EA approval' }, { status: 409 })
        }

        if (action === 'approve') {
          updateData = {
            ...updateData,
            eaApprovalStatus: 'approved',
            eaApprovedBy: appUser.id,
            eaApprovedAt: new Date(),
            eaApprovalRemarks: formData.remarks ? String(formData.remarks) : null,
            mdApprovalStatus: ['md_denied', 'md_on_hold'].includes(order.status) ? 'pending' : order.mdApprovalStatus,
            rejectedAt: null,
            eaHeldAt: null,
            eaHeldBy: null,
            mdHeldAt: null,
            mdHeldBy: null,
            holdRemarks: null,
            currentStage: 'md_approval',
            status: 'awaiting_md_approval',
          }
          newStage = 'md_approval'
          newStatus = 'awaiting_md_approval'
          notificationEvent = 'ea_approved'
        } else if (action === 'deny') {
          updateData = {
            ...updateData,
            eaApprovalStatus: 'denied',
            eaApprovedBy: appUser.id,
            eaApprovedAt: new Date(),
            eaApprovalRemarks: formData.remarks ? String(formData.remarks).trim() : null,
            rejectedAt: new Date(),
            eaHeldAt: null,
            eaHeldBy: null,
            holdRemarks: null,
            currentStage: 'ea_approval',
            status: 'ea_denied',
          }
          newStage = 'ea_approval'
          newStatus = 'ea_denied'
          notificationEvent = 'ea_denied'
        } else if (action === 'hold') {
          updateData = {
            ...updateData,
            eaApprovalStatus: 'pending',
            eaApprovedBy: null,
            eaApprovedAt: null,
            rejectedAt: null,
            eaHeldAt: new Date(),
            eaHeldBy: appUser.id,
            holdRemarks: formData.remarks ? String(formData.remarks).trim() : null,
            currentStage: 'ea_approval',
            status: 'ea_on_hold',
          }
          newStage = 'ea_approval'
          newStatus = 'ea_on_hold'
          notificationEvent = 'ea_held'
        } else {
          return NextResponse.json({ error: 'Invalid action for EA approval' }, { status: 400 })
        }
        break
      }
      case 'md_approval': {
        if (!['awaiting_md_approval', 'md_denied', 'md_on_hold'].includes(order.status)) {
          return NextResponse.json({ error: 'This order is not awaiting MD approval' }, { status: 409 })
        }

        if (action === 'approve') {
          updateData = {
            ...updateData,
            mdApprovalStatus: 'approved',
            mdApprovedBy: appUser.id,
            mdApprovedAt: new Date(),
            mdApprovalRemarks: formData.remarks ? String(formData.remarks) : null,
            rejectedAt: null,
            mdHeldAt: null,
            mdHeldBy: null,
            holdRemarks: null,
            currentStage: 'grn',
            status: 'awaiting_grn',
          }
          newStage = 'grn'
          newStatus = 'awaiting_grn'
          notificationEvent = 'md_approved'
        } else if (action === 'deny') {
          updateData = {
            ...updateData,
            mdApprovalStatus: 'denied',
            mdApprovedBy: appUser.id,
            mdApprovedAt: new Date(),
            mdApprovalRemarks: formData.remarks ? String(formData.remarks).trim() : null,
            rejectedAt: new Date(),
            mdHeldAt: null,
            mdHeldBy: null,
            holdRemarks: null,
            currentStage: 'ea_approval',
            status: 'md_denied',
          }
          newStage = 'ea_approval'
          newStatus = 'md_denied'
          notificationEvent = 'md_denied'
        } else if (action === 'hold') {
          updateData = {
            ...updateData,
            mdApprovalStatus: 'pending',
            mdApprovedBy: null,
            mdApprovedAt: null,
            rejectedAt: null,
            mdHeldAt: new Date(),
            mdHeldBy: appUser.id,
            holdRemarks: formData.remarks ? String(formData.remarks).trim() : null,
            currentStage: 'md_approval',
            status: 'md_on_hold',
          }
          newStage = 'md_approval'
          newStatus = 'md_on_hold'
          notificationEvent = 'md_held'
        } else {
          return NextResponse.json({ error: 'Invalid action for MD approval' }, { status: 400 })
        }
        break
      }
      case 'grn': {
        if (order.status !== 'awaiting_grn') {
          return NextResponse.json({ error: 'This order is not awaiting GRN submission' }, { status: 409 })
        }

        updateData = {
          ...updateData,
          receivedDateTime: formData.receivedDateTime && formData.receivedTime
            ? parseIndiaLocalDateTime(String(formData.receivedDateTime), String(formData.receivedTime))
            : order.receivedDateTime,
          handoverTo: formData.handoverTo ? String(formData.handoverTo) : order.handoverTo,
          remarksIfAny: formData.remarksIfAny ? String(formData.remarksIfAny) : null,
          amount: formData.amount ? String(formData.amount) : order.amount,
          grnImages: Array.isArray(formData.grnImages)
            ? formData.grnImages.filter((value): value is string => typeof value === 'string')
            : order.grnImages,
          currentStage: 'accounts',
          status: 'awaiting_accounts',
        }
        newStage = 'accounts'
        newStatus = 'awaiting_accounts'
        notificationEvent = 'grn_submitted'
        break
      }
      case 'accounts': {
        if (order.status !== 'awaiting_accounts') {
          return NextResponse.json({ error: 'This order is not awaiting accounts processing' }, { status: 409 })
        }

        const details: string[] = []
        if (formData.invoiceNumber) details.push(`Invoice Number: ${String(formData.invoiceNumber)}`)
        if (formData.invoiceDate) details.push(`Invoice Date: ${String(formData.invoiceDate)}`)
        if (formData.transactionReference) details.push(`Reference: ${String(formData.transactionReference)}`)
        if (formData.accountsRemarks) details.push(`Remarks: ${String(formData.accountsRemarks)}`)

        const paymentMode = formData.paymentMode
        const normalizedPaymentMode =
          paymentMode === 'bank_transfer'
          || paymentMode === 'cash'
          || paymentMode === 'credit_card'
          || paymentMode === 'cheque'
          || paymentMode === 'upi'
          || paymentMode === 'other'
            ? paymentMode
            : order.paymentMode

        updateData = {
          ...updateData,
          amount: formData.actualAmount ? String(formData.actualAmount) : order.amount,
          paymentStatus: formData.paymentStatus ? String(formData.paymentStatus) : order.paymentStatus,
          paymentMode: normalizedPaymentMode,
          accountRemarks: details.length > 0 ? details.join('\n') : order.accountRemarks,
          accountsImages: Array.isArray(formData.accountsImages)
            ? formData.accountsImages.filter((value): value is string => typeof value === 'string')
            : order.accountsImages,
          completedAt: new Date(),
          currentStage: 'accounts',
          status: 'completed',
        }
        newStage = 'accounts'
        newStatus = 'completed'
        break
      }
      default:
        return NextResponse.json({ error: 'Invalid stage' }, { status: 400 })
    }

    const [updatedOrder] = await db
      .update(purchaseOrders)
      .set(updateData)
      .where(eq(purchaseOrders.id, orderId))
      .returning()

    const [historyEntry] = await db
      .insert(workflowHistory)
      .values({
        purchaseOrderId: orderId,
        performedBy: appUser.id,
        userRole: appUser.role,
        action: action || 'submit',
        stage: historyStage as WorkflowHistoryInsert['stage'],
        previousStatus: order.status,
        newStatus,
        remarks: formData.remarks
          ? String(formData.remarks)
          : formData.specialInstructions
            ? String(formData.specialInstructions)
            : formData.remarksIfAny
              ? String(formData.remarksIfAny)
              : null,
        metadata: formData,
      })
      .returning({
        id: workflowHistory.id,
        remarks: workflowHistory.remarks,
      })

    if (notificationEvent) {
      await createPurchaseOrderWorkflowNotifications({
        event: notificationEvent,
        order: updatedOrder,
        actor: {
          id: appUser.id,
          role: appUser.role,
          brand: appUser.brand,
          fullName: appUser.fullName,
          email: appUser.email,
        },
        historyEntry,
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Workflow updated successfully',
      orderId,
      newStage,
      newStatus,
    })
  } catch (error) {
    console.error('Workflow error:', error)
    return NextResponse.json(
      { error: 'Failed to update workflow', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('orderId')

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID required' }, { status: 400 })
    }

    const [order, history] = await Promise.all([
      db
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, orderId), isNull(purchaseOrders.deletedAt)))
        .then((rows) => rows[0]),
      db
        .select()
        .from(workflowHistory)
        .where(eq(workflowHistory.purchaseOrderId, orderId))
        .orderBy(asc(workflowHistory.createdAt)),
    ])

    if (!order || !canReadPurchaseOrder(appUser, order)) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const userIds = new Set<string>()

    if (order.createdBy) userIds.add(order.createdBy)
    if (order.assignedTo) userIds.add(order.assignedTo)
    if (order.eaApprovedBy) userIds.add(order.eaApprovedBy)
    if (order.mdApprovedBy) userIds.add(order.mdApprovedBy)

    history.forEach((item) => {
      if (item.performedBy) {
        userIds.add(item.performedBy)
      }
    })

    const userIdList = Array.from(userIds)
    const usersData = userIdList.length > 0
      ? await db
          .select({
            id: users.id,
            fullName: users.fullName,
            email: users.email,
            role: users.role,
          })
          .from(users)
          .where(and(inArray(users.id, userIdList), isNull(users.deletedAt)))
      : []

    const userMap = new Map<string, { name: string; email: string | null; role: string }>()
    usersData.forEach((user) => {
      userMap.set(user.id, {
        name: user.fullName || user.email,
        email: user.email,
        role: user.role,
      })
    })

    const enrichedHistory = history.map((item) => ({
      ...item,
      performedBy: userMap.get(item.performedBy)?.name || item.performedBy || 'Unknown',
      performedByEmail: userMap.get(item.performedBy)?.email || null,
    }))

    const purchaseManagerId =
      (order.assignedTo && userMap.get(order.assignedTo)?.role === 'purchase_manager' ? order.assignedTo : null)
      || (userMap.get(order.createdBy)?.role === 'purchase_manager' ? order.createdBy : null)
      || history.find((item) => item.userRole === 'purchase_manager')?.performedBy
      || null

    const personnel = {
      createdBy: userMap.get(order.createdBy)?.name || 'Unknown',
      createdByEmail: userMap.get(order.createdBy)?.email || null,
      purchaseManager: purchaseManagerId ? userMap.get(purchaseManagerId)?.name || 'Unknown' : null,
      purchaseManagerEmail: purchaseManagerId ? userMap.get(purchaseManagerId)?.email || null : null,
      eaApprover: order.eaApprovedBy ? userMap.get(order.eaApprovedBy)?.name || 'Unknown' : null,
      eaApproverEmail: order.eaApprovedBy ? userMap.get(order.eaApprovedBy)?.email || null : null,
      mdApprover: order.mdApprovedBy ? userMap.get(order.mdApprovedBy)?.name || 'Unknown' : null,
      mdApproverEmail: order.mdApprovedBy ? userMap.get(order.mdApprovedBy)?.email || null : null,
    }

    return NextResponse.json({
      order: serializeWorkflowOrder(order),
      history: enrichedHistory.map((item) => serializeWorkflowHistoryItem(item)),
      personnel,
    })
  } catch (error) {
    console.error('Get order error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
