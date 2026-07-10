import { NextRequest, NextResponse } from 'next/server'
import { and, count, desc, eq, gte, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { serializeUtcTimestampFields, getIndiaDatePart } from '@/lib/date-time'
import { purchaseOrders } from '@/lib/db/schema'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import {
  canCreatePurchaseOrders,
  canReadPurchaseOrder,
  canViewPurchaseOrderTable,
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

const APPROVAL_FILTER_VALUES = ['all', 'pending', 'approved', 'rejected', 'hold', 'completed'] as const
type WhereFilter = NonNullable<Parameters<typeof and>[number]>

function serializePurchaseOrderRow(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...PURCHASE_ORDER_UTC_TIMESTAMP_FIELDS])
}

function getCurrentIndiaDayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const getPart = (type: string) => parts.find((part) => part.type === type)?.value || ''
  const start = new Date(`${getPart('year')}-${getPart('month')}-${getPart('day')}T00:00:00+05:30`)

  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  }
}

function getWorkflowFilterExpression(filter: string | null) {
  switch (filter) {
    case 'vendor_info_pending':
      return or(eq(purchaseOrders.status, 'vendor_info_pending'), eq(purchaseOrders.currentStage, 'vendor_information'))
    case 'ea_pending':
      return eq(purchaseOrders.status, 'awaiting_ea_approval')
    case 'md_pending':
      return eq(purchaseOrders.status, 'awaiting_md_approval')
    case 'grn_pending':
      return eq(purchaseOrders.status, 'awaiting_grn')
    case 'grn_completed':
      return eq(purchaseOrders.status, 'awaiting_accounts')
    case 'accounts_pending':
      return eq(purchaseOrders.status, 'awaiting_accounts')
    case 'completed':
      return eq(purchaseOrders.status, 'completed')
    case 'rejected':
      return or(eq(purchaseOrders.status, 'ea_denied'), eq(purchaseOrders.status, 'md_denied'))
    case 'hold':
      return or(eq(purchaseOrders.status, 'on_hold'), eq(purchaseOrders.status, 'ea_on_hold'), eq(purchaseOrders.status, 'md_on_hold'))
    default:
      return null
  }
}

function getSpendingScopeExpression() {
  return sql`${purchaseOrders.status} IN ('awaiting_accounts', 'completed')`
}

function getSpendDateExpression() {
  return sql<Date>`COALESCE(${purchaseOrders.receivedDateTime}, ${purchaseOrders.completedAt}, ${purchaseOrders.createdAt})`
}

function addSpendDateBounds(filters: unknown[], start: Date, end: Date) {
  const spendDate = getSpendDateExpression()
  filters.push(
    sql`${spendDate} >= ${start.toISOString()}::timestamptz`,
    sql`${spendDate} < ${end.toISOString()}::timestamptz`
  )
}

function addDateModeFilters(filters: unknown[], mode: 'today' | 'all', useSpendDate: boolean) {
  if (mode !== 'today') return

  const { start, end } = getCurrentIndiaDayBounds()
  if (useSpendDate) {
    addSpendDateBounds(filters, start, end)
    return
  }

  filters.push(gte(purchaseOrders.createdAt, start), lt(purchaseOrders.createdAt, end))
}

function parseIndiaDateBound(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }

  const date = new Date(`${value}T00:00:00+05:30`)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return endOfDay ? new Date(date.getTime() + 24 * 60 * 60 * 1000) : date
}

function addSpendDateRangeFilters(filters: unknown[], startDate: string | null, endDate: string | null) {
  const spendDate = getSpendDateExpression()
  const start = parseIndiaDateBound(startDate)
  const end = parseIndiaDateBound(endDate, true)

  if (start) {
    filters.push(sql`${spendDate} >= ${start.toISOString()}::timestamptz`)
  }

  if (end) {
    filters.push(sql`${spendDate} < ${end.toISOString()}::timestamptz`)
  }
}

function getApprovalFilterExpression(role: string, filter: string | null) {
  if (role !== 'ea' && role !== 'md') {
    return null
  }

  if (role === 'ea') {
    switch (filter) {
      case 'pending':
        return eq(purchaseOrders.status, 'awaiting_ea_approval')
      case 'approved':
        return and(
          eq(purchaseOrders.eaApprovalStatus, 'approved'),
          sql`${purchaseOrders.status} NOT IN ('completed', 'ea_denied', 'md_denied', 'ea_on_hold', 'md_on_hold')`
        )
      case 'rejected':
        return or(eq(purchaseOrders.status, 'ea_denied'), eq(purchaseOrders.status, 'md_denied'))
      case 'hold':
        return or(eq(purchaseOrders.status, 'ea_on_hold'), eq(purchaseOrders.status, 'md_on_hold'))
      case 'completed':
        return eq(purchaseOrders.status, 'completed')
      case 'all':
        return sql`${purchaseOrders.status} NOT IN ('submitted', 'vendor_info_pending')`
      default:
        return null
    }
  }

  switch (filter) {
    case 'pending':
      return eq(purchaseOrders.status, 'awaiting_md_approval')
    case 'approved':
      return and(
        eq(purchaseOrders.mdApprovalStatus, 'approved'),
        sql`${purchaseOrders.status} NOT IN ('completed', 'md_denied', 'md_on_hold')`
      )
    case 'rejected':
      return eq(purchaseOrders.status, 'md_denied')
    case 'hold':
      return eq(purchaseOrders.status, 'md_on_hold')
    case 'completed':
      return eq(purchaseOrders.status, 'completed')
    case 'all':
      return sql`${purchaseOrders.status} NOT IN ('submitted', 'vendor_info_pending', 'awaiting_ea_approval', 'ea_denied', 'ea_on_hold')`
    default:
      return null
  }
}

async function fetchApprovalCounts(role: string, baseFilters: WhereFilter[]) {
  if (role !== 'ea' && role !== 'md') {
    return null
  }

  const isEa = role === 'ea'

  const pendingCond = isEa
    ? eq(purchaseOrders.status, 'awaiting_ea_approval')
    : eq(purchaseOrders.status, 'awaiting_md_approval')

  const approvedCond = isEa
    ? and(
        eq(purchaseOrders.eaApprovalStatus, 'approved'),
        sql`${purchaseOrders.status} NOT IN ('completed', 'ea_denied', 'md_denied', 'ea_on_hold', 'md_on_hold')`
      )
    : and(
        eq(purchaseOrders.mdApprovalStatus, 'approved'),
        sql`${purchaseOrders.status} NOT IN ('completed', 'md_denied', 'md_on_hold')`
      )

  const rejectedCond = isEa
    ? sql`${purchaseOrders.status} IN ('ea_denied', 'md_denied')`
    : eq(purchaseOrders.status, 'md_denied')

  const holdCond = isEa
    ? sql`${purchaseOrders.status} IN ('ea_on_hold', 'md_on_hold')`
    : eq(purchaseOrders.status, 'md_on_hold')

  const completedCond = eq(purchaseOrders.status, 'completed')

  const [row] = await db
    .select({
      pending: count(sql`CASE WHEN ${pendingCond} THEN 1 END`),
      approved: count(sql`CASE WHEN ${approvedCond} THEN 1 END`),
      rejected: count(sql`CASE WHEN ${rejectedCond} THEN 1 END`),
      hold: count(sql`CASE WHEN ${holdCond} THEN 1 END`),
      completed: count(sql`CASE WHEN ${completedCond} THEN 1 END`),
    })
    .from(purchaseOrders)
    .where(and(...baseFilters))

  const pending = Number(row?.pending || 0)
  const approved = Number(row?.approved || 0)
  const rejected = Number(row?.rejected || 0)
  const hold = Number(row?.hold || 0)
  const completed = Number(row?.completed || 0)

  const all = pending + approved + rejected + hold + completed

  return {
    all,
    pending,
    approved,
    rejected,
    hold,
    completed,
  }
}

export async function GET(request: NextRequest) {
  const timer = createApiTimer('purchase-orders')
  try {
    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')
    const status = searchParams.get('status')
    const stage = searchParams.get('stage')
    const view = searchParams.get('view')
    const paginate = searchParams.get('paginate') === 'true'
    const mode = searchParams.get('mode') === 'all' ? 'all' : 'today'
    const workflowFilter = searchParams.get('workflowFilter')
    const approvalFilter = searchParams.get('approvalFilter')
    const branchFilter = searchParams.get('branchFilter')
    const scope = searchParams.get('scope')
    const spendStartDate = searchParams.get('spendStartDate')
    const spendEndDate = searchParams.get('spendEndDate')
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '9', 10) || 9
    const pageSize = Math.min(12, Math.max(1, requestedPageSize))

    // If ID is provided, fetch single purchase order
    if (id) {
      const [order] = await timer.time('single', () => db
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), getPurchaseOrderListVisibilityFilter(appUser)))
        .limit(1))

      if (!order) {
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
      }

      const { serverTiming } = timer.finish()
      return withServerTiming(NextResponse.json(serializePurchaseOrderRow(order)), serverTiming)
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

    if (
      appUser.role === 'md'
      && !branchFilter
      && approvalFilter !== 'all'
      && isBranchValue(appUser.brand)
    ) {
      filters.push(or(eq(purchaseOrders.brand, appUser.brand), isNull(purchaseOrders.brand))!)
    }

    if (branchFilter && branchFilter !== 'all') {
      if (!isBranchValue(branchFilter)) {
        return NextResponse.json({ error: 'Invalid branch filter' }, { status: 400 })
      }

      if (appUser.role !== 'md' && appUser.role !== 'admin' && appUser.role !== 'developer' && appUser.role !== 'purchase_manager') {
        return NextResponse.json({ error: 'Forbidden branch filter' }, { status: 403 })
      }

      filters.push(eq(purchaseOrders.brand, branchFilter))
    }

    if (view === 'table') {
      if (!canViewPurchaseOrderTable(appUser.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const workflowExpression = getWorkflowFilterExpression(workflowFilter)
      if (workflowExpression) {
        filters.push(workflowExpression)
      } else if (scope === 'all') {
        // Keep only the role/branch/deleted visibility filter so EA/MD can audit all readable orders.
      } else if (scope === 'spending') {
        filters.push(getSpendingScopeExpression())
      } else if (scope === 'completed') {
        filters.push(eq(purchaseOrders.status, 'completed'))
      } else {
        filters.push(ne(purchaseOrders.status, 'completed'))
      }

      if (scope === 'spending') {
        addSpendDateRangeFilters(filters, spendStartDate, spendEndDate)
      }

      addDateModeFilters(filters, mode, scope === 'spending')

      const whereExpression = and(...filters)
      const offset = (page - 1) * pageSize
      const [[{ total }], rows] = await timer.time('table-query', () => Promise.all([
        db
          .select({ total: count() })
          .from(purchaseOrders)
          .where(whereExpression),
        db
          .select()
          .from(purchaseOrders)
          .where(whereExpression)
          .orderBy(desc(purchaseOrders.createdAt))
          .limit(pageSize)
          .offset(offset),
      ]))

      const totalOrders = Number(total) || 0
      const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize))
      const safePage = Math.min(page, totalPages)
      const { serverTiming } = timer.finish()

      return withServerTiming(NextResponse.json({
        orders: rows.map(serializePurchaseOrderRow),
        pagination: {
          page: safePage,
          pageSize,
          total: totalOrders,
          totalPages,
          mode,
        },
      }), serverTiming)
    }

    if (paginate) {
      const workflowExpression = getWorkflowFilterExpression(workflowFilter)
      const approvalExpression = getApprovalFilterExpression(appUser.role, approvalFilter)
      const approvalCountFilters = [...filters]

      if (workflowExpression) {
        approvalCountFilters.push(workflowExpression)
      }

      if (workflowExpression) {
        filters.push(workflowExpression)
      } else if (approvalExpression) {
        filters.push(approvalExpression)
      } else if (scope === 'spending') {
        filters.push(getSpendingScopeExpression())
      } else if (scope === 'completed') {
        filters.push(eq(purchaseOrders.status, 'completed'))
      } else {
        filters.push(ne(purchaseOrders.status, 'completed'))
      }

      if (scope === 'spending') {
        addSpendDateRangeFilters(filters, spendStartDate, spendEndDate)
      }

      addDateModeFilters(filters, mode, scope === 'spending')

      const whereExpression = and(...filters)
      const offset = (page - 1) * pageSize
      const [[{ total }], rows, approvalCounts] = await timer.time('paged-query', () => Promise.all([
        db
          .select({ total: count() })
          .from(purchaseOrders)
          .where(whereExpression),
        db
          .select()
          .from(purchaseOrders)
          .where(whereExpression)
          .orderBy(desc(purchaseOrders.createdAt))
          .limit(pageSize)
          .offset(offset),
        fetchApprovalCounts(appUser.role, approvalCountFilters),
      ]))

      const totalOrders = Number(total) || 0
      const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize))
      const safePage = Math.min(page, totalPages)
      const { serverTiming } = timer.finish()

      return withServerTiming(NextResponse.json({
        orders: rows.map(serializePurchaseOrderRow),
        pagination: {
          page: safePage,
          pageSize,
          total: totalOrders,
          totalPages,
          mode,
        },
        approvalCounts,
      }), serverTiming)
    }

    const rows = await timer.time('legacy-list', () => db
      .select()
      .from(purchaseOrders)
      .where(and(...filters))
      .orderBy(desc(purchaseOrders.createdAt)))

    const { serverTiming } = timer.finish()
    return withServerTiming(NextResponse.json({ orders: rows.map(serializePurchaseOrderRow) }), serverTiming)
  } catch (error) {
    timer.finish()
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
