import 'server-only'

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppUser } from '@/lib/auth/app-user'
import { isBranchValue } from '@/lib/branches'
import { db } from '@/lib/db'
import {
  pettyCashAllocations,
  pettyCashApprovalHistory,
  pettyCashCategories,
  pettyCashExpenseAttachments,
  pettyCashExpenses,
  pettyCashLedgerEntries,
  pettyCashRequests,
  users,
} from '@/lib/db/schema'
import { getIndiaDatePart, serializeUtcTimestampFields } from '@/lib/date-time'
import { createPettyCashNotifications } from '@/lib/notifications/petty-cash'
import {
  canApprovePettyCashStage,
  canCreatePettyCashExpense,
  canCreatePettyCashRequest,
  canManagePettyCashBranch,
  canReadPettyCashExpense,
  canReadPettyCashRequest,
  canUsePettyCashAllocation,
  getPettyCashAllocationVisibilityFilter,
  getPettyCashExpenseVisibilityFilter,
  getPettyCashRequestVisibilityFilter,
} from './access'
import { PETTY_CASH_TOP_UP_THRESHOLD, isPettyCashExpenseStatus, isPettyCashRequestStatus } from './constants'

type PettyCashAllocationRecord = typeof pettyCashAllocations.$inferSelect

const moneySchema = z.coerce.number().finite().positive().max(99_99_99_999)
const optionalText = z.string().trim().max(2000).optional().nullable()
const uuidSchema = z.string().uuid()

export const createPettyCashRequestSchema = z.object({
  status: z.enum(['draft', 'submitted']).default('submitted'),
  branchId: z.string().optional().nullable(),
  requestedAmount: moneySchema,
  purpose: z.string().trim().min(2).max(2000),
  department: optionalText,
  requestForm: z.record(z.string(), z.unknown()).default({}),
})

export const createPettyCashExpenseSchema = z.object({
  allocationId: uuidSchema.optional().nullable(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string().uuid().optional().nullable(),
  amount: moneySchema,
  vendorName: optionalText,
  receivedBy: optionalText,
  purpose: z.string().trim().min(2).max(2000),
  expenseForm: z.record(z.string(), z.unknown()).default({}),
  billFiles: z.array(z.string().trim()).default([]),
})

export const pettyCashWorkflowSchema = z.object({
  id: uuidSchema,
  action: z.enum(['approve', 'reject', 'hold']),
  stage: z.enum(['ea_approval', 'md_approval', 'accounts']),
  remarks: optionalText,
  allocatedAmount: moneySchema.optional(),
})

export const pettyCashListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(12),
  status: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  search: z.string().trim().optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})

const REQUEST_TIMESTAMP_FIELDS = ['createdAt', 'updatedAt', 'submittedAt', 'eaApprovedAt', 'mdApprovedAt', 'accountsApprovedAt', 'rejectedAt', 'deletedAt'] as const
const EXPENSE_TIMESTAMP_FIELDS = ['createdAt', 'updatedAt', 'submittedAt', 'eaApprovedAt', 'mdApprovedAt', 'accountsApprovedAt', 'rejectedAt', 'deletedAt'] as const
const ALLOCATION_TIMESTAMP_FIELDS = ['createdAt', 'updatedAt', 'allocatedAt', 'closedAt'] as const
const HISTORY_TIMESTAMP_FIELDS = ['createdAt'] as const
const LEDGER_TIMESTAMP_FIELDS = ['createdAt'] as const

function serializeRequest(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...REQUEST_TIMESTAMP_FIELDS])
}

function serializeExpense(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...EXPENSE_TIMESTAMP_FIELDS])
}

function serializeAllocation(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...ALLOCATION_TIMESTAMP_FIELDS])
}

function serializeHistory(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...HISTORY_TIMESTAMP_FIELDS])
}

function serializeLedger(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...LEDGER_TIMESTAMP_FIELDS])
}

function toMoney(value: number | string) {
  return Number(value || 0).toFixed(2)
}

function parseMoney(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount : 0
}

function getRemainingBalance(allocation: Pick<PettyCashAllocationRecord, 'allocatedAmount' | 'spentAmount'>) {
  return Math.max(0, parseMoney(allocation.allocatedAmount) - parseMoney(allocation.spentAmount))
}

function getTopUpStatus(allocation: Pick<PettyCashAllocationRecord, 'allocatedAmount' | 'spentAmount'> | null | undefined) {
  if (!allocation) {
    return {
      canRequestTopUp: true,
      remainingAmount: 0,
      topUpReason: 'No active allocation exists.',
    }
  }

  const remainingAmount = getRemainingBalance(allocation)
  return {
    canRequestTopUp: remainingAmount <= PETTY_CASH_TOP_UP_THRESHOLD,
    remainingAmount,
    topUpReason: remainingAmount <= PETTY_CASH_TOP_UP_THRESHOLD
      ? `Remaining balance is at or below ${toMoney(PETTY_CASH_TOP_UP_THRESHOLD)}.`
      : `Top-up requests unlock when remaining balance is ${toMoney(PETTY_CASH_TOP_UP_THRESHOLD)} or below.`,
  }
}

async function getActivePettyCashAllocationForScope(branchId: string, allocatedTo: string) {
  const [allocation] = await db
    .select()
    .from(pettyCashAllocations)
    .where(and(
      eq(pettyCashAllocations.branchId, branchId),
      eq(pettyCashAllocations.allocatedTo, allocatedTo),
      eq(pettyCashAllocations.status, 'active')
    ))
    .orderBy(desc(pettyCashAllocations.createdAt))
    .limit(1)

  return allocation || null
}

function makeReference(prefix: 'PCR' | 'PCA' | 'PCE') {
  const datepart = getIndiaDatePart()
  const random = Math.floor(Math.random() * 10_000).toString().padStart(4, '0')
  return `${prefix}-${datepart}-${random}`
}

function normalizeBranch(appUser: AppUser) {
  return isBranchValue(appUser.brand) ? appUser.brand : null
}

function getActor(appUser: AppUser) {
  return {
    id: appUser.id,
    role: appUser.role,
    brand: appUser.brand,
    fullName: appUser.fullName,
    email: appUser.email,
  }
}

const CREATOR_REQUEST_QUEUE_STATUSES = new Set([
  'draft',
  'submitted',
  'ea_pending',
  'ea_on_hold',
  'md_pending',
  'md_on_hold',
  'accounts_pending',
  'accounts_on_hold',
])

function filterDashboardRequests(appUser: AppUser, requests: Array<Record<string, unknown>>) {
  if (appUser.role === 'ea') {
    return requests.filter((request) => ['ea_pending', 'ea_on_hold'].includes(String(request.status || '')))
  }

  if (appUser.role === 'md') {
    return requests.filter((request) => ['md_pending', 'md_on_hold'].includes(String(request.status || '')))
  }

  if (appUser.role === 'accounts') {
    return requests.filter((request) => ['accounts_pending', 'accounts_on_hold'].includes(String(request.status || '')))
  }

  if (appUser.role === 'admin' || appUser.role === 'branch_admin') {
    return requests.filter((request) => (
      String(request.createdBy || '') === appUser.id
      && CREATOR_REQUEST_QUEUE_STATUSES.has(String(request.status || ''))
    ))
  }

  return requests
}

function filterDashboardExpenses(appUser: AppUser, expenses: Array<Record<string, unknown>>) {
  if (appUser.role === 'admin' || appUser.role === 'branch_admin') {
    return expenses.filter((expense) => String(expense.createdBy || '') === appUser.id)
  }

  return expenses
}

async function getUserMap(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)))
  if (uniqueUserIds.length === 0) return new Map<string, { fullName: string; email: string; role: string }>()

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(and(inArray(users.id, uniqueUserIds), isNull(users.deletedAt)))

  return new Map(rows.map((user) => [user.id, user]))
}

export async function getPettyCashCategories() {
  return db
    .select()
    .from(pettyCashCategories)
    .where(eq(pettyCashCategories.isActive, true))
    .orderBy(asc(pettyCashCategories.sortOrder), asc(pettyCashCategories.name))
}

export async function listPettyCashRequests(appUser: AppUser, input: z.input<typeof pettyCashListQuerySchema>) {
  const query = pettyCashListQuerySchema.parse(input)
  const filters = [getPettyCashRequestVisibilityFilter(appUser)]

  if (query.status && query.status !== 'all') {
    if (!isPettyCashRequestStatus(query.status)) throw new Error('Invalid request status')
    filters.push(eq(pettyCashRequests.status, query.status))
  }

  if (query.branchId && query.branchId !== 'all') {
    if (!isBranchValue(query.branchId)) throw new Error('Invalid branch')
    if (!canManagePettyCashBranch(appUser, query.branchId)) throw new Error('Forbidden branch')
    filters.push(eq(pettyCashRequests.branchId, query.branchId))
  }

  if (query.search) {
    filters.push(or(
      ilike(pettyCashRequests.requestNumber, `%${query.search}%`),
      ilike(pettyCashRequests.requestedByName, `%${query.search}%`),
      ilike(pettyCashRequests.purpose, `%${query.search}%`)
    )!)
  }

  if (query.startDate) filters.push(gte(pettyCashRequests.createdAt, new Date(`${query.startDate}T00:00:00+05:30`)))
  if (query.endDate) filters.push(lte(pettyCashRequests.createdAt, new Date(`${query.endDate}T23:59:59+05:30`)))

  const whereExpression = and(...filters)
  const offset = (query.page - 1) * query.pageSize
  const [{ total }] = await db.select({ total: count() }).from(pettyCashRequests).where(whereExpression)
  const rows = await db.select().from(pettyCashRequests).where(whereExpression).orderBy(desc(pettyCashRequests.createdAt)).limit(query.pageSize).offset(offset)

  return {
    requests: rows.map((row) => serializeRequest(row)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total) || 0,
      totalPages: Math.max(1, Math.ceil((Number(total) || 0) / query.pageSize)),
    },
  }
}

export async function listPettyCashExpenses(appUser: AppUser, input: z.input<typeof pettyCashListQuerySchema>) {
  const query = pettyCashListQuerySchema.parse(input)
  const filters = [getPettyCashExpenseVisibilityFilter(appUser)]

  if (query.status && query.status !== 'all') {
    if (!isPettyCashExpenseStatus(query.status)) throw new Error('Invalid expense status')
    filters.push(eq(pettyCashExpenses.status, query.status))
  }

  if (query.branchId && query.branchId !== 'all') {
    if (!isBranchValue(query.branchId)) throw new Error('Invalid branch')
    if (!canManagePettyCashBranch(appUser, query.branchId)) throw new Error('Forbidden branch')
    filters.push(eq(pettyCashExpenses.branchId, query.branchId))
  }

  if (query.search) {
    filters.push(or(
      ilike(pettyCashExpenses.expenseNumber, `%${query.search}%`),
      ilike(pettyCashExpenses.particulars, `%${query.search}%`),
      ilike(pettyCashExpenses.vendorName, `%${query.search}%`),
      ilike(pettyCashExpenses.purpose, `%${query.search}%`)
    )!)
  }

  if (query.startDate) filters.push(gte(pettyCashExpenses.createdAt, new Date(`${query.startDate}T00:00:00+05:30`)))
  if (query.endDate) filters.push(lte(pettyCashExpenses.createdAt, new Date(`${query.endDate}T23:59:59+05:30`)))

  const whereExpression = and(...filters)
  const offset = (query.page - 1) * query.pageSize
  const [{ total }] = await db.select({ total: count() }).from(pettyCashExpenses).where(whereExpression)
  const rows = await db.select().from(pettyCashExpenses).where(whereExpression).orderBy(desc(pettyCashExpenses.createdAt)).limit(query.pageSize).offset(offset)

  return {
    expenses: rows.map((row) => serializeExpense(row)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total) || 0,
      totalPages: Math.max(1, Math.ceil((Number(total) || 0) / query.pageSize)),
    },
  }
}

export async function getCurrentPettyCashAllocation(appUser: AppUser, branchId?: string | null) {
  const filters = [getPettyCashAllocationVisibilityFilter(appUser)]

  if (branchId && branchId !== 'all') {
    if (!isBranchValue(branchId)) throw new Error('Invalid branch')
    if (!canManagePettyCashBranch(appUser, branchId)) throw new Error('Forbidden branch')
    filters.push(eq(pettyCashAllocations.branchId, branchId))
  }

  if (appUser.role === 'admin' || appUser.role === 'branch_admin') {
    filters.push(eq(pettyCashAllocations.allocatedTo, appUser.id))
  }

  const [allocation] = await db
    .select()
    .from(pettyCashAllocations)
    .where(and(...filters))
    .orderBy(desc(pettyCashAllocations.createdAt))
    .limit(1)

  if (!allocation) return null

  return {
    ...serializeAllocation(allocation),
    remainingAmount: toMoney(getRemainingBalance(allocation)),
  }
}

export async function getPettyCashDashboard(appUser: AppUser, branchId?: string | null) {
  const [categories, currentAllocation, requestsResult, expensesResult] = await Promise.all([
    getPettyCashCategories(),
    getCurrentPettyCashAllocation(appUser, branchId),
    listPettyCashRequests(appUser, { page: 1, pageSize: 8, status: 'all', branchId }),
    listPettyCashExpenses(appUser, { page: 1, pageSize: 8, status: 'all', branchId }),
  ])

  const requests = filterDashboardRequests(appUser, requestsResult.requests as Array<Record<string, unknown>>)
  const expenses = filterDashboardExpenses(appUser, expensesResult.expenses as Array<Record<string, unknown>>)
  const pendingRequestCount = requests.filter((request) => String(request.status).includes('pending') || String(request.status).includes('on_hold')).length
  const pendingExpenseCount = 0
  const currentAllocationRecord = currentAllocation as Record<string, unknown> | null
  const allocationAmount = currentAllocationRecord ? parseMoney(currentAllocationRecord.allocatedAmount as string) : 0
  const spentAmount = currentAllocationRecord ? parseMoney(currentAllocationRecord.spentAmount as string) : 0
  const topUpStatus = getTopUpStatus(currentAllocation as PettyCashAllocationRecord | null)
  const canSubmitExpense = canCreatePettyCashExpense(appUser.role) && Boolean(currentAllocation)

  return {
    user: {
      id: appUser.id,
      role: appUser.role,
      brand: appUser.brand,
      fullName: appUser.fullName,
      email: appUser.email,
    },
    categories,
    currentAllocation,
    requests,
    expenses,
    summary: {
      allocationAmount,
      spentAmount,
      remainingAmount: Math.max(0, allocationAmount - spentAmount),
      canRequestTopUp: topUpStatus.canRequestTopUp,
      canSubmitExpense,
      topUpThreshold: PETTY_CASH_TOP_UP_THRESHOLD,
      topUpReason: topUpStatus.topUpReason,
      pendingRequestCount,
      pendingExpenseCount,
      requestCount: requests.length,
      expenseCount: expenses.length,
    },
  }
}

export async function createPettyCashRequest(appUser: AppUser, rawInput: unknown) {
  if (!canCreatePettyCashRequest(appUser.role)) {
    throw new Error('Forbidden')
  }

  const input = createPettyCashRequestSchema.parse(rawInput)
  const requestedBranchId = input.branchId && isBranchValue(input.branchId) ? input.branchId : null
  const branchId = requestedBranchId || normalizeBranch(appUser)

  if (!branchId || !canManagePettyCashBranch(appUser, branchId)) {
    throw new Error('Forbidden branch')
  }

  const activeAllocation = await getActivePettyCashAllocationForScope(branchId, appUser.id)
  const topUpStatus = getTopUpStatus(activeAllocation)
  if (!topUpStatus.canRequestTopUp) {
    throw new Error(topUpStatus.topUpReason)
  }

  const status = input.status === 'draft' ? 'draft' : 'ea_pending'
  const currentStage = input.status === 'draft' ? 'draft' : 'ea_approval'

  const [request] = await db
    .insert(pettyCashRequests)
    .values({
      requestNumber: makeReference('PCR'),
      branchId,
      status,
      currentStage,
      requestedByName: appUser.fullName,
      requestedByEmail: appUser.email,
      department: input.department || appUser.department || null,
      requestedAmount: toMoney(input.requestedAmount),
      purpose: input.purpose,
      requestForm: input.requestForm,
      supportingFiles: [],
      createdBy: appUser.id,
      submittedAt: status === 'ea_pending' ? new Date() : null,
    })
    .returning()

  const [history] = await db.insert(pettyCashApprovalHistory).values({
    entityType: 'request',
    requestId: request.id,
    action: status === 'draft' ? 'draft' : 'submit',
    stage: currentStage,
    performedBy: appUser.id,
    userRole: appUser.role,
    previousStatus: null,
    newStatus: status,
    remarks: input.purpose,
    metadata: input.requestForm,
  }).returning({ id: pettyCashApprovalHistory.id, remarks: pettyCashApprovalHistory.remarks })

  if (status === 'ea_pending') {
    await createPettyCashNotifications({
      event: 'request_submitted',
      entity: request,
      entityType: 'request',
      actor: getActor(appUser),
      historyId: history.id,
      remarks: history.remarks,
    })
  }

  return serializeRequest(request)
}

export async function createPettyCashExpense(appUser: AppUser, rawInput: unknown) {
  if (!canCreatePettyCashExpense(appUser.role)) {
    throw new Error('Forbidden')
  }

  const input = createPettyCashExpenseSchema.parse(rawInput)
  const [allocation] = await db
    .select()
    .from(pettyCashAllocations)
    .where(and(
      eq(pettyCashAllocations.id, input.allocationId || ''),
      eq(pettyCashAllocations.status, 'active')
    ))
    .limit(1)

  const activeAllocation = allocation || await db
    .select()
    .from(pettyCashAllocations)
    .where(and(
      eq(pettyCashAllocations.allocatedTo, appUser.id),
      eq(pettyCashAllocations.status, 'active')
    ))
    .orderBy(desc(pettyCashAllocations.createdAt))
    .limit(1)
    .then((rows) => rows[0])

  if (!activeAllocation || !canUsePettyCashAllocation(appUser, activeAllocation)) {
    throw new Error('No active petty cash allocation found')
  }

  if (input.amount > getRemainingBalance(activeAllocation)) {
    throw new Error('Expense exceeds remaining allocation balance')
  }

  const now = new Date()
  const { expense, history } = await db.transaction(async (tx) => {
    const [updatedAllocation] = await tx
      .update(pettyCashAllocations)
      .set({
        spentAmount: sql`${pettyCashAllocations.spentAmount} + ${toMoney(input.amount)}::numeric`,
        updatedAt: now,
      })
      .where(and(
        eq(pettyCashAllocations.id, activeAllocation.id),
        eq(pettyCashAllocations.status, 'active'),
        sql`${pettyCashAllocations.allocatedAmount} - ${pettyCashAllocations.spentAmount} >= ${toMoney(input.amount)}::numeric`
      ))
      .returning()

    if (!updatedAllocation) throw new Error('Expense exceeds remaining allocation balance')

    const [expense] = await tx.insert(pettyCashExpenses).values({
      expenseNumber: makeReference('PCE'),
      allocationId: activeAllocation.id,
      branchId: activeAllocation.branchId,
      status: 'approved',
      currentStage: 'ledger',
      expenseDate: input.expenseDate,
      particulars: input.purpose,
      department: appUser.department || null,
      categoryId: input.categoryId || null,
      amount: toMoney(input.amount),
      vendorName: input.vendorName || null,
      receivedBy: input.receivedBy || null,
      purpose: input.purpose,
      expenseForm: input.expenseForm,
      billFiles: input.billFiles,
      createdBy: appUser.id,
      submittedAt: now,
      accountsApprovedBy: appUser.id,
      accountsApprovedAt: now,
      accountsRemarks: null,
      updatedAt: now,
    }).returning()

    await tx.insert(pettyCashLedgerEntries).values({
      allocationId: activeAllocation.id,
      expenseId: expense.id,
      branchId: activeAllocation.branchId,
      entryType: 'expense',
      amount: toMoney(-input.amount),
      balanceAfter: toMoney(getRemainingBalance(updatedAllocation)),
      description: `${expense.expenseNumber}: ${expense.purpose}`,
      createdBy: appUser.id,
      metadata: {
        expenseNumber: expense.expenseNumber,
        purpose: expense.purpose,
        postedImmediately: true,
      },
    })

    const [history] = await tx.insert(pettyCashApprovalHistory).values({
      entityType: 'expense',
      expenseId: expense.id,
      action: 'post_expense',
      stage: 'ledger',
      performedBy: appUser.id,
      userRole: appUser.role,
      previousStatus: null,
      newStatus: 'approved',
      remarks: input.purpose,
      metadata: {
        ...input.expenseForm,
        remainingAfter: getRemainingBalance(updatedAllocation),
      },
    }).returning({ id: pettyCashApprovalHistory.id, remarks: pettyCashApprovalHistory.remarks })

    return { expense, history }
  })

  await createPettyCashNotifications({
    event: 'expense_posted',
    entity: expense,
    entityType: 'expense',
    actor: getActor(appUser),
    historyId: history.id,
    remarks: history.remarks,
  })

  return serializeExpense(expense)
}

export async function applyPettyCashRequestWorkflow(appUser: AppUser, rawInput: unknown) {
  const input = pettyCashWorkflowSchema.parse(rawInput)
  if (!canApprovePettyCashStage(appUser.role, input.stage)) throw new Error('Forbidden')

  const [request] = await db
    .select()
    .from(pettyCashRequests)
    .where(and(eq(pettyCashRequests.id, input.id), isNull(pettyCashRequests.deletedAt)))
    .limit(1)

  if (!request || !canReadPettyCashRequest(appUser, request)) throw new Error('Request not found')

  const now = new Date()
  let updateData: Partial<typeof pettyCashRequests.$inferInsert> = { updatedAt: now }
  let newStatus = request.status
  let newStage = request.currentStage
  let event: Parameters<typeof createPettyCashNotifications>[0]['event'] | null = null

  if (input.stage === 'ea_approval') {
    if (!['ea_pending', 'ea_on_hold'].includes(request.status)) throw new Error('Request is not awaiting EA approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'md_pending', currentStage: 'md_approval', eaApprovedBy: appUser.id, eaApprovedAt: now, eaRemarks: null }
      newStatus = 'md_pending'
      newStage = 'md_approval'
      event = 'request_ea_approved'
    } else if (input.action === 'hold') {
      updateData = { ...updateData, status: 'ea_on_hold', currentStage: 'ea_approval', eaRemarks: input.remarks || null }
      newStatus = 'ea_on_hold'
      newStage = 'ea_approval'
      event = 'request_held'
    } else {
      updateData = { ...updateData, status: 'ea_rejected', currentStage: 'ea_approval', rejectedAt: now, rejectedBy: appUser.id, eaRemarks: input.remarks || null }
      newStatus = 'ea_rejected'
      event = 'request_rejected'
    }
  } else if (input.stage === 'md_approval') {
    if (!['md_pending', 'md_on_hold'].includes(request.status)) throw new Error('Request is not awaiting MD approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'accounts_pending', currentStage: 'accounts', mdApprovedBy: appUser.id, mdApprovedAt: now, mdRemarks: null }
      newStatus = 'accounts_pending'
      newStage = 'accounts'
      event = 'request_md_approved'
    } else if (input.action === 'hold') {
      updateData = { ...updateData, status: 'md_on_hold', currentStage: 'md_approval', mdRemarks: input.remarks || null }
      newStatus = 'md_on_hold'
      newStage = 'md_approval'
      event = 'request_held'
    } else {
      updateData = { ...updateData, status: 'md_rejected', currentStage: 'md_approval', rejectedAt: now, rejectedBy: appUser.id, mdRemarks: input.remarks || null }
      newStatus = 'md_rejected'
      event = 'request_rejected'
    }
  } else if (input.stage === 'accounts') {
    if (!['accounts_pending', 'accounts_on_hold'].includes(request.status)) throw new Error('Request is not awaiting Accounts approval')
    if (input.action === 'reject') {
      updateData = { ...updateData, status: 'rejected', currentStage: 'accounts', rejectedAt: now, rejectedBy: appUser.id, accountsRemarks: input.remarks || null }
      newStatus = 'rejected'
      event = 'request_rejected'
    } else if (input.action === 'hold') {
      updateData = { ...updateData, status: 'accounts_on_hold', currentStage: 'accounts', accountsRemarks: input.remarks || null }
      newStatus = 'accounts_on_hold'
      newStage = 'accounts'
      event = 'request_held'
    } else {
      const approvedAmount = parseMoney(request.requestedAmount)

      const { updatedRequest, history } = await db.transaction(async (tx) => {
        const [activeAllocation] = await tx
          .select()
          .from(pettyCashAllocations)
          .where(and(
            eq(pettyCashAllocations.branchId, request.branchId),
            eq(pettyCashAllocations.allocatedTo, request.createdBy),
            eq(pettyCashAllocations.status, 'active')
          ))
          .limit(1)

        const carryForwardAmount = activeAllocation ? getRemainingBalance(activeAllocation) : 0
        const finalAllocationAmount = approvedAmount + carryForwardAmount

        const [updatedRequest] = await tx
          .update(pettyCashRequests)
          .set({
            status: 'approved',
            currentStage: 'allocated',
            allocatedAmount: toMoney(finalAllocationAmount),
            accountsApprovedBy: appUser.id,
            accountsApprovedAt: now,
            accountsRemarks: null,
            updatedAt: now,
          })
          .where(and(eq(pettyCashRequests.id, request.id), eq(pettyCashRequests.status, request.status)))
          .returning()

        if (!updatedRequest) throw new Error('Request already moved to another stage')

        if (activeAllocation) {
          if (carryForwardAmount > PETTY_CASH_TOP_UP_THRESHOLD) {
            throw new Error(`Top-up requests unlock when remaining balance is ${toMoney(PETTY_CASH_TOP_UP_THRESHOLD)} or below`)
          }

          const [closedAllocation] = await tx
            .update(pettyCashAllocations)
            .set({
              status: 'closed',
              closedAt: now,
              updatedAt: now,
              notes: input.remarks || activeAllocation.notes,
            })
            .where(and(
              eq(pettyCashAllocations.id, activeAllocation.id),
              eq(pettyCashAllocations.status, 'active'),
              sql`${pettyCashAllocations.allocatedAmount} - ${pettyCashAllocations.spentAmount} <= ${toMoney(PETTY_CASH_TOP_UP_THRESHOLD)}::numeric`
            ))
            .returning()

          if (!closedAllocation) {
            throw new Error(`Top-up requests unlock when remaining balance is ${toMoney(PETTY_CASH_TOP_UP_THRESHOLD)} or below`)
          }

          await tx.insert(pettyCashLedgerEntries).values({
            allocationId: activeAllocation.id,
            requestId: request.id,
            branchId: request.branchId,
            entryType: 'closure',
            amount: toMoney(-carryForwardAmount),
            balanceAfter: '0.00',
            description: `Closed previous allocation before ${request.requestNumber} top-up and carried forward remaining balance`,
            createdBy: appUser.id,
            metadata: {
              requestNumber: request.requestNumber,
              closedAllocationNumber: activeAllocation.allocationNumber,
              remainingClosed: toMoney(carryForwardAmount),
              carryForwardAmount: toMoney(carryForwardAmount),
            },
          })
        }

        const [allocation] = await tx.insert(pettyCashAllocations).values({
          allocationNumber: makeReference('PCA'),
          requestId: request.id,
          branchId: request.branchId,
          allocatedTo: request.createdBy,
          allocatedBy: appUser.id,
          allocatedAmount: toMoney(finalAllocationAmount),
          spentAmount: '0.00',
          status: 'active',
          notes: null,
        }).returning()

        await tx.insert(pettyCashLedgerEntries).values({
          allocationId: allocation.id,
          requestId: request.id,
          branchId: request.branchId,
          entryType: 'allocation',
          amount: toMoney(finalAllocationAmount),
          balanceAfter: toMoney(finalAllocationAmount),
          description: activeAllocation
            ? `Petty cash allocated via ${request.requestNumber} with carry-forward balance`
            : `Petty cash allocated via ${request.requestNumber}`,
          createdBy: appUser.id,
          metadata: {
            requestNumber: request.requestNumber,
            carryForwardAmount: toMoney(carryForwardAmount),
          },
        })

        const [history] = await tx.insert(pettyCashApprovalHistory).values({
          entityType: 'request',
          requestId: request.id,
          action: input.action,
          stage: input.stage,
          performedBy: appUser.id,
          userRole: appUser.role,
          remarks: null,
          previousStatus: request.status,
          newStatus: 'approved',
          metadata: {
            allocatedAmount: toMoney(approvedAmount),
            finalAllocationAmount: toMoney(finalAllocationAmount),
            carryForwardAmount: toMoney(carryForwardAmount),
          },
        }).returning({ id: pettyCashApprovalHistory.id, remarks: pettyCashApprovalHistory.remarks })

        return { updatedRequest, history }
      })

      await createPettyCashNotifications({
        event: 'request_approved',
        entity: updatedRequest,
        entityType: 'request',
        actor: getActor(appUser),
        historyId: history.id,
        remarks: history.remarks,
      })

      return serializeRequest(updatedRequest)
    }
  }

  const [updatedRequest] = await db
    .update(pettyCashRequests)
    .set(updateData)
    .where(and(eq(pettyCashRequests.id, request.id), eq(pettyCashRequests.status, request.status)))
    .returning()

  if (!updatedRequest) throw new Error('Request already moved to another stage')

  const [history] = await db.insert(pettyCashApprovalHistory).values({
    entityType: 'request',
    requestId: request.id,
    action: input.action,
    stage: input.stage,
    performedBy: appUser.id,
    userRole: appUser.role,
    remarks: input.remarks || null,
    previousStatus: request.status,
    newStatus,
    metadata: { nextStage: newStage },
  }).returning({ id: pettyCashApprovalHistory.id, remarks: pettyCashApprovalHistory.remarks })

  if (event) {
    await createPettyCashNotifications({
      event,
      entity: updatedRequest,
      entityType: 'request',
      actor: getActor(appUser),
      historyId: history.id,
      remarks: history.remarks,
    })
  }

  return serializeRequest(updatedRequest)
}

export async function applyPettyCashExpenseWorkflow(appUser: AppUser, rawInput: unknown) {
  const input = pettyCashWorkflowSchema.parse(rawInput)
  if (input.action === 'hold') throw new Error('Expense hold is not used because expenses post directly to ledger')
  if (!canApprovePettyCashStage(appUser.role, input.stage)) throw new Error('Forbidden')

  const [expense] = await db
    .select()
    .from(pettyCashExpenses)
    .where(and(eq(pettyCashExpenses.id, input.id), isNull(pettyCashExpenses.deletedAt)))
    .limit(1)

  if (!expense || !canReadPettyCashExpense(appUser, expense)) throw new Error('Expense not found')

  const now = new Date()
  let updateData: Partial<typeof pettyCashExpenses.$inferInsert> = { updatedAt: now }
  let newStatus = expense.status
  let newStage = expense.currentStage
  let event: Parameters<typeof createPettyCashNotifications>[0]['event'] | null = null

  if (input.stage === 'ea_approval') {
    if (expense.status !== 'pending') throw new Error('Expense is not awaiting EA approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'ea_approved', currentStage: 'md_approval', eaApprovedBy: appUser.id, eaApprovedAt: now, eaRemarks: input.remarks || null }
      newStatus = 'ea_approved'
      newStage = 'md_approval'
      event = 'expense_ea_approved'
    } else {
      updateData = { ...updateData, status: 'ea_rejected', rejectedAt: now, rejectedBy: appUser.id, eaRemarks: input.remarks || null }
      newStatus = 'ea_rejected'
      event = 'expense_rejected'
    }
  } else if (input.stage === 'md_approval') {
    if (expense.status !== 'ea_approved') throw new Error('Expense is not awaiting MD approval')
    if (input.action === 'approve') {
      updateData = { ...updateData, status: 'accounts_pending', currentStage: 'accounts', mdApprovedBy: appUser.id, mdApprovedAt: now, mdRemarks: input.remarks || null }
      newStatus = 'accounts_pending'
      newStage = 'accounts'
      event = 'expense_md_approved'
    } else {
      updateData = { ...updateData, status: 'md_rejected', rejectedAt: now, rejectedBy: appUser.id, mdRemarks: input.remarks || null }
      newStatus = 'md_rejected'
      event = 'expense_rejected'
    }
  } else if (input.stage === 'accounts') {
    if (expense.status !== 'accounts_pending') throw new Error('Expense is not awaiting Accounts approval')
    if (input.action === 'reject') {
      updateData = { ...updateData, status: 'rejected', rejectedAt: now, rejectedBy: appUser.id, accountsRemarks: input.remarks || null }
      newStatus = 'rejected'
      event = 'expense_rejected'
    } else {
      const { updatedExpense, history } = await db.transaction(async (tx) => {
        const [updatedAllocation] = await tx
          .update(pettyCashAllocations)
          .set({
            spentAmount: sql`${pettyCashAllocations.spentAmount} + ${toMoney(expense.amount)}::numeric`,
            updatedAt: now,
          })
          .where(and(
            eq(pettyCashAllocations.id, expense.allocationId),
            eq(pettyCashAllocations.status, 'active'),
            sql`${pettyCashAllocations.allocatedAmount} - ${pettyCashAllocations.spentAmount} >= ${toMoney(expense.amount)}::numeric`
          ))
          .returning()

        if (!updatedAllocation) throw new Error('Expense exceeds remaining allocation balance')

        const [updatedExpense] = await tx
          .update(pettyCashExpenses)
          .set({
            status: 'approved',
            currentStage: 'ledger',
            accountsApprovedBy: appUser.id,
            accountsApprovedAt: now,
            accountsRemarks: input.remarks || null,
            updatedAt: now,
          })
          .where(and(eq(pettyCashExpenses.id, expense.id), eq(pettyCashExpenses.status, expense.status)))
          .returning()

        if (!updatedExpense) throw new Error('Expense already moved to another stage')

        await tx.insert(pettyCashLedgerEntries).values({
          allocationId: expense.allocationId,
          expenseId: expense.id,
          branchId: expense.branchId,
          entryType: 'expense',
          amount: toMoney(-parseMoney(expense.amount)),
          balanceAfter: toMoney(getRemainingBalance(updatedAllocation)),
          description: `${expense.expenseNumber}: ${expense.particulars}`,
          createdBy: appUser.id,
          metadata: { expenseNumber: expense.expenseNumber, purpose: expense.purpose },
        })

        const [history] = await tx.insert(pettyCashApprovalHistory).values({
          entityType: 'expense',
          expenseId: expense.id,
          action: input.action,
          stage: input.stage,
          performedBy: appUser.id,
          userRole: appUser.role,
          remarks: input.remarks || null,
          previousStatus: expense.status,
          newStatus: 'approved',
          metadata: { remainingAfter: getRemainingBalance(updatedAllocation) },
        }).returning({ id: pettyCashApprovalHistory.id, remarks: pettyCashApprovalHistory.remarks })

        return { updatedExpense, history }
      })

      await createPettyCashNotifications({
        event: 'expense_approved',
        entity: updatedExpense,
        entityType: 'expense',
        actor: getActor(appUser),
        historyId: history.id,
        remarks: history.remarks,
      })

      return serializeExpense(updatedExpense)
    }
  }

  const [updatedExpense] = await db
    .update(pettyCashExpenses)
    .set(updateData)
    .where(and(eq(pettyCashExpenses.id, expense.id), eq(pettyCashExpenses.status, expense.status)))
    .returning()

  if (!updatedExpense) throw new Error('Expense already moved to another stage')

  const [history] = await db.insert(pettyCashApprovalHistory).values({
    entityType: 'expense',
    expenseId: expense.id,
    action: input.action,
    stage: input.stage,
    performedBy: appUser.id,
    userRole: appUser.role,
    remarks: input.remarks || null,
    previousStatus: expense.status,
    newStatus,
    metadata: { nextStage: newStage },
  }).returning({ id: pettyCashApprovalHistory.id, remarks: pettyCashApprovalHistory.remarks })

  if (event) {
    await createPettyCashNotifications({
      event,
      entity: updatedExpense,
      entityType: 'expense',
      actor: getActor(appUser),
      historyId: history.id,
      remarks: history.remarks,
    })
  }

  return serializeExpense(updatedExpense)
}

export async function getPettyCashRequestDetails(appUser: AppUser, requestId: string) {
  const [request] = await db.select().from(pettyCashRequests).where(and(eq(pettyCashRequests.id, requestId), isNull(pettyCashRequests.deletedAt))).limit(1)
  if (!request || !canReadPettyCashRequest(appUser, request)) throw new Error('Request not found')

  const [history, allocation] = await Promise.all([
    db.select().from(pettyCashApprovalHistory).where(eq(pettyCashApprovalHistory.requestId, requestId)).orderBy(asc(pettyCashApprovalHistory.createdAt)),
    db.select().from(pettyCashAllocations).where(eq(pettyCashAllocations.requestId, requestId)).limit(1).then((rows) => rows[0] || null),
  ])
  const userMap = await getUserMap(history.map((item) => item.performedBy).concat([request.createdBy]))

  return {
    request: serializeRequest(request),
    allocation: allocation ? serializeAllocation(allocation) : null,
    history: history.map((item) => ({
      ...serializeHistory(item),
      performedByName: userMap.get(item.performedBy)?.fullName || item.performedBy,
      performedByEmail: userMap.get(item.performedBy)?.email || null,
    })),
  }
}

export async function getPettyCashExpenseDetails(appUser: AppUser, expenseId: string) {
  const [expense] = await db.select().from(pettyCashExpenses).where(and(eq(pettyCashExpenses.id, expenseId), isNull(pettyCashExpenses.deletedAt))).limit(1)
  if (!expense || !canReadPettyCashExpense(appUser, expense)) throw new Error('Expense not found')

  const [history, attachments] = await Promise.all([
    db.select().from(pettyCashApprovalHistory).where(eq(pettyCashApprovalHistory.expenseId, expenseId)).orderBy(asc(pettyCashApprovalHistory.createdAt)),
    db.select().from(pettyCashExpenseAttachments).where(eq(pettyCashExpenseAttachments.expenseId, expenseId)).orderBy(desc(pettyCashExpenseAttachments.createdAt)),
  ])
  const userMap = await getUserMap(history.map((item) => item.performedBy).concat([expense.createdBy]))

  return {
    expense: serializeExpense(expense),
    attachments,
    history: history.map((item) => ({
      ...serializeHistory(item),
      performedByName: userMap.get(item.performedBy)?.fullName || item.performedBy,
      performedByEmail: userMap.get(item.performedBy)?.email || null,
    })),
  }
}

export async function getPettyCashLedger(appUser: AppUser, allocationId?: string | null) {
  const allocationFilter = allocationId
    ? eq(pettyCashLedgerEntries.allocationId, allocationId)
    : canManagePettyCashBranch(appUser, appUser.brand || '')
      ? eq(pettyCashLedgerEntries.branchId, appUser.brand || '')
      : undefined

  const filters = allocationFilter ? [allocationFilter] : []
  if (appUser.role !== 'admin' && appUser.role !== 'super_admin' && appUser.brand && appUser.brand !== 'all') {
    filters.push(eq(pettyCashLedgerEntries.branchId, appUser.brand))
  }

  const rows = await db
    .select()
    .from(pettyCashLedgerEntries)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(pettyCashLedgerEntries.createdAt))
    .limit(100)

  return rows.map((row) => serializeLedger(row))
}
