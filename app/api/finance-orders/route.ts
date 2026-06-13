import { NextRequest, NextResponse } from 'next/server'
import { and, count, desc, eq, gte, ilike, isNull, lt, or, sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { financeOrders, financeOrderWorkflow } from '@/lib/db/schema'
import { getIndiaDatePart, serializeUtcTimestampFields } from '@/lib/date-time'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import {
  canAccessFinanceOrders,
  canCreateFinanceOrders,
  canEditFinanceOrder,
  getFinanceApprovalFilter,
  getFinanceOrderVisibilityFilter,
  isFinanceOrderStatus,
} from '@/lib/finance-orders/access'
import { createFinanceOrderWorkflowNotifications } from '@/lib/notifications/finance-workflow'
import { getUserBranchLabel, isUserBranchValue } from '@/lib/branches'

export const dynamic = 'force-dynamic'

const FINANCE_ORDER_UTC_FIELDS = [
  'paymentReceivedDate',
  'accountsVerifiedAt',
  'accountsHeldAt',
  'eaApprovedAt',
  'eaHeldAt',
  'mdApprovedAt',
  'mdHeldAt',
  'submittedAt',
  'completedAt',
  'rejectedAt',
  'createdAt',
  'updatedAt',
  'deletedAt',
] as const

function serializeFinanceOrder(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...FINANCE_ORDER_UTC_FIELDS])
}

function readText(body: Record<string, unknown>, key: string) {
  return String(body[key] || '').trim()
}

function readAmount(body: Record<string, unknown>, key: string) {
  const raw = String(body[key] ?? '').replace(/,/g, '').trim()
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function readDate(body: Record<string, unknown>, key: string) {
  const value = readText(body, key)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00+05:30`)
  return Number.isNaN(date.getTime()) ? null : date
}

function validateFinancePayload(body: Record<string, unknown>) {
  const totalPayoutReceived = readAmount(body, 'totalPayoutReceived')
  const dsePayout = readAmount(body, 'dsePayout')
  const paymentReceivedDate = readDate(body, 'paymentReceivedDate')
  const requiredFields = {
    invoiceNumber: readText(body, 'invoiceNumber'),
    hypBankName: readText(body, 'hypBankName'),
    dseName: readText(body, 'dseName'),
    dealer: readText(body, 'dealer'),
  }
  const errors: Record<string, string> = {}

  Object.entries(requiredFields).forEach(([key, value]) => {
    if (!value) errors[key] = 'Required'
  })
  if (requiredFields.dealer && !isUserBranchValue(requiredFields.dealer)) {
    errors.dealer = 'Select a valid dealer branch'
  }
  if (totalPayoutReceived === null || totalPayoutReceived <= 0) errors.totalPayoutReceived = 'Enter a valid payout amount'
  if (dsePayout === null || dsePayout < 0) errors.dsePayout = 'Enter a valid DSE payout'
  if (!paymentReceivedDate) errors.paymentReceivedDate = 'Select a valid payment date'

  return {
    errors,
    values: {
      ...requiredFields,
      totalPayoutReceived,
      dsePayout,
      paymentReceivedDate,
    },
  }
}

function getBranchFilter(branch: string | null) {
  if (!branch || branch === 'all' || !isUserBranchValue(branch)) return null
  return or(eq(financeOrders.dealer, branch), eq(financeOrders.dealer, getUserBranchLabel(branch)))
}

function getStatusGroupFilter(statusGroup: string | null) {
  if (!statusGroup || statusGroup === 'all') return null
  if (statusGroup === 'pending') {
    return or(
      eq(financeOrders.status, 'draft'),
      eq(financeOrders.status, 'awaiting_accounts_verification'),
      eq(financeOrders.status, 'awaiting_ea_approval'),
      eq(financeOrders.status, 'awaiting_md_approval')
    )
  }
  if (statusGroup === 'completed') return eq(financeOrders.status, 'completed')
  if (statusGroup === 'hold') {
    return or(eq(financeOrders.status, 'accounts_on_hold'), eq(financeOrders.status, 'ea_on_hold'), eq(financeOrders.status, 'md_on_hold'))
  }
  if (statusGroup === 'denied') {
    return or(eq(financeOrders.status, 'accounts_denied'), eq(financeOrders.status, 'ea_denied'), eq(financeOrders.status, 'md_denied'))
  }
  return null
}

function parseSpendingDateRange(startDate: string | null, endDate: string | null) {
  const today = getIndiaDatePart().replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  const defaultStart = `${today.slice(0, 8)}01`
  const startValue = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : defaultStart
  const endValue = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : today
  const start = new Date(`${startValue}T00:00:00+05:30`)
  const selectedEnd = new Date(`${endValue}T00:00:00+05:30`)
  const safeEnd = selectedEnd.getTime() < start.getTime() ? start : selectedEnd
  const endExclusive = new Date(safeEnd.getTime() + 86_400_000)
  return {
    startDate: startValue,
    endDate: selectedEnd.getTime() < start.getTime() ? startValue : endValue,
    start,
    end: endExclusive,
  }
}

async function createOrderNumber() {
  const datepart = getIndiaDatePart()
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `FO-${datepart}-${random}`
}

export async function GET(request: NextRequest) {
  const timer = createApiTimer('finance-orders')
  try {
    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessFinanceOrders(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')

    if (id) {
      const [order] = await timer.time('single', () => db
        .select()
        .from(financeOrders)
        .where(and(eq(financeOrders.id, id), getFinanceOrderVisibilityFilter(appUser)))
        .limit(1))

      if (!order) return NextResponse.json({ error: 'Finance order not found' }, { status: 404 })
      const { serverTiming } = timer.finish()
      return withServerTiming(NextResponse.json(serializeFinanceOrder(order)), serverTiming)
    }

    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(24, Math.max(6, Number.parseInt(searchParams.get('pageSize') || '12', 10) || 12))
    const search = (searchParams.get('search') || '').trim()
    const status = searchParams.get('status')
    const statusGroup = searchParams.get('statusGroup')
    const branch = searchParams.get('branch')
    const approvalFilter = searchParams.get('approvalFilter')
    const scope = searchParams.get('scope')
    const exportMode = searchParams.get('export')
    const metrics = searchParams.get('metrics') === 'true'
    const spendingRange = parseSpendingDateRange(searchParams.get('spendingStartDate'), searchParams.get('spendingEndDate'))
    const spendingBranch = searchParams.get('spendingBranch') || branch
    const stageScoped = scope !== 'all' && (appUser.role === 'accounts' || appUser.role === 'ea' || appUser.role === 'md')
    const filters = [getFinanceOrderVisibilityFilter(appUser)]
    const branchExpression = getBranchFilter(branch)
    if (branchExpression) filters.push(branchExpression)

    if (!stageScoped && status && status !== 'all') {
      if (!isFinanceOrderStatus(status)) return NextResponse.json({ error: 'Invalid finance order status' }, { status: 400 })
      filters.push(eq(financeOrders.status, status))
    }
    const statusGroupExpression = !stageScoped && (!status || status === 'all') ? getStatusGroupFilter(statusGroup) : null
    if (statusGroupExpression) filters.push(statusGroupExpression)

    const approvalExpression = getFinanceApprovalFilter(appUser.role, stageScoped ? 'pending' : approvalFilter)
    if (approvalExpression) filters.push(approvalExpression)

    if (search) {
      filters.push(or(
        ilike(financeOrders.orderNumber, `%${search}%`),
        ilike(financeOrders.invoiceNumber, `%${search}%`),
        ilike(financeOrders.dealer, `%${search}%`),
        ilike(financeOrders.dseName, `%${search}%`),
        ilike(financeOrders.hypBankName, `%${search}%`)
      )!)
    }

    const whereExpression = and(...filters)

    if (metrics) {
      const metricBaseFilters = [getFinanceOrderVisibilityFilter(appUser)]
      if (branchExpression) metricBaseFilters.push(branchExpression)

      const spendingFilters = [
        getFinanceOrderVisibilityFilter(appUser),
        gte(financeOrders.paymentReceivedDate, spendingRange.start),
        lt(financeOrders.paymentReceivedDate, spendingRange.end),
      ]
      const spendingBranchExpression = getBranchFilter(spendingBranch)
      if (spendingBranchExpression) spendingFilters.push(spendingBranchExpression)

      const [[summary], [spending]] = await timer.time('metrics', () => Promise.all([
        db.select({
          total: count(),
          payout: sql<string>`coalesce(sum(${financeOrders.totalPayoutReceived}), 0)`,
          pendingAccounts: sql<number>`count(*) filter (where ${financeOrders.status} = 'awaiting_accounts_verification')`,
          pendingEa: sql<number>`count(*) filter (where ${financeOrders.status} = 'awaiting_ea_approval')`,
          pendingMd: sql<number>`count(*) filter (where ${financeOrders.status} = 'awaiting_md_approval')`,
          held: sql<number>`count(*) filter (where ${financeOrders.status} in ('accounts_on_hold', 'ea_on_hold', 'md_on_hold'))`,
          completed: sql<number>`count(*) filter (where ${financeOrders.status} = 'completed')`,
        }).from(financeOrders).where(and(...metricBaseFilters)),
        db.select({
          orders: count(),
          payout: sql<string>`coalesce(sum(${financeOrders.totalPayoutReceived}), 0)`,
          dsePayout: sql<string>`coalesce(sum(${financeOrders.dsePayout}), 0)`,
          completedOrders: sql<number>`count(*) filter (where ${financeOrders.status} = 'completed')`,
          completedPayout: sql<string>`coalesce(sum(${financeOrders.totalPayoutReceived}) filter (where ${financeOrders.status} = 'completed'), 0)`,
          pendingPayout: sql<string>`coalesce(sum(${financeOrders.totalPayoutReceived}) filter (where ${financeOrders.status} <> 'completed' and ${financeOrders.status} not in ('accounts_denied', 'ea_denied', 'md_denied', 'cancelled')), 0)`,
        }).from(financeOrders).where(and(...spendingFilters)),
      ]))

      const { serverTiming } = timer.finish()
      return withServerTiming(NextResponse.json({
        summary: {
          total: Number(summary?.total || 0),
          payout: Number(summary?.payout || 0),
          pendingAccounts: Number(summary?.pendingAccounts || 0),
          pendingEa: Number(summary?.pendingEa || 0),
          pendingMd: Number(summary?.pendingMd || 0),
          held: Number(summary?.held || 0),
          completed: Number(summary?.completed || 0),
        },
        spending: {
          startDate: spendingRange.startDate,
          endDate: spendingRange.endDate,
          orders: Number(spending?.orders || 0),
          payout: Number(spending?.payout || 0),
          dsePayout: Number(spending?.dsePayout || 0),
          completedOrders: Number(spending?.completedOrders || 0),
          completedPayout: Number(spending?.completedPayout || 0),
          pendingPayout: Number(spending?.pendingPayout || 0),
        },
      }), serverTiming)
    }

    if (exportMode === 'completed') {
      const completedRows = await timer.time('completed-export', () => db
        .select()
        .from(financeOrders)
        .where(and(whereExpression, eq(financeOrders.status, 'completed')))
        .orderBy(desc(financeOrders.completedAt), desc(financeOrders.createdAt)))

      const { serverTiming } = timer.finish()
      return withServerTiming(NextResponse.json({
        orders: completedRows.map(serializeFinanceOrder),
        pagination: {
          page: 1,
          pageSize: completedRows.length,
          total: completedRows.length,
          totalPages: 1,
        },
      }), serverTiming)
    }

    const offset = (page - 1) * pageSize
    const [[{ total }], rows] = await timer.time('list', () => Promise.all([
      db.select({ total: count() }).from(financeOrders).where(whereExpression),
      db.select().from(financeOrders).where(whereExpression).orderBy(desc(financeOrders.createdAt)).limit(pageSize).offset(offset),
    ]))

    const totalRows = Number(total) || 0
    const { serverTiming } = timer.finish()
    return withServerTiming(NextResponse.json({
      orders: rows.map(serializeFinanceOrder),
      pagination: {
        page,
        pageSize,
        total: totalRows,
        totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
      },
    }), serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Error in GET /api/finance-orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canCreateFinanceOrders(appUser.role)) return NextResponse.json({ error: 'Only Finance Head and Admin can create finance orders' }, { status: 403 })

    const body = await request.json() as Record<string, unknown>
    const draft = body.mode === 'draft'
    const validation = validateFinancePayload(body)
    if (Object.keys(validation.errors).length > 0) {
      return NextResponse.json({ error: 'Validation failed', fields: validation.errors }, { status: 400 })
    }

    const orderNumber = await createOrderNumber()
    const now = new Date()
    const [order] = await db.insert(financeOrders).values({
      orderNumber,
      createdBy: appUser.id,
      currentStage: draft ? 'finance_head_submission' : 'accounts_verification',
      status: draft ? 'draft' : 'awaiting_accounts_verification',
      totalPayoutReceived: String(validation.values.totalPayoutReceived),
      invoiceNumber: validation.values.invoiceNumber,
      paymentReceivedDate: validation.values.paymentReceivedDate!,
      dsePayout: String(validation.values.dsePayout),
      hypBankName: validation.values.hypBankName,
      dseName: validation.values.dseName,
      dealer: validation.values.dealer,
      submittedAt: draft ? null : now,
    }).returning()

    const [historyEntry] = await db.insert(financeOrderWorkflow).values({
      financeOrderId: order.id,
      performedBy: appUser.id,
      userRole: appUser.role,
      action: draft ? 'save_draft' : 'submit',
      stage: 'finance_head_submission',
      previousStatus: null,
      newStatus: order.status,
      remarks: draft ? 'Saved as draft' : 'Submitted for Accounts payment verification',
      metadata: { source: 'finance_orders_form' },
    }).returning({ id: financeOrderWorkflow.id, remarks: financeOrderWorkflow.remarks })

    if (!draft) {
      await createFinanceOrderWorkflowNotifications({
        event: 'finance_order_submitted',
        order,
        actor: appUser,
        historyEntry,
      })
    }

    return NextResponse.json({ success: true, order: serializeFinanceOrder(order) }, { status: 201 })
  } catch (error) {
    console.error('Error in POST /api/finance-orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as Record<string, unknown>
    const id = readText(body, 'id')
    if (!id) return NextResponse.json({ error: 'Finance order ID is required' }, { status: 400 })

    const [existingOrder] = await db
      .select()
      .from(financeOrders)
      .where(and(eq(financeOrders.id, id), isNull(financeOrders.deletedAt)))
      .limit(1)

    if (!existingOrder) return NextResponse.json({ error: 'Finance order not found' }, { status: 404 })
    if (!canEditFinanceOrder(appUser.role, existingOrder, appUser.id) && appUser.role !== 'admin' && appUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const draft = body.mode === 'draft'
    const validation = validateFinancePayload(body)
    if (Object.keys(validation.errors).length > 0) {
      return NextResponse.json({ error: 'Validation failed', fields: validation.errors }, { status: 400 })
    }

    const newStatus = draft ? 'draft' : 'awaiting_accounts_verification'
    const newStage = draft ? 'finance_head_submission' : 'accounts_verification'
    const [order] = await db.update(financeOrders).set({
      currentStage: newStage,
      status: newStatus,
      totalPayoutReceived: String(validation.values.totalPayoutReceived),
      invoiceNumber: validation.values.invoiceNumber,
      paymentReceivedDate: validation.values.paymentReceivedDate!,
      dsePayout: String(validation.values.dsePayout),
      hypBankName: validation.values.hypBankName,
      dseName: validation.values.dseName,
      dealer: validation.values.dealer,
      accountsVerificationStatus: null,
      accountsVerifiedBy: null,
      accountsVerifiedAt: null,
      accountsVerificationRemarks: null,
      accountsHeldAt: null,
      accountsHeldBy: null,
      eaApprovalStatus: null,
      eaApprovedBy: null,
      eaApprovedAt: null,
      eaApprovalRemarks: null,
      eaHeldAt: null,
      eaHeldBy: null,
      mdApprovalStatus: null,
      mdApprovedBy: null,
      mdApprovedAt: null,
      mdApprovalRemarks: null,
      mdHeldAt: null,
      mdHeldBy: null,
      holdRemarks: null,
      submittedAt: draft ? existingOrder.submittedAt : new Date(),
      updatedAt: new Date(),
    }).where(eq(financeOrders.id, id)).returning()

    const [historyEntry] = await db.insert(financeOrderWorkflow).values({
      financeOrderId: order.id,
      performedBy: appUser.id,
      userRole: appUser.role,
      action: draft ? 'save_draft' : 'submit',
      stage: 'finance_head_submission',
      previousStatus: existingOrder.status,
      newStatus,
      remarks: draft ? 'Draft updated' : 'Submitted for Accounts payment verification',
      metadata: { source: 'finance_orders_form' },
    }).returning({ id: financeOrderWorkflow.id, remarks: financeOrderWorkflow.remarks })

    if (!draft) {
      await createFinanceOrderWorkflowNotifications({
        event: 'finance_order_submitted',
        order,
        actor: appUser,
        historyEntry,
      })
    }

    return NextResponse.json({ success: true, order: serializeFinanceOrder(order) })
  } catch (error) {
    console.error('Error in PUT /api/finance-orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
