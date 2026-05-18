import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { serializeUtcTimestampFields, getIndiaDatePart } from '@/lib/date-time'
import { purchaseOrders } from '@/lib/db/schema'
import {
  canCreatePurchaseOrders,
  canReadPurchaseOrder,
  getPurchaseOrderListVisibilityFilter,
  isPurchaseOrderStage,
  isPurchaseOrderStatus,
} from '@/lib/purchase-orders/access'
import { isBranchValue } from '@/lib/branches'

const PURCHASE_ORDER_UTC_TIMESTAMP_FIELDS = [
  'created_at',
  'updated_at',
  'completed_at',
  'deleted_at',
  'ea_approved_at',
  'md_approved_at',
] as const

function serializePurchaseOrderRow(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...PURCHASE_ORDER_UTC_TIMESTAMP_FIELDS])
}

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')
    const status = searchParams.get('status')
    const stage = searchParams.get('stage')

    // If ID is provided, fetch single purchase order
    if (id) {
      const [order] = await db
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), getPurchaseOrderListVisibilityFilter(appUser)))
        .limit(1)

      if (!order) {
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
      }

      return NextResponse.json(serializePurchaseOrderRow(order))
    }

    const filters = [getPurchaseOrderListVisibilityFilter(appUser)]

    if (status) {
      if (!isPurchaseOrderStatus(status)) {
        return NextResponse.json({ error: 'Invalid purchase order status' }, { status: 400 })
      }

      filters.push(eq(purchaseOrders.status, status))
    }
    if (stage) {
      if (!isPurchaseOrderStage(stage)) {
        return NextResponse.json({ error: 'Invalid purchase order stage' }, { status: 400 })
      }

      filters.push(eq(purchaseOrders.currentStage, stage))
    }
    const rows = await db
      .select()
      .from(purchaseOrders)
      .where(and(...filters))
      .orderBy(desc(purchaseOrders.createdAt))

    return NextResponse.json({ orders: rows.map(serializePurchaseOrderRow) })
  } catch (error) {
    console.error('Error in GET /api/purchase-orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!canCreatePurchaseOrders(appUser.role)) {
      return NextResponse.json({ error: 'Only Admin and Purchase Managers can create purchase orders' }, { status: 403 })
    }

    const body = await request.json()

    // Generate order number using a simple approach if RPC fails
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

    const branch = isBranchValue(body.branch) ? body.branch : isBranchValue(body.brand) ? body.brand : null
    if (!branch) {
      return NextResponse.json({ error: 'Branch is required' }, { status: 400 })
    }

    const [data] = await db
      .insert(purchaseOrders)
      .values({
        orderNumber,
        createdBy: appUser.id,
        brand: branch,
        currentStage: body.current_stage || 'ea_approval',
        status: body.status || 'awaiting_ea_approval',
        reqType: body.req_type || null,
        department: body.department || null,
        subDepartment: body.sub_department || null,
        specifyOther: body.specify_other || null,
        requestedBy: body.requested_by || null,
        specialInstructions: body.special_instructions || null,
        quantityRequired: body.quantity_required || null,
        estimateIfAny: body.estimate_if_any || null,
        vendorName: body.vendor_name || null,
        quotation1Url: body.quotation_1_url || null,
        quotation2Url: body.quotation_2_url || null,
        quotation3Url: body.quotation_3_url || null,
        receivedDateTime: body.received_date_time || null,
        handoverTo: body.handover_to || null,
        remarksIfAny: body.remarks_if_any || null,
        amount: body.amount || null,
        invoice1Url: body.invoice_1_url || null,
        invoice2Url: body.invoice_2_url || null,
        invoice3Url: body.invoice_3_url || null,
        invoice4Url: body.invoice_4_url || null,
        paymentStatus: body.payment_status || null,
        paymentMode: body.payment_mode || null,
        accountRemarks: body.account_remarks || null,
        paymentScreenshotUrl: body.payment_screenshot_url || null,
      })
      .returning()

    return NextResponse.json(serializePurchaseOrderRow(data), { status: 201 })
  } catch (error) {
    console.error('Error in POST /api/purchase-orders:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'Purchase order ID is required' }, { status: 400 })
    }

    if (!canCreatePurchaseOrders(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [existingOrder] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .limit(1)

    if (!existingOrder || !canReadPurchaseOrder(appUser, existingOrder)) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    const [data] = await db
      .update(purchaseOrders)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id))
      .returning()

    return NextResponse.json(serializePurchaseOrderRow(data))
  } catch (error) {
    console.error('Error in PUT /api/purchase-orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!canCreatePurchaseOrders(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Purchase order ID is required' }, { status: 400 })
    }

    const [existingOrder] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)))
      .limit(1)

    if (!existingOrder || !canReadPurchaseOrder(appUser, existingOrder)) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    await db
      .update(purchaseOrders)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id))

    return NextResponse.json({ message: 'Purchase order deleted successfully' })
  } catch (error) {
    console.error('Error in DELETE /api/purchase-orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Made with Bob
